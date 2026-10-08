// ⚠️ 4 FILE "lane" tên gần giống — ĐỪNG sửa nhầm: llm-lane=lát API provider + catalog (file này) ·
//    chat-lane=routing+chat primitive · lane-chat=vòng agentic tool cho chat · lane-runner=chạy 1 stage card.
// llm-lane.ts — "lát API" nhẹ in-house: gọi thẳng provider OpenAI-compat + fallback.
// Thay OmniRoute (Next.js nặng) trên VPS 2GB. Không dep mới (Node 20 fetch). Key từ .env.llm.
// claude -p (não) KHÔNG đi qua đây — đây là lane MODEL-RẺ (executor/bulk).
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { guardedFor, markGuarded } from './rate-guard'
import { recordQuota } from './quota'
import { availableKeys, markKeyCooldown, hasAnyKey, keysFor } from './cred-pool'

export type ProviderId = 'openrouter' | 'groq' | 'gemini' | 'cerebras' | 'mistral' | 'opencode-zen' | 'zai' | 'nous'

export interface ProviderCfg { id: ProviderId; baseUrl: string; envKey: string; label: string }

// baseUrl = gốc OpenAI-compat (đã verify HTTP 200 /models, 2026-06-11).
export const PROVIDERS: Record<ProviderId, ProviderCfg> = {
  'openrouter':   { id: 'openrouter',   baseUrl: 'https://openrouter.ai/api/v1',                       envKey: 'OPENROUTER_API_KEY',   label: 'OpenRouter' },
  'groq':         { id: 'groq',         baseUrl: 'https://api.groq.com/openai/v1',                     envKey: 'GROQ_API_KEY',         label: 'Groq' },
  'gemini':       { id: 'gemini',       baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai', envKey: 'GEMINI_API_KEY',  label: 'Gemini' },
  'cerebras':     { id: 'cerebras',     baseUrl: 'https://api.cerebras.ai/v1',                         envKey: 'CEREBRAS_API_KEY',     label: 'Cerebras' },
  'mistral':      { id: 'mistral',      baseUrl: 'https://api.mistral.ai/v1',                          envKey: 'MISTRAL_API_KEY',      label: 'Mistral' },
  'opencode-zen': { id: 'opencode-zen', baseUrl: 'https://opencode.ai/zen/v1',                         envKey: 'OPENCODE_ZEN_API_KEY', label: 'OpenCode Zen' },
  'zai':          { id: 'zai',          baseUrl: 'https://api.z.ai/api/paas/v4',                       envKey: 'ZAI_API_KEY',          label: 'Z.ai' },
  // Nous Portal = AGGREGATOR (265 model: Claude/GPT-5/DeepSeek/Nemotron/Hermes/GLM/Qwen...). Dùng credits-pool của Nous.
  'nous':         { id: 'nous',         baseUrl: 'https://inference-api.nousresearch.com/v1',          envKey: 'NOUS_API_KEY',         label: 'Nous Portal' },
}

export type Role = 'executor' | 'reasoning' | 'fast' | 'content'

export interface ModelEntry {
  key: string          // id ổn định dùng trong dropdown + config
  label: string        // hiện trên dropdown
  provider: ProviderId
  model: string        // model-id thật gửi cho provider
  role: Role
  free: boolean
  ctx?: string
  note?: string
}

// Catalog cho dropdown. TẤT CẢ id dưới đã SMOKE-TEST chạy thật 2026-06-11 (trừ ghi chú).
// Bỏ: z.ai (insufficient balance), zen paid/qwen-free-ended (cần payment) — không đưa vào.
export const MODEL_CATALOG: ModelEntry[] = [
  // executor — coding agentic
  { key: 'ds-v4-flash-free', label: 'DeepSeek V4 Flash (free)', provider: 'opencode-zen', model: 'deepseek-v4-flash-free', role: 'executor', free: true, ctx: '1M', note: 'reasoning — cấp max_tokens cao' },
  { key: 'devstral-med',     label: 'Devstral Medium',          provider: 'mistral',      model: 'devstral-medium-latest',     role: 'executor', free: true, note: 'agentic coding của Mistral' },
  { key: 'codestral',        label: 'Codestral 2508',           provider: 'mistral',      model: 'codestral-2508',             role: 'executor', free: true, note: 'code-specialized' },
  { key: 'ds-v4-flash',      label: 'DeepSeek V4 Flash',        provider: 'openrouter',   model: 'deepseek/deepseek-v4-flash', role: 'executor', free: false, ctx: '1M' },
  // ds-chat — DeepSeek Chat (non-reasoning, RẺ ~90x frontier). Prompt-Architect dùng: cấu-trúc-hoá + clarify, không cần reasoning sâu. OpenRouter tự bật prompt caching cho DeepSeek.
  { key: 'ds-chat',          label: 'DeepSeek Chat',            provider: 'openrouter',   model: 'deepseek/deepseek-chat',     role: 'fast', free: false, ctx: '64k', note: 'non-reasoning rẻ — structural/refine (Prompt Architect)' },
  { key: 'or-nemotron-super', label: 'Nemotron 3 Super 120B',   provider: 'openrouter',   model: 'nvidia/nemotron-3-super-120b-a12b:free', role: 'executor', free: true, ctx: '1M', note: 'free + tool-calling, nhanh (verify 2026-06-12)' },
  { key: 'or-gptoss-120b',   label: 'GPT-OSS 120B (OpenRouter free)', provider: 'openrouter', model: 'openai/gpt-oss-120b:free', role: 'executor', free: true, ctx: '131k', note: 'free + tool-calling' },
  // ABF (auto-build-free) — executor free từ OpenCode Zen: code nhỏ + vision QA
  { key: 'mimo-v2.5-free',   label: 'MiMo V2.5 Free',           provider: 'opencode-zen', model: 'mimo-v2.5-free',             role: 'executor', free: true, ctx: '256k', note: 'vision+code, xiaomi/mimo-v2.5 — OpenCode Zen free (live OK 2026-06-19)' },
  { key: 'minimax-m3-free',  label: 'MiniMax M3 Free',          provider: 'opencode-zen', model: 'minimax-m3-free',            role: 'executor', free: false, ctx: '1M', note: '⛔ 401 "Free promotion ended" (verify live 2026-06-19, cần OpenCode Go) → ĐỪNG route; ABF fallback ds-v4-flash-free' },
  // reasoning
  { key: 'ds-v4-pro',        label: 'DeepSeek V4 Pro',          provider: 'openrouter',   model: 'deepseek/deepseek-v4-pro',   role: 'reasoning', free: false, ctx: '1M', note: 'S-tier reasoning+code' },
  // fast — nhanh, việc nhẹ
  { key: 'groq-gptoss-120b', label: 'GPT-OSS 120B (Groq)',      provider: 'groq',         model: 'openai/gpt-oss-120b',        role: 'fast', free: true, note: 'mạnh + nhanh, free' },
  { key: 'cerebras-glm-47',  label: 'GLM-4.7 (Cerebras)',       provider: 'cerebras',     model: 'zai-glm-4.7',                role: 'fast', free: true, note: 'cực nhanh, cap ctx 8K' },
  { key: 'cerebras-gptoss',  label: 'GPT-OSS 120B (Cerebras)',  provider: 'cerebras',     model: 'gpt-oss-120b',               role: 'fast', free: true, note: 'cap ctx 8K' },
  { key: 'groq-llama-70b',   label: 'Llama 3.3 70B (Groq)',     provider: 'groq',         model: 'llama-3.3-70b-versatile',    role: 'fast', free: true, note: 'classify/chat' },
  // content — viết
  { key: 'gemini-flash',     label: 'Gemini 3 Flash',           provider: 'gemini',       model: 'gemini-3-flash-preview',     role: 'content', free: true, note: '1500 RPD' },
  { key: 'mistral-large',    label: 'Mistral Large',            provider: 'mistral',      model: 'mistral-large-latest',       role: 'content', free: true },
  // ── Nous Portal (aggregator, credits-pool của Nous) — Claude/Nemotron/Hermes/DeepSeek qua 1 key ──
  { key: 'nous-opus-fast',   label: 'Claude Opus 4.8 Fast (Nous)', provider: 'nous',      model: 'anthropic/claude-opus-4.8-fast', role: 'reasoning', free: false, note: 'orchestrator: Claude xịn + streaming, rẻ hơn claude -p' },
  { key: 'nous-opus',        label: 'Claude Opus 4.8 (Nous)',   provider: 'nous',         model: 'anthropic/claude-opus-4.8',   role: 'reasoning', free: false, note: 'Opus mạnh nhất, không fast' },
  { key: 'nous-sonnet',      label: 'Claude Sonnet 4.6 (Nous)', provider: 'nous',         model: 'anthropic/claude-sonnet-4.6', role: 'reasoning', free: false, note: 'chat nhanh' },
  { key: 'nous-fable',       label: 'Claude Fable 5 (Nous)',    provider: 'nous',         model: 'anthropic/claude-fable-5',    role: 'reasoning', free: false, note: 'model "5" mạnh nhất — đắt ($10/$50), chưa verify Nous phục vụ' },
  { key: 'nous-haiku',       label: 'Claude Haiku 4.5 (Nous)',  provider: 'nous',         model: 'anthropic/claude-haiku-4.5',  role: 'fast', free: false, note: 'nhanh/rẻ cho task đơn giản' },
  { key: 'nous-nemotron-ultra', label: 'Nemotron 3 Ultra 550B (Nous)', provider: 'nous', model: 'nvidia/nemotron-3-ultra-550b-a55b', role: 'reasoning', free: false, ctx: '1M', note: 'router xịn nhất' },
  { key: 'nous-nemotron-free', label: 'Nemotron 3 Ultra (Nous free)', provider: 'nous',  model: 'nvidia/nemotron-3-ultra:free', role: 'reasoning', free: true, ctx: '1M', note: 'router free' },
  { key: 'nous-hermes-405b', label: 'Hermes 4 405B (Nous)',     provider: 'nous',         model: 'nousresearch/hermes-4-405b', role: 'reasoning', free: false, note: 'model nhà Nous' },
  { key: 'nous-ds-v4-pro',   label: 'DeepSeek V4 Pro (Nous)',   provider: 'nous',         model: 'deepseek/deepseek-v4-pro',   role: 'reasoning', free: false, ctx: '1M' },
  { key: 'nous-qwen3-coder', label: 'Qwen3 Coder Plus (Nous)',  provider: 'nous',         model: 'qwen/qwen3-coder-plus',      role: 'executor', free: false, note: 'agentic coding' },
  { key: 'nous-gpt-oss-120b', label: 'GPT-OSS 120B (Nous)',     provider: 'nous',         model: 'openai/gpt-oss-120b',        role: 'fast', free: false },
]

// ── Claude SUBSCRIPTION chat models (đường claude-path: bridge SDK + hub Chat) ──
// NGUỒN DUY NHẤT cho model Claude "não thật" (tool+vault). Thêm model mới của Anthropic = THÊM 1 DÒNG Ở ĐÂY,
// bridge /model + hub picker tự hiện (đừng hardcode claude:sonnet/opus rải rác nữa). model-id = id gửi cho `claude --model`.
// tier: fast=nhẹ/rẻ · balanced=mặc định · deep=sâu/đắt. default=true → model mặc định khi chưa chọn.
export interface ClaudeChatModel { key: string; label: string; model: string; tier: 'fast' | 'balanced' | 'deep'; note?: string; default?: boolean }
export const CLAUDE_CHAT_MODELS: ClaudeChatModel[] = [
  { key: 'claude:opus',   label: 'Claude Opus 5.5', model: 'claude-opus-5-5',          tier: 'deep',     note: 'mạnh nhất, mặc định', default: true },
  { key: 'claude:sonnet', label: 'Claude Sonnet 5.5', model: 'claude-sonnet-5-5',      tier: 'balanced', note: 'nhanh, cân bằng — hạ về đây cho tin vặt' },
  { key: 'claude:fable',  label: 'Claude Fable 5.1', model: 'claude-fable-5-1',        tier: 'deep',     note: 'thế hệ 5' },
  { key: 'claude:haiku',  label: 'Claude Haiku 5.5', model: 'claude-haiku-5-5',        tier: 'fast',     note: 'nhẹ/rẻ, việc đơn giản' },
]
export function claudeModelId(key: string): string | undefined {
  const bare = key.startsWith('claude:') ? key : `claude:${key}`
  return CLAUDE_CHAT_MODELS.find((m) => m.key === bare)?.model
}
export function defaultClaudeKey(): string { return (CLAUDE_CHAT_MODELS.find((m) => m.default) || CLAUDE_CHAT_MODELS[0]).key }

// Chuỗi fallback theo role (chạy lần lượt tới khi 1 cái ra content). Chỉ model đã verify.
export const FALLBACKS: Record<Role, string[]> = {
  executor:  ['mimo-v2.5-free', 'ds-v4-flash-free', 'or-nemotron-super', 'devstral-med', 'or-gptoss-120b', 'ds-v4-flash', 'codestral'],
  reasoning: ['ds-v4-pro', 'ds-v4-flash', 'groq-gptoss-120b'],
  fast:      ['groq-gptoss-120b', 'cerebras-glm-47', 'groq-llama-70b'],
  content:   ['gemini-flash', 'mistral-large', 'groq-gptoss-120b'],
}

// ── Rate-limit detection ──
export class RateLimitError extends Error {
  retryAfterMs: number
  constructor(msg: string, retryAfterMs: number) {
    super(msg)
    this.name = 'RateLimitError'
    this.retryAfterMs = retryAfterMs
  }
}

const DEFAULT_RETRY_AFTER_MS = 5 * 60_000 // 5 phút
function parseRetryAfterMs(res: Response): number {
  const raw = res.headers.get('retry-after')
  if (raw) {
    const asNum = parseInt(raw, 10)
    if (!isNaN(asNum) && asNum > 0) return asNum * 1000
    const asDate = Date.parse(raw)
    if (!isNaN(asDate)) return Math.max(0, asDate - Date.now())
  }
  const envVal = process.env.AM_RATELIMIT_PARK_MS
  if (envVal) { const n = parseInt(envVal, 10); if (!isNaN(n) && n > 0) return n }
  return DEFAULT_RETRY_AFTER_MS
}

let envLoaded = false
function loadEnvFile(): void {
  if (envLoaded) return
  envLoaded = true
  const p = process.env.LLM_ENV_FILE || path.join(os.homedir(), 'lucy', '.env.llm')
  let raw: string
  try { raw = fs.readFileSync(p, 'utf8') } catch { return }
  for (const line of raw.split('\n')) {
    const s = line.trim()
    if (!s || s.startsWith('#')) continue
    const eq = s.indexOf('=')
    if (eq < 0) continue
    const k = s.slice(0, eq).trim()
    const v = s.slice(eq + 1).trim()
    if (k) process.env[k] = v // .env.llm luôn thắng — file này chỉ chứa LLM API keys
  }
}

export function keyFor(provider: ProviderId): string | undefined {
  loadEnvFile()
  return keysFor(provider)[0] // B2: key đầu pool (đa key / CSV). undefined nếu không cấu hình.
}

export function entryByKey(key: string): ModelEntry | undefined {
  return MODEL_CATALOG.find((m) => m.key === key)
}

/** Provider nào có key (cho hub hiện trạng thái sống/chết — KHÔNG lộ key). */
export function providerStatus(): { provider: ProviderId; label: string; hasKey: boolean }[] {
  return (Object.keys(PROVIDERS) as ProviderId[]).map((id) => ({ provider: id, label: PROVIDERS[id].label, hasKey: !!keyFor(id) }))
}

export interface ChatMsg { role: 'system' | 'user' | 'assistant'; content: string }
export interface LlmResult { content: string; reasoning?: string; modelKey: string; provider: ProviderId; model: string; usage?: unknown }

async function callOne(entry: ModelEntry, messages: ChatMsg[], maxTokens: number, timeoutMs: number): Promise<LlmResult> {
  // B2: thử lần lượt các key còn dùng được; key nào 429 → cooldown + sang key kế; hết key 429 → RateLimitError.
  const keys = availableKeys(entry.provider)
  if (!keys.length) throw new Error(`no key for ${entry.provider}`)
  let lastRate: RateLimitError | null = null
  for (const key of keys) {
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), timeoutMs)
    try {
      const res = await fetch(`${PROVIDERS[entry.provider].baseUrl}/chat/completions`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: entry.model, messages, max_tokens: maxTokens }),
        signal: ctrl.signal,
      })
      if (!res.ok) {
        if (res.status === 429) { const ra = parseRetryAfterMs(res); markKeyCooldown(entry.provider, key, ra); lastRate = new RateLimitError(`${entry.provider}/${entry.model} HTTP 429`, ra); continue }
        if (res.status === 401 || res.status === 403) { markKeyCooldown(entry.provider, key, 30 * 60_000) } // key hỏng → nghỉ dài, thử key khác
        throw new Error(`${entry.provider}/${entry.model} HTTP ${res.status}`)
      }
      recordQuota(entry.provider, res.headers) // B3: ghi quota từ header (sau khi chắc res.ok)
      const data = await res.json() as { choices?: { message?: { content?: string; reasoning_content?: string; reasoning?: string } }[]; usage?: unknown }
      const msg = data.choices?.[0]?.message
      const content = (msg?.content || '').trim()
      if (!content) throw new Error(`${entry.provider}/${entry.model} empty content`)
      // A4: reasoning provider trả riêng (DeepSeek 'reasoning_content', số provider 'reasoning') → surface để hiển thị tách.
      const reasoning = (msg?.reasoning_content || msg?.reasoning || '').trim() || undefined
      return { content, reasoning, modelKey: entry.key, provider: entry.provider, model: entry.model, usage: data.usage }
    } finally {
      clearTimeout(timer)
    }
  }
  throw lastRate ?? new Error(`${entry.provider}/${entry.model}: mọi key 401/403`)
}

