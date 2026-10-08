# Giới thiệu

Lucy là trợ lý AI cá nhân tự host. Lucy chạy trên máy chủ Linux của chính bạn, nói chuyện với bạn qua Telegram và một trang web điều khiển (web hub), lưu trí nhớ dài hạn bằng file Markdown thuần, và giao những việc lớn cho một bảng việc gồm nhiều agent chuyên môn. Phần "suy nghĩ" do Claude đảm nhận, thông qua Claude Code CLI và Claude Agent SDK.

Lucy được làm cho đúng một chủ. Mọi lối vào đều khoá về bạn: bot Telegram chỉ trả lời user ID của bạn, còn web hub có mật khẩu và xác thực hai lớp tuỳ chọn.

## Lucy làm được gì

| Mảng | Bạn có gì |
|---|---|
| **Chat** | Nhắn Lucy qua Telegram hoặc web hub. Câu trả lời hiện dần theo thời gian thực. Nhắn tin mới giữa chừng để đổi hướng, hoặc `/stop` để cắt ngang. Gửi ảnh và tài liệu (PDF, DOCX, XLSX, CSV…), Lucy tự mở bằng công cụ của mình. |
| **Trí nhớ** | Một vault Markdown (mở được bằng Obsidian) là bộ não của Lucy. Trước mỗi lượt, Lucy tìm các ghi chú liên quan (tìm kiếm toàn văn, thêm tìm kiếm vector và rerank qua Jina nếu bật). Các lượt hội thoại được ghi lại để nhớ xuyên phiên, và mỗi đêm một job "dream" gộp tín hiệu mới thành sở thích ổn định. |
| **Agent & bảng việc** | Việc lớn trở thành *thẻ* trên một bảng kiểu Kanban. Coordinator đẩy thẻ qua từng bước của một pipeline (ví dụ kỹ thuật, nghiên cứu, viết blog) và giao mỗi bước cho một persona (engineer, reviewer, researcher, writer…). Process worker chạy các bước; autopilot (tuỳ chọn) tự duyệt các cổng thường lệ thay bạn. |
| **Công cụ, skill & MCP** | Khi chat, Lucy dùng công cụ gốc của Claude Code (đọc/ghi file, shell, web). Agent có thể gắn MCP server: filesystem, web, git chỉ đọc, trí nhớ, và khi có thông tin đăng nhập thì GitHub, Google (Gmail/Calendar/Drive/YouTube, chỉ đọc), Notion và dữ liệu thị trường. Thư viện Agent Skills nằm trong `skills/`. |
| **Tự động hoá** | Prompt chạy theo lịch từ hub (kết quả có thể đẩy về Telegram), job dream ban đêm qua cron, autopilot cho bảng việc, và token guard để hãm chi tiêu. |
| **Lane model rẻ** | Ngoài Claude, Lucy có thể chuyển việc sang các provider tương thích OpenAI (OpenRouter, Groq, Gemini, Cerebras, Mistral, Z.ai, Nous, OpenCode Zen). Persona có thể gắn cố định với một model "lane" rẻ, và token guard tự hạ executor xuống lane rẻ khi chạm ngưỡng mềm trong ngày. |

## Kiến trúc

Mọi process được khai báo trong `ecosystem.config.cjs` và chạy bằng PM2. Process nào cũng chỉ nghe `127.0.0.1`; ra internet chỉ qua nginx.

```text
                    ┌──────────────────────────── máy chủ của bạn ───────────────────────────┐
                    │                                                                        │
 Telegram ──────────┼─► lucy-bridge (Python) ── Claude Agent SDK ──► Anthropic API           │
 (bạn)              │       │   mỗi chat một phiên Claude sống       (đi thẳng, không proxy) │
                    │       │                                                                │
                    │       ├──► lucy-coordinator :8780 ◄──── lucy-vps-worker ──► Claude /    │
                    │       │      chỉ mục recall, bảng  ◄──── lucy-autopilot     lane rẻ     │
                    │       │      việc, token guard, persona       │                         │
                    │       │             │                         ▼                         │
                    │       │             ▼                  lucy-pxpipe :47821 ──► Anthropic │
                    │       └──────► lucy-vault/  (trí nhớ Markdown, repo git riêng)          │
                    │                     ▲                                                  │
 Trình duyệt ─ nginx┼─► lucy-hub :8800 ───┘  (web: chat, bảng việc, bộ não, lịch chạy)       │
   (HTTPS)          │                                                                        │
                    │  cron 02:00 ─► bridge/cron_dream.sh (gộp trí nhớ + reindex)           │
                    └────────────────────────────────────────────────────────────────────────┘
```

### Một tin nhắn Telegram đi qua những đâu

