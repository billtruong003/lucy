// prompt-architect — CỤM A: BỘ NÃO LÕI tính năng "Prompt Architect".
// Task 1: persona "prompt-architect" + META-PROMPT SCAFFOLD (system = config/personas/prompt-architect.json).
// Task 2: wiring model RẺ (ds-chat = DeepSeek Chat qua OpenRouter, OpenRouter tự bật prompt caching).
// Task 5: lưu lịch sử phiên (async, fire-safe) qua PromptArchitectStore.
// Task 6: escalate — chạy lại 1 prompt khó bằng Claude (model mạnh) qua SDK query() in-process.
//
// AN TOÀN LIVE: ADDITIVE + FEATURE-FLAG (LUCY_PROMPT_ARCHITECT, MẶC ĐỊNH TẮT). KHÔNG đụng persona-chat/bridge/hub đang chạy.
// KHÔNG EXECUTE: persona này chạy callLLM THUẦN (KHÔNG tool) → không thể chạy task, không web/bash/code.
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { query } from '@anthropic-ai/claude-agent-sdk' // escalate 1-shot in-process (auth subscription)
import { callLLM, RateLimitError, type ChatMsg } from './llm-lane'
import { getPromptArchitectStore } from './prompt-architect-store'
import {
  scorePromptDraft, derivePreferences, buildPreferencePreamble, targetModelStyleHint,
  extractAllPrompts, variantsDirective, type Scorecard,
} from './prompt-architect-intel'
import type { Persona } from './types'

// ── Flag gate (mặc định TẮT — chỉ bật khi đã verify). '1'/'true'/'on' → ON. ──
export function promptArchitectFlagOn(): boolean {
  const f = (process.env.LUCY_PROMPT_ARCHITECT || '').toLowerCase()
  return f === '1' || f === 'true' || f === 'on'
}

// Model rẻ mặc định cho Prompt Architect (đè bằng env LUCY_PROMPT_ARCHITECT_MODEL hoặc persona.laneModel).
export const PA_DEFAULT_LANE = 'ds-chat'
// Model mạnh cho escalate (đè bằng env LUCY_PROMPT_ARCHITECT_ESCALATE_MODEL). 'opus'/'sonnet' = tier SDK.
const PA_ESCALATE_MODEL = 'opus'
const ESCALATE_TIMEOUT_SEC = 120

// ── Nạp persona def từ config/personas/prompt-architect.json (cùng cơ chế loadPersona của lane-chat) ──
function personaDirs(): string[] {
  const c: string[] = []
  if (process.env.LUCY_PERSONA_DIR) c.push(process.env.LUCY_PERSONA_DIR.replace(/^~/, os.homedir()))
  c.push(path.join(process.cwd(), 'config', 'personas'))
  c.push(path.join(os.homedir(), 'lucy', 'agent-machine', 'config', 'personas'))
  return c
}

export function loadPromptArchitectPersona(): Persona | null {
  for (const d of personaDirs()) {
    try {
      const p = path.join(d, 'prompt-architect.json')
      if (fs.existsSync(p)) return JSON.parse(fs.readFileSync(p, 'utf8')) as Persona
    } catch { /* file lỗi → thử dir kế */ }
  }
  return null
}