export interface CallOpts { maxTokens?: number; timeoutMs?: number; fallback?: boolean }

/**
 * Gọi 1 model theo key (hoặc role). Tự fallback theo FALLBACKS nếu fail/empty.
 * modelKeyOrRole: 'ds-v4-flash-free' | 'executor' | ...
 */
export async function callLLM(modelKeyOrRole: string, messages: ChatMsg[], opts: CallOpts = {}): Promise<LlmResult> {
  const maxTokens = opts.maxTokens ?? 2048
  const timeoutMs = opts.timeoutMs ?? 60000
  const fb = opts.fallback ?? true

  let chain: string[]
  if ((['executor', 'reasoning', 'fast', 'content'] as string[]).includes(modelKeyOrRole)) {
    chain = FALLBACKS[modelKeyOrRole as Role]
  } else {
    const entry = entryByKey(modelKeyOrRole)
    if (!entry) throw new Error(`unknown model key: ${modelKeyOrRole}`)
    chain = fb ? [entry.key, ...FALLBACKS[entry.role].filter((k) => k !== entry.key)] : [entry.key]
  }

  const errors: string[] = []
  let attempted = 0
  let rateLimitedCount = 0
  const rateLimitAfters: number[] = []
  for (const k of chain) {
    const entry = entryByKey(k)
    if (!entry || !keyFor(entry.provider)) { errors.push(`${k}: no entry/key`); continue }
    // B1: provider đang bị rate-guard (process khác đã ăn 429) → KHÔNG gọi, coi như rate-limited.
    const guarded = guardedFor(entry.provider)
    if (guarded > 0) { errors.push(`${k}: rate-guard còn ${Math.round(guarded / 1000)}s`); rateLimitedCount++; rateLimitAfters.push(guarded); continue }
    attempted++
    try {
      return await callOne(entry, messages, maxTokens, timeoutMs)
    } catch (e) {
      const msg = String(e instanceof Error ? e.message : e)
      errors.push(msg)
      if (e instanceof RateLimitError) { rateLimitedCount++; rateLimitAfters.push(e.retryAfterMs); markGuarded(entry.provider, e.retryAfterMs, msg) }
    }
  }
  // Có ÍT NHẤT 1 provider 429 + cả chuỗi fail → PARK (back-off), KHÔNG fail.
  // mixed 429+500: retry ngay vô ích vì đang bị giới hạn → park + notify mới đúng + tiết kiệm token.
  if (attempted > 0 && rateLimitedCount > 0) {
    const maxRa = Math.max(...rateLimitAfters, DEFAULT_RETRY_AFTER_MS)
    throw new RateLimitError(`providers rate-limited (${rateLimitedCount}/${attempted}): ${errors.join(' | ')}`, maxRa)
  }
  throw new Error(`all providers failed: ${errors.join(' | ')}`)
}

