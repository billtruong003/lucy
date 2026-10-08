// Runner — thực thi 1 stage. Interface để swap Mock (free) <-> Claude thật <-> remote worker.
import fs from 'node:fs'
import path from 'node:path'
import { query } from '@anthropic-ai/claude-agent-sdk'  // Đường B: thực thi stage in-process (thay spawn claude -p)
import { loadSkillBlock } from './skill-loader'
import { mcpConfigFor, mcpAllowedTools } from './mcp-registry'
import { readAgentBrain } from './agent-brain'
import { buildHookOptions } from './tool-hooks'  // CL-1: guard + telemetry hooks (flag LUCY_HOOKS, default OFF)
import { toolRegistryEnabled, getToolManifest } from './tools/registry'  // CL-2: manifest self-awareness (flag LUCY_TOOL_REGISTRY, default OFF)
import { registerLaneTools } from './tools/lane-tools'
import { NoopTurnLogger, type TurnLogger } from './turn-log'
import type { Card, Stage, Persona, RunResult, Outcome, Cost } from './types'

export interface Runner {
  run(card: Card, stage: Stage, persona: Persona, ws: string): Promise<RunResult>
}

// ── MockRunner: outcome theo stage.id — CHỨNG MINH loop, KHÔNG đốt token ──
export class MockRunner implements Runner {
  script: Record<string, Outcome>
  cost: Cost
  constructor(script: Record<string, Outcome>, cost: Cost = { usd: 0.02, inTok: 1200, outTok: 400 }) {
    this.script = script
    this.cost = cost
  }
  async run(card: Card, stage: Stage, persona: Persona, _ws: string): Promise<RunResult> {
    await new Promise((r) => setTimeout(r, 30))
    const outcome = this.script[stage.id] ?? { decision: 'advance', summary: `(${persona.name}) xong "${stage.name}"` }
    return { outcome, cost: this.cost, raw: '[mock]', report: `[mock] ${persona.name} @ ${stage.name}: ${outcome.summary}`, sessionId: `mock-${card.id}-${persona.id}` }
  }
}

// ── ClaudeRunner: spawn claude -p THẬT. Không dùng trong demo mặc định (đốt token). ──
export const OUTCOME_CONTRACT = `

---
QUY TẮC KẾT THÚC (BẮT BUỘC): bạn chỉ đang làm 1 BƯỚC trong quy trình nhiều bước. Làm xong phần việc của
BƯỚC HIỆN TẠI thì kết thúc câu trả lời bằng ĐÚNG MỘT khối JSON (không thêm chữ nào sau nó):
\`\`\`json
{"decision":"advance|rework|needs_decision|delegate|fail","summary":"tóm tắt 1 câu","question":"(chỉ khi needs_decision)"}
\`\`\`
- "advance" = xong việc bước này, CHUYỂN sang bước kế (DÙNG mặc định khi hoàn thành tốt — KHÔNG tự kết thúc cả quy trình).
- "rework" = (review/test) PHÁT HIỆN LỖI / CHƯA ĐẠT → TRẢ LẠI bước trước sửa. BẮT BUỘC liệt kê vấn đề cụ thể (file:dòng + cách sửa) trong summary.
- "needs_decision" = cần người quyết · "delegate" = nhờ persona khác · "fail" = hỏng nặng không cứu được.

VERIFY-TRƯỚC-KHI-XONG (BẮT BUỘC cho "advance"): chỉ báo "advance" SAU KHI đã CHỨNG MINH việc chạy được — tự chạy tsc/test/build/curl hoặc ĐỌC LẠI output/file vừa tạo bằng tool, rồi nêu BẰNG CHỨNG cụ thể trong summary (lệnh đã chạy + kết quả thật, vd "tsc 0 lỗi", "smoke 12/12", "curl 200"). CẤM "mô tả suông"/khai xong khi CHƯA chạy verify. Verify fail mà không sửa nổi → "rework" hoặc "fail", KHÔNG "advance".`

