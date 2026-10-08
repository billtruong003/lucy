// Coordinator — chạy trên VPS (nhẹ): giữ board/queue/channels, KHÔNG chạy claude -p.
// Worker (máy local) quay ra qua HTTP: claim job -> chạy -> submit result.
import http from 'node:http'
import path from 'node:path'
import os from 'node:os'
import { chatLaneAgentic, consultExpert } from './lane-chat'   // Phase M: lane chat có tool (web/file/bash)
import type { Engine, JobSpec } from './engine'
import type { Store } from './store'
import type { Recall } from './recall'
import { episodicFlagOn } from './recall'
import { browseVault, readVaultFile, listPreferences, listInbox, readActive, buildGraph, setPinned } from './brain'
import { dream } from './dream'
import { recordEvidence, hasManualEvidenceToday } from './evidence'
import { buildMetrics, buildSeries } from './metrics'
import { vnDay } from './tz'
import { buildErrorStats } from './error-stats'
import { getDynamicCatalog, providerStatus, refreshOpenRouterCatalog, CLAUDE_CHAT_MODELS } from './llm-lane'
import { chatLane, routeTask, routerModel, ROUTE_TABLE } from './chat-lane'
import { appendOutcome, readOutcomes, groupByModel, type RoutingOutcome } from './routing-outcome'
import { guardSnapshot } from './rate-guard'
import { quotaSnapshot } from './quota'
import { sanitizePersona, writePersonaFile, deletePersonaFile } from './persona-config'
import { personaChat, personaRoute, personaChatFlagOn, sanitizeHistory } from './persona-chat'
import { mcpRegistryOverview } from './mcp-registry'
import { skillsOverview } from './skill-loader'
import { runPromptArchitect, promptArchitectFlagOn } from './prompt-architect'
import { usdFor } from './pricing'
import { writeSessionSummary, sessionSummaryFlagOn } from './session-summary'
import type { LedgerSource } from './types'

function serializeJob(j: JobSpec) {
  // worker không cần workspace của coordinator — nó tự tạo workspace local.
  // persona đã được engine.claim() áp modelOverride (nếu có) -> gửi nguyên.
  return { jobId: j.jobId, cardId: j.cardId, card: { id: j.card.id, title: j.card.title, brief: j.card.brief, reviewNotes: j.card.reviewNotes, lastSummary: j.card.lastSummary }, stage: j.stage, persona: j.persona, repo: j.repo }
}

async function readBody(req: http.IncomingMessage): Promise<any> {
  return new Promise((resolve) => {
    let s = ''
    req.on('data', (d) => (s += d))
    req.on('end', () => { try { resolve(s ? JSON.parse(s) : {}) } catch { resolve({}) } })
  })
}

