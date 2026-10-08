// Lucy Hub API client
export async function me(): Promise<{ authed: boolean; twofa?: boolean }> {
  const r = await fetch('/api/me')
  return r.json()
}

export async function login(password: string, code?: string): Promise<{ ok: boolean; need_code?: boolean; bad_code?: boolean }> {
  const r = await fetch('/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ password, code }),
  })
  try { return await r.json() } catch { return { ok: r.ok } }
}

// scope: chuỗi key (vd 'proj:<id>') → Lucy DỰ ÁN dùng phiên độc lập, KHÔNG đụng chat tổng. Bỏ trống = chat tổng.
export async function send(prompt: string, opus: boolean, scope?: string) {
  const r = await fetch('/api/send', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ prompt, opus, scope }),
  })
  return r.json() as Promise<{ job_id: string }>
}

export async function chatHistory(): Promise<{ messages: { role: 'me' | 'lucy'; text: string; t: number }[]; id?: string; title?: string }> {
  const r = await fetch('/api/chat'); return r.json()
}
export async function newChat(): Promise<{ id?: string }> { const r = await fetch('/api/chat/new', { method: 'POST' }); return r.json().catch(() => ({})) }

// Phase J — chat đa-phiên
export type ChatConv = { id: string; title: string; updatedAt: number; count: number }
export async function listChats(): Promise<{ chats: ChatConv[]; currentId: string }> { const r = await fetch('/api/chats'); return r.json() }
export async function switchChat(id: string): Promise<{ messages: { role: 'me' | 'lucy'; text: string; t: number }[]; title: string }> {
  const r = await fetch('/api/chats/switch', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id }) }); return r.json()
}
export async function renameChat(id: string, title: string) { await fetch('/api/chats/rename', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id, title }) }) }
export async function deleteChat(id: string) { await fetch('/api/chats/delete', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id }) }) }

export type Poll = {
  status: string
  result: string | null
  elapsed: number
  model: string
  session_id: string | null
}
export async function poll(jobId: string): Promise<Poll> {
  const r = await fetch('/api/poll/' + jobId)
  return r.json()
}

export type JobRow = { id: string; status: string; model: string; prompt: string; elapsed: number }
export async function jobs(): Promise<{ jobs: JobRow[] }> {
  const r = await fetch('/api/jobs'); return r.json()
}

// ---- Agent-Machine (Board + Channels) ----
export type AmCard = {
  id: string; title: string; brief: string; pipelineId: string; projectId: string; stageIndex: number
  status: string; depth: number; blockedBy: string[]; pendingQuestion?: string
  personaOverride?: string; modelOverride?: string
  parentId?: string; cost: { usd: number }; updatedAt?: number; reviewNotes?: string[]
  workspace?: string; artifacts?: { files?: string[]; diffstat?: string; stage?: string; isRepo?: boolean }
  lastSummary?: string; waitKind?: 'gate' | 'decision' | 'cost' | 'loop' | 'stuck' | 'size-gate'; blockKind?: 'dep' | 'delegate'; retryAfter?: number
  history?: { ts: number; stage: string; event: string; detail?: string }[]
  reports?: { stage: string; persona: string; text: string; ts: number }[] // C1: narrative đầy đủ agent đã làm gì mỗi stage
}
export type AmMsg = { ts: number; channel: string; author: string; kind: string; text: string; cardId?: string }
export type AmStage = { id: string; name: string; personaId: string; gate?: boolean }
export type AmPipeline = { id: string; name: string; stages: AmStage[] }
export type AmPersona = { id: string; name: string; avatar?: string; model?: 'sonnet' | 'opus'; laneModel?: string; realm?: string; kind?: 'orchestrator' | 'specialist' | 'executor'; tags?: string[]; systemPrompt?: string; allowedTools?: string[]; maxTurns?: number; timeoutSec?: number }
// K4 persona registry CRUD (full persona gồm systemPrompt — màn quản expert)
export async function amPersonas(): Promise<{ configured: boolean; offline?: boolean; personas: AmPersona[] }> {
  const r = await fetch('/api/personas'); return r.json()
}
export async function amSavePersona(p: AmPersona): Promise<{ ok?: boolean; persona?: AmPersona; error?: string }> {
  const r = await fetch('/api/personas', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(p) })
  return r.json().catch(() => ({ error: 'phản hồi lỗi' }))
}
export async function amDeletePersona(id: string): Promise<{ ok?: boolean; error?: string }> {
  const r = await fetch('/api/personas/' + encodeURIComponent(id), { method: 'DELETE' })
  return r.json().catch(() => ({ error: 'phản hồi lỗi' }))
}

