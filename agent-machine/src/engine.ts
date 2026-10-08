// Engine — vòng auto-process tách RÕ: dispatch (tick) -> queue -> worker claim/run/submit.
// Local mode: worker in-process (drainLocal). Remote mode: worker quay ra qua coordinator (HTTP).
// Guardrails: budget pause, cap lane, gate (HITL), per-card cost cap, depth-breaker, loop-breaker, workspace cô lập.
import { spawnSync } from 'node:child_process'
import { Store } from './store'
import { Budget } from './budget'
import { makeWorkspace } from './workspace'
import { post, threadOf } from './channels'
import { writeSignalSafe } from './signal'
import { appendAgentLesson } from './agent-brain'
import { distillCardSafe } from './distill'
import { writeSessionNoteSafe } from './session-note'
import { proposeSkillFrom, skillLearnFlagOn } from './skill-learn'
import { slug } from './vault'
import { vnDay } from './tz'
import type { Runner } from './runner'
import type { Card, Stage, Persona, Project, Pipeline, RunResult, LedgerEntry, LedgerSource } from './types'
import { TokenGuard, type TokenGuardStatus } from './token-guard'
import { notifyRateLimitParked } from './notify'
import { triageCard } from './triage'
import type { TriageDecision } from './triage'
import { resolveExecutionPersona } from './engine-dispatch'
import { detectStuck, applyTriageDecision } from './engine-triage'

let _n = 0
const uid = (p: string) => `${p}_${Date.now().toString(36)}${(_n++).toString(36)}`

const VERIFY_TIMEOUT_MS = 120000 // verify-gate: cap thời gian lệnh khách quan (build/test) — chống treo queue
const VERIFY_LOG_CAP = 1500 // cắt đuôi log verify khi nhồi vào reviewNotes (khỏi phình prompt/store)
const TASK_SIZE_MAX_CHARS = 1500 // C3: task lớn > ngưỡng chars (title+brief) bị size-gate chặn trước executor

export type JobSpec = { jobId: string; cardId: string; card: Card; stage: Stage; persona: Persona; repo?: { url: string; branch?: string; projectId: string } }

export class Engine {
  store: Store
  runner: Runner // worker in-process (local mode); remote thì worker bên ngoài claim/submit
  budget: Budget
  tokenGuard: TokenGuard | null = null // optional — nếu có, check hard limit trước tạo card
  maxLanes: number
  perCardMaxUsd: number
  maxStageVisits: number
  maxDepth: number
  leaseMs: number
  paused = false

  private pending: { id: string; cardId: string }[] = []
  private inFlight = new Map<string, string>() // jobId -> cardId
  private rateLimitNotified = false // notify đúng 1 lần mỗi đợt rate-limit
  // ── C2 Stuck-detector ──
  stuckThreshold: number
  stuckHandler: (card: Card, stageName: string) => Promise<TriageDecision>
  private stuckHandled = new Set<string>() // tránh triage lại card đã xử lý
  private stuckPending = new Map<string, string>() // cardId -> stageName, đang chờ triage

  constructor(store: Store, runner: Runner, budget: Budget, opts: { maxLanes?: number; perCardMaxUsd?: number; maxStageVisits?: number; maxDepth?: number; leaseMs?: number; stuckThreshold?: number; stuckHandler?: (card: Card, stageName: string) => Promise<TriageDecision> } = {}) {
    this.store = store
    this.runner = runner
    this.budget = budget
    this.maxLanes = opts.maxLanes ?? 3
    this.perCardMaxUsd = opts.perCardMaxUsd ?? Infinity
    this.maxStageVisits = opts.maxStageVisits ?? 3 // build↔test rework tối đa ~2 vòng rồi hỏi người (5 cũ → lặp 6× đốt token)
    this.maxDepth = opts.maxDepth ?? 6
    this.leaseMs = opts.leaseMs ?? 20 * 60e3 // card 'working' quá 20' -> coi như treo, đưa lại hàng
    this.stuckThreshold = opts.stuckThreshold ?? 2
    this.stuckHandler = opts.stuckHandler ?? triageCard
  }

  createCard(title: string, brief: string, pipelineId: string, parentId?: string, depth = 0, projectId = 'default', deferred = false, modelOverride?: 'sonnet' | 'opus' | 'laneModel', blockedBy: string[] = [], personaId?: string, quality?: 'fast' | 'thorough'): Card {
    const id = uid('card')
    const deps = blockedBy.filter((b) => this.store.getCard(b)) // chỉ giữ dep có thật
    // TokenGuard: hard limit → card không vào hàng, chờ Bill
    const tokenOk = this.tokenGuard ? this.tokenGuard.check() : null
    const hardBlocked = tokenOk && !tokenOk.ok
    const status: Card['status'] = hardBlocked ? 'waiting_human' : deferred ? 'backlog' : deps.length ? 'blocked' : 'queued'
    const card: Card = {
      id, title, brief, pipelineId, projectId, stageIndex: 0, status, modelOverride, personaOverride: personaId || undefined,
      quality: quality === 'thorough' ? 'thorough' : undefined,
      waitKind: hardBlocked ? 'decision' : undefined,
      pendingQuestion: hardBlocked ? `⛔ Token day hard limit: đã dùng ${tokenOk!.used.toLocaleString()} / ${tokenOk!.hardLimit.toLocaleString()} tokens. Bill xoá limit hoặc đợi ngày mới.` : undefined,
      blockKind: deps.length ? 'dep' : undefined,
      workspace: makeWorkspace(this.store.dir, id), parentId, depth, blockedBy: deps,
      cost: { usd: 0, inTok: 0, outTok: 0 }, history: [{ ts: Date.now(), stage: '-', event: hardBlocked ? 'created-hardblocked' : deferred ? 'created-backlog' : 'created' }],
      createdAt: Date.now(), updatedAt: Date.now(),
    }
    this.ensureProject(projectId) // card luôn thuộc 1 project có thật
    this.store.putCard(card)
    const tag = hardBlocked ? '⛔ (hard limit — chờ Bill)' : deferred ? ' (để sau)' : ''
    post(this.store, 'coordination', 'engine', 'system', `+ card "${title}" → pipeline ${pipelineId}${tag}`, id)
    return card
  }

