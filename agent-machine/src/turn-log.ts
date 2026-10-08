// turn-log.ts — ghi per-turn log ra JSONL (pattern appendLedger).
// Opt-in qua env AM_TURNS_LOG. Không set = no-op (không ảnh hưởng perf).
import fs from 'node:fs'
import path from 'node:path'
import type { Decision } from './types'

// ── Constants ──
const MAX_MOTIVE = 200
const MAX_OUTCOME = 500

// ── TurnRecord: mỗi dòng JSONL ──
export type TurnRecord = {
  agent: string       // persona.id
  task: string        // card.id
  stage: string       // stage.id
  motive: string      // agent đang định làm gì
  action: 'tool_call' | 'text' | 'outcome' | 'error'
  outcome: string     // outcome.summary hoặc error message (rỗng nếu không có)
  turnCount: number   // 0-based
  token: number       // inTok + outTok của turn này
  decision?: Decision // chỉ ở record action:'outcome' — phân biệt outcome lỗi (fail/rework) với thành công.
                      // Optional: dòng JSONL cũ thiếu field vẫn parse — mở rộng tương thích ngược.
  model?: string      // model THỰC chạy lane lúc ghi (persona.laneModel || 'executor'). Ghi tại NGUỒN vì
                      // TokenGuard SOFT có thể hạ cấp model ≠ config → consumer không suy lại được từ persona.
                      // Optional: cùng lý do tương thích ngược với dòng JSONL cũ thiếu field.
}

// ── Centralized truncation ──
function truncate(s: string, max: number): string {
  if (s.length <= max) return s
  return s.slice(0, max) + '…'
}

// ── Interface ──
export interface TurnLogger {
  log(rec: TurnRecord): void
}

// ── NoopTurnLogger: env AM_TURNS_LOG không set → im lặng ──
export class NoopTurnLogger implements TurnLogger {
  log(_rec: TurnRecord): void {}
}

// ── FileTurnLogger: ghi file, fire-and-forget (không blocking) ──
class FileTurnLogger implements TurnLogger {
  private file: string
  constructor(dir: string) {
    this.file = path.join(dir, 'turn-log.jsonl')
    fs.mkdirSync(dir, { recursive: true })
  }
  log(rec: TurnRecord): void {
    try {
      // Truncate tập trung — caller không cần tự cắt
      const entry: TurnRecord = {
        ...rec,
        motive: truncate(rec.motive, MAX_MOTIVE),
        outcome: truncate(rec.outcome, MAX_OUTCOME),
      }
      fs.appendFileSync(this.file, JSON.stringify(entry) + '\n')
    } catch {
      // turn log không critical — nuốt lỗi ghi để không hỏng turn
    }
  }
}

// ── Factory ──
export function createTurnLogger(): TurnLogger {
  const dir = process.env.AM_TURNS_LOG
  if (!dir) return new NoopTurnLogger()
  return new FileTurnLogger(dir)
}
