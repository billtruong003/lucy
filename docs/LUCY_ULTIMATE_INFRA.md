# LUCY ULTIMATE INFRASTRUCTURE — bức tranh tổng + thiết kế hạ tầng mạnh nhất

> **Viết 2026-06-10.** Tổng hợp研究 sâu: source Hermes ([STEAL_FROM_HERMES.md](STEAL_FROM_HERMES.md)) +
> Hermes Atlas ecosystem + Obsidian/PKM + agent frameworks 2026 + life-automation. Mục tiêu Bill:
> **biến Lucy thành 1 con agent siêu mạnh COVER MỌI THỨ trong tech-life** — não ở `claude -p`, tay là
> card-engine, nhớ bằng vault, với bằng MCP. Neo: [ROADMAP_TO_PEAK.md](_outdated/ROADMAP_TO_PEAK.md), [VISION_2026.md](_outdated/VISION_2026.md).
> Đây là **THIẾT KẾ** (chưa build) — chốt hướng trước khi code.

---

## 0. TL;DR — Lucy sẽ thành gì

Từ "coding orchestrator" → **"personal agent OS"**. 5 lớp:
```
   KÊNH (Telegram→…)  →  NÃO (claude -p + card-engine)  →  NHỚ (vault)  →  TAY (MCP)  →  TỰ HỌC (skill-loop)
                                    ↑ chạy nền: automation/triggers (heartbeat+webhook+wake-gate)
                                    ↑ xuyên suốt: token discipline (cache-parity + vault-selective + tool-slim)
```
**Lucy đã có NÃO tốt** (card→pipeline, delegate, budget, loop-breaker). **3 lỗ hổng lớn:** (1) **NHỚ** bền
xuyên phiên, (2) **TAY** rộng (MCP để chạm mọi domain), (3) **TỰ HỌC** (skill tự sinh). Lấp 3 cái này =
bước nhảy về chất + giải bài toán token.

---

## 1. BỨC TRANH TỔNG — cái mạnh nhất đã tồn tại, theo lớp

(Chỉ liệt cái đáng lấy. Đầy đủ + URL ở các doc nguồn.)

| Lớp | Repo/chuẩn mạnh nhất | Lấy gì cho Lucy |
|---|---|---|
| **Não / orchestration** | Claude Agent SDK, OpenHands (event-stream), Roo "boomerang", Maestro (`claude -p` handoff), Mission Control (dashboard SQLite) | Lucy đã có. Refine: **child chỉ trả SUMMARY** (không trả transcript); event-log per card (replay/audit); Mission Control làm dashboard quan sát |
| **NHỚ / memory** ⭐ | **Basic Memory** (md+MCP+Obsidian), **open-second-brain** (Hermes+Obsidian, đúng pattern), Mnemosyne/PLUR (file mem), **Letta** (typed blocks 3 tầng), Hermes FTS5 recall | **Vault markdown = não bền** + Basic Memory MCP + FTS5 recall (0-token) + Letta-style typed blocks + nightly "dream" consolidation |
| **TAY / tools** ⭐ | **MCP ecosystem**: Filesystem, GitHub, Google Workspace (Gmail/Calendar/Drive), **Playwright** (web fallback), Notion, Basic Memory; Goose "everything-is-MCP" + Recipes | Mỗi card **mount được MCP server** → chạm GitHub/mail/lịch/file/web. Đây là cái biến "cover tech-life" thành THẬT |
| **TỰ HỌC / skills** | **agentskills.io SKILL.md** + progressive disclosure, **hermes-skill-factory** (tự sinh skill từ workflow lặp), Hermes 3 background-review prompt, Eagle-Eye (skill retrieval) | Chuẩn hoá `agents/*/SKILL.md`; stage "self-improve" tự sinh/refine skill từ transcript |
| **Automation / triggers** | Hermes cron (wake-gate, `context_from`, `[SILENT]`), **Trigger.dev** (long run + HITL), **n8n** (bidirectional MCP = 400+ connector free), Huginn (web watchers) | heartbeat-cron + webhook + **wake-gate** (poll rẻ không tốn LLM); n8n làm MCP-server cho Lucy → 1 connector = 1 domain mới |
| **Kênh / control** | **OpenClaw** (channel/brain/body, 20+ kênh→1 agent), **OpenCode** (headless server + nhiều surface qua HTTP/SSE), Open WebUI | Telegram bridge = 1 adapter; tách **headless brain server** → sau thêm web/voice không đụng não |
| **An toàn** | Clawshell (scrub PII/secret), HermesClaw (sandbox), git-on-vault rollback | Guard I/O khi Lucy chạm toàn tech-life; git vault để revert edit sai |
| **Token** | Hermes prompt-cache parity (~25%), vault selective-read (~40%), Aider PageRank repo-map, hermes-tool-slimmer | Tất cả cộng dồn = bước nhảy chi phí |

---

## 2. KIẾN TRÚC ĐÍCH (target)

