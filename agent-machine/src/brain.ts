// brain.ts — data API "Bộ não" cho UI hub: duyệt vault, đọc file md, list preference + inbox, + graph tinh hà.
// Recall lo search/index; dream lo gộp. File này = mặt đọc cho tab UI (KHÔNG sửa vault, chỉ đọc).
import fs from 'node:fs'
import path from 'node:path'
import { parseFrontmatter, parseNote } from './vault'

// thư mục duyệt được trên UI (gồm cả Brain để xem preference/inbox/log).
const BROWSE_DIRS = ['Context', 'Projects', 'Skills', 'Daily', 'Brain']

export type VaultEntry = { path: string; title: string; type: string; status?: string }

export function browseVault(vaultDir: string): { dir: string; files: VaultEntry[] }[] {
  const out: { dir: string; files: VaultEntry[] }[] = []
  for (const d of BROWSE_DIRS) {
    const files: VaultEntry[] = []
    collect(path.join(vaultDir, d), vaultDir, files)
    files.sort((a, b) => a.path.localeCompare(b.path))
    if (files.length) out.push({ dir: d, files })
  }
  return out
}
function collect(abs: string, vaultDir: string, out: VaultEntry[]) {
  let entries: fs.Dirent[]
  try { entries = fs.readdirSync(abs, { withFileTypes: true }) } catch { return }
  for (const e of entries) {
    if (e.name.startsWith('.')) continue
    const full = path.join(abs, e.name)
    if (e.isDirectory()) collect(full, vaultDir, out)
    else if (e.isFile() && e.name.toLowerCase().endsWith('.md')) {
      const rel = path.relative(vaultDir, full).split(path.sep).join('/')
      try {
        const { data } = parseFrontmatter(fs.readFileSync(full, 'utf8'))
        out.push({ path: rel, title: String(data.title || e.name.replace(/\.md$/, '')), type: String(data.type || 'note'), status: data.status ? String(data.status) : undefined })
      } catch { out.push({ path: rel, title: e.name.replace(/\.md$/, ''), type: 'note' }) }
    }
  }
}

// đọc 1 file md trong vault (path-guard: chỉ trong vault, chỉ .md, chặn .index/.snapshots).
export function readVaultFile(vaultDir: string, rel: string): { path: string; content: string } | null {
  const base = path.resolve(vaultDir)
  const fp = path.resolve(base, rel)
  if (!fp.startsWith(base + path.sep)) return null
  if (!fp.toLowerCase().endsWith('.md')) return null
  if (/[\\/]\.(index|snapshots)[\\/]/.test(fp)) return null
  try {
    if (!fs.statSync(fp).isFile()) return null
    return { path: rel.split(path.sep).join('/'), content: fs.readFileSync(fp, 'utf8').slice(0, 200000) }
  } catch { return null }
}

export type PrefLite = { id: string; topic: string; principle: string; sign: string; status: string; confidence: number; band: string; scope?: string; pinned: boolean; path: string }

export function listPreferences(vaultDir: string): PrefLite[] {
  const dir = path.join(vaultDir, 'Brain', 'preferences')
  let names: string[]
  try { names = fs.readdirSync(dir) } catch { return [] }
  const out: PrefLite[] = []
  for (const name of names) {
    if (!name.endsWith('.md')) continue
    try {
      const { data } = parseFrontmatter(fs.readFileSync(path.join(dir, name), 'utf8'))
      if (data.kind !== 'brain-preference') continue
      out.push({
        id: String(data.id || name.replace(/\.md$/, '')), topic: String(data.topic || ''), principle: String(data.principle || ''),
        sign: String(data.sign || ''), status: String(data.status || 'unconfirmed'), confidence: Number(data.confidence) || 0,
        band: String(data.band || 'low'), scope: data.scope ? String(data.scope) : undefined,
        pinned: data.pinned === true || data.pinned === 'true', path: `Brain/preferences/${name}`,
      })
    } catch { /* skip */ }
  }
  // confirmed trước, rồi theo confidence desc
  const rank: Record<string, number> = { confirmed: 0, unconfirmed: 1, stale: 2, rebutted: 3, expired: 4 }
  return out.sort((a, b) => (rank[a.status] ?? 9) - (rank[b.status] ?? 9) || b.confidence - a.confidence)
}

