# Vận hành Lucy

Tài liệu này mô tả Lucy **đang chạy thế nào** (cập nhật 2026-10-08). Mọi tài liệu kế hoạch/sprint cũ nằm trong [`_outdated/`](_outdated/).

## Các process

Tất cả khai báo trong [`ecosystem.config.cjs`](../ecosystem.config.cjs), chạy bằng PM2, chỉ nghe `127.0.0.1`. Ra ngoài internet chỉ qua nginx.

| Process | Thư mục | Port | Việc |
|---|---|---|---|
| `lucy-bridge` | `bridge/` | — | Telegram ↔ Claude (engine `persist`: mỗi chat một phiên SDK sống) |
| `lucy-coordinator` | `agent-machine/` | 8780 | API trung tâm: recall/bộ nhớ, board thẻ, lane model, token-guard, persona |
| `lucy-vps-worker` | `agent-machine/` | — | Nhận thẻ từ coordinator, chạy Claude Agent SDK |
| `lucy-autopilot` | `agent-machine/` | — | Tự duyệt các gate thường lệ của thẻ (trừ deploy/security) |
| `lucy-hub` | `hub/server/` | 8800 | Web cockpit (UI React build sẵn + API), sau nginx ở `/` |
| `lucy-pxpipe` | `pxpipe/` | 47821 | Proxy nén token cho worker/autopilot. Chat Telegram đi thẳng Anthropic |
| `noteflow-view` | `agent-machine/` | 8090 | Xem tĩnh một workspace thẻ, sau nginx ở `/noteflow/` |

Cron duy nhất: `0 2 * * *` → `bridge/cron_dream.sh` (gộp trí nhớ ban đêm).

## Cấu hình

Process **không** lấy biến từ shell gõ lệnh (`filter_env`). Mọi giá trị nằm trong các file sau (gitignored, `chmod 600`); file sau đè file trước:

| File | Nội dung | Mẫu |
|---|---|---|
| `.env.llm` | key provider LLM, Jina, MCP GitHub/Google/TwelveData | [`.env.llm.example`](../.env.llm.example) |
| `agent-machine/.env` | `AM_TOKEN`, ngân sách, concurrency | [`agent-machine/.env.example`](../agent-machine/.env.example) |
| `bridge/.env` | token bot Telegram, user ID được phép, persona, đường dẫn Claude CLI | [`bridge/.env.example`](../bridge/.env.example) |
| `.env.runtime` | mật khẩu hub, đường dẫn vault/state, cờ tính năng | [`.env.runtime.example`](../.env.runtime.example) |

Bộ nhớ (`lucy-vault/`) là repo git riêng, private, không nằm trong repo này.

## Lệnh thường dùng

```bash
pm2 start ecosystem.config.cjs && pm2 save   # dựng lại toàn bộ (sau khi sửa env/ecosystem)
pm2 restart lucy-bridge                       # sau khi sửa bridge/ hoặc bridge/.env
pm2 restart lucy-coordinator                  # reindex recall / galaxy
pm2 logs lucy-bridge --lines 50
```

Sau khi sửa file env, phải `pm2 delete <tên> && pm2 start ecosystem.config.cjs --only <tên>` (PM2 chỉ đọc lại env khi start).

## Kiểm tra trước khi commit

```bash
(cd agent-machine && npx tsc --noEmit && npm run smoke && npm run smoke:token-guard)
(cd hub/server && npx tsc --noEmit) && (cd hub/web && npx tsc --noEmit)
(cd bridge && python3 smoke_tg_router.py)
```

Các script `bridge/qa_*.py` chạy qua Lucy thật và ghi vào vault. Phải snapshot/restore vault quanh lần chạy.

## Bảo mật đang áp dụng

- ufw chỉ mở 22, 80, 443, 8088, 47822. Mọi service Lucy nghe localhost.
- Hub: so sánh mật khẩu timing-safe, khoá 15 phút sau 5 lần sai mỗi IP, phiên hết hạn sau 7 ngày, TOTP tuỳ chọn (Settings).
- Telegram: chỉ trả lời `LUCY_ALLOWED_USER_ID`. Mọi tin gửi đi tắt link preview (chặn rò dữ liệu qua preview khi bị prompt-injection).
- **Còn nợ:** các process chạy bằng root với `bypassPermissions` + `IS_SANDBOX=1`. Hub đang là HTTP thuần (cần domain + TLS). Xem báo cáo kiến trúc để biết lộ trình xử lý.