// M3.5 persona chat đa lượt + auto-routing
export type PersonaChatMsg = { role: 'user' | 'assistant'; content: string }
export type PersonaChatReply = { ok?: boolean; off?: boolean; error?: string; answer?: string; personaId?: string; personaName?: string; trace?: { name: string; input: string; result: string }[]; model?: string }
export async function amPersonaChat(personaId: string, message: string, history: PersonaChatMsg[]): Promise<PersonaChatReply> {
  const r = await fetch('/api/persona/chat', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ personaId, message, history }) })
  return r.json().catch(() => ({ error: 'phản hồi lỗi' }))
}
export type PersonaRouteRanked = { personaId: string; name: string; score: number; tagScore: number; vecScore: number }
export type PersonaRouteReply = { ok?: boolean; off?: boolean; error?: string; personaId?: string | null; name?: string; confidence?: number; why?: string; mode?: string; ranked?: PersonaRouteRanked[] }
export async function amPersonaRoute(question: string): Promise<PersonaRouteReply> {
  const r = await fetch('/api/persona/route', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ question }) })
  return r.json().catch(() => ({ error: 'phản hồi lỗi' }))
}
// T5 MCP "Kết nối" — trạng thái server MCP
export type McpUiState = 'master-off' | 'disabled' | 'needs-creds' | 'tripped' | 'live'
export type McpServerInfo = {
  id: string; title: string; scopes: string[]; status: 'live' | 'scaffold'
  doc: string; scopeLabel: string
  envKeys: string[]; credsMissing: string[]
  masterOn: boolean; serverEnabled: boolean; tripped: boolean
  state: McpUiState
}
export async function amMcp(): Promise<{ configured: boolean; offline?: boolean; masterOn: boolean; servers: McpServerInfo[]; error?: string }> {
  const r = await fetch('/api/mcp'); return r.json().catch(() => ({ configured: false, masterOn: false, servers: [] }))
}

// T6 Skill "Kỹ năng" — active (INDEX) + proposed (_proposed, M3.3 self-improve)
export type SkillInfo = { name: string; description: string; path: string }
export async function amSkills(): Promise<{ configured: boolean; offline?: boolean; learnOn: boolean; activeCount?: number; proposedCount?: number; active: SkillInfo[]; proposed: SkillInfo[]; error?: string }> {
  const r = await fetch('/api/skills'); return r.json().catch(() => ({ configured: false, learnOn: false, active: [], proposed: [] }))
}

