// recall.ts — FTS5 recall trên lucy-vault (M1). Trả lời "Lucy đã biết/làm cái này chưa?" 0-token.
// File markdown = SỰ THẬT; DB sidecar (.index/memory.db, đã gitignore) DỰNG LẠI ĐƯỢC từ file.
// Crib: basic-memory models/search.py (FTS5 DDL) + services/search_service.py (relaxed-OR fallback).
import Database from 'better-sqlite3'
import * as sqliteVec from 'sqlite-vec'
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { listVaultFiles, parseNote, slug } from './vault'
import { EMBED_DIM, f32, jinaEmbed, jinaRerank, rerankFlagOn, vectorFlagOn, type Embedder, type Reranker } from './embed'
import { scrubSecrets } from './redact'

// CHỈ index trí nhớ "tra cứu được". KHÔNG index Brain/inbox|preferences|active.md (máy quản, nhiễu).
// Brain/claude-memory = auto-memory built-in của Claude Code REDIRECT vào vault (autoMemoryDirectory,
// fix "2 não" 2026-06-11) — harness ghi theo bản năng vẫn rơi vào đây → searchable như mọi note.
// CM-1: Brain/episodes = ký ức xuyên phiên (episodic-summary) — PHẢI index để phiên sau recall thấy.
// P2: env-hoá — LUCY_INDEX_DIRS="Context,Projects,..." GHI ĐÈ toàn bộ danh sách (muốn thêm Brain/inbox
// thì opt-in qua env, đừng sửa code). Default mở rộng thêm Reference/Reports/Brain/proposals (nhánh
// curated, trước đây vô hình với recall); inbox/preferences/log VẪN loại (nhiễu máy quản — chủ đích cũ).
// WIPE 2026-07-09: vault reset — kiến thức bền chuyển sang Knowledge/ (ops/trading/unity/
// lucy-architecture). Brain/claude-memory + decisions/entities đã xóa nhưng giữ trong list (vô hại
// nếu trống, đỡ vỡ nếu máy tự tạo lại).
const DEFAULT_INDEX_DIRS = ['Context', 'Projects', 'Skills', 'Daily', 'Knowledge', 'Reference', 'Reports', 'Brain/decisions', 'Brain/entities', 'Brain/claude-memory', 'Brain/episodes', 'Brain/proposals']
const INDEX_DIRS = (process.env.LUCY_INDEX_DIRS || '').split(',').map((s) => s.trim()).filter(Boolean).length
  ? (process.env.LUCY_INDEX_DIRS as string).split(',').map((s) => s.trim()).filter(Boolean)
  : DEFAULT_INDEX_DIRS

// stopword nhẹ VN+EN — chỉ dùng cho relaxed-OR fallback (đừng OR mấy từ rỗng nghĩa).
const STOPWORDS = new Set([
  'va', 'la', 'cua', 'co', 'cho', 'khi', 'thi', 'ma', 'cac', 'nhung', 'mot', 'da', 'duoc', 'nay', 'do', 'voi', 'tu', 've',
  'the', 'a', 'an', 'of', 'to', 'in', 'on', 'for', 'is', 'are', 'and', 'or', 'with', 'at', 'by',
])

export type SearchHit = {
  file_path: string; title: string; type: string; permalink: string; tags: string
  mtime: number; snippet: string; rank: number; relaxed: boolean; tri?: boolean
  // PHASE 2 (2026-08-16): điểm LIÊN QUAN thật (reranker cross-encode, 0..1). Trước đây bị vứt sau khi
  // xếp thứ tự → caller (bridge) không có tín hiệu nào để lọc, phải đoán bằng trùng-chữ và lọc sai bét.
  score?: number
  // nguồn điểm: rerank (đáng tin) | rrf (thứ hạng hợp nhất, so tương đối) | fts (bm25 thuần, KHÔNG có điểm liên quan)
  scoreKind?: 'rerank' | 'rrf' | 'fts'
  bookend?: string  // E2: session-note (type=daily) → khung [goal]/[done]/[pending] thay mảnh 14 chữ
}
export type RelatedHit = { file_path: string; title: string; permalink: string; via: string }
export type RecallStats = { indexed: number; updated: number; deleted: number; total: number }
// PHASE 2 episodic: 1 lượt hội thoại đã lưu (turn). source = tg|hub, role = user|assistant.
export type EpisodicHit = { id: number; ts: number; source: string; chat_id: string; role: string; content: string; snippet: string; rank: number }

export class Recall {
  private db: Database.Database
  readonly vaultDir: string
  readonly dbPath: string
  private triOk = true // SQLite thiếu tokenizer trigram (build cũ) → tắt fallback, không nổ
  // PHASE 1 vector: vecOk = extension sqlite-vec nạp được + bảng dựng được. vectorOn = flag bật + chưa gặp lỗi runtime.
  private vecOk = false
  private vectorOn: boolean
  private embedder: Embedder
  // X1 rerank: xếp lại top-N sau RRF bằng Jina reranker. rerankOn = flag bật (hoặc reranker inject cho smoke).
  private reranker: Reranker
  private rerankOn: boolean

  constructor(vaultDir: string, opts: { embedder?: Embedder; vector?: boolean; reranker?: Reranker; rerank?: boolean } = {}) {
    this.vaultDir = path.resolve(vaultDir)
    const indexDir = path.join(this.vaultDir, '.index')
    fs.mkdirSync(indexDir, { recursive: true })
    this.dbPath = path.join(indexDir, 'memory.db')
    this.db = new Database(this.dbPath)
    this.db.pragma('journal_mode = WAL')
    // embedder injectable (smoke không cần mạng); flag mặc định = vectorFlagOn() (cần JINA_API_KEY) hoặc opts.vector.
    this.embedder = opts.embedder ?? jinaEmbed
    this.vectorOn = opts.vector ?? (opts.embedder ? true : vectorFlagOn())
    this.reranker = opts.reranker ?? jinaRerank
    this.rerankOn = opts.rerank ?? (opts.reranker ? true : rerankFlagOn())
    this.migrate()
    this.backfillIfNeeded()
  }

