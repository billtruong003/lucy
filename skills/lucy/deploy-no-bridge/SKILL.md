---
name: lucy-deploy-no-bridge
description: "Deploy/restart dịch vụ Lucy an toàn — KHÔNG đụng lucy-bridge, giữ env qua /proc."
version: 1.0.0
author: Lucy
license: MIT
platforms: [linux]
metadata:
  lucy:
    tags: [deploy, pm2, restart, bridge, env, coordinator, worker, hub]
    related_skills: [lucy-add-coordinator-endpoint, lucy-autobuild-phase]
---

# Deploy Lucy không đụng bridge

## Khi nào dùng
- Restart `lucy-coordinator`, `lucy-hub`, `lucy-vps-worker`, `lucy-autopilot` sau khi sửa code.
- Bất kỳ thao tác `pm2 restart` nào trong vòng tự động.

## Luật cứng
- **TUYỆT ĐỐI KHÔNG restart `lucy-bridge`** trong vòng auto. Bridge = đường Telegram sống; restart làm rớt phiên + có thể 409 nếu trùng bot token.
- **KHÔNG `pm2 restart --update-env` với env rỗng** → mất `AM_DATA`/`LUCY_VAULT`. Live worker chạy qua npm (tên `lucy-vps-worker`), env phải tái dựng.

## Quy trình
1. tsc-gate trước: `cd agent-machine && npx tsc --noEmit` (+ `hub/server`, `hub/web` nếu đụng UI) phải SẠCH.
2. Hub UI đổi → `cd hub/web && npm run build` trước khi restart `lucy-hub`.
3. Restart ĐÚNG service liên quan, ví dụ: `pm2 restart lucy-coordinator lucy-hub`.
4. Env mới cần thêm → tái dựng qua `/proc/<pid>/environ` rồi `pm2 restart <svc> --update-env` và `pm2 save`. KHÔNG dùng ecosystem với env trống.
5. Verify live: gọi endpoint/health, đọc `pm2 logs <svc> --lines 30 --nostream`.

## Checklist
- [ ] tsc 3 package sạch
- [ ] web build (nếu đụng UI)
- [ ] restart KHÔNG gồm lucy-bridge
- [ ] verify endpoint sống + logs không lỗi
- [ ] `pm2 save`
