# LUCY — North Star & Plan (ĐỌC CÁI NÀY)

> **Single source of truth. Cập nhật 2026-06-12.** Gom mọi thứ về 1 chỗ cho đỡ loãng.
> Docs cũ/gác lại đã dọn vào [`_outdated/`](_outdated/) (VISION_2026, ROADMAP_TO_PEAK, business, Hermes/OmniRoute research… — giữ để hồi, không xoá cứng).
> Reference đang sống: [LUCY_ULTIMATE_INFRA](LUCY_ULTIMATE_INFRA.md) · [STEAL_FROM_HERMES](STEAL_FROM_HERMES.md) · [COST_MODEL](COST_MODEL.md) · [MODEL_COMPARISON](MODEL_COMPARISON.md) · [PROVIDER_MODELS](PROVIDER_MODELS.md).

---

## 1. VIỄN CẢNH — Lucy làm được gì

**North star:** *Lucy = trợ lý cá nhân BIẾT RÕ m + mọi dự án, tự làm việc bằng nhiều agent, chạm được cả
tech-life (code/mail/lịch/file/web), tự giỏi lên, chạy cả khi m ngủ — m lái từ điện thoại.*

**7 năng lực Lucy LÀM được:**
1. **Nhớ m & mọi dự án** — khỏi giải thích lại bao giờ.
2. **Giao 1 việc → nhiều agent tự chia nhau làm** song song, chỉ hỏi khi cần quyết.
3. **Chạm cả tech-life**: code · mail · lịch · file · web · notes.
4. **Tự giỏi lên** — học cách m làm, tự viết skill.
5. **Làm khi m ngủ** — job nền, phản ứng sự kiện (PR/mail), gộp memory đêm.
6. **Rẻ** — việc nhẹ chạy model free, não Claude, token tối ưu.
7. **Lái từ túi quần** — Telegram/voice, cả agent lẫn máy tính từ xa.

*Một ngày:* sáng Lucy tóm tắt (PR chờ duyệt + lịch + mail) → m giao "fix bug login radiant-bot + test" →
Lucy tự lập pipeline, nhiều agent làm, báo "xong, diff đây, push?" (không hỏi lại dự án là gì) → tối Lucy
gộp cái học vào não + tự viết skill "deploy radiant-bot".

---

## 2. NGUYÊN TẮC (để KHÔNG dàn trải)
- **1 line, làm xong từng cái** — không mở nhiều mặt trận cùng lúc.
- **Memory-first** — trí nhớ là MÓNG; 6 năng lực kia chỉ cộng dồn được khi Lucy NHỚ.
- **Mỗi milestone = 1 năng lực agent + 1 màn UI thấy được + ship được** (không build chìm 6 tuần rồi mới thấy).
- **UI: flow rõ — đẹp — xịn**, đủ control cho power-user; KHÔNG dumbed-down.
- **1 nguồn sự thật = GitHub.** Dev ở local (máy mạnh) → push → VPS `git pull` + `pm2 restart`. KHÔNG sửa thẳng 2 nơi (đã từng lệch).
- **Secret không qua chat** — `nano .env` trên box, không `cat`, không paste key vào hội thoại.

---

## 3. LỘ TRÌNH đầu → cuối — trạng thái THẬT