```
┌── KÊNH (channel layer) ──────────────────────────────────────────────┐
│  Telegram (now) · [web · voice/Whisper · Discord  — later, cùng 1 não]│
└───────────────┬───────────────────────────────────────────────────────┘
                ▼  (1 agent identity, mọi kênh chung não+nhớ — pattern OpenClaw)
┌── NÃO: Lucy headless server (VPS) ───────────────────────────────────┐
│  card→pipeline engine (agent-machine)   │  bridge dispatcher          │
│   • stage = persona × claude -p          │   /fan /orch /auto          │
│   • delegate→child-card (SUMMARY-only)   │   coordinator↔worker        │
│   • budget/loop/depth breaker, HITL gate │   cost-ledger               │
└───┬──────────────┬──────────────┬──────────────┬─────────────────────┘
    ▼ NHỚ          ▼ TAY          ▼ TỰ HỌC        ▼ chạy nền
┌─────────────┐ ┌────────────┐ ┌─────────────┐ ┌──────────────────────┐
│ lucy-vault/ │ │ MCP belt   │ │ agents/     │ │ scheduler            │
│ (git md)    │ │ fs·github· │ │  */SKILL.md │ │  heartbeat+webhook+  │
│ +FTS5 index │ │ gmail·cal· │ │ + skill-    │ │  wake-gate           │
│ +Letta blk  │ │ drive·     │ │  factory    │ │ n8n (MCP back)       │
│ +nightly    │ │ playwright·│ │ (tự sinh)   │ │ Trigger.dev (long)   │
│  "dream"    │ │ notion     │ │             │ │                      │
└─────────────┘ └────────────┘ └─────────────┘ └──────────────────────┘
        xuyên suốt: TOKEN DISCIPLINE (cache-parity · vault-selective · tool-slim · relevance)
```

---

## 3. THIẾT KẾ 7 LỚP (what · steal · how · effort)

### A. NÃO (giữ + tinh chỉnh) — *Lucy đã mạnh*
- **Summary-only delegation:** child card trả về cha **chỉ 1 JSON summary** (đã có handoff; siết để KHÔNG đổ transcript vào context cha). Steal: Roo boomerang + Hermes `delegate_tool`. **Dễ.**
- **Prompt-cache parity:** giữ prefix system-prompt **byte-identical** xuyên stage/child (cùng persona header, cùng xử lý timestamp, cùng thứ tự tool). ~25% rẻ. **Dễ, ROI cao nhất.**
- **Event-log per card** (immutable action/observation) → replay/audit. Steal OpenHands. **TB, để sau.**

### B. NHỚ (LỖ HỔNG #1) — markdown vault làm não bền
- **`lucy-vault/`** git-tracked, cấu trúc MECE: `Brain/{preferences,decisions,entities,inbox,log}` · `Projects/` · `Context/`(=USER.md) · `Skills/` · `Daily/` · `MEMORY.md`(index).
- `claude -p` trỏ thẳng vault (`--add-dir`) → đọc `.md` selective (**~40% token** vs dựng lại context). **Dễ, làm ngay.**
- **Basic Memory MCP** (hoặc fork **open-second-brain**): `write_note`/`search`/`build_context` graph; mở cùng folder bằng Obsidian để Bill xem/sửa. **TB.**
- **FTS5 recall** (copy Hermes `session_search`: bookends + ±N + lineage dedupe) trong `better-sqlite3` → "đã làm cái này chưa?" 0-token. **Dễ.**
- **Letta-style typed blocks:** block `human` (profile tech-life Bill) + `persona` per stage, agent tự sửa qua tool. **TB.**
- **Nightly "dream" cron:** 1 pass `claude -p` distill transcript → `Brain/inbox/` → gộp lặp 3× thành `preferences/` (confidence). = skill-loop Hermes rẻ hoá. **TB.**

### C. TAY (LỖ HỔNG #2) — MCP belt = chạm mọi domain
- Mỗi card **mount được MCP server** (Claude Code đã hỗ trợ MCP native qua `claude -p`).
- **Starter (80%):** Filesystem + GitHub + Fetch → thêm Google Workspace (Gmail/Calendar/Drive) + **Playwright** (web fallback khi không có API) + Basic Memory + Notion.
- **n8n làm MCP-server NGƯỢC về Lucy** → 400+ connector free, 1 connector = 1 năng lực tech-life mới, não khỏi phình. **TB — keystone của "cover everything".**
- An toàn: Clawshell scrub secret ở biên I/O. **TB.**

### D. TỰ HỌC (LỖ HỔNG #3) — skill tự sinh
- Chuẩn hoá `agents/*/SKILL.md` theo **agentskills.io** (frontmatter + When/Procedure/Pitfalls/Verify + progressive disclosure: list chỉ name+desc, full load khi match).
- **skill-factory pattern:** watch transcript → phát hiện workflow lặp → đề xuất mint SKILL.md. Copy 3 prompt background-review của Hermes (gồm danh sách KHÔNG-bắt). **TB.**

