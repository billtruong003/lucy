// ⚠️ 4 FILE "lane" tên gần giống — ĐỪNG sửa nhầm: lane-runner=chạy 1 stage card (file này) ·
//    chat-lane=routing+chat primitive · lane-chat=vòng agentic tool cho chat · llm-lane=lát API provider.
// LaneRunner — chạy 1 stage bằng MODEL RẺ (OpenRouter/OpenCode-Zen…) qua lát API in-house.
// Cho model rẻ "tay" (read/write/edit/bash trong workspace) bằng OpenAI tool-calling → agentic
// như claude -p nhưng tốn ít token tiền. claude -p giữ cho orchestrator/critic (opus).
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import type { Runner } from './runner'
import { buildSystemPrompt, cleanReport, salvageOutcome } from './runner'
import { callLLMRaw, RateLimitError, type RawMsg, type ToolDef } from './llm-lane'
import type { Card, Stage, Persona, RunResult, Outcome, Cost } from './types'
import { NoopTurnLogger, type TurnLogger } from './turn-log'
// CL-2: tool registry thống nhất (flag LUCY_TOOL_REGISTRY, default OFF → vẫn dùng ALL_TOOLS/execTool cũ).
import { toolRegistryEnabled, getLaneToolDefs, dispatchTool } from './tools/registry'
import { registerLaneTools } from './tools/lane-tools'

// Tool → quyền cần (map persona.allowedTools kiểu claude → tool lane). Least-privilege giữ nguyên.
const TOOL_PERM: Record<string, string> = { read_file: 'Read', list_dir: 'Read', write_file: 'Write', edit_file: 'Edit', bash: 'Bash' }

const ALL_TOOLS: ToolDef[] = [
  { type: 'function', function: { name: 'read_file', description: 'Đọc nội dung 1 file trong workspace.', parameters: { type: 'object', properties: { path: { type: 'string', description: 'đường dẫn tương đối workspace' } }, required: ['path'] } } },
  { type: 'function', function: { name: 'list_dir', description: 'Liệt kê file/thư mục.', parameters: { type: 'object', properties: { path: { type: 'string', description: 'mặc định "."' } } } } },
  { type: 'function', function: { name: 'write_file', description: 'Ghi/đè 1 file (tạo thư mục cha nếu thiếu).', parameters: { type: 'object', properties: { path: { type: 'string' }, content: { type: 'string' } }, required: ['path', 'content'] } } },
  { type: 'function', function: { name: 'edit_file', description: 'Thay old_string → new_string trong file (old_string phải khớp đúng).', parameters: { type: 'object', properties: { path: { type: 'string' }, old_string: { type: 'string' }, new_string: { type: 'string' } }, required: ['path', 'old_string', 'new_string'] } } },
  { type: 'function', function: { name: 'bash', description: 'Chạy lệnh shell trong workspace (build/test/grep/git status…). Không git push, không đụng ngoài workspace.', parameters: { type: 'object', properties: { cmd: { type: 'string' } }, required: ['cmd'] } } },
]

function S(a: Record<string, unknown>, k: string): string { const v = a[k]; return typeof v === 'string' ? v : v == null ? '' : String(v) }

function safePath(ws: string, p: string): string {
  const root = path.resolve(ws)
  const abs = path.resolve(ws, p)
  if (abs !== root && !abs.startsWith(root + path.sep)) throw new Error('đường dẫn ngoài workspace — bị chặn')
  return abs
}

function runBash(cmd: string, ws: string): Promise<string> {
  return new Promise((resolve) => {
    const ch = spawn(cmd, { cwd: ws, shell: true, env: { ...process.env, IS_SANDBOX: '1' } })
    let out = ''
    const timer = setTimeout(() => ch.kill(), 120000)
    ch.stdout.on('data', (d) => (out += d))
    ch.stderr.on('data', (d) => (out += d))
    ch.on('close', (code) => { clearTimeout(timer); resolve(((out || '(no output)').slice(0, 8000)) + (code ? `\n[exit ${code}]` : '')) })
    ch.on('error', (e) => { clearTimeout(timer); resolve(`ERROR spawn: ${e}`) })
  })
}

