# Cấu hình

Lucy được cấu hình hoàn toàn bằng biến môi trường. Trang này liệt kê mọi biến có trong bốn file env mẫu, cùng các cờ tuỳ chọn `LUCY_*` và `AM_*` mà code đọc.

## Cấu hình được nạp thế nào

`ecosystem.config.cjs` đọc bốn file, gộp theo thứ tự dưới đây và truyền kết quả cho **mọi** process PM2:

| Thứ tự | File | Nội dung thường gặp | Mẫu |
|---|---|---|---|
| 1 | `.env.llm` | Key provider LLM, Jina, thông tin đăng nhập MCP | `.env.llm.example` |
| 2 | `agent-machine/.env` | Token coordinator/worker, ngân sách, số việc song song | `agent-machine/.env.example` |
| 3 | `bridge/.env` | Token Telegram, user được phép, persona, đường dẫn Claude CLI | `bridge/.env.example` |
| 4 | `.env.runtime` | Mật khẩu hub, đường dẫn vault và state, cờ tính năng | `.env.runtime.example` |

Những điều nên biết:

- **File sau thắng, kể cả khi giá trị rỗng.** `AM_TOKEN=` trong `bridge/.env` sẽ xoá trắng token đặt ở `agent-machine/.env`. Với các biến dùng chung (`AM_TOKEN`, `LUCY_SESSION_SUMMARY`), đặt cùng một giá trị ở mọi nơi, hoặc xoá dòng rỗng.
- **Biến trong shell bị bỏ qua.** Process chạy với `filter_env: true`, nên `export FOO=1` trước `pm2 start` không có tác dụng.
- **Vài process có giá trị cố định** trong `ecosystem.config.cjs`: worker nhận `AM_RUNNER=claude`, autopilot nhận `AM_AUTOPILOT_MAX=50`, pxpipe nhận `HOST`, `PORT` và `PXPIPE_MODELS`, bridge nhận `PYTHONUNBUFFERED=1`.
- **Một số thành phần còn tự đọc file.** Agent-machine đọc lại `~/lucy/.env.llm` (hoặc `LLM_ENV_FILE`) và để file này đè giá trị đang có. Bridge đọc `bridge/.env`, hub đọc `hub/server/.env`, nhưng hai file này chỉ bổ sung biến chưa được đặt.
- **PM2 chỉ đọc env lúc tạo process.** Sửa file xong phải tạo lại process: `pm2 delete <tên> && pm2 start ecosystem.config.cjs --only <tên>`. Xem [Vận hành](./operations#after-config-change).

Cờ bật/tắt nhận `1`/`true`/`on` và `0`/`false`/`off`. Để ý giá trị mặc định: có cờ bật sẵn trừ khi bạn tắt, có cờ tắt sẵn trừ khi bạn bật.

Biến **bắt buộc** được đánh dấu ✅.

## `.env.llm`: provider, trí nhớ, MCP

### Lane model rẻ

Key cho các provider tương thích OpenAI, dùng cho lane rẻ, lane của persona và bộ định tuyến. Tất cả đều tuỳ chọn: lane chỉ xuất hiện khi có key.

| Biến | Mặc định | Tác dụng |
|---|---|---|
| `OPENROUTER_API_KEY` | — | Key OpenRouter. |
| `GROQ_API_KEY` | — | Key Groq. |
| `GEMINI_API_KEY` | — | Key Google Gemini (endpoint tương thích OpenAI). |
| `GEMINI_API_KEY_2` | — | Key phụ cho cùng provider. Key của provider nào cũng có thể có bản `_2` … `_8`, mỗi biến chứa được nhiều key cách nhau bằng dấu phẩy; tất cả gộp thành một vòng xoay key. |
| `CEREBRAS_API_KEY` | — | Key Cerebras. |
| `MISTRAL_API_KEY` | — | Key Mistral. |
| `ZAI_API_KEY` | — | Key Z.ai. |
| `NOUS_API_KEY` | — | Key Nous Portal. |
| `OPENCODE_ZEN_API_KEY` | — | Key OpenCode Zen. |

### Trí nhớ vector (Jina)

| Biến | Mặc định | Tác dụng |
|---|---|---|
| `JINA_API_KEY` | — | Bật tìm kiếm vector trên vault (kết hợp với tìm toàn văn) và, khi có `LUCY_RERANK=1`, bật rerank. Không có key thì recall chỉ tìm toàn văn. |
| `JINA_EMBED_MODEL` | `jina-embeddings-v5-omni-nano` | Model embedding. |
| `JINA_EMBED_DIM` | `768` | Số chiều embedding. Đổi giá trị này thì phải reindex toàn bộ. |
| `JINA_RERANK_MODEL` | `jina-reranker-v2-base-multilingual` | Model rerank (không có trong file mẫu). |

### MCP server cho agent

Các biến này quyết định MCP server nào được gắn cho các lượt chạy của agent (worker). Chat dùng công cụ gốc của Claude Code; xem `LUCY_CHAT_MCP` bên dưới.

| Biến | Mặc định | Tác dụng |
|---|---|---|
| `LUCY_MCP` | tắt | Công tắc tổng. Không bật thì không gắn gì cả. |
| `LUCY_MCP_<ID>` | tuỳ server | Công tắc từng server. Server ở trạng thái *live* mặc định bật: `FS`, `WEB`, `GIT`, `MEMORY`, `GOOGLE`, `BINANCE`, `COINGECKO`. Server ở trạng thái *scaffold* mặc định tắt: `GITHUB`, `NOTION`, `TWELVEDATA`, `REGISTRY`. Server cần thông tin đăng nhập sẽ tắt cho tới khi có đủ. |
| `LUCY_MCP_GITHUB` | tắt | GitHub MCP (qua `npx @modelcontextprotocol/server-github`), chỉ cho persona code. Cần `GITHUB_TOKEN`. |
| `GITHUB_TOKEN` | — | Personal access token GitHub cho GitHub MCP. |
| `LUCY_MCP_TWELVEDATA` | tắt | Twelve Data MCP (cổ phiếu, ngoại hối, vàng), chỉ cho persona tài chính. Cần `TWELVEDATA_API_KEY`. |
| `TWELVEDATA_API_KEY` | — | API key Twelve Data. |
| `LUCY_MCP_GOOGLE` | bật | Công cụ Google chỉ đọc (tìm/đọc Gmail, Calendar, tìm Drive, YouTube). Cần `GOOGLE_REFRESH_TOKEN` và file OAuth client. |
| `GOOGLE_REFRESH_TOKEN` | — | Refresh token OAuth cho công cụ Google. |
| `GOOGLE_ACCESS_TOKEN` | — | Access token ban đầu, tuỳ chọn; sẽ được làm mới tự động. |

Không có trong file mẫu nhưng code có đọc:

| Biến | Mặc định | Tác dụng |
|---|---|---|
| `GCP_OAUTH_FILE` | `~/lucy/.gcp-oauth.json` | File OAuth client của Google (JSON loại desktop client). |
| `NOTION_TOKEN` | — | Token internal integration của Notion; bật bằng `LUCY_MCP_NOTION=on`. |
| `TWELVEDATA_MCP_URL` | `https://mcp.twelvedata.com/mcp` | Endpoint MCP của Twelve Data. |
| `COINGECKO_MCP_URL` | `https://mcp.api.coingecko.com/sse` | Endpoint MCP của CoinGecko (không cần key). |
| `BINANCE_REST_URL` | `https://api.binance.com` | Host REST công khai của Binance (không cần key). |
| `LLM_ENV_FILE` | `~/lucy/.env.llm` | Nơi agent-machine tìm file này. |

## `agent-machine/.env`: coordinator, worker, ngân sách

| Biến | Mặc định (code) | File mẫu | Tác dụng |
|---|---|---|---|
| `AM_TOKEN` ✅ | — | — | Secret dùng chung. Mọi endpoint của coordinator trừ `/health` đòi token này trong header `x-worker-token`; worker, autopilot, hub và bridge đều gửi kèm. Để trống thì coordinator chạy **không xác thực**. |
| `AM_PORT` | `8780` | `8780` | Port của coordinator. |
| `AM_DATA` | `agent-machine/.data` | `/root/.agent-machine` | Trạng thái bảng việc và sổ token. |
| `AM_CAP_USD` | `20` | `9999` | Trần chi tiêu cho mỗi cửa sổ ngân sách. |
| `AM_WEEKLY_CAP_USD` | `120` | `9999` | Trần chi tiêu theo tuần. |
| `AM_PER_CARD_USD` | `2` | `9999` | Giới hạn chi tiêu cho mỗi thẻ (gấp ba với thẻ được đánh dấu làm kỹ). |
| `AM_CARD_HARD_USD` | `8` | `9999` | Trần mỗi thẻ mà autopilot tôn trọng khi quyết định có cho thẻ chạy tiếp hay không. |
| `AM_MAX_LANES` | `3` | `1` | Số thẻ tối đa được làm cùng lúc. |
| `AM_WORKER_CONCURRENCY` | `1` | `1` | Số job một worker chạy song song. |
| `AM_LEASE_MS` | `1200000` (20 phút) | `3000000` | Worker giữ một job được bao lâu trước khi bị coi là bỏ rơi và đưa lại vào hàng đợi. |
| `LUCY_SESSION_SUMMARY` | tắt | `1` | Tóm tắt phiên: khi một phiên chat đóng (`/new` hoặc xoay vòng), bridge ghi một ghi chú tóm tắt vào `Brain/episodes/`. Phải bật ở cả bridge lẫn coordinator. |

::: tip File mẫu tắt ngân sách theo tiền
File mẫu đặt các trần tiền ở `9999`, coi như tắt, và dựa vào token guard theo ngày. Nếu bạn trả tiền theo token, hãy hạ các mức này xuống.
:::

Các biến khác của agent-machine:

| Biến | Mặc định | Tác dụng |
|---|---|---|
| `AM_HOST` | `127.0.0.1` | Địa chỉ coordinator lắng nghe. Giữ ở localhost. |
| `AM_CONFIG` | `agent-machine/config` | Persona, pipeline và catalog model. |
| `AM_WINDOW_MS` | 5 giờ | Độ dài cửa sổ ngân sách cho `AM_CAP_USD`. |
| `AM_SOFT_USD` | `14` | Ngưỡng cảnh báo mềm trong một cửa sổ. |
| `AM_MAX_STAGE_VISITS` | `3` | Một thẻ được quay lại cùng một bước bao nhiêu lần (vòng làm lại) trước khi hỏi bạn. |
| `AM_TICK_MS` | `800` | Nhịp lập lịch của coordinator. |
| `AM_DAY_TOKEN_SOFT` | `800000000` | Ngưỡng token mềm theo ngày: executor tụt xuống lane rẻ nhất và bạn được báo. |
| `AM_DAY_TOKEN_HARD` | `1500000000` | Ngưỡng token cứng theo ngày: không tạo thẻ mới; bridge chuyển sang lane rẻ. |
| `AM_RUNNER` | `mock` | Chế độ worker. `claude` = Claude cộng lane rẻ theo persona (ecosystem đặt sẵn), `lane` = chỉ lane rẻ, `mock` = không tốn token, chỉ để thử đường ống. |
| `AM_POLL_MS` | `800` | Nhịp hỏi việc của worker. |
| `AM_AUTOPILOT_MAX` | `100` (ecosystem: `50`) | Số quyết định tối đa của autopilot trong một lần chạy process. |
| `AM_AUTOPILOT_POLL_MS` | `6000` | Nhịp hỏi của autopilot. |
| `AM_DIRECTOR_MODEL` | `opus` | Model mà autopilot và bước phân loại dùng để quyết định. |
| `AM_SALVAGE_MODEL` | `sonnet` | Model suy ra kết quả của một bước khi agent quên trả về khối JSON theo quy ước. |
| `AM_RATELIMIT_PARK_MS` | 5 phút | Thời gian tạm gác một lane bị giới hạn tần suất khi provider không gửi `Retry-After`. |
| `AM_TURNS_LOG` | — | Thư mục ghi log JSONL theo từng lượt. Không đặt = không ghi. Cũng là nguồn cho `npm run stats:errors`. |
| `AM_SERVE_HOST`, `AM_SERVE_PORT`, `AM_SERVE_DIR` | `127.0.0.1`, `8090`, `.` | Cấu hình cho máy chủ tĩnh `noteflow-view`. |

## `bridge/.env`: bridge Telegram

| Biến | Mặc định | Tác dụng |
|---|---|---|
| `TELEGRAM_BOT_TOKEN` ✅ | — | Token bot từ @BotFather. Thiếu thì bridge không khởi động. Hub và cron dream cũng dùng để đẩy tin. |
| `LUCY_ALLOWED_USER_ID` ✅ | — | User ID Telegram dạng số của bạn. **Để trống thì bot trả lời mọi người.** Cũng là nơi nhận thông báo mặc định. |
| `CLAUDE_BIN` | `claude` | Đường dẫn Claude Code CLI. Dùng đường dẫn tuyệt đối (`which claude`), vì PM2 không truyền `PATH` của shell. |
| `LUCY_WORKDIR` | `~/lucy-workspace` | Thư mục làm việc của các phiên chat; ảnh và tài liệu tải về nằm ở đây. |
| `LUCY_PERSONA` | `~/lucy/bridge/persona.md` | Persona gắn vào system prompt của Claude. |
| `LUCY_CLAUDE_TIMEOUT` | `900` | Số giây trước khi bỏ một lượt Claude. Hub cũng dùng. |
| `RADIANT_BOT_API_URL`, `RADIANT_BOT_AGENT_SECRET` | — | Tích hợp tuỳ chọn với một dịch vụ bot Discord bên ngoài (tab "Aki" của hub). Để trống. |
| `LUCY_BRIEF_DISCORD_CHANNEL`, `LUCY_TECH_DISCORD_CHANNEL`, `LUCY_TECH_DISCORD_THREAD` | — | Code trong repo này không đọc. Để trống. |
| `LUCY_TG_PROXY` | — | Proxy chỉ cho lời gọi Telegram API, dành cho mạng chặn Telegram (ví dụ `socks5h://127.0.0.1:40000`). SOCKS cần `pip install requests[socks]`. |
| `LUCY_SESSION_SUMMARY` | tắt | Xem bảng agent-machine. |
| `ANTHROPIC_BASE_URL` | — | File mẫu: `http://127.0.0.1:47821` (pxpipe). Vì env dùng chung, dòng này đưa worker, autopilot và hub đi qua pxpipe. Chat của bridge luôn bỏ biến này và đi thẳng. Không chạy pxpipe thì xoá đi. |
| `AM_TOKEN` ✅ | — | Cùng giá trị với `agent-machine/.env`. Thiếu thì recall và báo token bị `401`. |

### Cờ hành vi của bridge

Tất cả tuỳ chọn. Sửa trong `bridge/.env` (hoặc `.env.runtime`) rồi tạo lại `lucy-bridge`.

| Biến | Mặc định | Tác dụng |
|---|---|---|
| `LUCY_BRIDGE_ENGINE` | `persist` | `persist` = mỗi chat một client Claude SDK sống (nhanh nhất). `sdk` = mỗi tin một lần gọi SDK, có resume phiên. `spawn` = chạy `claude -p` cho mỗi tin. Dùng làm các nấc lùi khi cần. |
| `LUCY_CHAT_MCP` | tắt | Nạp các MCP server toàn cục của Claude Code khi chat. Mặc định tắt vì nạp chúng làm mỗi câu trả lời chậm thêm vài giây. |
| `LUCY_SDK_IDLE_S` | `1800` | Đóng client đang rảnh sau số giây này để tiết kiệm RAM. |
| `LUCY_ROTATE_CTX_PCT` | `70` | Chuyển sang phiên mới khi ngữ cảnh dùng tới tỉ lệ này (`0` = tắt). |
| `LUCY_ROTATE_TURNS` | `120` | Chuyển phiên sau chừng này lượt dù thế nào. |
| `LUCY_ROTATE_CHECK_EVERY` | `5` | Cứ N lượt kiểm tra mức dùng ngữ cảnh một lần. |
| `LUCY_RECENT_MAX` | `6` | Số tin gần nhất giữ trong RAM để nối mạch khi xoay vòng. |
| `LUCY_STICKY_MAX` | `6` | Số câu đính chính và câu "nhớ giúp" luôn được mang qua xoay vòng. |
| `LUCY_REPLY_KEEP` | `900` | Số ký tự của câu trả lời gần nhất mang qua xoay vòng. |
| `LUCY_POLL_WATCHDOG_S` | `240` | Quá chừng này giây không poll Telegram thành công thì bridge tự thoát để PM2 dựng lại (`0` = tắt). |
| `LUCY_TOKEN_REPORT` | bật | Báo lượng token của chat về token guard chung. |
| `LUCY_TOOL_POLICY` | bật | Chèn một dòng gợi ý mỗi lượt về việc có nên dùng công cụ hay không (để Lucy không chạy tool khi bạn chỉ muốn hỏi ý kiến). |
| `LUCY_WRITE_GATE` | bật | Nhắc Lucy không lưu giả định, ví dụ hay lời người khác thành trí nhớ bền. |
| `LUCY_MEM_AUTHORITY`, `LUCY_GATE_ORDER`, `LUCY_CARRY_REPLY` | bật | Công tắc lùi cho các hành vi xử lý ngữ cảnh (trí nhớ là bằng chứng chứ không phải mệnh lệnh, thứ tự các cổng lọc, mang câu trả lời gần nhất qua xoay vòng). |
| `LUCY_BUDGET_PERSONA` | `24000` | Trần ký tự cho persona cộng lớp phủ trong system prompt. |
| `LUCY_BUDGET_SEED` | `4000` | Trần ký tự cho bản tóm tắt phiên trước khi gieo vào phiên mới. |
| `LUCY_AUTO_COMPRESS` | tắt | Cơ chế tự cuộn phiên kiểu cũ cho đường spawn (tóm tắt rồi mở phiên mới sau `LUCY_COMPRESS_TURN_MAX` lượt hoặc một ngưỡng token). |
| `LUCY_COMPRESS_TURN_MAX`, `LUCY_COMPRESS_TOKEN_MAX`, `LUCY_COMPRESS_HEADROOM` | `40`, `0` (tự động), `25000` | Các ngưỡng cho `LUCY_AUTO_COMPRESS`. |
| `LUCY_FLUSH_BEFORE_COMPRESS` | tắt | Trước khi bỏ phiên cũ, cho Claude một lượt để tự lưu trí nhớ bền. |
| `LUCY_CLAUDE_HIST_MAX`, `LUCY_LANE_HIST_MAX` | `80`, `60` | Số tin giữ trong các bộ đệm hội thoại cục bộ. |
| `LUCY_PERSONA_DIR` | `~/lucy/agent-machine/config/personas` | Các lớp persona mà `/persona` cho chọn. |
| `LUCY_CATALOG_FILE` | `~/lucy/agent-machine/config/model-catalog.json` | Catalog model dùng khi coordinator không chạy. |
| `LUCY_MODEL_CATALOG` | `~/lucy/.state/model-catalog.json` | Ghi chú tuỳ chọn về các model ID hiện hành, gắn thêm vào persona. |
| `LUCY_STATUS_FILE` | `~/.lucy-bridge-status.json` | File trạng thái mà `bridge/tg_diag.py` đọc. |
| `LUCY_TG_TOKENS_FILE`, `LUCY_CLAUDE_HIST_FILE` | `~/.lucy-bridge-tokens.json`, `~/.lucy-claude-history.json` | Các file trạng thái cục bộ. |

## `.env.runtime`: biến chạy dùng chung

| Biến | Mặc định (code) | File mẫu | Tác dụng |
|---|---|---|---|
| `LUCY_HUB_PASSWORD` ✅ | — | — | Mật khẩu đăng nhập hub. Không có mật khẩu thì mọi lượt đăng nhập đều bị từ chối. |
| `LUCY_HUB_HOST` | `0.0.0.0` | `127.0.0.1` | Địa chỉ hub lắng nghe. Giữ `127.0.0.1` khi đứng sau nginx. |
| `LUCY_HUB_PORT` | `8800` | `8800` | Port của hub. |
| `LUCY_VAULT` ✅ | `~/lucy/lucy-vault` | `/root/lucy/lucy-vault` | Vault trí nhớ. Coordinator không tìm thấy thì mọi tính năng trí nhớ đều tắt. |
| `LUCY_STATE` | `~/.lucy-hub` | `/root/.lucy-hub` | Trạng thái hub: secret 2FA, lịch chạy, nhật ký sự kiện, lịch sử chat. |
| `LUCY_PROJECTS_ROOT` | `LUCY_WORKDIR` | `/root/lucy` | Gốc của tab cây thư mục trong hub; `integrations.json` được đọc ở đây. |
| `AM_COORD_URL` | `http://127.0.0.1:8780` | như trên | Địa chỉ mà bridge, worker, autopilot và hub dùng để gọi coordinator. |
| `AM_TURNS_LOG` | — | `/root/lucy/agent-machine/.turns` | Xem ở trên. |
| `LUCY_TZ_OFFSET` | `7` | `7` | Múi giờ của bạn, tính bằng số giờ lệch UTC. Dùng cho lịch chạy của hub và các bộ đếm theo ngày. |
| `LUCY_PERSONA_CHAT` | tắt | `1` | Bật chat nhiều lượt với các persona chuyên gia qua lane rẻ ("Experts" trong hub). |
| `LUCY_PROMPT_ARCHITECT` | tắt | `1` | Bật Prompt Architect (`/prompt` trên Telegram, tab trong hub). |
| `LUCY_SKILL_LEARN` | tắt | `1` | Cho Lucy đề xuất skill mới từ những việc lặp lại (bản nháp nằm ở `skills/_proposed/`). |
| `CLAUDE_EFFORT` | — | `high` | Code của Lucy không đọc; chỉ được truyền xuống các process con. |
| `IS_SANDBOX` | — | `1` | Báo cho Claude Code biết nó đang chạy trong sandbox, để cho phép `bypassPermissions` khi chạy bằng root. Lucy cũng tự đặt biến này cho mọi process Claude con. |

Không có trong file mẫu nhưng nên đặt ở đây:

| Biến | Mặc định | Tác dụng |
|---|---|---|
| `ANTHROPIC_API_KEY` | — | Dùng API key thay cho gói Claude Code đã đăng nhập. |
| `LUCY_PUSH_CHAT_ID` | `LUCY_ALLOWED_USER_ID` | Chat Telegram nhận kết quả các lịch chạy của hub. |
| `LUCY_INTEGRATIONS_FILE` | `<LUCY_PROJECTS_ROOT>/integrations.json` | Các nút tích hợp hiện trên dashboard của hub. |
| `LUCY_REPO` | `~/lucy` | Gốc repository, dùng cho các bảng trạng thái build trong hub. |
| `LUCY_STATE_DIR` | `~/.lucy` | Trạng thái hạn mức và giới hạn tần suất của provider. |
| `LUCY_SKILLS` | `<repo>/skills` | Vị trí thư viện skill. |

## Trí nhớ và recall {#memory-recall}

Có thể đặt trong `.env.runtime`. Các biến này ảnh hưởng tới coordinator (đánh chỉ mục, tìm kiếm) và tới bridge, hub (những gì được chèn vào mỗi lượt).

| Biến | Mặc định | Tác dụng |
|---|---|---|
| `LUCY_INDEX_DIRS` | xem mô tả | Danh sách thư mục vault được đánh chỉ mục, cách nhau bằng dấu phẩy. **Thay hẳn** danh sách mặc định: `Context, Projects, Skills, Daily, Knowledge, Reference, Reports, Brain/decisions, Brain/entities, Brain/claude-memory, Brain/episodes, Brain/proposals`. |
| `LUCY_RECALL_PREFETCH` | bật | Tìm trong vault trước mỗi lượt chat. |
| `LUCY_RECALL_GATE2` | bật | Bỏ qua recall với câu sửa lời và câu nối tiếp thuần đại từ. |
| `LUCY_RECALL_MAX` | `8` (bridge), `5` (hub) | Số hit xin từ coordinator. |
| `LUCY_RECALL_HITS` | `5` | Số hit chèn vào prompt. |
| `LUCY_RECALL_BUDGET` | `800` | Ngân sách ký tự cho khối trí nhớ được chèn. |
| `LUCY_RECALL_SNIPPET` | `200` | Số ký tự mỗi hit. |
| `LUCY_RECALL_TIMEOUT` | `4` | Số giây chờ recall trước khi trả lời mà không có nó. |
| `LUCY_RECALL_MIN_SCORE` | `0.35` | Điểm rerank tối thiểu để một hit được dùng. Chỉ áp cho hit đã rerank; hit khác lọc theo trùng từ khoá. |
| `LUCY_RECALL_PROVENANCE` | bật | Gắn tên file và tuổi cho mỗi hit. |
| `LUCY_RECALL_FAILLOUD` | bật | Ghi log rõ ràng khi recall lỗi. |
| `LUCY_VECTOR` | bật nếu có `JINA_API_KEY` | Đặt `0` để chỉ dùng tìm toàn văn. |
| `LUCY_RERANK` | tắt | Rerank hit bằng Jina (cần `JINA_API_KEY`). Bắt buộc nếu muốn lọc theo điểm. |
| `LUCY_VECTOR_MAX_DIST` | `0.9` | Khoảng cách vector tối đa của một hit vector. |
| `LUCY_EMBED_TIMEOUT_MS`, `LUCY_RERANK_TIMEOUT_MS` | `20000`, `15000` | Thời gian chờ khi gọi Jina. |
| `LUCY_EMBED_THROTTLE_MS` | `1200` | Khoảng nghỉ giữa các lô embedding. |
| `LUCY_EPISODIC` | bật | Ghi các lượt hội thoại để nhớ xuyên phiên. |
| `LUCY_EPISODIC_RETENTION_DAYS` | `90` | Lượt hội thoại cũ hơn số ngày này bị dọn. |
| `LUCY_CONSOLIDATE` | tắt | Chạy gộp sự thật (khử trùng lặp, thay thế bản cũ) trong job dream. Cần tìm kiếm vector. Cron dream tự bật. |
| `LUCY_CONSOLIDATE_APPLY` | tắt | Áp dụng thật kết quả gộp; nếu tắt thì chỉ ghi báo cáo. Cron dream tự bật. |
| `LUCY_CONSOLIDATE_SIM`, `LUCY_CONSOLIDATE_CLUSTER_SIM`, `LUCY_CONSOLIDATE_REFLECT_TRUST` | `0.86`, `0.78`, `5` | Các ngưỡng của bước gộp. |
| `LUCY_BRAIN_DREAM` | bật | Gộp "bộ não nghề" riêng của từng persona trong job dream (`0` = tắt). |
| `LUCY_DISTILL` | bật | Chắt tín hiệu từ các lượt chạy của agent vào `Brain/inbox` (`0` = tắt). |
| `LUCY_DISTILL_MODEL` | `haiku` | Model cho bước chắt lọc và dream của từng persona. |
| `LUCY_AUX` | bật | Cho bước chắt lọc dùng một lane phụ rẻ (`0` = luôn dùng Claude). |

## Agent, model và công cụ

| Biến | Mặc định | Tác dụng |
|---|---|---|
| `LUCY_ROUTER_MODEL` | `or-nemotron-super` | Lane model dùng để định tuyến tin nhắn ở chế độ `auto`. Phải là một key có trong catalog model. |
| `LUCY_PROMPT_ARCHITECT_MODEL` | `ds-chat` | Lane cho Prompt Architect. |
| `LUCY_PROMPT_ARCHITECT_ESCALATE_MODEL` | `opus` | Model dùng khi bạn đẩy một prompt lên mức cao hơn. |
| `LUCY_TOOL_REGISTRY` | tắt | Dùng tool registry hợp nhất cho công cụ của lane (thử nghiệm). |
| `LUCY_JINA_READER` | tắt | Dùng Jina Reader/Search cho công cụ web thay vì DuckDuckGo không cần key. |
| `LUCY_HOOKS` | tắt | Gắn một lớp chặn trước khi chạy công cụ cho agent: chặn lệnh shell nguy hiểm và ghi log việc dùng công cụ. Nên bật. |
| `LUCY_HOOKS_LOG` | `AM_TURNS_LOG` | Nơi lớp chặn ghi log. |

## pxpipe

Đặt sẵn trong `ecosystem.config.cjs` cho `lucy-pxpipe`:

| Biến | Giá trị | Tác dụng |
|---|---|---|
| `HOST` | `127.0.0.1` | Địa chỉ lắng nghe. Giữ ở localhost: dashboard của nó không có đăng nhập. |
| `PORT` | `47821` | Port mà `ANTHROPIC_BASE_URL` trỏ tới. |
| `PXPIPE_MODELS` | danh sách model ID | Chỉ request tới các model này mới bị nén. |

## `.env` riêng của hub (tuỳ chọn)

Hub còn nạp `hub/server/.env` qua `dotenv`, dùng khi chạy hub ngoài PM2 (xem `hub/deploy.sh`). Giá trị trong môi trường PM2 được ưu tiên. Với `ecosystem.config.cjs` ở thư mục gốc thì bạn không cần file này.

## Các file khác

| File | Mục đích |
|---|---|
| `.env.example` (gốc repo) | `TAVILY_API_KEY`, chỉ `tools/tavily_search.py` dùng. |
| `agent-machine/config/personas/*.json` | Persona của agent (vai trò, model, `laneModel` tuỳ chọn, công cụ được phép). |
| `agent-machine/config/pipelines/*.json` | Pipeline của bảng việc (các bước và cổng duyệt). |
| `agent-machine/config/model-catalog.json` | Catalog model của lane rẻ (`npm run gen:catalog`). |
| `bridge/persona.md` | Persona khi chat. |
| `~/.claude/settings.json` | Cấu hình Claude Code; đặt `autoMemoryDirectory` trỏ vào vault (xem [Cài đặt](./installation#claude-code)). |