// ── TOOL-CALLING (agentic) — cho LaneRunner: model rẻ có "tay" (read/write/edit/bash) ──
export interface ToolDef { type: 'function'; function: { name: string; description: string; parameters: Record<string, unknown> } }
export interface RawToolCall { id: string; type: 'function'; function: { name: string; arguments: string } }
export interface RawMsg { role: 'system' | 'user' | 'assistant' | 'tool'; content: string | null; tool_calls?: RawToolCall[]; tool_call_id?: string }
export interface RawResult { message: RawMsg; usage?: { prompt_tokens?: number; completion_tokens?: number }; modelKey: string; provider: ProviderId; model: string }

async function callOneRaw(entry: ModelEntry, messages: RawMsg[], tools: ToolDef[] | undefined, maxTokens: number, timeoutMs: number): Promise<RawResult> {
  const keys = availableKeys(entry.provider) // B2
  if (!keys.length) throw new Error(`no key for ${entry.provider}`)
  let lastRate: RateLimitError | null = null
  for (const key of keys) {
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), timeoutMs)
    try {
      const body: Record<string, unknown> = { model: entry.model, messages, max_tokens: maxTokens }
      if (tools && tools.length) { body.tools = tools; body.tool_choice = 'auto' }
      const res = await fetch(`${PROVIDERS[entry.provider].baseUrl}/chat/completions`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: ctrl.signal,
      })
      if (!res.ok) {
        if (res.status === 429) { const ra = parseRetryAfterMs(res); markKeyCooldown(entry.provider, key, ra); lastRate = new RateLimitError(`${entry.provider}/${entry.model} HTTP 429`, ra); continue }
        if (res.status === 401 || res.status === 403) { markKeyCooldown(entry.provider, key, 30 * 60_000) }
        throw new Error(`${entry.provider}/${entry.model} HTTP ${res.status}`)
      }
      recordQuota(entry.provider, res.headers) // B3
      const data = await res.json() as { choices?: { message?: RawMsg }[]; usage?: { prompt_tokens?: number; completion_tokens?: number } }
      const message = data.choices?.[0]?.message
      if (!message) throw new Error(`${entry.provider}/${entry.model} no message`)
      return { message, usage: data.usage, modelKey: entry.key, provider: entry.provider, model: entry.model }
    } finally {
      clearTimeout(timer)
    }
  }
  throw lastRate ?? new Error(`${entry.provider}/${entry.model}: mọi key 401/403`)
}

