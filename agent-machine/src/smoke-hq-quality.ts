// Smoke HQ — verify output THẬT của 3 win Hermes-grade (HQ-1 model-aware · HQ-2 verify-before-done · HQ-3 memory-vs-skill).
// Test trên KẾT QUẢ buildSystemPrompt() ráp ra, không chỉ hàm con. Pure-string, KHÔNG đốt token, KHÔNG đụng live.
import fs from 'node:fs'
import path from 'node:path'

let pass = 0, fail = 0
const check = (n: string, c: boolean, e = '') => { if (c) { pass++; console.log(`  ✅ ${n}`) } else { fail++; console.log(`  ❌ ${n} ${e}`) } }

// vault tmp rỗng → readActiveDigest/readAgentBrain/loadSkillBlock trả '' sạch (không phụ thuộc vault thật)
const tmp = path.join(process.cwd(), '.smoke-HQ')
fs.rmSync(tmp, { recursive: true, force: true })
process.env.LUCY_VAULT = tmp
process.env.LUCY_STATE_DIR = path.join(tmp, 'state')

console.log('🧪 smoke:hq — Hermes-grade output quality (HQ-1/2/3)')

const { buildSystemPrompt, HOUSE_SKILL, OUTCOME_CONTRACT, modelFamily, modelGuidance } = await import('./runner')

const persona: any = { id: 'builder', name: 'B', model: 'sonnet', systemPrompt: 'PERSONA_BODY', kind: 'executor', maxTurns: 5, allowedTools: [] }
const card: any = { id: 'c1', title: 't', brief: 'b', projectId: 'default' }

// ── HQ-1: model-aware execution guidance ──
{
  check('HQ-1: modelFamily — claude (sonnet/opus/haiku/claude-3)',
    ['sonnet', 'opus', 'haiku', 'claude-3-5'].every((m) => modelFamily(m) === 'claude'))
  check('HQ-1: modelFamily — gpt (gpt-4o/o3)', modelFamily('gpt-4o') === 'gpt' && modelFamily('o3-mini') === 'gpt')
  check('HQ-1: modelFamily — gemini', modelFamily('gemini-1.5-flash') === 'gemini')
  check('HQ-1: modelFamily — other (lane rẻ nemotron/deepseek)', modelFamily('or-nemotron-super') === 'other' && modelFamily('deepseek-chat') === 'other')

  const gClaude = modelGuidance('opus')
  const gGpt = modelGuidance('gpt-4o')
  const gGem = modelGuidance('gemini-1.5')
  const gOther = modelGuidance('or-nemotron-super')
  check('HQ-1: guidance Claude = FINISH-THE-JOB + cấm mô tả suông', /FINISH-THE-JOB/.test(gClaude) && /mô tả suông/.test(gClaude))
  check('HQ-1: guidance lane = ĐƯỜNG DẪN TUYỆT ĐỐI + bắt dùng tool', /ĐƯỜNG DẪN TUYỆT ĐỐI/.test(gGpt) && /BẮT BUỘC gọi tool/.test(gGpt))
  check('HQ-1: lane tag đúng họ (GPT/Gemini/model rẻ)', /lane GPT/.test(gGpt) && /lane Gemini/.test(gGem) && /lane model rẻ/.test(gOther))
  check('HQ-1: Claude ≠ lane (khối khác nhau theo model)', gClaude !== gGpt && gClaude !== gOther)
  check('HQ-1: deterministic — gọi 2 lần byte-identical (cache-stable)', modelGuidance('opus') === gClaude && modelGuidance('gpt-4o') === gGpt)

  // KẾT QUẢ ráp: persona claude → prompt mang guidance claude
  const pClaude = buildSystemPrompt(card, persona)
  check('HQ-1: buildSystemPrompt(persona sonnet) CHỨA guidance Claude', pClaude.includes(gClaude))
  // lane-path: effModel override (persona.model sonnet nhưng chạy bằng laneModel gemini) → guidance ĐỔI theo effModel
  const pLane = buildSystemPrompt(card, persona, '', 'gemini-1.5-flash')
  check('HQ-1: effModel override → prompt mang guidance Gemini (KHÔNG phải Claude)', pLane.includes(gGem) && !pLane.includes(gClaude))
}

// ── HQ-2: verify-before-done trong OUTCOME_CONTRACT ──
{
  check('HQ-2: OUTCOME_CONTRACT có khối VERIFY-TRƯỚC-KHI-XONG', /VERIFY-TRƯỚC-KHI-XONG/.test(OUTCOME_CONTRACT))
  check('HQ-2: bắt nêu BẰNG CHỨNG (tsc/test/curl) cho "advance"', /BẰNG CHỨNG/.test(OUTCOME_CONTRACT) && /advance/.test(OUTCOME_CONTRACT))
  check('HQ-2: CẤM mô tả suông + verify fail → rework/fail', /CẤM "mô tả suông"/.test(OUTCOME_CONTRACT) && /rework/.test(OUTCOME_CONTRACT))
  check('HQ-2: block CÓ MẶT trong prompt ráp ra', buildSystemPrompt(card, persona).includes('VERIFY-TRƯỚC-KHI-XONG'))
}

// ── HQ-3: memory-vs-skill teaching trong HOUSE_SKILL ──
{
  check('HQ-3: HOUSE_SKILL có khối GHI GÌ vs KHÔNG GHI', /GHI GÌ vs KHÔNG GHI/.test(HOUSE_SKILL))
  check('HQ-3: định nghĩa MEMORY = sự thật BỀN', /MEMORY = sự thật BỀN/.test(HOUSE_SKILL))
  check('HQ-3: định nghĩa SKILL = cách-làm TÁI DÙNG', /SKILL = cách-làm TÁI DÙNG/.test(HOUSE_SKILL))
  check('HQ-3: KHÔNG GHI = trạng thái tạm/tiến độ/PR/lỗi nhất thời', /KHÔNG GHI:/.test(HOUSE_SKILL) && /nhất thời/.test(HOUSE_SKILL))
  check('HQ-3: block CÓ MẶT trong prompt ráp ra', buildSystemPrompt(card, persona).includes('GHI GÌ vs KHÔNG GHI'))
}

// ── Cache-parity: thứ tự khối TĨNH + byte-stable giữa 2 lần ráp ──
{
  const staticPrefix = HOUSE_SKILL + OUTCOME_CONTRACT + modelGuidance('sonnet') + 'PERSONA_BODY'
  const a = buildSystemPrompt(card, persona)
  const b = buildSystemPrompt(card, persona)
  check('PARITY: prompt mở đầu bằng khối TĨNH (house+contract+guidance+persona)', a.startsWith(staticPrefix), a.slice(0, 50))
  check('PARITY: 2 lần ráp byte-identical (deterministic)', a === b)
  check('PARITY: guidance đặt SAU contract, TRƯỚC persona body', a.indexOf(modelGuidance('sonnet')) > a.indexOf('VERIFY-TRƯỚC') && a.indexOf(modelGuidance('sonnet')) < a.indexOf('PERSONA_BODY'))
}

console.log(`\n${fail === 0 ? '✅ ALL PASS' : '❌ FAIL'} — ${pass} pass, ${fail} fail`)
fs.rmSync(tmp, { recursive: true, force: true })
process.exit(fail === 0 ? 0 : 1)