1. **Nhận.** `lucy-bridge` long-poll Telegram (`getUpdates`). Tin từ bất kỳ ai không phải `LUCY_ALLOWED_USER_ID` đều bị bỏ. `/stop` và `/restart` được xử lý ngay; còn lại vào hàng đợi riêng của từng chat.
2. **Gợi nhớ.** Song song, bridge hỏi endpoint `/recall` của coordinator để lấy ghi chú liên quan trong vault. Một bộ lọc rẻ bỏ qua bước này với câu sửa lời hoặc câu nối tiếp thuần đại từ ("không, ý là…", "option 2"), và hit nào dưới ngưỡng điểm liên quan đều bị loại.
3. **Suy nghĩ.** Tin nhắn, khối gợi nhớ và vài gợi ý cho lượt đó được gửi vào phiên Claude *sống* của chat đó (client Claude Agent SDK, system preset `claude_code` cộng `bridge/persona.md`). Vault được thêm làm thư mục làm việc phụ, nên Lucy đọc ghi ghi chú bằng chính công cụ thường ngày.
4. **Trả lời.** Chữ được stream về bằng cách sửa tin nhắn Telegram tại chỗ.
5. **Ghi nhớ.** Lượt chat được ghi vào coordinator (trí nhớ hội thoại) và lượng token được báo về token guard chung. Khi phiên dùng khoảng 70% cửa sổ ngữ cảnh, bridge chuyển sang phiên mới và mang theo mạch hội thoại gần nhất.

Web hub đi theo đường tương tự với lịch sử chat riêng, và có thêm bảng việc, các màn hình trí nhớ và lịch chạy.

::: tip Vì sao chat không đi qua pxpipe
`lucy-pxpipe` là proxy nén token chạy cục bộ, dành cho lưu lượng lớn của worker và autopilot. Chat cố ý đi thẳng tới Anthropic: việc nén từng làm rơi mất persona gắn vào system prompt. Xem [Vận hành](./operations#persona-lost).
:::

## Thành phần

| Process (tên PM2) | Thư mục | Port | Vai trò |
|---|---|---|---|
| `lucy-bridge` | `bridge/` | — | Telegram ↔ Claude. Mỗi chat một phiên sống, gợi nhớ trước, nhận file, xử lý lệnh. |
| `lucy-coordinator` | `agent-machine/` | 8780 | API trung tâm: recall và đánh chỉ mục trí nhớ, bảng việc (thẻ, dự án, pipeline), persona, lane model, token guard. |
| `lucy-vps-worker` | `agent-machine/` | — | Nhận các bước của thẻ từ coordinator rồi chạy bằng Claude hoặc lane rẻ. |
| `lucy-autopilot` | `agent-machine/` | — | Duyệt, từ chối hoặc trả lời các cổng thường lệ của thẻ (không bao giờ đụng cổng deploy/security). |
| `lucy-hub` | `hub/server/` | 8800 | Web điều khiển: phục vụ giao diện React đã build và `/api` của nó. |
| `lucy-pxpipe` | `pxpipe/` | 47821 | Proxy nén token cho worker, autopilot và hub. |
| `noteflow-view` | `agent-machine/` | 8090 | Xem tĩnh một workspace thẻ. Gắn với bản cài gốc; bạn bỏ đi cũng được. |

| Dữ liệu | Vị trí mặc định | Nội dung |
|---|---|---|
| Vault | `~/lucy/lucy-vault` | Trí nhớ Markdown. Chỉ mục tìm kiếm ở `.index/memory.db` (dựng lại được). |
| Dữ liệu coordinator | `AM_DATA` | Trạng thái bảng việc, sổ token. |
| Trạng thái hub | `LUCY_STATE` (`~/.lucy-hub`) | Secret 2FA, lịch chạy, nhật ký sự kiện, lịch sử chat. |
| Trạng thái bridge | `~/.lucy-bridge-*.json` | Bảng chat→phiên, offset Telegram, tuỳ chọn từng chat, trạng thái. |

## Lệnh Telegram

| Lệnh | Tác dụng |
|---|---|
| *(tin nhắn thường)* | Chat với Lucy. |
| `/new` | Mở phiên mới (quên mạch hiện tại). |
| `/stop` | Xoá các tin đang chờ và ngắt câu trả lời đang chạy. |
| `/model`, `/persona` | Chọn model cho chat (một model Claude, một lane rẻ, hoặc `auto`) hoặc lớp persona phủ lên Lucy. |
| `/think on\|off` | Bật/tắt hiển thị phần suy luận của các lane model có trả về phần này. |
| `/prompt <việc>` | Nhờ Prompt Architect biến yêu cầu thô thành prompt chỉn chu. |
| `/fan`, `/orch`, `/auto` | Chạy nhiều việc song song, theo kiểu lập kế hoạch → nhiều sub-agent → tổng hợp, hoặc lặp tự động tới khi xong. |
| `/ctx`, `/info`, `/token`, `/id` | Xem mức dùng ngữ cảnh, engine, lượng token, chat ID và user ID của bạn. |
| `/restart` | Khởi động lại bridge qua PM2. |

Chi tiết ở trang [Telegram](./telegram).

## Đọc tiếp

- [Cài đặt](./installation): dựng máy chủ từ đầu.
- [Cấu hình](./configuration): toàn bộ biến môi trường.
- [Vận hành & xử lý sự cố](./operations): PM2, log, cập nhật, sao lưu, các lỗi thường gặp.
- [Bộ nhớ](./memory), [Agent & bảng việc](./agents), [Model](./models), [Skill & MCP](./skills-mcp): các phần hoạt động thế nào.
- [Bảo mật](./security): những gì đã được khoá và những điều cần biết trước khi đưa Lucy ra internet.
