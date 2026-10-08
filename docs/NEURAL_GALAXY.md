# NEURAL GALAXY — tinh hà tri thức của Lucy (graph trí nhớ sống, nở theo thời gian)

> **Viết 2026-06-10.** Design doc cho 1 nhánh **M1.5** (đứng giữa [M1 trí nhớ](NORTH_STAR.md) đã xong và M2 MCP).
> Ý gốc của Bill: *"thêm neural vào graph Lucy để show nó mở rộng theo thời gian khi dùng — càng dùng càng
> nhiều node, neural for real… kiểu 1 tinh hà với vô số hành tinh tri thức."*
> Neo: [NORTH_STAR.md](NORTH_STAR.md) (tab Bộ não + Neural) · [M1_MEMORY_SPEC.md](M1_MEMORY_SPEC.md) (recall/dream đã build).
> **Đây là THIẾT KẾ — chưa build.** Chốt vision trước, rồi mới code.

---

## 0. TL;DR — vì sao làm được THẬT (không phải hiệu ứng)

Tab **Neural** (BrainViz) hiện tại đẹp nhưng cạnh phần lớn **vẽ cho rậm** (nối tay zone↔zone, cross-link
trang trí — xem `hub/web/src/components/BrainViz.tsx` + `/api/telemetry`). M1 vừa tạo ra **dữ liệu để graph
SỐNG THẬT**: node = note thật, **cạnh = wikilink `[[...]]` thật**, **trọng số = confidence Wilson học được**,
**độ sáng = recall trúng (neuron bắn xung)**. Đây sẽ là **graph ngữ nghĩa thật đầu tiên** của Lucy — và vì
vault nằm trên git, **nó chỉ nở thêm, không co lại**: càng dùng càng nhiều hành tinh.

> **Một câu:** biến "Bộ não" từ *danh sách note* → *một vật thể vũ trụ sống* mà Bill nhìn là thấy Lucy lớn lên.

---

## 1. Bản đồ ẩn dụ → dữ liệu M1 (1-1, không bịa)

| Vũ trụ | Là gì trong vault | Nguồn dữ liệu (đã có ở M1) |
|---|---|---|
| 🌌 **Tinh hà** | toàn bộ `lucy-vault/` | repo |
| 🪐 **Hành tinh** | 1 note: `Context/USER` · mỗi `Projects/*` · `Skills/*` · `Brain/entities/*` | `vault.ts::parseNote` · `brain.ts::browseVault` |
| 🌙 **Mặt trăng** | observation `- [danh-mục] …` + preference đã học (quay quanh hành tinh chủ) | `vault.ts` observations · `brain.ts::listPreferences` |
| ✨ **Đường sao (cạnh)** | **wikilink `[[target]]`** giữa note = quan hệ ngữ nghĩa thật | `vault.ts::parseNote().relations` (ĐÃ parse, chỉ chưa expose) |
| 💡 **Độ sáng / khối lượng** | preference: **confidence Wilson**; note: độ mới (`mtime`) + số quan sát | `dream.ts::computeConfidence` · FTS5 `note.mtime` |
| ⚡ **Xung thần kinh** | node **pulse khi recall MATCH trúng nó** | `recall.ts::search` (FTS5 hit) |
| 🌠 **Sao mới sinh** | `dream` gộp ≥2 signal → 1 preference (accretion) | `dream.ts` graduate |
| 🕳️ **Sao lụi** | preference `rebutted`/`stale`/`expired` mờ dần rồi rụng | `dream.ts` auto-retire |
| ⏳ **Giãn nở theo thời gian** | git history của `lucy-vault/` = timeline node sinh ra | `git log` |

**Mấu chốt "neural for real":** cạnh không phải nối ngẫu nhiên — là `[[wikilink]]` Bill/agent viết thật;
**độ dày cạnh = confidence học được** (preference áp nhiều lần → cạnh dày, đúng kiểu *synapse myelin hoá*).

---

## 2. Data model — `/brain/graph`

Endpoint mới ở **coordinator** (cạnh `/brain/state` đã có), trả nguyên graph dựng từ vault:

```jsonc
GET /brain/graph  →
{
  "configured": true,
  "nodes": [
    { "id": "user-bill", "label": "Bill", "kind": "person",     "zone": "context",
      "mass": 28, "brightness": 1.0, "mtime": 0, "obs": 8, "path": "Context/USER.md" },
    { "id": "project-radiant-bot", "label": "radiant-bot", "kind": "project", "zone": "projects",
      "mass": 16, "brightness": 0.7, "obs": 5, "path": "Projects/radiant-bot.md" },
    { "id": "pref-radiant-bot-fix-login", "label": "validate input ở biên", "kind": "preference",
      "zone": "learned", "mass": 8, "brightness": 0.0, "confidence": 0.0, "band": "low",
      "sign": "negative", "status": "unconfirmed", "topic": "radiant-bot/fix-login" }
  ],
  "links": [
    { "source": "user-bill", "target": "project-radiant-bot", "rel": "chủ_của", "weight": 1, "real": true },
    { "source": "pref-radiant-bot-fix-login", "target": "project-radiant-bot", "rel": "về", "weight": 0.0 }
  ],
  "born": ["pref-radiant-bot-fix-login"],   // node sinh trong phiên/dream gần nhất → animate "ló sáng"
  "ts": 1749549600000
}
```

**Node kinds → zone (gom cụm như chòm sao):**
- `person` · `identity` → zone **context** (lõi tinh hà — hành tinh trung tâm)
- `project` → zone **projects**
- `skill` → zone **skills**
- `entity` (người/repo/tool trong `Brain/entities`) → zone **entities** (hub nhiều cạnh → cụm dày tự nhiên)
- `preference` → zone **learned** (quay quanh project/topic chủ)
- `daily` → zone **timeline** (nhật ký, mờ dần theo tuổi)

**Cạnh (link):**
- **explicit** — wikilink quan hệ `- chủ_của [[user-bill]]` → `rel` = nhãn, `real: true`.
- **inline** — `[[...]]` lẫn trong văn → `rel: "links_to"`.
- **derived** — preference → node `topic`/project của nó (cho preference bám hành tinh chủ). `weight = confidence`.

**Công thức (deterministic, từ data M1):**
```
brightness(note)  = clamp(1 - age_days / 90, 0.15, 1)            // mới = sáng; 90d khớp stale_evidence_days
brightness(pref)  = confidence                                   // Wilson lower-95 × freshness (dream.ts)
mass(node)        = base[kind] + obs_count * 1.5                 // nhiều quan sát → hành tinh to
edge_weight       = pref ? confidence : 1                        // cạnh học được dày theo độ tin
pulse(node)       = (now - last_recall_hit) < 8s                 // recall trúng → bắn xung (như lastAkiAt)
```

---

## 3. Ba mạch "wow" (đều rẻ vì data sẵn)

### 3.1. Giãn nở thật — monotonic growth
Vault chỉ thêm file (note/preference/entity), không xoá (retire = đổi status, vẫn còn node mờ). → graph
**chỉ nở**. Mỗi phiên Bill dùng Lucy ghi thêm signal → dream đẻ preference → **hành tinh mới mọc**. Node sinh
trong lần load này (`born[]`) **animate "ló sáng + bay vào quỹ đạo"** thay vì hiện đột ngột.

### 3.2. Dream = sự hình thành sao (accretion)
Khi bấm **🌙 Dream** (đã có ở tab Bộ não): mấy signal trong Inbox (hạt bụi) **xoáy tụ vào nhau → kết thành
1 ngôi sao preference mới**. Consolidation = accretion. `dream.ts` đã trả `summary.graduated/processedSignals`
→ UI biết bụi nào tụ thành sao nào.

### 3.3. Tua lại lịch sử tinh hà — git time-travel ⭐
`lucy-vault/` là git. → đọc `git log --reverse` của vault, **replay từng commit thành 1 frame**: kéo thanh
thời gian thấy **tinh hà nở dần qua từng ngày Bill dùng Lucy**. Đây mới là "càng dùng càng đã" thật sự — và
gần như free (chỉ cần `git log -p` parse ra snapshot node theo mốc). *(Lát sau, optional.)*

