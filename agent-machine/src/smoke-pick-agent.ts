// smoke-pick-agent — C3 pick-agent + model override: personaOverride + laneModel. No token burn.
// Tái hiện các case: happy path, fallback, stage>0 guard, laneModel no-op cho persona thiếu field.
import fs from 'node:fs'
import path from 'node:path'
import { Store } from './store'
import { Budget } from './budget'
import { Engine } from './engine'
import { MockRunner } from './runner'
import { laneAvailable } from './llm-lane'
import type { Outcome, Card, Stage, Persona, RunResult } from './types'

let pass = 0
let fail = 0
const check = (n: string, c: boolean, detail = '') => {
  if (c) { pass++; console.log(`  ✅ ${n}`) }
  else { fail++; console.log(`  ❌ ${n}${detail ? ' — ' + detail : ''}`) }
}
const clean = (p: string) => fs.rmSync(p, { recursive: true, force: true })

function setup(dir: string) {
  clean(dir)
  const store = new Store(dir)
  // persona có laneModel (Tanjiro-like: cheap executor)
  store.registerPersona({ id: 'tanjiro', name: 'Tanjiro', systemPrompt: 'builder', model: 'sonnet', laneModel: 'deepseek-v3-0324' })
  // persona KHÔNG có laneModel (architect: nặng, mặc định opus)
  store.registerPersona({ id: 'arch', name: 'Architect', systemPrompt: 'architect', model: 'opus' })
  // persona pipeline mặc định
  store.registerPersona({ id: 'default-p', name: 'Default', systemPrompt: 'default', model: 'sonnet' })
  store.registerPipeline({ id: 'feat', name: 'Feature', stages: [{ id: 's1', name: 'Build', personaId: 'default-p' }, { id: 's2', name: 'Review', personaId: 'default-p' }] })
  const engine = new Engine(store, new MockRunner({}), new Budget({ windowMs: 5 * 3600e3, capUsd: 99 }), { maxLanes: 4 })
  return { store, engine }
}

