---
name: lucy-rehost
description: "Rehost sạch toàn bộ Lucy sau auto-build — tsc-gate, build web, restart hết rồi báo Telegram."
version: 1.0.0
author: Lucy
license: MIT
platforms: [linux]
metadata:
  lucy:
    tags: [rehost, deploy, restart, build, telegram, autobuild, gate]
    related_skills: [lucy-deploy-no-bridge, lucy-autobuild-phase]
---

# Rehost Lucy sạch (sau khi auto-build dừng)

## Khi nào dùng
- Cuối chuỗi auto-build đêm, đưa toàn bộ code mới lên LIVE 1 lần (gồm cả bridge cho lane-tool).
- Script tham chiếu: `/root/lucy/.rehost-after-stop.sh`.

## Quy trình (theo .rehost-after-stop.sh)
1. Chờ `lucy-autobuild` dừng (poll `pm2 jlist`, tối đa ~45').
2. **tsc-gate**: `agent-machine` + `hub/server` tsc phải SẠCH. Còn lỗi → KHÔNG rehost, báo Telegram, exit (tránh deploy code lỗi).
3. Build web: `cd hub/web && npm run build`.
4. `pm2 restart lucy-hub lucy-coordinator lucy-autopilot lucy-vps-worker` rồi `pm2 restart lucy-bridge` (rehost cuối ĐƯỢC restart bridge — khác vòng auto giữa chừng).
5. Báo Telegram kết quả + nhắc hard-refresh Hub (Ctrl+Shift+R).

## Khác biệt quan trọng
- **Trong vòng auto-build**: KHÔNG restart bridge (xem lucy-deploy-no-bridge).
- **Rehost cuối cùng**: được restart bridge để lane-tool live.

## Checklist
- [ ] autobuild đã dừng
- [ ] tsc-gate sạch (nếu lỗi → báo + dừng, KHÔNG rehost)
- [ ] web build
- [ ] restart hết + bridge
- [ ] Telegram báo + log rehost.log