// HOUSE_SKILL — kỷ luật kỹ sư UNIVERSAL gắn cho MỌI persona (chắt từ bộ SKILL.md chuẩn
// của Bill: arena-server/arena-unity + SOUL Hermes). Phần identity/domain riêng nằm ở persona.
export const HOUSE_SKILL = `

---
KỶ LUẬT KỸ SƯ (áp dụng MỌI việc):

ĐỌC TRƯỚC KHI LÀM:
- Repo có sẵn: đọc cấu trúc + file/spec/doc liên quan TRƯỚC. BÁM stack/convention/style đang có — KHÔNG bịa shape mới, KHÔNG đổi tên field/contract đang dùng, KHÔNG áp framework lạ. Tôn trọng contract (API/schema/interface) như luật.

NGUYÊN TẮC CODE:
- Strict: không 'any' (dùng 'unknown' + narrow). Validate input ở biên. Không magic number — hằng số đặt tên. Lỗi thì throw, KHÔNG nuốt im. Comment giải thích TẠI SAO, không phải CÁI GÌ.
- Làm ĐÚNG phạm vi, KHÔNG over-engineer, KHÔNG dependency/abstraction thừa. "Đơn giản đủ dùng" > "tổng quát hoành tráng".

DEFINITION OF DONE (tự verify TRƯỚC khi báo xong):
- Biên dịch sạch (typecheck), test xanh nếu có, build chạy; chạy thử bằng Bash khi làm được. KHÔNG báo "xong" nếu chưa tự kiểm.

CHỐNG BỊA (cứng):
- Chưa chắc -> KIỂM TRA (đọc file, ls, grep, chạy thử) rồi mới nói. KHÔNG giả định API/đường dẫn/hàm tồn tại. KHÔNG bịa số liệu/kết quả. Gặp lỗi -> đọc output lỗi THẬT để báo, không chế nguyên nhân.

AN TOÀN (cứng):
- CHỈ thao tác trong workspace hiện tại. Không xoá/sửa ngoài, không 'rm -rf' bừa, không 'git push', không log/đụng secret/token. Việc phá huỷ hoặc quyết định chủ quan (đổi contract, giá trị tuning) -> DỪNG hỏi (needs_decision), đừng tự quyết.

GIAO TIẾP: gọn, thẳng việc. Báo cuối = 2-3 câu (làm gì + verify ra sao), không tự tâng. Kẹt -> nêu blocker + 2 lựa chọn + đề xuất.

GHI GÌ vs KHÔNG GHI (phân biệt trước khi lưu):
- MEMORY = sự thật BỀN về Bill / môi trường / sở thích lặp lại (vd "Bill là game dev Unity", "VPS chặn IP Telegram", "Bill muốn báo cáo gọn") → đáng ghi.
- SKILL = cách-làm TÁI DÙNG được cho việc sau (quy trình/pattern/checklist) → đáng ghi.
- KHÔNG GHI: trạng thái tạm / tiến độ task / số PR / tên branch / lỗi nhất thời / kết quả 1-lần. Những thứ này hết phiên là vô nghĩa — ghi vào = nhiễu recall. Nghi ngờ → KHÔNG ghi.

TRÍ NHỚ (nếu thấy thư mục lucy-vault/ trong dir được phép):
- TRƯỚC khi làm: đọc lucy-vault/Context/ (Bill là ai) + lucy-vault/Projects/<dự án liên quan> để bám bối cảnh — ĐỪNG hỏi lại cái đã ghi.
- Học được điều đáng nhớ (sở thích Bill / quyết định / pattern lặp lại) -> tạo file lucy-vault/Brain/inbox/sig-<YYYY-MM-DD>-<slug>.md ĐÚNG khung sau (sai format = hệ bỏ qua im lặng):
---
kind: brain-signal
id: sig-<YYYY-MM-DD>-<slug-ngắn>
created_at: <ISO-8601 UTC, vd 2026-06-11T08:00:00.000Z>
topic: <projectId>/<pattern-chung-kebab>
signal: positive|negative
agent: lucy
principle: <quy tắc 1 câu, dạng hành động>
evidenced_by: [<cardId nếu biết>]
---
  topic phần sau "/" = PATTERN CHUNG card khác cũng dính được (vd "hardcode-config") — KHÔNG phải tên card. KHÔNG ghi lỗi môi trường/transient/chuyện 1 lần.
- KHÔNG sửa lucy-vault/Brain/preferences/ hay active.md (máy quản). CẤM ghi trí nhớ vào auto-memory built-in của Claude Code (~/.claude/**/memory/) — vault là não DUY NHẤT, ghi chỗ khác = lạc trôi khỏi recall/dream.`