export type InboxSig = { id: string; topic: string; signal: string; principle: string; agent: string; created_at: string; path: string }
export function listInbox(vaultDir: string): InboxSig[] {
  const dir = path.join(vaultDir, 'Brain', 'inbox')
  let names: string[]
  try { names = fs.readdirSync(dir) } catch { return [] }
  const out: InboxSig[] = []
  for (const name of names) {
    if (!name.endsWith('.md')) continue
    const full = path.join(dir, name)
    try {
      if (!fs.statSync(full).isFile()) continue
      const { data } = parseFrontmatter(fs.readFileSync(full, 'utf8'))
      if (data.kind !== 'brain-signal') continue
      out.push({
        id: String(data.id || name.replace(/\.md$/, '')), topic: String(data.topic || ''), signal: String(data.signal || ''),
        principle: String(data.principle || ''), agent: String(data.agent || ''), created_at: String(data.created_at || ''),
        path: `Brain/inbox/${name}`,
      })
    } catch { /* skip */ }
  }
  return out.sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''))
}

export function readActive(vaultDir: string): string {
  try { return fs.readFileSync(path.join(vaultDir, 'Brain', 'active.md'), 'utf8') } catch { return '' }
}

// pin/unpin 1 preference (nút 📌). Sửa ĐÚNG dòng frontmatter `pinned:` → dream sau vẫn đọc & giữ (readPreferences đọc pinned).
export function setPinned(vaultDir: string, prefId: string, pinned: boolean): boolean {
  const dir = path.join(vaultDir, 'Brain', 'preferences')
  let names: string[]
  try { names = fs.readdirSync(dir) } catch { return false }
  for (const name of names) {
    if (!name.endsWith('.md')) continue
    const file = path.join(dir, name)
    try {
      const raw = fs.readFileSync(file, 'utf8')
      const { data } = parseFrontmatter(raw)
      if (data.kind !== 'brain-preference' || String(data.id || name.replace(/\.md$/, '')) !== prefId) continue
      const next = /^pinned:.*$/m.test(raw) ? raw.replace(/^pinned:.*$/m, `pinned: ${pinned}`) : raw.replace(/^---\n/, `---\npinned: ${pinned}\n`)
      fs.writeFileSync(file, next)
      return true
    } catch { /* skip */ }
  }
  return false
}

// ════════ TINH HÀ TRI THỨC — graph trí nhớ (NEURAL_GALAXY.md) ════════
// node = note thật · edge = wikilink [[...]] THẬT · brightness = confidence/độ-mới · mass = số quan sát.
// Đọc thẳng file (không đụng FTS5) → tách bạch recall(tìm) vs galaxy(nhìn).
export type GraphNode = {
  id: string; label: string; kind: string; zone: string
  mass: number; brightness: number; mtime: number; obs: number; path?: string
  confidence?: number; band?: string; sign?: string; status?: string; topic?: string; ghost?: boolean
}
export type GraphLink = { source: string; target: string; rel: string; weight: number; real: boolean }
export type BrainGraph = { configured: boolean; nodes: GraphNode[]; links: GraphLink[]; born: string[]; ts: number }

// thư mục → zone (chòm sao). preferences/entities/decisions cũng vào graph (khác recall index).
const GRAPH_DIRS: { dir: string; zone: string }[] = [
  { dir: 'Context', zone: 'context' }, { dir: 'Projects', zone: 'projects' }, { dir: 'Skills', zone: 'skills' },
  { dir: 'Daily', zone: 'timeline' }, { dir: 'Brain/entities', zone: 'entities' },
  { dir: 'Brain/decisions', zone: 'decisions' }, { dir: 'Brain/preferences', zone: 'learned' },
  { dir: 'Brain/claude-memory', zone: 'memory' }, // auto-memory harness (redirect vào vault) — ký ức đã chốt
  { dir: 'Brain/agents', zone: 'agents' },        // K3: NÃO NGHỀ riêng từng agent (builder/eng/reviewer…) — multi-agent visible
]
const MASS_BASE: Record<string, number> = { person: 26, identity: 18, project: 16, agent: 15, note: 13, skill: 12, entity: 12, decision: 10, memory: 9, preference: 8, daily: 6, ghost: 4 }
const DAY = 86400e3