/** Như callLLM nhưng GIỮ tool_calls (agentic loop). Mỗi lượt tự fallback model nếu fail. */
export async function callLLMRaw(modelKeyOrRole: string, messages: RawMsg[], opts: { tools?: ToolDef[]; maxTokens?: number; timeoutMs?: number; fallback?: boolean } = {}): Promise<RawResult> {
  const maxTokens = opts.maxTokens ?? 4096
  const timeoutMs = opts.timeoutMs ?? 90000
  const fb = opts.fallback ?? true
  let chain: string[]
  if ((['executor', 'reasoning', 'fast', 'content'] as string[]).includes(modelKeyOrRole)) {
    chain = FALLBACKS[modelKeyOrRole as Role]
  } else {
    const entry = entryByKey(modelKeyOrRole)
    if (!entry) throw new Error(`unknown model key: ${modelKeyOrRole}`)
    chain = fb ? [entry.key, ...FALLBACKS[entry.role].filter((k) => k !== entry.key)] : [entry.key]
  }
  const errors: string[] = []
  let attempted = 0
  let rateLimitedCount = 0
  const rateLimitAfters: number[] = []
  for (const k of chain) {
    const entry = entryByKey(k)
    if (!entry || !keyFor(entry.provider)) { errors.push(`${k}: no entry/key`); continue }
    // B1: rate-guard cross-process
    const guarded = guardedFor(entry.provider)
    if (guarded > 0) { errors.push(`${k}: rate-guard còn ${Math.round(guarded / 1000)}s`); rateLimitedCount++; rateLimitAfters.push(guarded); continue }
    attempted++
    try {
      return await callOneRaw(entry, messages, opts.tools, maxTokens, timeoutMs)
    } catch (e) {
      const msg = String(e instanceof Error ? e.message : e)
      errors.push(msg)
      if (e instanceof RateLimitError) { rateLimitedCount++; rateLimitAfters.push(e.retryAfterMs); markGuarded(entry.provider, e.retryAfterMs, msg) }
    }
  }
  // Có ÍT NHẤT 1 provider 429 + cả chuỗi fail → PARK (back-off), KHÔNG fail.
  // mixed 429+500: retry ngay vô ích vì đang bị giới hạn → park + notify mới đúng + tiết kiệm token.
  if (attempted > 0 && rateLimitedCount > 0) {
    const maxRa = Math.max(...rateLimitAfters, DEFAULT_RETRY_AFTER_MS)
    throw new RateLimitError(`providers rate-limited (${rateLimitedCount}/${attempted}): ${errors.join(' | ')}`, maxRa)
  }
  throw new Error(`all providers (raw) failed: ${errors.join(' | ')}`)
}

