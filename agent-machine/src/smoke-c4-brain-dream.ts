// Smoke C4 — win-lesson + dream-per-persona (consolidate). Runner inject → không cần claude thật.
import fs from 'node:fs'
import path from 'node:path'
import { appendAgentLesson, readAgentBrain, lessonCount, readRawLessons, listAgentBrains, writeConsolidated, CONSOLIDATE_THRESHOLD } from './agent-brain'
import { buildConsolidatePrompt, parseRules, consolidateAgentBrain, consolidateAllAgentBrainsSafe } from './agent-brain-dream'

let pass = 0, fail = 0
const check = (name: string, cond: boolean, extra = '') => { if (cond) { pass++; console.log(`  ✅ ${name}`) } else { fail++; console.log(`  ❌ ${name} ${extra}`) } }

const tmp = path.join(process.cwd(), '.smoke-c4')
fs.rmSync(tmp, { recursive: true, force: true })
process.env.LUCY_VAULT = tmp

console.log('🧪 smoke:c4-brain-dream — win-lesson + đúc kết per-persona')

// ── 1. win-lesson hiển thị với nhãn "tốt" (đã có ở C1, recheck wiring) ──
appendAgentLesson('builder', 'Viết API contract doc trước khi code endpoint', 'win')
check('win-lesson đọc được + nhãn ✅ tốt', readAgentBrain('builder').includes('✅ tốt') && readAgentBrain('builder').includes('API contract'))

// ── 2. lessonCount + listAgentBrains ──
check('lessonCount đếm đúng (1 bài)', lessonCount('builder') === 1, `(got ${lessonCount('builder')})`)
appendAgentLesson('reviewer', 'Luôn chạy build thật trước khi advance', 'win')
check('listAgentBrains thấy 2 persona', listAgentBrains().sort().join(',') === 'builder,reviewer', `(got ${listAgentBrains().join(',')})`)

// ── 3. parseRules: JSON array / fenced / rác ──
check('parseRules mảng thuần', parseRules('["rule một dài hơn 8", "rule hai dài hơn 8"]').length === 2)
check('parseRules fenced json', parseRules('```json\n["rule alpha dài", "rule beta dài"]\n```').length === 2)
check('parseRules envelope claude', parseRules(JSON.stringify({ result: '["rule gamma dài đủ"]' })).length === 1)
check('parseRules rác → []', parseRules('không phải json gì cả').length === 0)
check('parseRules lọc string ngắn', parseRules('["ok dài đủ tám", "x"]').length === 1)

// ── 4. buildConsolidatePrompt có blacklist Hermes ──
{
  const p = buildConsolidatePrompt('builder', ['⚠️ tránh: lỗi A', '✅ tốt: cách B'])
  check('prompt có danh sách KHÔNG-GIỮ (chống tự-trói)', p.includes('KHÔNG ĐƯỢC GIỮ') && p.includes('tiêu cực về tool'))
  check('prompt yêu cầu class-level rule', p.includes('CLASS-LEVEL'))
}

// ── 5. consolidate: dưới ngưỡng → null (không gộp non) ──
{
  const r = await consolidateAgentBrain('builder', { run: async () => '["KHÔNG NÊN GỌI"]' })
  check('dưới ngưỡng → null (không consolidate)', r === null)
}

// ── 6. consolidate: đủ ngưỡng → ghi đè bằng rule đúc kết ──
{
  for (let i = 0; i < CONSOLIDATE_THRESHOLD; i++) appendAgentLesson('grinder', `bài thô số ${i} về xử lý lỗi và retry và validate input`, i % 2 ? 'miss' : 'win')
  const before = lessonCount('grinder')
  check('grinder đủ ngưỡng trước gộp', before >= CONSOLIDATE_THRESHOLD, `(got ${before})`)
  const fakeRun = async (prompt: string) => {
    // xác nhận prompt CHỨA bài thô đầu vào
    if (!prompt.includes('bài thô số 0')) return '[]'
    return JSON.stringify({ result: '["Luôn validate input ở biên trước khi xử lý", "Khi gặp lỗi transient thì retry 1 lần rồi mới báo"]' })
  }
  const r = await consolidateAgentBrain('grinder', { run: fakeRun })
  check('consolidate trả {before, after}', r !== null && r.after === 2, `(got ${JSON.stringify(r)})`)
  check('sau gộp: lessonCount giảm còn số rule (2)', lessonCount('grinder') === 2, `(got ${lessonCount('grinder')})`)
  const brain = readAgentBrain('grinder')
  check('rule đúc kết có nhãn 🧠 đúc kết', brain.includes('🧠 đúc kết'))
  check('rule đúc kết đọc được nội dung', brain.includes('validate input'))
}

// ── 7. consolidate model trả [] → GIỮ bài thô (không xoá trắng) ──
{
  for (let i = 0; i < CONSOLIDATE_THRESHOLD; i++) appendAgentLesson('tester', `bài tester thô số ${i} đủ dài để giữ lại`, 'miss')
  const before = lessonCount('tester')
  const r = await consolidateAgentBrain('tester', { run: async () => '[]' })
  check('model trả [] → null (không ghi)', r === null)
  check('bài thô GIỮ NGUYÊN khi model trả [] (không mất não)', lessonCount('tester') === before, `(before ${before}, after ${lessonCount('tester')})`)
}

// ── 8. consolidateAllAgentBrainsSafe: chỉ gộp persona quá ngưỡng ──
{
  // builder (1 bài) dưới ngưỡng, grinder đã gộp còn 2, tester còn nhiều → chỉ tester được gộp lần này
  const fakeRun = async () => JSON.stringify({ result: '["rule tổng quát đủ dài cho tester"]' })
  const done = await consolidateAllAgentBrainsSafe({ run: fakeRun })
  const ids = done.map((d) => d.personaId).sort()
  check('All-safe chỉ gộp persona ≥ ngưỡng (tester)', ids.includes('tester') && !ids.includes('builder'), `(got ${ids.join(',')})`)
}

// ── 9. env-guard: không vault → no-op ──
{
  delete process.env.LUCY_VAULT
  const done = await consolidateAllAgentBrainsSafe({ run: async () => '["x dài đủ tám ký"]' })
  check('không vault → consolidateAll no-op ([])', done.length === 0)
  process.env.LUCY_VAULT = tmp
}

console.log(`\n${fail === 0 ? '✅ ALL PASS' : '❌ FAIL'} — ${pass} pass, ${fail} fail`)
fs.rmSync(tmp, { recursive: true, force: true })
process.exit(fail === 0 ? 0 : 1)