  /** Vector sẵn sàng: extension OK + flag bật + chưa gặp lỗi runtime (Jina chết → tự tắt phiên này). */
  vectorReady(): boolean { return this.vecOk && this.vectorOn }

  private migrate() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS note(
        id INTEGER PRIMARY KEY,
        file_path TEXT UNIQUE, title TEXT, type TEXT, permalink TEXT, tags TEXT,
        mtime REAL, checksum TEXT, frontmatter TEXT);
      CREATE VIRTUAL TABLE IF NOT EXISTS note_fts USING fts5(
        title, body, tags, permalink UNINDEXED, file_path UNINDEXED, note_id UNINDEXED,
        tokenize='unicode61 remove_diacritics 2 tokenchars 0x2F', prefix='2,3,4');
      CREATE VIRTUAL TABLE IF NOT EXISTS obs_fts USING fts5(
        category, content, tags, note_id UNINDEXED,
        tokenize='unicode61 remove_diacritics 2');
    `)
    // A5: đếm recall + lần recall cuối (ranking + curator). ALTER fail = cột đã có (DB cũ) → bỏ qua.
    try { this.db.exec('ALTER TABLE note ADD COLUMN recall_count INTEGER DEFAULT 0') } catch { /* đã có */ }
    try { this.db.exec('ALTER TABLE note ADD COLUMN last_recall_at REAL') } catch { /* đã có */ }
    // PHASE 4 bi-temporal (Zep-style): valid_from/valid_to đọc từ frontmatter (file = SỰ THẬT).
    // valid_to != NULL → fact ĐÃ HẾT HIỆU LỰC (mâu thuẫn/lỗi thời) → retrieval mặc định LỌC BỎ, nhưng KHÔNG xoá file
    // → lịch sử vẫn truy được (search includeInvalid). valid_from chỉ để dựng dòng thời gian (không dùng lọc).
    try { this.db.exec('ALTER TABLE note ADD COLUMN valid_from TEXT') } catch { /* đã có */ }
    try { this.db.exec('ALTER TABLE note ADD COLUMN valid_to TEXT') } catch { /* đã có */ }
    // A7: cạnh wikilink → graph-walk recall ("hỏi A kéo theo note nối A").
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS relation(source_id INTEGER, target TEXT, target_slug TEXT, rel TEXT);
      CREATE INDEX IF NOT EXISTS idx_rel_src ON relation(source_id);
      CREATE INDEX IF NOT EXISTS idx_rel_tgt ON relation(target_slug);
    `)
    // A6: FTS trigram cho substring/mã/tên riêng ("adiant" → radiant). Text BỎ DẤU sẵn lúc insert
    // (tokenizer trigram không có remove_diacritics). SQLite cũ thiếu trigram → tắt fallback.
    try {
      this.db.exec(`CREATE VIRTUAL TABLE IF NOT EXISTS note_tri USING fts5(title, body, note_id UNINDEXED, tokenize='trigram')`)
    } catch { this.triOk = false }
    this.db.exec('CREATE TABLE IF NOT EXISTS meta(key TEXT PRIMARY KEY, value TEXT)')
    // PHASE 2 episodic: lưu turn hội thoại (cross-session "hôm trước mình bàn gì về X"). turns_fts rowid = turns.id.
    // Additive: bảng riêng, KHÔNG đụng manual memory (note). Ghi/đọc gated bằng flag LUCY_EPISODIC ở caller.
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS turns(
        id INTEGER PRIMARY KEY, ts REAL, source TEXT, chat_id TEXT, role TEXT, content TEXT, session_id TEXT);
      CREATE INDEX IF NOT EXISTS idx_turns_ts ON turns(ts);
      CREATE VIRTUAL TABLE IF NOT EXISTS turns_fts USING fts5(content, tokenize='unicode61 remove_diacritics 2');
    `)
    // PHASE 1: vector store sqlite-vec. embed_checksum = checksum lúc embed (NULL/khác → cần embed lại).
    try { this.db.exec('ALTER TABLE note ADD COLUMN embed_checksum TEXT') } catch { /* đã có */ }
    try {
      sqliteVec.load(this.db)
      this.db.exec(`CREATE VIRTUAL TABLE IF NOT EXISTS vec_note USING vec0(embedding float[${EMBED_DIM}])`)
      this.vecOk = true
    } catch { this.vecOk = false } // build SQLite/extension không có → thuần FTS5, không nổ
  }

  private static SCHEMA = '3' // bump khi thêm cột/bảng dẫn xuất (trigram/relation/valid_to) → full reindex 1 LẦN cho DB cũ
  private backfillIfNeeded() {
    const v = (this.db.prepare("SELECT value FROM meta WHERE key='schema'").get() as { value: string } | undefined)?.value
    if (v === Recall.SCHEMA) return
    const notes = (this.db.prepare('SELECT COUNT(*) c FROM note').get() as { c: number }).c
    if (notes) this.reindex({ full: true })
    this.db.prepare("INSERT INTO meta(key,value) VALUES('schema',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(Recall.SCHEMA)
  }

  // Heartbeat việc học: đếm nhanh để cron_dream báo mỗi đêm — tránh trường hợp học TẮT im lặng
  // (coordinator lỗi / vector 429 / episodic ngừng ghi) mà không ai biết. Ngày = giờ VN (UTC+7).
  learningStats(): { turnsToday: number; turnsTotal: number; notesTotal: number; embedPending: number; embedTotal: number; vectorReady: boolean } {
    // turns.ts lưu bằng Date.now() (ms). Ngày = giờ VN (UTC+7): lùi về nửa đêm VN theo ms.
    const nowMs = Date.now()
    const dayStartMs = nowMs - ((nowMs + 7 * 3600e3) % 86400e3)
    const turnsToday = (this.db.prepare('SELECT COUNT(*) c FROM turns WHERE ts >= ?').get(dayStartMs) as { c: number }).c
    const turnsTotal = (this.db.prepare('SELECT COUNT(*) c FROM turns').get() as { c: number }).c
    const notesTotal = (this.db.prepare('SELECT COUNT(*) c FROM note').get() as { c: number }).c
    const embedPending = (this.db.prepare('SELECT COUNT(*) c FROM note WHERE embed_checksum IS NULL OR embed_checksum != checksum').get() as { c: number }).c
    return { turnsToday, turnsTotal, notesTotal, embedPending, embedTotal: notesTotal - embedPending, vectorReady: this.vectorReady() }
  }

  close() { this.db.close() }

  // ── REINDEX: so mtime+sha256 với row note; đổi → re-parse → upsert. Xoá note mất file. ──
  // full=true → drop sạch rồi dựng lại từ file (lệnh `lucy reindex`).
  reindex(opts: { full?: boolean } = {}): RecallStats {
    if (opts.full) {
      this.db.exec('DELETE FROM note; DELETE FROM note_fts; DELETE FROM obs_fts;')
      if (this.vecOk) try { this.db.exec('DELETE FROM vec_note') } catch { /* bỏ qua */ }
    }
    const files = listVaultFiles(this.vaultDir, INDEX_DIRS)
    const stats: RecallStats = { indexed: 0, updated: 0, deleted: 0, total: 0 }
    const getNote = this.db.prepare('SELECT id, checksum FROM note WHERE file_path = ?')
    const seen = new Set<string>()

    const run = this.db.transaction(() => {
      for (const rel of files) {
        seen.add(rel)
        const abs = path.join(this.vaultDir, rel)
        let raw: string, mtime: number
        try { raw = fs.readFileSync(abs, 'utf8'); mtime = fs.statSync(abs).mtimeMs } catch { continue }
        const checksum = crypto.createHash('sha256').update(raw).digest('hex')
        const existing = getNote.get(rel) as { id: number; checksum: string } | undefined
        if (existing && existing.checksum === checksum) continue // không đổi → bỏ qua
        this.upsertNote(rel, raw, mtime, checksum)
        if (existing) stats.updated++; else stats.indexed++
      }
      // dọn note có trong DB nhưng file đã mất
      const all = this.db.prepare('SELECT id, file_path FROM note').all() as { id: number; file_path: string }[]
      for (const n of all) {
        if (seen.has(n.file_path)) continue
        this.deleteNote(n.id)
        stats.deleted++
      }
    })
    run()
    stats.total = (this.db.prepare('SELECT COUNT(*) c FROM note').get() as { c: number }).c
    return stats
  }

  private deleteNote(id: number) {
    this.db.prepare('DELETE FROM note WHERE id = ?').run(id)
    this.db.prepare('DELETE FROM note_fts WHERE rowid = ?').run(id) // note_fts rowid = note.id (1-1)
    this.db.prepare('DELETE FROM obs_fts WHERE note_id = ?').run(id)
    this.db.prepare('DELETE FROM relation WHERE source_id = ?').run(id)
    if (this.triOk) this.db.prepare('DELETE FROM note_tri WHERE rowid = ?').run(id)
    if (this.vecOk) try { this.db.prepare('DELETE FROM vec_note WHERE rowid = ?').run(BigInt(id)) } catch { /* bỏ qua */ }
  }

  private upsertNote(rel: string, raw: string, mtime: number, checksum: string) {
    const n = parseNote(raw, rel)
    const tagsStr = n.tags.join(' ')
    // PHASE 4: bi-temporal cờ đọc từ frontmatter (top-level, parseFrontmatter lo). Rỗng → NULL (còn hiệu lực).
    const validFrom = fmStr(n.frontmatter.valid_from)
    const validTo = fmStr(n.frontmatter.valid_to)
    this.db.prepare(`
      INSERT INTO note(file_path, title, type, permalink, tags, mtime, checksum, frontmatter, valid_from, valid_to)
      VALUES (@file_path, @title, @type, @permalink, @tags, @mtime, @checksum, @frontmatter, @valid_from, @valid_to)
      ON CONFLICT(file_path) DO UPDATE SET
        title=@title, type=@type, permalink=@permalink, tags=@tags, mtime=@mtime, checksum=@checksum,
        frontmatter=@frontmatter, valid_from=@valid_from, valid_to=@valid_to
    `).run({
      file_path: rel, title: n.title, type: n.type, permalink: n.permalink, tags: tagsStr,
      mtime, checksum, frontmatter: JSON.stringify(n.frontmatter), valid_from: validFrom, valid_to: validTo,
    })
    const id = (this.db.prepare('SELECT id FROM note WHERE file_path = ?').get(rel) as { id: number }).id
    // note_fts: rowid = note.id → update = delete-by-rowid + insert (rẻ, chuẩn FTS5).
    this.db.prepare('DELETE FROM note_fts WHERE rowid = ?').run(id)
    this.db.prepare('INSERT INTO note_fts(rowid, title, body, tags, permalink, file_path, note_id) VALUES (?,?,?,?,?,?,?)')
      .run(id, n.title, n.body, tagsStr, n.permalink, rel, id)
    // obs_fts: nhiều row/note → xoá theo note_id rồi chèn lại.
    this.db.prepare('DELETE FROM obs_fts WHERE note_id = ?').run(id)
    const insObs = this.db.prepare('INSERT INTO obs_fts(category, content, tags, note_id) VALUES (?,?,?,?)')
    for (const o of n.observations) insObs.run(o.category ?? '', o.content, o.tags.join(' '), id)
    // A6 trigram: text bỏ dấu (tokenizer trigram không tự bỏ) → "tinh ha" khớp "tinh hà", "adiant" khớp "radiant".
    if (this.triOk) {
      this.db.prepare('DELETE FROM note_tri WHERE rowid = ?').run(id)
      this.db.prepare('INSERT INTO note_tri(rowid, title, body, note_id) VALUES (?,?,?,?)').run(id, fold(n.title), fold(n.body), id)
    }
    // A7 relation: cạnh wikilink ra khỏi note này (target giữ raw + slug để khớp permalink).
    this.db.prepare('DELETE FROM relation WHERE source_id = ?').run(id)
    const insRel = this.db.prepare('INSERT INTO relation(source_id, target, target_slug, rel) VALUES (?,?,?,?)')
    for (const r of n.relations) insRel.run(id, r.target, slug(r.target), r.type)
    // PHASE 1: nội dung note đổi (upsert chỉ chạy khi checksum khác) → vector cũ hết hạn → reset để embedIndex() embed lại.
    if (this.vecOk) {
      this.db.prepare('UPDATE note SET embed_checksum = NULL WHERE id = ?').run(id)
      try { this.db.prepare('DELETE FROM vec_note WHERE rowid = ?').run(BigInt(id)) } catch { /* bỏ qua */ }
    }
  }

  // ── SEARCH: FTS5 MATCH rank bm25 → relaxed-OR (≥2 token) → trigram substring (A6). ──
  // A5: hit nào trả ra → bump recall_count + last_recall_at (high-signal nổi dần, nuôi curator/brightness).
  search(query: string, opts: { type?: string; after?: number; limit?: number; includeInvalid?: boolean } = {}): SearchHit[] {
    const limit = Math.max(1, Math.min(opts.limit ?? 10, 50))
    const tokens = tokenize(query)
    if (!tokens.length) return []
    const strict = tokens.map((t) => `"${t}"`).join(' ') // implicit AND, quote → an toàn ký tự đặc biệt
    let rows = this.runFts(strict, opts, limit)
    let relaxed = false, tri = false
    // relaxed: strict rỗng + ≥2 token + query không có toán tử rõ ràng → OR (bỏ stopword).
    if (!rows.length && tokens.length >= 2 && !/["*]/.test(query)) {
      const kept = tokens.filter((t) => !STOPWORDS.has(t))
      const terms = kept.length ? kept : tokens
      rows = this.runFts(terms.map((t) => `"${t}"`).join(' OR '), opts, limit)
      relaxed = rows.length > 0
    }
    // trigram: vẫn rỗng + query ≥3 ký tự → khớp SUBSTRING ("adiant"→radiant, "hmac"→x-hmac-sig).
    if (!rows.length && this.triOk && fold(query).length >= 3) {
      rows = this.runTri(fold(query), opts, limit)
      tri = rows.length > 0
    }
    if (rows.length) this.bump(rows.map((r) => r.file_path))
    // E2: hit là session-note (type=daily) → đính khung bookend goal/done/pending (mạch lạc hơn snippet rời).
    return rows.map((r) => ({ ...r, relaxed, ...(tri ? { tri } : {}), ...(r.type === 'daily' ? { bookend: this.bookend(r.file_path) } : {}) }))
  }

  // ── PHASE 1 embedIndex: embed incremental note chưa có/đổi vector (embed_checksum NULL|khác checksum). ──
  // Text embed = title + facts (observations distill, "fact-key expansion") + body → bắt cả ý lẫn câu chữ.
  // Cap `max` mỗi lần (đường hội thoại gọi với cap nhỏ → không block turn). Jina lỗi → tắt vector phiên này.
  async embedIndex(opts: { max?: number; batch?: number } = {}): Promise<{ embedded: number; pending: number }> {
    if (!this.vectorReady()) return { embedded: 0, pending: 0 }
    const max = Math.max(1, opts.max ?? 256)
    const batch = Math.max(1, Math.min(opts.batch ?? 32, 64))
    const todo = this.db.prepare(
      'SELECT id, checksum FROM note WHERE embed_checksum IS NULL OR embed_checksum != checksum ORDER BY mtime DESC LIMIT ?',
    ).all(max) as { id: number; checksum: string }[]
    if (!todo.length) return { embedded: 0, pending: 0 }
    const getFts = this.db.prepare('SELECT title, body FROM note_fts WHERE rowid = ?')
    const getObs = this.db.prepare('SELECT content FROM obs_fts WHERE note_id = ?')
    const insVec = this.db.prepare('INSERT INTO vec_note(rowid, embedding) VALUES (?, ?)')
    const delVec = this.db.prepare('DELETE FROM vec_note WHERE rowid = ?')
    const setCk = this.db.prepare('UPDATE note SET embed_checksum = ? WHERE id = ?')
    let embedded = 0
    for (let i = 0; i < todo.length; i += batch) {
      const chunk = todo.slice(i, i + batch)
      const texts = chunk.map((r) => {
        const fts = getFts.get(r.id) as { title: string; body: string } | undefined
        const obs = (getObs.all(r.id) as { content: string }[]).map((o) => o.content)
        return [fts?.title ?? '', ...obs, fts?.body ?? ''].join('\n').replace(/\s+/g, ' ').trim()
      })
      let vecs: number[][] | undefined
      // Jina có rate-limit ~100k token/phút → reindex nhiều note dễ dính 429. Trước đây 1 lỗi = tắt vector
      // cả phiên + bỏ dở note pending. Giờ: 429 thì lùi (backoff) rồi thử lại chunk, chỉ tắt khi lỗi khác/hết lượt.
      for (let attempt = 0; attempt < 4 && vecs === undefined; attempt++) {
        try { vecs = await this.embedder(texts, 'retrieval.passage') }
        catch (e) {
          const msg = String(e)
          if (/\b429\b|rate limit/i.test(msg) && attempt < 3) {
            const waitMs = 20000 * (attempt + 1)  // 20s, 40s, 60s — qua cửa sổ 1 phút của Jina
            console.warn(`[recall] Jina 429 → chờ ${waitMs / 1000}s rồi thử lại (lần ${attempt + 1}/3)`)
            await new Promise((r) => setTimeout(r, waitMs))
          } else {
            this.vectorOn = false; console.warn(`[recall] embed lỗi → tắt vector phiên này: ${msg.slice(0, 160)}`); break
          }
        }
      }
      if (vecs === undefined) break
      // Nghỉ nhẹ giữa các batch để không dồn token vượt trần Jina/phút (chỉ khi còn batch sau).
      const throttleMs = Number(process.env.LUCY_EMBED_THROTTLE_MS ?? 1200)
      if (throttleMs > 0 && i + batch < todo.length) await new Promise((r) => setTimeout(r, throttleMs))
      const write = this.db.transaction(() => {
        for (let j = 0; j < chunk.length; j++) {
          const id = BigInt(chunk[j].id)
          try { delVec.run(id) } catch { /* chưa có */ }
          insVec.run(id, f32(vecs[j]))
          setCk.run(chunk[j].checksum, chunk[j].id)
          embedded++
        }
      })
      write()
    }
    const pending = (this.db.prepare('SELECT COUNT(*) c FROM note WHERE embed_checksum IS NULL OR embed_checksum != checksum').get() as { c: number }).c
    return { embedded, pending }
  }

  // BUGFIX 2026-08-16 "vector recall trả rác": vec0 KNN trước đây trả ĐỦ k hit dù note gần nhất cũng
  // cách xa (gần trực giao = không liên quan gì). RRF sau đó CHUẨN HOÁ điểm theo max của chính batch
  // → hit đứng đầu luôn ≈1.0 dù toàn rác, lọt qua ngưỡng LUCY_RECALL_MIN_SCORE ở bridge. Calibrate thật
  // trên vault (87 note, Jina v5-omni-nano dim768): hit LIÊN QUAN luôn distance <0.85 (0.46/0.65/0.84);
  // qua ~1.0 là nhiễu (near-orthogonal). Cắt tại 0.9 (biên an toàn) TRƯỚC khi vào RRF — chặn rác từ gốc
  // thay vì để RRF/bridge đoán mò trên con số đã bị chuẩn hoá sai lệch.
  private static VEC_MAX_DIST = Number(process.env.LUCY_VECTOR_MAX_DIST) || 0.9

  // vector KNN: embed query → vec0 cosine k-nearest → trả note.id + distance (nhỏ = gần).
  private async vectorSearch(query: string, limit: number): Promise<{ id: number; dist: number }[]> {
    if (!this.vectorReady()) return []
    const [qv] = await this.embedder([query], 'retrieval.query')
    if (!qv) return []
    const rows = this.db.prepare(
      'SELECT rowid AS id, distance AS dist FROM vec_note WHERE embedding MATCH ? AND k = ? ORDER BY distance',
    ).all(f32(qv), limit) as { id: number; dist: number }[]
    return rows.filter((r) => r.dist <= Recall.VEC_MAX_DIST)
  }

  // ── PHASE 1 hybridSearch: FTS5 (relaxed/trigram cũ) ⊕ vector, hợp nhất bằng RRF. Vector tắt/lỗi → y hệt search(). ──
  // RRF (k=60): điểm = Σ 1/(k + rank) qua mỗi danh sách → bền với thang điểm khác nhau (bm25 vs cosine).
  async hybridSearch(query: string, opts: { type?: string; after?: number; limit?: number; includeInvalid?: boolean } = {}): Promise<SearchHit[]> {
    const limit = Math.max(1, Math.min(opts.limit ?? 10, 50))
    const ftsHits = this.search(query, opts) // pipeline cũ (đã bump recall_count cho phần FTS)
    if (!this.vectorReady()) return this.maybeRerank(query, ftsHits, limit)
    let vec: { id: number; dist: number }[]
    try { vec = await this.vectorSearch(query, limit * 2) }
    catch (e) { this.vectorOn = false; console.warn(`[recall] vectorSearch lỗi → FTS5 thuần: ${String(e).slice(0, 160)}`); return this.maybeRerank(query, ftsHits, limit) }
    if (!vec.length) return this.maybeRerank(query, ftsHits, limit)
    const K = 60
    const scores = new Map<string, { hit: SearchHit; score: number }>()
    const add = (hit: SearchHit, rank: number) => {
      const cur = scores.get(hit.file_path)
      const rrf = 1 / (K + rank)
      if (cur) cur.score += rrf
      else scores.set(hit.file_path, { hit, score: rrf })
    }
    ftsHits.forEach((h, i) => add(h, i))
    const vecOnly: string[] = []
    vec.forEach((v, i) => {
      const existing = ftsHits.find((h) => this.idOf(h.file_path) === v.id)
      if (existing) { add(existing, i); return }
      const hit = this.hydrate(v.id, opts.includeInvalid) // PHASE 4: bỏ qua hit thuần-vector đã hết hiệu lực
      if (hit) { add(hit, i); vecOnly.push(hit.file_path) }
    })
    if (vecOnly.length) this.bump(vecOnly) // hit thuần-vector cũng tính 1 lần recall
    // PHASE 2: chuẩn hoá điểm RRF về 0..1 (chia cho điểm cao nhất) làm score dự phòng khi rerank tắt/lỗi.
    const sorted = [...scores.values()].sort((a, b) => b.score - a.score)
    const top = sorted.length ? sorted[0].score : 1
    const merged = sorted.map((s) => ({ ...s.hit, score: top > 0 ? s.score / top : 0, scoreKind: 'rrf' as const }))
    return this.maybeRerank(query, merged, limit)
  }

  // ── X1 RERANK: xếp lại top candidates bằng Jina reranker (flag LUCY_RERANK). ──
  // Reranker cross-encode query×doc → liên quan hơn bm25/cosine. Lỗi/tắt → GIỮ NGUYÊN thứ tự RRF (không chặn recall).
  private async maybeRerank(query: string, hits: SearchHit[], limit: number): Promise<SearchHit[]> {
    if (!this.rerankOn || hits.length < 2) return hits.slice(0, limit)
    // pool rộng hơn limit để reranker có cái xáo; cap để 1 call gọn.
    const poolSize = Math.min(hits.length, Math.max(limit * 3, 20))
    const pool = hits.slice(0, poolSize)
    const docs = pool.map((h) => `${h.title}\n${this.bodyOf(h.file_path) || h.snippet}`.slice(0, 2000))
    try {
      const ranked = await this.reranker(query, docs, pool.length)
      if (!ranked.length) return hits.slice(0, limit)
      const seen = new Set<number>()
      const ordered: SearchHit[] = []
      for (const r of ranked) {
        // PHASE 2: GIỮ điểm rerank trên hit → caller lọc theo ngưỡng liên quan thay vì đoán bằng trùng-chữ.
        if (r.index >= 0 && r.index < pool.length && !seen.has(r.index)) { seen.add(r.index); ordered.push({ ...pool[r.index], score: r.score, scoreKind: 'rerank' }) }
      }
      for (let i = 0; i < pool.length; i++) if (!seen.has(i)) ordered.push(pool[i]) // reranker bỏ sót → giữ đuôi
      for (let i = poolSize; i < hits.length; i++) ordered.push(hits[i]) // hit ngoài pool giữ nguyên cuối
      return ordered.slice(0, limit)
    } catch (e) {
      console.warn(`[recall] rerank lỗi → giữ thứ tự RRF: ${String(e).slice(0, 160)}`)
      return hits.slice(0, limit)
    }
  }

  private idOf(filePath: string): number | undefined {
    return (this.db.prepare('SELECT id FROM note WHERE file_path = ?').get(filePath) as { id: number } | undefined)?.id
  }

  // bodyOf: lấy body đầy đủ (từ note_fts) cho rerank — tín hiệu giàu hơn snippet 14-chữ.
  private bodyOf(filePath: string): string | undefined {
    const id = this.idOf(filePath)
    if (!id) return undefined
    const fts = this.db.prepare('SELECT body FROM note_fts WHERE rowid = ?').get(id) as { body: string } | undefined
    return fts?.body?.replace(/\s+/g, ' ').trim()
  }

  // dựng SearchHit cho hit thuần-vector (không có trong FTS): snippet = đầu body.
  private hydrate(id: number, includeInvalid = false): SearchHit | undefined {
    const n = this.db.prepare('SELECT file_path, title, type, permalink, tags, mtime, valid_to FROM note WHERE id = ?').get(id) as
      | (Omit<SearchHit, 'snippet' | 'rank' | 'relaxed'> & { valid_to: string | null }) | undefined
    if (!n) return undefined
    if (!includeInvalid && n.valid_to) return undefined // PHASE 4: fact hết hiệu lực → không trồi lên qua vector
    const { valid_to: _vt, ...base } = n
    const fts = this.db.prepare('SELECT body FROM note_fts WHERE rowid = ?').get(id) as { body: string } | undefined
    const snippet = (fts?.body ?? '').replace(/\s+/g, ' ').trim().slice(0, 160)
    return { ...base, snippet, rank: 0, relaxed: false }
  }

  // E2 bookend: lấy [goal]/[done]/[pending] của 1 session-note → khung "việc gì / xong gì / còn treo gì".
  private bookend(filePath: string): string | undefined {
    try {
      const note = this.db.prepare('SELECT id FROM note WHERE file_path = ?').get(filePath) as { id: number } | undefined
      if (!note) return undefined
      const rows = this.db.prepare("SELECT category, content FROM obs_fts WHERE note_id = ? AND category IN ('goal','done','pending')").all(note.id) as { category: string; content: string }[]
      if (!rows.length) return undefined
      const order: Record<string, number> = { goal: 0, done: 1, pending: 2 }
      rows.sort((a, b) => (order[a.category] ?? 9) - (order[b.category] ?? 9))
      return rows.map((r) => `[${r.category}] ${r.content.replace(/\s+/g, ' ').trim().slice(0, 200)}`).join(' · ')
    } catch { return undefined }
  }

  private bump(filePaths: string[]) {
    try {
      const up = this.db.prepare('UPDATE note SET recall_count = recall_count + 1, last_recall_at = ? WHERE file_path = ?')
      const now = Date.now()
      for (const f of filePaths) up.run(now, f)
    } catch { /* thống kê — không được làm gãy search */ }
  }

  private runFts(matchExpr: string, opts: { type?: string; after?: number; includeInvalid?: boolean }, limit: number): Omit<SearchHit, 'relaxed'>[] {
    const where: string[] = ['note_fts MATCH ?']
    const params: unknown[] = [matchExpr]
    if (opts.type) { where.push('n.type = ?'); params.push(opts.type) }
    if (opts.after) { where.push('n.mtime >= ?'); params.push(opts.after) }
    if (!opts.includeInvalid) where.push('n.valid_to IS NULL') // PHASE 4: bỏ fact hết hiệu lực khỏi recall mặc định
    params.push(limit)
    try {
      return this.db.prepare(`
        SELECT n.file_path, n.title, n.type, n.permalink, n.tags, n.mtime,
               snippet(note_fts, 1, '«', '»', '…', 14) AS snippet, bm25(note_fts) AS rank
        FROM note_fts JOIN note n ON n.id = note_fts.rowid
        WHERE ${where.join(' AND ')}
        ORDER BY rank, n.recall_count DESC, n.mtime DESC LIMIT ?
      `).all(...params) as Omit<SearchHit, 'relaxed'>[]
    } catch { return [] } // FTS5 syntax error (query lạ) → coi như 0 kết quả, không nổ
  }

  private runTri(foldedQuery: string, opts: { type?: string; after?: number; includeInvalid?: boolean }, limit: number): Omit<SearchHit, 'relaxed'>[] {
    const where: string[] = ['note_tri MATCH ?']
    const params: unknown[] = [`"${foldedQuery.replace(/"/g, '')}"`]
    if (opts.type) { where.push('n.type = ?'); params.push(opts.type) }
    if (opts.after) { where.push('n.mtime >= ?'); params.push(opts.after) }
    if (!opts.includeInvalid) where.push('n.valid_to IS NULL') // PHASE 4: bỏ fact hết hiệu lực
    params.push(limit)
    try {
      return this.db.prepare(`
        SELECT n.file_path, n.title, n.type, n.permalink, n.tags, n.mtime,
               snippet(note_tri, 1, '«', '»', '…', 14) AS snippet, bm25(note_tri) AS rank
        FROM note_tri JOIN note n ON n.id = note_tri.rowid
        WHERE ${where.join(' AND ')}
        ORDER BY rank, n.recall_count DESC, n.mtime DESC LIMIT ?
      `).all(...params) as Omit<SearchHit, 'relaxed'>[]
    } catch { return [] }
  }

  // ── A7 GRAPH-WALK: từ các hit, đi theo cạnh wikilink 1 bước (cả 2 chiều) → note liên quan ──
  // "hỏi A → kéo kèm note nối A" (crib basic-memory build_context). Loại chính các hit khỏi kết quả.
  related(hitFilePaths: string[], limit = 8): RelatedHit[] {
    if (!hitFilePaths.length) return []
    try {
      const qMarks = hitFilePaths.map(() => '?').join(',')
      const seeds = this.db.prepare(`SELECT id, permalink, file_path FROM note WHERE file_path IN (${qMarks})`)
        .all(...hitFilePaths) as { id: number; permalink: string; file_path: string }[]
      if (!seeds.length) return []
      const seedIds = seeds.map((s) => s.id)
      const seedPaths = new Set(seeds.map((s) => s.file_path))
      const out: RelatedHit[] = []
      const seen = new Set<string>()
      const push = (r: { file_path: string; title: string; permalink: string }, via: string) => {
        if (seedPaths.has(r.file_path) || seen.has(r.file_path) || out.length >= limit) return
        seen.add(r.file_path); out.push({ ...r, via })
      }
      // chiều RA: hit → [[target]] (target khớp permalink/slug của note khác)
      const ids = seedIds.map(() => '?').join(',')
      const outs = this.db.prepare(`
        SELECT n.file_path, n.title, n.permalink, r.rel FROM relation r
        JOIN note n ON (n.permalink = r.target OR n.permalink = r.target_slug)
        WHERE r.source_id IN (${ids}) AND n.valid_to IS NULL
      `).all(...seedIds) as { file_path: string; title: string; permalink: string; rel: string }[]
      for (const r of outs) push(r, r.rel || 'liên kết')
      // chiều VÀO: note khác → [[hit]]
      const perms = seeds.flatMap((s) => [s.permalink, s.permalink]) // (target, target_slug) per seed
      const pMarks = seeds.map(() => '(r.target = ? OR r.target_slug = ?)').join(' OR ')
      const ins = this.db.prepare(`
        SELECT n.file_path, n.title, n.permalink, r.rel FROM relation r
        JOIN note n ON n.id = r.source_id
        WHERE (${pMarks}) AND n.valid_to IS NULL
      `).all(...perms) as { file_path: string; title: string; permalink: string; rel: string }[]
      for (const r of ins) push(r, '← ' + (r.rel || 'liên kết'))
      return out
    } catch { return [] }
  }

  // ── RECENT: note theo mtime desc. timeframe = "7d" | "24h" | "30d" (optional). ──
  recent(opts: { timeframe?: string; type?: string; limit?: number; includeInvalid?: boolean } = {}): Omit<SearchHit, 'snippet' | 'rank' | 'relaxed'>[] {
    const limit = Math.max(1, Math.min(opts.limit ?? 15, 100))
    const where: string[] = []
    const params: unknown[] = []
    const cutoff = parseTimeframe(opts.timeframe)
    if (cutoff) { where.push('mtime >= ?'); params.push(cutoff) }
    if (opts.type) { where.push('type = ?'); params.push(opts.type) }
    if (!opts.includeInvalid) where.push('valid_to IS NULL') // PHASE 4: recent cũng bỏ fact hết hiệu lực
    params.push(limit)
    return this.db.prepare(`
      SELECT file_path, title, type, permalink, tags, mtime FROM note
      ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
      ORDER BY mtime DESC LIMIT ?
    `).all(...params) as Omit<SearchHit, 'snippet' | 'rank' | 'relaxed'>[]
  }

  stats(): { total: number; observations: number } {
    return {
      total: (this.db.prepare('SELECT COUNT(*) c FROM note').get() as { c: number }).c,
      observations: (this.db.prepare('SELECT COUNT(*) c FROM obs_fts').get() as { c: number }).c,
    }
  }

  // ── PHASE 2 EPISODIC: ghi 1 turn hội thoại (non-blocking từ caller). Content chuẩn hoá + cắt 8000 ký tự. ──
  // Lỗi ghi (DB lock…) KHÔNG được nổ — hội thoại luôn ưu tiên. Trả id hoặc null (rỗng/lỗi).
  recordTurn(t: { source?: string; chatId?: string; role?: string; content?: string; sessionId?: string; ts?: number }): number | null {
    // BẢO MẬT (backstop): scrub secret trước khi lưu turn (phòng caller bridge/hub bỏ sót).
    const content = scrubSecrets((t.content || '').replace(/\s+/g, ' ').trim()).slice(0, 8000)
    if (!content) return null
    try {
      const info = this.db.prepare('INSERT INTO turns(ts, source, chat_id, role, content, session_id) VALUES (?,?,?,?,?,?)')
        .run(t.ts ?? Date.now(), t.source || '', t.chatId || '', t.role || '', content, t.sessionId || '')
      const id = Number(info.lastInsertRowid)
      this.db.prepare('INSERT INTO turns_fts(rowid, content) VALUES (?, ?)').run(id, content)
      return id
    } catch { return null }
  }

  // searchTurns: FTS5 trên nội dung turn (strict AND → relaxed-OR fallback). sinceDays giới hạn cửa sổ thời gian.
  searchTurns(query: string, opts: { limit?: number; sinceDays?: number } = {}): EpisodicHit[] {
    const limit = Math.max(1, Math.min(opts.limit ?? 5, 20))
    const tokens = tokenize(query)
    if (!tokens.length) return []
    const since = opts.sinceDays ? Date.now() - opts.sinceDays * 86400e3 : 0
    const run = (expr: string): EpisodicHit[] => {
      const params: unknown[] = [expr]
      if (since) params.push(since)
      params.push(limit)
      try {
        return this.db.prepare(`
          SELECT t.id, t.ts, t.source, t.chat_id, t.role, t.content,
                 snippet(turns_fts, 0, '«', '»', '…', 18) AS snippet, bm25(turns_fts) AS rank
          FROM turns_fts JOIN turns t ON t.id = turns_fts.rowid
          WHERE turns_fts MATCH ? ${since ? 'AND t.ts >= ?' : ''}
          ORDER BY rank, t.ts DESC LIMIT ?
        `).all(...params) as EpisodicHit[]
      } catch { return [] }
    }
    let rows = run(tokens.map((t) => `"${t}"`).join(' '))
    if (!rows.length && tokens.length >= 2 && !/["*]/.test(query)) {
      const kept = tokens.filter((t) => !STOPWORDS.has(t))
      rows = run((kept.length ? kept : tokens).map((t) => `"${t}"`).join(' OR '))
    }
    return rows
  }

  // retention: xoá turn cũ hơn `days` ngày (mặc định 90). Trả số turn đã dọn.
  pruneTurns(days = 90): number {
    try {
      const cutoff = Date.now() - Math.max(1, days) * 86400e3
      const ids = this.db.prepare('SELECT id FROM turns WHERE ts < ?').all(cutoff) as { id: number }[]
      if (!ids.length) return 0
      const del = this.db.transaction(() => {
        const dt = this.db.prepare('DELETE FROM turns WHERE id = ?')
        const df = this.db.prepare('DELETE FROM turns_fts WHERE rowid = ?')
        for (const { id } of ids) { dt.run(id); df.run(id) }
      })
      del()
      return ids.length
    } catch { return 0 }
  }

  episodicStats(): { turns: number } {
    try { return { turns: (this.db.prepare('SELECT COUNT(*) c FROM turns').get() as { c: number }).c } }
    catch { return { turns: 0 } }
  }
}

