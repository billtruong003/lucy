# Cài đặt

Trang này dẫn bạn từ một máy chủ Linux trống tới một Lucy đang chạy: trả lời bạn trên Telegram và phục vụ web hub qua HTTPS. Dự trù khoảng 30–60 phút.

## Yêu cầu

| Cần | Ghi chú |
|---|---|
| Máy chủ Linux | VPS **tối thiểu 2 GB RAM, khuyên dùng 4 GB** (vài process Node cộng các phiên Claude). Các script được viết trên Ubuntu/Debian. |
| Node.js **20+** và npm | Cho coordinator, worker, autopilot, hub và pxpipe. |
| Python **3.10+** và pip | Cho bridge Telegram. |
| PM2 | `npm install -g pm2`. Chạy và giám sát mọi process. |
| Claude Code CLI | Đã cài và **đã đăng nhập** (gói Claude), hoặc có `ANTHROPIC_API_KEY`. Lucy điều khiển Claude qua CLI và Agent SDK. |
| Bot Telegram | Tạo bằng [@BotFather](https://t.me/BotFather), giữ lại token. |
| Công cụ build | `build-essential` và `python3` để build module native `better-sqlite3` khi không có bản dựng sẵn cho nền tảng của bạn. |
| Tuỳ chọn | Tên miền, nginx và certbot để chạy hub qua HTTPS. Key provider cho lane rẻ, Jina cho trí nhớ vector. |

::: warning Vị trí cài đặt
Nhiều giá trị mặc định trong code trỏ về `~/lucy` (ví dụ `~/lucy/.env.llm`, `~/lucy/lucy-vault`, `~/lucy/agent-machine/config/personas`), và vài script ghi cứng `/root/lucy`. Cách ít rắc rối nhất là **clone vào `~/lucy` bằng đúng user sẽ chạy PM2**. Bản cài gốc chạy bằng `root`; nếu dùng user khác, thay `/root` bằng thư mục home của user đó trong các bước dưới và xem mục [Đường dẫn ghi cứng /root](#hardcoded-root).
:::

## 1. Cài gói hệ thống

```bash
sudo apt update
sudo apt install -y git curl build-essential python3 python3-pip
# Node.js 20 (NodeSource; cách cài Node 20+ nào cũng được)
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs
sudo npm install -g pm2
node -v && python3 --version && pm2 -v
```

## 2. Cài và đăng nhập Claude Code {#claude-code}

Cài Claude Code CLI theo hướng dẫn trong tài liệu của Anthropic (bộ cài native đặt file chạy ở `~/.local/bin/claude`), rồi đăng nhập một lần:

```bash
claude            # làm theo lời nhắc đăng nhập, xong thì thoát
which claude      # ghi lại đường dẫn này cho CLAUDE_BIN
claude -p "2+2" --output-format json   # phải in ra một kết quả JSON
```

Nếu muốn dùng API key thay vì đăng nhập gói, bạn sẽ thêm `ANTHROPIC_API_KEY=...` vào `.env.runtime` ở bước 7.

::: tip Để trí nhớ của Claude nằm trong vault
Claude Code có cơ chế auto-memory riêng. Hãy trỏ nó vào vault của Lucy để chỉ có một bộ não. Trong `~/.claude/settings.json` thêm:
```json
{ "autoMemoryDirectory": "~/lucy/lucy-vault/Brain/claude-memory" }
```
:::

## 3. Clone repository

```bash
cd ~
git clone <repo-url> lucy      # repository GitHub có link ở đầu trang này
cd ~/lucy
```

## 4. Cài dependency

Cài agent-machine trước vì hub server import code từ đó.

```bash
cd ~/lucy/agent-machine && npm install
cd ~/lucy/hub/server   && npm install
cd ~/lucy/hub/web      && npm install && npm run build   # tạo hub/web/dist để hub phục vụ
cd ~/lucy/pxpipe       && npm install                    # proxy nén token
```

Bridge cần ba gói Python:

```bash
pip install requests telegramify-markdown claude-agent-sdk
```

- `requests` là bắt buộc.
- `claude-agent-sdk` bật engine mặc định `persist` (mỗi chat một phiên Claude sống). Thiếu gói này, bridge quay về chạy `claude -p` cho từng tin nhắn, chậm hơn nhiều.
- `telegramify-markdown` chuyển câu trả lời sang định dạng của Telegram. Không bắt buộc nhưng nên cài.

Trên Debian/Ubuntu đời mới, pip có thể từ chối cài toàn hệ thống ("externally managed environment"). Hoặc thêm `--break-system-packages`, hoặc tạo virtualenv rồi sửa mục `lucy-bridge` trong `ecosystem.config.cjs` từ `python3` thành interpreter của venv (ví dụ `/root/lucy/bridge/.venv/bin/python`).

## 5. Tạo bot Telegram

1. Trong Telegram, mở **@BotFather**, gửi `/newbot` và làm theo hướng dẫn.
2. Chép token của bot. Nó đi vào `TELEGRAM_BOT_TOKEN` trong `bridge/.env`.
3. Bạn cũng cần **user ID dạng số** của mình cho `LUCY_ALLOWED_USER_ID`. Bot "user info" nào cũng cho bạn biết, hoặc xem mẹo ở bước 9.

## 6. Tạo vault

Vault là trí nhớ dài hạn của Lucy: Markdown thuần, nằm trong **một repo git riêng** (repo chính bỏ qua thư mục này). Tạo các thư mục mà code đọc và ghi:

```bash
mkdir -p ~/lucy/lucy-vault && cd ~/lucy/lucy-vault
mkdir -p Context Projects Daily Knowledge Reference Reports Skills \
         Brain/inbox Brain/preferences Brain/episodes Brain/proposals \
         Brain/claude-memory Brain/decisions Brain/entities Brain/agents Brain/log
printf '.index/\n.snapshots/\n*.bak-*\n' > .gitignore
cat > Context/USER.md <<'EOF'
---
title: Về chủ nhân
type: context
---

- [work] Bạn làm nghề gì, một dòng #profile
- [preference] Bạn thích câu trả lời thế nào: ngắn, thẳng #style
EOF
git init && git add -A && git commit -m "init vault"
```

Công dụng của từng thư mục:

| Thư mục | Dùng cho | Recall có tìm |
|---|---|---|
| `Context/` | Sự thật lâu dài về bạn; `Context/USER.md` là file chính Lucy ghi thêm vào. | có |
| `Projects/`, `Knowledge/`, `Reference/`, `Reports/`, `Skills/` | Ghi chú bạn tự biên soạn. | có |
| `Daily/` | Ghi chú phiên do agent viết. | có |
| `Brain/claude-memory/` | Auto-memory của Claude Code (xem bước 2). | có |
| `Brain/episodes/` | Tóm tắt xuyên phiên (khi `LUCY_SESSION_SUMMARY=1`). | có |
| `Brain/decisions/`, `Brain/entities/`, `Brain/proposals/` | Quyết định, thực thể, báo cáo gộp trí nhớ hằng đêm. | có |
| `Brain/inbox/` | Tín hiệu thô chờ job dream xử lý. | không |
| `Brain/preferences/`, `Brain/active.md` | Sở thích do dream sinh ra, máy quản lý. Đừng sửa tay. | không |
| `Brain/agents/` | Bài học riêng của từng persona. | không |
| `.index/` | Chỉ mục SQLite (`memory.db`). Dựng lại được, đừng commit. | — |

Danh sách thư mục được tìm có thể ghi đè bằng `LUCY_INDEX_DIRS` (xem [Cấu hình](./configuration#memory-recall)). Muốn đẩy vault lên một remote riêng tư, thêm bằng `git remote add origin <private-repo-url>`.

## 7. Điền các file môi trường

PM2 **không** đọc biến từ shell của bạn (`filter_env: true`). Mọi thứ lấy từ bốn file mà `ecosystem.config.cjs` gộp lại theo thứ tự dưới đây (file sau đè file trước):

```bash
cd ~/lucy
cp .env.llm.example          .env.llm
cp agent-machine/.env.example agent-machine/.env
cp bridge/.env.example        bridge/.env
cp .env.runtime.example       .env.runtime
chmod 600 .env.llm agent-machine/.env bridge/.env .env.runtime
```

Tạo hai secret:

```bash
openssl rand -hex 32     # dùng làm AM_TOKEN
openssl rand -base64 24  # dùng làm LUCY_HUB_PASSWORD (hoặc tự đặt một mật khẩu mạnh)
```

Tối thiểu phải điền:

| File | Biến | Giá trị |
|---|---|---|
| `agent-machine/.env` | `AM_TOKEN` | Token vừa tạo. |
| `bridge/.env` | `AM_TOKEN` | **Đúng token đó.** |
| `bridge/.env` | `TELEGRAM_BOT_TOKEN` | Lấy từ @BotFather. |
| `bridge/.env` | `LUCY_ALLOWED_USER_ID` | User ID Telegram dạng số của bạn. |
| `bridge/.env` | `CLAUDE_BIN` | Kết quả của `which claude`. |
| `.env.runtime` | `LUCY_HUB_PASSWORD` | Mật khẩu hub. |
| `.env.runtime` | `LUCY_VAULT` | `/root/lucy/lucy-vault` (hoặc đường dẫn của bạn). |

::: warning Giá trị rỗng cũng đè file trước
Vì các file được gộp theo thứ tự, một dòng rỗng như `AM_TOKEN=` trong `bridge/.env` sẽ thay token thật từ `agent-machine/.env` cho mọi process. Khi đó coordinator chạy **không có xác thực**. Hoặc đặt cùng một giá trị ở cả hai file, hoặc xoá hẳn dòng rỗng.
:::

Kiểm tra thêm:

- **Đường dẫn.** File mẫu dùng `/root/...` (`AM_DATA`, `AM_TURNS_LOG`, `LUCY_PROJECTS_ROOT`, `LUCY_STATE`, `LUCY_VAULT`, `CLAUDE_BIN`, `LUCY_WORKDIR`, `LUCY_PERSONA`). Sửa lại nếu bạn không chạy bằng root.
- **pxpipe.** `bridge/.env` đặt `ANTHROPIC_BASE_URL=http://127.0.0.1:47821`. Vì các file dùng chung, dòng này khiến **worker, autopilot và hub** đi qua `lucy-pxpipe` (chat Telegram luôn đi thẳng). Không muốn dùng proxy thì xoá dòng đó và bỏ process `lucy-pxpipe`.
- **Chế độ API key.** Nếu không đăng nhập Claude Code bằng gói, thêm `ANTHROPIC_API_KEY=...` vào `.env.runtime`.
- **Key tuỳ chọn** trong `.env.llm`: provider cho lane rẻ, `JINA_API_KEY` cho trí nhớ vector, `GITHUB_TOKEN` và các key khác cho MCP. Tất cả có mô tả ở trang [Cấu hình](./configuration).
- Để trống `RADIANT_BOT_*` và `LUCY_*_DISCORD_*` trừ khi bạn chạy tích hợp ngoài đó.

## 8. Xem lại persona và danh sách process

- `bridge/persona.md` được gắn vào system prompt của Claude khi chat. Bản đi kèm **viết bằng tiếng Việt**, theo giọng và quy ước của chủ cũ. Hãy viết lại cho mình (ngôn ngữ, giọng điệu, cách Lucy xưng hô với bạn). Giữ lại phần nói về cấu trúc vault và quy tắc ghi nhớ.
- `ecosystem.config.cjs` có `noteflow-view`, một trình xem tĩnh trỏ vào một workspace thẻ của bản cài gốc. Không hại gì nhưng vô dụng trên máy mới; xoá mục đó hoặc chạy `pm2 delete noteflow-view` sau khi khởi động.

## 9. Khởi động mọi thứ bằng PM2

```bash
cd ~/lucy
pm2 start ecosystem.config.cjs
pm2 save
pm2 startup        # in ra một lệnh; chạy lệnh đó để PM2 tự lên lại sau khi reboot
pm2 ls             # mọi process phải ở trạng thái "online"
```

Nếu `ecosystem.config.cjs` in cảnh báo `[SECURITY]`, nghĩa là thiếu `LUCY_HUB_PASSWORD` hoặc `AM_TOKEN`.

::: tip Tìm user ID Telegram
Gửi `/id` cho bot: bot trả về `chat_id` và `user_id`. Bridge chỉ trả lời user được phép, nên muốn dùng `/id` thì phải có ID đúng trước. Nếu khởi động bridge với `LUCY_ALLOWED_USER_ID` để trống, bot sẽ trả lời **bất kỳ ai**. Chỉ làm vậy trong chốc lát, rồi đặt ID và khởi động lại bằng `pm2 delete lucy-bridge && pm2 start ecosystem.config.cjs --only lucy-bridge`.
:::

::: info Ngôn ngữ của bot
Các thông báo dựng sẵn của bridge (dòng trạng thái, `/ctx`, lỗi) bằng tiếng Việt. Câu trả lời của Lucy theo `persona.md` và ngôn ngữ bạn dùng.
:::

## 10. Đặt hub sau nginx và HTTPS

Hub nghe ở `127.0.0.1:8800`. Mở ra ngoài qua nginx:

```bash
sudo apt install -y nginx certbot python3-certbot-nginx
sudo cp ~/lucy/hub/nginx-lucy.conf.example /etc/nginx/sites-available/lucy
sudo nano /etc/nginx/sites-available/lucy     # đặt server_name = <your-domain>
sudo ln -s /etc/nginx/sites-available/lucy /etc/nginx/sites-enabled/lucy
sudo nginx -t && sudo systemctl reload nginx
sudo certbot --nginx -d <your-domain>          # tự thêm 443 và chuyển hướng HTTP→HTTPS
sudo ufw allow 80,443/tcp
```

File cấu hình mẫu chuyển `/` vào hub với thời gian chờ đọc dài (1200 giây), vì job Claude có thể chạy lâu. Hub tin header `X-Forwarded-Proto` từ proxy cục bộ, nên cookie đăng nhập được gắn cờ `Secure` khi bạn vào bằng HTTPS.

::: warning Đừng mở HTTP thuần
Không có tên miền và TLS thì mật khẩu hub đi qua mạng ở dạng rõ. Nếu chưa làm được TLS, hãy giữ hub ở chế độ riêng tư (đường hầm SSH: `ssh -L 8800:127.0.0.1:8800 <your-server>`, rồi mở `http://localhost:8800`).
:::

## 11. Lên lịch dream ban đêm

Job dream gộp các tín hiệu trí nhớ thành sở thích, rồi đánh chỉ mục lại vault. Không tốn token. Thêm vào crontab của user chạy Lucy (`crontab -e`):

```text
0 2 * * * /root/lucy/bridge/cron_dream.sh >> /root/lucy-workspace/dream-cron.log 2>&1
```

Lưu ý:

- Script chỉ nạp `bridge/.env`. Nếu vault không nằm ở `~/lucy/lucy-vault`, thêm `LUCY_VAULT=...` vào `bridge/.env`.
- Script cần thấy `npm` trong `PATH` của cron; nó tự thêm `/usr/local/bin:/usr/bin`. Nếu Node cài bằng nvm, hãy dùng đường dẫn tuyệt đối hoặc một script bọc.
- Khi có thay đổi (hoặc khi lỗi), script nhắn bạn qua Telegram bằng `TELEGRAM_BOT_TOKEN` và `LUCY_ALLOWED_USER_ID`.
- `bridge/cron_guard.sh <tên> <timeout-giây> <lệnh…>` bọc bất kỳ cron job nào bằng khoá chống chạy chồng, giới hạn thời gian và công tắc khẩn (`touch /root/lucy/KILL_SWITCH` làm mọi job được bọc tự bỏ qua).

## 12. Đăng nhập hub lần đầu

1. Mở `https://<your-domain>` và đăng nhập bằng `LUCY_HUB_PASSWORD`.
2. Vào **Settings** và bật xác thực hai lớp: quét mã QR bằng ứng dụng authenticator rồi xác nhận một mã. Từ đó đăng nhập cần mật khẩu cộng mã 6 số.
3. Sai 5 lần từ cùng một IP thì đăng nhập bị khoá 15 phút. Phiên đăng nhập kéo dài 7 ngày.

## Kiểm tra

Đi lần lượt danh sách này:

- [ ] `pm2 ls` cho thấy `lucy-bridge`, `lucy-coordinator`, `lucy-vps-worker`, `lucy-autopilot`, `lucy-hub` (và `lucy-pxpipe` nếu dùng) đều **online**, số lần restart không tăng dần.
- [ ] `curl -s http://127.0.0.1:8780/health` trả về `{"ok":true,...}`.
- [ ] `pm2 logs lucy-coordinator --lines 20` có dòng `recall index: N note` và `vault ON`.
- [ ] `curl -s https://<your-domain>/api/me` trả về `{"authed":false,"twofa":...}`.
- [ ] Telegram: gửi "chào" cho bot và nhận được trả lời. `/info` hiện `Engine: persist`, user ID của bạn sau `uid=` (không phải `(mở!)`, nghĩa là ai cũng nhắn được) và `Persona: có`.
- [ ] Telegram: `/ctx` có dòng `RECALL:`. Muốn ra `OK` cần rerank của Jina (`LUCY_RERANK=1` + `JINA_API_KEY`); không có thì sẽ thấy `DEGRADED` hoặc `INCONCLUSIVE`, tức là recall vẫn chạy nhưng lọc theo trùng từ khoá. Dòng có chữ `lỗi` nghĩa là bridge không gọi được coordinator.
- [ ] `pm2 logs lucy-bridge --lines 50` không có dòng `RECALL FAIL`.
- [ ] `cd ~/lucy/agent-machine && LUCY_VAULT=~/lucy/lucy-vault npm run recall -- stats` in ra một dòng nhịp học.
- [ ] `crontab -l` có dòng dream.
- [ ] Đăng nhập hub được và đã bật 2FA.

## Đường dẫn ghi cứng /root {#hardcoded-root}

Nếu bạn không chạy bằng root trong `/root/lucy`, cần để ý những chỗ sau:

| Ở đâu | Cái gì | Cách sửa |
|---|---|---|
| Các file `.env.*.example` | Đường dẫn `/root/...` | Sửa trong các file env đã chép. |
| `bridge/lucy_bridge.py` | Lệnh `/restart` gọi `/usr/bin/pm2` | Bảo đảm pm2 nằm ở đường dẫn đó (tạo symlink) hoặc sửa dòng này. |
| `bridge/cron_guard.sh` | Công tắc khẩn ở `/root/lucy/KILL_SWITCH` | Sửa `KS=`. |
| `tools/vault-backup.sh` | `/root/lucy`, thư mục làm việc và repo sao lưu của chủ cũ | Sửa các biến ở đầu file trước khi dùng (xem [Vận hành](./operations#backups)). |
| `hub/server/src/index.ts` | Gốc trình duyệt file VPS `/root/lucy`, `/var/www`; prompt dọn dẹp VPS | Chỉ ảnh hưởng hiển thị; sửa nếu muốn các tab đó chạy ở nơi khác. |
| Code `agent-machine` | Đọc `~/lucy/.env.llm` và `~/lucy/.gcp-oauth.json` nếu không đặt `LLM_ENV_FILE` / `GCP_OAUTH_FILE` | Clone vào `~/lucy`, hoặc đặt hai biến đó. |

Tiếp theo: [Cấu hình](./configuration) cho từng biến, và [Vận hành](./operations) cho việc chạy hằng ngày.
