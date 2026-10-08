// Smoke C — C1 prompt-cache parity (prefix tĩnh ổn định) + C3 auxModelKey + C4 curator.
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'

let pass = 0, fail = 0
const check = (n: string, c: boolean, e = '') => { if (c) { pass++; console.log(`  ✅ ${n}`) } else { fail++; console.log(`  ❌ ${n} ${e}`) } }

const tmp = path.join(process.cwd(), '.smoke-C')
fs.rmSync(tmp, { recursive: true, force: true })
process.env.LUCY_VAULT = tmp
process.env.LUCY_STATE_DIR = path.join(tmp, 'state')

console.log('🧪 smoke:cheap-wins — cache-parity + aux + curator')

// ── C1: buildSystemPrompt — prefix TĨNH (house+contract+persona+skill) byte-identical khi brain/digest ĐỔI ──
{
  const { buildSystemPrompt, HOUSE_SKILL, OUTCOME_CONTRACT, modelGuidance, modelFamily } = await import('./runner')
  const { appendAgentLesson } = await import('./agent-brain')
  const persona: any = { id: 'builder', name: 'B', model: 'sonnet', systemPrompt: 'PERSONA_BODY', kind: 'executor', maxTurns: 5, allowedTools: [] }
  const card: any = { id: 'c1', title: 't', brief: 'b', projectId: 'default' }
  const p1 = buildSystemPrompt(card, persona)
  // brain đổi (học 1 bài) → phần ĐỘNG cuối đổi, prefix tĩnh phải GIỮ NGUYÊN
  appendAgentLesson('builder', 'bài học mới làm brain đổi', 'miss')
  const p2 = buildSystemPrompt(card, persona)
  // HQ-1: modelGuidance(model) nằm trong khối TĨNH-theo-persona (sau OUTCOME_CONTRACT, trước persona body)
  const staticPrefix = HOUSE_SKILL + OUTCOME_CONTRACT + modelGuidance('sonnet') + 'PERSONA_BODY'
  check('HQ-1: modelFamily phân họ đúng (sonnet→claude, gpt-4o→gpt, gemini→gemini, nemotron→other)',
    modelFamily('sonnet') === 'claude' && modelFamily('gpt-4o') === 'gpt' && modelFamily('gemini-1.5') === 'gemini' && modelFamily('or-nemotron-super') === 'other')
  check('HQ-1: modelGuidance(claude) ≠ modelGuidance(lane rẻ)', modelGuidance('sonnet') !== modelGuidance('or-nemotron-super'))
  check('C1: prompt bắt đầu bằng khối TĨNH (house+contract+persona)', p1.startsWith(staticPrefix), p1.slice(0, 40))
  check('C1: prefix tĩnh GIỮ byte-identical khi brain đổi', p1.slice(0, staticPrefix.length) === p2.slice(0, staticPrefix.length))
  check('C1: brain (động) nằm CUỐI → p2 ≠ p1 ở đuôi', p1 !== p2 && p2.includes('bài học mới'))
  check('C1: digest/brain KHÔNG ở đầu (đầu không phải TRÍ NHỚ/NÃO)', !p1.startsWith('TRÍ NHỚ') && !p1.startsWith('NÃO NGHỀ'))
}

// ── C3: auxModelKey — chọn free key sẵn; guard provider → bỏ qua ──
{
  // cấu hình 1 free key (groq) cho fast-classify
  process.env.GROQ_API_KEY = 'fake_key'
  const { auxModelKey } = await import('./aux-client')
  const { markGuarded } = await import('./rate-guard')
  const k1 = auxModelKey()
  check('C3: có free key → auxModelKey trả 1 key', !!k1, String(k1))
  // guard groq → nếu key trả về thuộc groq, phải đổi (hoặc null nếu hết free khác)
  if (k1) {
    const { entryByKey } = await import('./llm-lane')
    const prov = entryByKey(k1)?.provider
    if (prov) markGuarded(prov, 60_000, 'test')
    const k2 = auxModelKey()
    check('C3: provider bị guard → auxModelKey KHÔNG trả con đó', k2 !== k1 || k2 === null, String(k2))
  } else { check('C3: (skip guard sub-check)', true) }
  delete process.env.GROQ_API_KEY
}

// ── C4: curator — tràn bài thô → archive, giữ đúc kết + N gần nhất ──
{
  const { appendAgentLesson, curateAgentBrain, readRawLessons, writeConsolidated, lessonCount } = await import('./agent-brain')
  // 1 rule đúc kết + 20 bài thô
  writeConsolidated('grinder', ['rule đúc kết phải giữ lại luôn'])
  for (let i = 0; i < 20; i++) appendAgentLesson('grinder', `bài thô số ${i} đủ dài để lưu lại nhé`, 'miss')
  const before = lessonCount('grinder')
  const r = curateAgentBrain('grinder', 12)
  check('C4: curate archive phần tràn (>12 raw)', !!r && r.archived > 0, JSON.stringify(r))
  const after = readRawLessons('grinder')
  check('C4: active giữ rule đúc kết', after.some((l) => l.includes('🧠 đúc kết')))
  check('C4: active giữ bài gần nhất (số 19)', after.some((l) => l.includes('số 19')))
  check('C4: active KHÔNG còn bài cũ nhất (số 0)', !after.some((l) => l.includes('bài thô số 0 ')))
  const af = path.join(tmp, 'Brain', 'agents', '_archive', 'grinder.md')
  check('C4: archive file tồn tại + chứa bài cũ', fs.existsSync(af) && fs.readFileSync(af, 'utf8').includes('số 0'))
  check('C4: tổng active < before (đã gọn)', lessonCount('grinder') < before)
  // curate lần 2 khi chưa tràn → null (no-op)
  check('C4: chưa tràn → curate null (no-op)', curateAgentBrain('grinder', 12) === null)
}

console.log(`\n${fail === 0 ? '✅ ALL PASS' : '❌ FAIL'} — ${pass} pass, ${fail} fail`)
fs.rmSync(tmp, { recursive: true, force: true })
process.exit(fail === 0 ? 0 : 1)
