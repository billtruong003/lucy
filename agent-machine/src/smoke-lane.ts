// smoke-lane — verify LaneRunner (model rẻ + tool-calling) làm việc THẬT trong workspace.
// Cần key lane trong env (OPENROUTER_API_KEY / OPENCODE_ZEN_API_KEY …). KHÔNG hardcode secret ở đây.
// Chạy: <set env keys> && npx tsx src/smoke-lane.ts
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { LaneRunner } from './lane-runner'
import { laneAvailable } from './llm-lane'
import type { Card, Stage, Persona } from './types'

const MODEL = process.env.SMOKE_LANE_MODEL || 'executor' // role 'executor' → tự fallback chain
if (!laneAvailable(MODEL)) { console.error(`✗ không có key lane cho "${MODEL}" — set OPENROUTER_API_KEY / OPENCODE_ZEN_API_KEY …`); process.exit(2) }

const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'lucy-lane-'))
const persona: Persona = {
  id: 'smoke', name: 'Smoke · Lane', model: 'sonnet', laneModel: MODEL,
  systemPrompt: 'Bạn là kỹ sư. Làm đúng task được giao trong workspace, gọn.',
  allowedTools: ['Read', 'Write', 'Edit', 'Bash'], maxTurns: 8, timeoutSec: 180,
}
const stage: Stage = { id: 'build', name: 'Tạo file', personaId: 'smoke' }
const now = Date.now()
const card: Card = {
  id: 'smoke1', title: 'Tạo file hello.txt',
  brief: 'Tạo file hello.txt trong workspace với nội dung ĐÚNG LÀ: lucy-lane-ok . Sau đó đọc lại bằng tool để verify. Xong thì advance.',
  pipelineId: 'eng', projectId: 'smoke', stageIndex: 0, status: 'working', workspace: ws,
  depth: 0, blockedBy: [], cost: { usd: 0, inTok: 0, outTok: 0 },
  history: [], createdAt: now, updatedAt: now,
}

;(async () => {
  console.log(`▶ LaneRunner model="${MODEL}" ws=${ws}`)
  const t0 = Date.now()
  const r = await new LaneRunner().run(card, stage, persona, ws)
  const secs = ((Date.now() - t0) / 1000).toFixed(1)
  const file = path.join(ws, 'hello.txt')
  const made = fs.existsSync(file) ? fs.readFileSync(file, 'utf8').trim() : '(không tạo)'
  console.log(`outcome: ${r.outcome.decision} — ${r.outcome.summary}`)
  console.log(`tokens: in ${r.cost.inTok} / out ${r.cost.outTok}  ·  ${secs}s`)
  console.log(`hello.txt = "${made}"`)
  const ok = /lucy-lane-ok/.test(made) && ['advance', 'done'].includes(r.outcome.decision)
  console.log(ok ? '✅ PASS — model rẻ đã dùng tool tạo+verify file thật' : '❌ FAIL')
  fs.rmSync(ws, { recursive: true, force: true })
  process.exit(ok ? 0 : 1)
})()
