# PLAN — Lớp hứng log execution của agent (turns.jsonl)

## Mục tiêu
Ghi mỗi **turn** của agent ra JSONL có cấu trúc để truy vết **vì sao agent (nhất là lane/free) kẹt turn mà không ra outcome**.
Trường: agent, task, pipeline-stage, motive (đang định làm gì), action, outcome/error, turn-count, token.

## Khảo sát — sự thật cốt lõi (đừng vẽ lại)
- **Turn chỉ "nhìn thấy được" trong `LaneRunner`** (`src/lane-runner.ts:87` vòng `for i < maxTurns`). Mỗi vòng:
  motive = `msg.content` (model nói định làm gì) · action = `msg.tool_calls` · outcome/error = kết quả `execTool` ·
  token = `r.usage`. **Đây đúng chỗ free agent churn hết turn không ra JSON** → trọng tâm instrument.
- **`ClaudeRunner` (`src/runner.ts:85`) là hộp đen**: 1 spawn `claude -p --output-format json`, chỉ có JSON cuối.
  Per-turn KHÔNG lấy được nếu không đổi sang `stream-json` (scope lớn → tách card sau). Giờ chỉ log **mức-run** (start/end).
- **Runner tách rời `Store`** — nhận `(card, stage, persona, ws)`, chạy trên worker. ⇒ KHÔNG với tới `store.dir`.
  Giải: **inject `TurnLogger` qua constructor**, đường ghi lấy từ env `AM_TURNS_LOG` (không set → tắt, no-op).
- Convention log append-only đã có: `store.appendLedger` → `ledger.jsonl`; `metrics.ts` đọc lại. Turn-log bám y hệt.

## Thiết kế (đơn giản đủ dùng)
1. **`TurnRecord` (type, `src/types.ts`)** — 1 dòng JSONL:
   `ts, runId, cardId, task, stage, stageName, agent, model, runner('lane'|'claude'|'mock'),`
   `turn(number; -1 = mức-run), phase('start'|'turn'|'end'), motive?, action?, outcome?, error?, inTok?, outTok?`
   - `runId` gom mọi turn của **1 lần `runner.run()`** (1 stage-run).
2. **`TurnLogger` (file mới `src/turn-log.ts`)** — bám pattern `appendLedger`:
   - constructor `(file?: string)`; không có file & không có `AM_TURNS_LOG` → **disabled (no-op)** (zero-config an toàn).
   - `begin(meta)` → ghi record `phase:'start'`, trả handle gắn sẵn `runId` + meta tĩnh; handle có `event(partial)`.
   - **Truncate tập trung trong logger**: motive ≤500, action ≤200, outcome ≤300. KHÔNG log full nội dung `write_file`
     (chỉ `write_file(path, <N ký tự>)`). KHÔNG echo secret. Append đồng bộ (như ledger/channels — chấp nhận được, ≤200 turn).
3. **Wire `LaneRunner`** (TRỌNG TÂM): `begin()` trước vòng lặp; mỗi turn `event({turn:i, motive, action, outcome|error, inTok, outTok})`;
   lúc return outcome / salvage / lane-error → `event({phase:'end', outcome|error})`.
4. **Wire `ClaudeRunner`** (thô): `event(start)` trước spawn, `event(end)` sau parse (decision, cost, có NO_JSON/salvage?, thời lượng).
5. **Inject ở `src/worker-main.ts`**: tạo **1** `TurnLogger`, truyền vào `ClaudeRunner`/`LaneRunner`/`CompositeRunner`.
   `MockRunner` (autopilot/coordinator-main) bỏ qua — không có turn thật.

## Các bước (mỗi bước ~1 commit + DoD)
- **B1 — Type + TurnLogger.** Thêm `TurnRecord` (types.ts) + `src/turn-log.ts` (env-driven, disabled mặc định).
  *DoD:* `npx tsc --noEmit` sạch; smoke nhỏ (set `AM_TURNS_LOG=/tmp/t.jsonl`, gọi begin/event, đọc lại file đúng shape; không set → không tạo file).
- **B2 — Wire LaneRunner + inject ở worker-main.** Instrument vòng lặp (motive/action/outcome/error/token mỗi turn + end).
  *DoD:* tsc sạch; chạy `AM_RUNNER=lane` 1 card (hoặc smoke giả `callLLMRaw`) → `turns.jsonl` có ≥1 'start', N 'turn', 1 'end'; field khớp.
- **B3 — Wire ClaudeRunner (mức-run).** start/end bao quanh spawn.
  *DoD:* tsc sạch; 1 run claude (hoặc mock spawn) → có cặp start/end, end mang decision + cost.
- **B4 (DEFER, card riêng) — claude per-turn qua `--output-format stream-json`.** KHÔNG làm trong card này (đổi parsing + cost extraction, rủi ro).

## Builder lưu ý
- **KHÔNG** đổi chữ ký `Runner.run` (contract). Logger là tham số constructor optional → call site cũ (`new LaneRunner()`) không gãy.
- **KHÔNG** nuốt lỗi ghi log làm gãy vòng đời card: ghi turn-log bọc try/catch nội bộ, lỗi → im (giống `distill` fire-and-forget).
- Strict: không `any` (dùng `unknown`+narrow), không magic number (hằng cap đặt tên), validate `file` ở biên.
- Truncate đúng cap ở B1 để B2/B3 chỉ việc gọi — đừng rải `.slice` khắp runner.

## Cần Bill quyết (nếu builder phân vân)
- Đường ghi mặc định: tôi chọn **env `AM_TURNS_LOG`, không set → tắt** (opt-in, an toàn, không phình đĩa khi chưa cần). Nếu muốn **bật mặc định** ghi cạnh `ledger.jsonl` → cần truyền `store.dir` xuống worker (thêm wiring) — đổi phạm vi, hỏi trước.
- Reader/viewer trên hub (đọc `turns.jsonl` như `metrics.ts`) = **card sau**, không thuộc lớp hứng này.