async function execTool(name: string, args: Record<string, unknown>, ws: string, allowed: Set<string>): Promise<string> {
  const need = TOOL_PERM[name]
  if (!need) return `ERROR: tool lạ "${name}"`
  if (!allowed.has(need)) return `ERROR: persona không được phép tool "${name}" (${need})`
  switch (name) {
    case 'read_file': { const c = fs.readFileSync(safePath(ws, S(args, 'path')), 'utf8'); return c.length > 30000 ? c.slice(0, 30000) + '\n…(cắt bớt)' : c }
    case 'list_dir': { const d = safePath(ws, S(args, 'path') || '.'); return fs.readdirSync(d, { withFileTypes: true }).map((e) => e.isDirectory() ? e.name + '/' : e.name).join('\n') || '(rỗng)' }
    case 'write_file': { const p = safePath(ws, S(args, 'path')); fs.mkdirSync(path.dirname(p), { recursive: true }); const c = S(args, 'content'); fs.writeFileSync(p, c); return `đã ghi ${S(args, 'path')} (${c.length} ký tự)` }
    case 'edit_file': { const p = safePath(ws, S(args, 'path')); const cur = fs.readFileSync(p, 'utf8'); const o = S(args, 'old_string'); if (!cur.includes(o)) return `ERROR: không thấy old_string trong ${S(args, 'path')}`; fs.writeFileSync(p, cur.replace(o, S(args, 'new_string'))); return `đã sửa ${S(args, 'path')}` }
    case 'bash': return runBash(S(args, 'cmd'), ws)
    default: return `ERROR: tool lạ "${name}"`
  }
}

// parse khối json outcome cuối → null nếu chưa có (để nudge tiếp, đừng dừng sớm).
function tryOutcome(text: string): Outcome | null {
  const blocks = [...text.matchAll(/```json\s*([\s\S]*?)```/g)].map((m) => m[1])
  // không có fence → thử tìm object có "decision" ở cuối
  if (!blocks.length) { const m = text.match(/\{[\s\S]*"decision"[\s\S]*\}\s*$/); if (m) blocks.push(m[0]) }
  const last = blocks.pop()
  if (!last) return null
  try { const o = JSON.parse(last) as Outcome; return o.decision ? o : null } catch { return null }
}

const LANE_NOTE = `

---
BẠN CHẠY QUA LÁT API (model rẻ) — có tool: read_file · list_dir · write_file · edit_file · bash. PHẢI dùng tool để
ĐỌC/KHẢO SÁT trước rồi mới sửa; tự chạy build/test bằng bash để verify. Xong việc bước này → trả khối JSON outcome (KHÔNG kèm tool_call).`

export class LaneRunner implements Runner {
  private turnLogger: TurnLogger
  constructor(turnLogger?: TurnLogger) {
    this.turnLogger = turnLogger ?? new NoopTurnLogger()
  }

