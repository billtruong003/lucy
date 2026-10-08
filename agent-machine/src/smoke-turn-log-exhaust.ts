// smoke-turn-log-exhaust — chạy THẬT LaneRunner.run tới khi HẾT maxTurns mà agent
// KHÔNG ra outcome (đúng ca card cần trace: "agent kẹt turn không ra outcome").
// Mock globalThis.fetch → mỗi turn trả text ngắn (không tool_call, không JSON outcome) →
// loop chạy hết maxTurns → nhánh terminal lane-runner.ts ghi record action:'outcome' turnCount:maxTurns.
// Chạy: npx tsx src/smoke-turn-log-exhaust.ts
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
  return txt.trim().split('\n').map((l) => JSON.parse(l) as Record<string, unknown>)
}

async function main() {
  console.log('🧪 smoke:turn-log-exhaust — LaneRunner.run hết maxTurns → terminal record')

  // Cô lập env: không nạp .env.llm thật, chỉ 1 key giả cho provider đầu chain executor (opencode-zen).
  process.env.LLM_ENV_FILE = path.join(os.tmpdir(), 'no-such-env-' + process.pid)
  for (const k of Object.keys(process.env)) {
    if (/_API_KEY$|^GROQ|^GEMINI|^CEREBRAS|^MISTRAL|^OPENROUTER|^ZAI|^ZEN/.test(k)) delete process.env[k]
  }
  process.env.OPENCODE_ZEN_API_KEY = 'test-key'

  // Mock fetch: mỗi lần trả text ngắn (<20 ký tự sau cleanReport) → không tool_call, không outcome.
  // → loop không bao giờ return giữa chừng, chạy đủ maxTurns; report ngắn → KHÔNG gọi salvage (offline).
  let fetchCalls = 0
  const realFetch = globalThis.fetch
  // @ts-expect-error — override để chặn network trong smoke
  globalThis.fetch = async () => {
    fetchCalls++
    return {
      ok: true,
      json: async () => ({
        choices: [{ message: { role: 'assistant', content: 'hmm chưa xong' } }],
        usage: { prompt_tokens: 5, completion_tokens: 7 },
      }),
    }
  }

  const logDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tl-exh-'))
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'tl-exh-ws-'))
  process.env.AM_TURNS_LOG = logDir

  const MAX = 3
  const card: Card = {
    id: 'card-exh-1', title: 'kẹt turn', brief: 'không bao giờ ra JSON', pipelineId: 'p',
    projectId: 'proj', stageIndex: 0, status: 'working', workspace: ws, depth: 0, blockedBy: [],
    cost: { usd: 0, inTok: 0, outTok: 0 }, history: [], createdAt: 0, updatedAt: 0,
  }
  const stage: Stage = { id: 'stage-exh', name: 'Code feature', personaId: 'tester' }
  const persona: Persona = {
    id: 'executor', name: 'Executor', systemPrompt: 'code', model: 'sonnet',
    laneModel: 'executor', maxTurns: MAX,
  }

  const runner = new LaneRunner(createTurnLogger())
  const res = await runner.run(card, stage, persona, ws)
  globalThis.fetch = realFetch
  console.log(`  → outcome.decision = ${res.outcome.decision} | fetch gọi ${fetchCalls} lần`)

  const lines = readJSONL(path.join(logDir, 'turn-log.jsonl'))
  console.log('  ── turn-log.jsonl THẬT ──')
  for (const l of lines) console.log('    ' + JSON.stringify(l))
  console.log('  ─────────────────────────')

  check('fetch chạy đúng maxTurns lần (loop không return sớm)', fetchCalls === MAX, `(got ${fetchCalls})`)
  check('có maxTurns record text + 1 record terminal', lines.length === MAX + 1, `(got ${lines.length})`)

  const terminal = lines[lines.length - 1]
  check('record cuối action === "outcome"', terminal?.action === 'outcome', `(got ${terminal?.action})`)
  check('record cuối turnCount === maxTurns (đánh dấu kẹt hết turn)', terminal?.turnCount === MAX, `(got ${terminal?.turnCount})`)
  check('record cuối có outcome.summary (truy được vì sao kẹt)', typeof terminal?.outcome === 'string' && (terminal!.outcome as string).length > 0)
  check('record cuối agent/task/stage khớp card', terminal?.agent === 'executor' && terminal?.task === 'card-exh-1' && terminal?.stage === 'stage-exh')
  check('các record trước là text (turnCount 0..maxTurns-1)',
    lines.slice(0, MAX).every((r, i) => r.action === 'text' && r.turnCount === i))

  delete process.env.AM_TURNS_LOG
  delete process.env.OPENCODE_ZEN_API_KEY
  fs.rmSync(logDir, { recursive: true, force: true })
  fs.rmSync(ws, { recursive: true, force: true })

  console.log(`\n${fail === 0 ? '✅ ALL PASS' : '❌ FAIL'} — ${pass} pass, ${fail} fail`)
  process.exit(fail === 0 ? 0 : 1)
}
main().catch((e) => { console.error(e); process.exit(1) })
