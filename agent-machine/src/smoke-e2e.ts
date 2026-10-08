// smoke-e2e — CHẠY THẬT cả chuỗi in-process: card → executor (lane rẻ) → gate → autopilot duyệt.
// Cần claude (brain/director) + key lane (executor). Inject key qua env trước khi chạy.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { Store } from './store'
import { Budget } from './budget'
import { Engine } from './engine'
import { ClaudeRunner, type Runner } from './runner'
import { LaneRunner } from './lane-runner'
import { laneAvailable } from './llm-lane'
import { directorDecide, isProtectedGate } from './autopilot'
import { loadConfig } from './config'
import type { Card, Stage, Persona, RunResult } from './types'

class Composite implements Runner {
  private claude = new ClaudeRunner()
  private lane = new LaneRunner()
  run(c: Card, s: Stage, p: Persona, ws: string): Promise<RunResult> {
    const useLane = !!(p.laneModel && laneAvailable(p.laneModel))
    console.log(`   ⚙ ${p.name} @ ${s.name} → ${useLane ? 'LANE ' + p.laneModel : 'claude -p ' + p.model}`)
    return useLane ? this.lane.run(c, s, p, ws) : this.claude.run(c, s, p, ws)
  }
}

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lucy-e2e-'))
const store = new Store(path.join(root, '.data'))
loadConfig(store, path.join(process.cwd(), 'config'))
const runner = new Composite()
const engine = new Engine(store, runner, new Budget({ windowMs: 3600e3, capUsd: 5, softUsd: 4 }), { maxLanes: 1, perCardMaxUsd: 5, maxStageVisits: 2 })

const wsFor = (cardId: string): string => { const w = path.join(root, 'ws', cardId); fs.mkdirSync(w, { recursive: true }); return w }
function captureFiles(ws: string): string[] { try { return fs.readdirSync(ws).filter((f) => !f.startsWith('.')) } catch { return [] } }

;(async () => {
  console.log(`▶ E2E — pipeline 'blog' (build=Tanjiro lane → review=Rengoku gate). ws=${root}`)
  const card = engine.createCard('Tạo trang index.html', 'Tạo file index.html với nội dung đúng là: <h1>Lucy E2E OK</h1> . Done = file tồn tại đúng nội dung.', 'blog', undefined, 0, 'e2e', false, undefined, [])
  if (!card) { console.error('❌ không tạo được card (pipeline blog?)'); process.exit(1) }

  let guard = 0
  let directed = 0
  while (guard++ < 24) {
    engine.tick()
    const job = engine.claim()
    if (job) {
      const ws = wsFor(job.cardId)
      let res: RunResult
      try { res = await runner.run(job.card, job.stage, job.persona, ws) } catch (e) { res = { outcome: { decision: 'fail', summary: String(e instanceof Error ? e.message : e) }, cost: { usd: 0, inTok: 0, outTok: 0 }, raw: '' } }
      res.artifacts = { files: captureFiles(ws), isRepo: false }
      engine.submit(job.jobId, res)
      console.log(`   → ${job.stage.name}: ${res.outcome.decision} — ${res.outcome.summary}`)
      continue
    }
    const c = store.getCard(card.id)!
    if (c.status === 'done' || c.status === 'failed') break
    if (c.status === 'waiting_human') {
      if (c.waitKind === 'gate') {
        const pipe = store.pipelines.get(c.pipelineId)!
        const stage = pipe.stages[c.stageIndex]
        const persona = store.personas.get(stage.personaId)
        if (isProtectedGate(pipe, persona)) { console.log(`   🔒 gate protected (${stage.personaId}) → để Bill. DỪNG.`); break }
        directed++
        console.log(`   🌙 autopilot: Lucy-director đọc gate "${stage.name}"...`)
        const d = await directorDecide(c, stage.name)
        console.log(`   🌙 director → ${d.action}: ${d.reason}`)
        if (d.action === 'approve') engine.approve(c.id)
        else engine.reject(c.id, d.reason)
        continue
      }
      console.log(`   ⏸ waiting_human (${c.waitKind}) → để người. DỪNG.`)
      break
    }
    // không job, chưa done → để tick kịp requeue, lặp tiếp (tránh kẹt)
    await new Promise((s) => setTimeout(s, 50))
  }

  const c = store.getCard(card.id)!
  const wsFile = path.join(root, 'ws', card.id, 'index.html')
  const made = fs.existsSync(wsFile) ? fs.readFileSync(wsFile, 'utf8').trim() : '(không tạo)'
  console.log('────────────')
  console.log(`status cuối: ${c.status}  ·  cost ~$${c.cost.usd.toFixed(3)}  ·  autopilot quyết ${directed} lần`)
  console.log(`index.html = ${made.slice(0, 80)}`)
  const ok = c.status === 'done' && /Lucy E2E OK/.test(made)
  console.log(ok ? '✅ PASS — chuỗi đầy đủ chạy: lane executor → gate → autopilot duyệt → done' : '⚠️ chưa hoàn hảo — xem trace trên')
  fs.rmSync(root, { recursive: true, force: true })
  process.exit(ok ? 0 : 1)
})()
