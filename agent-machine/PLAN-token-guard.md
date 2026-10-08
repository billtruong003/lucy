# PLAN — Autopilot minh bạch + token-guard

Card: **Autopilot minh bạch + token-guard**. Stage: thiết kế → giao builder.

## Mục tiêu (DoD của card)
- (a) **Minh bạch**: mọi quyết định TỰ ĐỘNG của Lucy (trực đêm) hiện rõ nhãn "Lucy" + **lý do**, phân biệt với hành động tay của Bill — trên cả board (card) lẫn channel.
- (b) **token-guard** (token/NGÀY, lịch theo ngày):
  - vượt `AM_DAY_TOKEN_SOFT` → autopilot **hạ executor xuống model rẻ nhất** + **cảnh báo Telegram** (1 lần/ngày).
  - vượt `AM_DAY_TOKEN_HARD` → **tạm dừng nhận card** (engine ngừng dispatch, như budget cap).
- Smoke giả lập guard kích hoạt (soft→thrift, hard→pause) + Gyomei review (gate cuối).

## Bối cảnh đã khảo sát (bám stack, KHÔNG bịa shape)
- `Budget` (src/budget.ts): guardrail **USD** rolling window (5h/tuần). `events:[{ts,usd}]`, `check()→{ok,soft}`. token-guard sẽ là **anh em song song** (cùng khuôn, đếm TOKEN/ngày).
- `Engine` (src/engine.ts): `tick()` dispatch (đã có `paused` khi budget cap), `claim()` resolve model (đã có chỗ override model/laneModel/skill vào persona), `submit()` cộng `cost` + `budget.add()` + `appendLedger()`. → token-guard cắm đúng 3 chỗ này.
- `claim()` dòng ~342: model claude override; persona executor mang `persona.laneModel`. CompositeRunner (worker-main.ts) định tuyến: có `laneModel`+key lane → LaneRunner (rẻ), else claude -p.
- Executor personas: 5 cái, `kind:"executor"`, `laneModel` = `devstral-med`/`ds-v4-flash-free`.
- Catalog (src/llm-lane.ts): `MODEL_CATALOG` + `FALLBACKS.executor[0]='ds-v4-flash-free'` (free) = ứng viên "rẻ nhất".
- Autopilot (src/autopilot-main.ts): process riêng, poll `/state` 6s, đã post nhãn `🌙 Lucy trực đêm —…` ra channel `general`. NHƯNG khi nó `/approve`, engine.approve() post author **'bill'** → **lẫn** với Bill tay (lỗ hổng minh bạch chính).
- **KHÔNG có Telegram trong agent-machine** (chỉ bridge python có `TELEGRAM_BOT_TOKEN`). → thêm helper notify gọn (Node fetch, no dep), no-op nếu thiếu env.
- `/approve` `/reject` `/answer`: hub gửi `{cardId}` (= Bill tay); autopilot gửi thêm `actor:'lucy'`. Mặc định `actor='bill'` → **backward-compat**.

## Thiết kế (chốt)
**Tách vai rõ**: *engine (coordinator) CƯỠNG CHẾ* guard (đếm token + thrift downgrade + hard-pause vì dữ liệu token nằm ở đây); *autopilot ANNOUNCE* qua Telegram khi đổi mức (nó là "người" trực đêm, đã sở hữu nhắn tin). Không double-send: channel do engine post, Telegram do autopilot.

Lý do split (không gộp hết vào engine): tránh ghép engine→Telegram; đúng câu chữ card "autopilot … cảnh báo Telegram"; autopilot đã poll /state sẵn nên bắt được chuyển mức.

---

## Các bước (mỗi bước ~1 commit + DoD)

### B1 — `TokenGuard` (lõi thuần, song song Budget) + cheapest-executor helper
- **Thêm** `src/token-guard.ts`: class `TokenGuard` cùng khuôn `Budget`.
  - cfg `{ softTokens:number; hardTokens:number }`.
  - `events:{ts:number;tok:number}[]`; `add(c:Cost)` → push `{ts:now, tok:c.inTok+c.outTok}`.
  - `dayTokens(now=Date.now())`: tổng tok trong **ngày-lịch hiện tại** (mốc = đầu ngày local 00:00, KHÔNG phải rolling 24h — "token ngày" = theo lịch). Hằng số mốc đặt tên, không magic.
  - `check(now)` → `{ level:'ok'|'soft'|'hard'; dayTokens:number; reason?:string }` (hard ưu tiên hơn soft).
  - Inject `now` được (cho smoke). KHÔNG đụng I/O.
