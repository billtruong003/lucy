# Model và chi phí

Lucy dùng hai loại model:

- **Claude**, "bộ não thật". Claude chạy qua Claude Code (Agent SDK hoặc CLI `claude`), có tool, vault trí nhớ và persona Lucy. Claude lo phần chat và các agent trên board.
- **Lane**: model rẻ hoặc miễn phí từ các provider tương thích OpenAI (Groq, Gemini, OpenRouter…). Lucy dùng lane cho chat nhẹ, định tuyến, việc vặt chạy nền, và làm phương án dự phòng khi Claude hết quota.

Tất cả được khai báo ở một file duy nhất, `agent-machine/src/llm-lane.ts`. Một bản JSON sinh tự động (`agent-machine/config/model-catalog.json`) giúp bridge Telegram vẫn liệt kê được model khi coordinator offline.

## Model Claude

Catalog hiện tại (`CLAUDE_CHAT_MODELS`):

| Key | Model ID | Tầng | Ghi chú |
|---|---|---|---|
| `claude:opus` | `claude-opus-5-5` | sâu 🧠 | Mạnh nhất. Được đánh dấu `default: true` trong catalog. |
| `claude:sonnet` | `claude-sonnet-5-5` | cân bằng ✦ | Nhanh, cân bằng. Chat thực tế khởi động bằng model này. |
| `claude:fable` | `claude-fable-5-1` | sâu 🧠 | Thế hệ 5. |
| `claude:haiku` | `claude-haiku-5-5` | nhanh ⚡ | Nhẹ, rẻ, cho việc đơn giản. |

::: tip Model mặc định là cái nào?
Catalog đánh dấu Opus 5.5 là `default: true`, nhưng hiện chưa giao diện chat nào đọc cờ này. Chat Telegram mới và chat hub mới đều chạy **`claude:sonnet`** (Sonnet 5.5) cho tới khi bạn chọn model khác. `/fan`, `/auto` và `/orch` cũng dùng Sonnet, trừ khi mục tiêu mở đầu bằng `opus`.
:::

Mọi lệnh gọi Claude đi qua một bộ phân giải chung: `sonnet`, `opus`, `fable`, `haiku` (hoặc `claude:<tên>`) được đổi thành model ID ở bảng trên. Chuỗi nào khác được chuyển nguyên cho Claude.

### Đổi model Claude