/** Lane có dùng được không (có ÍT NHẤT 1 key trong chain của model/role)? — để worker chọn runner. */
/** Tìm model lane rẻ nhất đang available (có key). */
export function cheapestAvailableLaneKey(): string | null {
  for (const m of MODEL_CATALOG) {
    if (laneAvailable(m.key)) return m.key
  }
  return null
}

export function laneAvailable(modelKeyOrRole: string): boolean {
  let chain: string[]
  if ((['executor', 'reasoning', 'fast', 'content'] as string[]).includes(modelKeyOrRole)) chain = FALLBACKS[modelKeyOrRole as Role]
  else { const e = entryByKey(modelKeyOrRole); if (!e) return false; chain = [e.key, ...FALLBACKS[e.role]] }
  return chain.some((k) => { const e = entryByKey(k); return e && !!keyFor(e.provider) })
}

// -- L4: OpenRouter catalog scrape -- phat hien model free moi, merge vao catalog dong --
let _orExtra: ModelEntry[] = []
export function getDynamicCatalog(): ModelEntry[] {
  return _orExtra.length ? [...MODEL_CATALOG, ..._orExtra] : MODEL_CATALOG
}
export async function refreshOpenRouterCatalog(): Promise<{ discovered: number; total: number }> {
  loadEnvFile()
  const key = keyFor('openrouter')
  if (!key) return { discovered: 0, total: MODEL_CATALOG.length }
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), 12000)
  try {
    const res = await fetch('https://openrouter.ai/api/v1/models', {
      headers: { 'Authorization': `Bearer ${key}`, 'X-Title': 'Lucy' },
      signal: ctrl.signal,
    })
    if (!res.ok) return { discovered: 0, total: MODEL_CATALOG.length }
    const data = await res.json() as { data?: { id: string; name?: string; context_length?: number; pricing?: { prompt?: string; completion?: string }; supported_parameters?: string[] }[] }
    const knownModelIds = new Set(MODEL_CATALOG.map((m) => m.model))
    const extras: ModelEntry[] = []
    for (const m of data.data || []) {
      if (!m.id) continue
      const isFreePrice = m.pricing?.prompt === '0' && m.pricing?.completion === '0'
      const isFreeSuffix = m.id.endsWith(':free')
      if (!isFreePrice && !isFreeSuffix) continue
      if (knownModelIds.has(m.id)) continue
      if (m.id.startsWith('anthropic/')) continue
      const slug = ('or-disc-' + m.id.replace(/[^a-z0-9]/gi, '-').toLowerCase().replace(/-+/g, '-').replace(/^-|-$/g, '')).slice(0, 40)
      const hasTools = Array.isArray(m.supported_parameters) && m.supported_parameters.includes('tools')
      const ctx = m.context_length
        ? m.context_length >= 1_000_000 ? '1M' : m.context_length >= 100_000 ? Math.round(m.context_length / 1000) + 'k' : String(m.context_length)
        : undefined
      extras.push({ key: slug, label: (m.name || m.id) + ' (OR)', provider: 'openrouter', model: m.id, role: hasTools ? 'executor' : 'content', free: true, ctx, note: 'auto-discovered' })
    }
    _orExtra = extras
    return { discovered: extras.length, total: MODEL_CATALOG.length + extras.length }
  } catch { return { discovered: 0, total: MODEL_CATALOG.length } }
  finally { clearTimeout(timer) }
}