| # | Năng lực | Trạng thái | Màn UI (flow) |
|---|---|---|---|
| **M1 Trí nhớ** ⭐ móng | `lucy-vault/` (md, git) + `claude -p --add-dir` + FTS5/trigram recall + dream (Wilson) + evidence-loop + graph-walk + galaxy 3D + 1-não thống nhất | ✅ **XONG (full stack A1–A7 + M1.5 tinh hà + bootstrap + cron_dream)** | **"Bộ não"** + tab Neural 🌌 — live |
| **Phase 1.5 — Đa-model + Dashboard** 💰 | lát API in-house (`llm-lane.ts`, 7 provider, smoke-tested) + executor đa-nguồn (DeepSeek V4 = executor, Claude = orchestrator/critic) + **web mở thẳng Dashboard đo metrics** (token/cost/model-usage theo ngày-tháng) | ✅ **gần xong** — lát API ✅, pick-agent ✅, Dashboard landing + /metrics + error-stats ✅ (commit a513c44); còn: skill-loader wire | **"Dashboard"** (landing) + **"Settings → lát API"** |
| **Phase 1.6 — Lõi điều phối thông minh** 🧠 *(NGAY)* | tầng trí phán đoán ở giữa: C1 rate-limit→park+báo Telegram · C2 agent kẹt→Lucy tự triage/split · C3 chặn task-to decompose-first · C4 **não riêng từng agent** (học dần). Nền: wire turn-log + error-stats sống. Dashboard "cho Lucy" = cửa sổ soi lõi — [PHASE-1.6-CORE.md](PHASE-1.6-CORE.md) | 🔧 **đang làm** — plan ✅, [SPRINT-02.md](SPRINT-02.md) | panel 🌙 trực đêm · ⏳ runway · 🆘 cần-Bill · Agent Insights |
| **M2 Tay (MCP)** | mount MCP per-card: GitHub·Gmail·Calendar·Drive·Web(Playwright)·Notion — [MCP_ARCHITECTURE.md](MCP_ARCHITECTURE.md) | 📐 architect xong, chưa build | **"Kết nối"** — bật/tắt nguồn, quyền rõ |
| **M3 Tự học** | `SKILL.md` chuẩn agentskills.io + stage self-improve tự sinh/refine | ⬜ | **"Kỹ năng"** |
| **M4 Chủ động** | cron tick + wake-gate + webhook + nightly dream | 🔧 1 nửa (`cron_dream` ✅) | **"Lịch/Job"** |
| **M5 Token/Cost** | cache-parity (từ M1) + tool-slim + nén + ledger gộp | 🔧 1 phần (lát API rẻ ✅; OmniRoute **bỏ** — box 2GB yếu, thay bằng lát in-house) | **"Chi phí"** (gộp vào Dashboard) |
| **M6 Đa mặt** | tách headless server; Telegram + voice(Whisper) + web adapter; [REMOTE_CONTROL.md](REMOTE_CONTROL.md) | ⬜ | **polish** mobile |

**Trung tâm UI đã có:** Board (Kanban card chạy qua stage, agent "nói" trong thread sống). M1 "Bộ não" + Neural đã live.
Phase 1.5 thêm **Dashboard làm landing** (không vào thẳng dự án nữa) + lát API.

> **Gác (mở lại sau):** business/portal/content/tribulation (xem [`_outdated/MONEY_PLAYBOOK`](_outdated/MONEY_PLAYBOOK.md), [`_outdated/ROADMAP_TO_PEAK`](_outdated/ROADMAP_TO_PEAK.md)).
> **Đã bỏ:** Hermes (thay bằng lucy-bridge) · OmniRoute self-host (thay lát in-house) · Arena/Aki (radiant-bot không đụng) · voice (về sau).

---

## 4. UI/UX DIRECTION — xịn, flow rõ, đẹp

**Triết lý:** Lucy là **"phòng điều khiển đội agent của m"** — không phải chatbox. Khác biệt cao cấp =
**m XEM được agent đang làm gì real-time, đo được sức khoẻ hệ (token/cost), và lái chúng.**

- **Landing = Dashboard, KHÔNG vào thẳng dự án.** Vào web thấy ngay: token còn/đã dùng (ngày · tháng), cost theo model/agent, model nào sống/chết, job nền, card đang chạy. Lý do: **Claude hết token = Lucy chết** → phải đo trước, lái sau.
- **Thẩm mỹ:** giữ **dark theme token-based** (nền `#05070e`, accent cyan, viền calm) — premium, nhìn lâu không mỏi. KHÔNG màu mè, KHÔNG "AI slop".
- **Bố cục:** 1 cockpit, sidebar = năng lực (**Dashboard** · Bộ não · Board · Kết nối · Kỹ năng · Lịch · Chat · Settings). Mỗi tab đúng 1 flow, không nhồi.
- **Flow nguyên tắc (signature UX):** (1) agent "nói ra" mọi việc trong thread sống; (2) duyệt đúng chỗ (HITL inline); (3) hiện đủ nhưng sạch (cost·agent·stage·diff).
- **Không dumbed-down:** đủ chiều sâu power-user (chỉnh pipeline/model/limit lúc chạy), gói trong UI đẹp.

**Metrics Dashboard cần đo (đề xuất — research thêm từ references):**
`token in/out theo ngày → cuộn tháng` · `cost $ /agent · /model · /card` · `% tiết kiệm nhờ lát free vs Claude` ·
`model health (live/dead, latency, RPM còn lại)` · `card throughput + thời gian/stage` · `vault: #note · #preference (k confirmed) · inbox chờ dream` · `cảnh báo ngưỡng token (sắp cạn → tự hạ model)`.

---

## 5. VIỆC KẾ — execute ngay (Phase 1.5, theo đúng "1 line làm xong từng cái")