async function main() {
  console.log('🧪 C3 pick-agent smoke — personaOverride + model laneModel')
  const dir = path.join(process.cwd(), '.smoke-pick-agent')

  // ── 1. createCard lưu personaOverride ──
  {
    const { store, engine } = setup(dir)
    const c = engine.createCard('t', 'b', 'feat', undefined, 0, 'default', false, undefined, [], 'tanjiro')
    check('createCard lưu personaOverride=tanjiro', store.getCard(c.id)!.personaOverride === 'tanjiro',
      `got ${store.getCard(c.id)!.personaOverride}`)
    clean(dir)
  }

  // ── 2. createCard không có personaId → personaOverride undefined ──
  {
    const { store, engine } = setup(dir)
    const c = engine.createCard('t', 'b', 'feat')
    check('createCard không personaId → personaOverride undefined',
      store.getCard(c.id)!.personaOverride === undefined,
      `got ${store.getCard(c.id)!.personaOverride}`)
    clean(dir)
  }

  // ── 3. claim() stage 0 + personaOverride valid → persona switched ──
  {
    const { store, engine } = setup(dir)
    const c = engine.createCard('t', 'b', 'feat', undefined, 0, 'default', false, undefined, [], 'tanjiro')
    engine.tick()
    const job = engine.claim()
    check('claim stage 0 + override → persona switched to tanjiro',
      job?.persona.id === 'tanjiro',
      `got ${job?.persona.id}`)
    check('claim stage 0 + override → persona name = Tanjiro',
      job?.persona.name === 'Tanjiro',
      `got ${job?.persona.name}`)
    check('pipeline persona gốc KHÔNG bị đổi (không mutate store)',
      store.personas.get('default-p')!.id === 'default-p')
    clean(dir)
  }

  // ── 4. claim() stage 0 + personaOverride KHÔNG tồn tại → fallback pipeline default ──
  {
    const { store, engine } = setup(dir)
    const c = engine.createCard('t', 'b', 'feat', undefined, 0, 'default', false, undefined, [], 'nonexistent-id')
    engine.tick()
    const job = engine.claim()
    check('personaOverride không tồn tại → fallback pipeline persona',
      job?.persona.id === 'default-p',
      `got ${job?.persona.id}`)
    // warning phải được log vào thread card
    const thread = store.readChannel(`card-${c.id}`)
    const warned = thread.some((m) => m.text.includes('personaOverride') && m.text.includes('nonexistent-id'))
    check('fallback log warning vào thread', warned,
      `thread msgs: ${thread.map((m) => m.text.slice(0, 60)).join(' | ')}`)
    clean(dir)
  }

  // ── 5. claim() stage > 0 → personaOverride KHÔNG áp dụng (dùng pipeline) ──
  {
    const { store, engine } = setup(dir)
    const c = engine.createCard('t', 'b', 'feat', undefined, 0, 'default', false, undefined, [], 'tanjiro')
    // ép stageIndex = 1 (giai đoạn 2, không phải đầu)
    const cardObj = store.getCard(c.id)!
    cardObj.stageIndex = 1
    store.putCard(cardObj)
    engine.tick()
    const job = engine.claim()
    check('claim stage 1 + personaOverride → KHÔNG đổi persona (pipeline default)',
      job?.persona.id === 'default-p',
      `got ${job?.persona.id}`)
    clean(dir)
  }

  // ── 6. modelOverride = laneModel → lưu card đúng ──
  {
    const { store, engine } = setup(dir)
    const c = engine.createCard('t', 'b', 'feat', undefined, 0, 'default', false, 'laneModel')
    check('createCard lưu modelOverride=laneModel',
      store.getCard(c.id)!.modelOverride === 'laneModel',
      `got ${store.getCard(c.id)!.modelOverride}`)
    clean(dir)
  }

  // ── 7. laneModel override + persona CÓ laneModel → claim trả persona với laneModel field ──
  //    CompositeRunner sẽ route sang LaneRunner dựa vào persona.laneModel
  {
    const { store, engine } = setup(dir)
    const c = engine.createCard('t', 'b', 'feat', undefined, 0, 'default', false, 'laneModel', [], 'tanjiro')
    engine.tick()
    const job = engine.claim()
    check('personaOverride=tanjiro + laneModel → persona.laneModel set (deepseek)',
      job?.persona.laneModel === 'deepseek-v3-0324',
      `got ${job?.persona.laneModel}`)
    check('persona.model KHÔNG bị đổi (laneModel không đè persona.model)',
      job?.persona.model === 'sonnet',
      `got ${job?.persona.model}`)
    // Verify: CompositeRunner SẼ dùng LaneRunner nếu key có
    if (job) {
      const wouldUseLane = !!(job.persona.laneModel && laneAvailable(job.persona.laneModel))
      // Không yêu cầu key có mặt — chỉ check logic
      check('CompositeRunner routing logic: persona.laneModel defined → wouldUseLane (if key present)',
        job.persona.laneModel !== undefined)
    }
    clean(dir)
  }

  // ── 8. [BUG CHECK] laneModel override + persona KHÔNG có laneModel → no-op, persona giữ nguyên ──
  //    Bug: user chọn "laneModel (rẻ)" cho architect → claim trả persona KHÔNG có laneModel
  //    → CompositeRunner dùng ClaudeRunner (đắt), laneModel override bị bỏ qua im lặng
  {
    const { store, engine } = setup(dir)
    const c = engine.createCard('t', 'b', 'feat', undefined, 0, 'default', false, 'laneModel', [], 'arch')
    engine.tick()
    const job = engine.claim()
    // Persona = arch (không có laneModel), modelOverride='laneModel' KHÔNG sinh effect
    const archHasLaneModel = !!job?.persona.laneModel
    check('[BUG] laneModel override cho persona thiếu field → persona.laneModel undefined (no-op silent)',
      !archHasLaneModel,
      `persona.laneModel=${job?.persona.laneModel} — nếu undefined = BUG CONFIRMED: laneModel override bị ignore`)
    // Kiểm thêm: card vẫn lưu modelOverride='laneModel' (intent stored, effect missing)
    check('card lưu modelOverride=laneModel (intent stored)',
      store.getCard(c.id)!.modelOverride === 'laneModel')
    clean(dir)
  }

  // ── 9. laneModel không hạ opus → khi base.model=opus + laneModel → model giữ opus ──
  {
    const { store, engine } = setup(dir)
    // arch: model=opus, không có laneModel
    const c = engine.createCard('t', 'b', 'feat', undefined, 0, 'default', false, 'laneModel', [], 'arch')
    engine.tick()
    const job = engine.claim()
    check('laneModel + opus persona → model giữ opus (KHÔNG hạ cấp)',
      job?.persona.model === 'opus',
      `got ${job?.persona.model}`)
    clean(dir)
  }

  // ── 10. sonnet override không hạ opus persona (D1 regression) ──
  {
    const { store, engine } = setup(dir)
    const c = engine.createCard('t', 'b', 'feat', undefined, 0, 'default', false, 'sonnet', [], 'arch')
    engine.tick()
    const job = engine.claim()
    check('sonnet override KHÔNG hạ opus persona → giữ opus (D1 regression)',
      job?.persona.model === 'opus',
      `got ${job?.persona.model}`)
    clean(dir)
  }

  // ── 11. [BUG-2 FIX] opus override + persona CÓ laneModel → laneModel bị strip → ClaudeRunner chạy opus ──
  {
    const { store, engine } = setup(dir)
    const c = engine.createCard('t', 'b', 'feat', undefined, 0, 'default', false, 'opus', [], 'tanjiro')
    engine.tick()
    const job = engine.claim()
    check('BUG-2: opus override + tanjiro (có lane) → persona.laneModel stripped (route ClaudeRunner)',
      job?.persona.laneModel === undefined,
      `got ${job?.persona.laneModel} — nếu không undefined thì CompositeRunner vẫn route sang lane, bỏ qua opus`)
    check('BUG-2: model vẫn là opus (không bị hạ)',
      job?.persona.model === 'opus',
      `got ${job?.persona.model}`)
    clean(dir)
  }

  // ── 12. auto (không override) + persona CÓ laneModel → laneModel vẫn còn (lane routing bình thường) ──
  {
    const { store, engine } = setup(dir)
    const c = engine.createCard('t', 'b', 'feat', undefined, 0, 'default', false, undefined, [], 'tanjiro')
    engine.tick()
    const job = engine.claim()
    check('auto (không override) + tanjiro → persona.laneModel còn (lane routing bình thường)',
      job?.persona.laneModel === 'deepseek-v3-0324',
      `got ${job?.persona.laneModel}`)
    clean(dir)
  }

  console.log(`\n${fail === 0 ? '✅ ALL PASS' : '⚠️  CÓ FAIL'} — ${pass} pass, ${fail} fail`)
  process.exit(fail === 0 ? 0 : 1)
}
main().catch((e) => { console.error(e); process.exit(1) })
