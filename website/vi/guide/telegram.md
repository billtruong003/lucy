# Chat qua Telegram

Telegram là kênh chính để nói chuyện với Lucy. Tiến trình `lucy-bridge` (`bridge/lucy_bridge.py`) long-poll Bot API của Telegram. Mỗi tin bạn gửi được chuyển cho Claude, chạy dưới dạng Claude Code có tool và vault trí nhớ của bạn, rồi câu trả lời được stream ngược về khung chat.

Trang này nói về việc dùng hằng ngày: lệnh, model, persona, gửi file, phiên chat, trí nhớ, và chuyện gì xảy ra khi Claude hết quota.

## Nhắc lại phần cài đặt

Bước này bạn làm một lần lúc [cài đặt](./installation). Tóm tắt:

1. Tạo bot với **@BotFather** trên Telegram (`/newbot`), copy bot token.
2. Điền token và Telegram user ID của bạn vào `bridge/.env`:

   ```ini
   TELEGRAM_BOT_TOKEN=<bot-token-của-bạn>
   LUCY_ALLOWED_USER_ID=<telegram-user-id-của-bạn>
   ```

3. Khởi động (hoặc khởi động lại) bridge: `pm2 restart lucy-bridge`.

Chưa biết user ID? Cứ chạy bridge, nhắn bot `/id`, bot sẽ trả `chat_id=… · user_id=…`. Chép `user_id` vào `.env` rồi restart.

::: warning Luôn đặt LUCY_ALLOWED_USER_ID
Lucy chạy Claude với `bypassPermissions`: tự đọc, ghi file và chạy lệnh mà không hỏi lại. Allow-list là lớp chặn duy nhất. Khi `LUCY_ALLOWED_USER_ID` đã đặt, tin nhắn và nút bấm của người khác bị bỏ ngay từ tầng poll; người lạ nào lọt tới handler sẽ nhận `⛔ Không có quyền.`. Nếu biến này **để trống**, bridge từ chối khởi động, trừ khi bạn đặt thêm `LUCY_ALLOW_ANYONE=1` (nguy hiểm: khi đó bot trả lời tất cả mọi người, và `/info` hiện `uid=(mở!)`).
:::

Vài biến hữu ích khác trong `bridge/.env`:

| Biến | Mặc định | Tác dụng |
|---|---|---|
| `LUCY_TG_PROXY` | trống | Proxy cho mọi lệnh gọi Telegram API, dùng khi mạng chặn Telegram (vd `socks5h://127.0.0.1:<port>`). Không ảnh hưởng traffic tới Claude. |
| `LUCY_WORKDIR` | `~/lucy-workspace` | Thư mục làm việc của Claude. File tải về và câu trả lời dài được lưu ở đây. |
| `LUCY_PERSONA` | `~/lucy/bridge/persona.md` | Persona gốc, được nối vào system prompt của Claude. |
| `LUCY_CLAUDE_TIMEOUT` | `900` | Số giây tối đa cho một lượt Claude. |
| `LUCY_BRIDGE_ENGINE` | `persist` | `persist` (mỗi chat giữ một Claude client sống, nhanh nhất, ngắt được), `sdk` (gọi Agent SDK một lần mỗi tin) hoặc `spawn` (chạy `claude -p` mỗi tin). |

## Một tin nhắn được xử lý thế nào

Mỗi chat có hàng đợi FIFO riêng nên không tin nào bị mất. Tin nhắn đi theo một trong hai đường:

| Đường | Khi nào | Lucy làm được gì |
|---|---|---|
| **Claude** | Model đang chọn là key `claude:*` (mặc định) | Đầy đủ Claude Code: tool Read/Write/Edit/Bash/web, vault trí nhớ (`--add-dir`), persona Lucy, phiên chat bền. |
| **Lane** | Bạn chọn model "lane" giá rẻ, hoặc chế độ `auto` đẩy sang đó | Model OpenAI-compatible chạy qua coordinator, kèm bộ tool nhỏ (tìm/đọc web, đọc/liệt kê/ghi/sửa file, bash, hỏi persona chuyên gia), tối đa 8 vòng tool. Không có tool của Claude Code, không gắn thư mục vault. Xem [Model](./models). |

