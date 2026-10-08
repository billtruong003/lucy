# Lucy Hub — web command center (full Node/TS: React + Express)

Web để chủ nhân **login qua IP** → chat với Lucy (claude -p) + (sau) sections sci-fi. Standalone, KHÔNG Hermes, **toàn JS/TS**.

```
Trình duyệt (IP) ──► Express (server/) ──► claude -p (brain) ──► trả về
                       login + job nền + poll       + serve React build (web/dist)
Frontend: Vite+React+TS+Tailwind (web/) — dev proxy /api -> :8800
```

## Cấu trúc
```
hub/
├── package.json        # script tiện: setup / build / start / dev
├── server/             # backend Express + TypeScript
│   └── src/index.ts    #   /login /api/me /api/send /api/poll + serve web/dist  (engine: claude -p)
└── web/                # frontend Vite + React + TS + Tailwind
    └── src/ App · components/Login · components/Chat · api.ts
```

## Chạy END-TO-END (máy có Node 18+ + claude CLI)
```bash
cd ~/lucy/hub
npm run setup                       # cài deps web + server
cd server && cp .env.example .env || true   # (env đặt ở dưới)

# đặt env (cùng shell chạy server):
export LUCY_HUB_PASSWORD='matkhau-manh'
# export CLAUDE_BIN=/root/.local/bin/claude   # nếu claude không trong PATH

# PROD (1 process): build web rồi chạy server serve luôn
cd ~/lucy/hub && npm run build && npm start    # → http://<IP>:8800

# DEV (hot-reload, 2 cửa sổ):
#   cửa 1:  cd hub/server && LUCY_HUB_PASSWORD=... npm run dev
#   cửa 2:  cd hub/web && npm run dev           → http://localhost:5173 (proxy /api)
```
Always-on: `pm2 start "npm start" --name lucy-hub --cwd ~/lucy/hub` (nhớ export env trước, hoặc dùng ecosystem file).

## Env (server đọc từ process env)
- `LUCY_HUB_PASSWORD` (bắt buộc) · `LUCY_HUB_PORT` (8800) · `CLAUDE_BIN` · `LUCY_WORKDIR` · `LUCY_PERSONA` · `LUCY_CLAUDE_TIMEOUT`

## 🔐 Bảo mật
- Bind `0.0.0.0` = ai trong mạng cũng tới → **mật khẩu MẠNH bắt buộc**. Mở Internet → **HTTPS** (nginx/caddy) + cân nhắc **2FA** (H1.5).
- Cookie httpOnly; token phiên trong RAM. Hub điều khiển claude bypassPermissions → cửa quan trọng.

## Roadmap
- **H1 (giờ):** login + chat + progress. ✅
- **H1.5:** 2FA Telegram-approve · render markdown · SSE progress.
- **H2:** sections — Running tasks · Projects (board + source tree) · Logs/Cost · Inject-API.
- **H3:** brain-viz three.js (Iron Man).