// ── Heuristic: persona có ĐANG HỎI làm-rõ không? (clarify-gate). ──
// Dùng cho caller (Hub/bridge) biết phiên này là câu hỏi hay là prompt cuối → lưu/hiển thị đúng.
// Tín hiệu: KHÔNG có khối ```prompt```/<task> + có dấu '?' (hoặc cụm "cần hỏi"/"làm rõ").
export function isClarifying(answer: string): boolean {
  const a = (answer || '').trim()
  if (!a) return false
  const hasPromptBlock = /```\s*prompt/i.test(a) || /<task>/i.test(a) || /<role>/i.test(a)
  if (hasPromptBlock) return false
  return /\?/.test(a) || /(cần hỏi|làm rõ|làm-rõ|clarif)/i.test(a)
}

// ── Bóc khối ```prompt … ``` từ output (prompt cuối) để caller lưu/hiển thị riêng. Rỗng nếu chưa có. ──
export function extractFinalPrompt(answer: string): string {
  const m = (answer || '').match(/```(?:prompt)?\s*\n?([\s\S]*?)```/i)
  return m ? m[1].trim() : ''
}

export type PromptArchitectResult = {
  answer: string          // text persona xuất (prompt cuối HOẶC câu hỏi làm-rõ)
  clarifying: boolean      // đang ở chế độ hỏi làm-rõ?
  finalPrompt: string      // prompt bóc từ khối ```prompt``` (rỗng nếu đang hỏi)
  laneModel: string        // model rẻ thực tế đã dùng
  sessionId: number | null // id phiên đã lưu (null nếu lưu lỗi/tắt)
  escalated: boolean
  scorecard?: Scorecard    // CỤM C: chấm bản nháp prompt cuối (rỗng khi đang hỏi/không có prompt)
  variants?: string[]      // CỤM C: các biến thể prompt (≥2) nếu caller bật opts.variants
  preferenceApplied?: boolean // CỤM C: đã chèn phong cách chủ nhân (few-shot) vào lượt này?
  rateLimit?: { retryAfterMs: number }
  usage?: { inTok: number; outTok: number } // B1: token thật để report token-guard CHUNG
}

// Dựng addendum chèn SAU scaffold persona: phong cách chủ nhân (few-shot) + style target-model.
// Rỗng → không thêm gì (không nhồi nhiễu). Tách hàm để smoke kiểm riêng.
export function buildSystemAddendum(parts: { preferencePreamble?: string; targetStyle?: string }): string {
  return [parts.preferencePreamble, parts.targetStyle].filter((s) => s && s.trim()).join('\n\n').trim()
}

// Dựng messages cho 1 lượt: [system(scaffold[+addendum]), ...history, user(ngữ cảnh[+variants])]. Target-model chèn vào ngữ cảnh.
function buildMessages(
  persona: Persona, contextInput: string, history: ChatMsg[],
  opts: { targetModel?: string; systemAddendum?: string; variantsDirective?: string } = {},
): ChatMsg[] {
  const sys = opts.systemAddendum ? `${persona.systemPrompt}\n\n${opts.systemAddendum}` : persona.systemPrompt
  const userBlock = [
    opts.targetModel ? `[TARGET MODEL prompt này sẽ chạy: ${opts.targetModel}]` : '',
    contextInput,
    opts.variantsDirective || '',
  ].filter(Boolean).join('\n\n')
  return [{ role: 'system', content: sys }, ...history.slice(-8), { role: 'user', content: userBlock }]
}

// Lọc history thô → ChatMsg sạch (chỉ user/assistant, content chuỗi). Cap caller lo qua slice.
export function sanitizeChatHistory(raw: unknown): ChatMsg[] {
  if (!Array.isArray(raw)) return []
  const out: ChatMsg[] = []
  for (const m of raw) {
    if (!m || typeof m !== 'object') continue
    const role = (m as any).role === 'assistant' ? 'assistant' : (m as any).role === 'user' ? 'user' : null
    const content = String((m as any).content ?? '').slice(0, 12000)
    if (!role || !content) continue
    out.push({ role, content })
  }
  return out
}

/**
 * Task 1+2+5 — chạy Prompt Architect 1 lượt (model RẺ, THUẦN chat, KHÔNG tool = không execute).
 * Tự lưu phiên async (fire-safe). KHÔNG throw — lỗi → answer báo lỗi gọn.
 * opts.persona injectable cho smoke (khỏi cần file).
 */
export async function runPromptArchitect(
  contextInput: string,
  opts: {
    history?: ChatMsg[]; targetModel?: string; source?: string; chatId?: string;
    persona?: Persona | null; laneModel?: string; save?: boolean; vaultDir?: string;
    usePreferences?: boolean; variants?: number;
  } = {},
): Promise<PromptArchitectResult> {
  const persona = opts.persona ?? loadPromptArchitectPersona()
  const lane = opts.laneModel || process.env.LUCY_PROMPT_ARCHITECT_MODEL || persona?.laneModel || PA_DEFAULT_LANE
  if (!persona) {
    return { answer: '❌ chưa có persona prompt-architect (config/personas/prompt-architect.json).', clarifying: false, finalPrompt: '', laneModel: lane, sessionId: null, escalated: false }
  }

  // CỤM C — few-shot phong cách chủ nhân: bóc từ lịch sử phiên (cùng chatId) → preamble. Mặc định BẬT khi có chatId.
  let preferenceApplied = false
  let preferencePreamble = ''
  if (opts.usePreferences !== false && opts.chatId) {
    try {
      const store = getPromptArchitectStore(opts.vaultDir)
      if (store) {
        preferencePreamble = buildPreferencePreamble(derivePreferences(store.recent({ chatId: opts.chatId, limit: 20 })))
        preferenceApplied = !!preferencePreamble
      }
    } catch { /* fire-safe: thiếu phong cách KHÔNG được làm gãy chat */ }
  }
  const systemAddendum = buildSystemAddendum({ preferencePreamble, targetStyle: targetModelStyleHint(opts.targetModel) })
  const wantVariants = (opts.variants ?? 0) >= 2
  const messages = buildMessages(persona, contextInput, opts.history || [], {
    targetModel: opts.targetModel, systemAddendum,
    variantsDirective: wantVariants ? variantsDirective(opts.variants!) : undefined,
  })
  let answer = ''
  let rateLimit: { retryAfterMs: number } | undefined
  let usage: { inTok: number; outTok: number } | undefined
  try {
    // THUẦN callLLM (KHÔNG tools) → persona KHÔNG thể chạy task/web/bash → đảm bảo NGUYÊN TẮC 7 (no-execute).
    // maxTokens RỘNG cho prompt dài (code Before→After, nhiều sections) — 3000 bị CẮT GIỮA CHỪNG (Bill báo 2026-06-16).
    const r = await callLLM(lane, messages, { maxTokens: 8000, timeoutMs: 120000 })
    answer = (r.content || '').trim()
    // B1: token thật (OpenAI-style) → chuẩn hoá để hub report token-guard CHUNG.
    const u = r.usage as { prompt_tokens?: number; completion_tokens?: number } | undefined
    if (u) usage = { inTok: Math.max(0, Number(u.prompt_tokens) || 0), outTok: Math.max(0, Number(u.completion_tokens) || 0) }
  } catch (e) {
    if (e instanceof RateLimitError) {
      rateLimit = { retryAfterMs: e.retryAfterMs }
      answer = `⏸️ model rẻ bị rate-limit (thử lại sau ~${Math.round(e.retryAfterMs / 1000)}s).`
    } else {
      answer = '❌ Prompt Architect lỗi: ' + String(e instanceof Error ? e.message : e).slice(0, 200)
    }
  }

  const clarifying = !rateLimit && isClarifying(answer)
  // ĐA BIẾN THỂ: nếu bật variants và bóc được ≥2 khối → finalPrompt = biến thể đầu (để lưu/score), kèm cả danh sách.
  const allPrompts = clarifying ? [] : extractAllPrompts(answer)
  const variants = wantVariants && allPrompts.length >= 2 ? allPrompts : undefined
  const finalPrompt = clarifying ? '' : (variants ? variants[0] : extractFinalPrompt(answer))
  // CỤM C — Scorecard: chấm bản nháp prompt cuối (deterministic, không tốn token). Bỏ qua khi đang hỏi.
  const scorecard = finalPrompt ? scorePromptDraft(finalPrompt) : undefined

  // Task 5: lưu lịch sử (async, fire-safe). Mặc định lưu khi đã ra prompt cuối (không lưu lúc đang hỏi để đỡ rác).
  let sessionId: number | null = null
  const wantSave = opts.save !== false && !rateLimit
  if (wantSave) {
    try {
      const store = getPromptArchitectStore(opts.vaultDir)
      if (store) {
        sessionId = store.recordSession({
          source: opts.source, chatId: opts.chatId, targetModel: opts.targetModel,
          contextInput, clarifyAsked: clarifying ? answer : '', finalPrompt,
          laneModel: lane,
        })
      }
    } catch { /* lưu lỗi KHÔNG được làm gãy chat */ }
  }

  return { answer, clarifying, finalPrompt, laneModel: lane, sessionId, escalated: false, scorecard, variants, preferenceApplied, rateLimit, usage }
}

// ── Task 5b: ghi bản EDIT của chủ nhân lên 1 phiên (rewrite-then-edit). Fire-safe. ──
export function recordUserEdit(sessionId: number, userEdit: string, vaultDir?: string): boolean {
  try { return getPromptArchitectStore(vaultDir)?.recordUserEdit(sessionId, userEdit) ?? false } catch { return false }
}

/**
 * Task 6 — ESCALATE: chạy lại 1 prompt khó bằng CLAUDE (model mạnh) thay vì DeepSeek.
 * Dùng SDK query() 1-shot in-process (auth subscription, KHÔNG tool → vẫn no-execute).
 * runner injectable cho smoke (khỏi cần claude thật). Trả answer Claude; lỗi → giữ answer rẻ.
 */
export type EscalateRunner = (system: string, user: string, model: string) => Promise<string>

async function sdkEscalate(system: string, user: string, model: string): Promise<string> {
  const safeModel = /^[A-Za-z0-9._-]+$/.test(model) ? model : 'opus'
  const ac = new AbortController()
  const timer = setTimeout(() => ac.abort(), ESCALATE_TIMEOUT_SEC * 1000)
  let result = ''
  try {
    // prompt = system + user gộp (query() không tách system như chat-completions); maxTurns 1, allowedTools=[] → no-execute.
    const q = query({
      prompt: `${system}\n\n--- NGỮ CẢNH CHỦ NHÂN ---\n${user}`,
      options: { model: safeModel, maxTurns: 1, allowedTools: [], permissionMode: 'bypassPermissions', env: { ...process.env, IS_SANDBOX: '1' }, abortController: ac },
    } as any)
    for await (const m of q as any) { if (m.type === 'result') result = m.result ?? '' }
  } catch { result = '' }
  clearTimeout(timer)
  return result
}

export async function escalatePromptArchitect(
  contextInput: string,
  opts: {
    history?: ChatMsg[]; targetModel?: string; source?: string; chatId?: string;
    persona?: Persona | null; sessionId?: number; vaultDir?: string; runner?: EscalateRunner;
  } = {},
): Promise<PromptArchitectResult> {
  const persona = opts.persona ?? loadPromptArchitectPersona()
  const model = process.env.LUCY_PROMPT_ARCHITECT_ESCALATE_MODEL || PA_ESCALATE_MODEL
  if (!persona) {
    return { answer: '❌ chưa có persona prompt-architect.', clarifying: false, finalPrompt: '', laneModel: model, sessionId: opts.sessionId ?? null, escalated: false }
  }
  const histText = (opts.history || []).slice(-8).map((m) => `${m.role}: ${m.content}`).join('\n')
  const userBlock = [
    opts.targetModel ? `[TARGET MODEL: ${opts.targetModel}]` : '',
    histText ? `[hội thoại trước]\n${histText}\n` : '',
    contextInput,
  ].filter(Boolean).join('\n')

  const run: EscalateRunner = opts.runner ?? sdkEscalate
  let answer = ''
  try { answer = (await run(persona.systemPrompt, userBlock, model) || '').trim() } catch { answer = '' }
  if (!answer) {
    return { answer: '❌ escalate Claude không ra kết quả (thử lại sau).', clarifying: false, finalPrompt: '', laneModel: model, sessionId: opts.sessionId ?? null, escalated: true }
  }

  const clarifying = isClarifying(answer)
  const finalPrompt = clarifying ? '' : extractFinalPrompt(answer)
  const scorecard = finalPrompt ? scorePromptDraft(finalPrompt) : undefined

  // lưu phiên escalate (đánh dấu escalated). Cập nhật phiên cũ nếu có sessionId, không thì tạo mới.
  let sessionId: number | null = opts.sessionId ?? null
  try {
    const store = getPromptArchitectStore(opts.vaultDir)
    if (store) {
      if (sessionId != null) { store.markEscalated(sessionId) }
      else {
        sessionId = store.recordSession({
          source: opts.source, chatId: opts.chatId, targetModel: opts.targetModel,
          contextInput, clarifyAsked: clarifying ? answer : '', finalPrompt,
          laneModel: model, escalated: true,
        })
      }
    }
  } catch { /* fire-safe */ }

  return { answer, clarifying, finalPrompt, laneModel: model, sessionId, escalated: true, scorecard }
}
