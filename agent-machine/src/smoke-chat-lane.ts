// Smoke A (chat-lane) — splitThinking + routeTask. Caller inject → không cần LLM thật.
import { splitThinking, routeTask, ROUTE_TABLE, ROUTE_ROLES, routerModel } from './chat-lane'

let pass = 0, fail = 0
const check = (n: string, c: boolean, e = '') => { if (c) { pass++; console.log(`  ✅ ${n}`) } else { fail++; console.log(`  ❌ ${n} ${e}`) } }

console.log('🧪 smoke:chat-lane — thinking split + smart-routing')

// ── splitThinking ──
{
  const a = splitThinking('<think>cân nhắc A vs B</think>Đáp án là B')
  check('tách <think> → thinking riêng', a.thinking === 'cân nhắc A vs B' && a.answer === 'Đáp án là B', JSON.stringify(a))
  const b = splitThinking('<thinking>x</thinking>Y')
  check('hỗ trợ <thinking> tag', b.thinking === 'x' && b.answer === 'Y')
  const c = splitThinking('Không có thinking gì cả')
  check('không có think → answer nguyên, thinking undefined', c.answer === 'Không có thinking gì cả' && c.thinking === undefined)
  const d = splitThinking('<think>chỉ nghĩ thôi</think>')
  check('chỉ có think (answer rỗng) → fallback answer = nguyên content', d.answer.includes('chỉ nghĩ thôi'))
  const e = splitThinking('<think>a</think>mid<think>b</think>end')
  check('nhiều block think → gộp', e.thinking === 'a\nb' && e.answer === 'midend', JSON.stringify(e))
}

// ── routeTask: caller trả JSON hợp lệ ──
{
  const caller = async () => '```json\n{"role":"agentic-code","reason":"task sửa code","needsTools":true,"confidence":0.9}\n```'
  const r = await routeTask('Sửa bug trong engine.ts', { caller })
  check('route role=agentic-code', r.role === 'agentic-code')
  check('route modelKey = con đầu bảng agentic-code', r.modelKey === ROUTE_TABLE['agentic-code'][0], r.modelKey)
  check('route needsTools=true', r.needsTools === true)
  check('route confidence=0.9', r.confidence === 0.9)
}

// ── routeTask: JSON thuần (không fence) ──
{
  const caller = async () => '{"role":"reasoning","reason":"suy luận","needsTools":false,"confidence":0.8}'
  const r = await routeTask('Giải thích vì sao trời xanh', { caller })
  check('JSON không fence vẫn parse', r.role === 'reasoning' && r.needsTools === false)
}

// ── routeTask: role lạ → default reasoning ──
{
  const caller = async () => '{"role":"không-tồn-tại","confidence":0.9}'
  const r = await routeTask('x', { caller })
  check('role lạ → fallback reasoning', r.role === 'reasoning', r.role)
}

// ── routeTask: rác → default an toàn (needsTools=true vì confidence thấp) ──
{
  const caller = async () => 'không phải json gì cả'
  const r = await routeTask('x', { caller })
  check('rác → role reasoning + confidence thấp', r.role === 'reasoning' && r.confidence <= 0.3)
  check('rác (confidence<0.5) → needsTools=true (an toàn về claude)', r.needsTools === true)
}

// ── routeTask: caller throw → không crash, default ──
{
  const caller = async () => { throw new Error('router chết') }
  const r = await routeTask('x', { caller })
  check('caller throw → vẫn trả default (no crash)', r.role === 'reasoning' && r.needsTools === true)
}

// ── confidence clamp ──
{
  const caller = async () => '{"role":"content","confidence":5,"needsTools":false}'
  const r = await routeTask('viết thơ', { caller })
  check('confidence clamp ≤ 1', r.confidence === 1)
}

// ── ROUTE_TABLE/router sanity ──
check('ROUTE_ROLES không gồm "router"', !ROUTE_ROLES.includes('router'))
check('routerModel mặc định = Nemotron (lean chủ nhân)', routerModel() === 'or-nemotron-super' || !!process.env.LUCY_ROUTER_MODEL)
check('mọi role có ≥1 model', ROUTE_ROLES.every((r) => ROUTE_TABLE[r].length >= 1))

console.log(`\n${fail === 0 ? '✅ ALL PASS' : '❌ FAIL'} — ${pass} pass, ${fail} fail`)
process.exit(fail === 0 ? 0 : 1)
