# PLAN C2 — Stuck-detector → Lucy triage/split

## Mục tiêu
Card kẹt (rework lặp / loop-cap) → Lucy (opus) đọc lịch sử + báo cáo → **(a)** split 2–3 card con atomic
re-delegate, **(b)** nâng model lên opus, hoặc **(c)** escalate Bill có lý do. **Không loop vô hạn. tsc sạch.**

## Phát hiện chính (đã khảo sát — bám theo, đừng phát minh lại)
- **Tín hiệu "kẹt" ĐÃ CÓ sẵn**: loop-breaker ở `engine.ts:305-316`. Mỗi lần `rework` → `stageIndex--` →
  re-queue → vào lại stage → `stageVisits[stage]++` (`engine.ts:307`). Khi `> maxStageVisits` (default 3)
  → set `status='waiting_human', waitKind='loop'`. ⇒ **"rework≥2 OR visit≥cap" = đúng `waitKind==='loop'`.**
  KHÔNG cần thêm bộ đếm mới.
- **Mẫu opus-single-shot ĐÃ CÓ**: `autopilot.ts` (`claudeOneShot`, `lastJson`, `directorDecide/Answer/Cost`)
  + poller `autopilot-main.ts`. Triage = thêm 1 "director" cùng khuôn. Poller hiện **bỏ qua** `'loop'`
  (`autopilot-main.ts:40` — `'loop' → để Bill`) → đây là chỗ gắn triage.
- **Split = tái dùng cơ chế delegate** (`engine.ts:423-440`): tạo child `createCard(...,parentId,depth+1,...)`,
  `parent.blockedBy.push(child)`, `status='blocked'`, `blockKind='delegate'`. Khi con xong →
  `resolveUnblocks()` (`engine.ts:465-485`) tự `advanceCard(parent)`. Child kế thừa `pipelineId` của parent.
- **Bump model**: field `modelOverride` (`types.ts:59`); luật chọn model `engine.ts:349-353` CHỈ nâng
  sonnet→opus, không hạ. Set `modelOverride='opus'` + re-queue là đủ.
- **Escalate**: card cứ ở `waiting_human/loop`; poller `esc()` báo Bill (đã có).
- Engine chạy ở coordinator (có thể remote) → **KHÔNG import `claude` vào engine.ts**. Phần gọi opus nằm ở
  `triage.ts` + poller (process có claude); engine chỉ nhận *quyết định đã có* và áp.

## Kiến trúc (3 lớp, tách bạch như director hiện tại)
```
loop-cap (engine, đã có)  →  waitKind='loop'
        ↓ poll /state
autopilot-main (có claude) → directorTriage(card)  [triage.ts, opus single-shot]
        ↓ POST /triage {cardId, action, subtasks?}
engine.applyTriage()  → split | bump | escalate   (áp DAG, bounded)
```

## Các bước (mỗi bước ~1 commit + DoD)

### B1 — `types.ts`: thêm chống-loop field
- Thêm `triageCount?: number` vào `Card` (đếm số lần card đã được triage; chặn triage vô hạn).
- DoD: tsc sạch.

### B2 — `triage.ts` (mới): director triage opus
- Export `interface TriageDecision = { action:'split'; subtasks:{title:string;brief:string}[]; reason:string }
  | { action:'bump'; reason:string } | { action:'escalate'; reason:string }`.
- `export async function directorTriage(card, stageName, ctx?): Promise<TriageDecision>`:
  - Tái dùng `claudeOneShot`, `lastJson`, `cardEvidence`, `bigPic` từ `autopilot.ts` (export thêm nếu cần,
    hoặc import). Prompt nhồi: title, brief, `stageName`, **`card.history` (mẫu rework)** + `cardEvidence(card)`.
  - Tiêu chí trong prompt: task to/mơ hồ → **split** 2–3 card con ATOMIC (mỗi cái 1 việc nhỏ, "done" cụ thể);
    đúng hướng nhưng agent sai chi tiết & **chưa phải opus** → **bump**; cần Bill / bug ngoài tầm → **escalate**.
  - Validate: split phải có 2–3 subtasks (title+brief string không rỗng), else coi như escalate.
  - **Fail-safe**: parse fail 2 lần → trả `{action:'escalate'}` (giống `directorDecide` `engine.ts`/`autopilot.ts:79-80`).
- DoD: tsc sạch; `lastJson`/validate test được không cần claude.

### B3 — `engine.ts`: `applyTriage()` (áp quyết định, bounded)
- `applyTriage(cardId, d: TriageDecision): { ok:boolean; action:string }`. Guard đầu: card tồn tại &
  `status==='waiting_human' && waitKind==='loop'`, else no-op.
