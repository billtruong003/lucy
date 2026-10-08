# Lucy Agent Machine — walking skeleton

Bộ máy multi-agent kiểu **Kanban** (xem [../docs/AGENT_MACHINE.md](../docs/AGENT_MACHINE.md)).
Đây là **walking-skeleton**: chứng minh lõi end-to-end **không đốt token** (MockRunner), trước khi cắm
durable infra thật (Postgres + pg-boss + DBOS) ở M2.1.

## Chạy
```bash
cd lucy/agent-machine
npm install
npm run demo        # MockRunner — KHÔNG gọi claude, không tốn token
npm run smoke       # smoke test có assertion (exit 1 nếu fail) — 13 check
npm run typecheck   # tsc --noEmit
```

## Guardrails (token + an toàn)
- **Budget**: cộng dồn theo cửa **5h + tuần**, chạm cap → engine **PAUSE** (ngừng phát card).
- **Per-card cost cap**: 1 card đốt quá ngưỡng → `waiting_human` (chờ duyệt).
- **Depth-breaker**: delegate vòng quá sâu → HALT (chống đẻ card vô hạn).
- **Workspace cô lập** mỗi card (→ git worktree ở M2.1) + path-guard.

## Config-là-DATA (cửa extend)
`config/personas/*.json` + `config/pipelines/*.json` → nạp bằng `loadConfig()`. Thêm persona/pipeline =
thêm file, KHÔNG sửa engine. Lucy tự ghi file này từ prompt + ảnh (M2.6).

## Demo chứng minh (đúng ví dụ portal)
`content soạn course → STUCK web không render → delegate sang engineer → HOLD →
engineer fix xong → RESUME → review (GATE) → Bill duyệt → ship → DONE`

→ Validate: **card→stage→runner→outcome→advance**, **delegate/blockedBy (DAG hold/resume)**,
**gate (HITL waiting_human + approve)**, **channels** (msg-as-data Bill đọc), **budget guard** (cửa 5h, cap → pause),
**workspace cô lập** mỗi card, **cap lane**.

## Chạy phân tán (topology thật: coordinator VPS + worker local)
```bash
# VPS (nhẹ, always-on) — KHÔNG chạy claude:
AM_TOKEN=<secret> AM_PORT=8780 AM_DATA=~/.agent-machine npm run coordinator

# Máy LOCAL (mạnh) — chạy claude -p thật, quay ra coordinator:
AM_COORD_URL=http://<vps-ip>:8780 AM_TOKEN=<secret> AM_RUNNER=claude npm run worker
```
Coordinator giữ board/queue/channels (KHÔNG spawn claude). Worker claim job qua HTTP → chạy
`claude -p` trên máy local → submit kết quả. Máy local tắt → **VPS worker (cap 2) gánh**; bật → worker nặng hút bulk.
`AM_RUNNER=mock` (mặc định) để test đường truyền không đốt token. `npm run smoke:remote` kiểm topology.

**Queue dynamic + stacking:** mỗi worker chạy `AM_WORKER_CONCURRENCY` claude -p song song. Khi cap đầy,
việc mới **xếp hàng (`queued`) chạy sau — KHÔNG bị bỏ**. Chỉnh queue width LÚC ĐANG CHẠY:
`POST /config {"maxLanes":N}` (header `x-worker-token`); `GET /config` xem hiện tại + số `queued`/`inFlight`.

## Cấu trúc
```
src/
├── types.ts            # Card / Stage / Pipeline / Persona / Outcome  (config-là-data)
├── store.ts            # persistence file-based (swap Postgres ở M2.1)
├── workspace.ts        # dir cô lập / blast-radius (→ git worktree)
├── budget.ts           # guardrail token: cửa 5h + tuần
├── channels.ts         # message bus mỏng
├── config.ts           # nạp personas/pipelines từ config/*.json (cửa extend)
├── runner.ts           # MockRunner (free) | ClaudeRunner (claude -p) 
├── guard.ts            # FS defense: isWithin/isProtected/looksDangerous
├── worktree.ts         # git worktree blast-radius (xoá bậy chỉ chết worktree)
├── engine.ts           # dispatch(tick) → queue → claim/submit; guardrails; DAG
├── coordinator.ts      # HTTP server (VPS): /tick /worker/claim /worker/result /card /approve /state
├── worker.ts           # worker dial-out: claim → run → submit
├── coordinator-main.ts # entry chạy coordinator (VPS)
├── worker-main.ts      # entry chạy worker (local)
├── demo.ts             # kịch bản end-to-end (local mode)
├── smoke.ts            # 13 assertion (local)
└── smoke-remote.ts     # 7 assertion (coordinator + worker qua HTTP)
```

## Dùng Claude THẬT (đốt token — cẩn thận)
Đổi `new MockRunner(...)` → `new ClaudeRunner()` trong `demo.ts` (cần `claude` CLI trong PATH).
ClaudeRunner ép persona kết thúc bằng JSON outcome, parse `total_cost_usd`/`usage` cho ledger.

## Trạng thái
- ✅ Engine queue (dispatch/claim/submit) + 6 guardrail (budget cửa, per-card cap, depth/loop-breaker, gate, workspace cô lập).
- ✅ Config-là-data (personas/pipelines từ file).
- ✅ **Coordinator(VPS) ↔ worker(local) dial-out** qua HTTP (token auth) — tested 2 process.
- ⏳ Tiếp: Postgres + pg-boss + DBOS (durable, deploy VPS) · git worktree thật + restricted user · wire hub UI (Board + Channels tab).