// HQ-1 — Dẫn theo HỌ MODEL. Pure fn (model→string), deterministic → cache-stable (model ổn định theo persona).
// Phân họ theo chuỗi model: claude (sonnet/opus/haiku) vs lane rẻ (gpt/gemini/khác).
export function modelFamily(model: string): 'claude' | 'gpt' | 'gemini' | 'other' {
  const m = (model || '').toLowerCase()
  if (/sonnet|opus|haiku|claude/.test(m)) return 'claude'
  if (/gpt|\bo1\b|\bo3\b|\bo4\b/.test(m)) return 'gpt'
  if (/gemini/.test(m)) return 'gemini'
  return 'other'
}

// Khối dẫn ngắn theo họ model — chỉ thêm chuỗi TĨNH, không nhúng biến động (giữ prompt-cache parity).
export function modelGuidance(model: string): string {
  if (modelFamily(model) === 'claude') return `

---
CÁCH LÀM (lane Claude): FINISH-THE-JOB — làm tới khi việc THỰC SỰ xong, không dừng nửa chừng. Verify bằng kết quả THẬT (chạy tsc/test/build/curl, đọc lại file vừa sửa), KHÔNG mô tả suông. Đọc kỹ trước, sửa đúng GỐC (không vá tạm/workaround che lỗi). Việc nhiều bước → tự bám tới cùng, đừng đẩy lại người.`
  const fam = modelFamily(model)
  const tag = fam === 'gpt' ? 'GPT' : fam === 'gemini' ? 'Gemini' : 'model rẻ'
  return `

---
CÁCH LÀM (lane ${tag}): súc tích, đi thẳng việc. Thao tác file PHẢI dùng ĐƯỜNG DẪN TUYỆT ĐỐI (không tương đối mơ hồ). BẮT BUỘC gọi tool để đọc/sửa/verify — đừng ĐOÁN nội dung file hay kết quả. Mỗi lượt làm 1 bước rõ ràng, không ôm đồm nhiều việc cùng lúc.`
}

// Ráp system prompt agent. 1 NGUỒN DUY NHẤT cho ClaudeRunner & LaneRunner.
// C1 (Đợt C) PROMPT-CACHE PARITY: nối theo độ-BIẾN-ĐỘNG tăng dần → prefix dài ổn định = trúng prefix-cache (~25% rẻ).
//   TĨNH-toàn-cục (HOUSE_SKILL, OUTCOME_CONTRACT) → TĨNH-theo-persona (systemPrompt) → ổn-định-theo-card (skill)
//   → ĐỘNG (digest dream đổi ~ngày, brain nghề đổi mỗi lần học). Phần đổi nằm CUỐI → chỉ tail bị tính lại, đầu vẫn cache.
//   (Trước đây để digest+brain Ở ĐẦU → đổi xoành xoạch = cache MISS mỗi stage. Đảo lại = ROI cao, gần free.)
// effModel: model THẬT của lượt chạy (claude-path = persona.model tier; lane-path = persona.laneModel).
// modelGuidance đặt SAU OUTCOME_CONTRACT, TRƯỚC persona body → vẫn nằm trong khối TĨNH-theo-persona (cache-stable).
export function buildSystemPrompt(card: Card, persona: Persona, extra = '', effModel: string = persona.model): string {
  // CL-2: manifest "Lucy biết mình có tool gì" — STATIC (đặt trong prefix theo-persona, TRƯỚC digest/brain động → giữ prompt-cache).
  //        flag LUCY_TOOL_REGISTRY OFF → '' → prompt y hệt cũ (forward-only).
  let manifest = ''
  if (toolRegistryEnabled()) { registerLaneTools(); manifest = getToolManifest() }
  return HOUSE_SKILL + OUTCOME_CONTRACT + modelGuidance(effModel) + persona.systemPrompt + manifest + loadSkillBlock(card) + readActiveDigest() + readAgentBrain(persona.id) + extra
}

