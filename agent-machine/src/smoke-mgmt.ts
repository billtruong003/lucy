// Smoke card-management — defer/backlog + activate + remove (xoá rác/lỗi). No token burn. Exit 1 nếu fail.
import fs from 'node:fs'
import path from 'node:path'
import { Store } from './store'
import { Budget } from './budget'
import { Engine } from './engine'
import { MockRunner } from './runner'
import type { Outcome } from './types'

let pass = 0
let fail = 0
const check = (n: string, c: boolean, e = '') => { if (c) { pass++; console.log(`  ✅ ${n}`) } else { fail++; console.log(`  ❌ ${n} ${e}`) } }
const clean = (p: string) => fs.rmSync(p, { recursive: true, force: true })

function setup(dir: string) {
  clean(dir)
  const store = new Store(dir)
  store.registerPersona({ id: 'eng', name: 'Eng', systemPrompt: 'x', model: 'sonnet' })
  store.registerPipeline({ id: 'one', name: 'One', stages: [{ id: 'fix', name: 'Fix', personaId: 'eng' }] })
  const script = { fix: { decision: 'advance', summary: 'ok' } } as Record<string, Outcome>
  const engine = new Engine(store, new MockRunner(script), new Budget({ windowMs: 5 * 3600e3, capUsd: 99 }), { maxLanes: 4 })
  return { store, engine }
}

