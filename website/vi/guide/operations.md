# Vận hành & xử lý sự cố

Chạy Lucy hằng ngày: PM2, log, cập nhật, sao lưu, kiểm tra sức khoẻ, và cách xử lý những lỗi đã thực sự xảy ra khi chạy thật.

## PM2 cơ bản

Mọi process được định nghĩa trong `ecosystem.config.cjs` ở gốc repository.

```bash
cd ~/lucy
pm2 ls                                   # trạng thái, số lần restart, CPU, RAM
pm2 logs lucy-bridge --lines 50          # xem log một process
pm2 restart lucy-bridge                  # khởi động lại một process (giữ env cũ)
pm2 start ecosystem.config.cjs && pm2 save   # tạo (lại) mọi thứ từ file ecosystem
pm2 stop lucy-autopilot                  # tạm dừng autopilot trực đêm
pm2 describe lucy-coordinator            # chi tiết: script, cwd, đường dẫn log, số lần restart
pm2 save                                 # ghi nhớ danh sách process để dựng lại sau reboot
```

### Sau khi đổi cấu hình {#after-config-change}

PM2 chỉ đọc biến môi trường khi **tạo** process. `pm2 restart` dùng lại env cũ. Sửa bất kỳ file env nào xong thì:

```bash
pm2 delete <tên> && pm2 start ecosystem.config.cjs --only <tên>
pm2 save
```

Vì cả bốn file env đều dùng chung, thay đổi ảnh hưởng nhiều process thì phải tạo lại từng process đó (hoặc tất cả: `pm2 delete all && pm2 start ecosystem.config.cjs && pm2 save`).

### Đổi gì thì khởi động lại gì

| Bạn đã đổi | Việc cần làm |
|---|---|
| `bridge/lucy_bridge.py` | `pm2 restart lucy-bridge` (hoặc gửi `/restart` cho bot). |
| `bridge/persona.md` | Không cần khởi động lại: file được đọc khi mở phiên. Gửi `/new` để chat mở phiên mới với persona mới. |
| Bất kỳ file env nào | `pm2 delete <tên> && pm2 start ecosystem.config.cjs --only <tên>` cho từng process bị ảnh hưởng. |
| `agent-machine/src/*` | `pm2 restart lucy-coordinator lucy-vps-worker lucy-autopilot`. Hub có import một phần code agent-machine, nên restart cả `lucy-hub`. |
| `agent-machine/config/` (persona, pipeline) | `pm2 restart lucy-coordinator`. |
| Ghi chú vault sửa tay | Không cần gì: coordinator tự đánh chỉ mục lại file thay đổi. Muốn dựng lại toàn bộ: `pm2 restart lucy-coordinator`. |
| `hub/server/src/*` | `pm2 restart lucy-hub`. |
| `hub/web/src/*` | `cd hub/web && npm run build`, rồi tải lại trình duyệt (không cần restart). |
| `package.json` ở phần nào | `npm install` trong thư mục đó, rồi restart các process của nó. |
| Cập nhật Claude Code CLI | `pm2 restart lucy-bridge lucy-hub lucy-vps-worker lucy-autopilot` để các phiên đang sống dùng bản mới. |
| `ecosystem.config.cjs` | `pm2 delete all && pm2 start ecosystem.config.cjs && pm2 save`. |

## Log

| Cái gì | Ở đâu |
|---|---|
| stdout/stderr của process | `~/.pm2/logs/<tên>-out.log` và `<tên>-error.log`; xem bằng `pm2 logs <tên>`. Xoá bằng `pm2 flush`. |
| Sự kiện của hub (đăng nhập, lịch chạy, job) | `$LUCY_STATE/log.jsonl` (mặc định `~/.lucy-hub/log.jsonl`), và tab **Logs** trong hub. |
| Dream ban đêm | File bạn chuyển hướng tới trong crontab, ví dụ `~/lucy-workspace/dream-cron.log`. |
| Lượt chạy của agent | File JSONL trong `AM_TURNS_LOG`, nếu có đặt. Tổng hợp bằng `cd agent-machine && npm run stats:errors`. |
| Báo cáo gộp trí nhớ | `Brain/proposals/consolidate-<ngày>.md` trong vault. |
| Trạng thái nhận tin của bridge | `~/.lucy-bridge-status.json`; đọc bằng `python3 bridge/tg_diag.py`. |