export class ClaudeRunner implements Runner {
  bin: string
  turnLogger: TurnLogger
  constructor(bin = process.env.CLAUDE_BIN || 'claude', turnLogger: TurnLogger = new NoopTurnLogger()) {
    this.bin = bin
    this.turnLogger = turnLogger
  }

  async run(card: Card, stage: Stage, persona: Persona, ws: string): Promise<RunResult> {
    const personaFile = path.join(ws, '.persona.md')
    // TRÍ NHỚ: prepend digest preference Lucy ĐÃ HỌC (Brain/active.md do dream sinh) vào ĐẦU system prompt.
    // Strip dòng timestamp "Cập nhật:" → prefix byte-ổn định giữa các lượt (giữ prompt-cache parity).
    const systemPrompt = buildSystemPrompt(card, persona)
    fs.writeFileSync(personaFile, systemPrompt)   // giữ để debug; SDK nhận chuỗi trực tiếp qua appendSystemPrompt
    // C3.1: reviewNotes slice(-3) — chỉ 3 ghi chú gần nhất vào prompt, tránh phình khi rework nhiều lần
    const recentNotes = card.reviewNotes?.slice(-3) ?? []
    const notes = recentNotes.length ? `\n\n⚠️ PHẢN HỒI cần SỬA (bị trả lại — fix kỹ những điểm này):\n- ${recentNotes.join('\n- ')}` : ''
    const prev = card.lastSummary ? `\n\n↪ Bước TRƯỚC đã làm: ${card.lastSummary}\n(đọc kết quả bước trước trong workspace, nối tiếp — đừng làm lại từ đầu.)` : ''
    // C3.2: brief truncation khi rework (≥ 2 lần cùng stage) — workspace đã có context, brief dài chỉ phình token
    const stageVisitCount = card.stageVisits?.[stage.id] ?? 0
    const briefText = stageVisitCount >= 2 && card.brief.length > 800
      ? card.brief.slice(0, 800) + `\n...[còn ${card.brief.length - 800} ký tự — workspace có context đủ, đọc file nếu cần]`
      : card.brief
    const prompt = `Card: ${card.title}\n\n${briefText}\n\nStage hiện tại: ${stage.name}.${prev}${notes}`
    // TRÍ NHỚ: cho agent đọc/ghi vault bền (Lucy "biết" Bill + dự án xuyên phiên). Vault ổn định mọi stage → giữ prompt-cache parity.
    const v = process.env.LUCY_VAULT
    const vault = v && fs.existsSync(v) ? v : undefined
    // M2 "TAY": mount MCP server per-persona (filesystem/web/git/memory). Master flag tắt → {} (chạy y hệt cũ).
    const mcpServers = mcpConfigFor(persona, { workspace: ws, repoRoot: ws, vault })
    const allowedTools = [...(persona.allowedTools ?? ['Read', 'Write', 'Edit', 'Bash']), ...mcpAllowedTools(mcpServers)]
    const maxTurns = persona.maxTurns ?? 12   // cap turn = chặn đốt token/thời gian. Persona tự khai trong config.
    const timeoutSec = persona.timeoutSec ?? 300
    // CACHE: cùng (card, persona, stage) chạy lại (rework) → resume session cũ để agent NHỚ đã đọc/sửa gì, KHỎI quét lại project (đỡ token).
    // Key kèm stageIndex: cùng persona ở stage khác nhau KHÔNG resume nhầm session (C3.3).
    const resumeId = card.sessions?.[`${persona.id}:${card.stageIndex}`]
    // CL-1: nhãn cho telemetry hooks (chỉ dùng khi LUCY_HOOKS=1; flag OFF → buildHookOptions bỏ qua hết).
    const hookCtx = { task: card.id, agent: persona.id, stage: stage.id }
    const sdkOpts = { prompt, ws, timeoutSec, model: persona.model, appendSystem: systemPrompt, allowedTools, maxTurns, vault, mcpServers, hookCtx }
    let r = await this.runSdk({ ...sdkOpts, resumeId })
    if (resumeId && r.code !== 0) r = await this.runSdk(sdkOpts) // resume hỏng (session ở máy khác / đã xoá) → chạy mới
    const res = parseClaude(r.out)
    // SALVAGE: agent làm xong nhưng quên JSON → suy ra outcome thay vì bounce/loop (gặp nhiều).
    if (res.outcome.summary === NO_JSON) res.outcome = await salvageOutcome(res.report || res.raw, stage.name)
    // Turn log (1 record/run) — đủ cho error-stats phân loại outcome/decision
    const common = { agent: persona.id, task: card.id, stage: stage.id, model: persona.model, turnCount: 0, token: res.cost.inTok + res.cost.outTok }
    if (r.code !== 0 && !res.report) {
      this.turnLogger.log({ ...common, motive: 'claude -p spawn thất bại', action: 'error', outcome: res.raw.slice(0, 500) })
    } else {
      const motive = (res.report || res.raw).split('\n')[0].slice(0, 200) || 'claude -p run'
      this.turnLogger.log({ ...common, motive, action: 'outcome', outcome: res.outcome.summary, decision: res.outcome.decision })
    }
    return res
  }