| Ở đâu | Cách làm |
|---|---|
| Telegram | `/model` hiện nút bấm; hoặc gõ `/model opus`, `/model claude:haiku`… Thêm `!o ` trước một tin để dùng Opus cho riêng tin đó. Xem [Telegram](./telegram#chon-model). |
| Web hub | Bộ chọn model ở thanh nhập chat có nhóm **Claude · có tool + vault**, mục **Auto** và nhóm **Lane · chat thuần**. Xem [Web hub](./web-hub). |

Trên Telegram, đổi qua lại giữa các model Claude vẫn giữ nguyên hội thoại, vì phiên đang sống được đổi model tại chỗ. Ở server chat của hub, chọn model Claude nào thì chạy đúng model đó: `claude:opus`, `claude:sonnet`, `claude:fable` và `claude:haiku` lần lượt ứng với ID trong catalog `claude-opus-5-5`, `claude-sonnet-5-5`, `claude-fable-5-1` và `claude-haiku-5-5`.

## Lane: provider giá rẻ và miễn phí

Lane gọi thẳng endpoint `/chat/completions` (chuẩn OpenAI) của từng provider bằng `fetch` của Node, không dính gì tới Claude Code. Lane được dùng cho:

- chat Telegram hoặc hub khi bạn chọn model lane, hoặc khi **Auto** định tuyến sang đó
- router quyết định "Claude hay lane?"
- executor của card trên board khi token guard ở mức soft
- việc nhỏ như Prompt Architect (`ds-chat`) và tóm tắt phiên
- não dự phòng khi Claude hết quota

### Các provider

API key đặt trong `.env.llm` ở gốc repo (hoặc file chỉ định bằng `LLM_ENV_FILE`). Giá trị trong file này đè lên biến môi trường của tiến trình.

| Provider | Biến môi trường | Model trong catalog | Free trong catalog? |
|---|---|---|---|
| OpenRouter | `OPENROUTER_API_KEY` | `or-nemotron-super`, `or-gptoss-120b` (free); `ds-v4-flash`, `ds-v4-pro`, `ds-chat` (trả phí); cộng các model free tự phát hiện | lẫn lộn |
| Groq | `GROQ_API_KEY` | `groq-gptoss-120b`, `groq-llama-70b` | có |
| Gemini | `GEMINI_API_KEY` | `gemini-flash` (Gemini 3 Flash) | có |
| Cerebras | `CEREBRAS_API_KEY` | `cerebras-glm-47`, `cerebras-gptoss` (giới hạn context 8K) | có |
| Mistral | `MISTRAL_API_KEY` | `devstral-med`, `codestral`, `mistral-large` | có |
| OpenCode Zen | `OPENCODE_ZEN_API_KEY` | `ds-v4-flash-free`, `mimo-v2.5-free` (free); `minimax-m3-free` (hết khuyến mãi free, đừng route) | phần lớn |
| Nous Portal | `NOUS_API_KEY` | Aggregator, trừ vào credit Nous: `nous-opus`, `nous-opus-fast`, `nous-sonnet`, `nous-fable`, `nous-haiku`, `nous-nemotron-ultra`, `nous-hermes-405b`, `nous-ds-v4-pro`, `nous-qwen3-coder`, `nous-gpt-oss-120b`; riêng `nous-nemotron-free` miễn phí | phần lớn trả phí |
| Z.ai | `ZAI_API_KEY` | Có khai báo provider, chưa có model nào trong catalog | — |

"Free" là cờ `free` của từng model trong catalog: model miễn phí hoặc nằm trong gói free của provider, không có nghĩa là dùng vô hạn. Bạn chỉ cần key cho provider mình định dùng; provider nào thiếu key thì Lucy bỏ qua.

**Nhiều key cho một provider.** Thêm `GEMINI_API_KEY_2` … `_8`, hoặc ghi danh sách cách nhau bằng dấu phẩy trong biến chính. Key nào bị `429` sẽ nghỉ theo `Retry-After` (mặc định 5 phút) và Lucy thử key kế tiếp. Key trả `401`/`403` bị cho nghỉ 30 phút.

**OpenRouter tự phát hiện model.** Khi coordinator khởi động, nó tải danh sách model của OpenRouter và thêm mọi model free, không phải của Anthropic, mà Lucy chưa biết, dưới key `or-disc-…`. Model hỗ trợ tool nhận role `executor`, còn lại nhận `content`.

### Role, chuỗi dự phòng và bảng route

Mỗi model trong catalog có một **role** (`executor`, `reasoning`, `fast`, `content`). Lệnh gọi lỗi hoặc trả rỗng thì Lucy thử tiếp phần còn lại của **chuỗi dự phòng** theo role:

| Role | Chuỗi dự phòng |
|---|---|
| executor | `mimo-v2.5-free` → `ds-v4-flash-free` → `or-nemotron-super` → `devstral-med` → `or-gptoss-120b` → `ds-v4-flash` → `codestral` |
| reasoning | `ds-v4-pro` → `ds-v4-flash` → `groq-gptoss-120b` |
| fast | `groq-gptoss-120b` → `cerebras-glm-47` → `groq-llama-70b` |
| content | `gemini-flash` → `mistral-large` → `groq-gptoss-120b` |

Chế độ **Auto** dùng một bảng riêng, `ROUTE_TABLE` (trong `agent-machine/src/chat-lane.ts`). Một model router đọc tin nhắn rồi trả về role kèm `needsTools`. Nếu `needsTools` là true, tin đi Claude; nếu không, Lucy chọn model trong danh sách của role đó, và khi đã đủ dữ liệu thì ưu tiên model có kết quả tốt trong quá khứ.

| Role route | Model (theo thứ tự ưu tiên) |
|---|---|
| router | `or-nemotron-super`, `ds-v4-flash-free`, `groq-gptoss-120b`, `gemini-flash` |
| agentic-code | `devstral-med`, `or-nemotron-super`, `ds-v4-flash-free`, `codestral` |
| reasoning | `ds-v4-flash-free`, `or-nemotron-super`, `groq-gptoss-120b` |
| long-context | `or-nemotron-super`, `ds-v4-flash-free` |
| tool-calling | `gemini-flash`, `or-nemotron-super`, `groq-gptoss-120b` |
| fast-classify | `cerebras-glm-47`, `groq-llama-70b`, `groq-gptoss-120b` |
| content | `gemini-flash`, `mistral-large` |

Model router mặc định là `or-nemotron-super`; đổi bằng `LUCY_ROUTER_MODEL=<key>`. Router lỗi hoặc không đủ tự tin thì tin đi Claude.

### Rate limit giữa các tiến trình

Khi bất kỳ tiến trình nào của Lucy nhận `429` từ một provider, nó ghi provider đó vào `~/.lucy/rate-guard.json` (hoặc dưới `LUCY_STATE_DIR`) cho tới hết thời gian chờ. Mọi tiến trình khác kiểm tra file này trước và né provider đó, thay vì dồn thêm request vào. Nếu cả chuỗi đều bị rate limit, lệnh gọi được hoãn lại (back-off) chứ không báo lỗi. Lucy cũng ghi các header `x-ratelimit-*` và header credit vào `quota.json`. Coordinator trả cả hai qua `GET /llm/guard`.

### Claude hết quota: tụt xuống lane

Nếu Claude báo chạm giới hạn usage, rate hay quota, hoặc token guard chạm mức cứng, chat Telegram chuyển sang lane tốt nhất còn key và hiện banner `⚠️ Claude hết token…`. Thứ tự chọn và chi tiết xem ở [Telegram](./telegram#khi-claude-het-quota).

## Thêm provider hoặc model

Mọi thứ nằm trong `agent-machine/src/llm-lane.ts`.

1. **Provider mới** (phải hỗ trợ định dạng `/chat/completions` của OpenAI): thêm ID vào type `ProviderId` và một mục vào `PROVIDERS`:

   ```ts
   'myprov': { id: 'myprov', baseUrl: 'https://api.example.com/v1', envKey: 'MYPROV_API_KEY', label: 'My Provider' },
   ```

2. **Model lane mới**: thêm một dòng vào `MODEL_CATALOG`:

   ```ts
   { key: 'myprov-fast', label: 'Example Fast', provider: 'myprov', model: 'example-fast-1', role: 'fast', free: true, note: 'mạnh về việc gì' },
   ```

   Muốn model được dùng tự động thì thêm key vào `FALLBACKS` (cùng file) hoặc `ROUTE_TABLE` (trong `chat-lane.ts`).

3. **Model Claude mới**: thêm một dòng vào `CLAUDE_CHAT_MODELS`. Nút bấm trên Telegram và bộ chọn của hub tự hiện model mới:

   ```ts
   { key: 'claude:newmodel', label: 'Claude New', model: 'claude-newmodel-1', tier: 'balanced', note: '…' },
   ```

   Sau đó đổi sang bằng `/model claude:newmodel`. Chỉ `sonnet`, `opus`, `fable`, `haiku` có tên gọi tắt.

4. Điền API key vào `.env.llm`, rồi sinh lại catalog và restart:

   ```bash
   cd agent-machine
   npm run gen:catalog        # kiểm tra key, ghi config/model-catalog.json
   pm2 restart lucy-coordinator lucy-bridge lucy-hub
   ```

`gen:catalog` sẽ từ chối ghi file nếu `FALLBACKS` hoặc `ROUTE_TABLE` nhắc tới key không có trong `MODEL_CATALOG`. Đừng sửa tay `model-catalog.json`.

## Đếm token và chi phí

Lệnh gọi model từ mọi phần của Lucy đều được báo về sổ cái (ledger) của coordinator qua `POST /spend`, kèm nguồn (`bridge`, `lane`, `hub`, `worker`, `cron`…), model, token vào, token ra, token cache đọc và cache ghi. Coordinator quy ra USD ở một chỗ duy nhất (`agent-machine/src/pricing.ts`):

| Dòng model | Vào | Ra | Cache đọc | Cache ghi |
|---|---|---|---|---|
| Fable | $10 | $50 | $1.00 | $12.50 |
| Opus | $5 | $25 | $0.50 | $6.25 |
| Sonnet | $3 | $15 | $0.30 | $3.75 |
| Haiku | $1 | $5 | $0.10 | $1.25 |

Giá tính bằng USD trên một triệu token. Đây là bảng dự phòng viết cứng trong code, khớp theo tên dòng model. Model lane lấy giá từ danh sách model công khai của OpenRouter, làm mới tối đa mỗi giờ một lần; model không rõ giá tính là $0. Nếu bạn dùng gói Claude subscription, con số USD này chỉ là ước tính quy đổi theo giá API, không phải số tiền bị trừ thật.

Trên Telegram, `/token` cho xem lượng dùng Telegram hôm nay (theo ngày UTC) và token guard chung. Trang tổng quan của hub đọc cùng sổ cái này.

## Token guard

Token guard là ngân sách token theo ngày, dùng chung cho hub, Telegram, worker và autopilot. "Đã dùng" là tổng token vào, token cache và token ra trong sổ cái hôm nay. Ngày mới bắt đầu lúc nửa đêm theo giờ UTC+`LUCY_TZ_OFFSET` (mặc định `7`).

| Mức | Biến (`agent-machine/.env`) | Mặc định | Khi chạm mức |
|---|---|---|---|
| Soft | `AM_DAY_TOKEN_SOFT` | 800.000.000 | Card **executor** trên board bị hạ xuống model lane rẻ nhất còn dùng được. Reviewer, architect và card chỉ định rõ Opus/Sonnet vẫn chạy Claude. |
| Hard | `AM_DAY_TOKEN_HARD` | 1.500.000.000 | Board ngừng nhận việc cho card mới và hỏi bạn nâng giới hạn hay đợi sang ngày. Telegram bỏ qua Claude và trả lời bằng lane dự phòng. |

Mặc định để cao là có chủ đích: token cache đọc cũng được tính, và một ngày chat cộng build bận rộn dễ đốt hàng chục triệu token. Tự đặt mức của bạn rồi restart coordinator:

```ini
# agent-machine/.env
AM_DAY_TOKEN_SOFT=50000000
AM_DAY_TOKEN_HARD=100000000
```

## pxpipe: proxy nén token

[pxpipe](https://github.com/teamchong/pxpipe) (gói npm `pxpipe-proxy`) là một proxy chạy cục bộ, tùy chọn. Nó đứng giữa Claude Code và Anthropic, vẽ phần cồng kềnh của mỗi request (system prompt, tài liệu tool, lịch sử cũ) thành ảnh gọn. Ảnh tốn ít token đầu vào hơn chính đoạn chữ đó. Các lượt gần đây vẫn giữ dạng chữ, và câu trả lời của model không bị đụng tới.

Trong Lucy, pxpipe chạy thành app PM2 `lucy-pxpipe` tại `127.0.0.1:47821`:

```js
// ecosystem.config.cjs
PXPIPE_MODELS: 'claude-fable-5,claude-fable-5-1,claude-sonnet-5,claude-sonnet-5-5,gpt-5.6'
```

Chỉ request tới các model trong `PXPIPE_MODELS` mới bị nén; mọi model khác, kể cả Opus, đi qua nguyên vẹn từng byte. Đặt `PXPIPE_MODELS=off` để tắt hẳn phần vẽ ảnh.

**Tiến trình nào dùng pxpipe.** Mọi tiến trình có biến môi trường `ANTHROPIC_BASE_URL=http://127.0.0.1:47821`. `ecosystem.config.cjs` gộp `bridge/.env` vào môi trường của mọi tiến trình, và file `bridge/.env` mẫu có đặt biến này. Vì vậy coordinator, worker, autopilot và hub đều gửi traffic Claude qua pxpipe. `pxpipe/setup-pxpipe-lucy.sh` và `source pxpipe/on.sh` gắn pxpipe vào các tiến trình đang chạy rồi kiểm tra từng cái.

**Chat Telegram đi vòng qua pxpipe.** Bridge xoá `ANTHROPIC_BASE_URL` trước mọi lệnh gọi Claude (chat, `/fan`, `/orch`, `/auto`) và nói chuyện thẳng với Anthropic. Có hai lý do:

- Khi nén, persona Lucy nối vào system prompt bị vẽ thành ảnh và model đánh rơi nó. Lucy bắt đầu tự nhận "Mình là Claude" thay vì giữ vai.
- Lượt chat vốn ngắn và đã có prompt cache, nên tiết kiệm chẳng bao nhiêu, trong khi pxpipe có thể sai ở chi tiết cần chính xác từng ký tự như ID hay hash.

pxpipe chỉ thật sự đáng dùng cho các việc nền khối lượng lớn, không cần persona.

::: warning
- Chạy `npm install` trong `pxpipe/` trước khi khởi động `lucy-pxpipe`. Nếu không, file chạy không tồn tại và PM2 sẽ restart nó liên tục.
- Đừng tắt ngang pxpipe khi các tiến trình vẫn trỏ `ANTHROPIC_BASE_URL` vào nó, vì mọi lệnh gọi Claude của chúng sẽ lỗi. Gỡ biến đó trước (hoặc đặt `PXPIPE_MODELS=off`), rồi restart các tiến trình liên quan.
- Dashboard ở `http://127.0.0.1:47821/` không có đăng nhập. Chỉ để nó nghe trên localhost và truy cập qua SSH tunnel: `ssh -L 47821:127.0.0.1:47821 <user>@<server-của-bạn>`.
:::

## Xác thực với Anthropic

Code của Lucy không tự gọi Anthropic API. Mọi lệnh gọi Claude đều đi qua Claude Code (CLI `claude`, hoặc Claude Agent SDK vốn chạy CLI bên dưới), nên Lucy dùng đúng thông tin đăng nhập mà Claude Code có trên server:

| Cách | Làm thế nào | Tính tiền |
|---|---|---|
| **Gói Claude subscription** | Chạy `claude login` một lần trên server, bằng đúng user chạy PM2. Thông tin đăng nhập lưu trong `~/.claude`. | Trừ vào hạn mức usage của gói Claude. Chạm hạn mức thì Lucy tụt xuống lane. |
| **API key** | Đặt `ANTHROPIC_API_KEY=<key-của-bạn>` vào một trong các file env (vd `.env.runtime`). Tiến trình không kế thừa môi trường của shell (`filter_env`), nên bắt buộc phải nằm trong file. Sau đó restart. | Trả theo token dùng thực tế, tính vào tài khoản Anthropic Console. |

Đăng nhập bằng subscription là để **chính bạn dùng** Lucy của mình. Nếu người khác cũng dùng instance của bạn, hoặc bạn chạy nó như một dịch vụ, hãy dùng API key và đọc điều khoản hiện hành của Anthropic. Kiểm tra cả hai cách bằng `claude -p "hi" --output-format json`.

Liên quan: [Telegram](./telegram) · [Agent](./agents) · [Cấu hình](./configuration) · [Vận hành](./operations)