Bridge đã che secret trong log (token bot được thay bằng `<bot-token>`), nhưng vẫn nên coi log là riêng tư. Cài `pm2 install pm2-logrotate` nếu cần tiết kiệm ổ đĩa.

## Cập nhật

```bash
cd ~/lucy
git pull
(cd agent-machine && npm install)
(cd hub/server && npm install)
(cd hub/web && npm install && npm run build)
(cd pxpipe && npm install)
pip install -U requests telegramify-markdown claude-agent-sdk
pm2 restart all
```

Bỏ qua bước `npm install` nào mà `package.json` không đổi. Sau mỗi lần pull, so các file `*.env.example` với file env của bạn (`git diff HEAD@{1} -- '*.example'`) và thêm biến mới nếu có. Nếu `ecosystem.config.cjs` thay đổi, hãy tạo lại process thay vì chỉ restart.

Kiểm tra một thay đổi trước khi đưa lên:

```bash
(cd agent-machine && npx tsc --noEmit && npm run smoke && npm run smoke:token-guard)
(cd hub/server && npx tsc --noEmit) && (cd hub/web && npx tsc --noEmit)
(cd bridge && python3 smoke_tg_router.py)
```

## Sao lưu {#backups}

### Vault

Vault là một repo git chứa file Markdown, tách khỏi code. Hãy commit và đẩy lên một remote **riêng tư** thường xuyên, ví dụ bằng một dòng cron:

```text
30 3 * * * cd /root/lucy/lucy-vault && git add -A && (git diff --cached --quiet || git commit -qm "vault $(date +\%F)") && git push -q
```

Chỉ mục tìm kiếm (`.index/`) và các bản chụp an toàn của dream (`.snapshots/`) đã được loại trong `.gitignore` của vault. Chỉ mục luôn dựng lại được: `cd agent-machine && LUCY_VAULT=~/lucy/lucy-vault npm run reindex`.

`tools/vault-backup.sh` là script sao lưu của bản cài gốc. Trước khi dùng, sửa các biến ở đầu file (`LUCY`, `VAULT_DIR`, `WORK`, và `REPO_SLUG` đang trỏ vào repo của chủ cũ). Lưu ý thêm:

- script chạy thử (không làm gì thật) trừ khi đặt `DRY=0`;
- script từ chối chạy nếu vault có dưới 1000 file (chốt an toàn chống sai đường dẫn hoặc vault rỗng);
- script lấy `GITHUB_TOKEN` từ môi trường của process `lucy-bridge` đang chạy.

### Những thứ khác nên giữ

| Cái gì | Đường dẫn | Vì sao |
|---|---|---|
| File env | `.env.llm`, `.env.runtime`, `agent-machine/.env`, `bridge/.env` | Key và cấu hình của bạn. Lưu ở dạng mã hoá. |
| Trạng thái hub | `$LUCY_STATE` (`~/.lucy-hub`) | Secret 2FA, lịch chạy, lịch sử chat của hub. |
| Dữ liệu coordinator | `$AM_DATA` | Bảng việc, thẻ, sổ token. |
| Claude Code | `~/.claude/` | Đăng nhập, cấu hình, và transcript phiên dùng để nối lại chat. |
| Trạng thái bridge | `~/.lucy-bridge-*.json`, `~/.lucy-*-history.json` | Bảng chat→phiên và tuỳ chọn. Mất cũng không sao. |

## Kiểm tra sức khoẻ

```bash
# Coordinator (/health không cần xác thực)
curl -s http://127.0.0.1:8780/health
# Coordinator, các endpoint cần token
curl -s -H "x-worker-token: $AM_TOKEN" http://127.0.0.1:8780/token-guard
curl -s -H "x-worker-token: $AM_TOKEN" http://127.0.0.1:8780/llm/guard
# Hub (qua nginx)
curl -s https://<your-server>/api/me          # {"authed":false,"twofa":true}
# Nhịp học của trí nhớ
cd ~/lucy/agent-machine && LUCY_VAULT=~/lucy/lucy-vault npm run recall -- stats
# Đường nhận tin Telegram, không cần poll Telegram
python3 ~/lucy/bridge/tg_diag.py
```