async function main() {
  console.log('🧪 card-management smoke (defer / activate / remove)')
  const dir = path.join(process.cwd(), '.smoke-mgmt')
  const { store, engine } = setup(dir)

  // ── DEFER: tạo backlog -> KHÔNG dispatch ──
  const d = engine.createCard('để sau', 'b', 'one', undefined, 0, 'default', true)
  check('defer -> status backlog', d.status === 'backlog')
  engine.tick()
  check('backlog KHÔNG bị dispatch (vẫn backlog)', store.getCard(d.id)!.status === 'backlog', `(got ${store.getCard(d.id)!.status})`)

  // ── ACTIVATE: backlog -> queued -> chạy ──
  engine.activate(d.id)
  check('activate -> queued', store.getCard(d.id)!.status === 'queued')
  engine.tick(); await engine.drainLocal()
  check('sau activate chạy tới done', store.getCard(d.id)!.status === 'done', `(got ${store.getCard(d.id)!.status})`)
  check('activate id không hợp lệ -> no-op (không throw)', (engine.activate('nope'), true))

  // ── REMOVE: xoá card rác ──
  const r = engine.createCard('rác', 'b', 'one')
  check('removeCard trả true', engine.removeCard(r.id) === true)
  check('card biến mất khỏi store', store.getCard(r.id) === undefined)
  check('removeCard id không tồn tại -> false', engine.removeCard('nope') === false)

  // ── REMOVE card đang in-flight: dọn sạch pending/inFlight, job mồ côi KHÔNG chạy ──
  const w = engine.createCard('đang bay', 'b', 'one')
  engine.tick() // -> working + pending
  check('card vào working sau tick', store.getCard(w.id)!.status === 'working', `(got ${store.getCard(w.id)!.status})`)
  engine.removeCard(w.id)
  check('remove working card -> mất khỏi store', store.getCard(w.id) === undefined)
  const ran = await engine.drainLocal()
  check('job mồ côi không chạy (drain = 0)', ran === 0, `(ran=${ran})`)

  // ── card backlog KHÔNG đếm là queued (limits) ──
  engine.createCard('backlog2', 'b', 'one', undefined, 0, 'default', true)
  check('backlog không tính vào queued', engine.limits().queued === 0, `(queued=${engine.limits().queued})`)

  // ── MODEL OVERRIDE: card ép opus -> claim trả persona.model = opus (local lẫn remote) ──
  const mo = engine.createCard('ép opus', 'b', 'one', undefined, 0, 'default', false, 'opus')
  check('card lưu modelOverride', store.getCard(mo.id)!.modelOverride === 'opus')
  engine.tick()
  const spec = engine.claim()
  check('claim áp model = opus', spec?.persona.model === 'opus', `(got ${spec?.persona.model})`)
  check('persona gốc KHÔNG bị đổi (clone, không mutate)', store.personas.get('eng')!.model === 'sonnet')
  check('project KHÔNG repo -> claim.repo undefined', spec?.repo === undefined)

  // ── D1: override KHÔNG hạ cấp stage opus (reviewer/architect) — engine riêng để khỏi bẩn state ──
  const d1 = path.join(process.cwd(), '.smoke-d1'); clean(d1)
  const d1store = new Store(d1)
  d1store.registerPersona({ id: 'rev', name: 'Rev', systemPrompt: 'r', model: 'opus' })
  d1store.registerPipeline({ id: 'rv', name: 'Rv', stages: [{ id: 'r', name: 'R', personaId: 'rev' }] })
  const d1eng = new Engine(d1store, new MockRunner({}), new Budget({ windowMs: 5 * 3600e3, capUsd: 99 }), { maxLanes: 2 })
  const dc = d1eng.createCard('downgrade?', 'b', 'rv', undefined, 0, 'default', false, 'sonnet')
  d1eng.tick()
  const dsp = d1eng.claim()
  check('override sonnet KHÔNG hạ reviewer opus -> giữ opus', dsp?.persona.model === 'opus', `(got ${dsp?.persona.model})`)
  clean(d1)

  // ── PROJECT first-class ──
  const pj = engine.createProject('Game ABC', { repoUrl: 'https://github.com/x/abc' })
  check('createProject lưu repoUrl', store.getProject('Game ABC')?.repoUrl === 'https://github.com/x/abc')
  check('project có kênh "general" mặc định', store.getProject('Game ABC')!.channels.includes('general'))
  check('createProject idempotent (cùng tên không nhân đôi)', engine.createProject('Game ABC').id === pj.id && store.listProjects().filter((p) => p.id === 'Game ABC').length === 1)
  engine.createCard('t', 'b', 'one', undefined, 0, 'Dự án mới X')
  check('tạo card AUTO tạo project', !!store.getProject('Dự án mới X'))
  check('removeProject bị chặn khi còn card', engine.removeProject('Dự án mới X') === false)
  check('removeProject rỗng OK', engine.removeProject('Game ABC') === true)

  // ── R2: project có repoUrl -> claim gắn repo cho worker clone ──
  engine.createProject('repo-proj', { repoUrl: 'https://github.com/x/y', branch: 'dev' })
  const rc = engine.createCard('work', 'b', 'one', undefined, 0, 'repo-proj')
  engine.tick()
  let rs = engine.claim(); let guard = 0
  while (rs && rs.cardId !== rc.id && guard++ < 12) rs = engine.claim()
  check('claim gắn repo.url khi project có repoUrl', rs?.repo?.url === 'https://github.com/x/y', `(got ${rs?.repo?.url})`)
  check('claim gắn repo.branch', rs?.repo?.branch === 'dev', `(got ${rs?.repo?.branch})`)

  // ── R4: kênh Discord-style + human post ──
  engine.createProject('ChanProj')
  check('project mặc định có kênh "general"', store.getProject('ChanProj')!.channels.includes('general'))
  check('addChannel + sanitize "Testing!!" -> "testing"', engine.addChannel('ChanProj', 'Testing!!') === true && store.getProject('ChanProj')!.channels.includes('testing'))
  engine.postHuman('ChanProj', 'general', 'hello team')
  check('postHuman vào kênh dự án', store.readChannel('p:ChanProj:general').some((m) => m.text === 'hello team' && m.author === 'bill'))
  engine.postHuman('ChanProj', 'card-xyz', 'rep task con')
  check('postHuman vào card-thread (rep AI)', store.readChannel('card-xyz').some((m) => m.text === 'rep task con'))
  check('removeChannel "general" bị chặn', engine.removeChannel('ChanProj', 'general') === false)
  check('removeChannel "testing" OK', engine.removeChannel('ChanProj', 'testing') === true)

  // ── R6: SKILL dự án nhồi vào persona khi claim (clone, không mutate gốc) ──
  engine.createProject('SkillProj', { skill: 'DOMAIN: chuyên gia Unity.' })
  const sc = engine.createCard('w', 'b', 'one', undefined, 0, 'SkillProj')
  engine.tick()
  let ss = engine.claim(); let g2 = 0
  while (ss && ss.cardId !== sc.id && g2++ < 14) ss = engine.claim()
  check('SKILL dự án nhồi vào persona prompt', !!ss && ss.persona.systemPrompt.includes('DOMAIN: chuyên gia Unity.'))
  check('persona gốc KHÔNG bị nhồi (clone)', store.personas.get('eng')!.systemPrompt === 'x')

  // ── V2: thùng rác dự án (trash/restore/purge) ──
  engine.createProject('TrashMe')
  engine.createCard('rác1', 'b', 'one', undefined, 0, 'TrashMe')
  check('trashProject -> trashed=true', engine.trashProject('TrashMe') === true && store.getProject('TrashMe')!.trashed === true)
  check('restoreProject -> trashed=false', engine.restoreProject('TrashMe') === true && store.getProject('TrashMe')!.trashed === false)
  const before = store.listCards().filter((c) => (c.projectId || 'default') === 'TrashMe').length
  const purged = engine.purgeProject('TrashMe')
  check('purgeProject xoá hết card dự án', purged === before && store.listCards().filter((c) => (c.projectId || 'default') === 'TrashMe').length === 0)
  check('purgeProject xoá record dự án', store.getProject('TrashMe') === undefined)

  // ── O1: custom flow (pipeline) tạo/sửa/xoá ──
  const fp = engine.upsertPipeline({ name: 'My Flow', stages: [{ name: 'B1', personaId: 'eng' }, { name: 'B2', personaId: 'eng', gate: true }] })
  check('upsertPipeline tạo flow (id từ tên)', !!fp && fp.id === 'my-flow' && store.pipelines.get('my-flow')!.stages.length === 2)
  check('flow giữ gate đúng', store.pipelines.get('my-flow')!.stages[1].gate === true)
  check('upsertPipeline bỏ stage persona không tồn tại -> null', engine.upsertPipeline({ name: 'Bad', stages: [{ name: 'x', personaId: 'nope' }] }) === null)
  check('deletePipeline xoá flow tự tạo', engine.deletePipeline('my-flow') === true && store.pipelines.get('my-flow') === undefined)

  // ── D3/D4: rework -> card về bước trước + reviewNotes; lastSummary set ──
  const rk = path.join(process.cwd(), '.smoke-rework'); clean(rk)
  const rkStore = new Store(rk)
  rkStore.registerPersona({ id: 'eng', name: 'E', systemPrompt: 'x', model: 'sonnet' })
  rkStore.registerPipeline({ id: 'br', name: 'BR', stages: [{ id: 'b', name: 'Build', personaId: 'eng' }, { id: 'r', name: 'Review', personaId: 'eng' }] })
  const rkRunner = new MockRunner({ b: { decision: 'advance', summary: 'đã build' }, r: { decision: 'rework', summary: 'lỗi X ở foo.ts:10' } } as Record<string, Outcome>)
  const rkEng = new Engine(rkStore, rkRunner, new Budget({ windowMs: 5 * 3600e3, capUsd: 99 }), { maxLanes: 2 })
  const rkc = rkEng.createCard('feat', 'b', 'br')
  rkEng.tick(); await rkEng.drainLocal()
  check('build advance -> sang stage review', rkStore.getCard(rkc.id)!.stageIndex === 1)
  check('lastSummary set sau build (D4)', rkStore.getCard(rkc.id)!.lastSummary === 'đã build')
  rkEng.tick(); await rkEng.drainLocal()
  const rkAfter = rkStore.getCard(rkc.id)!
  check('rework -> về lại stage build (index 0)', rkAfter.stageIndex === 0, `(got ${rkAfter.stageIndex})`)
  check('rework ghi reviewNotes', (rkAfter.reviewNotes || []).some((n) => n.includes('lỗi X')))
  clean(rk)

  // ── E1: task dependency — B chờ A xong mới chạy ──
  const de = path.join(process.cwd(), '.smoke-dep'); clean(de)
  const dstore = new Store(de)
  dstore.registerPersona({ id: 'eng', name: 'E', systemPrompt: 'x', model: 'sonnet' })
  dstore.registerPipeline({ id: 'one', name: 'One', stages: [{ id: 'fix', name: 'F', personaId: 'eng' }] })
  const deng = new Engine(dstore, new MockRunner({ fix: { decision: 'advance', summary: 'ok' } } as Record<string, Outcome>), new Budget({ windowMs: 5 * 3600e3, capUsd: 99 }), { maxLanes: 4 })
  const da = deng.createCard('A', 'b', 'one')
  const db = deng.createCard('B', 'b', 'one', undefined, 0, 'default', false, undefined, [da.id])
  check('B blocked vì chờ A', dstore.getCard(db.id)!.status === 'blocked')
  deng.tick(); await deng.drainLocal()
  check('A chạy xong, B vẫn chờ', dstore.getCard(da.id)!.status === 'done' && dstore.getCard(db.id)!.status === 'blocked')
  deng.tick()
  check('A xong -> B mở khoá (queued, không advance)', dstore.getCard(db.id)!.status === 'queued' && dstore.getCard(db.id)!.stageIndex === 0)
  clean(de)

  // ── E2: needs_decision answer -> chạy LẠI stage với câu trả lời ──
  const an = path.join(process.cwd(), '.smoke-ans'); clean(an)
  const astore = new Store(an)
  astore.registerPersona({ id: 'eng', name: 'E', systemPrompt: 'x', model: 'sonnet' })
  astore.registerPipeline({ id: 'one', name: 'One', stages: [{ id: 'fix', name: 'F', personaId: 'eng' }] })
  const aeng = new Engine(astore, new MockRunner({ fix: { decision: 'needs_decision', summary: 'A hay B?', question: 'A hay B?' } } as Record<string, Outcome>), new Budget({ windowMs: 5 * 3600e3, capUsd: 99 }), { maxLanes: 2 })
  const ac = aeng.createCard('q', 'b', 'one')
  aeng.tick(); await aeng.drainLocal()
  check('needs_decision -> waiting_human + waitKind=decision', astore.getCard(ac.id)!.status === 'waiting_human' && astore.getCard(ac.id)!.waitKind === 'decision')
  aeng.answer(ac.id, 'chọn A')
  const af = astore.getCard(ac.id)!
  check('answer -> queued (chạy lại stage), stage không đổi', af.status === 'queued' && af.stageIndex === 0)
  check('answer ghi reviewNotes', (af.reviewNotes || []).some((n) => n.includes('chọn A')))
  clean(an)

  // ── O2: lease — card 'working' treo quá lâu -> đưa lại hàng ──
  const ls = path.join(process.cwd(), '.smoke-lease'); clean(ls)
  const lstore = new Store(ls)
  lstore.registerPersona({ id: 'eng', name: 'E', systemPrompt: 'x', model: 'sonnet' })
  lstore.registerPipeline({ id: 'one', name: 'One', stages: [{ id: 'fix', name: 'F', personaId: 'eng' }] })
  const leng = new Engine(lstore, new MockRunner({}), new Budget({ windowMs: 5 * 3600e3, capUsd: 99 }), { maxLanes: 0, leaseMs: 5 })
  const lc = leng.createCard('stuck', 'b', 'one')
  const cc = lstore.getCard(lc.id)!; cc.status = 'working'; cc.updatedAt = Date.now() - 1000 // ép treo (không putCard để giữ updatedAt cũ)
  leng.tick()
  check('lease: card treo -> đưa lại hàng (queued)', lstore.getCard(lc.id)!.status === 'queued', `(got ${lstore.getCard(lc.id)!.status})`)
  clean(ls)

  clean(dir)
  console.log(`\n${fail === 0 ? '✅ ALL PASS' : '❌ FAIL'} — ${pass} pass, ${fail} fail`)
  process.exit(fail === 0 ? 0 : 1)
}
main().catch((e) => { console.error(e); process.exit(1) })
