// Autopilot — "Lucy trực đêm": tự đẻ sprint + duyệt thay Bill ở gate.
// Director = claude -p OPUS (điều hướng, single-shot, đọc báo cáo → quyết). KHÔNG tự duyệt
// gate deploy/bảo mật/secret (để Bill). claude -p chạy ở process này (worker/VPS có claude).
import { spawn } from 'node:child_process'
import { resolveClaude } from './claude-bin'
import type { Card, Persona, Pipeline } from './types'

// Gate KHÔNG auto-duyệt (chọn của Bill: "duyệt hết trừ deploy/secret"):
const PROTECTED_PERSONAS = new Set(['devops', 'security'])
const PROTECTED_PIPELINES = new Set(['secure-ship'])
export function isProtectedGate(pipeline: Pipeline | undefined, persona: Persona | undefined): boolean {
  if (persona && PROTECTED_PERSONAS.has(persona.id)) return true
  if (pipeline && PROTECTED_PIPELINES.has(pipeline.id)) return true
  return false
}

// claude -p single-shot (no tools) — Lucy "điều hướng". model mặc định opus (Bill: opus để điều hướng).
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

export function lastJson(text: string): unknown {
  if (!text) return null
  const cands: string[] = [...text.matchAll(/```json\s*([\s\S]*?)```/g)].map((m) => m[1])
  cands.push(text)
  const arr = text.match(/\[[\s\S]*\]/); if (arr) cands.push(arr[0])
  const obj = text.match(/\{[\s\S]*\}/); if (obj) cands.push(obj[0])
  for (const c of cands) { try { return JSON.parse(c.trim()) } catch { /* next */ } }
  return null
}

export interface GateDecision { action: 'approve' | 'return' | 'escalate'; reason: string }
export interface CostDecision { action: 'continue' | 'escalate'; reason: string }

// BỨC TRANH DỰ ÁN — để director hiểu card nằm đâu trong sprint (chống "phán ngáo không thấy toàn cảnh").
const bigPic = (ctx?: string): string => ctx ? `\n📊 TOÀN CẢNH DỰ ÁN (card này nằm trong đây):\n${ctx}\n` : ''

function cardEvidence(card: Card): string {
  const reports = (card.reports || []).slice(-4).map((r) => `### ${r.persona} @ ${r.stage}\n${r.text.slice(0, 1500)}`).join('\n\n')
  const files = card.artifacts?.files?.length ? `\nFILE đổi: ${card.artifacts.files.slice(0, 30).join(', ')}` : ''
  const diff = card.artifacts?.diffstat ? `\nDIFFSTAT:\n${card.artifacts.diffstat.slice(0, 1500)}` : ''
  return (reports || '(không có báo cáo — đáng ngờ)') + files + diff
}

export async function directorDecide(card: Card, stageName: string, ctx?: string): Promise<GateDecision> {
  const hasWork = !!(card.artifacts?.files?.length || (card.reports || []).length)
  const prompt = `Bạn là Lucy — TRỰC ĐÊM duyệt THAY Bill tại 1 checkpoint (gate). Nhìn TOÀN CẢNH dự án rồi quyết.
${bigPic(ctx)}
TASK: ${card.title}
YÊU CẦU (done là gì): ${card.brief}
GATE ở bước: ${stageName}
BÁO CÁO + THAY ĐỔI:
${cardEvidence(card)}

TIÊU CHÍ:
- Agent ĐÃ tạo sản phẩm đúng hướng (file/doc/code + báo cáo hợp lý) → APPROVE. ĐỪNG bắt làm lại cái đã ổn (phí tiền + thời gian).
- Chỉ RETURN khi có LỖI/THIẾU CỤ THỂ (chỉ rõ chỗ nào, cách sửa) — KHÔNG return chỉ vì "chưa chắc".
- Thật sự cần Bill (quyết định lớn / mơ hồ chỉ Bill biết) → ESCALATE.
Trả về DUY NHẤT 1 JSON: {"action":"approve"|"return"|"escalate","reason":"<ngắn gọn>"}`
  for (let i = 0; i < 2; i++) { // retry 1 lần nếu parse fail (chống return-oan vì không đọc được)
    const raw = await claudeOneShot(prompt)
    const j = lastJson(raw) as Partial<GateDecision> | null
    if (j && (j.action === 'approve' || j.action === 'return' || j.action === 'escalate') && typeof j.reason === 'string') return j as GateDecision
  }
  // parse fail 2 lần → KHÔNG return (gây rework đốt tiền oan như case Kurisu 3×) → ESCALATE để Bill xem.
  return { action: 'escalate', reason: hasWork ? 'Director không parse được NHƯNG card đã có sản phẩm → để Bill xem (KHÔNG bắt làm lại phí tiền).' : 'Director không đọc được + card chưa có gì → để Bill.' }
}