Shell của bạn không có sẵn `$AM_TOKEN` vì các file env không được nạp vào shell. Dán giá trị vào, hoặc dùng `source <(grep ^AM_TOKEN= ~/lucy/agent-machine/.env)` cho một lần kiểm tra.

Từ Telegram:

| Lệnh | Hiển thị |
|---|---|
| `/info` | Engine (`persist`/`sdk`/`spawn`), model, quyền, thư mục làm việc. |
| `/ctx` | Trạng thái recall, bộ đếm đường nhận tin, kích thước phiên hiện tại và mức dùng ngữ cảnh. |
| `/token` | Lượng token đã dùng hôm nay. |

Trong hub, tab **VPS** hiện các process PM2 cùng CPU, RAM và số lần restart.

Để ý **số lần restart** trong `pm2 ls`. Con số cứ tăng mãi nghĩa là đang crash loop: xem bên dưới.

## Xử lý sự cố

### Chat báo "❌ Lỗi stream (SDK): … exit code 1"

**Nguyên nhân:** bridge cố nối lại một phiên Claude mà transcript không còn nữa (ví dụ sau khi dọn `~/.claude/projects` hoặc xoá vault). Claude thoát với lỗi "No conversation found".

**Cách xử lý:** code hiện tại kiểm tra file phiên còn tồn tại trước khi nối lại, và thử lại một lần không nối, nên lỗi này thường tự lành. Nếu vẫn lặp lại:

1. Gửi `/new` cho bot.
2. Nếu không ăn thua, xoá mục của chat đó trong `~/.lucy-bridge-sessions.json` (chat ID → session ID), hoặc xoá cả file.
3. `pm2 restart lucy-bridge`.

### Lucy quên mất mình là ai {#persona-lost}

**Triệu chứng:** Lucy tự giới thiệu là "Claude do Anthropic phát triển", hoặc bỏ qua giọng điệu và quy ước trong `persona.md`.

**Nguyên nhân:** request chat đã đi qua `lucy-pxpipe`. Việc nén token làm rơi phần persona gắn vào system prompt với các model nằm trong `PXPIPE_MODELS`.

**Cách xử lý:** chat của bridge tự bỏ `ANTHROPIC_BASE_URL` và nói chuyện thẳng với Anthropic. Đừng thay đổi điều đó. Nếu bạn gặp lỗi này ở chat trong **hub** (hub thừa hưởng `ANTHROPIC_BASE_URL`), hãy xoá biến khỏi `bridge/.env` rồi tạo lại `lucy-hub`, hoặc bỏ model đó khỏi `PXPIPE_MODELS`. Kiểm tra thêm `LUCY_PERSONA` có trỏ đúng file đang tồn tại không, và log có dòng `BUDGET: khối persona … → cắt` không (persona bị cắt bớt; tăng `LUCY_BUDGET_PERSONA`).

### Bot vẫn online nhưng không bao giờ trả lời (xung đột Telegram)

Telegram chỉ cho **một nơi nhận tin cho mỗi token bot**. Một process thứ hai gọi `getUpdates` (một bản bridge khác trên máy chủ khác hay trên laptop, một process PM2 còn sót, một script chẩn đoán) sẽ hoặc cướp mất tin nhắn, hoặc khiến Telegram trả lỗi `409 Conflict`. Bot đang đặt webhook cũng gây ra hệ quả y như vậy.

**Kiểm tra và xử lý:**

```bash
pm2 ls                                    # chỉ một lucy-bridge, trên đúng một máy
curl -s https://api.telegram.org/bot<bot-token>/getWebhookInfo      # "url" phải rỗng
curl -s https://api.telegram.org/bot<bot-token>/deleteWebhook       # nếu đang có webhook
python3 ~/lucy/bridge/tg_diag.py          # lần nhận tin cuối, offset, số tin bị bỏ
```

Tuyệt đối không tự gọi `getUpdates` khi bridge đang chạy: tin nào bạn lấy về coi như đã được nhận và sẽ không bao giờ tới tay Lucy. `bridge/tg_guard.py` từ chối poll chẩn đoán khi bridge đang online.

### Bot bị "điếc" rồi tự khởi động lại

