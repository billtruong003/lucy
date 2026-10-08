# Trí nhớ

Trí nhớ dài hạn của Lucy là một thư mục chứa các file Markdown thuần, gọi là **vault**. Lucy đọc vault trước khi trả lời, ghi điều mới học vào đó và dọn dẹp lại mỗi đêm. Bạn mở cùng thư mục đó bằng Obsidian hay trình soạn thảo nào cũng được, và sửa tay thoải mái.

Hai nguyên tắc giải thích phần lớn cách nó hoạt động:

- **File là sự thật.** Chỉ mục tìm kiếm nằm ở `.index/memory.db` trong vault. Nó chỉ là bộ đệm: xoá đi thì sẽ được dựng lại từ file.
- **Một số thư mục thuộc về máy.** Agent và bạn ghi vào `Context/`, `Projects/`, `Daily/`, `Brain/inbox/`. Chỉ có tiến trình *dream* ban đêm mới ghi `Brain/preferences/` và `Brain/active.md`.

Vị trí vault lấy từ `LUCY_VAULT`, thường là `~/lucy/lucy-vault`. Nếu `LUCY_VAULT` chưa đặt hoặc trỏ tới thư mục không tồn tại, các tính năng trí nhớ tự tắt, không báo lỗi. Khi đó các route brain của coordinator trả về `configured: false`.

## Cấu trúc vault

| Thư mục | Chứa gì | Ai ghi | Được recall tìm |
|---|---|---|---|
| `Context/` | Sự thật bền về bạn và môi trường của bạn. `Context/USER.md` là hồ sơ chính. | Bạn, Lucy | có |
| `Projects/` | Mỗi dự án một note: mục tiêu, quyết định, liên kết | Bạn, Lucy | có |
| `Knowledge/` | Kiến thức tham khảo lâu dài, nhóm theo chủ đề | Bạn, Lucy | có |
| `Reference/` | Tài liệu tham khảo bạn muốn tra được | Bạn | có |
| `Reports/` | Báo cáo dài Lucy ghi ra file thay vì dán vào chat | Lucy | có |
| `Skills/` | Ghi chú "cách làm" cá nhân. Đây không phải thư viện [Agent Skills](./skills-mcp.md). | Bạn, Lucy | có |
| `Daily/` | Note phiên: mỗi card kết thúc có một note Goal/Done/Pending/Files | Engine | có |
| `Brain/inbox/` | *Tín hiệu* thô, tức các mẫu hành vi quan sát được, chờ dream xử lý | Lucy, engine | không |
| `Brain/inbox/processed/` | Tín hiệu dream đã xử lý | Dream | không |
| `Brain/preferences/` | Quy tắc đã học (`pref-<topic>.md`), kèm trạng thái và độ tin cậy | Chỉ dream | không |
| `Brain/active.md` | Bản tóm tắt các preference đã xác nhận, được chèn vào prompt của agent | Chỉ dream | không |
| `Brain/log/` | `<ngày>.jsonl` (sự kiện evidence) và `<ngày>.md` (log của dream) | Dream, hub | không |
| `Brain/agents/` | "Kinh nghiệm nghề" của từng persona: bài học mỗi agent đã rút ra | Engine, dream | không |
| `Brain/claude-memory/` | Auto-memory có sẵn của Claude Code, được chuyển hướng vào vault (mỗi file một fact, kèm chỉ mục `MEMORY.md`) | Claude Code | có |
| `Brain/episodes/` | Ký ức xuyên phiên (`sessions-<chat>.jsonl`) | Coordinator | chỉ file `.md` |
| `Brain/proposals/` | Báo cáo gộp trí nhớ hằng đêm (`consolidate-<ngày>.md`) | Dream | có |
| `Brain/decisions/`, `Brain/entities/` | Note tuyển chọn (tuỳ chọn) | Bạn | có |
| `.index/` | Chỉ mục SQLite (`memory.db`), dựng lại được | Recall | – |
| `.snapshots/` | Bản sao lưu tự động trước khi dream hoặc consolidate sửa gì đó (giữ 30 bản gần nhất) | Dream | – |
| `.trash/` | Note bị bộ dọn rác chuyển ra | Hub | – |
| `_brain.yaml` | Ngưỡng của dream (tuỳ chọn, xem bên dưới) | Bạn | – |

Danh sách thư mục được index mặc định nằm trong `recall.ts`. Muốn thay toàn bộ danh sách thì đặt `LUCY_INDEX_DIRS`:

