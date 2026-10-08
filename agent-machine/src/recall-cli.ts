// recall-cli — tay lái FTS5 recall. LUCY_VAULT trỏ tới lucy-vault.
//   npm run reindex            # dựng lại index từ file (full) + embed vector (nếu LUCY_VECTOR bật)
//   npm run recall -- "query"  # tìm (hybrid FTS5+vector khi vector bật)
//   npm run recall -- --recent 7d
//   npm run recall -- --embed  # chỉ chạy embed incremental (Phase 1)
import path from 'node:path'
import { Recall } from './recall'

const vault = process.env.LUCY_VAULT || path.resolve(process.cwd(), '..', 'lucy-vault')
const args = process.argv.slice(2)

const r = new Recall(vault)
try {
  if (args[0] === 'reindex' || args[0] === '--reindex') {
    const s = r.reindex({ full: true })
    console.log(`✅ reindex (full): +${s.indexed} mới, ~${s.updated} cập nhật, -${s.deleted} xoá → ${s.total} note. db=${r.dbPath}`)
    if (r.vectorReady()) { const e = await r.embedIndex({ max: 5000 }); console.log(`🧬 vector: +${e.embedded} embed, còn ${e.pending} pending`) }
  } else if (args[0] === '--embed') {
    if (!r.vectorReady()) console.log('⚠️ vector OFF (thiếu JINA_API_KEY / LUCY_VECTOR=0 / extension không nạp được)')
    else { r.reindex(); const e = await r.embedIndex({ max: 5000 }); console.log(`🧬 vector: +${e.embedded} embed, còn ${e.pending} pending`) }
  } else if (args[0] === 'stats' || args[0] === '--stats') {
    // Heartbeat việc học — cron_dream đọc dòng này gửi Telegram mỗi đêm.
    r.reindex()
    const s = r.learningStats()
    const vec = s.vectorReady ? (s.embedPending === 0 ? 'OK' : `còn ${s.embedPending} pending`) : 'OFF'
    console.log(`🧠 học: ${s.turnsToday} lượt hôm nay (${s.turnsTotal} tổng) · ${s.notesTotal} note · vector ${vec} (${s.embedTotal}/${s.notesTotal})`)
  } else if (args[0] === '--recent') {
    const rows = r.recent({ timeframe: args[1], limit: 20 })
    console.log(`🕒 ${rows.length} note gần đây${args[1] ? ` (${args[1]})` : ''}:`)
    for (const n of rows) console.log(`  · [${n.type}] ${n.title}  — ${n.file_path}  (${new Date(n.mtime).toLocaleString('vi-VN')})`)
  } else {
    const s = r.reindex() // incremental trước khi tìm (rẻ, chỉ file đổi)
    const q = args.filter((a) => !a.startsWith('--')).join(' ')
    if (!q) { console.log('Cách dùng: npm run recall -- "câu cần tìm"  |  --recent 7d  |  reindex  |  --embed'); process.exit(0) }
    if (r.vectorReady()) await r.embedIndex({ max: 5000 })
    const hits = r.vectorReady() ? await r.hybridSearch(q, { limit: 10 }) : r.search(q, { limit: 10 })
    console.log(`🔎 "${q}" → ${hits.length} kết quả${hits[0]?.relaxed ? ' (relaxed-OR)' : ''}${r.vectorReady() ? ' [hybrid]' : ''}  [index: ${s.total} note]`)
    for (const h of hits) console.log(`  · [${h.type}] ${h.title}  (${h.file_path})\n      ${(h.bookend || h.snippet).replace(/\s+/g, ' ').trim()}`)
  }
} finally { r.close() }
