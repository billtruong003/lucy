// bootstrap-cli — chạy 1 lần sau khi migrate não cũ (hoặc khi ký ức mới dồn về):
//   LUCY_VAULT=<vault> npm run bootstrap        # cần claude CLI (haiku, ~1 call)
// Chi tiết mạch xem ./bootstrap.ts
import path from 'node:path'
import { bootstrapFromMemory } from './bootstrap'

const vault = process.env.LUCY_VAULT || path.resolve(process.cwd(), '..', 'lucy-vault')
console.log(`📚 đọc ký ức Brain/claude-memory → hỏi claude (haiku)…`)
const r = await bootstrapFromMemory(vault)
if (!r.notes) { console.log('(không có ký ức — bỏ qua)'); process.exit(0) }
if (!r.sigs.length) { console.log(`(đọc ${r.notes} ký ức — claude không rút được quy tắc nào / không có claude CLI)`); process.exit(0) }
for (const s of r.sigs) console.log(`  + [${s.signal}] ${s.topic} :: ${s.principle}`)
console.log(`\n🌙 dream…`)
console.log(`  graduate: ${r.dream?.graduated.join(', ') || '(0)'} · ${r.dream?.activePrefs ?? 0} preference đang sống`)
