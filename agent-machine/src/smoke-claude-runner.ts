// smoke-claude-runner — verify ClaudeRunner spawn được claude THẬT trên platform hiện tại
// (Windows npm shim .ps1/.cmd từng ENOENT chết im). Task tí hon đỡ tốn token.
//   npx tsx src/smoke-claude-runner.ts
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { ClaudeRunner } from './runner'
import type { Card, Persona, Stage } from './types'

const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'lucy-smoke-runner-'))
const card: Card = {
  id: 'card_smokerun', title: 'Phép thử spawn', brief: 'Trả lời: 2+2 bằng mấy? Chỉ cần trả lời rồi kết thúc đúng quy tắc.',
  pipelineId: 'p', projectId: 'demo', stageIndex: 0, status: 'working', workspace: ws, depth: 0, blockedBy: [],
  cost: { usd: 0, inTok: 0, outTok: 0 }, history: [], createdAt: Date.now(), updatedAt: Date.now(),
}
const stage: Stage = { id: 's1', name: 'trả lời', personaId: 'mini' }
const persona: Persona = { id: 'mini', name: 'Mini', systemPrompt: 'Bạn là agent thử nghiệm. Làm đúng yêu cầu, ngắn gọn.', model: 'sonnet', allowedTools: ['Read'], maxTurns: 2, timeoutSec: 120 }

const r = await new ClaudeRunner().run(card, stage, persona, ws)
console.log(`decision=${r.outcome.decision} · summary="${r.outcome.summary}" · sessionId=${r.sessionId ? 'có' : 'KHÔNG'} · cost=$${r.cost.usd.toFixed(4)}`)
fs.rmSync(ws, { recursive: true, force: true })
if (r.outcome.decision !== 'advance' && r.outcome.decision !== 'done') { console.error(`❌ FAIL — raw đầu: ${r.raw.slice(0, 400)}`); process.exit(1) }
console.log('✅ smoke-claude-runner PASS')
