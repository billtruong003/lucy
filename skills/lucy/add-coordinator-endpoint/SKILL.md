---
name: lucy-add-coordinator-endpoint
description: "Thêm endpoint coordinator + proxy hub + api.ts client + UI, đúng convention 1-Lucy."
version: 1.0.0
author: Lucy
license: MIT
platforms: [linux]
metadata:
  lucy:
    tags: [coordinator, endpoint, hub, proxy, api, http, route, backend]
    related_skills: [lucy-deploy-no-bridge, lucy-autobuild-phase]
---

# Thêm endpoint coordinator (full stack 1-Lucy)

## Khi nào dùng
- Cần expose dữ liệu/hành động mới của agent-machine ra Hub UI hoặc bridge.

## Layers (luôn đi đủ tầng, đừng bỏ tầng)
1. **Logic** trong module riêng (vd `mcp-registry.ts`) — export hàm thuần, không I/O server. Gate bằng flag `LUCY_*` nếu là tính năng mới/rủi ro (mặc định TẮT cho live an toàn).
2. **Coordinator** (`agent-machine/src/coordinator.ts`): thêm nhánh
   ```ts
   if (req.method === 'GET' && url === '/skills') return send(200, skillsOverview())
   ```
   POST thì `const b = await readBody(req)` + validate `if (!b.x) return send(400, {error})`. Lỗi runtime → `send(502, {error: String(...)})`.
3. **Hub proxy** (`hub/server/src/index.ts`): `app.get('/api/skills', ...)` gọi `amFetch('/skills')`, auth-gated, trả `{ configured, ... }`; offline → `configured:false`.
4. **api.ts** (`hub/web/src/api.ts`): `export async function amSkills(): Promise<...>` fetch `/api/skills`.
5. **UI** (component dưới `hub/web/src/components/`): tái dùng class theme `.glass`/`.glass-hover`/`.hover-reveal`/`.num` (Jarvis Cockpit). Đăng ký tab trong `App.tsx` TABS + `GROUP_ORDER` nếu là tab mới.

## Luật
- Sort key ổn định (vd `.sort((a,b)=>a.id.localeCompare(b.id))`) để prompt-cache/UI ổn định.
- KHÔNG bịa shape mới — bám interface đang dùng.
- Smoke: thêm nhánh vào smoke liên quan, tsc 3 package sạch.

## Checklist
- [ ] logic module + flag (nếu cần)
- [ ] coordinator route + validate
- [ ] hub proxy auth-gated
- [ ] api.ts client typed
- [ ] UI tái dùng theme + đăng ký tab
- [ ] tsc 3 pkg + smoke sạch → deploy (xem lucy-deploy-no-bridge)
