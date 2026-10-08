# M1 — Memory implementation spec (để hoàn thiện ở cty)

> **Viết 2026-06-10.** Spec đủ để build NỐT M1 (recall + write-back + dream + UI) **không cần research lại**.
> Rút từ study source **basic-memory** + **open-second-brain** (clone ở `BillService/`). Neo: [NORTH_STAR.md](NORTH_STAR.md),
> [lucy-vault/README.md](../lucy-vault/README.md). Đã XONG: vault seed + `runner.ts --add-dir` (proven $0.02).

---

## Còn 4 mảnh (theo thứ tự)

### Mảnh 1 — FTS5 recall  → new `agent-machine/src/recall.ts` (dep `better-sqlite3`)
DB sidecar `lucy-vault/.index/memory.db` (đã gitignore). **File là sự thật, DB dựng lại được.**

```sql
CREATE TABLE note(id INTEGER PRIMARY KEY, file_path TEXT UNIQUE, title TEXT,
  type TEXT, permalink TEXT, tags TEXT, mtime REAL, checksum TEXT, frontmatter JSON);
CREATE VIRTUAL TABLE note_fts USING fts5(
  title, body, tags, permalink UNINDEXED, file_path UNINDEXED, note_id UNINDEXED,
  tokenize='unicode61 remove_diacritics 2 tokenchars 0x2F', prefix='2,3,4');
-- 1 row/quan-sát để [danh-mục] query được:
CREATE VIRTUAL TABLE obs_fts USING fts5(category, content, tags, note_id UNINDEXED,
  tokenize='unicode61 remove_diacritics 2');
```
- **`remove_diacritics 2`** = chìa khoá tiếng Việt: gõ "hoa" khớp "hòa".
- **Index gì:** chỉ `Context/`, `Projects/`, `Skills/`, `Daily/` + (sau) `Brain/decisions,entities`. KHÔNG index `Brain/inbox|preferences|active.md` (máy quản).
- **Reindex:** so `mtime`+sha256 với row `note`; đổi → re-parse → upsert + delete/insert FTS rows. Lệnh `lucy reindex` = drop+rebuild từ file.
- **Parse note:** copy regex của basic-memory `src/basic_memory/markdown/plugins.py`:
  - Quan sát: `^- \[([^\[\]()]+)\]\s+(.+)` → category + content; tách `#tag`, `(context)`.
  - Liên hệ: `^- (\w+|"[^"]+") \[\[([^\]]+)\]\]` → relation_type + target.

**Tool:**
- `lucy_search(query, type?, after?)` → FTS5 `MATCH` rank `bm25`. **Relaxed-OR fallback:** strict trả 0 và ≥3 token → retry OR-of-terms (bỏ stopword). (~20 dòng, basic-memory `services/search_service.py`.)
- `lucy_recent(timeframe)` → `note` theo `mtime` desc.
- Expose: hub tab + bridge `/recall`.

### Mảnh 2 — Write-back hook → sửa `engine.submit` (engine.ts)
Sau mỗi card, ghi cái học vào `lucy-vault/Brain/inbox/sig-<ngày>-<slug>.md`:
```markdown
---
kind: brain-signal
id: sig-2026-06-10-<slug>
created_at: <ISO>
topic: <chủ-đề>
signal: positive            # positive | negative
agent: lucy
principle: "<câu rule tiếng Việt>"
scope: <writing|code|...>   # optional
evidenced_by: [card-<id>]
---
## Raw
<trích đoạn / lý do>
```
(Agent cũng tự ghi được qua HOUSE_SKILL đã dặn — hook này là kênh tự động bổ sung.)

### Mảnh 3 — "Dream" consolidation → new `agent-machine/src/dream.ts` (port open-second-brain `src/core/brain/dream.ts`)
**Thuần deterministic, KHÔNG LLM.** Pure function của (signals, preferences, log, `_brain.yaml`, now).
1. Scan `Brain/`; file frontmatter hỏng → skip + log, vẫn chạy tiếp.
2. **Graduate:** group signal active theo `topic`. Trong `contradiction_window_days`, đếm pos vs neg, huỷ thiểu số; nếu `dominant >= candidate_threshold` (=**2**, `_brain.yaml`) → tạo preference **`unconfirmed`** (`evidenced_by` = các sig), chuyển sig sang `inbox/processed/`. Cả 2 dấu mà dưới ngưỡng → ghi contradiction (open question), không đổi.
3. **Redundant cùng dấu** trên pref đã có → `noted-redundant` + move processed (KHÔNG tạo trùng).
4. **Rebuttal:** sig ngược dấu tích đủ ngưỡng → retire pref (`rebutted`) trừ khi `pinned`.
5. **Confidence** (port `computeConfidence`):
   ```
   confidence_value = wilson_lower_95(applied, applied+violated) * freshness
   wilson: z=1.96; centre=(p̂+z²/2n)/(1+z²/n); margin=z·√(p̂(1-p̂)/n+z²/4n²)/(1+z²/n); lower=max(0,centre-margin)
   freshness = clamp(1 - age/stale_evidence_days, 0, 1)        # 90d
   band: ≥0.75 high · ≥0.40 medium · else low                  # _brain.yaml
   ```
   `unconfirmed` → `confirmed` ở evidence `applied` đầu tiên. applied/violated đếm từ `Brain/log/<date>.jsonl`.
6. **Auto-retire:** `expired-unconfirmed` (quá `unconfirmed_window_days`=14 không evidence) · `stale-no-evidence` (confirmed im quá 90d). `pinned` miễn.
7. **An toàn:** snapshot trước khi sửa = **git commit vault** (thay `.tar.zst`); ghi temp+rename; no-op run không ghi gì (idempotent); log `Brain/log/<date>.md`.
8. Cuối: regen `Brain/active.md` = digest mọi pref `confirmed` (+3 retired gần nhất).
**Chạy:** cron/hub định kỳ (idempotent → chạy lại an toàn).

### Mảnh 4 — "Bộ não" UI tab (hub)
- Duyệt vault: cây thư mục Context/Projects/Skills/Daily + render markdown.
- Ô search → gọi `lucy_search`.
- View `Brain/active.md` (preferences Lucy đã học) + `Brain/inbox/` (signal chờ dream).
- Aesthetic: dark token theme đã có (xem NORTH_STAR §4).

---

## Wiring recall vào prompt (sau Mảnh 1+3)
Trước mỗi `claude -p`, bridge/runner **prepend `Brain/active.md`** vào system prompt (digest preference Lucy đã học) — = pattern `additionalContext`/SessionStart của open-second-brain, làm tay. (Giữ ổn định → cache-parity.)

## Quyền ghi (mirror open-second-brain)
- Agent ghi tự do: `Context/`, `Projects/`, `Daily/`, `Brain/inbox/`.
- **Máy quản, agent KHÔNG sửa:** `Brain/preferences/`, `Brain/active.md` (chỉ `dream` ghi).

## File nguồn để crib (đã clone ở BillService/)
- `basic-memory/src/basic_memory/markdown/plugins.py` — regex parser quan-sát/liên-hệ (copy thẳng).
- `basic-memory/src/basic_memory/models/search.py` — FTS5 DDL · `services/search_service.py` — `index_entity_markdown` + relaxed-OR.
- `open-second-brain/src/core/brain/dream.ts` — cả thuật toán · `computeConfidence` (~dòng 2021-2061) · `{signal,preference,types}.ts` — frontmatter · `policy.ts` (374-418) — default thresholds.

## Defer (KHÔNG làm M1)
vector/semantic search (sqlite-vec) · wikilink-graph CTE (`build_context`) · quarantine/guardrails · schema notes.
