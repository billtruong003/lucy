// ⚠️ 4 FILE "lane" tên gần giống — ĐỪNG sửa nhầm: chat-lane=routing+chat primitive (file này) ·
//    lane-chat=vòng agentic tool cho chat · lane-runner=chạy 1 stage card · llm-lane=lát API provider.
// chat-lane — Đợt A: chat qua model FREE (llm-lane) + smart-routing + tách thinking.
// claude-path (tool+vault) KHÔNG đi qua đây — đây là lane chat thuần cho /model, /persona, auto-route.
// Bảng route bám docs/MODEL-BENCHMARK.md §4 (con nào xịn việc gì). Router model đổi qua LUCY_ROUTER_MODEL.
import { callLLM, entryByKey, type ChatMsg, type LlmResult } from './llm-lane'
import { pickLearnedModel, type OutcomeStats } from './routing-outcome'

// role → ưu tiên model (free trước). Khớp MODEL-BENCHMARK §4. Smart-router map role ra đây.
export const ROUTE_TABLE: Record<string, string[]> = {
  'router':        ['or-nemotron-super', 'ds-v4-flash-free', 'groq-gptoss-120b', 'gemini-flash'],
  'agentic-code':  ['devstral-med', 'or-nemotron-super', 'ds-v4-flash-free', 'codestral'],
  'reasoning':     ['ds-v4-flash-free', 'or-nemotron-super', 'groq-gptoss-120b'],
  'long-context':  ['or-nemotron-super', 'ds-v4-flash-free'],
  'tool-calling':  ['gemini-flash', 'or-nemotron-super', 'groq-gptoss-120b'],
  'fast-classify': ['cerebras-glm-47', 'groq-llama-70b', 'groq-gptoss-120b'],
  'content':       ['gemini-flash', 'mistral-large'],
}
export const ROUTE_ROLES = Object.keys(ROUTE_TABLE).filter((r) => r !== 'router')

// ⭐ Router mặc định = lean chủ nhân (Nemotron). Đổi qua env. Fallback nội bộ nếu key lạ.
export function routerModel(): string {
  const m = (process.env.LUCY_ROUTER_MODEL || '').trim()
  return m && entryByKey(m) ? m : 'or-nemotron-super'
}

// A4: tách block reasoning nhúng trong content (<think>..</think> / <thinking>..</thinking>).
// Provider trả reasoning riêng (field) thì lo ở llm-lane; đây lo trường hợp nhúng trong text.
const THINK_RE = /<think(?:ing)?>([\s\S]*?)<\/think(?:ing)?>/gi
export function splitThinking(content: string): { answer: string; thinking?: string } {
  const blocks: string[] = []
  const answer = content.replace(THINK_RE, (_m, inner) => { blocks.push(String(inner).trim()); return '' }).trim()
  const thinking = blocks.filter(Boolean).join('\n').trim() || undefined
  return { answer: answer || content.trim(), thinking }
}

export interface ChatLaneResult { answer: string; thinking?: string; modelKey: string; model: string; provider: string; usage?: { inTok: number; outTok: number } }

// B1: chuẩn hoá usage OpenAI-style ({prompt_tokens, completion_tokens}) → {inTok, outTok} cho token-guard.
function normUsage(u: unknown): { inTok: number; outTok: number } | undefined {
  const o = u as { prompt_tokens?: number; completion_tokens?: number } | undefined
  if (!o) return undefined
  const inTok = Math.max(0, Number(o.prompt_tokens) || 0)
  const outTok = Math.max(0, Number(o.completion_tokens) || 0)
  return inTok > 0 || outTok > 0 ? { inTok, outTok } : undefined
}

/** Chat 1 lượt qua lane model (free). Tách reasoning (field provider HOẶC <think> nhúng). */
export async function chatLane(model: string, messages: ChatMsg[], opts: { maxTokens?: number } = {}): Promise<ChatLaneResult> {
  const r: LlmResult = await callLLM(model, messages, { maxTokens: opts.maxTokens ?? 2048 })
  const split = splitThinking(r.content)
  // reasoning ưu tiên field provider (đầy đủ hơn), rồi tới block <think> nhúng.
  const thinking = (r.reasoning || split.thinking) || undefined
  return { answer: split.answer, thinking, modelKey: r.modelKey, model: r.model, provider: r.provider, usage: normUsage(r.usage) }
}