  async run(card: Card, stage: Stage, persona: Persona, ws: string): Promise<RunResult> {
    const model = persona.laneModel || 'executor'
    const sys = buildSystemPrompt(card, persona, LANE_NOTE, model) // HQ-1: dẫn theo HỌ model lane THẬT (gpt/gemini/khác)
    const notes = card.reviewNotes?.length ? `\n\n⚠️ PHẢN HỒI cần SỬA:\n- ${card.reviewNotes.join('\n- ')}` : ''
    const prev = card.lastSummary ? `\n\n↪ Bước TRƯỚC: ${card.lastSummary}\n(đọc kết quả bước trước trong workspace, nối tiếp.)` : ''
    const user = `Card: ${card.title}\n\n${card.brief}\n\nStage hiện tại: ${stage.name}.${prev}${notes}`
    const allowed = new Set(persona.allowedTools ?? ['Read', 'Write', 'Edit', 'Bash'])
    // CL-2: flag ON → ToolDef từ registry (1 nguồn), lọc theo quyền persona y như cũ; OFF → ALL_TOOLS hard-code.
    const useRegistry = toolRegistryEnabled()
    if (useRegistry) registerLaneTools()
    const tools = (useRegistry ? getLaneToolDefs('lucy-runner') : ALL_TOOLS).filter((t) => allowed.has(TOOL_PERM[t.function.name]))
    const messages: RawMsg[] = [{ role: 'system', content: sys }, { role: 'user', content: user }]
    const cost: Cost = { usd: 0, inTok: 0, outTok: 0 } // model lane free → $0; vẫn đếm token
    const maxTurns = persona.maxTurns ?? 16
    let raw = ''
    for (let i = 0; i < maxTurns; i++) {
      let r
      try { r = await callLLMRaw(model, messages, { tools, maxTokens: 4096, timeoutMs: 90000 }) }
      catch (e) {
        const errMsg = String(e instanceof Error ? e.message : e).slice(0, 200)
        this.turnLogger.log({ agent: persona.id, model, task: card.id, stage: stage.id, motive: 'callLLMRaw thất bại', action: 'error', outcome: errMsg, turnCount: i, token: 0 })
        if (e instanceof RateLimitError) {
          return { outcome: { decision: 'fail', summary: `rate-limit — park ${Math.round(e.retryAfterMs / 1000)}s` }, cost, raw, rateLimit: { retryAfterMs: e.retryAfterMs, detail: errMsg } }
        }
        return { outcome: { decision: 'fail', summary: `lane lỗi: ${errMsg}` }, cost, raw }
      }
      const inTok = r.usage?.prompt_tokens ?? 0
      const outTok = r.usage?.completion_tokens ?? 0
      cost.inTok += inTok
      cost.outTok += outTok
      const msg = r.message
      messages.push({ role: 'assistant', content: msg.content ?? '', tool_calls: msg.tool_calls })
      if (msg.tool_calls?.length) {
        const firstTool = msg.tool_calls[0].function.name
        this.turnLogger.log({ agent: persona.id, model, task: card.id, stage: stage.id, motive: `dùng ${firstTool}`, action: 'tool_call', outcome: '', turnCount: i, token: inTok + outTok })
        for (const tc of msg.tool_calls) {
          let out: string
          // CL-2: dispatch qua registry khi flag ON (gate quyền + sandbox theo ctx.mode='runner'); OFF → execTool cũ.
          try {
            const a = JSON.parse(tc.function.arguments || '{}') as Record<string, unknown>
            out = useRegistry ? await dispatchTool(tc.function.name, a, { ws, mode: 'runner', allowed }) : await execTool(tc.function.name, a, ws, allowed)
          }
          catch (e) { out = `ERROR: ${String(e instanceof Error ? e.message : e)}` }
          messages.push({ role: 'tool', tool_call_id: tc.id, content: out.slice(0, 8000) })
        }
        continue
      }
      raw = msg.content ?? ''
      const oc = tryOutcome(raw)
      if (oc) {
        this.turnLogger.log({ agent: persona.id, model, task: card.id, stage: stage.id, motive: raw.replace(/\n/g, ' '), action: 'outcome', outcome: oc.summary, turnCount: i, token: inTok + outTok, decision: oc.decision })
        return { outcome: oc, cost, raw, report: cleanReport(raw) }
      }
      // không tool, chưa có outcome → text turn
      this.turnLogger.log({ agent: persona.id, model, task: card.id, stage: stage.id, motive: raw.replace(/\n/g, ' '), action: 'text', outcome: '', turnCount: i, token: inTok + outTok })
      // nhắc tiếp (chống dừng sớm khi model chỉ "nói")
      messages.push({ role: 'user', content: 'Tiếp tục: dùng tool nếu chưa xong, hoặc nếu đã xong bước này thì kết thúc bằng ĐÚNG khối JSON outcome.' })
    }
    // hết turn → SALVAGE từ output thô (agent thường ĐÃ làm, chỉ quên JSON) trước khi đẩy người.
    const report = cleanReport(raw)
    const outcome = report.length > 20
      ? await salvageOutcome(report, stage.name)
      : { decision: 'needs_decision' as const, summary: `Lane agent (${model}) hết ${maxTurns} turn chưa ra gì`, question: 'Executor chạy hết turn mà chưa ra outcome — cần bạn xem.' }
    // turn terminal: agent kẹt hết maxTurns không tự ra outcome — đúng ca card cần trace.
    this.turnLogger.log({ agent: persona.id, model, task: card.id, stage: stage.id, motive: `hết ${maxTurns} turn — ${report.length > 20 ? 'salvage' : 'không ra gì'}`, action: 'outcome', outcome: outcome.summary, turnCount: maxTurns, token: 0, decision: outcome.decision })
    return { outcome, cost, raw, report }
  }
}
