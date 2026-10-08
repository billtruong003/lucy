// PHASE 2 — đo dải điểm rerank thật để chọn ngưỡng LUCY_RECALL_MIN_SCORE (đo, không đoán).
// Lấy note THẬT từ vault làm documents, chạy vài truy vấn có nhãn, in điểm.
// Chạy: npx tsx src/calibrate-rerank.ts
import { Recall } from './recall'
import { jinaRerank } from './embed'

const vault = process.env.LUCY_VAULT || '/root/lucy/lucy-vault'
const r = new Recall(vault)

// (truy vấn, có đáng chèn trí nhớ không)
const QUERIES: [string, boolean][] = [
  ['hôm trước t nói gì về bill truong chủ nhân là ai', true],
  ['cái vụ pxpipe làm mất persona nguyên nhân là gì', true],
  ['engine nào đang chạy cho bridge lucy telegram', true],
  ['fitcity preview crash loop lỗi gì', true],
  ['ê nay em khoẻ không kể chuyện vui đi', false],
  ['nay ăn gì ngon nhỉ trưa nay', false],
  ['giải thích lãi kép cho t nghe với', false],
  ['viết lại đoạn văn trên cho ngắn gọn hơn', false],
]

async function main() {
  const rows: { q: string; want: boolean; scores: number[]; top3: [number, string][] }[] = []
  for (const [q, want] of QUERIES) {
    const hits = await r.hybridSearch(q, { limit: 8 })
    if (!hits.length) { console.log(`  (0 hit) ${q}`); continue }
    const docs = hits.map((h) => `${h.title}\n${h.snippet}`.slice(0, 2000))
    let ranked: { index: number; score: number }[] = []
    try { ranked = await jinaRerank(q, docs, docs.length) } catch (e) { console.log('rerank lỗi:', String(e).slice(0, 120)); break }
    const scores = ranked.map((x) => x.score).sort((a, b) => b - a)
    rows.push({ q, want, scores, top3: ranked.slice(0, 3).map((x) => [x.score, hits[x.index]?.title?.slice(0, 46) || '?']) })
    console.log(`\n[${want ? 'CẦN tra ' : 'KHÔNG cần'}] ${q}`)
    console.log(`   điểm: ${scores.map((s) => s.toFixed(3)).join(' ')}`)
    for (const [s, t] of rows[rows.length - 1].top3) console.log(`     ${s.toFixed(3)}  ${t}`)
  }

  console.log('\n' + '='.repeat(64))
  console.log('ngưỡng | hit/câu CẦN | hit/câu KHÔNG cần | câu CẦN còn ≥1 hit')
  for (const th of [0.1, 0.2, 0.3, 0.35, 0.4, 0.5, 0.6, 0.7]) {
    const need = rows.filter((x) => x.want), no = rows.filter((x) => !x.want)
    const a = need.reduce((s, x) => s + x.scores.filter((v) => v >= th).length, 0) / Math.max(1, need.length)
    const b = no.reduce((s, x) => s + x.scores.filter((v) => v >= th).length, 0) / Math.max(1, no.length)
    const keep = need.filter((x) => x.scores.some((v) => v >= th)).length
    console.log(` ${th.toFixed(2)}  |    ${a.toFixed(2)}      |       ${b.toFixed(2)}        |   ${keep}/${need.length}`)
  }
  r.close()
}
main()
