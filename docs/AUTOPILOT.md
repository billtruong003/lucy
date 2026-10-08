# LUCY — Autopilot & Multi-Model Engine (runbook)

> **Viết 2026-06-12.** Cách Lucy tự chạy việc bằng nhiều agent + nhiều nguồn model, và tự duyệt thay Bill ban đêm.
> Neo: [NORTH_STAR.md](NORTH_STAR.md) Phase 1.5 · [AGENT_MACHINE.md](AGENT_MACHINE.md) · [PROVIDER_MODELS.md](PROVIDER_MODELS.md).

## 1. Bức tranh
```
sprint (Okabe opus)  →  card vào board  →  worker chạy stage:
   executor (Tanjiro/Vương Lâm/Daru…) → MODEL RẺ (DeepSeek V4 qua OpenRouter/OpenCode-Zen)
   brain/critic (Kurisu/Rengoku/Gyomei) → claude -p (opus)
   ↓ tới gate
   autopilot (Lucy-director opus) đọc report+diff → DUYỆT / TRẢ LẠI   (trừ deploy/security → để Bill)
```
3 lớp: **điều phối** (opus) · **thực thi** (model rẻ, có tool thật) · **phán xử** (opus). Não Claude cầm lái, tay rẻ làm việc.

## 2. Mảnh ghép (code)
| Mảnh | File | Việc |
|---|---|---|
| Lát API | `agent-machine/src/llm-lane.ts` | gọi 7 provider OpenAI-compat + fallback + tool-calling (`callLLMRaw`) |
| Executor | `agent-machine/src/lane-runner.ts` | agentic tool-loop: model rẻ có read/write/edit/bash (gate theo `allowedTools`, chặn path ngoài ws) |
| Router | `agent-machine/src/worker-main.ts` `CompositeRunner` | persona có `laneModel`+key → lane; else claude -p |
| Sprint | `agent-machine/src/autopilot-cli.ts` | Okabe(opus) chia mục tiêu → card |
| Autopilot | `agent-machine/src/autopilot.ts` + `autopilot-main.ts` | director(opus) duyệt/trả-lại ở gate; poller |
| Self-deps | `agent-machine/src/worker.ts` `ensureDeps` | clone mới tự có node_modules (symlink từ source local / npm install) → reviewer build được |

**Đã verify thật (smoke):** `smoke:lane` (model rẻ tạo+verify file) · `smoke:autopilot` (director duyệt đúng/trả-lại đúng) · `smoke:e2e` (chuỗi đầy đủ → done, ~$0.11) · `smoke:dogfood` (agent rẻ viết code thật trong repo Lucy) · `smoke:clonedeps` (clone tự build được 2.0s). Tất cả PASS.

## 3. Model rẻ dùng (free + xịn, tránh yếu)
- **executor:** `ds-v4-flash-free` (OpenCode-Zen, free, 1M ctx) → fallback `devstral-med` (Mistral) → `ds-v4-flash` (OpenRouter).
- **reasoning khó:** `ds-v4-pro` (OpenRouter).
- **điều phối/critic/director:** **claude opus** (Bill: opus để điều hướng).
- Xem live: `npm run providers`. Đổi: `agent-machine/src/llm-lane.ts` `FALLBACKS`.

## 4. Chạy trên VPS (thâu đêm)
```bash
# 1) code (executor+autopilot+deps ở main sau khi merge)
cd ~/lucy && git pull
# 2) key model rẻ — nano, KHÔNG cat/paste-chat (llm-lane đọc ~/lucy/.env.llm)
nano ~/lucy/.env.llm   # OPENROUTER_API_KEY=... OPENCODE_ZEN_API_KEY=... GROQ/MISTRAL/GEMINI...
# 3) worker COMPOSITE (AM_RUNNER=claude; mock thì executor không chạy)
cd ~/lucy/agent-machine
pm2 delete lucy-vps-worker 2>/dev/null
AM_COORD_URL=http://127.0.0.1:8780 AM_TOKEN=<TOKEN> AM_RUNNER=claude AM_WORKER_CONCURRENCY=2 \
  pm2 start npm --name lucy-vps-worker -- run worker
# 4) tạo dự án — self-upgrade dùng repoUrl LOCAL để symlink deps (nhanh):
curl -s -XPOST 127.0.0.1:8780/project -H "x-worker-token: <TOKEN>" -H 'content-type: application/json' \
  -d '{"name":"Lucy","repoUrl":"/root/lucy","branch":"main"}'   # → lấy <projectId>
# 5) đẻ sprint + bật trực đêm
AM_TOKEN=<TOKEN> npm run sprint -- sprint <projectId> "<mục tiêu / hoặc dán từng card>"
AM_TOKEN=<TOKEN> AM_AUTOPILOT_MAX=15 pm2 start npm --name lucy-autopilot -- run autopilot
# sáng: Hub board + `pm2 logs lucy-autopilot`; diff ở ~/lucy/agent-machine/.worker/repos/<proj>
```
> **Không auto-push.** Agent sửa trong CLONE (`.worker/repos/`), Bill review + push tay buổi sáng.
> `repoUrl=/root/lucy` (local) → clone nhanh + symlink deps tức thì. Repo remote (GitHub) → npm install (chậm hơn).

## 5. Guardrail (an toàn đêm)
- **Gate KHÔNG auto-duyệt:** deploy (Tengen), bảo mật (Gyomei), pipeline `secure-ship`, và `waitKind` cost/loop/decision → **để Bill**. Director phân vân → **trả lại** (mặc định an toàn).
- **Cap quyết:** `AM_AUTOPILOT_MAX` (mặc định 100; đêm đầu để 15-20). Đạt cap → autopilot dừng.
- **Cost/card:** `perCardMaxUsd` (engine) → vượt thì gate cost (Bill xử).
- **Bật/tắt = vòng đời pm2:** `pm2 stop lucy-autopilot` là tắt trực đêm.

## 6. Cost (ước lượng)
1 card pipeline `feature` ≈ executor (free) + tester/spec (free/sonnet) + reviewer (opus) + director (opus). Phần đắt = opus reviewer+director/gate. Sprint N card → ~N×2 lượt opus. Theo dõi `pm2 logs` + (sắp có) tab Chi phí.