  // ── PROJECT: container thật (repo + board + kênh + chat) ──
  ensureProject(id: string): Project {
    const ex = this.store.getProject(id)
    if (ex) return ex
    const p: Project = { id, name: id, channels: ['general'], createdAt: Date.now(), updatedAt: Date.now() }
    this.store.putProject(p)
    return p
  }
  createProject(name: string, opts: { repoUrl?: string; branch?: string; description?: string; skill?: string } = {}): Project {
    const id = (name || '').trim() || 'default'
    const ex = this.store.getProject(id)
    const p: Project = ex
      ? { ...ex, repoUrl: opts.repoUrl ?? ex.repoUrl, branch: opts.branch ?? ex.branch, description: opts.description ?? ex.description, skill: opts.skill ?? ex.skill }
      : { id, name: id, repoUrl: opts.repoUrl, branch: opts.branch, description: opts.description, skill: opts.skill, channels: ['general'], createdAt: Date.now(), updatedAt: Date.now() }
    this.store.putProject(p)
    if (!ex) post(this.store, 'coordination', 'engine', 'system', `📁 dự án mới: "${id}"${opts.repoUrl ? ' (repo thật)' : ''}`)
    return p
  }
  removeProject(id: string): boolean {
    // chỉ xoá project rỗng (không còn card) — tránh mồ côi card
    if (this.store.listCards().some((c) => (c.projectId || 'default') === id)) return false
    return this.store.deleteProject(id)
  }

  // ── FLOW (pipeline) tự định nghĩa/sửa lúc chạy (O1) ──
  upsertPipeline(input: { id?: string; name: string; stages: { name: string; personaId: string; gate?: boolean; verify?: string }[] }): Pipeline | null {
    const name = (input.name || '').trim()
    if (!name || !input.stages?.length) return null
    const stages: Stage[] = []
    input.stages.forEach((s, i) => {
      if (!this.store.personas.get(s.personaId)) return // persona phải tồn tại
      const v = (s.verify || '').trim()
      stages.push({ id: 's' + (i + 1), name: (s.name || '').trim() || `Bước ${i + 1}`, personaId: s.personaId, gate: !!s.gate, ...(v ? { verify: v } : {}) })
    })
    if (!stages.length) return null
    const id = input.id || name.toLowerCase().replace(/[^\w]+/g, '-').replace(/^-+|-+$/g, '') || 'flow'
    const p: Pipeline = { id, name, stages }
    this.store.saveCustomPipeline(p)
    post(this.store, 'coordination', 'engine', 'system', `🧩 flow "${name}" (${stages.length} bước) đã lưu`)
    return p
  }
  deletePipeline(id: string): boolean {
    if (this.store.listCards().some((c) => c.pipelineId === id && c.status !== 'done' && c.status !== 'failed')) return false // còn card đang dùng
    return this.store.deleteCustomPipeline(id)
  }

  // ── KÊNH Discord-style per-project (R4) — channel id = `p:<projectId>:<name>` ──
  addChannel(projectId: string, name: string): boolean {
    const p = this.store.getProject(projectId); if (!p) return false
    const n = (name || '').trim().replace(/[^\w-]+/g, '-').replace(/^-+|-+$/g, '').toLowerCase(); if (!n) return false
    if (!p.channels.includes(n)) { p.channels.push(n); this.store.putProject(p); post(this.store, `p:${projectId}:general`, 'engine', 'system', `# tạo kênh "${n}"`) }
    return true
  }
  removeChannel(projectId: string, name: string): boolean {
    const p = this.store.getProject(projectId); if (!p || name === 'general') return false
    p.channels = p.channels.filter((c) => c !== name); this.store.putProject(p); return true
  }
  // người (Bill) gõ vào kênh — có thể @tag 1 agent để điều hướng. channel = tên kênh dự án HOẶC card-<id> (rep trong thread task)
  postHuman(projectId: string, channel: string, text: string, mention?: string) {
    if (!(text || '').trim()) return
    const ch = (channel || '').startsWith('card-') ? channel : `p:${projectId}:${channel || 'general'}`
    post(this.store, ch, 'bill', 'chat', (mention ? `@${mention} ` : '') + text.trim())
  }
  // V3: lưu hội thoại Lucy (kênh ẩn __lucy, không hiện trong tab Channels) -> qua F5/đa thiết bị
  logLucy(projectId: string, role: 'me' | 'lucy', text: string) {
    if (!(text || '').trim()) return
    post(this.store, `p:${projectId}:__lucy`, role === 'me' ? 'bill' : 'Lucy', 'chat', text.trim())
  }
  // backfill: mọi projectId trên card phải có Project entity (migration cho card cũ)
  private backfillProjects() {
    const have = new Set(this.store.listProjects().map((p) => p.id))
    for (const c of this.store.listCards()) { const pid = c.projectId || 'default'; if (!have.has(pid)) { this.ensureProject(pid); have.add(pid) } }
  }

  // defer/backlog: card 'backlog' KHÔNG được dispatch -> bấm "Chạy" mới vào hàng.
  activate(cardId: string) {
    const c = this.store.getCard(cardId)
    if (!c || c.status !== 'backlog') return
    c.status = 'queued'
    c.history.push({ ts: Date.now(), stage: '-', event: 'activated' })
    post(this.store, threadOf(c.id), 'engine', 'system', `▶ kích hoạt "${c.title}" → vào hàng chạy`, c.id)
    this.store.putCard(c)
  }

  // xoá card (rác/lỗi). Dọn luôn job đang chờ/bay của nó để không mồ côi.
  removeCard(cardId: string): boolean {
    const c = this.store.getCard(cardId)
    if (!c) return false
    this.pending = this.pending.filter((j) => j.cardId !== cardId)
    for (const [jid, cid] of [...this.inFlight]) if (cid === cardId) this.inFlight.delete(jid)
    this.store.removeWorkspace(cardId) // dọn dir trên đĩa luôn
    const ok = this.store.deleteCard(cardId)
    if (ok) post(this.store, 'coordination', 'engine', 'system', `🗑 xoá card "${c.title}"`, cardId)
    return ok
  }

