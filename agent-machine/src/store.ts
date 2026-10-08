// Store — thin file-based persistence (swappable cho Postgres+pg-boss+DBOS ở M2.1).
import fs from 'node:fs'
import path from 'node:path'
import type { Card, Persona, Pipeline, Project, ChannelMsg, LedgerEntry } from './types'

export class Store {
  dir: string
  cards = new Map<string, Card>()
  projects = new Map<string, Project>()
  personas = new Map<string, Persona>()
  pipelines = new Map<string, Pipeline>()

  constructor(dir: string) {
    this.dir = dir
    fs.mkdirSync(path.join(dir, 'workspaces'), { recursive: true })
    this.load()
  }

  private cardsFile() { return path.join(this.dir, 'cards.json') }
  private projectsFile() { return path.join(this.dir, 'projects.json') }

  load() {
    try {
      const arr = JSON.parse(fs.readFileSync(this.cardsFile(), 'utf8')) as Card[]
      for (const c of arr) this.cards.set(c.id, c)
    } catch { /* fresh */ }
    try {
      const arr = JSON.parse(fs.readFileSync(this.projectsFile(), 'utf8')) as Project[]
      for (const p of arr) this.projects.set(p.id, p)
    } catch { /* fresh */ }
  }
  // atomic: ghi tmp rồi rename -> crash giữa chừng không hỏng file
  private atomicWrite(file: string, data: unknown) {
    const tmp = file + '.tmp'
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2))
    fs.renameSync(tmp, file)
  }
  private saveCards() { this.atomicWrite(this.cardsFile(), [...this.cards.values()]) }
  private saveProjects() { this.atomicWrite(this.projectsFile(), [...this.projects.values()]) }

  putProject(p: Project) { p.updatedAt = Date.now(); this.projects.set(p.id, p); this.saveProjects() }
  getProject(id: string) { return this.projects.get(id) }
  listProjects() { return [...this.projects.values()] }
  deleteProject(id: string): boolean { const ok = this.projects.delete(id); if (ok) this.saveProjects(); return ok }

  putCard(c: Card) { c.updatedAt = Date.now(); this.cards.set(c.id, c); this.saveCards() }
  getCard(id: string) { return this.cards.get(id) }
  listCards() { return [...this.cards.values()] }
  deleteCard(id: string): boolean { const ok = this.cards.delete(id); if (ok) this.saveCards(); return ok }
  // xoá workspace dir của card — CHỈ trong AM_DATA/workspaces (FS defense, không xoá ra ngoài)
  removeWorkspace(cardId: string) {
    const base = path.resolve(path.join(this.dir, 'workspaces'))
    const ws = path.resolve(path.join(this.dir, 'workspaces', cardId))
    if (ws.startsWith(base + path.sep)) fs.rmSync(ws, { recursive: true, force: true })
  }

  registerPersona(p: Persona) { this.personas.set(p.id, p) }
  removePersona(id: string): boolean { return this.personas.delete(id) }
  registerPipeline(p: Pipeline) { this.pipelines.set(p.id, p) }

  // pipeline TỰ TẠO lúc chạy (custom flow) — lưu riêng AM_DATA/custom-pipelines.json, nạp SAU config.
  customPipelineIds = new Set<string>()
  private pipelinesFile() { return path.join(this.dir, 'custom-pipelines.json') }
  loadCustomPipelines() {
    try { const arr = JSON.parse(fs.readFileSync(this.pipelinesFile(), 'utf8')) as Pipeline[]; for (const p of arr) { this.pipelines.set(p.id, p); this.customPipelineIds.add(p.id) } } catch { /* none */ }
  }
  private saveCustomPipelines() { this.atomicWrite(this.pipelinesFile(), [...this.customPipelineIds].map((id) => this.pipelines.get(id)).filter(Boolean)) }
  saveCustomPipeline(p: Pipeline) { this.pipelines.set(p.id, p); this.customPipelineIds.add(p.id); this.saveCustomPipelines() }
  deleteCustomPipeline(id: string): boolean { if (!this.customPipelineIds.has(id)) return false; this.pipelines.delete(id); this.customPipelineIds.delete(id); this.saveCustomPipelines(); return true }

  postMessage(m: ChannelMsg) { fs.appendFileSync(path.join(this.dir, 'channels.jsonl'), JSON.stringify(m) + '\n') }
  readChannel(channel?: string): ChannelMsg[] {
    try {
      const lines = fs.readFileSync(path.join(this.dir, 'channels.jsonl'), 'utf8').trim().split('\n')
      const all = lines.filter(Boolean).map((l) => JSON.parse(l) as ChannelMsg)
      return channel ? all.filter((m) => m.channel === channel) : all
    } catch { return [] }
  }

  appendLedger(e: LedgerEntry) {
    fs.appendFileSync(path.join(this.dir, 'ledger.jsonl'), JSON.stringify(e) + '\n')
    this._ledgerCache = null // DASH-FIX S5: ghi mới → bỏ cache đọc, lượt sau parse lại tươi
  }

  // DASH-FIX S5 perf: /metrics gọi readLedger 3-4× mỗi request → cache parsed theo mtime+size, tránh đọc+parse full JSONL lặp lại.
  // Ledger hiện nhỏ (~35KB); cache đủ rẻ, chưa cần rotate file. Invalidate khi mtime/size đổi (ghi ngoài tiến trình) hoặc appendLedger.
  private _ledgerCache: { mtimeMs: number; size: number; entries: LedgerEntry[] } | null = null

  readLedger(): LedgerEntry[] {
    const file = path.join(this.dir, 'ledger.jsonl')
    let stat: fs.Stats
    try { stat = fs.statSync(file) } catch { return [] }
    const c = this._ledgerCache
    if (c && c.mtimeMs === stat.mtimeMs && c.size === stat.size) return c.entries
    try {
      const raw = fs.readFileSync(file, 'utf8')
      const lines = raw.trim().split('\n').filter(Boolean)
      const out: LedgerEntry[] = []
      for (const l of lines) {
        try {
          const e = JSON.parse(l) as LedgerEntry
          // DASH-FIX S1 backward-compat: dòng cũ thiếu source/cacheTok → mặc định worker, cache 0 (model resolve sau ở metrics).
          if (e.source === undefined) e.source = 'worker'
          if (e.cacheTok === undefined) e.cacheTok = 0
          out.push(e)
        } catch { /* bỏ dòng hỏng */ }
      }
      this._ledgerCache = { mtimeMs: stat.mtimeMs, size: stat.size, entries: out }
      return out
    } catch { return [] }
  }
}
