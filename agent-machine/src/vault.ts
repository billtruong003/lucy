// vault.ts — đọc + parse markdown của lucy-vault (frontmatter + observation + relation).
// Dùng chung cho recall (index) và dream (consolidation). Format = chuẩn basic-memory (đã crib regex).
// KHÔNG phụ thuộc better-sqlite3 → import được ở mọi nơi (engine hook, dream, CLI).
import fs from 'node:fs'
import path from 'node:path'

export type Observation = { category: string | null; content: string; tags: string[]; context: string | null }
export type Relation = { type: string; target: string; context: string | null }
export type ParsedNote = {
  frontmatter: Record<string, unknown>
  title: string
  type: string
  permalink: string
  tags: string[]
  body: string // markdown sau frontmatter (cho FTS body)
  observations: Observation[]
  relations: Relation[]
}

// Parse frontmatter YAML-nhẹ (format ta tự ghi: scalar · "quoted" · [inline, array]).
// KHÔNG dùng yaml lib — format hẹp + ta kiểm soát cả 2 đầu ghi/đọc (dream cũng ghi đúng shape này).
export function parseFrontmatter(raw: string): { data: Record<string, unknown>; body: string } {
  if (!raw.startsWith('---')) return { data: {}, body: raw }
  const end = raw.indexOf('\n---', 3)
  if (end === -1) return { data: {}, body: raw }
  const fmBlock = raw.slice(raw.indexOf('\n') + 1, end)
  const body = raw.slice(end + 4).replace(/^\r?\n/, '')
  const data: Record<string, unknown> = {}
  for (const raw0 of fmBlock.split('\n')) {
    const line = raw0.replace(/\r$/, '') // CRLF: bỏ \r cuối → khỏi hỏng match $ (file Windows)
    const m = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/)
    if (!m) continue
    data[m[1]] = parseScalar(m[2].trim())
  }
  return { data, body }
}

// upsertFrontmatterKey — chèn/sửa 1 key scalar top-level trong frontmatter (giữ nguyên body + key khác).
// Dùng cho PHASE 4 (đánh dấu valid_to=now mà KHÔNG đụng nội dung fact). File chưa có frontmatter → tạo block mới.
// Khớp shape parseFrontmatter đọc lại (top-level `key: value`). value bọc "" nếu có ký tự đặc biệt.
export function upsertFrontmatterKey(raw: string, key: string, value: string): string {
  const safe = /[:#\[\]{}",]|^\s|\s$/.test(value) ? `"${value.replace(/"/g, '\\"')}"` : value
  const line = `${key}: ${safe}`
  if (!raw.startsWith('---')) return `---\n${line}\n---\n\n${raw}`
  const end = raw.indexOf('\n---', 3)
  if (end === -1) return `---\n${line}\n---\n\n${raw}`
  const head = raw.slice(0, raw.indexOf('\n') + 1) // "---\n"
  const fmBlock = raw.slice(raw.indexOf('\n') + 1, end)
  const tail = raw.slice(end + 1) // "---\n<body>"
  const keyRe = new RegExp(`^${key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}:\\s.*$`, 'm')
  const newFm = keyRe.test(fmBlock) ? fmBlock.replace(keyRe, line) : fmBlock.replace(/\n*$/, '') + `\n${line}`
  return head + newFm + '\n' + tail
}

function parseScalar(v: string): unknown {
  if (!v) return ''
  if (v.startsWith('[') && v.endsWith(']')) {
    return v.slice(1, -1).split(',').map((s) => unquote(s.trim())).filter((s) => s !== '')
  }
  return unquote(v)
}
function unquote(s: string): string {
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) return s.slice(1, -1)
  return s
}

