# Lộ trình

[English](../ROADMAP.md)

Bản dựng lại ra theo từng giai đoạn. Mỗi giai đoạn gồm một hoặc vài PR, và sau mỗi giai đoạn `main` vẫn chạy được.

## Giai đoạn 0: Nền móng
- [x] Repo, giấy phép, README (en/vi), kiến trúc
- [ ] pnpm workspace, cấu hình TypeScript, lint/format, vitest
- [ ] CI: typecheck, test, quét secret bằng gitleaks
- [ ] `packages/config` (schema) + `lucy doctor`
- [ ] `packages/i18n` (en, vi)

## Giai đoạn 1: Lõi trợ lý
- [ ] `packages/core`: phiên Claude sống, persona, chính sách quyền, usage
- [ ] `packages/memory`: vault, recall, dream, che secret (chuyển sang kèm test)
- [ ] `apps/telegram`: viết lại bridge (lệnh /new /stop /model /persona /info)
- [ ] `apps/cli`: `init`, `start`, `doctor`
- [ ] `vault-template/`

## Giai đoạn 2: Server và web
- [ ] `packages/server`: auth, chat + SSE, bộ nhớ, lịch, cài đặt
- [ ] `apps/web` v1 gồm 6 màn: Chat · Bộ nhớ · Bảng việc · Tự động · Công cụ · Cài đặt
- [ ] Theme trung tính mặc định, lint ép dùng design token, route tải lười

## Giai đoạn 3: Engine đa agent
- [ ] `packages/engine`: thẻ, pipeline, worker (git worktree), autopilot, ngân sách, token guard
- [ ] Giao diện bảng việc, giao việc từ chat
- [ ] `packages/llm`: lane kiểu OpenAI + router

## Giai đoạn 4: Cài đặt và tài liệu
- [ ] Docker image + compose, ví dụ systemd/pm2/nginx
- [ ] Tài liệu (en/vi): cài đặt, cấu hình, bộ nhớ, engine, skill, plugin, bảo mật
- [ ] Plugin API + plugin đầu tiên (google, discord)

## Giai đoạn 5: Ra mắt public
- [ ] Review bảo mật, test end-to-end
- [ ] Ảnh/video demo, tag v0.1.0, mở repo public