export type AmProject ={ id: string; name: string; repoUrl?: string; branch?: string; description?: string; skill?: string; channels: string[]; createdAt: number; updatedAt?: number; trashed?: boolean }
export async function amState(): Promise<{ configured: boolean; offline?: boolean; cards: AmCard[]; projects?: AmProject[]; channels: AmMsg[]; pipelines?: AmPipeline[]; personas?: AmPersona[] }> {
  const r = await fetch('/api/am/state'); return r.json()
}
export async function amCreateProject(name: string, opts: { repoUrl?: string; branch?: string; description?: string; skill?: string } = {}) {
  const r = await fetch('/api/am/project', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name, ...opts }) }); return r.json()
}
export async function amRemoveProject(projectId: string) {
  await fetch('/api/am/project/remove', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ projectId }) })
}
export async function amTrashProject(projectId: string) { await fetch('/api/am/project/trash', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ projectId }) }) }
export async function amRestoreProject(projectId: string) { await fetch('/api/am/project/restore', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ projectId }) }) }
export async function amPurgeProject(projectId: string) { await fetch('/api/am/project/purge', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ projectId }) }) }
export async function amAddChannel(projectId: string, name: string) {
  await fetch('/api/am/project/channel', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ projectId, name }) })
}
export async function amPostChannel(projectId: string, channel: string, text: string, mention?: string) {
  await fetch('/api/am/channel/post', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ projectId, channel, text, mention }) })
}
export async function amLogLucy(projectId: string, role: 'me' | 'lucy', text: string) {
  await fetch('/api/am/lucy/log', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ projectId, role, text }) })
}
export async function amUpsertPipeline(p: { id?: string; name: string; stages: { name: string; personaId: string; gate?: boolean }[] }) {
  const r = await fetch('/api/am/pipeline', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(p) }); return r.json()
}
export async function amRemovePipeline(id: string) {
  await fetch('/api/am/pipeline/remove', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id }) })
}
export async function amConfig(): Promise<{ configured: boolean; offline?: boolean; maxLanes?: number; perCardMaxUsd?: number; queued?: number; inFlight?: number }> {
  const r = await fetch('/api/am/config'); return r.json()
}
export async function amSetLanes(maxLanes: number) {
  const r = await fetch('/api/am/config', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ maxLanes }) }); return r.json()
}
export async function amCreateCard(title: string, brief: string, pipelineId: string, projectId: string, deferred = false, model?: 'sonnet' | 'opus' | 'laneModel', blockedBy?: string[], personaId?: string) {
  const r = await fetch('/api/am/card', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ title, brief, pipelineId, projectId, deferred, model, blockedBy, personaId }) }); return r.json()
}
export async function amRemoveCard(cardId: string) {
  await fetch('/api/am/card/remove', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ cardId }) })
}
export async function amActivate(cardId: string) {
  await fetch('/api/am/card/activate', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ cardId }) })
}
export async function amApprove(cardId: string) {
  await fetch('/api/am/approve', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ cardId }) })
}
export async function amReject(cardId: string, feedback: string) {
  await fetch('/api/am/reject', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ cardId, feedback }) })
}
export async function amAnswer(cardId: string, text: string) {
  await fetch('/api/am/answer', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ cardId, text }) })
}

export type Entry = { name: string; type: 'dir' | 'file' }
export async function tree(p: string): Promise<{ root: string; path: string; entries: Entry[] }> {
  const r = await fetch('/api/tree?path=' + encodeURIComponent(p)); return r.json()
}
export async function readFile(p: string): Promise<{ binary?: boolean; tooBig?: boolean; name?: string; content?: string; size?: number }> {
  const r = await fetch('/api/file?path=' + encodeURIComponent(p)); return r.json()
}

// ---- METRICS ----
export type MetricsProvider = { provider: string; label: string; hasKey: boolean }
// DASH-FIX S4: thêm cột in·out·cache (kiểu Hermes). tokens = tổng cả 3.
export type MetricsCostEntry = { model: string; usd: number; tokens: number; inTok?: number; outTok?: number; cacheTok?: number }
export type MetricsAgentEntry = { agent: string; usd: number; tokens: number; inTok?: number; outTok?: number; cacheTok?: number }
export type MetricsSourceEntry = { source: string; usd: number; tokens: number; inTok: number; outTok: number; cacheTok: number }
export type MetricsCardEntry = { cardId: string; title: string; usd: number; tokens: number }
export type MetricsAlert = { kind: string; message: string }
export type TokenGuardStatus = { ok: boolean; soft: boolean; hard: boolean; used: number; softLimit: number; hardLimit: number }
// M5 time-series cho sparkline — t = mốc bắt đầu bucket (ms). Bucket rỗng = 0 thật.
export type SeriesPoint = { t: number; tokens: number; usd: number; runs: number }
export type SeriesRange = '24h' | '7d' | '30d'
export type MetricsSeries = Record<SeriesRange, SeriesPoint[]>
export type MetricsData = {
  configured: boolean; offline?: boolean
  tokenDay: number; tokenMonth: number
  costDay: number; costMonth: number
  costByModel: MetricsCostEntry[]
  costByAgent: MetricsAgentEntry[]
  costBySource?: MetricsSourceEntry[]
  costByCard: MetricsCardEntry[]
  cardsRunning: number; cardsWaiting: number; cardsTotal: number
  providers: MetricsProvider[]
  alerts: MetricsAlert[]
  series?: MetricsSeries
  tokenGuard?: { configured: boolean; status?: TokenGuardStatus }
}
export async function metricsData(): Promise<MetricsData> {
  const r = await fetch('/api/metrics'); return r.json()
}

// ---- ERROR-STATS (turn-log) — khai literal union ở FE, KHÔNG import từ backend ----
export type ErrorCategory =
  | 'llm-error' | 'out-of-turns' | 'salvage' | 'build-fail'
  | 'spec-fail' | 'loop' | 'wrong-output' | 'other'