export function buildGraph(vaultDir: string, opts: { bornWithinMs?: number; now?: number } = {}): BrainGraph {
  const now = opts.now ?? Date.now()
  const bornWin = opts.bornWithinMs ?? 0
  const nodes: GraphNode[] = []
  const byId = new Map<string, GraphNode>()
  const links: GraphLink[] = []
  const born: string[] = []

  const add = (n: GraphNode) => { if (!byId.has(n.id)) { byId.set(n.id, n); nodes.push(n) } }

  for (const { dir, zone } of GRAPH_DIRS) {
    for (const rel of listMd(vaultDir, dir)) {
      if (zone === 'memory' && /\/MEMORY\.md$/i.test(rel)) continue // file index của auto-memory — không phải ký ức
      let raw: string, mtime: number
      try { raw = fs.readFileSync(path.join(vaultDir, rel), 'utf8'); mtime = fs.statSync(path.join(vaultDir, rel)).mtimeMs } catch { continue }
      const n = parseNote(raw, rel)
      const kind = nodeKind(zone, n.type, n.permalink, n.tags)
      const ageDays = (now - mtime) / DAY
      const isPref = kind === 'preference'
      const conf = isPref ? Number(n.frontmatter.confidence) || 0 : undefined
      // K3: agent brain file thường KHÔNG có frontmatter permalink → id/label ổn định từ tên file (persona id)
      const isAgent = zone === 'agents'
      const agentId = isAgent ? path.basename(rel).replace(/\.md$/i, '') : ''
      const node: GraphNode = {
        id: isAgent ? 'agent-' + agentId : n.permalink, label: isAgent ? agentId : n.title, kind, zone,
        mass: (MASS_BASE[kind] ?? 10) + n.observations.length * 1.5,
        brightness: isPref ? Math.max(0.2, conf ?? 0) : clamp(1 - ageDays / 90, 0.15, 1),
        mtime, obs: n.observations.length, path: rel,
        ...(isPref ? { confidence: conf, band: String(n.frontmatter.band || 'low'), sign: String(n.frontmatter.sign || ''), status: String(n.frontmatter.status || ''), topic: String(n.frontmatter.topic || '') } : {}),
      }
      add(node)
      if (bornWin > 0 && now - mtime < bornWin) born.push(node.id)
      // cạnh explicit/inline từ wikilink THẬT
      for (const r of n.relations) links.push({ source: n.permalink, target: r.target, rel: r.type, weight: 1, real: true })
      // preference → bám hành tinh dự án chủ (topic = "<projectId>/<...>")
      if (isPref && node.topic) {
        const proj = 'project-' + node.topic.split('/')[0]
        links.push({ source: n.permalink, target: proj, rel: 'về', weight: Math.max(0.2, conf ?? 0), real: false })
      }
    }
  }

  // ghost node cho wikilink trỏ note CHƯA tồn tại (gợi ý chỗ nên viết tiếp — MEMORY.md "link liberally")
  for (const l of links) {
    if (!byId.has(l.target)) add({ id: l.target, label: l.target, kind: 'ghost', zone: 'ghost', mass: MASS_BASE.ghost, brightness: 0.12, mtime: 0, obs: 0, ghost: true })
  }
  // bỏ self-loop
  const clean = links.filter((l) => l.source !== l.target)
  return { configured: true, nodes, links: clean, born, ts: now }
}

function nodeKind(zone: string, type: string, permalink: string, tags: string[]): string {
  if (zone === 'memory') return 'memory'
  if (zone === 'agents') return 'agent'
  if (zone === 'learned') return 'preference'
  if (zone === 'entities') return 'entity'
  if (zone === 'decisions') return 'decision'
  if (zone === 'skills') return 'skill'
  if (zone === 'timeline') return 'daily'
  if (zone === 'projects') return 'project'
  if (permalink.startsWith('user-') || tags.includes('user')) return 'person'
  if (permalink.includes('identity') || type === 'identity') return 'identity'
  return 'note'
}
function clamp(v: number, lo: number, hi: number) { return Math.max(lo, Math.min(hi, v)) }
function listMd(vaultDir: string, dir: string): string[] {
  const out: string[] = []
  const abs = path.join(vaultDir, dir)
  let entries: fs.Dirent[]
  try { entries = fs.readdirSync(abs, { withFileTypes: true }) } catch { return out }
  for (const e of entries) {
    if (e.name.startsWith('.')) continue
    if (e.isFile() && e.name.toLowerCase().endsWith('.md')) out.push((dir + '/' + e.name))
  }
  return out
}
