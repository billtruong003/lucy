# MEMORY → PEAK + BRAIN UI/UX — đề xuất hướng (đọc trước khi làm tiếp)

> **Viết 2026-06-10.** Sau khi xong **M1** (recall FTS5 · write-back · dream · tab Bộ não) + **M1.5 galaxy**
> ([NEURAL_GALAXY.md](NEURAL_GALAXY.md)). Đây là **đề xuất** đẩy trí nhớ Lucy lên "peak" + làm UI não đẹp hơn.
> Rút từ source thật **Hermes** (`references/hermes-agent`, file-cited) — đúng ý "dùng skill của Hermes".
> Neo: [NORTH_STAR.md](NORTH_STAR.md) · [STEAL_FROM_HERMES.md](STEAL_FROM_HERMES.md) · [M1_MEMORY_SPEC.md](M1_MEMORY_SPEC.md).

---

## A. MEMORY → PEAK — 7 nâng cấp (xếp theo giá trị)

| # | Nâng cấp | Hermes (file) | Map vào Lucy (vault + better-sqlite3 + claude -p) | Hạng |
|---|---|---|---|---|
| **A1** | **Vòng evidence KHÉP KÍN** — preference *confirmed* thật | `background_review.py:300` (memory metadata) | **Lỗ hổng SỐ 1 của ta:** dream graduate ra `unconfirmed` nhưng KHÔNG gì confirm (chưa ai ghi `Brain/log/*.jsonl`). → khi agent **áp** 1 preference (làm theo) hoặc **vi phạm**, ghi `{ts,prefId,kind:'applied'|'violated'}`. Wilson mới chạy → `active.md` đầy dần, hành tinh sáng lên. **Cơ khí đã có sẵn — chỉ thiếu mạch ghi.** | ⭐ PEAK |
| **A2** | **Auto-memory nền** (học liên tục, không cản UX) | `background_review.py:34–148` (3 prompt) | Sau mỗi card, fork `claude -p` (cache-parity) distill signal GIÀU hơn hook deterministic — kèm danh sách "KHÔNG được bắt" (lỗi môi trường/transient). Ghi `Brain/inbox/`. = skill-loop Hermes rẻ hoá. | ⭐ PEAK |
| **A3** | **Session-lineage + nén có cấu trúc** | `hermes_state.py:440` · `context_compressor.py:522,1314` | Bảng `sessions(parent_id, end_reason, summary)`. Khi chuỗi card dài → summary **template** (Active/Goal/Done/Pending/Files) + **temporal anchor** ("hôm nay 2026-..; việc xong = quá khứ") → chống "giải lại việc cũ". | ⭐ PEAK |
| **A4** | **Curator lifecycle** active→stale→archived + **pin** | `curator.py:56,268` | Mở rộng dream: thêm `last_recall_at`, `pinned`; pin miễn retire (đã có khung). UI nút 📌. Vault không phình tuyến tính, ký ức cũ mờ nhưng cứu được. | TB |
| **A5** | **Recall-count ranking + progressive disclosure** | `memory_manager.py:373` · honcho `client.py:326` | Cột `recall_count`/note; recall `ORDER BY relevance, recency, recall_count`; cap token khi prepend `active.md`. High-signal nổi lên, context không phình. | TB |
| **A6** | **Dual-tokenizer (trigram)** cho tiếng Việt substring | `hermes_state.py:527` (FTS_TRIGRAM) | Ta đã có `remove_diacritics 2` (tốt cho dấu). Thêm FTS trigram → tìm **substring/mã/tên riêng** ("radiant", "HMAC", "phase-14"). Search hợp 2 index. | TB |
| **A7** | **Graph-walk recall** (kéo theo entity liên quan) | basic-memory `build_context` (đã clone) | Galaxy đã có wikilink graph. Thêm recall "đi theo cạnh": hỏi A → kéo kèm note nối A 1–2 bước. Vừa sâu recall vừa nuôi tinh hà. | TB |

**Bắt đầu từ A1** — nó biến hệ "ghi nhớ" thành hệ "**học thật**": `active.md` đầy lên, tinh hà sáng dần khi dùng. Cơ khí Wilson/dream tôi đã build; A1 chỉ là **mạch ghi evidence** còn thiếu.

---

## B. BRAIN UI/UX → đẹp hơn (tab "Bộ não" hiện còn khô)

**Chẩn hiện trạng:** `Memory.tsx` = list emoji + chữ, phẳng, chưa "premium". Galaxy đẹp nhưng **tách rời** ở tab Neural.
**Tham chiếu chất lượng:** web UI Hermes (`references/hermes-agent/web/src`) — **lucide-react icon + design-system** (Card/Badge/Switch/Dialog/Drawer), search+filter, hub-install. Sạch, có nhịp.

**6 hướng (giữ dark-premium NORTH_STAR §4: nền `#05070e`, accent cyan):**
1. **Galaxy làm HERO của tab Bộ não** — gộp: trên = tinh hà sống, dưới/bên = panel chi tiết (note/preference). Bộ não = "nhìn" (galaxy) + "tra" (search) + "duyệt" 1 chỗ, không tách Neural.
2. **Bỏ emoji → lucide-react** (Brain, Sparkles, Pin, FileText, GitBranch…) — nét, đồng bộ, không "AI slop".
3. **Capability cards** đầu tab: *Vault N note · M preference (k confirmed) · Inbox chờ dream · Token tiết kiệm* — như Hermes Card/Badge.
4. **Preference card** = thanh **confidence Wilson** (màu theo band) + nút **pin 📌** + list evidence (signal/card) + nút áp/bác (→ feed A1).
5. **Inbox = "accretion preview"**: signal nào sắp đủ ngưỡng → hiện "2/2 — sắp thành sao", bấm Dream thấy nó tụ lại (nối hiệu ứng galaxy L4).
6. **Timeline lifecycle** + **recall heatmap**: trục thời gian active→stale→archived; ô nóng = note hay được recall. (Hermes KHÔNG có cái này → ta hơn nó.)

> Hermes **không có** memory dashboard (chỉ CLI + SkillsPage). → Lucy có **lợi thế UX thật**: làm "bộ não nhìn được" mà Hermes thiếu.

---

## C. Thứ tự đề xuất
```
1. A1 evidence-loop        → hệ "học thật", active.md đầy, hành tinh sáng   [nhỏ, ROI cao nhất]
2. B (UI redesign)         → tab Bộ não premium + galaxy hero + lucide       [vừa]
3. A2 auto-memory nền      → học liên tục sau mỗi card                       [vừa]
4. A4/A5 curator+ranking   → vault hygiene + recall sắc                       [vừa]
5. A3 session-lineage      → chống giải lại việc cũ (khi chuỗi card dài)      [lớn hơn]
6. A6/A7 trigram+graph-walk→ recall tiếng Việt + theo cạnh                    [tuỳ nhu cầu]
+ Galaxy L4/L5 (dream-accretion, git time-travel) xen vào B.
```
**Khuyến nghị:** A1 trước (biến memory thành "sống"), rồi B (đẹp) — 2 cái này cho cảm giác "peak" rõ nhất.

## Sources
Hermes: `references/hermes-agent/{hermes_state,agent/context_compressor,agent/background_review,agent/curator,agent/memory_manager,plugins/memory/honcho/client}.py` + `web/src` (UI). · Đã build: `agent-machine/src/{recall,dream,signal,brain,vault}.ts` · `hub/web/src/components/{Memory,Galaxy,viz3d}.tsx`.