  // Đường B: query() in-process. Gom message → đóng gói envelope JSON y hệt CLI (result/total_cost_usd/usage/session_id)
  // để parseClaude giữ nguyên. code=0 nếu có result, 1 nếu lỗi/rỗng (giữ logic resume-retry ở run()).
  private async runSdk(o: { prompt: string; ws: string; timeoutSec: number; model: string; appendSystem: string; allowedTools: string[]; maxTurns: number; vault?: string; resumeId?: string; mcpServers?: Record<string, unknown>; hookCtx?: { task?: string; agent?: string; stage?: string } }): Promise<{ out: string; code: number }> {
    const ac = new AbortController()
    const timer = setTimeout(() => ac.abort(), o.timeoutSec * 1000)
    let result = '', sid: string | undefined, usd = 0, inTok = 0, outTok = 0
    try {
      const q = query({
        prompt: o.prompt,
        options: {
          model: o.model, permissionMode: 'bypassPermissions', cwd: o.ws,
          appendSystemPrompt: o.appendSystem, allowedTools: o.allowedTools, maxTurns: o.maxTurns,
          ...(o.mcpServers && Object.keys(o.mcpServers).length ? { mcpServers: o.mcpServers } : {}),
          ...buildHookOptions(o.hookCtx),  // CL-1: {} khi LUCY_HOOKS≠1 (path cũ y nguyên); else hooks+canUseTool
          ...(o.vault ? { additionalDirectories: [o.vault] } : {}),
          ...(o.resumeId ? { resume: o.resumeId } : {}),
          env: { ...process.env, IS_SANDBOX: '1' }, abortController: ac,
        },
      } as any)
      for await (const m of q as any) {
        if (m.type === 'result') {
          result = m.result ?? ''
          sid = m.session_id || undefined
          usd = m.total_cost_usd ?? 0
          inTok = m.usage?.input_tokens ?? 0
          outTok = m.usage?.output_tokens ?? 0
        }
      }
    } catch (e) {
      clearTimeout(timer)
      return { out: JSON.stringify({ result: `SDK lỗi: ${String((e as any)?.message || e)}` }), code: 1 }
    }
    clearTimeout(timer)
    return { out: JSON.stringify({ result, total_cost_usd: usd, usage: { input_tokens: inTok, output_tokens: outTok }, session_id: sid }), code: result ? 0 : 1 }
  }
}

// đọc Brain/active.md → digest preference đã học (bỏ frontmatter + dòng timestamp volatile).
// Trả '' nếu chưa có vault / chưa học gì → KHÔNG chèn nhiễu, giữ prefix ổn định.
export function readActiveDigest(): string {
  const vault = process.env.LUCY_VAULT
  if (!vault) return ''
  try {
    const raw = fs.readFileSync(path.join(vault, 'Brain', 'active.md'), 'utf8')
    const body = raw.replace(/^---[\s\S]*?\n---\n/, '').replace(/^>.*Cập nhật:.*$/m, '').trim()
    if (!/^- /m.test(body)) return '' // chưa có preference nào (chỉ placeholder) → bỏ qua
    return `TRÍ NHỚ ĐÃ HỌC (Lucy nhớ về chủ + dự án — tôn trọng, đừng hỏi lại):\n${body}\n\n---\n`
  } catch { return '' }
}