// Observation:  - [category] content #tag1 #tag2 (context)   ·  category optional
// Crib: basic-memory markdown/plugins.py (is_observation/parse_observation).
const OBS_RE = /^-\s+\[([^[\]()]+)\]\s+(.+)$/
// Relation (explicit):  - relation_type [[target]] (context)   ·  type = 1 từ HOẶC "nhiều từ"
// [\p{L}\p{N}_]+ (cờ u): type tiếng Việt "chủ_của"/"điều_phối_bởi" — \w+ ASCII không match được.
const REL_RE = /^-\s+([\p{L}\p{N}_]+|"[^"]+")\s+\[\[([^\]]+)\]\]\s*(?:\(([^)]*)\))?\s*$/u

export function parseObservationLine(line: string): Observation | null {
  const m = line.match(OBS_RE)
  if (!m) return null
  const category = m[1].trim()
  let content = m[2].trim()
  // tách (context) ở cuối
  let context: string | null = null
  if (content.endsWith(')')) {
    const start = content.lastIndexOf('(')
    if (start !== -1) { context = content.slice(start + 1, -1).trim(); content = content.slice(0, start).trim() }
  }
  // tách #tag (giữ nguyên content)
  const tags: string[] = []
  for (const part of content.split(/\s+/)) {
    if (part.startsWith('#') && part.length > 1) tags.push(...part.split('#').filter(Boolean))
  }
  return { category, content, tags, context }
}

export function parseRelationLine(line: string): Relation | null {
  const m = line.match(REL_RE)
  if (!m) return null
  return { type: unquote(m[1].trim()), target: m[2].trim(), context: (m[3] ?? '').trim() || null }
}

const DIR_TYPE: Record<string, string> = { Projects: 'project', Context: 'note', Skills: 'skill', Daily: 'daily' }

// Parse 1 file markdown vault → note có cấu trúc. relPath = đường dẫn tương đối gốc vault (vd "Context/USER.md").
export function parseNote(raw: string, relPath: string): ParsedNote {
  const { data, body } = parseFrontmatter(raw)
  const observations: Observation[] = []
  const relations: Relation[] = []
  for (const line of body.split('\n')) {
    const t = line.trim()
    if (!t.startsWith('-')) continue
    const rel = parseRelationLine(t)
    if (rel) { relations.push(rel); continue }
    const obs = parseObservationLine(t)
    if (obs && obs.content) observations.push(obs)
  }
  const topDir = relPath.split(/[\\/]/)[0]
  const fmTags = Array.isArray(data.tags) ? (data.tags as unknown[]).map(String) : []
  const obsTags = observations.flatMap((o) => o.tags)
  const tags = [...new Set([...fmTags, ...obsTags])]
  const fileBase = path.basename(relPath).replace(/\.md$/i, '')
  const title = String(data.title || firstHeading(body) || fileBase)
  const type = String(data.type || DIR_TYPE[topDir] || 'note')
  const permalink = String(data.permalink || slug(fileBase))
  return { frontmatter: data, title, type, permalink, tags, body, observations, relations }
}

function firstHeading(body: string): string | null {
  const m = body.match(/^#\s+(.+)$/m)
  return m ? m[1].trim() : null
}
export function slug(s: string): string {
  return s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
}

// Liệt kê mọi file .md trong các thư mục cho phép (relative-path trả về). Bỏ thư mục máy-quản.
export function listVaultFiles(vaultDir: string, dirs: string[]): string[] {
  const out: string[] = []
  for (const d of dirs) {
    const abs = path.join(vaultDir, d)
    walk(abs, vaultDir, out)
  }
  return out
}
function walk(abs: string, vaultDir: string, out: string[]) {
  let entries: fs.Dirent[]
  try { entries = fs.readdirSync(abs, { withFileTypes: true }) } catch { return }
  for (const e of entries) {
    const full = path.join(abs, e.name)
    if (e.isDirectory()) walk(full, vaultDir, out)
    else if (e.isFile() && e.name.toLowerCase().endsWith('.md')) out.push(path.relative(vaultDir, full).split(path.sep).join('/'))
  }
}