**✅ ĐÃ XONG (2026-06-12, verify real):**
- **Executor đa-model in-house** — `lane-runner.ts`: agentic tool-loop (read/write/edit/bash) cho model rẻ qua `llm-lane` (OpenRouter/OpenCode-Zen, DeepSeek V4). Worker `CompositeRunner`: persona có `laneModel` + có key → model rẻ; else `claude -p` (opus brain/critic). Smoke: ds-v4-flash-free tạo+verify file thật ✅. Chạy: worker `AM_RUNNER=claude`.
- **Bộ persona 14 + 170 skill Hermes** — `agent-machine/config/personas/` (anime, avatar AniList) + `skills/` (INDEX). Review 2-bước (Giyu spec → Rengoku quality).
- **Autopilot "Lucy trực đêm"** — `autopilot.ts` + `autopilot-main.ts` (poller) + `autopilot-cli.ts` (sprint). Okabe(opus) tự đẻ sprint; ở gate Lucy-director(opus) đọc report+diff → `/approve` hoặc `/reject`. **TRỪ** deploy(Tengen)/security(Gyomei)/secret → vẫn để Bill. Cap `AM_AUTOPILOT_MAX`. Smoke: duyệt card-tốt, trả-lại card chưa-verify ✅.
  - Đêm: `npm run sprint -- sprint <projectId> "<mục tiêu>"` (đẻ + chạy) · `npm run autopilot` (bật duyệt-thay) · pm2 = `lucy-autopilot`.

**CÒN LẠI:**
1. **Pick-agent ở Board** — lúc giao việc chọn "con agent + nguồn model" cho card (không chỉ Settings).
2. **Dashboard landing + metrics** — tab Dashboard mở mặc định, đo bộ metrics §4. Cost từ ledger + `COST_MODEL.md`.
3. **Wire skill-loader M3** — agent match trigger → load đúng SKILL.md (progressive disclosure).
4. **Verify cả dự án + research UI** — đối chiếu code ↔ docs, soi references, chốt hướng UI.

→ Xong Phase 1.5 → **Phase 1.6 (lõi điều phối, [SPRINT-02.md](SPRINT-02.md))** → rồi mới sang M2 (MCP). Lý do: *agent có não rồi mới giao thêm tay*.

**Ops để Lucy LIVE:** set `LUCY_VAULT=<repo>/lucy-vault` cho **coordinator** (não routes) + **worker** (claude -p đọc vault). Chưa set → brain routes trả `configured:false` (graceful). Reindex galaxy/recall = **`pm2 restart lucy-coordinator`** (KHÔNG phải bridge/hub).

---

## 6. Bản đồ docs (sau audit 2026-06-12)

| Doc | Nội dung |
|---|---|
| **NORTH_STAR.md** ⭐ | Viễn cảnh + lộ trình + UI/UX — đọc đầu tiên |
| **AGENT_MACHINE.md** | Kiến trúc multi-agent card-engine (Kanban + persona + channels) |
| **MCP_ARCHITECTURE.md** | Kiến trúc M2 (MCP overkill + lớp quản tool) |
| **M1_MEMORY_SPEC.md** · **NEURAL_GALAXY.md** · **MEMORY_PEAK.md** | Spec hệ trí nhớ M1 (đã build) + tinh hà + đề xuất peak (UI-B còn dư) |
| **PROVIDER_MODELS.md** · **MODEL_COMPARISON.md** · **COST_MODEL.md** | Lát API: model live-verified + benchmark routing + bài toán token |
| **LUCY_ULTIMATE_INFRA.md** · **STEAL_FROM_HERMES.md** | Thiết kế 7 lớp tổng + cơ chế rút từ Hermes source |
| **DEPLOY_HUB.md** · **REMOTE_CONTROL.md** | Deploy hub (nginx/HTTPS/2FA) + kiến trúc remote (M6) |
| **AUTOPILOT.md** ⭐ | Runbook engine đa-model + "Lucy trực đêm" + self-upgrade (cách chạy VPS) |
| **SPRINT-01.md** | Sprint chi tiết hoàn thiện Phase 1.5 — đưa Lucy tạo dự án + chạy |
| **tasks/** | Task UI/observability đang mở (W1 parity ✅, W2 UI pass, multiagent-ux-review) |
| **_outdated/** | Docs gác/superseded (business, Hermes/OmniRoute, vision cũ) — hồi được |

## 7. Hạ tầng
VPS Vietnix `<VPS_IP>` (2GB, always-on) · pm2: `lucy-bridge` · `lucy-coordinator` · `lucy-vps-worker` · `lucy-hub` (+ `radiant-bot` không đụng).
Lucy = **bridge** (Telegram → `claude -p`), Hermes đã tắt. Repo: github.com/billtruong003/L.U.C.Y (branch `main`). VPS clone `~/lucy`, local `c:/Users/Admin/Downloads/BillService/LUCY`.