- **Thêm** `src/llm-lane.ts`: `export function cheapestExecutorKey(): string` = model `role:'executor'` đầu tiên trong `FALLBACKS.executor` mà `free && có key` (fallback: `FALLBACKS.executor[0]`). Có hằng số/đặt tên rõ "rẻ nhất".
- **DoD**: `tsc` sạch; unit nhỏ trong smoke (B5) gọi được.
- **Builder lưu ý**: dùng `c.inTok + c.outTok`. Mốc ngày: `new Date(now).setHours(0,0,0,0)`.

### B2 — Engine cắm token-guard (cưỡng chế)
- `Engine` thêm field `tokenGuard: TokenGuard` (ctor nhận vào, **optional** để test cũ không gãy), `thrift=false`, `private tokenWarnedDay?:number` (debounce theo ngày).
- `submit()`: sau `this.budget.add(result.cost)` → `this.tokenGuard?.add(result.cost)`.
- `tick()` (đầu hàm, cạnh `budget.check()`):
  - `const g = this.tokenGuard?.check()`.
  - `level==='hard'` → set `this.paused=true` + post channel `coordination` (system) `⛔ token/ngày chạm HARD … → tạm dừng nhận card` (1 lần/ngày, dùng `tokenWarnedDay`) rồi `return 0` (giống budget cap). **Lưu ý thứ tự**: nếu budget.ok nhưng token hard → vẫn phải pause; nếu cả hai ok → `paused=false`.
  - `level==='soft'` → `this.thrift=true` + post channel `⚠ token/ngày chạm SOFT → hạ executor xuống model rẻ` (1 lần/ngày). `level==='ok'` → `this.thrift=false`.
- `claim()` (chỗ resolve persona, sau khi set model): nếu `this.thrift && (persona.kind==='executor' || persona.laneModel)` → `persona = { ...persona, laneModel: cheapestExecutorKey() }` (đặt TRƯỚC chèn skill để không mất). KHÔNG đụng persona claude (orchestrator/critic).
- `limits()`: thêm `tokenGuard: g ? { level:g.level, dayTokens:g.dayTokens, soft:cfg.softTokens, hard:cfg.hardTokens, thrift:this.thrift } : null` → để hub + autopilot đọc qua `/state`.
- **DoD**: `tsc` sạch; `/state.limits.tokenGuard` xuất hiện; tick hard → paused, soft → thrift, ok → off.
- **Builder lưu ý**: GIỮ logic budget cũ nguyên; token-guard CHỈ THÊM điều kiện pause, không thay budget.

### B3 — Wire env ở coordinator-main + truyền vào Engine
- `src/coordinator-main.ts`: tạo `new TokenGuard({ softTokens:Number(process.env.AM_DAY_TOKEN_SOFT||…), hardTokens:Number(process.env.AM_DAY_TOKEN_HARD||…) })`, truyền vào `new Engine(store, runner, budget, tokenGuard, {…})`.
  - Mặc định gợi ý (builder để env đè): SOFT ví dụ `1_500_000`, HARD `2_500_000` tok/ngày — **con số là quyết định tuning của Bill → để env, KHÔNG hardcode cứng; nếu cần chốt số mặc định thì hỏi (needs_decision)**.
- **DoD**: chạy coordinator, `GET /state` thấy `tokenGuard` với cfg đúng env.

### B4 — Minh bạch: actor cho approve/reject/answer + Telegram notify
- **Engine**: `approve(cardId, actor:'bill'|'lucy'='bill', reason?)`, tương tự `reject`/`answer`.
  - Khi `actor==='lucy'`: post decision với author **'Lucy'** (không phải 'bill') + text gắn lý do, vd `🌙 Lucy (trực đêm) ✓ DUYỆT: <reason>`; ghi `history.detail` kèm `by:lucy`. Bill tay giữ nguyên author 'bill'.
  - (Tuỳ chọn polish board) thêm `Card.lastDecisionBy?:'bill'|'lucy'` + `lastDecisionReason?:string` set khi quyết → hub badge "🌙 Lucy" trên card. Nếu làm thì cập nhật `types.ts` + Dashboard.tsx; nếu cắt scope thì channel-label là đủ cho DoD.
