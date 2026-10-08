// smoke-turn-log-wire — chạy THẬT LaneRunner.run để chứng minh wiring sinh JSONL.
// Không có API key → callLLMRaw throw → loop hit catch (lane-runner.ts:97-100) →
// turnLogger.log({action:'error'}) → JSONL thật. Chứng minh nhánh error của wiring.
// Chạy: npx tsx src/smoke-turn-log-wire.ts
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { LaneRunner } from './lane-runner'
import { createTurnLogger } from './turn-log'
import type { Card, Stage, Persona } from './types'

let pass = 0
let fail = 0
function check(name: string, cond: boolean, extra = '') {
  if (cond) { pass++; console.log(`  ✅ ${name}`) } else { fail++; console.log(`  ❌ ${name} ${extra}`) }
}

function readJSONL(file: string): Record<string, unknown>[] {
  if (!fs.existsSync(file)) return []
  const txt = fs.readFileSync(file, 'utf8')
  if (!txt.trim()) return []
  return txt.trim().split('\n').flatMap((l) => {
    try { return [JSON.parse(l) as Record<string, unknown>] } catch { return [] }
  })
}

async function main() {
  console.log('🧪 smoke:turn-log-wire — LaneRunner.run sinh JSONL thật (nhánh error)')

  // Bịt mọi provider key để callLLMRaw chắc chắn throw "no entry/key"
  for (const k of Object.keys(process.env)) {
    if (/_API_KEY$|^GROQ|^GEMINI|^CEREBRAS|^MISTRAL|^OPENROUTER|^ZAI|^ZEN/.test(k)) delete process.env[k]
  }

  const logDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tl-wire-'))
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'tl-ws-'))
  process.env.AM_TURNS_LOG = logDir

  const card: Card = {
    id: 'card-wire-1', title: 'test wire', brief: 'prove jsonl', pipelineId: 'p',
    projectId: 'proj', stageIndex: 0, status: 'working', workspace: ws, depth: 0, blockedBy: [],
    cost: { usd: 0, inTok: 0, outTok: 0 }, history: [], createdAt: 0, updatedAt: 0,
  }
  const stage: Stage = { id: 'stage-test', name: 'Viết test', personaId: 'tester' }
  const persona: Persona = {
    id: 'tester', name: 'Tester', systemPrompt: 'test', model: 'sonnet',
    laneModel: 'executor', maxTurns: 3,
  }

  const runner = new LaneRunner(createTurnLogger())
  const res = await runner.run(card, stage, persona, ws)
  console.log(`  → outcome.decision = ${res.outcome.decision}`)

  const file = path.join(logDir, 'turn-log.jsonl')
  const lines = readJSONL(file)

  // PROOF: dump JSONL thật sinh ra
  console.log('  ── turn-log.jsonl THẬT ──')
  for (const l of lines) console.log('    ' + JSON.stringify(l))
  console.log('  ─────────────────────────')

  check('JSONL thật được sinh ra (≥1 dòng)', lines.length >= 1, `(got ${lines.length} dòng)`)

  const VALID_ACTIONS = new Set(['tool_call', 'text', 'outcome', 'error'])
  let allShapeOk = true
  for (const rec of lines) {
    const ok = rec.agent === 'tester' && rec.task === 'card-wire-1' && rec.stage === 'stage-test'
      && VALID_ACTIONS.has(rec.action as string) && typeof rec.turnCount === 'number'
      && typeof rec.token === 'number' && typeof rec.motive === 'string' && typeof rec.outcome === 'string'
    if (!ok) { allShapeOk = false; console.log('    ❌ record sai shape: ' + JSON.stringify(rec)) }
  }
  check('mọi record đúng shape TurnRecord (agent/task/stage/action/turnCount/token)', allShapeOk)
  check('turnCount tăng dần (0-based, không lặp/nhảy lùi)',
    lines.every((r, i) => r.turnCount === i), `(${lines.map((r) => r.turnCount).join(',')})`)
  check('motive ≤ 201 ký tự (truncation áp dụng trong wiring thật)',
    lines.every((r) => (r.motive as string).length <= 201))

  // dọn
  delete process.env.AM_TURNS_LOG
  fs.rmSync(logDir, { recursive: true, force: true })
  fs.rmSync(ws, { recursive: true, force: true })

  console.log(`\n${fail === 0 ? '✅ ALL PASS' : '❌ FAIL'} — ${pass} pass, ${fail} fail`)
  process.exit(fail === 0 ? 0 : 1)
}
main().catch((e) => { console.error(e); process.exit(1) })