Ở cả hai đường, bridge đều [tra trí nhớ](#tri-nho-hien-ra-the-nao) trước rồi chèn ghi chú liên quan vào prompt.

## Các lệnh

Lệnh không phân biệt hoa thường. Hậu tố `@TenBot` mà Telegram tự thêm trong nhóm sẽ được bỏ đi, nên `/new@TenBot` chạy giống `/new`. Chuỗi bắt đầu bằng `/` mà không phải lệnh nào dưới đây (kể cả `/start`) sẽ được gửi cho Lucy như tin nhắn bình thường.

| Lệnh | Tác dụng |
|---|---|
| `/new` | Mở phiên mới: đóng Claude client đang sống, quên session ID, lịch sử lane và mạch ngắn hạn. Lucy trả lời `✨ Phiên mới…`. |
| `/stop` | Xoá mọi tin đang chờ của chat này và ngắt câu trả lời đang chạy (engine persist). Xem [Dừng và lái hướng](#dung-va-lai-huong). |
| `/restart` | Tự khởi động lại bridge (`pm2 restart lucy-bridge`), khỏi phải SSH vào máy. |
| `/model [key]` | Không kèm gì: hiện nút chọn model. Kèm key: đổi thẳng (`/model opus`, `/model claude:haiku`, `/model auto`, `/model groq-gptoss-120b`). |
| `/persona [id]` | Không kèm gì: xem persona hiện tại và danh sách. `/persona researcher` để đổi vai; `/persona default` để về Lucy gốc. |
| `/think on\|off` | Bật/tắt khối `💭 (suy nghĩ)` gửi sau mỗi câu trả lời (tối đa 1.500 ký tự). Không kèm gì thì xem trạng thái. |
| `/info` | Lucy đang chạy bằng gì: engine, model ưa thích, persona, cờ think, model ID thật gần nhất, phiên bản Claude CLI, khóa chủ nhân, workdir, file persona, timeout, session ID hiện tại. |
| `/ctx` (hoặc `/context`) | Chẩn đoán lượt gần nhất: ước lượng token từng khối prompt, ghi chú trí nhớ đã chèn (hoặc lý do bỏ qua), tool đã dùng, thời gian ra token đầu, sức khoẻ vòng poll Telegram, bộ đếm lệnh, sức khoẻ recall và mức đầy context của phiên. Không bao giờ in nội dung tin nhắn hay trí nhớ. |
| `/id` | In `chat_id` và `user_id`. |
| `/token` (hoặc `/tokens`) | Lượng dùng Telegram hôm nay (đường Claude: token vào/ra, USD ước tính, số lượt, tính theo ngày UTC) và [token guard](./models#token-guard) chung cho hub, Telegram và autopilot. |
| `/prompt <việc cần làm>` | Prompt Architect: biến ý tưởng thô thành prompt tối ưu để bạn copy. Thêm `for=<model>` để nhắm model đích: `/prompt for=claude viết email xin nghỉ phép lịch sự`. Có thể hỏi lại một câu cho rõ trước. Cần `LUCY_PROMPT_ARCHITECT=1` ở coordinator. |
| `/fan` + mỗi dòng một việc | Chạy **song song** từ 2 việc độc lập trở lên, mỗi việc là một Claude agent riêng chạy một lần (Sonnet, tối đa 4 cái cùng lúc). Kết quả về dần dưới dạng `🔹 Lane N`. |
| `/orch <mục tiêu>` | Orchestrator: một agent lập kế hoạch 2–5 việc con độc lập, các sub-agent chạy song song, một agent cuối viết bản `🧩 TỔNG HỢP`. |
| `/auto <mục tiêu>` | Vòng tự động: Claude làm tiếp (resume phiên của chính nó) cho tới khi kết thúc bằng `STATUS: DONE`, tối đa 8 vòng. Mỗi vòng đều được gửi lên chat. |
| `!o <tin nhắn>` hoặc `!opus <tin nhắn>` | Dùng Opus cho riêng tin này, sau đó quay về model thường. |

Hai lệnh dừng và restart nhận cả chữ thường, với điều kiện **cả tin nhắn** chỉ gồm đúng một trong các từ sau:

- Dừng: `stop`, `/stop`, `/cancel`, `dừng`, `dung`, `/dung`, `/dừng`, `huy`, `huỷ`, `/huy`, `/huỷ`, `/ngung`, `/ngừng`
- Restart: `restart`, `/restart`, `/reload`, `/khoidong`, `khởi động lại`

Hai lệnh này được so với nguyên văn tin nhắn trước khi vào hàng đợi, nên trong nhóm hãy gõ `/stop` trần, đừng kèm `@TenBot`.

### Ví dụ

```text
/fan
tóm tắt tin BTC hôm nay
tóm tắt tin vàng hôm nay
check tỷ giá USD/VND
```

```text
/orch opus so sánh ba vector database tự host được cho VPS 4 GB
```

Mở đầu mục tiêu bằng `opus` (trong 12 ký tự đầu) thì sub-agent và bước tổng hợp của `/orch`, cũng như mọi vòng của `/auto`, sẽ dùng Opus thay vì Sonnet. Bước lập kế hoạch của `/orch` luôn dùng Sonnet.

```text
/auto thêm endpoint health-check cho project hub rồi chạy test
```

`/fan`, `/orch` và `/auto` chạy bằng các lệnh gọi Claude riêng, mỗi lần một phát. Chúng không dùng phiên chat, persona overlay hay phần tra trí nhớ của bạn, và chạy nền nên bạn vẫn chat tiếp được.

## Chọn model {#chon-model}

Gõ `/model` không kèm gì để hiện nút bấm:

- Mỗi model Claude trong catalog là một nút, có biểu tượng theo tầng: `⚡` nhanh, `✦` cân bằng, `🧠` sâu. Model đang dùng có dấu `✅`.
- `🧭 Auto`: một router nhỏ quyết định cho từng tin. Nếu router thấy tin cần tool, hoặc router lỗi, tin đi `claude:sonnet`; còn lại đi một model lane rẻ. Lucy báo rõ: `🧭 auto → lane …` hoặc `🧭 auto → claude …`.
- `🆓 Lane…` mở menu con với tối đa 12 model lane trong catalog. `‹ quay lại` để trở về.

Bấm một nút là tin nhắn tự sửa thành `✅ Đã đổi model → <key>`. Lựa chọn được lưu theo từng chat (`~/.lucy-bridge-prefs.json`) và giữ nguyên sau khi restart.

Gõ tay cũng được: `/model sonnet`, `/model opus`, `/model fable`, `/model haiku` tự hiểu thành `claude:<tên>`. Key lạ sẽ bị từ chối với `❌ Key lạ`.

Khi bạn chưa chọn gì, Telegram dùng **`claude:sonnet`**. Đổi qua lại giữa các model Claude vẫn giữ nguyên hội thoại, vì client đang sống được đổi model tại chỗ. Mỗi model lane có lịch sử riêng theo từng chat, nên đổi sang lane khác là bắt đầu ngữ cảnh lane đó từ đầu. Danh sách model đầy đủ xem ở [Model](./models).

## Persona

Persona là một vai được phủ lên persona gốc. Lucy vẫn là Lucy, chỉ nhận thêm chỉ dẫn của vai đó. Persona nằm ở `agent-machine/config/personas/*.json` (trường `systemPrompt`), ID chính là tên file:

`architect`, `builder`, `data`, `designer`, `devops`, `engineer`, `finance`, `grinder`, `investigator`, `marketing`, `orchestrator`, `prompt-architect`, `researcher`, `reviewer`, `reviewer-spec`, `security`, `tester`, `writer`

```text
/persona finance        → ✅ Đổi vai → finance (overlay lên Lucy)
/persona                → xem vai hiện tại + danh sách
/persona default        → về Lucy gốc (hoặc: lucy, none)
```

Persona áp dụng cho cả hai đường. Ở đường Claude, đổi persona nghĩa là system prompt đổi, nên bridge mở Claude client mới nhưng vẫn resume đúng phiên cũ, hội thoại không bị đứt. Muốn thêm vai riêng, chỉ cần bỏ một file JSON mới có `systemPrompt` vào thư mục đó.

## Gửi ảnh và file

| Bạn gửi | Chuyện gì xảy ra |
|---|---|
| Ảnh, hoặc ảnh gửi dạng file | Tải về workdir. Lucy mở bằng tool Read của Claude (đọc ảnh native) rồi trả lời. Caption của bạn được coi là câu hỏi. |
| Tài liệu khác | Tải về workdir, kèm hướng dẫn mở theo loại: `.txt/.md/.csv/.json/.log` và `.pdf` đọc bằng Read (PDF xem được cả ảnh trong trang); `.xlsx/.xls` dùng Python `openpyxl`; `.docx` dùng Python `python-docx`. Không có caption thì Lucy tóm tắt nội dung. |
| Voice, sticker, video, vị trí… | Bỏ qua. Bridge chỉ xử lý chữ, ảnh và tài liệu. |

Ảnh và file luôn đi đường Claude. Nếu bạn đang chọn một lane, riêng tin đó sẽ chuyển sang `claude:sonnet`, vì lane không xem được ảnh và không có tool đọc file của Claude. Với Excel và Word, nhớ cài `openpyxl` và `python-docx` trên server.

Lucy báo tiến độ lúc tải (`🖼️ Em đang tải ảnh xuống ạ…`, `📎 Em đang tải file <tên> xuống ạ…`) và báo lỗi nếu `getFile` của Telegram hỏng. Bản thân Bot API của Telegram chỉ cho bot tải file tới khoảng 20 MB.

Lucy cũng gửi file ngược lại được: câu trả lời dài hoặc nhiều bảng sẽ về dạng tài liệu `.md` (xem phần dưới).

## Stream, tiến độ và câu trả lời dài

- **Đường Claude:** Lucy gửi trước `🤔 Em xử lý ạ… (<model>)`, rồi sửa chính tin đó khoảng mỗi giây một lần theo chữ đang stream. Khi dài quá 3.400 ký tự, bản xem trước chỉ hiện phần cuối.
- **Đường lane, `/auto`, `/orch`:** một nhịp tim sửa tin trạng thái mỗi 15 giây (`◐ Em đang chạy (<model>)… 1m15s`) để bạn biết Lucy vẫn đang chạy.
- **Kết quả cuối (đường Claude):**
  - Độ dài bình thường: tin đang stream trở thành câu trả lời cuối (3.900 ký tự đầu). Phần dư gửi tiếp thành các tin khoảng 3.800 ký tự. Không cắt cụt chữ nào.
  - Có bảng (từ 6 dấu `|`), từ 2 tiêu đề `#` trở lên, hoặc dài hơn 7.600 ký tự: Lucy báo `✅ Xong … gửi file ạ`, gửi một đoạn tóm tắt ngắn kèm toàn văn dạng file `.md`.
- **Kết quả cuối (đường lane):** câu trả lời dài hơn 1.600 ký tự, hoặc có bảng/tiêu đề, sẽ gửi thành file `.md` kèm 600 ký tự xem trước.

Tin Lucy gửi được chuyển sang MarkdownV2 của Telegram nếu có cài `telegramify-markdown`; lỗi thì gửi chữ thường. Link preview luôn tắt, vì việc tải preview có thể làm rò dữ liệu nếu có prompt injection cài link vào câu trả lời.

## Dừng và lái hướng {#dung-va-lai-huong}

- **Lái hướng:** với engine `persist` mặc định, nhắn một tin **chữ thường** mới trong lúc Lucy đang trả lời sẽ ngắt câu đang chạy. Phần chữ đã stream vẫn giữ, và tin mới được xử lý ngay sau đó trong **cùng phiên**, nên Lucy làm theo ý mới nhất của bạn. Các lệnh như `/info` hay `/token` thì không ngắt.
- **`/stop`** xoá hàng đợi (`🛑 Đã dừng — xoá N việc đang chờ`) và ngắt câu đang trả lời. Với engine `sdk` hoặc `spawn` thì không ngắt giữa chừng được; tin trả lời sẽ báo việc đang chạy dở sẽ tự xong.

::: tip
Vì tin mới nào cũng ngắt câu đang chạy, hãy viết một tin đầy đủ thay vì ba mẩu liên tiếp. Nếu không, Lucy chỉ trả lời trọn vẹn mẩu cuối.
:::

## Phiên chat

Với engine `persist` mặc định, mỗi chat có một **Claude client sống**:

- **Bền:** session ID được lưu ở `~/.lucy-bridge-sessions.json`. Client rảnh quá 30 phút (`LUCY_SDK_IDLE_S=1800`) sẽ bị đóng cho đỡ tốn RAM; tin kế tiếp resume lại đúng phiên từ đĩa. Nếu file phiên đã bị dọn, Lucy lặng lẽ mở phiên mới thay vì báo lỗi.
- **Xoay vòng khi context đầy:** cứ 5 lượt bridge kiểm tra context đầy tới đâu. Từ 70% (`LUCY_ROTATE_CTX_PCT`), hoặc sau 120 lượt (`LUCY_ROTATE_TURNS`), bridge mở client mới và mang theo một mẩu nối mạch nhỏ: các đính chính và quy tắc bạn đã dặn (tối đa 6), 4 tin gần nhất của bạn, và câu trả lời gần nhất của Lucy (đã rút gọn). Transcript cũ bị bỏ; sự thật lâu dài vốn đã nằm trong vault. Đặt `LUCY_ROTATE_CTX_PCT=0` để tắt.
- **`/new`** xoá sạch mọi thứ của chat, kể cả phần nối mạch. Nếu bật `LUCY_SESSION_SUMMARY=1`, bridge sẽ tóm tắt phiên trước rồi lưu thành ghi chú episode trong vault (xem [Trí nhớ](./memory)).
- **Lịch sử lane** giữ theo từng chat và từng model lane (60 tin gần nhất, `LUCY_LANE_HIST_MAX`) ở `~/.lucy-lane-history.json`.

Dùng `/ctx` để xem số lượt, tuổi phiên, số lần xoay vòng và mức dùng context (`Context: 123,456/1,000,000 tok (12%)`).

## Trí nhớ hiện ra thế nào {#tri-nho-hien-ra-the-nao}

Trước mỗi tin nhắn thường, bridge nhờ coordinator tra vault của bạn. Việc này chạy nền, song song với phần chuẩn bị trả lời, timeout 4 giây. Bạn sẽ thấy:

- **Không hiện trong chat.** Kết quả được chèn vào prompt trong một khối ghi rõ là bằng chứng phụ, thẩm quyền thấp. Lucy dùng khi liên quan, và không bao giờ được để nó đè lên điều bạn vừa nói.
- **Có chọn lọc.** Không tra với lệnh, câu xác nhận ngắn ("ok", "ừ"), câu sửa lời ("không phải…", "ý t là…"), câu hỏi nối tiếp toàn đại từ ("cái đó", "option 2") và tin dưới 12 ký tự, trừ khi tin hỏi rõ chuyện cũ ("hôm qua", "lần trước", "còn nhớ"…). Các tín hiệu này viết cho cách nói tiếng Việt; tin tiếng Anh phần lớn đi đường mặc định, tức là tin đủ dài thì vẫn tra.
- **Có lọc.** Tối đa 5 ghi chú, khoảng 800 ký tự. Kết quả có điểm rerank dưới `0.35` (`LUCY_RECALL_MIN_SCORE`) bị loại. Mỗi ghi chú kèm nguồn và tuổi (`⟨Brain/… · 3d trước⟩`) để Lucy mở ra kiểm chứng được.
- **Hội thoại được ghi lại.** Tin của bạn và câu trả lời của Lucy được lưu vào kho episodic (đã che secret) để các phiên sau nhớ lại được. Tắt bằng `LUCY_EPISODIC=0`.

Muốn biết lượt vừa rồi chèn gì, gõ `/ctx`: lệnh liệt kê tên các ghi chú, hoặc lý do bỏ qua, và cảnh báo `DEGRADED` nếu reranker thực ra không chạy. Tắt tra trí nhớ bằng `LUCY_RECALL_PREFETCH=0`. Chi tiết ở [Trí nhớ](./memory).

## Khi Claude hết quota {#khi-claude-het-quota}

Khi Claude không dùng được, Lucy không trả lỗi trống. Lucy tự chuyển sang model lane tốt nhất còn API key và báo bạn:

```text
⚠️ Claude hết token, em chạy tạm bằng `devstral-med` (Claude báo hết token/usage-limit).
```

Cơ chế này kích hoạt khi:

1. [token guard](./models#token-guard) chung đã chạm giới hạn **cứng** trong ngày (lúc này Claude không được gọi luôn), hoặc
2. câu trả lời của Claude trông như lỗi usage limit, rate limit, `429`, "extra usage" hay quota.

Model dự phòng là model đầu tiên có key của provider, theo thứ tự: route `agentic-code`, rồi `reasoning`, rồi model router, rồi bất kỳ model free nào trong catalog. Nếu không lane nào có key, Lucy vẫn gọi Claude như thường và bạn thấy nguyên những gì Claude trả về, kể cả lỗi. Ảnh và file thì lane không đọc được.

## Giới hạn và mẹo

- **Một chủ.** Bridge được thiết kế cho đúng một người dùng được phép. Lucy trả lời người đó ở bất kỳ chat nào, kể cả nhóm, và bỏ qua mọi người khác.
- **Timeout.** Một lượt Claude quá `LUCY_CLAUDE_TIMEOUT` (900 giây) sẽ dừng với `⏱️ Claude chạy quá lâu (timeout)` kèm phần đã stream được. Việc lớn thì chia nhỏ, hoặc dùng `/auto`.
- **Tự hồi phục.** Nếu vòng poll không thành công suốt 240 giây (`LUCY_POLL_WATCHDOG_S`), bridge tự thoát để PM2 dựng lại. Offset update được lưu, nên restart không xử lý lại tin cũ; update trùng cũng bị bỏ qua.
- **`/restart` cần PM2** ở `/usr/bin/pm2` và tiến trình tên `lucy-bridge`.
- **MCP server tắt trong chat** theo mặc định để nhanh hơn; tool gốc của Claude Code vẫn còn đủ. Đặt `LUCY_CHAT_MCP=1` rồi restart bridge nếu cần MCP.
- **Đăng ký menu lệnh** với @BotFather (`/setcommands`) để các lệnh trên hiện ra khi bạn gõ `/`.
- **Ngôn ngữ.** Persona nói tiếng Việt (xưng "em", gọi "chủ nhân") và các tin trạng thái cũng bằng tiếng Việt. Muốn đổi thì sửa `bridge/persona.md`.

Liên quan: [Model](./models) · [Trí nhớ](./memory) · [Web hub](./web-hub) · [Bảo mật](./security)