export interface RouteDecision { role: string; modelKey: string; reason: string; needsTools: boolean; confidence: number; learned?: boolean }

// prompt router — KHÔNG bias model: cho router xem role + brief, bắt trả JSON.
function buildRoutePrompt(brief: string): ChatMsg[] {
  const roles = ROUTE_ROLES.join(', ')
  const sys = [
    'Bạn là BỘ ĐỊNH TUYẾN (router) của hệ multi-agent. Đọc TASK rồi quyết nên giao loại model nào.',
    `Các ROLE hợp lệ: ${roles}.`,
    'Quy tắc:',
    '- needsTools=true NẾU task cần ĐỌC/SỬA FILE, chạy lệnh, research web, đụng repo (chỉ claude-path làm được).',
    '- needsTools=false nếu chỉ hỏi-đáp/giải thích/viết/suy luận thuần.',
    '- role chọn theo bản chất việc: code→agentic-code, suy luận/toán→reasoning, đọc nhiều ngữ cảnh→long-context, gọi tool/API→tool-calling, phân loại nhanh→fast-classify, viết→content.',
    'TRẢ DUY NHẤT 1 khối JSON (không chữ nào khác):',
    '{"role":"<role>","reason":"<1 câu>","needsTools":true|false,"confidence":0..1}',
  ].join('\n')
  return [{ role: 'system', content: sys }, { role: 'user', content: `TASK:\n${brief.slice(0, 4000)}` }]
}

function parseRoute(raw: string): { role?: string; reason?: string; needsTools?: boolean; confidence?: number } {
  const fence = raw.match(/```json\s*([\s\S]*?)```/)
  const txt = fence ? fence[1] : (raw.match(/\{[\s\S]*\}/)?.[0] ?? '')
  if (!txt) return {}
  try { return JSON.parse(txt) } catch { return {} }
}

export type RouteCaller = (model: string, messages: ChatMsg[]) => Promise<string>

/**
 * Smart-routing: router model đọc brief → quyết role + model thực thi.
 * caller injectable (test). Sai/thiếu → default an toàn (reasoning, low confidence, needsTools=true để an toàn về claude).
 */
export async function routeTask(brief: string, opts: { router?: string; caller?: RouteCaller; outcomes?: OutcomeStats[] } = {}): Promise<RouteDecision> {
  const router = opts.router || routerModel()
  const caller: RouteCaller = opts.caller ?? (async (m, msgs) => (await callLLM(m, msgs, { maxTokens: 300 })).content)
  let parsed: ReturnType<typeof parseRoute> = {}
  try { parsed = parseRoute(await caller(router, buildRoutePrompt(brief))) } catch { parsed = {} }
  const role = parsed.role && ROUTE_TABLE[parsed.role] ? parsed.role : 'reasoning'
  const confidence = typeof parsed.confidence === 'number' ? Math.max(0, Math.min(1, parsed.confidence)) : 0.3
  // confidence thấp → thiên về an toàn (cần người/claude): needsTools mặc định true khi không rõ.
  const needsTools = typeof parsed.needsTools === 'boolean' ? parsed.needsTools : confidence < 0.5
  // BH-D — TỰ HỌC: thay vì luôn con đầu bảng, đọc outcome thật để chọn (override an toàn khi đủ data).
  const pick = pickLearnedModel(ROUTE_TABLE[role], opts.outcomes ?? [])
  const baseReason = (parsed.reason || '').toString().slice(0, 200) || `default role=${role}`
  const reason = pick.learned && pick.reason ? `${baseReason} · ${pick.reason}` : baseReason
  return { role, modelKey: pick.modelKey, reason, needsTools, confidence, learned: pick.learned }
}
