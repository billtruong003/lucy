// Smoke C1 (Track C) — não nghề per-agent: read/write loop + dedup + cap + path-guard.
import fs from 'node:fs'
import path from 'node:path'
import { readAgentBrain, appendAgentLesson } from './agent-brain'

let pass = 0, fail = 0
const check = (name: string, cond: boolean, extra = '') => { if (cond) { pass++; console.log(`  ✅ ${name}`) } else { fail++; console.log(`  ❌ ${name} ${extra}`) } }

const tmp = path.join(process.cwd(), '.smoke-brain')
fs.rmSync(tmp, { recursive: true, force: true })
process.env.LUCY_VAULT = tmp

console.log('🧪 smoke:agent-brain — não nghề per-persona')

// 1. chưa học gì → ''
check('readAgentBrain rỗng khi chưa có file', readAgentBrain('builder') === '')

// 2. ghi 1 bài → đọc lại thấy
appendAgentLesson('builder', 'Luôn chạy tsc trước khi báo done', 'miss')
const d1 = readAgentBrain('builder')
check('sau append: digest chứa bài học', d1.includes('Luôn chạy tsc'), `(got ${d1.slice(0, 60)})`)
check('digest có header não nghề', d1.includes('NÃO NGHỀ CỦA BẠN'))
check('miss → nhãn "tránh"', d1.includes('⚠️ tránh'))

// 3. file đúng chỗ Brain/agents/<id>.md
check('file ghi đúng Brain/agents/builder.md', fs.existsSync(path.join(tmp, 'Brain', 'agents', 'builder.md')))

// 4. dedup: ghi lại y hệt → không nhân đôi
appendAgentLesson('builder', 'Luôn chạy tsc trước khi báo done', 'miss')
const lines = fs.readFileSync(path.join(tmp, 'Brain', 'agents', 'builder.md'), 'utf8').split('\n').filter(l => l.includes('chạy tsc'))
check('dedup: bài trùng không nhân đôi', lines.length === 1, `(got ${lines.length})`)

// 5. win cho persona khác → không lẫn (cô lập theo persona)
appendAgentLesson('reviewer', 'Kiểm tra deliverable tồn tại thật', 'win')
check('persona khác cô lập (builder không thấy bài reviewer)', !readAgentBrain('builder').includes('deliverable tồn tại'))
check('reviewer thấy bài mình + nhãn "tốt"', readAgentBrain('reviewer').includes('✅ tốt'))

// 6. cap: ghi 30 bài → readAgentBrain chỉ trả ≤ 12
for (let i = 0; i < 30; i++) appendAgentLesson('tester', `bài học số ${i} duy nhất`, 'miss')
const shown = (readAgentBrain('tester').match(/^- /gm) || []).length
check('cap đọc ≤ 12 bài', shown <= 12, `(got ${shown})`)

// 7. path-traversal guard
appendAgentLesson('../../etc/x', 'evil', 'miss')
check('chặn personaId có path traversal', !fs.existsSync(path.join(tmp, 'Brain', 'agents', '..', '..', 'etc', 'x.md')))

// 8. không có LUCY_VAULT → no-op an toàn
delete process.env.LUCY_VAULT
check('không vault → readAgentBrain rỗng (no crash)', readAgentBrain('builder') === '')

console.log(`\n${fail === 0 ? '✅ ALL PASS' : '❌ FAIL'} — ${pass} pass, ${fail} fail`)
fs.rmSync(tmp, { recursive: true, force: true })
process.exit(fail === 0 ? 0 : 1)