- **Chống loop vô hạn (cứng)** — quyết định bị ép escalate khi:
  - `(card.triageCount ?? 0) >= MAX_TRIAGE` (hằng số = 2), HOẶC
  - `action==='split'` mà `card.depth >= maxDepth` (depth-breaker), HOẶC
  - `action==='bump'` mà `modelOverride==='opus'` (đã opus, nâng nữa vô nghĩa).
  ⇒ trong các case này luôn rơi về escalate (card giữ `waiting_human/loop`).
- `split`: `card.triageCount=(…)+1`; tạo từng child `createCard(t.title,t.brief, card.pipelineId, card.id,
  card.depth+1, card.projectId)`; `card.blockedBy=children.ids`; `status='blocked'`; `blockKind='delegate'`;
  `stageVisits={}`; `putCard`. (Khi con xong → `resolveUnblocks` advance parent — đã có.)
- `bump`: `card.triageCount++`; `modelOverride='opus'`; `stageVisits={}`; `pendingQuestion=undefined;
  waitKind=undefined`; `status='queued'`; `putCard`. Post thread "⬆ nâng opus".
- `escalate`: KHÔNG đổi status (giữ waiting_human/loop để Bill thấy); post lý do; `putCard`.
- Mỗi nhánh `post(... threadOf(card.id) ...)` + `history.push` để Board/agent thấy.
- DoD: tsc sạch.

### B4 — `coordinator.ts`: endpoint `/triage`
- Thêm cạnh `/answer` (`coordinator.ts:74`):
  `if (POST && url==='/triage'){ const b=await readBody(req); return send(200,{ result: engine.applyTriage(b.cardId, b.decision) }) }`.
- DoD: tsc sạch.

### B5 — `autopilot-main.ts`: nhánh `'loop'` → triage
- Đổi filter `autopilot-main.ts:40`: cho `'loop'` đi tiếp (không skip).
- Nhánh mới (song song gate/decision/cost): nếu `waitKind==='loop'`:
  - `isProtectedGate` → `esc('pipeline bảo vệ — để Bill','loop')` (không auto-split security).
  - else `const d = await directorTriage(c, sn, ctx); decisions++`.
    - `d.action==='escalate'` → `esc(d.reason,'loop')`.
    - else `say('🌙 Lucy triage … (split N | bump)')` + `POST('/triage',{cardId,decision:d})`.
  - Dùng lại `inFlight`/`escalated`/`MAX` (đã có) — chống re-fire mỗi tick.
- DoD: tsc sạch; chạy poller không lỗi.

### B6 — `smoke-triage.ts` (mới): DoD nghiệm thu (KHÔNG cần claude)
- Pure: validate `directorTriage` split-arity + `lastJson` (như smoke-autopilot phần pure).
- Deterministic E2E engine in-process: Runner giả luôn trả `rework` → tick tới khi
  `status==='waiting_human' && waitKind==='loop'`. Rồi:
  1. `applyTriage(id,{action:'split',subtasks:[A,B]})` → assert **≥2 child** (parent.blockedBy.length≥2),
     parent `status==='blocked'`, `stageVisits` reset. → thoả "card kẹt → ≥2 subtask".
  2. card đã `modelOverride:'opus'` → `applyTriage(...,{action:'bump'})` ⇒ **ép escalate** (vẫn waiting_human/loop).
  3. `triageCount>=2` → mọi action ⇒ **escalate**. → thoả "HOẶC escalate; không loop vô hạn".
- (Tùy chọn, có claude) gọi `directorTriage` thật 1 card to → in action.
- Thêm script vào `package.json` (mục `smoke-*`) cho đồng bộ.
- DoD: `tsx src/smoke-triage.ts` xanh; `tsc --noEmit` sạch toàn repo.

## Rủi ro & giảm
- **Loop vô hạn (con kẹt → triage → split tiếp)**: chặn 3 lớp ở B3 (triageCount cap, depth-breaker, opus-cap)
  → cùng lắm tụt về escalate. Đây là DoD "không loop vô hạn".
- **Engine dính claude**: tránh — opus chỉ ở triage.ts/poller; engine chỉ `applyTriage` thuần.
- **Child mồ côi pipeline**: child kế thừa `pipelineId` parent (như delegate), không để model bịa id.
- **Triage re-fire mỗi poll**: sau split→`blocked`, sau bump→`queued` (rời khỏi loop-state); escalate dùng
  `escalated` set. An toàn.

## Builder lưu ý
- BÁM khuôn `autopilot.ts` (claudeOneShot/lastJson/cardEvidence/bigPic) — export lại thay vì copy.
- `MAX_TRIAGE=2`, đặt hằng số có tên (không magic number).
- Outcome contract & model-không-hạ-cấp là LUẬT — không phá.
