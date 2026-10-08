// Smoke M3.5: persona auto-routing (tag + embedding injectable) + sanitizeHistory + flag gate.
// Không gọi mạng: embedder fake (vector cosine có thể kiểm tra trực tiếp).
import { personaRoute, sanitizeHistory, personaChatFlagOn, type RouteResult } from './persona-chat'
import type { Persona } from './types'
import type { Embedder } from './embed'

let pass = 0, fail = 0
function ok(name: string, cond: boolean) { if (cond) { pass++; console.log('  ✅ ' + name) } else { fail++; console.log('  ❌ ' + name) } }

const PERSONAS: Persona[] = [
  { id: 'finance', name: 'Eru · Finance', systemPrompt: 'Chuyên gia tài chính thị trường crypto vàng chứng khoán', model: 'sonnet', kind: 'specialist', tags: ['finance', 'market', 'trading'] },
  { id: 'engineer', name: 'Rei · Engineer', systemPrompt: 'Viết code sửa bug refactor', model: 'sonnet', kind: 'specialist', tags: ['code', 'bug', 'engineer'] },
  { id: 'designer', name: 'Aki · Designer', systemPrompt: 'Thiết kế UI UX giao diện', model: 'sonnet', kind: 'specialist', tags: ['design', 'ui', 'ux'] },
  { id: 'orch', name: 'Lucy · Orchestrator', systemPrompt: 'Điều phối', model: 'opus', kind: 'orchestrator', tags: ['route'] },
]

// ── flag gate ──
const savedFlag = process.env.LUCY_PERSONA_CHAT
delete process.env.LUCY_PERSONA_CHAT
ok('flag mặc định TẮT', !personaChatFlagOn())
process.env.LUCY_PERSONA_CHAT = '1'
ok('flag = 1 → BẬT', personaChatFlagOn())
process.env.LUCY_PERSONA_CHAT = 'off'
ok('flag = off → TẮT', !personaChatFlagOn())
if (savedFlag === undefined) delete process.env.LUCY_PERSONA_CHAT; else process.env.LUCY_PERSONA_CHAT = savedFlag

// ── sanitizeHistory ──
const h = sanitizeHistory([{ role: 'user', content: 'a' }, { role: 'assistant', content: 'b' }, { role: 'system', content: 'drop' }, { role: 'user', content: '' }, 'junk', null])
ok('history giữ user+assistant', h.length === 2 && h[0].role === 'user' && h[1].role === 'assistant')
ok('history loại system/rỗng/junk', !h.some((m) => m.content === 'drop' || !m.content))
ok('history cap 12', sanitizeHistory(Array.from({ length: 30 }, () => ({ role: 'user', content: 'x' }))).length === 12)

// ── route tag thuần (không embedder) ──
async function main() {
  const rFin = await personaRoute('giá bitcoin hôm nay xu hướng trading thế nào', PERSONAS, { embedder: null })
  ok('route tài chính → finance (tag)', rFin.personaId === 'finance')
  ok('route mode = tag', rFin.mode === 'tag')
  ok('route confidence > 0', rFin.confidence > 0)

  const rCode = await personaRoute('giúp em sửa bug code refactor', PERSONAS, { embedder: null })
  ok('route code → engineer (tag)', rCode.personaId === 'engineer')

  ok('route KHÔNG chọn orchestrator', !rFin.ranked.some((x) => x.personaId === 'orch'))

  // ── route với embedder fake: vector ép designer thắng dù tag yếu ──
  const fakeEmb: Embedder = async (texts, task) => texts.map((t) => {
    // vector 3 chiều: [finance, code, design] theo keyword
    const s = t.toLowerCase()
    return [/(tài chính|finance|market|crypto|vàng)/.test(s) ? 1 : 0,
            /(code|bug|refactor)/.test(s) ? 1 : 0,
            /(thiết kế|design|ui|ux|giao diện|màu)/.test(s) ? 1 : 0]
  })
  const rDesign = await personaRoute('phối màu giao diện sao cho đẹp', PERSONAS, { embedder: fakeEmb })
  ok('route có embedder → mode vector+tag', rDesign.mode === 'vector+tag')
  ok('route ngữ nghĩa → designer', rDesign.personaId === 'designer')
  ok('ranked có vecScore', rDesign.ranked[0].vecScore > 0)

  console.log(`\n${fail ? '❌' : '✅'} ${fail ? 'FAIL' : 'ALL PASS'} — ${pass} pass, ${fail} fail`)
  process.exit(fail ? 1 : 0)
}
main()
