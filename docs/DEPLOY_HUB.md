# Lucy Hub — Deploy lên VPS (nginx + HTTPS + 2FA)

Mục tiêu: hub chạy always-on trên VPS, vào từ điện thoại/ngoài LAN qua `https://<domain>`, bảo mật mật khẩu + 2FA.
Hub nhẹ (Node + claude -p), **không cần voice/GPU** → hợp VPS 2GB.

## 0. Prereq trên VPS (1 lần)
- Node 18+ (`node -v`), `npm i -g pm2`
- `claude` CLI đã **đăng nhập** trên VPS (Lucy gọi `claude -p`). Test: `claude -p "2+2" --output-format json`
- nginx + certbot: `apt install -y nginx certbot python3-certbot-nginx`
- 1 domain trỏ A-record về IP VPS (hoặc dùng IP, bỏ HTTPS — không khuyến nghị mở internet không TLS)
- Mở firewall 80/443: `ufw allow 80,443/tcp`

## 1. Lấy code + cấu hình
```bash
cd ~ && git clone https://github.com/billtruong003/L.U.C.Y.git lucy   # hoặc: cd ~/lucy && git pull
cd ~/lucy/hub
cp .env.example server/.env
nano server/.env
```
Đặt trong `server/.env`:
```
LUCY_HUB_PASSWORD=<mật khẩu mạnh>
LUCY_HUB_HOST=127.0.0.1          # chỉ nghe local, nginx proxy vào
CLAUDE_BIN=/root/.local/bin/claude   # `which claude` để lấy đúng path
LUCY_WORKDIR=/root/lucy/workspace
LUCY_PERSONA=/root/lucy/bridge/persona.md
LUCY_PROJECTS_ROOT=/root/lucy
LUCY_STATE=/root/.lucy-hub        # chứa 2FA secret, lịch, log, lịch sử chat
# (tuỳ chọn schedule đẩy Telegram) TELEGRAM_BOT_TOKEN=... LUCY_PUSH_CHAT_ID=...
```

## 2. Build + chạy
```bash
bash ~/lucy/hub/deploy.sh        # cài deps + build web + pm2 start
pm2 startup && pm2 save           # tự chạy lại khi reboot
```
Hub giờ ở `127.0.0.1:8800` (chỉ local).

## 3. Nginx + HTTPS
```bash
sudo cp ~/lucy/hub/nginx-lucy.conf.example /etc/nginx/sites-available/lucy
sudo nano /etc/nginx/sites-available/lucy        # đổi server_name = domain anh
sudo ln -s /etc/nginx/sites-available/lucy /etc/nginx/sites-enabled/lucy
sudo nginx -t && sudo systemctl reload nginx
sudo certbot --nginx -d lucy.example.com          # tự thêm 443 + redirect HTTPS
```

## 4. Vào dùng
- Mở `https://<domain>` → nhập mật khẩu → vào tab **Settings** → **Bật 2FA** (quét QR bằng Authenticator).
- Từ đó login cần mật khẩu + mã 6 số. Dùng được trên điện thoại (responsive).

## Cập nhật sau này
```bash
cd ~/lucy && git pull && bash hub/deploy.sh
```

---

## Prompt cho Claude trên VPS (anh paste cho claude ở VPS tự làm)
> Tôi cần deploy "Lucy Hub" (Node/React, repo đã clone ở `~/lucy`) lên VPS này, chạy always-on sau nginx + HTTPS.
> Làm theo `~/lucy/docs/DEPLOY_HUB.md`: kiểm prereq (node, pm2, nginx, certbot, claude CLI đã login), tạo `~/lucy/hub/server/.env`
> từ `.env.example` (hỏi tôi mật khẩu hub + domain; `CLAUDE_BIN` lấy từ `which claude`; `LUCY_HUB_HOST=127.0.0.1`),
> chạy `bash ~/lucy/hub/deploy.sh`, set `pm2 startup && pm2 save`, cấu hình nginx từ `hub/nginx-lucy.conf.example`
> (đổi domain), `nginx -t` + reload, rồi `certbot --nginx -d <domain>`. Báo tôi từng bước cần input. KHÔNG commit `.env`.
> Sau khi xong, kiểm `https://<domain>/api/me` trả JSON và nhắc tôi vào Settings bật 2FA.