  // ── THÙNG RÁC dự án: trash (ẩn) -> restore | purge (xoá HẲN: card + workspace + record) ──
  trashProject(id: string): boolean {
    const p = this.store.getProject(id); if (!p) return false
    p.trashed = true; this.store.putProject(p)
    post(this.store, 'coordination', 'engine', 'system', `🗑 ném dự án "${p.name}" vào thùng rác`)
    return true
  }
  restoreProject(id: string): boolean {
    const p = this.store.getProject(id); if (!p) return false
    p.trashed = false; this.store.putProject(p); return true
  }
  // xoá HẲN: mọi card của dự án (+ workspace dir) + record dự án. (Repo clone trên worker là cache, tự dọn/clone lại.)
  purgeProject(id: string): number {
    const p = this.store.getProject(id); if (!p) return 0
    let n = 0
    for (const c of this.store.listCards().filter((c) => (c.projectId || 'default') === id)) { if (this.removeCard(c.id)) n++ }
    this.store.deleteProject(id)
    post(this.store, 'coordination', 'engine', 'system', `🔥 xoá HẲN dự án "${p.name}" (${n} card)`)
    return n
  }

  approve(cardId: string, actor: string = 'bill') {
    const c = this.store.getCard(cardId)
    if (!c || c.status !== 'waiting_human') return
    post(this.store, threadOf(c.id), actor, 'decision', `✓ duyệt: ${c.pendingQuestion ?? 'tiếp tục'}`, c.id)
    c.pendingQuestion = undefined
    // C3: size-gate → re-queue (cùng stage), không advance (giữ executor stage)
    if (c.waitKind === 'size-gate') {
      c.waitKind = undefined
      c.status = 'queued'
      c.sizeGateBypassed = true
      c.history.push({ ts: Date.now(), stage: '-', event: 'size-gate-approved' })
      this.store.putCard(c)
      return
    }
    c.waitKind = undefined
    c.stageVisits = {} // người đã can thiệp -> reset đếm loop (khỏi gate lại ngay)
    this.advanceCard(c)
  }

  // TRẢ LỜI câu hỏi của agent (needs_decision): chạy LẠI stage hiện tại kèm câu trả lời để agent làm tiếp.
  // gate/cost: coi như duyệt (advance). Đây là chỗ "pick option" thật sự, không chỉ duyệt khan.
  answer(cardId: string, text: string, actor: string = 'bill') {
    const c = this.store.getCard(cardId)
    if (!c || c.status !== 'waiting_human') return
    const kind = c.waitKind
    const ans = (text || '').trim()
    post(this.store, threadOf(c.id), actor, 'decision', `💬 trả lời: ${ans || '(tự quyết — tiếp tục)'}`, c.id)
    if (ans) c.reviewNotes = (c.reviewNotes || []).concat('Chủ trả lời câu hỏi: ' + ans)
    c.pendingQuestion = undefined; c.waitKind = undefined
    if (kind === 'decision') { c.status = 'queued'; c.history.push({ ts: Date.now(), stage: '-', event: 'answered' }); this.store.putCard(c) }
    else if (kind === 'size-gate') { c.status = 'queued'; c.sizeGateBypassed = true; c.history.push({ ts: Date.now(), stage: '-', event: 'size-gate-approved' }); this.store.putCard(c) }
    else this.advanceCard(c)
  }

  // TRẢ LẠI ở gate: bạn ghi vấn đề/yêu cầu -> card lùi về stage trước (vd review -> build)
  // để agent (Max) SỬA theo feedback, rồi review lại. Loop-breaker chặn lặp vô hạn.
  reject(cardId: string, feedback: string, actor: string = 'bill') {
    const c = this.store.getCard(cardId)
    if (!c || c.status !== 'waiting_human') return
    const pipe = this.store.pipelines.get(c.pipelineId)
    if (!pipe) { c.status = 'failed'; this.store.putCard(c); return }
    const note = (feedback || '').trim() || 'Có vấn đề — làm lại kỹ hơn.'
    c.reviewNotes = (c.reviewNotes || []).concat(note)
    // TRÍ NHỚ: feedback người duyệt = tín hiệu giá trị CAO → ghi brain-signal (dream gộp khi 1 việc bị trả lại lặp lại).
    writeSignalSafe({ topic: `${c.projectId}/${slug(c.title)}`, signal: 'negative', principle: note, scope: 'review', cardId: c.id, agent: actor, raw: `${actor} trả lại "${c.title}": ${note}` })
    c.pendingQuestion = undefined; c.waitKind = undefined
    c.stageVisits = {} // người trả lại kèm feedback -> reset đếm loop, cho thêm lượt sửa
    c.stageIndex = Math.max(0, c.stageIndex - 1) // lùi về stage trước gate (thường = build)
    c.status = 'queued'
    const back = pipe.stages[c.stageIndex]
    post(this.store, threadOf(c.id), actor, 'decision', `✗ TRẢ LẠI: ${note}`, c.id)
    post(this.store, threadOf(c.id), 'engine', 'system', `↩ về "${back.name}" để sửa theo feedback`, c.id)
    c.history.push({ ts: Date.now(), stage: back.id, event: 'reject-rework', detail: note })
    this.store.putCard(c)
  }

  // verify-gate: chạy lệnh khách quan của OPERATOR trong workspace card. exit 0 = đạt.
  // Fail-shell (spawn lỗi / timeout / ngoại lệ) coi như verify-FAIL — an toàn: thà rework thừa còn hơn false-done.
  private runVerify(cmd: string, ws: string): { ok: boolean; log: string } {
    try {
      const r = spawnSync(cmd, { cwd: ws, shell: true, encoding: 'utf8', timeout: VERIFY_TIMEOUT_MS, env: { ...process.env, IS_SANDBOX: '1' } })
      const log = `${r.stdout || ''}${r.stderr || ''}`.trim()
      if (r.error) return { ok: false, log: `spawn lỗi: ${r.error.message}${log ? '\n' + log : ''}` }
      if (r.status === null) return { ok: false, log: `verify timeout/kill (>${VERIFY_TIMEOUT_MS}ms)${log ? '\n' + log : ''}` }
      return { ok: r.status === 0, log: log || `[exit ${r.status}]` }
    } catch (e) {
      return { ok: false, log: `verify ngoại lệ: ${String(e instanceof Error ? e.message : e)}` }
    }
  }

  private advanceCard(c: Card) {
    const pipe = this.store.pipelines.get(c.pipelineId)!
    if (c.stageIndex >= pipe.stages.length - 1) {
      c.status = 'done'
      c.history.push({ ts: Date.now(), stage: pipe.stages[c.stageIndex].id, event: 'done' })
      post(this.store, threadOf(c.id), 'engine', 'report', `🏁 card "${c.title}" DONE`, c.id)
      this.distill(c) // A2: card kết thúc → học nền (fire-and-forget, không chặn)
    } else {
      c.stageIndex++
      c.reviewNotes = [] // C3: notes stage cũ không liên quan stage mới → clear để tránh prompt phình
      c.status = 'queued'
      c.history.push({ ts: Date.now(), stage: pipe.stages[c.stageIndex].id, event: 'enter-stage' })
    }
    c.waitKind = undefined
    this.store.putCard(c)
  }