### E. AUTOMATION (chạy nền) — Lucy chủ động
- **heartbeat cron** (Lucy tự check stale task/pending) + **webhook** (GitHub PR/mail/Telegram→phản ứng) + **wake-gate** (rule rẻ TRƯỚC khi gọi LLM — tiết kiệm token). Steal Hermes `tick()` (lock + advance-before-run), `context_from`, `[SILENT]`. **TB.**
- **Trigger.dev** cho agent-loop dài (no-timeout + HITL approve) khi vượt giới hạn 1 call `claude -p`. **TB, optional.**

### F. KÊNH / SERVER CORE — nhiều mặt, 1 não
- Tách **headless Lucy server** (não + nhớ + tool) khỏi **channel adapter**. Telegram = adapter đầu; sau cắm web (Open WebUI)/voice (Whisper) **không đụng não**. Topology OpenClaw/OpenCode. **TB, sau khi B/C/D xong.**

### G. TOKEN DISCIPLINE (xuyên suốt) — bài toán token = bước nhảy chất
1. **prompt-cache parity** (~25%) · 2. **vault selective-read** (~40%) · 3. **tool-slimmer** (chỉ load tool card cần) · 4. **relevance context** (Aider repo-map thay vì nhồi cả repo) · 5. **compression** (giữ head+tail-budget, summarize giữa bằng model rẻ, "latest wins"). Cộng dồn → giảm token nhiều lần, vừa rẻ vừa **chất lượng cao hơn** (context sạch, đúng trọng tâm).

---

## 4. THỨ TỰ LÀM (adoption roadmap)

```
P1  NHỚ (lỗ hổng lớn nhất + token win lớn nhất):
     vault markdown + claude -p --add-dir + FTS5 recall + prompt-cache parity   [Dễ, ~1 tuần]
P2  TAY: MCP belt (fs/github/gmail/calendar/drive/playwright/notion) per card    [TB, ~1 tuần]
P3  TỰ HỌC: agentskills.io SKILL.md + skill-factory + nightly dream consolidation [TB, ~1 tuần]
P4  AUTOMATION: heartbeat+webhook+wake-gate (Hermes tick patterns) + n8n MCP-back [TB, ~1 tuần]
P5  TOKEN polish: tool-slimmer + relevance repo-map + compression policy          [TB, ~3-5 ngày]
P6  KÊNH/server core: tách headless server, Telegram=adapter; web/voice sau       [TB, ~1-2 tuần]
```
**P1 trước tiên** — vừa lấp lỗ hổng nhớ (cái mọi framework 2026 đồng thuận là bắt buộc) vừa ăn token win lớn nhất (vault 40% + cache 25%).

---

## 5. REPO SHORTLIST — adopt/fork/đọc

| Mục đích | Repo | Cách dùng |
|---|---|---|
| Memory vault + MCP | **basicmachines-co/basic-memory** | adopt (MCP server + Obsidian) |
| Reference Hermes+Obsidian | **itechmeat/open-second-brain** | đọc/fork (đúng pattern, có "dream") |
| `claude -p` handoff state | **reinamaccredy/maestro** | đọc (closest analog Lucy bridge) |
| Orchestration dashboard | **builderz-labs/mission-control** | optional (quan sát card engine) |
| Relevance context | **Aider-AI/aider** (repo-map) | đọc cơ chế PageRank repo-map |
| Channel/brain/body topology | **openclaw/openclaw** | đọc topology (không chạy) |
| Connector breadth | **n8n-io/n8n** | deploy như MCP-server back to Lucy |
| Web fallback | **microsoft/playwright-mcp** | mount làm MCP tool |
| File memory (nhẹ) | AxDSan/mnemosyne · plur-ai/plur | tham khảo nếu cần vector recall |

---

## 6. Bước nhảy về chất — chốt
**Não Lucy đã tốt; thêm NHỚ (vault) + TAY (MCP) + TỰ HỌC (skill-loop) + kỷ luật token** = Lucy từ "bot
code" → **"agent OS phủ toàn tech-life"**: nhớ Bill + mọi dự án xuyên phiên, chạm được mail/lịch/file/
GitHub/web, tự giỏi dần, chạy nền chủ động, và **token giảm nhiều lần** (context sạch hơn → trả lời chất
hơn). Đó chính là "nơi khiến Lucy trở thành agent siêu mạnh" Bill nhắm.

> **Lưu ý kinh doanh:** đang GÁC (Bill chốt). Content-quality (Gemini "ngu") = idea sau. Doc này thuần hạ tầng.

## Sources
Gộp từ 4 nhánh research (xem agent outputs) + [STEAL_FROM_HERMES.md](STEAL_FROM_HERMES.md). Chính:
hermesatlas.com · basic-memory · open-second-brain · letta · OpenHands · Aider · Goose · OpenClaw ·
OpenCode · n8n · Trigger.dev · modelcontextprotocol/servers · Playwright MCP · agentskills.io.