// Card kẹt ở waitKind 'decision' (agent hỏi / không trả outcome đúng) → Lucy trả lời/nhích thay Bill.
export async function directorAnswer(card: Card, stageName: string, ctx?: string): Promise<string> {
  const q = card.pendingQuestion || 'Agent chưa kết luận rõ ở bước này.'
  const reports = (card.reports || []).slice(-3).map((r) => `### ${r.persona} @ ${r.stage}\n${r.text.slice(0, 1200)}`).join('\n\n')
  const prompt = `Bạn là Lucy — TRỰC ĐÊM thay Bill. Một agent KẸT ở bước "${stageName}", cần định hướng để tiếp. Nhìn TOÀN CẢNH dự án rồi trả lời.
${bigPic(ctx)}
TASK: ${card.title}
YÊU CẦU: ${card.brief}
TÌNH HUỐNG/CÂU HỎI: ${q}
BÁO CÁO gần đây:
${reports || '(chưa có)'}

Đưa CHỈ DẪN ngắn gọn, cụ thể để agent làm tiếp ĐÚNG hướng (chọn phương án / làm rõ phạm vi / nhắc kết thúc bằng JSON outcome contract). Nếu THỰC SỰ cần Bill → trả đúng chữ "ESCALATE".
Trả về DUY NHẤT 1 dòng (câu trả lời, hoặc ESCALATE).`
  const raw = await claudeOneShot(prompt)
  return (raw || '').replace(/```/g, '').trim().slice(0, 800)
}

// Card đụng cost-cap → Lucy QUẢN TIỀN: continue (đáng, gần xong) hay escalate (loop/lãng phí → Bill). Hard-ceiling check ở poller.
export async function directorCost(card: Card, stageName: string, ctx?: string): Promise<CostDecision> {
  const prompt = `Bạn là Lucy — TRỰC ĐÊM quản TIỀN thay Bill. Card này vượt ngưỡng cost mềm (đã tốn $${(card.cost?.usd || 0).toFixed(2)}). Nhìn TOÀN CẢNH rồi quyết: cấp thêm để tiếp (continue) hay dừng cho Bill xem (escalate)?
${bigPic(ctx)}
TASK: ${card.title}
YÊU CẦU: ${card.brief}
ĐANG Ở bước: ${stageName}
BÁO CÁO + THAY ĐỔI:
${cardEvidence(card)}

TIÊU CHÍ: đang tiến triển tốt + gần xong + KHÔNG loop → continue. Loop/lặp lại/lãng phí/đi lạc → escalate (để Bill).
Trả về DUY NHẤT 1 JSON: {"action":"continue"|"escalate","reason":"<ngắn gọn>"}`
  const raw = await claudeOneShot(prompt)
  const j = lastJson(raw) as Partial<CostDecision> | null
  if (j && (j.action === 'continue' || j.action === 'escalate') && typeof j.reason === 'string') return j as CostDecision
  return { action: 'escalate', reason: 'Director không quyết được cost → để Bill (an toàn về tiền).' }
}

export interface SprintCard { title: string; brief: string; pipelineId: string }

export async function generateSprint(opts: { projectName: string; projectId: string; goal: string; pipelines: string[]; existingTitles: string[] }): Promise<SprintCard[]> {
  const prompt = `Bạn là Okabe — orchestrator của Lucy. Bill giao 1 mục tiêu cho dự án; hãy CHIA thành 3-7 card công việc
ĐỘC LẬP, mỗi card nhỏ gọn (làm trong ~vài bước), chọn ĐÚNG pipeline có sẵn. Brief mỗi card nêu rõ "done là gì".

DỰ ÁN: ${opts.projectName} (id: ${opts.projectId})
MỤC TIÊU: ${opts.goal}
PIPELINE có sẵn (chỉ được chọn trong các id này): ${opts.pipelines.join(', ')}
CARD đã có (ĐỪNG tạo trùng): ${opts.existingTitles.slice(0, 20).join(' | ') || '(chưa có)'}

Trả về DUY NHẤT 1 JSON array (không thêm chữ): [{"title":"...","brief":"...","pipelineId":"<id>"}]`
  const raw = await claudeOneShot(prompt, { timeoutSec: 200 })
  const arr = lastJson(raw)
  if (!Array.isArray(arr)) return []
  const valid = new Set(opts.pipelines)
  return arr
    .filter((c): c is SprintCard => !!c && typeof c.title === 'string' && typeof c.brief === 'string' && valid.has(c.pipelineId))
    .slice(0, 10)
}