  // chỉnh giới hạn LÚC ĐANG CHẠY (dynamic): tăng/giảm queue width, cost cap...
  setLimits(p: { maxLanes?: number; perCardMaxUsd?: number; maxDepth?: number; maxStageVisits?: number; tokenSoft?: number; tokenHard?: number }) {
    if (p.maxLanes != null) this.maxLanes = Math.max(1, Math.floor(p.maxLanes))
    if (p.perCardMaxUsd != null) this.perCardMaxUsd = p.perCardMaxUsd
    if (p.maxDepth != null) this.maxDepth = Math.max(0, Math.floor(p.maxDepth))
    if (p.maxStageVisits != null) this.maxStageVisits = Math.max(1, Math.floor(p.maxStageVisits))
    if (p.tokenSoft != null || p.tokenHard != null) {
      this.tokenGuard?.setLimits(p.tokenSoft ?? this.tokenGuard.softLimit, p.tokenHard ?? this.tokenGuard.hardLimit)
    }
  }
  limits() { return { maxLanes: this.maxLanes, perCardMaxUsd: this.perCardMaxUsd, maxDepth: this.maxDepth, maxStageVisits: this.maxStageVisits, queued: this.store.listCards().filter((c) => c.status === 'queued').length, inFlight: this.inFlight.size, tokenGuard: this.tokenGuardStatus() } }
  /** Trạng thái token guard (nếu có cấu hình). */
  tokenGuardStatus(): { configured: boolean; status?: TokenGuardStatus } {
    if (!this.tokenGuard) return { configured: false }
    return { configured: true, status: this.tokenGuard.check() }
  }

  // ── DASH-FIX S1: recordSpend = 1 NGUỒN ghi token. Mọi đường (worker + /spend) qua đây → ledger.
  // token-guard.used dẫn xuất Σ ledger hôm nay (wire ở coordinator-main) → hết double-count, attribution đủ.
  private _usedCache: { day: string; sum: number } | null = null
  recordSpend(e: {
    ts?: number; source: LedgerSource; model?: string
    inTok?: number; cacheTok?: number; outTok?: number; usd?: number
    cardId?: string; stage?: string; persona?: string
  }): void {
    const sane = (v: unknown) => { const n = Number(v); return Number.isFinite(n) && n > 0 ? n : 0 }
    const entry: LedgerEntry = {
      ts: Number.isFinite(e.ts) ? Number(e.ts) : Date.now(),
      cardId: e.cardId || '-', stage: e.stage || '-', persona: e.persona || e.source,
      source: e.source, model: e.model || 'unknown',
      inTok: sane(e.inTok), cacheTok: sane(e.cacheTok), outTok: sane(e.outTok),
      usd: sane(e.usd),
    }
    this.store.appendLedger(entry)
    this._usedCache = null // invalidate → used() đọc lại tươi ngay lượt sau
  }

  /** Σ token (in+cache+out) các entry ledger thuộc "hôm nay" (giờ VN, UTC+7 — DASH-FIX S5). Cache 1 ngày, recordSpend xoá. */
  ledgerUsedToday(): number {
    const day = vnDay()
    if (this._usedCache && this._usedCache.day === day) return this._usedCache.sum
    let sum = 0
    for (const e of this.store.readLedger()) {
      if (vnDay(e.ts) === day) sum += (e.inTok || 0) + (e.cacheTok || 0) + (e.outTok || 0)
    }
    this._usedCache = { day, sum }
    return sum
  }

  // crash recovery: card 'working' (đã dispatch nhưng mất kết quả khi restart) -> queued lại.
  // Cards persist trong store; status là source-of-truth -> gate/blocked/done resume tự nhiên sau restart.
  recover(): number {
    this.pending = []
    this.inFlight.clear()
    this.backfillProjects() // card cũ -> đảm bảo có Project entity
    let n = 0
    for (const c of this.store.listCards()) {
      if (c.status === 'working') {
        c.status = 'queued'
        c.history.push({ ts: Date.now(), stage: '-', event: 'recovered' })
        this.store.putCard(c)
        n++
      }
    }
    if (n) post(this.store, 'coordination', 'engine', 'system', `♻ recovery: ${n} card 'working' mồ côi → queued lại`)
    return n
  }

  private working(): number { return this.inFlight.size }

  // ── B4 quality-first: card 'thorough' được nâng cap để cày tới hoàn thiện (token-guard hard vẫn là trần tuyệt đối) ──
  private thorough(c: Card): boolean { return c.quality === 'thorough' }
  private effMaxVisits(c: Card): number { return this.thorough(c) ? this.maxStageVisits * 2 + 2 : this.maxStageVisits }
  private effCardCap(c: Card): number { return this.thorough(c) && this.perCardMaxUsd !== Infinity ? this.perCardMaxUsd * 3 : this.perCardMaxUsd }