Nếu quá `LUCY_POLL_WATCHDOG_S` giây (mặc định 240) không có lần poll Telegram nào thành công, bridge in `WATCHDOG: … KHÔNG nhận được gì từ Telegram` rồi tự thoát để PM2 dựng lại. Watchdog kích hoạt liên tục thường nghĩa là máy chủ không với tới `api.telegram.org`. Nếu mạng của bạn chặn Telegram, đặt `LUCY_TG_PROXY` (ví dụ một proxy SOCKS cục bộ).

### Thiếu hoặc sai biến môi trường

| Triệu chứng | Nguyên nhân |
|---|---|
| `lucy-bridge` crash loop với `KeyError: 'TELEGRAM_BOT_TOKEN'` | Thiếu token trong `bridge/.env`. |
| Bot trả lời `⛔ Không có quyền.` | User ID của bạn không khớp `LUCY_ALLOWED_USER_ID`. Kiểm tra bằng `/id`. |
| Bridge thoát với `LUCY_ALLOWED_USER_ID chưa đặt trong bridge/.env — từ chối khởi động` | `LUCY_ALLOWED_USER_ID` đang trống. Đặt rồi khởi động lại bridge. |
| Bot trả lời bất kỳ ai | Đang đặt `LUCY_ALLOW_ANYONE=1` trong khi `LUCY_ALLOWED_USER_ID` trống. Bỏ biến đó và đặt ID ngay. |
| `ecosystem.config.cjs` in `[SECURITY] LUCY_HUB_PASSWORD …` và mọi lượt đăng nhập hub đều thất bại | Thiếu `LUCY_HUB_PASSWORD` trong `.env.runtime`. |
| Log coordinator: `AM_TOKEN trống — endpoint /worker KHÔNG có auth` | `AM_TOKEN` rỗng, thường do một dòng `AM_TOKEN=` rỗng ở file env nạp sau. |
| Log bridge: `RECALL FAIL … 401` | `AM_TOKEN` của bridge khác của coordinator. |
| Log coordinator không có `vault ON`; các tab bộ não trống | `LUCY_VAULT` không trỏ tới thư mục có thật. |
| Log worker ghi `runner=MOCK` | `AM_RUNNER` không phải `claude`; worker không tốn token và không làm việc thật. |
| Biến "đã đặt" nhưng không ăn | Bạn restart thay vì tạo lại process, hoặc chỉ export trong shell. Xem [Sau khi đổi cấu hình](#after-config-change). |

Liệt kê các biến mà một process đang chạy thực sự nhận được (chỉ tên, vì giá trị là secret):

```bash
pm2 env $(pm2 id lucy-bridge | tr -dc '0-9') | grep -E '^(LUCY_|AM_)' | cut -d: -f1
```

### Worker, autopilot hoặc hub không gọi được Claude

Nếu `ANTHROPIC_BASE_URL` trỏ vào pxpipe mà `lucy-pxpipe` đang dừng, mọi lời gọi Claude từ các process đó đều lỗi kết nối. Bật nó lên (`pm2 start ecosystem.config.cjs --only lucy-pxpipe`) hoặc xoá `ANTHROPIC_BASE_URL` khỏi `bridge/.env` rồi tạo lại các process.

### Một process restart hàng nghìn lần

Crash loop (thường do thiếu `node_modules` hoặc thiếu file) làm PM2 bận liên tục và có thể ngốn trọn một nhân CPU. Dừng process trước, rồi mới sửa:

```bash
pm2 stop <tên>
pm2 logs <tên> --err --lines 50
# sửa (npm install, env, đường dẫn), rồi:
pm2 start <tên>
```

Đừng bật lại process đã dừng khi chưa sửa xong nguyên nhân.

### Chạm giới hạn sử dụng Claude

Khi câu trả lời của Claude trông như lỗi giới hạn sử dụng hoặc giới hạn tần suất, hoặc token guard theo ngày chạm ngưỡng cứng, bridge chuyển sang lane rẻ tốt nhất còn dùng được (provider có cấu hình key) và nói rõ lý do. Không có key provider nào thì không có đường lùi, bạn phải chờ giới hạn được làm mới. Xem `/token` và `curl … /token-guard`; tăng `AM_DAY_TOKEN_SOFT` / `AM_DAY_TOKEN_HARD` nếu mặc định không hợp.

### Recall không ra gì hoặc ra ghi chú cũ

- Xem dòng `RECALL:` trong `/ctx` và tìm `RECALL FAIL` trong log bridge.
- Dựng lại chỉ mục: `pm2 restart lucy-coordinator`, hoặc `cd agent-machine && LUCY_VAULT=… npm run reindex`.
- Bảo đảm ghi chú nằm trong thư mục được đánh chỉ mục (xem `LUCY_INDEX_DIRS`). `Brain/inbox` và `Brain/preferences` cố ý không được tìm.

### Lỗi đăng nhập hub

- `429 too_many_attempts`: sai 5 lần từ IP của bạn trong 15 phút. Chờ, hoặc `pm2 restart lucy-hub` (bộ đếm nằm trong bộ nhớ).
- Mất ứng dụng authenticator: xoá `$LUCY_STATE/twofa.json` rồi `pm2 restart lucy-hub`. Đăng nhập bằng mật khẩu và bật lại 2FA.
- Bị đăng xuất sau khi restart: phiên hub nằm trong bộ nhớ, nên restart hub là mọi người bị đăng xuất.

### Script QA làm thay đổi trí nhớ

Các script `bridge/qa_*.py` nói chuyện với Lucy thật, và Lucy ghi vào vault trong lúc chúng chạy: từng có một câu giả định trong bài test biến thành "sở thích bền". Tắt ghi hội thoại là chưa đủ, vì công cụ ghi file của Lucy vẫn ghi. Hãy bọc mọi lần chạy QA:

```bash
bash ~/lucy/bridge/qa_vault_guard.sh snapshot   # trước khi chạy
# … chạy script qa_*.py …
bash ~/lucy/bridge/qa_vault_guard.sh diff       # bài test đã đụng vào đâu
bash ~/lucy/bridge/qa_vault_guard.sh restore    # trả vault về như cũ
```

Script bảo vệ `Brain/claude-memory`, `Context` và `Brain/inbox`, và lưu bản chụp ở `/root/lucy/.state/vault-snapshot`.

### Dừng khẩn cấp mọi thứ

```bash
pm2 stop all                       # dừng Lucy
touch /root/lucy/KILL_SWITCH       # mọi job bọc bằng cron_guard sẽ tự bỏ qua
```

Hoàn tác bằng `pm2 start all` và `rm /root/lucy/KILL_SWITCH`.

## Câu hỏi thường gặp

**Chạy Lucy không cần Telegram được không?**
Được. Đừng khởi động bridge (`pm2 delete lucy-bridge && pm2 save`) và dùng web hub. Thông báo Telegram từ cron dream và lịch chạy của hub sẽ tự bỏ qua khi không có token bot.

**Dùng API key của Anthropic thay cho gói thuê bao được không?**
Được. Đặt `ANTHROPIC_API_KEY` trong `.env.runtime` rồi tạo lại các process. Khi đó bạn trả tiền theo token, nên cân nhắc hạ các trần ngân sách.

**Nhiều người dùng chung một Lucy được không?**
Không. Lucy được thiết kế cho một chủ: một user Telegram được phép, một mật khẩu hub, một bộ nhớ.

**Mở vault bằng Obsidian được không?**
Được. Đó là Markdown thuần có frontmatter. Clone repo riêng của vault về máy bạn, rồi pull/push song song với máy chủ. Đừng sửa `Brain/preferences/` hay `Brain/active.md`: dream sẽ ghi đè chúng.

**Lucy lưu cuộc chat ở đâu?**
Phiên Telegram nằm trong transcript của Claude Code (`~/.claude/projects/`), được ánh xạ theo từng chat trong `~/.lucy-bridge-sessions.json`. Chat trong hub nằm ở `$LUCY_STATE/chat.json`. Khi bật trí nhớ hội thoại, các lượt chat còn được ghi vào chỉ mục của vault để recall.

**Đổi múi giờ thế nào?**
Đặt `LUCY_TZ_OFFSET` (số giờ lệch UTC) trong `.env.runtime` rồi tạo lại các process. Cron dream chạy theo giờ địa phương của máy chủ, nên sửa cả crontab.

**Làm mới một cuộc trò chuyện thế nào?**
Gửi `/new`. Lệnh này đóng phiên đang sống và quên mạch hội thoại gần đây của chat đó.
