// smoke-vector — PHASE 1: verify hybrid FTS5+vector (embedIndex incremental + RRF fusion + vector-only hit).
// Dùng embedder GIẢ (bag-of-concept, song ngữ Việt-Anh) → KHÔNG gọi mạng/Jina. Chứng minh vector bắt được
// note mà FTS5 trượt vì khác mặt chữ (query tiếng Việt ↔ note tiếng Anh).
//   npm run smoke:vector
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { Recall } from './recall'
import { EMBED_DIM, type Embedder, type Reranker } from './embed'

let fails = 0
const check = (name: string, ok: boolean, detail = '') => {
  console.log(`${ok ? '✅' : '❌'} ${name}${detail ? ` — ${detail}` : ''}`)
  if (!ok) fails++
}

// concept map song ngữ → embedding thưa (1.0 ở dim của concept xuất hiện). Synonyms gộp về cùng dim.
const CONCEPTS: string[][] = [
  ['bitcoin', 'btc', 'coin'],
  ['nguong', 'threshold', 'muc', 'level', 'chot', 'breakout'],
  ['vang', 'gold'],
  ['game', 'gamedev', 'unity', 'shader'],
]
const fakeEmbed: Embedder = async (texts) => texts.map((t) => {
  const folded = t.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd')
  const v = new Array(EMBED_DIM).fill(0)
  CONCEPTS.forEach((syns, dim) => { if (syns.some((s) => folded.includes(s))) v[dim] = 1 })
  return v
})

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lucy-smoke-vec-'))
const V = path.join(root, 'vault')
for (const d of ['Context', 'Projects']) fs.mkdirSync(path.join(V, d), { recursive: true })

// note 1: BTC ngưỡng (tiếng Việt) — FTS bắt được query VN.
fs.writeFileSync(path.join(V, 'Context/btc.md'), [
  '---', 'title: BTC ngưỡng chốt', 'type: note', 'permalink: btc-nguong', '---', '',
  '# BTC', '- [market] ngưỡng RSI bitcoin mình chốt là 70 #btc', '',
].join('\n'))
// note 2: Gold breakout (TIẾNG ANH) — query "ngưỡng vàng" (VN) KHÔNG khớp FTS, chỉ vector bắt.
fs.writeFileSync(path.join(V, 'Projects/gold.md'), [
  '---', 'title: Gold breakout plan', 'type: project', 'permalink: gold-plan', '---', '',
  '# Gold', 'Watch the gold breakout above the key level before entering.', '',
].join('\n'))

async function main() {
  // ── vector ON (embedder giả inject) ──
  const r = new Recall(V, { embedder: fakeEmbed, vector: true })
  r.reindex({ full: true })
  check('vectorReady (extension sqlite-vec nạp được)', r.vectorReady())

  const e1 = await r.embedIndex({ max: 100 })
  check('embedIndex embed cả 2 note', e1.embedded === 2, `embedded=${e1.embedded} pending=${e1.pending}`)

  // incremental: chạy lại không có gì đổi → 0 embed.
  const e2 = await r.embedIndex({ max: 100 })
  check('embedIndex incremental (không đổi → 0 embed)', e2.embedded === 0, `embedded=${e2.embedded}`)

  // vector-only hit: query VN "ngưỡng vàng" — FTS5 trượt gold.md (note tiếng Anh), vector phải kéo nó lên.
  const ftsOnly = r.search('ngưỡng vàng', { limit: 10 })
  const ftsHasGold = ftsOnly.some((h) => h.file_path.includes('gold'))
  const hybrid = await r.hybridSearch('ngưỡng vàng', { limit: 10 })
  const hybridHasGold = hybrid.some((h) => h.file_path.includes('gold'))
  check('FTS5 thuần TRƯỢT note tiếng Anh (gold)', !ftsHasGold)
  check('hybrid (vector) BẮT được note tiếng Anh (gold)', hybridHasGold, `hits=${hybrid.map((h) => h.file_path).join(',')}`)

  // sửa note → embed_checksum reset → embedIndex re-embed đúng 1 note.
  fs.writeFileSync(path.join(V, 'Projects/gold.md'), [
    '---', 'title: Gold breakout plan', 'type: project', 'permalink: gold-plan', '---', '',
    '# Gold', 'Updated: watch the gold breakout above the new key level.', '',
  ].join('\n'))
  r.reindex()
  const e3 = await r.embedIndex({ max: 100 })
  check('note đổi → re-embed đúng 1', e3.embedded === 1, `embedded=${e3.embedded}`)
  r.close()

  // ── vector OFF (flag) → hybridSearch == search ──
  const r2 = new Recall(V, { embedder: fakeEmbed, vector: false })
  r2.reindex()
  check('vectorReady=false khi flag off', !r2.vectorReady())
  const h2 = await r2.hybridSearch('ngưỡng vàng', { limit: 10 })
  const s2 = r2.search('ngưỡng vàng', { limit: 10 })
  check('vector off → hybrid == FTS5 thuần', JSON.stringify(h2.map((h) => h.file_path)) === JSON.stringify(s2.map((h) => h.file_path)))
  r2.close()

  // ── X1 RERANK (flag) → reranker giả ưu tiên doc chứa 'gold' → kéo gold lên đầu ──
  const fakeRerank: Reranker = async (_q, docs) =>
    docs.map((d, index) => ({ index, score: /gold/i.test(d) ? 1 : 0 })).sort((a, b) => b.score - a.score)
  const r3 = new Recall(V, { embedder: fakeEmbed, vector: true, reranker: fakeRerank, rerank: true })
  r3.reindex({ full: true })
  await r3.embedIndex({ max: 100 })
  const rr = await r3.hybridSearch('ngưỡng', { limit: 10 })
  check('rerank đưa gold lên đầu', !!rr[0]?.file_path.includes('gold'), `top=${rr[0]?.file_path} order=${rr.map((h) => path.basename(h.file_path)).join(',')}`)

  // rerank lỗi → giữ thứ tự RRF, KHÔNG chặn (graceful).
  const boomRerank: Reranker = async () => { throw new Error('rerank API down') }
  const r4 = new Recall(V, { embedder: fakeEmbed, vector: true, reranker: boomRerank, rerank: true })
  r4.reindex({ full: true })
  await r4.embedIndex({ max: 100 })
  const rr4 = await r4.hybridSearch('ngưỡng vàng', { limit: 10 })
  check('rerank lỗi → vẫn trả kết quả (không nổ)', rr4.length > 0, `hits=${rr4.length}`)
  r3.close(); r4.close()

  fs.rmSync(root, { recursive: true, force: true })
  console.log(fails ? `\n❌ ${fails} fail` : '\n✅ smoke-vector PASS')
  process.exit(fails ? 1 : 0)
}
main()