  // ── DISPATCH: tìm card actionable -> đẩy vào queue (mark working). KHÔNG chạy ở đây. ──
  tick(): number {
    const b = this.budget.check()
    if (!b.ok) {
      if (!this.paused) { this.paused = true; post(this.store, 'coordination', 'engine', 'system', `⛔ ${b.reason}`) }
      return 0
    }
    if (b.soft && !this.budget.warned) { this.budget.warned = true; post(this.store, 'coordination', 'engine', 'system', `⚠ budget mềm: đã dùng $${b.used.toFixed(4)} trong cửa`) }
    this.paused = false

    // lease: card 'working' quá lâu (worker chết / mất kết quả / "chập") -> dọn job + đưa lại hàng
    for (const c of this.store.listCards()) {
      if (c.status !== 'working' || Date.now() - c.updatedAt <= this.leaseMs) continue
      for (const [jid, cid] of [...this.inFlight]) if (cid === c.id) this.inFlight.delete(jid)
      this.pending = this.pending.filter((j) => j.cardId !== c.id)
      c.status = 'queued'
      c.history.push({ ts: Date.now(), stage: '-', event: 'lease-requeue' })
      post(this.store, threadOf(c.id), 'engine', 'system', `♻ card treo >${Math.round(this.leaseMs / 60e3)}' → đưa lại hàng (worker có thể đã chết)`, c.id)
      this.store.putCard(c)
    }

    // parked sweep: card rate-limit hết hạn → queued lại
    for (const c of this.store.listCards()) {
      if (c.status !== 'parked' || !c.retryAfter || Date.now() < c.retryAfter) continue
      c.status = 'queued'
      c.retryAfter = undefined
      c.history.push({ ts: Date.now(), stage: '-', event: 'rate-limit-resume' })
      post(this.store, threadOf(c.id), 'engine', 'system', `▶ rate-limit hết → card vào hàng lại`, c.id)
      this.store.putCard(c)
    }

    let did = 0
    for (const c of this.store.listCards()) {
      if (this.working() >= this.maxLanes) break
      if (c.status !== 'queued' || c.blockedBy.length) continue

      const pipe = this.store.pipelines.get(c.pipelineId)
      const stage = pipe?.stages[c.stageIndex]
      const persona = stage ? this.store.personas.get(stage.personaId) : undefined
      // guardrail: cấu hình sai (pipeline/stage/persona thiếu) -> FAIL card NÀY, KHÔNG throw.
      // (1 card hỏng từng làm tick() throw -> auto-tick nuốt lỗi -> kẹt CẢ queue.)
      if (!pipe || !stage || !persona) {
        c.status = 'failed'
        post(this.store, threadOf(c.id), 'engine', 'system', `⛔ cấu hình sai: ${!pipe ? `pipeline "${c.pipelineId}" không tồn tại` : !stage ? `stage #${c.stageIndex} không tồn tại` : 'persona không tồn tại'} → card FAILED`, c.id)
        this.store.putCard(c)
        continue
      }
      // guardrail: loop-breaker
      c.stageVisits = c.stageVisits || {}
      c.stageVisits[stage.id] = (c.stageVisits[stage.id] || 0) + 1
      if (c.stageVisits[stage.id] > this.effMaxVisits(c)) { // B4: thorough → cho nhiều vòng hơn
        // loop-cap: KHÔNG fail (mất việc) cũng KHÔNG lặp tiếp (đốt token) → HỎI người HOẶC triage tự động.
        // C2 Stuck-detector: launch triage trước, nếu handler không xử lý thì fallback về loop-cap cũ
        if (!this.stuckHandled.has(c.id) && !this.stuckPending.has(c.id)) {
          const lastBug = c.reviewNotes?.slice(-1)[0] || c.lastSummary || '—'
          c.pendingQuestion = `Stage "${stage.name}" rework ${this.maxStageVisits} lần vẫn chưa đạt — bug còn: ${String(lastBug).slice(0, 200)}. Lucy đang phân tích...`
          c.status = 'waiting_human'; c.waitKind = 'loop'
          this.store.putCard(c)
          this.triggerStuckTriage(c, stage, persona!)
        } else {
          // đã triage rồi → fallback về loop-cap cũ
          c.status = 'waiting_human'; c.waitKind = 'loop'
          const lastBug = c.reviewNotes?.slice(-1)[0] || c.lastSummary || '—'
          c.pendingQuestion = `Stage "${stage.name}" rework ${this.maxStageVisits} lần vẫn chưa đạt — bug còn: ${String(lastBug).slice(0, 200)}. Duyệt cho qua / Trả lại sửa (cho thêm lượt)?`
          post(this.store, threadOf(c.id), 'engine', 'decision', `⛔ LOOP-CAP: ${c.pendingQuestion}`, c.id)
          this.store.putCard(c)
        }
        continue
      }
      // ── C3: Task-size gate — chặn executor nhận task quá lớn (buộc decompose trước) ──
      // Chỉ áp cho executor (không áp cho architect/reviewer) và bỏ qua subtask (đã decompose).
      // Bỏ qua nếu human đã approve bypass (sizeGateBypassed).
      if (persona.kind === 'executor' && !c.parentId && !c.sizeGateBypassed) {
        const totalChars = c.title.length + c.brief.length
        if (totalChars > TASK_SIZE_MAX_CHARS) {
          c.status = 'waiting_human'
          c.waitKind = 'size-gate'
          c.pendingQuestion = `📏 Task quá lớn (${totalChars} ký tự, max ${TASK_SIZE_MAX_CHARS}) — cần decompose thành subtask nhỏ hơn trước khi executor xử lý. Approve để chạy tiếp (không khuyến khích) hoặc chia nhỏ task.`
          c.history.push({ ts: Date.now(), stage: stage.id, event: 'size-gate-blocked', detail: `${totalChars} chars > ${TASK_SIZE_MAX_CHARS} max` })
          post(this.store, threadOf(c.id), 'engine', 'decision', `⛔ SIZE-GATE: ${c.pendingQuestion}`, c.id)
          this.store.putCard(c)
          continue
        }
      }
      c.status = 'working'
      this.store.putCard(c)
      const jobId = uid('job')
      this.pending.push({ id: jobId, cardId: c.id })
      this.inFlight.set(jobId, c.id)
      post(this.store, threadOf(c.id), persona.name, 'status', `▶ ${persona.name} nhận "${stage.name}"`, c.id)
      did++
    }
    this.resolveUnblocks()
    return did
  }

  // ── WORKER claim: lấy 1 job để chạy (in-process hoặc remote qua HTTP) ──
  claim(): JobSpec | null {
    const j = this.pending.shift()
    if (!j) return null
    const c = this.store.getCard(j.cardId)
    if (!c) { this.inFlight.delete(j.id); return null }
    const pipe = this.store.pipelines.get(c.pipelineId)
    const stage = pipe?.stages[c.stageIndex]
    let base = stage ? this.store.personas.get(stage.personaId) : undefined
    if (!pipe || !stage || !base) { this.inFlight.delete(j.id); c.status = 'failed'; this.store.putCard(c); return null }
    // PersonaOverride: stage ĐẦU có thể ép persona từ card (chọn ở Board)
    if (c.stageIndex === 0 && c.personaOverride) {
      const overridden = this.store.personas.get(c.personaOverride)
      if (overridden) {
        base = overridden
      } else {
        post(this.store, threadOf(c.id), 'engine', 'system', `⚠️ personaOverride "${c.personaOverride}" không tìm thấy — dùng pipeline default`, c.id)
      }
    }
    const proj = this.store.getProject(c.projectId)
    // dispatch: chọn model+persona THỰC (override / skill / token-guard soft / thorough) — tách ở engine-dispatch.ts
    let persona = resolveExecutionPersona(base, c, proj, this.tokenGuard, this.thorough(c))
    // C3: defense-in-depth — size-gate (trường hợp tick() bỏ sót)
    if (persona.kind === 'executor' && !c.parentId && !c.sizeGateBypassed) {
      const totalChars = c.title.length + c.brief.length
      if (totalChars > TASK_SIZE_MAX_CHARS) {
        this.inFlight.delete(j.id)
        c.status = 'queued'
        c.history.push({ ts: Date.now(), stage: stage.id, event: 'size-gate-defence', detail: `${totalChars} chars > ${TASK_SIZE_MAX_CHARS} max` })
        post(this.store, threadOf(c.id), 'engine', 'system', `⚠ size-gate defence: ${totalChars} chars > ${TASK_SIZE_MAX_CHARS}, trả lại hàng`, c.id)
        this.store.putCard(c)
        console.log(`[engine] size-gate defence: ${c.id} (${totalChars} chars) blocked at claim()`)
        return null
      }
    }
    // repo: nếu project có repoUrl -> worker clone & làm việc trong repo thật (R2)
    const repo = proj?.repoUrl ? { url: proj.repoUrl, branch: proj.branch, projectId: proj.id } : undefined
    return { jobId: j.id, cardId: c.id, card: c, stage, persona, repo }
  }

  // ── WORKER submit: trả kết quả -> áp outcome ──
  submit(jobId: string, result: RunResult): void {
    const cardId = this.inFlight.get(jobId)
    if (!cardId) return
    this.inFlight.delete(jobId)
    const c = this.store.getCard(cardId)
    if (!c) return
    const pipe = this.store.pipelines.get(c.pipelineId)!
    const stage = pipe.stages[c.stageIndex]
    const persona = this.store.personas.get(stage.personaId)!

    c.cost.usd += result.cost.usd; c.cost.inTok += result.cost.inTok; c.cost.outTok += result.cost.outTok
    this.budget.add(result.cost)
    // DASH-FIX S1: 1 ĐƯỜNG GHI — recordSpend → ledger; token-guard.used dẫn xuất Σ ledger (BỎ addTokens riêng = hết double-count).
    // model resolve như metrics.ts (persona.model + card override) để "Nguồn đốt"/costByModel khớp. usd = SDK trả. Worker chưa tách cache → cacheTok 0.
    const wModel = (!c.modelOverride || c.modelOverride === 'laneModel') ? persona.model : (persona.model === 'opus' ? 'opus' : c.modelOverride)
    this.recordSpend({ source: 'worker', model: wModel, cardId: c.id, stage: stage.id, persona: persona.id, inTok: result.cost.inTok, outTok: result.cost.outTok, cacheTok: 0, usd: result.cost.usd })
    post(this.store, threadOf(c.id), persona.name, 'status', result.outcome.summary, c.id)
    c.history.push({ ts: Date.now(), stage: stage.id, event: result.outcome.decision, detail: result.outcome.summary })
    if (result.artifacts) c.artifacts = { ...result.artifacts, stage: stage.id } // V1: báo cáo đổi gì
    c.lastSummary = result.outcome.summary // D4: bước sau đọc được bước trước đã làm gì
    // C1: lưu narrative ĐẦY ĐỦ (drawer đọc full) + post 'report' nhiều dòng vào thread (channel sống, agent "nói" đã làm gì)
    if (result.report && result.report.trim()) {
      c.reports = (c.reports || []).concat({ stage: stage.id, persona: persona.name, text: result.report.slice(0, 12000), ts: Date.now() }).slice(-20)
      post(this.store, threadOf(c.id), persona.name, 'report', result.report.slice(0, 2000), c.id)
    }
    // CACHE: nhớ session_id theo persona:stageIndex → rework lần sau --resume khỏi quét lại project (đỡ token).
    // Key kèm stageIndex để tránh resume sai session khi cùng persona chạy nhiều stage khác nhau.
    if (result.sessionId) c.sessions = { ...(c.sessions || {}), [`${persona.id}:${c.stageIndex}`]: result.sessionId }

    // Reset rateLimitNotified: lane chạy được → đợt rate-limit đã qua
    if (!result.rateLimit) this.rateLimitNotified = false

    // rate-limit: park card, không retry, không vào switch
    if (result.rateLimit) {
      c.status = 'parked'
      c.retryAfter = Date.now() + result.rateLimit.retryAfterMs
      // Hoàn lại loop-counter (đợt park không tính là rework)
      c.stageVisits = c.stageVisits || {}
      c.stageVisits[stage.id] = Math.max(0, (c.stageVisits[stage.id] ?? 1) - 1)
      const detail = result.rateLimit.detail
      c.history.push({ ts: Date.now(), stage: stage.id, event: 'rate-limit-parked', detail: detail.slice(0, 200) })
      post(this.store, threadOf(c.id), 'engine', 'system', `⏸ rate-limit → park ${Math.round(result.rateLimit.retryAfterMs / 60000)}ph`, c.id)
      // Notify 1 lần mỗi đợt (fire-and-forget, không làm vỡ submit)
      if (!this.rateLimitNotified) {
        this.rateLimitNotified = true
        notifyRateLimitParked(result.rateLimit.retryAfterMs, detail).catch(() => {})
      }
      this.store.putCard(c)
      return
    }

    // guardrail: per-card cost cap
    if (c.cost.usd >= this.effCardCap(c)) { // B4: thorough → cap cao hơn (vẫn chặn token-guard hard)
      c.status = 'waiting_human'; c.waitKind = 'cost'
      c.pendingQuestion = `Card vượt cap chi phí $${this.effCardCap(c).toFixed(2)} (đã $${c.cost.usd.toFixed(3)}) — duyệt để chạy tiếp?`
      post(this.store, threadOf(c.id), 'engine', 'decision', `⛔ COST CAP: ${c.pendingQuestion}`, c.id)
      this.store.putCard(c)
      return
    }

    switch (result.outcome.decision) {
      case 'advance':
      case 'done': // 'done' = agent xong việc của STAGE này -> advanceCard (tự kết thúc card nếu là stage CUỐI); tôn trọng gate
        // VERIFY-GATE: agent tự đóng dấu xong KHÔNG đủ — chạy lệnh khách quan của OPERATOR (typecheck/build/test).
        // exit≠0 → KHÔNG advance: ép rework CHÍNH stage này (loop-breaker stageVisits chặn lặp vô hạn). Chống false-done.
        if (stage.verify) {
          const v = this.runVerify(stage.verify, c.workspace)
          if (!v.ok) {
            const tail = v.log.slice(-VERIFY_LOG_CAP)
            c.reviewNotes = (c.reviewNotes || []).concat(`⛔ VERIFY FAIL (\`${stage.verify}\`):\n${tail}`)
            c.status = 'queued' // GIỮ NGUYÊN stageIndex → lặp lại stage này cho agent tự sửa
            c.history.push({ ts: Date.now(), stage: stage.id, event: 'verify-fail', detail: tail.slice(0, 200) })
            post(this.store, threadOf(c.id), 'engine', 'decision', `⛔ VERIFY FAIL "${stage.name}" (\`${stage.verify}\`) — agent báo xong nhưng kiểm khách quan vỡ → ép sửa lại`, c.id)
            this.store.putCard(c)
            break
          }
          post(this.store, threadOf(c.id), 'engine', 'status', `✅ verify "${stage.name}" qua (\`${stage.verify}\`)`, c.id)
        }
        if (stage.gate) {
          c.status = 'waiting_human'; c.waitKind = 'gate'
          c.pendingQuestion = `Duyệt qua "${stage.name}"?`
          post(this.store, threadOf(c.id), 'engine', 'decision', `⛔ GATE: ${c.pendingQuestion} (cần bạn duyệt)`, c.id)
          this.store.putCard(c)
        } else this.advanceCard(c)
        break
      case 'rework': { // D3: review/test phát hiện lỗi -> tự trả về bước trước sửa (loop tới khi đạt; loop-breaker chặn vô hạn)
        c.reviewNotes = (c.reviewNotes || []).concat(result.outcome.summary)
        // TRÍ NHỚ: review tự bắt lỗi = signal âm cụ thể → ghi vào Brain/inbox (kênh auto bổ sung cho agent).
        writeSignalSafe({ topic: `${c.projectId}/${slug(c.title)}`, signal: 'negative', principle: result.outcome.summary, scope: persona.id, cardId: c.id, agent: 'engine', raw: `${persona.name} REWORK @ ${stage.name}: ${result.outcome.summary}` })
        c.stageIndex = Math.max(0, c.stageIndex - 1)
        c.status = 'queued'
        const back = pipe.stages[c.stageIndex]
        // C1 (Track C): não nghề — builder bị trả lại HỌC từ feedback review (tránh lặp lỗi lần sau).
        appendAgentLesson(back.personaId, result.outcome.summary, 'miss')
        c.history.push({ ts: Date.now(), stage: back.id, event: 'rework', detail: result.outcome.summary })
        post(this.store, threadOf(c.id), persona.name, 'handoff', `↩ REWORK → "${back.name}": ${result.outcome.summary}`, c.id)
        this.store.putCard(c)
        // C2 Stuck-detector: nếu rework >= ngưỡng → launch triage fire-and-forget
        if (this.isStuck(c, stage)) {
          this.triggerStuckTriage(c, stage, persona)
        }
        break
      }
      case 'needs_decision':
        c.status = 'waiting_human'; c.waitKind = 'decision'
        c.pendingQuestion = result.outcome.question ?? result.outcome.summary
        post(this.store, threadOf(c.id), 'engine', 'decision', `⛔ CẦN QUYẾT ĐỊNH: ${c.pendingQuestion}`, c.id)
        this.store.putCard(c)
        break
      case 'delegate': {
        const d = result.outcome.delegateTo!
        if (c.depth >= this.maxDepth) {
          c.status = 'failed'
          post(this.store, threadOf(c.id), 'engine', 'system', `⛔ depth-breaker: delegate quá sâu (depth ${c.depth} ≥ ${this.maxDepth}) → HALT`, c.id)
          this.store.putCard(c)
          break
        }
        const tgt = this.store.personas.get(d.personaId)
        const child = this.createCard(d.title, d.brief, d.pipelineId ?? c.pipelineId, c.id, c.depth + 1, c.projectId)
        c.blockedBy.push(child.id)
        c.status = 'blocked'
        c.blockKind = 'delegate'
        // agent↔agent: người đang làm NHỜ persona khác (handoff thật, không phải log)
        post(this.store, threadOf(c.id), persona.name, 'handoff', `📨 → ${tgt?.name ?? d.personaId}: nhờ xử lý "${d.title}"`, c.id)
        this.store.putCard(c)
        break
      }
      case 'fail':
        c.status = 'failed'
        this.store.putCard(c)
        this.distill(c) // A2: card fail cũng giàu bài học
        break
    }

    // agent↔agent: child xong -> báo NGƯỢC về người nhờ (trong thread của parent)
    if (c.parentId && c.status === 'done') {
      post(this.store, threadOf(c.parentId), persona.name, 'handoff', `↩ "${c.title}" xong — trả về`, c.parentId)
    }
  }

  // A2 auto-memory nền: distill bài học từ card vừa kết thúc → Brain/inbox (dream gộp sau).
  // A3 session-lineage: ghi note tóm tắt phiên vào Daily/ (template + temporal anchor — chống giải lại việc cũ).
  // Fire-and-forget: lỗi/không có claude/không có vault = im lặng — KHÔNG đụng vòng đời card.
  private distill(c: Card) {
    writeSessionNoteSafe(c) // deterministic, sync, rẻ
    distillCardSafe(c)
      .then((sigs) => {
        if (sigs.length) post(this.store, threadOf(c.id), 'engine', 'system', `🧠 học nền: ${sigs.length} signal (${sigs.map((s) => s.topic.split('/')[1]).join(', ')})`, c.id)
        // C4 win-lesson: signal POSITIVE từ distill = cách làm tốt → ghi vào não nghề các persona EXECUTOR đã chạy card này.
        // (negative đã được wire ở rework). Dedup trong appendAgentLesson chặn nhồi.
        const wins = sigs.filter((s) => s.signal === 'positive')
        if (wins.length) for (const pid of this.executorPersonasOf(c)) for (const w of wins) appendAgentLesson(pid, w.principle, 'win')
      })
      .catch(() => { /* nuốt — học hỏng không được làm gãy gì */ })
    // M3.3 skill self-learn: card DONE → ĐỀ XUẤT skill tái dùng vào skills/_proposed/ (KHÔNG vào INDEX = không auto-active).
    // CHỈ chạy khi LUCY_SKILL_LEARN=1 (drafter tốn token) — proposeSkillFrom tự gate ghi đĩa nữa. Fire-and-forget.
    if (c.status === 'done' && skillLearnFlagOn()) {
      proposeSkillFrom(c)
        .then((r) => {
          if (r.wrote) post(this.store, threadOf(c.id), 'engine', 'system', `🧩 đề xuất skill mới: ${r.slug} (chờ duyệt, chưa active)`, c.id)
        })
        .catch(() => { /* nuốt — đề xuất skill hỏng không được làm gãy gì */ })
    }
  }

  // persona kind='executor' đã chạy ≥1 stage của card (từ pipeline) → đối tượng nhận win-lesson kỹ thuật.
  private executorPersonasOf(c: Card): string[] {
    const pipe = this.store.pipelines.get(c.pipelineId)
    if (!pipe) return []
    const ids = new Set<string>()
    for (const st of pipe.stages) { const p = this.store.personas.get(st.personaId); if (p?.kind === 'executor') ids.add(p.id) }
    return [...ids]
  }

  // ── C2 Stuck-detector ──

  /** Kiểm tra card có bị kẹt (stuck) không — logic ở engine-triage.detectStuck. */
  private isStuck(c: Card, stage: Stage): boolean {
    return detectStuck(c, stage, { handled: this.stuckHandled.has(c.id), stuckThreshold: this.stuckThreshold, maxStageVisits: this.maxStageVisits })
  }

  /** Launch triage async — fire-and-forget, không block engine. */
  private triggerStuckTriage(c: Card, stage: Stage, persona: Persona): void {
    const cardId = c.id
    const stageName = stage.name
    // tránh double-trigger
    if (this.stuckPending.has(cardId)) return
    this.stuckPending.set(cardId, stageName)
    this.stuckHandled.add(cardId)

    // PARK ngay: chặn card bị dispatch/rework tiếp (leo loop-cap) trong lúc triage async chạy.
    // Triage .then sẽ ghi đè trạng thái (upgrade→queued / split→blocked / escalate→giữ).
    c.status = 'waiting_human'; c.waitKind = 'loop'
    c.pendingQuestion = `⏳ Lucy đang phân tích card kẹt ở "${stageName}"…`
    this.store.putCard(c)

    this.stuckHandler(c, stageName)
      .then((decision) => {
        const card = this.store.getCard(cardId)
        if (!card || card.status === 'done' || card.status === 'failed') return
        this.stuckPending.delete(cardId)
        post(this.store, threadOf(card.id), 'engine', 'system', `🧩 triage: ${decision.action} — ${decision.reason}`, card.id)
        // áp quyết định (split/upgrade/escalate) — logic ở engine-triage.applyTriageDecision
        applyTriageDecision(this.store, card, stageName, decision, {
          maxDepth: this.maxDepth,
          createSubcard: (title, brief, pipelineId, parentId, depth, projectId) =>
            this.createCard(title, brief, pipelineId, parentId, depth, projectId, false, undefined, []),
        })
      })
      .catch((err) => {
        this.stuckPending.delete(cardId)
        const card = this.store.getCard(cardId)
        if (!card) return
        card.status = 'waiting_human'; card.waitKind = 'stuck'
        card.pendingQuestion = `⛔ Triage lỗi: ${err instanceof Error ? err.message : String(err)}. Bill xem?`
        this.store.putCard(card)
        post(this.store, threadOf(card.id), 'engine', 'decision', `⛔ Triage crash — escalate Bill`, card.id)
      })
  }

  /** Xử lý các card stuck-pending trong tick (nếu có). */
  private processStuckPending(): void {
    for (const [cardId, stageName] of this.stuckPending) {
      const card = this.store.getCard(cardId)
      if (!card) { this.stuckPending.delete(cardId); continue }
      // Nếu card còn 'queued' mà đang chờ triage → tạm dừng (không cho dispatch)
      if (card.status === 'queued') {
        card.status = 'waiting_human'
        card.waitKind = 'loop'
        card.pendingQuestion = `⏳ Lucy đang phân tích card kẹt ở "${stageName}"...`
        this.store.putCard(card)
      }
    }
  }

  // child xong -> parent qua stage tiếp
  private resolveUnblocks() {
    for (const c of this.store.listCards()) {
      if (c.status !== 'blocked' || !c.blockedBy.length) continue
      const still = c.blockedBy.filter((id) => {
        const d = this.store.getCard(id)
        return d && d.status !== 'done' && d.status !== 'failed'
      })
      if (!still.length) {
        c.blockedBy = []
        if (c.blockKind === 'dep') { // task phụ thuộc xong -> BẮT ĐẦU chạy stage hiện tại (không advance)
          c.blockKind = undefined; c.status = 'queued'
          post(this.store, threadOf(c.id), 'engine', 'system', `▲ task phụ thuộc xong → bắt đầu "${c.title}"`, c.id)
          this.store.putCard(c)
        } else { // delegate: con xong -> parent qua stage kế
          c.blockKind = undefined
          post(this.store, threadOf(c.id), 'engine', 'system', `▲ việc con xong → RESUME "${c.title}"`, c.id)
          this.advanceCard(c)
        }
      } else c.blockedBy = still
    }
  }

  // ── LOCAL worker in-process: claim+run+submit hết queue ──
  async drainLocal(): Promise<number> {
    let n = 0
    let spec = this.claim()
    while (spec) {
      const res = await this.runner.run(spec.card, spec.stage, spec.persona, spec.card.workspace)
      this.submit(spec.jobId, res)
      n++
      spec = this.claim()
    }
    return n
  }

  // chạy tới khi không còn việc TỰ ĐỘNG (local mode) — helper demo/test.
  // (resolveUnblocks chạy cuối tick có thể queue card mới -> phải xét 'còn queued' để không thoát sớm)
  async runUntilIdle(maxRounds = 300): Promise<void> {
    for (let i = 0; i < maxRounds; i++) {
      const d = this.tick()
      if (this.paused) break
      const r = await this.drainLocal()
      const moreQueued = this.store.listCards().some((c) => c.status === 'queued')
      if (!d && !r && !moreQueued && !this.pending.length && !this.inFlight.size) break
    }
  }
}