export type ErrorByCategory = { category: ErrorCategory; count: number }
export type ErrorByAgent = { agent: string; count: number; byCategory: Record<ErrorCategory, number> }
export type ErrorByModel = { model: string; count: number; byCategory: Record<ErrorCategory, number> }
export type ErrorStatsData = {
  configured: boolean; offline?: boolean
  total: number
  byCategory: ErrorByCategory[]
  byAgent: ErrorByAgent[]
  byModel: ErrorByModel[]
  topCategory: ErrorCategory | null
  scope: string
}
export async function errorStatsData(): Promise<ErrorStatsData> {
  const r = await fetch('/api/error-stats'); return r.json()
}

// ---- BỘ NÃO (M1: recall + vault + dream) ----
export type BrainEntry = { path: string; title: string; type: string; status?: string }
export type BrainPref = { id: string; topic: string; principle: string; sign: string; status: string; confidence: number; band: string; scope?: string; pinned: boolean; path: string }
export type BrainSig = { id: string; topic: string; signal: string; principle: string; agent: string; created_at: string; path: string }
export type BrainHit = { file_path: string; title: string; type: string; permalink: string; tags: string; mtime: number; snippet: string; rank: number; relaxed: boolean; tri?: boolean }
export type BrainRelated = { file_path: string; title: string; permalink: string; via: string }
export type BrainState = {
  configured: boolean; offline?: boolean
  tree?: { dir: string; files: BrainEntry[] }[]
  active?: string; preferences?: BrainPref[]; inbox?: BrainSig[]
  stats?: { total: number; observations: number }
}
export type DreamSummary = { changed: boolean; graduated: string[]; redundant: number; contradictions: string[]; rebutted: string[]; retired: string[]; confirmed: string[]; processedSignals: number; activePrefs: number }

export type GraphNode = { id: string; label: string; kind: string; zone: string; mass: number; brightness: number; mtime: number; obs: number; path?: string; confidence?: number; band?: string; sign?: string; status?: string; topic?: string; ghost?: boolean }
export type GraphLink = { source: string; target: string; rel: string; weight: number; real: boolean }
export type BrainGraph = { configured: boolean; offline?: boolean; nodes?: GraphNode[]; links?: GraphLink[]; born?: string[]; ts?: number }
export async function brainGraph(bornMs = 0): Promise<BrainGraph> { const r = await fetch('/api/brain/graph?bornMs=' + bornMs); return r.json() }

export async function brainState(): Promise<BrainState> { const r = await fetch('/api/brain/state'); return r.json() }
export async function brainRecall(q: string): Promise<{ configured: boolean; hits?: BrainHit[]; related?: BrainRelated[] }> {
  const r = await fetch('/api/brain/recall?q=' + encodeURIComponent(q)); return r.json()
}
export async function brainFile(path: string): Promise<{ configured?: boolean; path?: string; content?: string }> {
  const r = await fetch('/api/brain/file?path=' + encodeURIComponent(path)); return r.json()
}
export async function brainReindex(): Promise<{ configured?: boolean; stats?: { total: number; indexed: number; updated: number; deleted: number } }> {
  const r = await fetch('/api/brain/reindex', { method: 'POST' }); return r.json()
}
export async function brainDream(): Promise<{ configured?: boolean; summary?: DreamSummary }> {
  const r = await fetch('/api/brain/dream', { method: 'POST' }); return r.json()
}
// A1: ghi evidence applied/violated cho 1 preference → coordinator dream ngay → trả summary (confirm tức thì).
export async function brainEvidence(prefId: string, kind: 'applied' | 'violated'): Promise<{ ok?: boolean; summary?: DreamSummary }> {
  const r = await fetch('/api/brain/evidence', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ prefId, kind }) }); return r.json()
}
// B: pin/unpin 1 preference (📌 → miễn auto-retire).
export async function brainPin(prefId: string, pinned: boolean): Promise<{ ok?: boolean }> {
  const r = await fetch('/api/brain/pin', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ prefId, pinned }) }); return r.json()
}