```bash
LUCY_INDEX_DIRS="Context,Projects,Knowledge,Daily,Brain/claude-memory"
```

### Định dạng note

File Markdown nào cũng dùng được. Theo vài quy ước dưới đây thì Lucy hiểu cấu trúc tốt hơn:

```markdown
---
title: Home lab
tags: [infra, homelab]
valid_from: 2026-01-10
---
# Home lab

- [hardware] Mini PC 32 GB RAM #infra
- [network] Dịch vụ nằm sau reverse proxy (chỉ nội bộ)
- runs_on [[Proxmox]]
- related_to "Kế hoạch backup" [[backup-plan]]
```

- `- [danh-mục] nội dung #tag (ngữ cảnh)` là một **quan sát**. Mỗi quan sát được index thành một dòng riêng, nên tìm theo danh mục được.
- `- quan_hệ [[Đích]]` là một **liên hệ**. Recall đi theo các wikilink này một bước, cả hai chiều, để gợi ý note liên quan.
- `valid_to:` trong frontmatter đánh dấu fact không còn đúng nữa (xem [Fact hai trục thời gian](#valid-to)).
- Tiêu đề lấy từ `title:`; nếu không có thì lấy dòng `# heading` đầu tiên, rồi tới tên file.

## Recall hoạt động thế nào

Lucy tìm trong vault ở hai chỗ:

1. **Trước mỗi lượt chat.** Bridge Telegram và web hub gọi `POST /recall` của coordinator rồi chèn một khối "trí nhớ liên quan" ngắn vào prompt.
2. **Trong lúc agent làm việc.** Agent gọi được tool `memory_recall` khi server MCP `memory` được gắn vào (xem [Skills & MCP](./skills-mcp.md)). Agent cũng đọc thẳng vault được, vì vault được thêm làm thư mục phụ.

```
câu hỏi
  │
  ├─► FTS5 (unicode61, bỏ dấu) ─ AND chặt
  │      └─ không có kết quả & ≥2 từ → OR nới lỏng (bỏ stopword)
  │           └─ vẫn không có & ≥3 ký tự → khớp chuỗi con bằng trigram
  │
  ├─► KNN vector (sqlite-vec, embedding Jina)         [nếu bật LUCY_VECTOR]
  │      └─ bỏ hit xa hơn LUCY_VECTOR_MAX_DIST (0.9)
  │
  ├─► hợp nhất bằng Reciprocal Rank Fusion (k=60)
  ├─► Jina reranker trên nhóm đầu                     [nếu bật LUCY_RERANK]
  └─► + note liên quan qua [[wikilink]]  + lượt chat cũ (episodic)
```

Vài chi tiết nên biết:

- **Tiếng Việt và dấu.** Dấu bị bỏ cả lúc index lẫn lúc tìm, nên gõ `hoa` vẫn khớp `hòa`. Tìm trigram bắt được từ gõ dở và mã: `adiant` ra `radiant`.
- **Fact hết hiệu lực bị ẩn.** Note có `valid_to` không xuất hiện trong kết quả, trừ khi bạn yêu cầu (`GET /recall?includeInvalid=1`).
- **Xếp hạng.** Mỗi lần một note được trả về, `recall_count` của nó tăng thêm 1. Khi bằng điểm, note được recall nhiều hơn đứng trước, rồi tới note mới sửa gần hơn.
- **Độ tươi của chỉ mục.** Trong lúc phục vụ recall, coordinator index lại file đổi tối đa 30 giây một lần. Chỉ file đổi checksum mới bị parse lại. Embedding được bổ sung dần, mỗi request tối đa 24 note.
- **Secret bị che.** Trước khi gửi text sang Jina, và trước khi lưu lượt chat, mọi thứ trông giống key hay token đều thành `[REDACTED]`.

### Tìm vector và rerank

Tìm vector tự bật khi có `JINA_API_KEY`. Key được đọc từ biến môi trường hoặc từ `~/lucy/.env.llm` (đổi đường dẫn bằng `LLM_ENV_FILE`).

| Biến | Mặc định | Ý nghĩa |
|---|---|---|
| `JINA_API_KEY` | – | Bật embedding và reranker |
| `LUCY_VECTOR` | bật nếu có key | `0`/`off` = chỉ tìm theo từ khoá (FTS5) |
| `JINA_EMBED_MODEL` | `jina-embeddings-v5-omni-nano` | Model embedding |
| `JINA_EMBED_DIM` | `768` | Số chiều vector. **Đổi giá trị này thì phải chạy `npm run reindex`.** |
| `LUCY_VECTOR_MAX_DIST` | `0.9` | Ngưỡng khoảng cách cosine cho hit vector |
| `LUCY_RERANK` | tắt | `1` = rerank kết quả đã gộp bằng Jina |
| `JINA_RERANK_MODEL` | `jina-reranker-v2-base-multilingual` | Model rerank |
| `LUCY_EMBED_THROTTLE_MS` | `1200` | Nghỉ giữa các lô embedding (tránh bị giới hạn tốc độ) |

Nếu Jina lỗi (kể cả HTTP 429 lặp lại sau khi đã chờ thử lại), tìm vector tự tắt trong tiến trình đó và recall quay về FTS5. Chat vẫn chạy bình thường.

### Cổng recall và điểm tối thiểu

Chèn trí nhớ vào mọi tin nhắn sẽ gây nhiễu, nên đường chat lọc trước:

- **Cổng (bridge Telegram).** Lệnh, câu xác nhận ngắn ("ok", "ừ") và tin quá ngắn thì bỏ qua recall. Với `LUCY_RECALL_GATE2=1` (mặc định), câu đang sửa lời Lucy hoặc chỉ trỏ về hội thoại ("cái đó", "option 2") cũng bỏ qua. Câu hỏi về quá khứ ("hôm trước", "đã chốt chưa") thì luôn chạy recall.
- **Điểm tối thiểu.** Hit có điểm của reranker phải đạt `LUCY_RECALL_MIN_SCORE` (mặc định `0.35`). Hit không có điểm rerank (FTS thuần hoặc thứ hạng hợp nhất) phải có ít nhất một từ có nghĩa trùng với câu hỏi.

| Biến | Mặc định | Ý nghĩa |
|---|---|---|
| `LUCY_RECALL_PREFETCH` | `1` | `0` = tắt recall trước mỗi lượt chat |
| `LUCY_RECALL_GATE2` | `1` | Cổng sửa lời / hỏi tiếp (chỉ bridge) |
| `LUCY_RECALL_MIN_SCORE` | `0.35` | Ngưỡng điểm rerank; `0` = tắt |
| `LUCY_RECALL_MAX` | `8` bridge / `5` hub | Số hit xin từ coordinator |
| `LUCY_RECALL_HITS` | `5` | Số hit giữ lại trong khối prompt |
| `LUCY_RECALL_BUDGET` | `800` | Giới hạn số ký tự của khối |
| `LUCY_RECALL_SNIPPET` | `200` | Số ký tự mỗi hit |
| `LUCY_RECALL_TIMEOUT` | `4` | Số giây chờ recall trước khi bỏ |
| `LUCY_RECALL_PROVENANCE` | `1` | Gắn file nguồn và tuổi vào từng hit |
| `LUCY_RECALL_FAILLOUD` | `1` | Ghi log khi recall lỗi, không giấu đi |

::: tip
`LUCY_RECALL_MIN_SCORE` chỉ áp lên điểm của reranker. Muốn lọc theo điểm thì bật thêm `LUCY_RERANK=1`.
:::

### Lịch sử hội thoại (trí nhớ episodic)

Lượt chat từ Telegram và hub được lưu vào bảng `turns` trong `memory.db`, đã che secret. Khi bạn hỏi về chuyện đã bàn trước đây, chúng hiện ra trong recall dưới dạng hit "💬 (ngày)".

| Biến | Mặc định | Ý nghĩa |
|---|---|---|
| `LUCY_EPISODIC` | bật | `0` = ngừng lưu và tìm lượt chat |
| `LUCY_EPISODIC_RETENTION_DAYS` | `90` | Lượt chat cũ hơn bị xoá (kiểm tra tối đa mỗi giờ một lần) |
| `LUCY_SESSION_SUMMARY` | tắt | `1` = khi một phiên chat đóng, ghi thêm tóm tắt vào `Brain/episodes/sessions-<chat>.jsonl` |

## Tín hiệu, evidence và dream ban đêm

Lucy học preference qua ba bước.

**1. Tín hiệu.** Mỗi tín hiệu là một file nhỏ trong `Brain/inbox/`, ghi lại một quan sát:

```markdown
---
kind: brain-signal
id: sig-2026-03-02-lucy-short-replies
created_at: 2026-03-02T10:00:00Z
topic: lucy/short-replies
signal: positive          # positive = nên làm, negative = nên tránh
agent: lucy
principle: "Trả lời chat ngắn; nội dung dài thì ghi ra file"
evidenced_by: [card-abc]
---
## Raw
Lý do nhận ra điều này…
```

Tín hiệu đến từ ba nguồn. Lucy tự ghi khi thấy một mẫu lặp lại. Engine ghi tín hiệu âm khi một card bị trả về làm lại hoặc bị từ chối ở gate. Khi một card kết thúc, một lượt chạy model rẻ (một turn) cũng có thể chắt ra một bài học, âm hoặc dương (tắt bằng `LUCY_DISTILL=0`).

**2. Dream.** `npm run dream` xử lý inbox. Bước này hoàn toàn tất định, không gọi LLM:

| Bước | Quy tắc (mặc định) |
|---|---|
| Gom nhóm | Tín hiệu được gom theo `topic` trong cửa sổ 14 ngày. Tín hiệu cũ hơn mà chưa bao giờ đủ ngưỡng thì chuyển sang `inbox/processed/`. |
| Trọng số | Tín hiệu từ bạn (phản hồi của người) và từ `bootstrap` tính ×2. Tín hiệu do máy tạo tính ×1. |
| Tốt nghiệp | Phía chiếm ưu thế đạt **2** → tạo preference `pref-<topic>.md` với trạng thái `unconfirmed`. Tín hiệu của phía thua bị huỷ. |
| Mâu thuẫn | Có cả hai phía và không phía nào đủ ngưỡng → ghi thành câu hỏi mở, tín hiệu giữ nguyên trong inbox. |
| Trùng lặp | Cùng dấu với preference đã có → tính là evidence `applied`, không tạo bản trùng. |
| Bác bỏ | Dấu ngược đạt ngưỡng → evidence `violated`, preference chuyển thành `rebutted` (trừ khi đã ghim). |
| Xác nhận | `unconfirmed` → `confirmed` ngay khi có evidence `applied` đầu tiên. |
| Độ tin cậy | Cận dưới Wilson 95% của applied so với violated, nhân với độ tươi (giảm dần về 0 trong 90 ngày). Mức: cao ≥ 0.75, trung bình ≥ 0.40, còn lại thấp. |
| Hết hạn | `unconfirmed` không có evidence sau 14 ngày → `expired`. `confirmed` không có evidence sau 90 ngày → `stale`. |
| Dọn | Preference đã nghỉ (expired/stale/rebutted) bị xoá 30 ngày sau lần cập nhật cuối. Các file trùng cùng một topic được gộp lại. |

Trước khi ghi gì, dream chép `Brain/` sang `.snapshots/dream-<thời-điểm>/`. Sau đó nó ghi file kiểu nguyên tử, nối log vào `Brain/log/<ngày>.md` và dựng lại `Brain/active.md`. Lượt chạy không có gì mới thì không ghi gì cả.

`Brain/active.md` liệt kê các preference đã xác nhận, kèm ba preference vừa bị gỡ gần nhất. File này được chèn vào system prompt của mọi agent chạy card, nên các agent làm theo những gì Lucy đã học.

**3. Evidence.** Mỗi evidence là một dòng trong `Brain/log/<ngày>.jsonl`:

```json
{"ts":1767225600000,"prefId":"pref-lucy-short-replies","kind":"applied","src":"manual"}
```

Dream ghi evidence loại `auto`. Trong tab **Bộ não** của hub, bấm 👍/👎 trên một preference sẽ ghi evidence loại `manual` và chạy dream ngay. Mỗi preference, mỗi loại, mỗi ngày chỉ tính một phiếu thủ công.

### Chỉnh ngưỡng

Đặt file `_brain.yaml` ở gốc vault để thay mặc định:

```yaml
candidate_threshold: 2
unconfirmed_window_days: 14
contradiction_window_days: 14
stale_evidence_days: 90
retire_grace_days: 30
confidence:
  high_min: 0.75
  medium_min: 0.4
```

### Gộp fact và fact hai trục thời gian (`valid_to`) {#valid-to}

Có thêm một lượt dọn tuỳ chọn cho `Brain/claude-memory/` (mỗi file một fact). Lượt này cần tìm vector, vì nó so các fact bằng độ giống nhau của embedding.

- Cặp fact có độ giống cosine ≥ `0.86` (`LUCY_CONSOLIDATE_SIM`) được gửi cho một model rẻ. Model trả lời `NOOP`, `DELETE` (trùng hoàn toàn), `UPDATE` (gộp vào fact được giữ) hoặc `SUPERSEDE` (hai fact mâu thuẫn nhau).
- **SUPERSEDE không bao giờ xoá.** Nó ghi `valid_to: <bây giờ>` vào frontmatter của fact cũ. Recall sẽ ẩn fact đó, nhưng file và lịch sử vẫn còn.
- Fact loại `user` hoặc `feedback` tính trọng số gấp đôi. Fact cũ có độ tin cao hơn thì không bao giờ bị tự động vô hiệu hoá.
- Các cụm fact (độ giống ≥ `0.78`, tổng trọng số ≥ 5) có thể sinh "insight" đề xuất. Chúng chỉ nằm trong báo cáo.
- Model lỗi hoặc trả lời không rõ thì coi như `NOOP`.
- Mỗi lần chạy ghi `Brain/proposals/consolidate-<ngày>.md`. Mặc định là **chạy thử**; chỉ ghi thật khi `LUCY_CONSOLIDATE_APPLY=1`. Khi ghi thật, nó chụp `claude-memory/` vào `.snapshots/` trước.

`npm run dream` chỉ chạy bước gộp này khi `LUCY_CONSOLIDATE=1` và tìm vector đang bật. Bạn cũng tự cho một fact "nghỉ hưu" được: thêm `valid_to: 2026-03-01` vào frontmatter, và từ lần reindex sau recall không trả nó ra nữa.

### Chạy dream mỗi đêm

`bridge/cron_dream.sh` chạy trọn chuỗi việc ban đêm: dream (bật gộp và ghi thật), reindex tăng dần, rồi in một dòng "nhịp tim học" (số lượt chat hôm nay, số note, số note chờ embed). Nếu có `TELEGRAM_BOT_TOKEN` và `LUCY_ALLOWED_USER_ID`, nó gửi thêm tóm tắt qua Telegram. Nó im lặng khi không có gì thay đổi và cũng không có dòng nhịp tim nào.

```bash
# crontab -e   (02:00 mỗi đêm)
0 2 * * * /path/to/lucy/bridge/cron_dream.sh >> /path/to/lucy-workspace/dream-cron.log 2>&1
```

Cùng lượt đó cũng cô đọng bài học của từng persona trong `Brain/agents/`. Khi một persona gom đủ 16 bài học thô trở lên, chúng được gộp thành tối đa 8 quy tắc, và bài học thô cũ được lưu trữ sang chỗ khác.

## Ghim

Preference đã ghim được miễn khỏi bác bỏ, hết hạn, bị coi là cũ, bị dọn và bị gộp trùng. Có ba cách ghim:

- Nút 📌 trên preference trong tab Bộ não của hub.
- Qua API (thông qua hub, hoặc gọi thẳng coordinator):
  ```bash
  curl -s -X POST http://127.0.0.1:8780/brain/pin \
    -H "x-worker-token: <AM_TOKEN>" -H 'content-type: application/json' \
    -d '{"prefId":"pref-lucy-short-replies","pinned":true}'
  ```
- Đặt `pinned: true` trong frontmatter của preference. Đây là chỉnh sửa duy nhất trong `Brain/preferences/` mà bạn làm tay an toàn.

## Dọn rác

Trong tab Bộ não của hub, bạn quét được vault để tìm rác rồi chuyển chúng ra:

- bản xung đột do đồng bộ (`sync-conflict`, `conflicted copy`, `*.orig.md`)
- file rỗng, hoặc file chỉ có frontmatter
- bản trùng y hệt (cùng mã băm nội dung; giữ bản đầu tiên)

Thao tác dọn **chuyển** các file được chọn vào `.trash/<thời-điểm>/` trong vault, không xoá gì cả. Lượt quét bỏ qua `.git`, `.obsidian`, `.trash`, `node_modules` và các thư mục bắt đầu bằng dấu chấm, và trả về tối đa 400 mục mỗi lần. Endpoint trên hub là `GET /api/memory/junk` và `POST /api/memory/clean`.

## Sửa note bằng tay / Obsidian

Mở thư mục vault như một vault Obsidian. Wikilink, tag và frontmatter hoạt động như bình thường.

- **Sửa thoải mái:** mọi thứ trong `Context/`, `Projects/`, `Knowledge/`, `Reference/`, `Reports/`, `Skills/`, `Daily/`, và tín hiệu bạn tự viết trong `Brain/inbox/`.
- **Đừng sửa:** `Brain/active.md` và `Brain/preferences/*.md` (ngoại trừ `pinned:`). Lần dream sau sẽ ghi đè. Muốn đổi một quy tắc thì viết tín hiệu, bấm 👍/👎, hoặc ghim nó.
- **Dạy Lucy một sự thật:** thêm một dòng quan sát vào `Context/USER.md`, ví dụ `- [work] Thích dùng TypeScript cho service mới #dev`.
- **Dạy Lucy một quy tắc:** thả một file tín hiệu vào `Brain/inbox/`. Hai tín hiệu cùng chiều, hoặc một tín hiệu do bạn viết, sẽ thành preference ở lần dream kế tiếp.

Thay đổi của bạn tới được recall ở lần reindex tăng dần kế tiếp: trong khoảng 30 giây nếu coordinator đang phục vụ recall, hoặc ở lượt chạy ban đêm.

## Index lại

```bash
cd ~/lucy/agent-machine
LUCY_VAULT=~/lucy/lucy-vault npm run reindex
```

Lệnh này xoá chỉ mục, dựng lại từ file, và embed toàn bộ note nếu tìm vector đang bật. Chạy nó sau khi đổi `JINA_EMBED_DIM` hoặc `LUCY_INDEX_DIRS`, sau khi nhập nhiều note một lúc, hoặc khi kết quả tìm kiếm trông sai. Xoá `.index/memory.db` cũng an toàn, file sẽ được tạo lại ở lần khởi động sau. Có điều lịch sử lượt chat cũng nằm trong file đó, nên xoá là mất luôn.

## Sao lưu vault thành repo git riêng

Giữ vault trong một repository **riêng tư** của riêng nó, tách khỏi mã nguồn Lucy:

```bash
cd ~/lucy/lucy-vault
git init -b main
cat > .gitignore <<'EOF'
.index/
.snapshots/
.trash/
*.tmp
EOF
git add -A && git commit -m "vault: initial import"
git remote add origin <url-repo-riêng-tư-của-bạn>
git push -u origin main
```

Sau đó commit theo lịch, ví dụ ngay sau dream ban đêm:

```bash
# crontab: 03:00, sau cron_dream.sh
0 3 * * * cd /path/to/lucy-vault && git add -A && (git diff --cached --quiet || git commit -qm "vault $(date +\%F)") && git push -q
```

Trong repo có `tools/vault-backup.sh`, một script tham khảo làm việc này bằng `rsync` sang một bản checkout riêng. Nó từ chối chạy nếu vault trông như rỗng (dưới 1000 file) và mặc định là `DRY=1`. Đường dẫn và tên repo trong script được ghi cứng, nên sửa lại trước khi dùng.

::: warning
Vault chứa dữ liệu cá nhân và toàn bộ lịch sử hội thoại (`memory.db`). Repo sao lưu phải để riêng tư, và đừng bao giờ commit file `.env*` vào đó.
:::

## Tra cứu lệnh

Chạy trong `agent-machine/`, với `LUCY_VAULT` trỏ tới vault của bạn. Nếu không đặt, mặc định là `../lucy-vault`.

| Lệnh | Tác dụng |
|---|---|
| `npm run reindex` | Dựng lại toàn bộ chỉ mục, kèm embedding nếu tìm vector đang bật |
| `npm run recall -- "câu hỏi"` | Reindex tăng dần rồi tìm (hybrid khi tìm vector đang bật) |
| `npm run recall -- --recent 7d` | Note đổi trong 7 ngày qua (`h`/`d`/`w`/`m`) |
| `npm run recall -- --embed` | Chỉ embed các note còn thiếu vector |
| `npm run recall -- stats` | Một dòng "nhịp tim học" |
| `npm run dream` | Xử lý tín hiệu thành preference, dựng lại `active.md`, cô đọng bài học của agent; gộp fact nếu `LUCY_CONSOLIDATE=1` |
| `npm run consolidate` | Gộp fact trong `Brain/claude-memory` (chạy thử; thêm `LUCY_CONSOLIDATE_APPLY=1` để ghi thật) |
| `npm run bootstrap` | Chạy một lần: rút quy tắc ứng xử từ `Brain/claude-memory` thành tín hiệu (dùng `claude` CLI), rồi chạy dream |
| `npm run smoke:memory-all` | Bộ test trí nhớ (không cần mạng) |

Coordinator cung cấp các thao tác tương tự qua HTTP cho hub: `POST /brain/reindex`, `POST /brain/dream`, `POST /brain/evidence`, `POST /brain/pin`, `GET /brain/state`, `GET /recall?q=…`. Mọi route trừ `/health` đều cần header `x-worker-token`.
