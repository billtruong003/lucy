// triage.ts — Lucy triage/split khi card kẹt (stuck-detector).
// Opus đọc card.history + reports → quyết: split subtask / nâng model / escalate Bill.
// pattern: autopilot.ts (claudeOneShot + lastJson).
import { spawn } from 'node:child_process'
import { resolveClaude } from './claude-bin'
import { lastJson } from './autopilot'
import type { Card } from './types'

export type TriageAction = 'split' | 'upgrade' | 'escalate'

export interface TriageDecision {
  action: TriageAction
  reason: string
  /** (a) Split: 2-3 subtask atomic, mỗi cái blockedBy card hiện tại */
  subtasks?: { title: string; brief: string }[]
  /** (b) Nâng model lên opus */
  upgradeTo?: 'opus'
}

// claude -p single-shot (opus) — pattern identical to autopilot.ts.
function claudeOneShot(prompt: string, opts: { model?: string; timeoutSec?: number } = {}): Promise<string> {
  const model = opts.model || process.env.AM_DIRECTOR_MODEL || 'opus'
  const timeoutSec = opts.timeoutSec ?? 150
  return new Promise((resolve) => {
    const r = resolveClaude(process.env.CLAUDE_BIN || 'claude')
    const args = ['-p', '--output-format', 'json', '--permission-mode', 'bypassPermissions', '--model', model, '--max-turns', '1']
    const o = { env: { ...process.env, IS_SANDBOX: '1' }, stdio: ['pipe', 'pipe', 'pipe'] as ['pipe', 'pipe', 'pipe'] }
    const ch = r.shell ? spawn([r.bin, ...args].map((a) => `"${a}"`).join(' '), { ...o, shell: true }) : spawn(r.bin, args, o)
    let out = ''
    const timer = setTimeout(() => ch.kill(), timeoutSec * 1000)
    ch.stdout.on('data', (d) => (out += d))
    ch.on('close', () => { clearTimeout(timer); try { resolve(JSON.parse(out).result ?? out) } catch { resolve(out) } })
    ch.on('error', () => { clearTimeout(timer); resolve('') })
    ch.stdin.on('error', () => { /* EPIPE */ })
    ch.stdin.write(prompt); ch.stdin.end()
  })
}

/** Trích xuất narrative từ reports + history để opus hiểu bối cảnh. */
function cardNarrative(card: Card): string {
  const reports = (card.reports || []).slice(-4).map((r) =>
    `[${r.persona} @ ${r.stage}]\n${r.text.slice(0, 2000)}`
  ).join('\n\n')
  const reworks = card.history.filter((h) => h.event === 'rework' || h.event === 'reject-rework' || h.event === 'verify-fail')
    .slice(-5).map((h) => `  - ${h.stage}: ${(h.detail || '').slice(0, 300)}`).join('\n')
  const visits = card.stageVisits ? Object.entries(card.stageVisits).map(([s, n]) => `  - ${s}: ${n} lần`).join('\n') : '(chưa có)'
  const cost = `$${(card.cost?.usd || 0).toFixed(3)} (${(card.cost?.inTok || 0).toLocaleString()} in / ${(card.cost?.outTok || 0).toLocaleString()} out tok)`
  return `COST: ${cost}\nSTAGE VISITS:\n${visits}\nREWORDS/FAILS:\n${reworks || '(chưa có)'}\n\nREPORTS:\n${reports || '(chưa có báo cáo)'}`
}

/**
 * Phân tích card kẹt và đưa ra quyết định triage.
 * (a) Split: 2-3 subtask atomic có blockedBy → re-delegate
 * (b) Nâng model: card dùng sonnet → ép opus
 * (c) Escalate: báo Bill kèm lý do
 */
export async function triageCard(card: Card, stageName: string): Promise<TriageDecision> {
  const narrative = cardNarrative(card)
  const prompt = `Bạn là Lucy — quản lý task. Một card ĐANG KẸT (stuck) ở stage "${stageName}", nhiều lần rework/fail vẫn không qua. Hãy phân tích và chọn 1 trong 3 hướng:

NHIỆM VỤ GỐC: ${card.title}
YÊU CẦU: ${card.brief}

LỊCH SỬ + BÁO CÁO:
${narrative}

3 HƯỚNG XỬ LÝ (chọn 1):
(a) **split** — Chia card này thành 2-3 subtask NHỎ HƠN, ĐỘC LẬP (mỗi cái làm được riêng, không phụ thuộc nhau). Mỗi subtask có title + brief riêng. Dùng khi card quá to / mơ hồ / có thể tách thành việc nhỏ hơn.
(b) **upgrade** — Nâng model từ sonnet lên opus (chỉ khi đang dùng sonnet mà kẹt vì phức tạp). 
(c) **escalate** — Báo Bill (chủ nhân) xem, kèm lý do tại sao không tự xử được. Dùng khi không rõ hướng / cần quyết định chủ quan / nguy hiểm.

Trả về DUY NHẤT 1 JSON theo schema:
{"action":"split","reason":"<lý do>","subtasks":[{"title":"...","brief":"..."}]}
HOẶC {"action":"upgrade","reason":"<lý do>"}
HOẶC {"action":"escalate","reason":"<lý do>"}`

  for (let i = 0; i < 2; i++) {
    const raw = await claudeOneShot(prompt)
    const j = lastJson(raw) as Partial<TriageDecision> | null
    if (!j || typeof j.action !== 'string') continue
    if (j.action === 'split' && Array.isArray(j.subtasks) && j.subtasks.length >= 1 && typeof j.reason === 'string') {
      return { action: 'split', reason: j.reason, subtasks: j.subtasks.slice(0, 3) }
    }
    if (j.action === 'upgrade' && typeof j.reason === 'string') {
      return { action: 'upgrade', reason: j.reason, upgradeTo: 'opus' }
    }
    if (j.action === 'escalate' && typeof j.reason === 'string') {
      return { action: 'escalate', reason: j.reason }
    }
  }
  // parse fail 2 lần → escalate để Bill xem (an toàn, không tự ý split/upgrade)
  return { action: 'escalate', reason: 'Triage không parse được quyết định → để Bill xem.' }
}