function parseClaude(raw: string): RunResult {
  let result = raw
  let cost: Cost = { usd: 0, inTok: 0, outTok: 0 }
  let sessionId: string | undefined
  try {
    const d = JSON.parse(raw) as any
    result = d.result ?? raw
    cost = { usd: d.total_cost_usd ?? 0, inTok: d.usage?.input_tokens ?? 0, outTok: d.usage?.output_tokens ?? 0 }
    sessionId = d.session_id || undefined // CACHE: lưu để rework --resume
  } catch { /* không phải JSON */ }
  return { outcome: extractOutcome(result), cost, raw, report: cleanReport(result), sessionId }
}

// C1: narrative "agent đã làm như nào" — bỏ khối JSON outcome ở cuối, cap để khỏi phình store.
export function cleanReport(text: string): string {
  return text.replace(/```json\s*[\s\S]*?```\s*$/i, '').trim().slice(0, 12000)
}

export function extractOutcome(text: string): Outcome {
  const blocks = [...text.matchAll(/```json\s*([\s\S]*?)```/g)]
  const last = blocks.pop()
  if (last) {
    try {
      const o = JSON.parse(last[1]) as Outcome
      if (o.decision) return o
    } catch { /* parse fail */ }
  }
  // không tuân contract -> raise gate để người xem (an toàn)
  return { decision: 'needs_decision', summary: NO_JSON, question: 'Output không có outcome JSON hợp lệ — cần bạn xem.' }
}

// Sentinel: agent QUÊN khối JSON outcome (gặp NHIỀU, nhất là model rẻ / task rộng).
export const NO_JSON = 'Agent không trả JSON outcome đúng'

// Đường B: query() single-shot (no tool) — SALVAGE: đọc output thô → suy ra outcome. Trả result text.
function claudeClassify(prompt: string, model: string, timeoutSec = 90): Promise<string> {
  return (async () => {
    const ac = new AbortController()
    const timer = setTimeout(() => ac.abort(), timeoutSec * 1000)
    let result = ''
    try {
      const q = query({
        prompt,
        options: { model, maxTurns: 1, allowedTools: [], permissionMode: 'bypassPermissions', env: { ...process.env, IS_SANDBOX: '1' }, abortController: ac },
      } as any)
      for await (const m of q as any) { if (m.type === 'result') result = m.result ?? '' }
    } catch { result = '' }
    clearTimeout(timer)
    return result
  })()
}

// SALVAGE outcome: agent làm việc nhưng quên JSON → đọc report → suy ra advance/rework/needs_decision.
// Tránh bounce-sang-người / loop. Model rẻ-ish (sonnet) đủ để classify.
export async function salvageOutcome(report: string, stageName: string): Promise<Outcome> {
  if (!report || report.length < 20) return { decision: 'needs_decision', summary: NO_JSON, question: 'Agent không có output để cứu — cần bạn xem.' }
  const model = process.env.AM_SALVAGE_MODEL || 'sonnet'
  const prompt = `Một agent vừa làm xong bước "${stageName}" NHƯNG quên kết thúc bằng khối JSON outcome theo contract.
Dựa vào OUTPUT của nó, SUY RA outcome đúng:
- advance: đã làm xong tốt phần việc bước này.
- rework: có lỗi / chưa đạt rõ ràng.
- needs_decision: thật sự cần người quyết (mơ hồ / thiếu thông tin chỉ người biết).
OUTPUT của agent:
"""
${report.slice(0, 7000)}
"""
Trả về DUY NHẤT 1 khối JSON: {"decision":"advance|rework|needs_decision","summary":"<1 câu>"}`
  const raw = await claudeClassify(prompt, model)
  const o = extractOutcome(raw)
  if (o.summary === NO_JSON) return { decision: 'needs_decision', summary: 'Không cứu được outcome (cả salvage cũng lỗi)', question: 'Cần bạn xem.' }
  return o
}
