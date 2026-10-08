// smoke-dogfood — LUCY tự upgrade CHÍNH NÓ: agent thật sửa code agent-machine, autopilot duyệt.
// Chạy TỪ agent-machine (ws = repo thật, có node_modules → build/typecheck chạy được). Branch-isolated.
// Cần claude (brain/director) + key lane (executor). KHÔNG commit gì — chỉ để xem diff.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { Store } from './store'
import { Budget } from './budget'
import { Engine } from './engine'
import { ClaudeRunner, type Runner } from './runner'
import { LaneRunner } from './lane-runner'
import { laneAvailable } from './llm-lane'
import { directorDecide, isProtectedGate } from './autopilot'
import { loadConfig } from './config'
import type { Card, Stage, Persona, RunResult } from './types'

const AM = process.cwd() // = .../LUCY/agent-machine
const REPO = path.resolve(AM, '..')
function git(args: string[]): string { try { return execFileSync('git', ['-C', REPO, ...args], { encoding: 'utf8' }).trim() } catch { return '' } }

class Composite implements Runner {
  private claude = new ClaudeRunner()
  private lane = new LaneRunner()
  run(c: Card, s: Stage, p: Persona, ws: string): Promise<RunResult> {
    const useLane = !!(p.laneModel && laneAvailable(p.laneModel))
    console.log(`   ⚙ ${p.name} @ ${s.name} → ${useLane ? 'LANE ' + p.laneModel : 'claude -p ' + p.model}`)
    return useLane ? this.lane.run(c, s, p, ws) : this.claude.run(c, s, p, ws)
  }
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lucy-dog-'))
const store = new Store(path.join(tmp, '.data'))
loadConfig(store, path.join(AM, 'config'))
store.registerPipeline({ id: 'dogfood', name: 'Dogfood', stages: [{ id: 'build', name: 'Code feature', personaId: 'builder' }, { id: 'review', name: 'Review & duyệt', personaId: 'reviewer', gate: true }] })
const runner = new Composite()
const engine = new Engine(store, runner, new Budget({ windowMs: 3600e3, capUsd: 8, softUsd: 6 }), { maxLanes: 1, perCardMaxUsd: 8, maxStageVisits: 2 })

const BRIEF = `Thêm CLI "providers" cho agent-machine để Lucy xem nhanh trạng thái nguồn model.
- TẠO FILE MỚI: src/providers-cli.ts — import { providerStatus, MODEL_CATALOG } from './llm-lane' (đã export sẵn).
  In ra: (1) bảng provider sống/chết [providerStatus(): {provider,label,hasKey}], (2) MODEL_CATALOG nhóm theo role (key · label · provider · free).
- THÊM 1 DÒNG script vào package.json: "providers": "tsx src/providers-cli.ts" (đặt cạnh "llm").
- CHỈ thêm file mới + 1 dòng script đó. KHÔNG sửa file khác, KHÔNG đổi code có sẵn.
Done khi: \`npm run typecheck\` sạch VÀ \`npm run providers\` in ra danh sách provider + model thật.`

function captureArtifacts(): { files: string[]; diffstat: string; isRepo: boolean } {
  const status = git(['status', '--porcelain'])
  const files = status ? status.split('\n').map((l) => l.slice(3).trim()).filter(Boolean).slice(0, 40) : []
  return { files, diffstat: git(['diff', '--stat']).slice(0, 1500), isRepo: true }
}

;(async () => {
  console.log(`▶ DOGFOOD — Lucy tự upgrade. repo=${REPO}  (branch ${git(['rev-parse', '--abbrev-ref', 'HEAD'])})`)
  console.log(`  task: thêm CLI providers · pipeline build(Tanjiro lane)→review(Rengoku gate)→autopilot`)
  const card = engine.createCard('Thêm CLI providers cho Lucy', BRIEF, 'dogfood', undefined, 0, 'lucy', false, undefined, [])
  if (!card) { console.error('❌ create card fail'); process.exit(1) }

  let guard = 0, directed = 0
  while (guard++ < 20) {
    engine.tick()
    const job = engine.claim()
    if (job) {
      let res: RunResult
      try { res = await runner.run(job.card, job.stage, job.persona, AM) } // ws = repo thật
      catch (e) { res = { outcome: { decision: 'fail', summary: String(e instanceof Error ? e.message : e) }, cost: { usd: 0, inTok: 0, outTok: 0 }, raw: '' } }
      res.artifacts = captureArtifacts()
      engine.submit(job.jobId, res)
      console.log(`   → ${job.stage.name}: ${res.outcome.decision} — ${res.outcome.summary?.slice(0, 160)}`)
      continue
    }
    const c = store.getCard(card.id)!
    if (c.status === 'done' || c.status === 'failed') break
    if (c.status === 'waiting_human') {
      if (c.waitKind !== 'gate') { console.log(`   ⏸ waiting_human (${c.waitKind}) → để người. DỪNG.`); break }
      const pipe = store.pipelines.get(c.pipelineId)!, stage = pipe.stages[c.stageIndex], persona = store.personas.get(stage.personaId)
      if (isProtectedGate(pipe, persona)) { console.log('   🔒 gate protected → để Bill.'); break }
      directed++
      console.log(`   🌙 autopilot: director đọc gate "${stage.name}"...`)
      const d = await directorDecide(c, stage.name)
      console.log(`   🌙 director → ${d.action}: ${d.reason.slice(0, 200)}`)
      if (d.action === 'approve') engine.approve(c.id); else engine.reject(c.id, d.reason)
      continue
    }
    await new Promise((s) => setTimeout(s, 50))
  }

  const c = store.getCard(card.id)!
  console.log('────────────')
  console.log(`status: ${c.status} · cost ~$${c.cost.usd.toFixed(3)} · autopilot ${directed} quyết`)
  console.log('FILE đổi (git status):\n' + (git(['status', '--porcelain']) || '(không có thay đổi!)'))
  console.log('\nDIFF:\n' + git(['diff', '--', 'agent-machine/package.json', 'agent-machine/src/providers-cli.ts']).slice(0, 2500))
  fs.rmSync(tmp, { recursive: true, force: true })
  process.exit(0)
})()
