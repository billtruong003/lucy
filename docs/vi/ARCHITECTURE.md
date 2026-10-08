# Kiến trúc

[English](../ARCHITECTURE.md)

## Mục tiêu

1. **Một lần cài, một process.** `lucy start` chạy đủ mọi thứ cho một người dùng. Tách process (ví dụ worker ở máy khác) là tuỳ chọn, không bắt buộc.
2. **Trợ lý và engine đa agent đều là phần chính.** Chat có bộ nhớ là thứ dùng hằng ngày. Card engine là thư viện, điều khiển được từ chat, từ bảng trên web hoặc từ code của bạn.
3. **Mọi thứ cá nhân là dữ liệu, không phải code.** Tên chủ, persona, ngôn ngữ, cấu trúc vault, lịch chạy và danh sách model nằm trong config và vault, không bao giờ nằm trong source.
4. **Mặc định an toàn.** Chỉ nghe localhost, từ chối người lạ nhắn vào, và không chạy Claude ở chế độ bỏ qua quyền nếu bạn không tự bật.
5. **Hai ngôn ngữ.** Mọi chuỗi hiển thị và system prompt đều có bản `en` và `vi`.

## Công nghệ

Toàn bộ TypeScript (Node 20+, ESM), quản lý bằng pnpm workspace.

Lucy cũ có bridge Telegram viết bằng Python chạy cạnh các service TypeScript. Bản mới chuyển bridge sang TypeScript vì ba lý do: chỉ một lần cài và một schema config; channel gọi thẳng `core` và `memory` trong cùng process thay vì qua HTTP; và Claude Agent SDK hỗ trợ TypeScript đầy đủ nhất.

Lưu trữ bằng SQLite (`better-sqlite3` + `sqlite-vec`) cho index, phiên chat và bảng việc, cộng với vault Markdown cho bộ nhớ. Không cần chạy database riêng.

## Cấu trúc

```
packages/
  config/    schema (zod) + loader: lucy.config.yaml + .env → Config có kiểu
  i18n/      chuỗi giao diện và mẫu prompt (en, vi)
  core/      quản lý phiên Claude (client SDK sống, ngắt, xoay phiên),
             persona, dựng prompt, chính sách quyền, đếm usage
  memory/    đọc/ghi vault, recall (FTS5 + vector + rerank), signal/evidence,
             dream (gộp trí nhớ), che secret; embedder thay được
  engine/    thẻ việc, bảng, pipeline, worker, autopilot, ngân sách, token guard
  llm/       một adapter kiểu OpenAI + catalog do người dùng khai + router
  server/    HTTP API (mỗi tính năng một file route), auth/phiên, SSE, lịch chạy
apps/
  cli/       lucy init | start | doctor | dream | reindex
  web/       ứng dụng React
  telegram/  adapter kênh Telegram
plugins/     tích hợp tuỳ chọn (google, discord, dữ liệu thị trường, …)
vault-template/
deploy/      ví dụ docker-compose, systemd, pm2, nginx
```

Chiều phụ thuộc: `config, i18n ← memory, llm ← core ← engine ← server ← apps/*`. Package chỉ import `index.ts` công khai của nhau. Plugin đăng ký qua plugin API, không import theo đường dẫn.

## Một tin nhắn đi qua những đâu

1. Adapter kênh gọi `core.handle(turn)`.
2. Recall gate quyết định có cần bộ nhớ không, rồi `memory.recall` trả về các đoạn liên quan đã xếp hạng.
3. Dựng prompt: persona + ngôn ngữ + ngữ cảnh nhớ lại + phiên.
4. Phiên Claude (giữ sống theo từng hội thoại) stream câu trả lời về adapter.
5. Sau lượt: ghi usage và ghi signal vào inbox của vault cho lượt dream tiếp theo.

Việc lớn thành thẻ (`engine.createCard`). Tiến độ được báo về đúng hội thoại đã giao việc.

## Cấu hình

- `lucy.config.yaml`: cấu hình không bí mật (chủ, ngôn ngữ, persona, đường dẫn vault, kênh, model, ngân sách, lịch, plugin).
- `.env`: chỉ chứa secret (token Telegram, hash mật khẩu web, key provider).
- `lucy doctor` kiểm tra cả hai theo schema và giải thích từng giá trị thiếu hoặc sai.

Code cũ có khoảng 130 cờ `LUCY_*`/`AM_*` rải rác. Bản mới chỉ giữ một bộ nhỏ có tài liệu. Tính năng thử nghiệm nằm dưới mục `experimental:` trong config.

## Bảo mật

- Server nghe `127.0.0.1`. Muốn mở ra ngoài thì đi qua reverse proxy có TLS (ví dụ trong `deploy/`).
- Đăng nhập web bằng mật khẩu đã hash, phiên có hạn phía server, giới hạn số lần đăng nhập, TOTP tuỳ chọn.
- Kênh chat chỉ trả lời các user ID trong danh sách cho phép.
- Quyền của Claude mặc định là danh sách tool cho phép theo từng persona. `bypassPermissions` phải tự bật cho từng persona và có cảnh báo khi khởi động.
- Worker chạy mỗi thẻ trong một git worktree riêng.
- Secret được che trước khi ghi vào vault hoặc log.

## Giữ lại gì từ Lucy bản riêng

- **Engine phiên Claude sống** (ngắt, xoay phiên, mang ngữ cảnh sang phiên mới): từ `bridge/lucy_bridge.py`, viết lại bằng TS.
- **Recall, dream, signal/evidence, che secret, consolidate:** từ `agent-machine/src`.
- **Card engine, worker, autopilot, ngân sách, token guard:** từ `agent-machine/src`.
- **Router lane:** gộp 4 file thành 1 adapter.
- **Giao diện Chat, Bộ nhớ, Lịch, Cài đặt:** từ `hub/web`, thiết kế lại.
- **Skill do Lucy tự viết.**

Bỏ hẳn: brief và trade riêng, dự án khách hàng, plugin Hermes, portal cũ, giao diện dọn VPS, canvas vẽ, và các skill bên thứ ba vendored (người dùng tự cài; Lucy chỉ kèm vài skill chọn lọc có ghi công).