export function startCoordinator(engine: Engine, store: Store, port: number, opts: { autoTickMs?: number; token?: string; host?: string; recall?: Recall | null; vaultDir?: string; configDir?: string } = {}) {
  let timer: ReturnType<typeof setInterval> | null = null
  if (opts.autoTickMs) timer = setInterval(() => { try { engine.tick() } catch { /* */ } }, opts.autoTickMs)
  const vaultDir = opts.vaultDir
  const configDir = opts.configDir
  const recall = opts.recall ?? null
  const brainOn = !!(recall && vaultDir)
  // auto-reindex debounce: agent ghi note vào vault GIỮA phiên → search vẫn thấy mà không reindex mỗi request
  // (reindex incremental so mtime+checksum — vault nhỏ thì rẻ, nhưng vẫn chặn spam). Warm lúc start ở coordinator-main.
  let lastReindex = Date.now()
  const freshIndex = () => {
    if (!recall || Date.now() - lastReindex < 30_000) return
    lastReindex = Date.now()
    try { recall.reindex() } catch { /* index hỏng không được chặn route đọc */ }
  }
  // PHASE 2 episodic: flag bật ghi/đọc turn hội thoại; retention dọn turn cũ (debounce 1h, mặc định 90 ngày).
  const episodicOn = episodicFlagOn()
  const retentionDays = Number(process.env.LUCY_EPISODIC_RETENTION_DAYS) || 90
  let lastPrune = 0
  const maybePrune = () => {
    if (!recall || !episodicOn || Date.now() - lastPrune < 3600_000) return
    lastPrune = Date.now()
    try { recall.pruneTurns(retentionDays) } catch { /* retention không được chặn ghi turn */ }
  }
  if (recall && episodicOn) maybePrune() // dọn 1 lần lúc start

  const server = http.createServer(async (req, res) => {
    const send = (code: number, obj: unknown) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(obj)) }
    const url = (req.url || '').split('?')[0]
    const qs = new URLSearchParams((req.url || '').split('?')[1] || '')
    // auth: token bảo vệ MỌI endpoint (trừ /health) — chống tạo card/đọc state trái phép (RCE qua /card).
    // Hub proxy + worker đều gửi header x-worker-token. KHÔNG để hở khi expose public.
    if (opts.token && url !== '/health' && req.headers['x-worker-token'] !== opts.token) return send(401, { error: 'bad token' })
    try {
      if (req.method === 'POST' && url === '/tick') return send(200, { did: engine.tick() })
      if (url === '/config') {
        if (req.method === 'POST') { const b = await readBody(req); engine.setLimits(b) }
        return send(200, engine.limits()) // GET hoặc POST đều trả limits hiện tại (dynamic)
      }
      if (req.method === 'POST' && url === '/worker/claim') { const j = engine.claim(); return send(200, { job: j ? serializeJob(j) : null }) }
      if (req.method === 'POST' && url === '/worker/result') { const b = await readBody(req); engine.submit(b.jobId, b.result); return send(200, { ok: true }) }
      if (req.method === 'POST' && url === '/card') {
        const b = await readBody(req)
        const mdl = (b.model === 'opus' || b.model === 'sonnet' || b.model === 'laneModel') ? b.model : undefined
        // BUG-1a: laneModel chỉ hợp lệ cho persona CÓ field laneModel — từ chối LOUD, không no-op im lặng
        if (mdl === 'laneModel') {
          const pid = b.personaId || (b.pipelineId && store.pipelines.get(b.pipelineId)?.stages[0]?.personaId)
          if (pid) {
            const persona = store.personas.get(pid)
            if (persona && !persona.laneModel) return send(400, { error: `Persona '${persona.name}' không có laneModel — bỏ chọn 'rẻ' hoặc chọn agent có lane.` })
          }
        }
        const quality = b.quality === 'thorough' ? 'thorough' : undefined // B4
        return send(200, { card: engine.createCard(b.title, b.brief, b.pipelineId, undefined, 0, b.projectId || 'default', !!b.deferred, mdl, Array.isArray(b.blockedBy) ? b.blockedBy : [], b.personaId || undefined, quality) })
      }
      // B4: bật/tắt quality-first cho card đang chạy
      if (req.method === 'POST' && url === '/card/quality') {
        const b = await readBody(req); const c = store.getCard(b.cardId)
        if (!c) return send(404, { error: 'card không tồn tại' })
        c.quality = b.quality === 'thorough' ? 'thorough' : undefined; store.putCard(c)
        return send(200, { ok: true, quality: c.quality || 'fast' })
      }
      if (req.method === 'POST' && url === '/card/remove') { const b = await readBody(req); return send(200, { ok: engine.removeCard(b.cardId) }) }
      if (req.method === 'POST' && url === '/card/activate') { const b = await readBody(req); engine.activate(b.cardId); return send(200, { ok: true }) }
      if (req.method === 'POST' && url === '/project') { const b = await readBody(req); return send(200, { project: engine.createProject(b.name, { repoUrl: b.repoUrl, branch: b.branch, description: b.description, skill: b.skill }) }) }
      if (req.method === 'POST' && url === '/project/remove') { const b = await readBody(req); return send(200, { ok: engine.removeProject(b.projectId) }) }
      if (req.method === 'POST' && url === '/project/trash') { const b = await readBody(req); return send(200, { ok: engine.trashProject(b.projectId) }) }
      if (req.method === 'POST' && url === '/project/restore') { const b = await readBody(req); return send(200, { ok: engine.restoreProject(b.projectId) }) }
      if (req.method === 'POST' && url === '/project/purge') { const b = await readBody(req); return send(200, { purged: engine.purgeProject(b.projectId) }) }
      if (req.method === 'POST' && url === '/pipeline') { const b = await readBody(req); return send(200, { pipeline: engine.upsertPipeline(b) }) }
      if (req.method === 'POST' && url === '/pipeline/remove') { const b = await readBody(req); return send(200, { ok: engine.deletePipeline(b.id) }) }
      if (req.method === 'POST' && url === '/project/channel') { const b = await readBody(req); return send(200, { ok: engine.addChannel(b.projectId, b.name) }) }
      if (req.method === 'POST' && url === '/project/channel/remove') { const b = await readBody(req); return send(200, { ok: engine.removeChannel(b.projectId, b.name) }) }
      if (req.method === 'POST' && url === '/channel/post') { const b = await readBody(req); engine.postHuman(b.projectId, b.channel, b.text || '', b.mention); return send(200, { ok: true }) }
      if (req.method === 'POST' && url === '/lucy/log') { const b = await readBody(req); engine.logLucy(b.projectId, b.role === 'me' ? 'me' : 'lucy', b.text || ''); return send(200, { ok: true }) }
      if (req.method === 'POST' && url === '/approve') { const b = await readBody(req); engine.approve(b.cardId, b.actor); return send(200, { ok: true }) }
      if (req.method === 'POST' && url === '/reject') { const b = await readBody(req); engine.reject(b.cardId, b.feedback || '', b.actor); return send(200, { ok: true }) }
      if (req.method === 'POST' && url === '/answer') { const b = await readBody(req); engine.answer(b.cardId, b.text || '', b.actor); return send(200, { ok: true }) }
      // ── TOKEN GUARD: trạng thái token/ngày (soft → hạ executor, hard → dừng) ──
      if (url === '/token-guard/reset') { if (req.method === 'POST') { engine.tokenGuard?.resetDay(); return send(200, { ok: true }) } }
      // ── DASH-FIX S1/S3: POST /spend = ĐƯỜNG GHI ĐỦ TRƯỜNG. Coordinator tính usd 1 chỗ (1 nguồn giá), python/hub chỉ gửi token.
      // body: {ts?, source, model, inTok, outTok, cacheReadTok?, cacheWriteTok?(hoặc cacheTok), usd?(worker tự trả)}.
      if (req.method === 'POST' && url === '/spend') {
        const b = await readBody(req)
        const sane = (v: unknown): number => { const n = Number(v); return Number.isFinite(n) && n > 0 ? n : 0 }
        const SOURCES: LedgerSource[] = ['worker', 'autobuild', 'bridge', 'hub', 'lane', 'cron', 'autotask', 'unknown']
        const source = SOURCES.includes(b.source) ? (b.source as LedgerSource) : 'unknown'
        const model = String(b.model || 'unknown')
        const inTok = sane(b.inTok), outTok = sane(b.outTok)
        const cacheRead = sane(b.cacheReadTok ?? b.cacheTok), cacheWrite = sane(b.cacheWriteTok)
        let usd = Number(b.usd)
        if (!Number.isFinite(usd) || usd < 0) usd = usdFor(model, { inTok, outTok, cacheReadTok: cacheRead, cacheWriteTok: cacheWrite })
        engine.recordSpend({ ts: Number(b.ts) || undefined, source, model, inTok, outTok, cacheTok: cacheRead + cacheWrite, usd, cardId: b.cardId ? String(b.cardId) : undefined, stage: b.stage ? String(b.stage) : undefined, persona: b.persona ? String(b.persona) : undefined })
        return send(200, { ok: true, usd, status: engine.tokenGuardStatus() })
      }
      // /token-guard/add = ALIAS cũ (chưa kịp migrate sang /spend) → recordSpend source='unknown', model='unknown' (usd=0, không attribution).
      if (req.method === 'POST' && url === '/token-guard/add') {
        const b = await readBody(req)
        const sane = (v: unknown): number => { const n = Number(v); return Number.isFinite(n) && n > 0 ? n : 0 }
        engine.recordSpend({ source: 'unknown', model: 'unknown', inTok: sane(b.inTok), outTok: sane(b.outTok), cacheTok: 0, usd: 0 })
        return send(200, { ok: true, status: engine.tokenGuardStatus() })
      }
      if (url === '/token-guard') { return send(200, engine.tokenGuardStatus()) }
      // ── LÁT API (lane model-rẻ): catalog cho dropdown + trạng thái key (KHÔNG lộ key) ──
      if (req.method === 'GET' && url === '/llm/models') return send(200, { catalog: getDynamicCatalog(), claudeModels: CLAUDE_CHAT_MODELS, providers: providerStatus(), routeTable: ROUTE_TABLE, router: routerModel() })
      // B1/B3: trạng thái rate-guard (provider đang bị limit) + quota free-tier còn lại
      if (req.method === 'POST' && url === '/llm/catalog-refresh') {
        try { return send(200, await refreshOpenRouterCatalog()) }
        catch (e) { return send(502, { error: String(e) }) }
      }
      if (req.method === 'GET' && url === '/llm/guard') return send(200, { guarded: guardSnapshot(), quota: quotaSnapshot() })
      // ── Đợt A: chat qua lane model FREE (claude-path do bridge tự lo, KHÔNG qua đây) ──
      if (req.method === 'POST' && url === '/chat-lane') {
        const b = await readBody(req)
        if (!b.model || !Array.isArray(b.messages)) return send(400, { error: 'cần {model, messages[]}' })
        try { return send(200, await chatLane(b.model, b.messages, { maxTokens: b.maxTokens })) }
        catch (e) { return send(502, { error: String(e instanceof Error ? e.message : e) }) }
      }
      // ── Phase M: lane chat AGENTIC — model rẻ có tool (web_search/web_fetch/read/bash…). Trả {answer, trace, usage}. ──
      if (req.method === 'POST' && url === '/chat-lane-agentic') {
        const b = await readBody(req)
        if (!b.model || !Array.isArray(b.messages)) return send(400, { error: 'cần {model, messages[]}' })
        const raw = String(process.env.LUCY_WORKDIR || path.join(os.homedir(), 'lucy-workspace'))
        const ws = raw.startsWith('~') ? path.join(os.homedir(), raw.slice(1)) : path.resolve(raw)
        try { return send(200, await chatLaneAgentic(String(b.model), b.messages, ws, { maxTurns: Number(b.maxTurns) || 12 })) }
        catch (e) { return send(502, { error: String(e instanceof Error ? e.message : e) }) }
      }
      // ── K2 consult_expert cho claude-path: hub gọi khi Claude dùng SDK MCP tool ──
      if (req.method === 'POST' && url === '/consult-expert') {
        const b = await readBody(req)
        if (!b.persona || !b.question) return send(400, { error: 'cần {persona, question}' })
        const raw = String(process.env.LUCY_WORKDIR || path.join(os.homedir(), 'lucy-workspace'))
        const ws = raw.startsWith('~') ? path.join(os.homedir(), raw.slice(1)) : path.resolve(raw)
        try { return send(200, { answer: await consultExpert(String(b.persona), String(b.question), ws) }) }
        catch (e) { return send(502, { error: String(e instanceof Error ? e.message : e) }) }
      }
      // ── M3.5 persona chat ĐA LƯỢT: mang đầy đủ danh tính persona + history. Flag LUCY_PERSONA_CHAT. ──
      if (req.method === 'POST' && url === '/persona-chat') {
        if (!personaChatFlagOn()) return send(200, { ok: false, off: true, error: 'LUCY_PERSONA_CHAT chưa bật' })
        const b = await readBody(req)
        const persona = store.personas.get(String(b.personaId || ''))
        if (!persona) return send(404, { error: `persona '${b.personaId}' không tồn tại` })
        if (!b.message || !String(b.message).trim()) return send(400, { error: 'cần {personaId, message}' })
        const raw = String(process.env.LUCY_WORKDIR || path.join(os.homedir(), 'lucy-workspace'))
        const ws = raw.startsWith('~') ? path.join(os.homedir(), raw.slice(1)) : path.resolve(raw)
        try { return send(200, { ok: true, ...(await personaChat(persona, String(b.message), sanitizeHistory(b.history), ws)) }) }
        catch (e) { return send(502, { error: String(e instanceof Error ? e.message : e) }) }
      }
      // ── M3.5 auto-routing: chọn chuyên gia hợp nhất (tag + embedding). Flag LUCY_PERSONA_CHAT. ──
      if (req.method === 'POST' && url === '/persona-route') {
        if (!personaChatFlagOn()) return send(200, { ok: false, off: true, error: 'LUCY_PERSONA_CHAT chưa bật' })
        const b = await readBody(req)
        if (!b.question || !String(b.question).trim()) return send(400, { error: 'cần {question}' })
        try { return send(200, { ok: true, ...(await personaRoute(String(b.question), [...store.personas.values()])) }) }
        catch (e) { return send(502, { error: String(e instanceof Error ? e.message : e) }) }
      }
      // ── T5 MCP "Kết nối": liệt kê server + trạng thái (master/flag/creds/circuit-breaker) cho UI ──
      if (req.method === 'GET' && url === '/mcp') return send(200, mcpRegistryOverview())
      // ── T6 Skill "Kỹ năng": liệt kê skill active (INDEX) + proposed (_proposed, M3.3) cho UI ──
      if (req.method === 'GET' && url === '/skills') return send(200, skillsOverview())
      // ── B3 Prompt Architect (cho bridge /prompt): JSON 1-shot (KHÔNG SSE). Model rẻ ds-chat, no-tool. Flag LUCY_PROMPT_ARCHITECT. ──
      if (req.method === 'POST' && url === '/prompt-architect') {
        if (!promptArchitectFlagOn()) return send(200, { ok: false, off: true, error: 'LUCY_PROMPT_ARCHITECT chưa bật' })
        const b = await readBody(req)
        const context = String(b.context || '').trim()
        if (!context) return send(400, { error: 'cần {context}' })
        const targetModel = b.targetModel ? String(b.targetModel).trim() : undefined
        try {
          const r = await runPromptArchitect(context, { targetModel, source: 'bridge', chatId: String(b.chatId || 'bridge-prompt'), vaultDir })
          // DASH-FIX S1: prompt-architect lane → recordSpend (source='lane', model thật) → ledger + usd. Thay addTokens cũ.
          if (r.usage) engine.recordSpend({ source: 'lane', model: r.laneModel || 'unknown', inTok: r.usage.inTok, outTok: r.usage.outTok, cacheTok: 0 })
          return send(200, { ok: true, answer: r.answer, clarifying: r.clarifying, finalPrompt: r.finalPrompt, laneModel: r.laneModel, scorecard: r.scorecard })
        } catch (e) { return send(502, { error: String(e instanceof Error ? e.message : e) }) }
      }
      // ── Đợt A: smart-routing — router model đọc brief → quyết role+model+needsTools ──
      // BH-D: nạp outcome đã học (vault) → routeTask tự chọn model thắng thay con đầu bảng hardcode.
      if (req.method === 'POST' && url === '/route') {
        const b = await readBody(req)
        if (!b.brief) return send(400, { error: 'cần {brief}' })
        const outcomes = vaultDir ? groupByModel(readOutcomes(vaultDir)) : []
        try { return send(200, await routeTask(String(b.brief), { router: b.router, outcomes })) }
        catch (e) { return send(502, { error: String(e instanceof Error ? e.message : e) }) }
      }
      // ── BH-D meta-learning: ghi feedback outcome (👍/👎) cho model → routing tự học. ──
      if (req.method === 'POST' && url === '/llm/feedback') {
        const b = await readBody(req)
        if (!vaultDir) return send(200, { ok: false, error: 'vault chưa cấu hình (LUCY_VAULT)' })
        const model = String(b.model || '').trim()
        const rating = b.rating === 'good' ? 'good' : b.rating === 'bad' ? 'bad' : null
        if (!model || !rating) return send(400, { error: 'cần {model, rating: good|bad}' })
        const outcome: RoutingOutcome = { ts: Date.now(), model, rating, taskType: b.taskType ? String(b.taskType) : undefined, comment: b.comment ? String(b.comment).slice(0, 500) : undefined, convId: b.convId ? String(b.convId) : undefined }
        appendOutcome(vaultDir, outcome)
        return send(200, { ok: true, stats: groupByModel(readOutcomes(vaultDir)) })
      }
      // ── BH-D + BH-G explainability: bảng outcome đã học (Lucy giỏi việc gì với model nào). ──
      if (req.method === 'GET' && url === '/llm/outcomes') {
        if (!vaultDir) return send(200, { configured: false, stats: [], total: 0 })
        const all = readOutcomes(vaultDir)
        return send(200, { configured: true, total: all.length, stats: groupByModel(all) })
      }
      // ── METRICS: frontend-compatible shape ──
      if (req.method === 'GET' && url === '/metrics') {
        const m = buildMetrics(store, recall)
        const today = vnDay() // S5: mốc ngày VN (UTC+7), khớp metrics.tokenByDay + token-guard
        const monthPfx = today.slice(0, 7)
        // S4: tokenDay/Month gồm CACHE (khớp token-guard.used = Σ ledger hôm nay) + mọi source (ledger đã đủ) → hết ngày>tháng & 0-worker.
        let tokenDay = 0, tokenMonth = 0, costDay = 0, costMonth = 0
        for (const [day, d] of Object.entries(m.tokenByDay)) {
          const toks = d.inTok + d.outTok + d.cacheTok
          if (day === today) { tokenDay = toks; costDay = d.usd }
          if (day.startsWith(monthPfx)) { tokenMonth += toks; costMonth += d.usd }
        }
        // S4: cột in·out·cache (kiểu Hermes) — tokens = tổng cả 3.
        const costByModel = Object.entries(m.costByModel)
          .map(([model, g]) => ({ model, usd: g.usd, tokens: g.inTok + g.outTok + g.cacheTok, inTok: g.inTok, outTok: g.outTok, cacheTok: g.cacheTok }))
          .sort((a, b) => b.usd - a.usd).slice(0, 8)
        const costByAgent = Object.entries(m.costByAgent)
          .map(([pId, g]) => {
            const pName = store.personas.get(pId)?.name ?? pId
            return { agent: pName.split('·')[0].trim(), usd: g.usd, tokens: g.inTok + g.outTok + g.cacheTok, inTok: g.inTok, outTok: g.outTok, cacheTok: g.cacheTok }
          })
          .sort((a, b) => b.usd - a.usd).slice(0, 8)
        // S4: "Nguồn đốt" — worker/autobuild/bridge/hub/cron/lane/unknown.
        const costBySource = Object.entries(m.costBySource)
          .map(([source, g]) => ({ source, usd: g.usd, tokens: g.inTok + g.outTok + g.cacheTok, inTok: g.inTok, outTok: g.outTok, cacheTok: g.cacheTok }))
          .sort((a, b) => b.tokens - a.tokens)
        const ledger = store.readLedger()
        const cardCost = new Map<string, { usd: number; tokens: number }>()
        for (const e of ledger) {
          const c = cardCost.get(e.cardId) ?? { usd: 0, tokens: 0 }
          c.usd += e.usd; c.tokens += e.inTok + e.outTok + (e.cacheTok || 0)
          cardCost.set(e.cardId, c)
        }
        const activeCards = store.listCards().filter(c => !['done', 'failed'].includes(c.status))
        const costByCard = activeCards
          .map(c => { const co = cardCost.get(c.id) ?? { usd: 0, tokens: 0 }; return { cardId: c.id, title: c.title, usd: co.usd, tokens: co.tokens } })
          .filter(c => c.usd > 0).sort((a, b) => b.usd - a.usd).slice(0, 10)
        const allCards = store.listCards()
        const cardsRunning = allCards.filter(c => c.status === 'working').length
        const cardsWaiting = allCards.filter(c => c.status === 'waiting_human').length
        const cardsTotal = allCards.filter(c => !['done', 'failed', 'backlog'].includes(c.status)).length
        const providers = providerStatus()
        const alerts: { kind: string; message: string }[] = []
        if (costMonth > 10) alerts.push({ kind: 'cost', message: `Chi phí tháng này $${costMonth.toFixed(2)} — vượt ngưỡng $10` })
        else if (costDay > 2) alerts.push({ kind: 'cost', message: `Chi phí hôm nay $${costDay.toFixed(2)} — vượt ngưỡng $2` })
        const series = buildSeries(store, Date.now()) // M5: time-series cho sparkline (24h/7d/30d)
        return send(200, { tokenDay, tokenMonth, costDay, costMonth, costByModel, costByAgent, costBySource, costByCard, cardsRunning, cardsWaiting, cardsTotal, providers, alerts, series, tokenGuard: engine.tokenGuardStatus() })
      }
      // ── ERROR-STATS: phân loại lỗi agent từ turn-log.jsonl (đọc env AM_TURNS_LOG cục bộ) ──
      if (req.method === 'GET' && url === '/error-stats') return send(200, buildErrorStats(store))
      // ── BỘ NÃO (M1: recall + vault browse + dream). brainOn=false nếu chưa set LUCY_VAULT. ──
      if (url.startsWith('/recall') || url.startsWith('/brain') || url.startsWith('/episodic') || url.startsWith('/session-summary')) {
        if (!brainOn || !recall || !vaultDir) return send(200, { configured: false })
        // PHASE 2: ghi 1 turn hội thoại (bridge/hub gọi async non-blocking). Flag off → no-op nhẹ.
        // Bọc try/catch riêng: ghi turn hỏng KHÔNG được chặn chat (caller fire-and-forget bỏ qua lỗi).
        if (req.method === 'POST' && url === '/episodic') {
          if (!episodicOn) return send(200, { configured: true, ok: false, off: true })
          try {
            const b = await readBody(req)
            const id = recall.recordTurn({ source: b.source, chatId: b.chat_id, role: b.role, content: b.content, sessionId: b.session_id })
            maybePrune()
            return send(200, { configured: true, ok: id != null, id })
          } catch (e) { return send(200, { configured: true, ok: false, error: String(e) }) }
        }
        if (req.method === 'GET' && url === '/episodic') {
          const q = qs.get('q') || ''
          const hits = episodicOn && q ? recall.searchTurns(q, { limit: Number(qs.get('limit')) || 5, sinceDays: Number(qs.get('days')) || undefined }) : []
          return send(200, { configured: true, episodicOn, retentionDays, stats: recall.episodicStats(), hits })
        }
        // ── CM-1: đóng phiên → ghi 1 note episodic-summary (ký ức xuyên phiên) → reindex để Jina/FTS bắt ngay.
        // body: {chat_id?, session_id?, summary, refs?:[{type,value,note?}]}. redact + valid_to trống (còn hiệu lực).
        // Flag LUCY_SESSION_SUMMARY (mặc định tắt → an toàn live; chỉ trả off, không lỗi).
        if (req.method === 'POST' && url === '/session-summary') {
          if (!sessionSummaryFlagOn()) return send(200, { configured: true, ok: false, off: true })
          try {
            const b = await readBody(req)
            const out = writeSessionSummary(vaultDir, { chatId: b.chat_id, sessionId: b.session_id, summary: b.summary, refs: Array.isArray(b.refs) ? b.refs : [], done: Array.isArray(b.done) ? b.done : [] })
            if (!out) return send(400, { configured: true, ok: false, error: 'summary rỗng' })
            // JSONL tuyến tính nằm ngoài tầm index recall (chỉ .md) → không reindex ở đây.
            return send(200, { configured: true, ok: true, file: out.rel })
          } catch (e) { return send(200, { configured: true, ok: false, error: String(e) }) }
        }
        if (req.method === 'GET' && url === '/recall') {
          freshIndex()
          const q = qs.get('q') || ''
          const after = qs.get('after') ? Number(qs.get('after')) : undefined
          // PHASE 4: mặc định LỌC fact hết hiệu lực (valid_to set); ?includeInvalid=1 để truy lịch sử.
          const includeInvalid = ['1', 'true', 'on'].includes((qs.get('includeInvalid') || '').toLowerCase())
          const opt = { type: qs.get('type') || undefined, after, limit: Number(qs.get('limit')) || 10, includeInvalid }
          // PHASE 1: hybrid FTS5+vector nếu LUCY_VECTOR bật (embed incremental cap nhỏ trước khi search). Off → FTS5 thuần.
          const hits = !q ? [] : recall.vectorReady()
            ? (await recall.embedIndex({ max: 24 }), await recall.hybridSearch(q, opt))
            : recall.search(q, opt)
          // A7 graph-walk: kéo theo note nối hit 1 bước wikilink (2 chiều)
          return send(200, { configured: true, hits, related: hits.length ? recall.related(hits.map((h) => h.file_path)) : [] })
        }
        // PHASE 0: prefetch recall cho đường hội thoại (Telegram bridge + Hub). POST {q, limit?}
        // → reindex incremental (rẻ) rồi search, cap limit ≤ 8, trả gọn [{title,snippet,file_path,rank,type}].
        // Bọc try/catch riêng: tra memory hỏng KHÔNG được chặn chat (caller bỏ qua nếu lỗi).
        if (req.method === 'POST' && url === '/recall') {
          try {
            const b = await readBody(req)
            const q = String(b.q || '').trim()
            const limit = Math.max(1, Math.min(8, Number(b.limit) || 5))
            if (!q) return send(200, { configured: true, hits: [] })
            freshIndex()
            // PHASE 1: hybrid khi vector bật (embed incremental cap nhỏ giữ vector tươi). Lỗi vector → tự về FTS5.
            const raw = recall.vectorReady()
              ? (await recall.embedIndex({ max: 24 }), await recall.hybridSearch(q, { type: b.type || undefined, limit }))
              : recall.search(q, { type: b.type || undefined, limit })
            // PHASE 2: truyền kèm score/scoreKind (điểm liên quan thật) + bookend (khung goal/done/pending)
            // → bridge lọc bằng NGƯỠNG LIÊN QUAN thay vì heuristic trùng-chữ (vốn giữ rác, vứt hit đúng).
            const hits = raw.map((h) => ({ title: h.title, snippet: h.snippet, file_path: h.file_path, rank: h.rank, type: h.type, mtime: h.mtime, score: h.score, scoreKind: h.scoreKind, bookend: h.bookend }))
            // PHASE 2: gộp episodic (turn hội thoại cũ) vào kết quả recall, đánh dấu type='episodic' ("hôm trước mình bàn gì").
            // PHASE 2: episodic là bm25 thuần (KHÔNG qua reranker) → luôn trả top-3 dù lạc đề, là nguồn nhiễu lớn.
            // Giờ: caller phải OPT-IN (body.episodic=true, mặc định true để không vỡ caller cũ) và hit được đánh
            // scoreKind='fts' + score=undefined → bridge biết đây là tín hiệu YẾU và siết riêng.
            if (episodicOn && b.episodic !== false) {
              try {
                for (const t of recall.searchTurns(q, { limit: Math.max(1, Math.min(3, Number(b.episodicLimit) || 3)) })) {
                  const who = t.role === 'assistant' || t.role === 'lucy' ? 'Lucy' : 'Chủ nhân'
                  const day = new Date(t.ts).toISOString().slice(0, 10)
                  hits.push({ title: `💬 ${who} (${day})`, snippet: t.snippet || t.content.slice(0, 200), file_path: `episodic:${t.id}`, rank: t.rank, type: 'episodic', mtime: t.ts, score: undefined, scoreKind: 'fts', bookend: undefined })
                }
              } catch { /* episodic hỏng không chặn recall */ }
            }
            return send(200, { configured: true, hits })
          } catch (e) { return send(200, { configured: true, hits: [], error: String(e) }) }
        }
        if (req.method === 'GET' && url === '/brain/recent') {
          freshIndex()
          return send(200, { configured: true, rows: recall.recent({ timeframe: qs.get('timeframe') || undefined, type: qs.get('type') || undefined, limit: Number(qs.get('limit')) || 15 }) })
        }
        if (req.method === 'GET' && url === '/brain/state') {
          freshIndex()
          return send(200, { configured: true, tree: browseVault(vaultDir), active: readActive(vaultDir), preferences: listPreferences(vaultDir), inbox: listInbox(vaultDir), stats: recall.stats() })
        }
        if (req.method === 'GET' && url === '/brain/graph')
          return send(200, buildGraph(vaultDir, { bornWithinMs: Number(qs.get('bornMs')) || 0 }))
        if (req.method === 'GET' && url === '/brain/file') {
          const f = readVaultFile(vaultDir, qs.get('path') || '')
          return f ? send(200, { configured: true, ...f }) : send(404, { error: 'not found / bad path' })
        }
        if (req.method === 'POST' && url === '/brain/reindex') return send(200, { configured: true, stats: recall.reindex({ full: true }) })
        if (req.method === 'POST' && url === '/brain/dream') return send(200, { configured: true, summary: dream(vaultDir) })
        // A1 evidence: Bill bấm 👍 áp dụng / 👎 bác 1 preference → ghi evidence rồi dream NGAY (confirm tức thì).
        // Dedup: 1 evidence manual / (pref, kind) / ngày — bấm lặp không thổi confidence.
        if (req.method === 'POST' && url === '/brain/evidence') {
          const b = await readBody(req)
          const kind = b.kind === 'violated' ? 'violated' : 'applied'
          const dup = b.prefId ? hasManualEvidenceToday(vaultDir, String(b.prefId), kind) : false
          const ok = !!b.prefId && !dup && recordEvidence(vaultDir, String(b.prefId), kind, Date.now(), 'manual')
          return send(200, { configured: true, ok, deduped: dup, summary: ok ? dream(vaultDir) : null })
        }
        if (req.method === 'POST' && url === '/brain/pin') {
          const b = await readBody(req)
          const ok = b.prefId ? setPinned(vaultDir, String(b.prefId), b.pinned !== false) : false
          return send(200, { configured: true, ok })
        }
        return send(404, { error: 'not found' })
      }
      // ── K4 persona registry CRUD: quản expert qua Hub (config-là-DATA, ghi file config/personas) ──
      if (url === '/personas') {
        if (req.method === 'GET') {
          // full persona (gồm systemPrompt) cho màn quản — khác /state (rút gọn cho board)
          return send(200, { personas: [...store.personas.values()] })
        }
        if (req.method === 'POST') {
          if (!configDir) return send(400, { error: 'configDir chưa cấu hình — không ghi được persona' })
          const b = await readBody(req)
          const p = sanitizePersona(b)
          if (!p) return send(400, { error: 'persona không hợp lệ — cần {id(a-z0-9-_), name, systemPrompt}' })
          if (!writePersonaFile(configDir, p)) return send(400, { error: 'id không an toàn để ghi file' })
          store.registerPersona(p)
          return send(200, { ok: true, persona: p })
        }
        if (req.method === 'DELETE') {
          if (!configDir) return send(400, { error: 'configDir chưa cấu hình' })
          const id = qs.get('id') || ''
          const fileGone = deletePersonaFile(configDir, id)
          const memGone = store.removePersona(id)
          if (!fileGone && !memGone) return send(404, { error: 'persona không tồn tại' })
          return send(200, { ok: true, id })
        }
        return send(405, { error: 'method not allowed' })
      }
      if (req.method === 'GET' && url === '/state') return send(200, {
        cards: store.listCards(),
        projects: store.listProjects(),
        channels: store.readChannel().slice(-200),
        pipelines: [...store.pipelines.values()],
        personas: [...store.personas.values()].map((p) => ({ id: p.id, name: p.name, avatar: p.avatar, model: p.model, realm: p.realm, kind: p.kind, laneModel: p.laneModel, tags: p.tags })),
        limits: engine.limits(),
        tokenGuard: engine.tokenGuardStatus(),
      })
      if (req.method === 'GET' && url === '/health') return send(200, { ok: true, pending: store.listCards().filter((c) => c.status === 'queued' || c.status === 'working').length })
      send(404, { error: 'not found' })
    } catch (e) { send(500, { error: String(e) }) }
  })
  // L4: background fetch OpenRouter model catalog (non-blocking — không delay startup)
  refreshOpenRouterCatalog().catch(() => {})
  server.listen(port, opts.host || '127.0.0.1') // mặc định CHỈ localhost — nginx/overlay mới là mặt tiền public
  return { server, stop: () => { if (timer) clearInterval(timer); server.close() } }
}