- **Coordinator** (`coordinator.ts`): `/approve` `/reject` `/answer` đọc `b.actor` (`'lucy'` nếu đúng, else `'bill'`) + `b.reason`, truyền xuống engine. Hub không gửi actor → 'bill' (giữ nguyên).
- **Autopilot** (`autopilot-main.ts`): mọi `post('/approve'|'/reject'|'/answer', …)` thêm `actor:'lucy', reason:<lý do director>`.
- **Thêm** `src/notify.ts`: `export async function notifyTelegram(text:string):Promise<void>` — fetch `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage` với `chat_id=AM_ALERT_CHAT_ID`. Thiếu env → **no-op im lặng** (fire-and-forget, nuốt lỗi — KHÔNG làm gãy vòng). No dep (Node fetch).
- **Autopilot** theo dõi mức guard từ `/state.limits.tokenGuard`: giữ `lastLevel`; khi chuyển `ok→soft` hoặc `→hard` (theo ngày) → `notifyTelegram('🌙 token/ngày chạm SOFT|HARD: <dayTokens> … hành động: …')`. Debounce theo ngày để không spam mỗi 6s.
- **DoD**: autopilot auto-approve → channel hiện author 'Lucy' + lý do (KHÔNG phải 'bill'); `notify.ts` no-op khi thiếu env, gửi khi đủ (test tay bằng env giả). `tsc` sạch cả hub nếu đụng (B4 polish).

### B5 — Smoke giả lập (DoD verify) `src/smoke-token-guard.ts`
- Thuần, KHÔNG cần claude/mạng:
  1. `TokenGuard.check`: nạp events → dưới soft = `ok`; ≥soft <hard = `soft`; ≥hard = `hard`; token ngày HÔM QUA không tính sang hôm nay (inject `now`).
  2. `cheapestExecutorKey()` trả 1 key executor hợp lệ trong catalog.
  3. **Engine end-to-end giả lập** (MockRunner, Budget rộng, TokenGuard ngưỡng thấp): tạo card executor → drainLocal vài vòng để `submit` cộng token → assert: chạm soft `engine.thrift===true` + `claim()` cho persona executor ra `laneModel===cheapestExecutorKey()`; chạm hard `tick()` → `engine.paused===true` (ngừng dispatch).
- Thêm script `package.json`: `"smoke:token-guard": "tsx src/smoke-token-guard.ts"` (bám cách smoke khác chạy).
- **DoD**: `npm run smoke:token-guard` xanh; log rõ soft→thrift, hard→pause.

### B6 — Gyomei review (gate)
- Card qua gate review (Gyomei). Builder đảm bảo: `tsc` sạch, smoke xanh, không đụng contract cũ (budget/approve manual vẫn chạy), không hardcode số tuning (env hoá).

## Rủi ro & giảm
- **Lẫn token đo**: chỉ đo token đã `submit` (claude + lane đều cộng cost). Lane free vẫn tính token (để hard-cap đúng "khối lượng"), nhưng "rẻ" về tiền — đúng ý: guard bảo vệ **token**, không phải chỉ USD. Ghi rõ trong comment.
- **Mốc ngày local vs UTC**: chọn **local 00:00** (Bill ở 1 múi giờ); comment nêu lý do. Nếu Bill muốn UTC → env sau.
- **Telegram thiếu cấu hình**: no-op, không nổ. KHÔNG echo token/secret (chỉ con số token + mức).
- **Backward-compat**: `tokenGuard` optional ở Engine ctor + `actor` default 'bill' → test/hub cũ không gãy.
- **Số ngưỡng SOFT/HARD = tuning của Bill**: để env. Nếu builder cần số mặc định chốt → `needs_decision`, đừng tự đặt bừa.

## Giao builder (thứ tự)
B1 → B2 → B3 → B4 → B5 → (B6 gate). Mỗi B 1 commit, tự `tsc`+smoke trước khi sang bước kế.