// Flag LUCY_EPISODIC: '0'/'false'/'off' → tắt (không ghi/đọc turn hội thoại). Mặc định ON (single-user = data của chủ nhân).
export function episodicFlagOn(): boolean {
  const f = (process.env.LUCY_EPISODIC || '').toLowerCase()
  return !(f === '0' || f === 'false' || f === 'off')
}

// fmStr: ép giá trị frontmatter về string đã trim, rỗng → null (cho cột valid_from/valid_to).
function fmStr(v: unknown): string | null {
  if (v == null) return null
  const s = String(v).trim()
  return s ? s : null
}

// fold: lowercase + bỏ dấu + đ→d — chuẩn hoá cho bảng trigram (tokenizer trigram không tự bỏ dấu).
function fold(s: string): string {
  return s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd')
}

// tokenize: lấy từ unicode (chữ+số), lowercase + bỏ dấu (khớp remove_diacritics 2 của FTS).
function tokenize(s: string): string[] {
  const m = s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').match(/[\p{L}\p{N}]+/gu)
  return m ? m.filter((t) => t.length > 0) : []
}

function parseTimeframe(tf?: string): number | null {
  if (!tf) return null
  const m = tf.trim().match(/^(\d+)\s*([dhwm])$/i)
  if (!m) return null
  const n = Number(m[1])
  const unit = m[2].toLowerCase()
  const ms = unit === 'h' ? 3600e3 : unit === 'w' ? 7 * 86400e3 : unit === 'm' ? 30 * 86400e3 : 86400e3
  return Date.now() - n * ms
}

// helper: mở Recall nếu LUCY_VAULT trỏ tới vault thật, ngược lại null (graceful — feature off).
export function openRecallFromEnv(): Recall | null {
  const vault = process.env.LUCY_VAULT
  if (!vault || !fs.existsSync(vault)) return null
  try { return new Recall(vault) } catch { return null }
}
