// Worker entry — CHẠY TRÊN MÁY (local mạnh / VPS nhẹ). Quay ra coordinator, chạy stage.
// AM_RUNNER=claude → CompositeRunner: persona có laneModel + có key lane → MODEL RẺ (LaneRunner),
//   còn lại → claude -p (opus/sonnet). Mặc định mock (an toàn, chỉ test plumbing).
// TokenGuard: mỗi run check GET /token-guard → soft → hạ executor xuống LaneRunner rẻ nhất.
import { MockRunner, ClaudeRunner, type Runner } from './runner'
import { LaneRunner } from './lane-runner'
import { createTurnLogger } from './turn-log'
import { laneAvailable, MODEL_CATALOG } from './llm-lane'
import { runWorker } from './worker'
import type { Card, Stage, Persona, RunResult, Outcome } from './types'

const URL = process.env.AM_COORD_URL || 'http://127.0.0.1:8780'
const TOKEN = process.env.AM_TOKEN || ''
const MODE = (process.env.AM_RUNNER || 'mock').toLowerCase()
// số job song song trên MÁY NÀY. VPS đặt 2 (cron/light); máy local mạnh đặt cao hơn.
const CONCURRENCY = Number(process.env.AM_WORKER_CONCURRENCY || 1)

// Turn logger: opt-in qua env AM_TURNS_LOG (không set = no-op)
const turnLogger = createTurnLogger()

// Router: 1 worker chạy ĐƯỢC cả claude -p (brain/critic) lẫn lát rẻ (executor) — chọn theo persona.
// TokenGuard.SOFT đã được engine.claim() ép laneModel → worker chỉ cần tin persona.
class CompositeRunner implements Runner {
  private claude = new ClaudeRunner(undefined, turnLogger)
  private lane = new LaneRunner(turnLogger)
  async run(card: Card, stage: Stage, persona: Persona, ws: string): Promise<RunResult> {
    // Nếu persona có laneModel (kể cả do engine.claim() ép khi soft) → dùng LaneRunner
    if (persona.laneModel && laneAvailable(persona.laneModel)) return this.lane.run(card, stage, persona, ws)
    // Không có lane → claude -p (opus/sonnet — vẫn chạy, chỉ không rẻ)
    return this.claude.run(card, stage, persona, ws)
  }
}

const mockScript: Record<string, Outcome> = {} // mock → default 'advance' (chỉ test đường truyền)
const runner: Runner = MODE === 'claude' ? new CompositeRunner() : MODE === 'lane' ? new LaneRunner(turnLogger) : new MockRunner(mockScript)

const tag = MODE === 'claude' ? 'composite (claude -p + lát rẻ theo persona.laneModel)' : MODE === 'lane' ? 'lane-only (model rẻ)' : 'MOCK — KHÔNG đốt token (đặt AM_RUNNER=claude để chạy thật)'
console.log(`🛠 Lucy Agent-Machine worker → ${URL}  runner=${tag}  concurrency=${CONCURRENCY}`)
runWorker(URL, runner, { token: TOKEN || undefined, pollMs: Number(process.env.AM_POLL_MS || 800), concurrency: CONCURRENCY }).catch((e) => { console.error(e); process.exit(1) })
