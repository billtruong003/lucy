# Tự động hoá

Lucy vẫn làm việc khi bạn không nhắn tin với cô. Có bốn cơ chế:

| Cơ chế | Chạy trong | Dùng điển hình |
|---|---|---|
| [Prompt theo lịch](#prompt-theo-lich-trong-hub) | process `lucy-hub` | "7:30 sáng mỗi ngày, research X rồi gửi bản tóm tắt cho tôi" |
| [Dream ban đêm](#dream-ban-dem-cron) | `cron` của hệ thống | Gộp trí nhớ mỗi đêm |
| [Autopilot cho agent](#autopilot-cho-agent) | process `lucy-autopilot` | Duyệt các gate thường lệ trên bảng việc trong lúc bạn ngủ |
| [Cron job của riêng bạn](#them-cron-job-cua-rieng-ban) | `cron` của hệ thống | Mọi việc khác |

## Prompt theo lịch trong hub {#prompt-theo-lich-trong-hub}

Mở tab **Schedule** trong [web hub](./web-hub), bấm **+ Lịch mới**.

| Trường | Ý nghĩa |
|---|---|
| Tên | Nhãn của lịch, cũng là tiêu đề tin nhắn Telegram |
| Prompt | Việc Lucy cần làm, viết như khi bạn chat |
| Giờ chạy | Một hoặc nhiều mốc `HH:MM`, cách nhau bằng dấu phẩy, ví dụ `07:30,20:00`. Mốc sai định dạng bị bỏ qua mà không báo |
| Model | `sonnet` (nhanh, mặc định) hoặc `opus` (sâu) |

Bấm **Tạo lịch**. Mỗi thẻ lịch có:

- **công tắc** để bật hoặc tạm dừng,
- **▶ chạy** để chạy ngay,
- **✕** để xoá (không có chức năng sửa; muốn sửa thì xoá rồi tạo lại),
- thời điểm và trạng thái **lần chạy cuối** (✓ hoặc ✗), kèm 400 ký tự đầu của kết quả.

### Cách một lượt chạy diễn ra

- Bộ hẹn giờ trong hub kiểm tra mỗi 30 giây. Mỗi mốc giờ chạy **tối đa một lần mỗi ngày**.
- Giờ tính theo **độ lệch múi giờ cấu hình cho hub**, `LUCY_TZ_OFFSET` giờ so với UTC (mặc định `7`), không theo múi giờ của server. Hãy đặt đúng múi giờ của bạn, ví dụ `LUCY_TZ_OFFSET=1`.
- Mỗi lượt là một **phiên Claude mới** (không có lịch sử chat), có persona và vault trí nhớ, chạy trong `LUCY_WORKDIR`, với toàn quyền dùng tool như chat (`bypassPermissions`). Khác với chat trong hub, lượt chạy theo lịch không chèn recall trí nhớ vào đầu prompt.
- Lượt bị lỡ **không được chạy bù**. Nếu 7:30 mà hub đang tắt thì hôm đó bỏ qua mốc 7:30.
- Lịch lưu ở `$LUCY_STATE/schedules.json` (mặc định `~/.lucy-hub/schedules.json`).

### Kết quả đi đâu

1. **Telegram**, nếu hub có đủ hai biến. Tin nhắn có dạng `🗓️ Lucy — <tên>` rồi tới kết quả (cắt ở khoảng 3.800 ký tự, tắt link preview):

   ```ini
   TELEGRAM_BOT_TOKEN=<bot-token>
   LUCY_PUSH_CHAT_ID=<chat-id>        # tuỳ chọn; không có thì dùng LUCY_ALLOWED_USER_ID
   ```

   Chip ở đầu tab hiện **📲 Telegram: bật** hoặc **tắt**.
2. **Tab Tasks.** Kết quả đầy đủ, dưới tên job `[lịch] <tên>` (giữ tới khi hub restart).
3. **Tab Logs.** Các dòng `⏰ chạy "<tên>"` và `✓`/`✗`.

::: tip Viết prompt theo lịch cho tốt
Viết sao cho tự đủ nghĩa, vì lượt chạy không có ngữ cảnh chat. Nói rõ cần ra cái gì và dài bao nhiêu, ví dụ: *"Kiểm tra giá BTC, ETH và vàng, tóm tắt 5 gạch đầu dòng, cảnh báo nếu biến động quá 5% trong 24 giờ."*
:::

### Cron hệ thống (chỉ xem)

Bên dưới danh sách lịch, mục **🛠️ Cron hệ thống** liệt kê các dòng `crontab -l` của user chạy hub, kèm nhãn và giờ cho dễ đọc. Phần này chỉ để xem. Muốn sửa cron thì sửa trong shell, hoặc nhờ Lucy.

## Dream ban đêm (cron) {#dream-ban-dem-cron}

"Dream" là bước gộp trí nhớ hằng đêm của Lucy (xem [Bộ nhớ](./memory)). Đó là script shell `bridge/cron_dream.sh`, do cron gọi:

```text
0 2 * * * /path/to/lucy/bridge/cron_dream.sh >> /path/to/lucy-workspace/dream-cron.log 2>&1
```

Cài bằng `crontab -e`. Cron dùng **múi giờ của server**, nên `0 2 * * *` là 2 giờ sáng theo giờ server.

Một lượt chạy làm lần lượt:

1. **Dream preference** (`npm run dream` trong `agent-machine/`). Xử lý các signal trong `Brain/inbox`: nâng preference mới lên (unconfirmed), xác nhận, bác bỏ hoặc cho nghỉ các preference cũ, đánh dấu mâu thuẫn, tạo lại `active.md`, và dọn signal quá hạn trong inbox. Bước này chạy theo quy tắc cố định, không tốn token.
2. **Bài học của từng agent.** Khi một persona gom đủ bài học thô, một lệnh gọi Claude duy nhất cô đọng chúng thành quy tắc dùng lại được, và bài học thô cũ được lưu trữ. Không có Claude thì bước này tự bỏ qua.
3. **Gộp trí nhớ.** Script đặt `LUCY_CONSOLIDATE=1` và `LUCY_CONSOLIDATE_APPLY=1`, nên khi đã cấu hình tìm kiếm vector (key Jina), các fact trùng hoặc lỗi thời sẽ được gộp hoặc thay thế. Trước khi áp dụng có tạo snapshot, và báo cáo được ghi vào `Brain/proposals/consolidate-<ngày>.md`.
4. **Reindex** (tăng dần), để recall và tab Bộ não thấy các note viết trong ngày.
5. **Heartbeat.** Một dòng thống kê trí nhớ, để bạn biết việc học vẫn còn chạy.
6. **Báo cáo Telegram** tới `LUCY_ALLOWED_USER_ID`, nếu có `TELEGRAM_BOT_TOKEN`: báo lỗi nếu dream hỏng, tóm tắt nếu trí nhớ có thay đổi, hoặc chỉ heartbeat nếu không có gì mới.

Script nạp `bridge/.env` và dùng `LUCY_VAULT` (mặc định `~/lucy/lucy-vault`). Chạy tay:

```bash
bash /path/to/lucy/bridge/cron_dream.sh
tail -n 50 /path/to/lucy-workspace/dream-cron.log
```

Nút **🌙 Dream** trong tab Bộ não chạy dream preference ngay lập tức thông qua coordinator.

## Autopilot cho agent {#autopilot-cho-agent}

Autopilot ("Lucy trực đêm") là process chạy nền giúp [bảng việc agent](./agents) tiếp tục chạy khi card dừng lại chờ người. Nó là mục `lucy-autopilot` trong `ecosystem.config.cjs`.

Cứ 6 giây (`AM_AUTOPILOT_POLL_MS`) nó đọc bảng việc, và với mỗi card ở trạng thái **chờ bạn duyệt**:

| Loại chờ | Autopilot làm gì |
|---|---|
| `gate` | Một lệnh gọi Claude đóng vai "director" (`AM_DIRECTOR_MODEL`, mặc định `opus`) đọc báo cáo của bước đó rồi **duyệt** hoặc **trả lại kèm góp ý**. Phân vân thì chuyển lên cho bạn |
| `decision` | Director trả lời câu hỏi của agent, hoặc chuyển lên cho bạn |
| `cost` | Nếu card đã tiêu từ `AM_CARD_HARD_USD` (mặc định `8`) trở lên thì chuyển lên cho bạn. Chưa tới mức đó thì director quyết có cho chạy tiếp không |

Các lớp an toàn:

- **Gate được bảo vệ thì không bao giờ tự duyệt:** bước do persona `devops` hoặc `security` thực hiện, và toàn bộ pipeline `secure-ship`.
- **Giới hạn số quyết định.** Dừng sau `AM_AUTOPILOT_MAX` lần quyết (file ecosystem đặt `50`; mặc định trong code là `100`). Restart process để đếm lại.
- **Token guard.** Chạm ngưỡng mềm trong ngày thì executor bị hạ xuống model rẻ nhất và bạn nhận cảnh báo Telegram. Chạm ngưỡng cứng thì autopilot ngừng xử lý card và card mới phải chờ bạn. Xem [Bảo mật](./security#token-guard).
- **Minh bạch.** Mọi hành động được đăng dạng `🌙 Lucy trực đêm [trạng thái token] — …` vào kênh `general` của dự án, và hiện trong **Dashboard → Cho Lucy → Nhật ký trực đêm**.

Bật hoặc tắt bằng PM2:

```bash
pm2 start ecosystem.config.cjs --only lucy-autopilot
pm2 stop lucy-autopilot
pm2 logs lucy-autopilot --lines 50
```

::: warning
Agent làm việc trong bản clone dưới `agent-machine/.worker/` và không tự push. Dù vậy, một gate được duyệt nghĩa là thay đổi code đi tiếp mà bạn chưa đọc. Hãy bắt đầu với `AM_AUTOPILOT_MAX` thấp và đọc nhật ký trực đêm vào buổi sáng.
:::

## Thêm cron job của riêng bạn {#them-cron-job-cua-rieng-ban}

Bạn có thể dùng cron để hẹn giờ bất kỳ script nào, ví dụ sao lưu hay báo cáo. Vài nguyên tắc để an toàn:

1. **Dùng file script, đừng viết một dòng lệnh dài.** Đặt nó trong thư mục riêng (ví dụ `~/lucy-cron/`), cấp quyền chạy, và mở đầu bằng `set -euo pipefail`.
2. **Nạp secret từ file env** như `cron_dream.sh` vẫn làm. Đừng bao giờ ghi token vào dòng crontab:

   ```bash
   #!/usr/bin/env bash
   set -euo pipefail
   set -a; . /path/to/lucy/bridge/.env; set +a      # TELEGRAM_BOT_TOKEN, LUCY_ALLOWED_USER_ID
   export PATH="$PATH:/usr/local/bin:/usr/bin"       # cron có PATH rất tối giản
   # ... việc của bạn ...
   ```

3. **Luôn chuyển output vào file log** và giữ log gọn (xoay vòng, hoặc để `logrotate` lo):

   ```cron
   30 6 * * 1 /home/lucy/lucy-cron/weekly-report.sh >> /home/lucy/lucy-cron/weekly-report.log 2>&1
   ```

4. **Chống chạy chồng** với job dài: `flock -n /tmp/weekly-report.lock /home/lucy/lucy-cron/weekly-report.sh`.
5. **Nếu job gọi Claude** (`claude -p ...`), nhớ rằng nó có đúng những quyền bạn trao. Ưu tiên prompt hẹp và `--allowedTools` thay vì `bypassPermissions`, và đừng bao giờ đổ nội dung web không tin cậy thẳng vào một prompt có quyền chạy shell.
6. **Tắt link preview khi gửi tin** nếu bạn báo qua Telegram (thêm `link_preview_options`, như bridge đang làm).
7. **Chạy tay một lần** trước khi tin dùng, rồi xem log sau lượt chạy theo lịch đầu tiên.

Cron job hiện ở chế độ chỉ-xem trong tab Schedule của hub và trong cây VPS của tab Tinh hà.

::: tip Cron hay lịch trong hub?
Nếu việc cần làm là "hỏi Lucy một điều mỗi ngày", hãy dùng **lịch trong hub**: không cần shell, kết quả về Telegram. Dùng **cron** cho script không cần hub, hoặc phải chạy cả khi hub đang tắt.
:::
