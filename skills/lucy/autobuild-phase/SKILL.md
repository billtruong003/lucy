---
name: lucy-autobuild-phase
description: "Chạy 1 nhóm task auto-build theo MASTER doc — đọc spec, implement, tsc+smoke, cập nhật doc."
version: 1.0.0
author: Lucy
license: MIT
platforms: [linux]
metadata:
  lucy:
    tags: [autobuild, phase, tsc, smoke, master, spec, task, execution]
    related_skills: [lucy-deploy-no-bridge, lucy-add-coordinator-endpoint]
---

# Auto-build 1 nhóm task (vòng đêm)

## Khi nào dùng
- Vòng tự động không người, làm 1 nhóm task ⏳ liên quan theo MASTER-EXECUTION doc.

## Quy trình
1. Đọc doc execution → chọn NHÓM task ⏳ cùng vùng kế tiếp. BỎ QUA task cần thiết kế/chủ nhân (creds, OAuth, set ngưỡng, UI cần duyệt thẩm mỹ).
2. Đọc code liên quan TRƯỚC khi sửa → bám stack/convention, dệt vào "MỘT Lucy", không bịa shape.
3. Implement TẤT CẢ task trong nhóm. Tính năng mới/rủi ro → sau flag `LUCY_*` mặc định TẮT (live an toàn).
4. Gate: `cd agent-machine && npx tsc --noEmit` + smoke liên quan; hub → tsc `hub/server` + `hub/web` + `npm run build`. CÒN BUG → FIX tới SẠCH, không bỏ dở.
5. Clean dup. Deploy service liên quan (KHÔNG bridge — xem lucy-deploy-no-bridge). Verify live.
6. Cập nhật ✅ TỪNG task trong doc. Ghi memory/vault nếu đáng.

## Luật an toàn
- KHÔNG git push · KHÔNG xoá data · KHÔNG auto-active skill · KHÔNG bật LUCY_CONSOLIDATE_APPLY.
- Phần cần creds → chỉ SCAFFOLD + DOC, không tự auth, không treo chờ nhập.
- Smoke fail không fix nổi → ghi lại + AUTOBUILD: NEEDS_HUMAN, sang nhóm kế.

## Dòng cuối (BẮT BUỘC, là dòng cuối cùng)
- `AUTOBUILD: DONE — <nhóm + task> — <tóm tắt + verify>` hoặc `ALL_DONE` / `NEEDS_HUMAN — <task + lý do>`.