// ---- Phase D: model picker + rate-guard panel + chat streaming ----
export type LlmModel = { key: string; label: string; provider: string; free: boolean; role: string; note?: string; ctx?: string }
export type ClaudeModel = { key: string; label: string; model: string; tier: 'fast' | 'balanced' | 'deep'; note?: string; default?: boolean }
export async function llmModels(): Promise<{ configured: boolean; offline?: boolean; catalog: LlmModel[]; claudeModels?: ClaudeModel[]; router: string; routeTable: Record<string, string[]> }> {
  const r = await fetch('/api/llm/models'); return r.json()
}
export type GuardData = {
  configured: boolean; offline?: boolean
  guarded: { provider: string; secondsLeft: number; reason: string }[]
  quota: Record<string, { remainingRequests?: number; remainingTokens?: number; resetAt?: number; creditsRemainingUsd?: number; updatedAt: number }>
}
export async function llmGuard(): Promise<GuardData> { const r = await fetch('/api/llm/guard'); return r.json() }
export async function llmCatalogRefresh(): Promise<{ discovered: number; total: number }> { const r = await fetch('/api/llm/catalog-refresh', { method: 'POST' }); return r.json() }

// ---- PROMPT ARCHITECT (cụm B) — flag LUCY_PROMPT_ARCHITECT ở server. Tab chỉ hiện khi status.enabled ----
export type PromptSession = {
  id: number; ts: number; source: string; chatId: string; targetModel: string
  contextInput: string; clarifyAsked: string; finalPrompt: string
  userEdit: string; laneModel: string; escalated: number
}
export type PromptArchHistMsg = { role: 'user' | 'assistant'; content: string }
// CỤM C/D: scorecard rubric DETERMINISTIC (intel.scorePromptDraft) — tab render điểm + chỗ yếu.
export type PromptCriterion = { key: string; label: string; score: number; weight: number; note: string }
export type PromptScorecard = { total: number; criteria: PromptCriterion[]; weak: string[]; summary: string }
export type PromptArchResult = { answer: string; clarifying: boolean; finalPrompt: string; sessionId: number | null; laneModel: string; escalated: boolean; scorecard?: PromptScorecard; variants?: string[]; preferenceApplied?: boolean; error?: string }
export async function promptArchStatus(): Promise<{ enabled: boolean }> {
  const r = await fetch('/api/prompts/status'); return r.json().catch(() => ({ enabled: false }))
}
export async function promptArchHistory(limit = 20): Promise<{ enabled: boolean; sessions: PromptSession[] }> {
  const r = await fetch('/api/prompts/history?limit=' + limit); return r.json().catch(() => ({ enabled: false, sessions: [] }))
}
// run = SSE (giống chatStream). FinalEv mang meta (clarifying / finalPrompt / sessionId).
// CỤM D: final event mang thêm scorecard/variants/preferenceApplied (server đã phát) để tab render điểm + đa biến thể.
export type PromptArchEv = { type: 'delta' | 'route' | 'final' | 'done' | 'error'; text?: string; model?: string; clarifying?: boolean; finalPrompt?: string; sessionId?: number | null; laneModel?: string; escalated?: boolean; scorecard?: PromptScorecard; variants?: string[]; preferenceApplied?: boolean }
export async function promptArchRun(context: string, history: PromptArchHistMsg[], targetModel: string | undefined, onEvent: (e: PromptArchEv) => void, variants?: number): Promise<void> {
  const res = await fetch('/api/prompts/run', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ context, history, targetModel, variants }) })
  if (!res.ok || !res.body) { onEvent({ type: 'error', text: 'HTTP ' + res.status }); return }
  const reader = res.body.getReader(); const dec = new TextDecoder(); let buf = ''
  for (;;) {
    const { done, value } = await reader.read(); if (done) break
    buf += dec.decode(value, { stream: true })
    let idx: number
    while ((idx = buf.indexOf('\n\n')) >= 0) {
      const chunk = buf.slice(0, idx); buf = buf.slice(idx + 2)
      const line = chunk.split('\n').find((l) => l.startsWith('data:'))
      if (!line) continue
      try { onEvent(JSON.parse(line.slice(5).trim())) } catch { /* chunk lỗi → bỏ */ }
    }
  }
}
export async function promptArchEscalate(context: string, history: PromptArchHistMsg[], targetModel: string | undefined, sessionId: number | null): Promise<PromptArchResult> {
  const r = await fetch('/api/prompts/escalate', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ context, history, targetModel, sessionId }) })
  return r.json().catch(() => ({ answer: '', clarifying: false, finalPrompt: '', sessionId: null, laneModel: '', escalated: true, error: 'phản hồi lỗi' }))
}
export async function promptArchEdit(sessionId: number, edit: string): Promise<{ ok?: boolean; error?: string }> {
  const r = await fetch('/api/prompts/edit', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ sessionId, edit }) })
  return r.json().catch(() => ({ error: 'phản hồi lỗi' }))
}