---

## 4. Ghép vào cái đang có (không phá Neural hiện tại)

- **Backend:** thêm `/brain/graph` (coordinator) + `brain.ts::buildGraph(vault)` — dựng nodes/links từ
  `parseNote().relations` (đã có) + `listPreferences`. Hub proxy `/api/brain/graph` (1 dòng, pattern sẵn).
- **Frontend:** BrainViz **đã là 3D three.js + OrbitControls** → đổ thêm 1 lớp "MEMORY galaxy":
  - Option A (khuyến nghị): **toggle overlay** trong tab Neural — "Live" (telemetry hiện tại) vs "Galaxy" (memory).
  - Option B: cụm zone mới `z_memory` trộn vào telemetry sẵn (1 graph chung).
- **Pulse khi recall:** ô search ở tab Bộ não gọi recall → đánh dấu node trúng `active:true 8s` (y hệt
  `lastAkiAt` làm node Aki sáng ở `/api/telemetry`).
- **Reuse màu/teme:** giữ dark token (`#05070e`, accent cyan) — premium, đúng [NORTH_STAR §4](NORTH_STAR.md).

---

## 5. Lộ trình build (lát nhỏ, mỗi lát thấy được)

```
L1  /brain/graph + buildGraph(vault): nodes(note) + links(wikilink) + brightness/mass.   [~0.5 ngày]
    → curl thấy graph thật. Foundation.
L2  BrainViz overlay "Galaxy": render nodes 3D theo zone, cạnh wikilink, độ sáng=brightness. [~1 ngày]
    → NHÌN THẤY tinh hà, click hành tinh → mở note (nối tab Bộ não).
L3  Recall pulse + born-animation: search trúng → node bắn xung; node mới ló sáng.          [~0.5 ngày]
L4  Dream-accretion: bấm Dream → bụi signal tụ thành sao (animate từ summary.graduated).     [~0.5 ngày]
L5  Git time-travel slider (optional, wow): replay git log vault thành timeline nở.          [~1 ngày]
```

**Cắt tối thiểu để "thấy đã":** L1+L2+L3 (~2 ngày) = tinh hà sống + bắn xung khi recall. L4/L5 thêm sau.

---

## 6. Lưu ý kỹ thuật / defer
- **Perf:** vault vài chục–vài trăm note → graph nhẹ, three.js thừa sức. Khi >~2k node mới cần cluster/LOD (defer).
- **Wikilink chưa khớp:** `[[target]]` trỏ note chưa tồn tại → vẽ node "ghost" mờ (gợi ý chỗ nên viết tiếp) — đúng tinh thần `MEMORY.md` "link liberally".
- **KHÔNG index để vẽ:** graph đọc thẳng file qua `brain.ts` (như `/brain/state`), không cần đụng FTS5 DB — tách bạch recall (tìm) vs galaxy (nhìn).
- **Defer:** vector/semantic edges (sqlite-vec) · physics layout nặng · VR. M1.5 chỉ cần wikilink + confidence.

---

## 7. Vì sao đáng làm (chốt)
Đây là chỗ **trí nhớ (M1) trở thành thứ NHÌN THẤY và cảm được** — Bill mở tab, thấy Lucy là một tinh hà
đang lớn, mỗi việc mình giao để lại 1 hành tinh, mỗi điều Lucy học là 1 ngôi sao sáng dần. Nó vừa là
**UI signature** (Discord-cho-đội-AI → giờ thêm "vũ trụ tri thức"), vừa là **động lực dùng** (càng dùng tinh
hà càng nở). Và toàn bộ chạy trên data THẬT M1 đã có — không phải hiệu ứng giả.

## Sources / liên quan
M1 đã build: `agent-machine/src/{vault,recall,dream,brain,signal}.ts` · `coordinator.ts` (/brain/*) ·
`hub/web/src/components/Memory.tsx`. · Graph hiện tại: `hub/web/src/components/BrainViz.tsx` +
`hub/server/src/index.ts` (`/api/telemetry`). · Vision: [NORTH_STAR.md](NORTH_STAR.md).