export type StreamEv = { type: 'delta' | 'thinking' | 'route' | 'final' | 'done' | 'error' | 'tool_use' | 'tool_result' | 'usage'; text?: string; model?: string; name?: string; input?: string; id?: string; inTok?: number; cacheTok?: number; outTok?: number }
// Phase D (D1): chat streaming — POST /api/chat/stream, đọc SSE qua fetch ReadableStream → onEvent mỗi chunk.
export async function chatStream(prompt: string, model: string, onEvent: (e: StreamEv) => void, signal?: AbortSignal): Promise<void> {
  const res = await fetch('/api/chat/stream', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ prompt, model }), signal })
  if (!res.ok || !res.body) { onEvent({ type: 'error', text: 'HTTP ' + res.status }); return }
  const reader = res.body.getReader(); const dec = new TextDecoder(); let buf = ''
  for (;;) {
    if (signal?.aborted) { try { await reader.cancel() } catch { /* */ } break }
    const { done, value } = await reader.read(); if (done) break
    buf += dec.decode(value, { stream: true })
    let idx: number
    while ((idx = buf.indexOf('\n\n')) >= 0) {
      const chunk = buf.slice(0, idx); buf = buf.slice(idx + 2)
      const line = chunk.split('\n').find((l) => l.startsWith('data:'))
      if (!line) continue
      try { onEvent(JSON.parse(line.slice(5).trim())) } catch { /* chunk lỗi → bỏ */ }
    }
  }
}

// ---- Tab VPS + Cây tri thức ----
export type SystemStats = {
  load1: number; load5: number; load15: number; cores: number
  memTotal: number; memAvail: number; swapTotal: number; swapUsed: number
  diskTotal: number; diskUsed: number; diskAvail: number; uptimeSec: number
  pm2: { name: string; status: string; cpu: number; memMB: number; restarts: number; uptimeMin: number; port?: number; url?: string }[]
}
export async function systemStats(): Promise<SystemStats> { const r = await fetch('/api/system'); return r.json() }
export async function vpsTools(): Promise<{ tools: { id: string; label: string }[]; running: string | null }> {
  const r = await fetch('/api/vps/tools'); return r.json()
}
export async function vpsClean(tool: string): Promise<{ job_id?: string; error?: string }> {
  const r = await fetch('/api/vps/clean', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ tool }) })
  return r.json()
}
export type KGraphSrc = 'vault' | 'vps' | 'code' | 'files'
export type KGraphNode = { id: string; label: string; kind: string; layer: number; meta?: string; val?: number; url?: string }
// building = mode 'code' đang build nền lần đầu (FE poll lại); stale = trả bản cũ trong lúc rebuild
export type KGraphData = { nodes: KGraphNode[]; edges: { source: string; target: string; rel: string; hier: boolean }[]; building?: boolean; stale?: boolean }
export async function kgraph(src: KGraphSrc, daily = false): Promise<KGraphData> {
  const r = await fetch(`/api/kgraph?src=${src}${daily ? '&daily=1' : ''}`)
  if (!r.ok && r.status !== 202) throw new Error('kgraph ' + r.status)
  return r.json()
}
// Memory rác: quét note rỗng/trùng/conflict → dọn = move vào vault/.trash (khôi phục được)
export type MemJunkItem = { path: string; size: number; reason: string }
export async function memoryJunk(): Promise<{ items: MemJunkItem[]; total: number; bytes: number }> {
  const r = await fetch('/api/memory/junk')
  if (!r.ok) throw new Error('junk ' + r.status)
  return r.json()
}
export async function memoryClean(paths: string[]): Promise<{ moved: number; trash: string; errors: string[] }> {
  const r = await fetch('/api/memory/clean', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ paths }) })
  if (!r.ok) throw new Error('clean ' + r.status)
  return r.json()
}
