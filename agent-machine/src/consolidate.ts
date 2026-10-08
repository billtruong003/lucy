// consolidate.ts — PHASE 3 "gộp trí nhớ" kiểu Mem0: mỗi fact so vector-similarity với fact cũ →
// quyết ADD / UPDATE / DELETE / NOOP + reflection (Generative-Agents) bằng LLM RẺ (lane free / Haiku).
// Đối tượng = Brain/claude-memory/*.md (1 file = 1 fact, auto-memory built-in redirect vào vault).
//
// ⚠️ DRY-RUN MẶC ĐỊNH: chỉ DỰNG plan + in diff + ghi report + snapshot — TUYỆT ĐỐI KHÔNG xoá/ghi đè
// file thật trừ khi env LUCY_CONSOLIDATE_APPLY=1. Trust-weight (Bill/type=user ×2) ưu tiên GIỮ.
//
// An toàn: embedder/decider/reflector injectable (smoke khỏi mạng); mọi lỗi LLM → NOOP (không bao giờ
// xoá nhầm vì model im lặng); throw KHÔNG bao giờ thoát ra ngoài consolidate().
import fs from 'node:fs'
import path from 'node:path'
import { parseFrontmatter, upsertFrontmatterKey, slug } from './vault'
import { jinaEmbed, vectorFlagOn, type Embedder } from './embed'
import { auxComplete } from './aux-client'

const MEM_DIR = 'Brain/claude-memory'
const SIM_DUP = Number(process.env.LUCY_CONSOLIDATE_SIM) || 0.86       // ngưỡng coi là "trùng/gần trùng" → xét ADD/UPDATE/DELETE
const SIM_CLUSTER = Number(process.env.LUCY_CONSOLIDATE_CLUSTER_SIM) || 0.78 // ngưỡng gom cụm cho reflection
const REFLECT_MIN_TRUST = Number(process.env.LUCY_CONSOLIDATE_REFLECT_TRUST) || 5 // tổng trust cụm ≥ → sinh insight

export type Fact = { file: string; name: string; description: string; body: string; type: string; trust: number; mtime: number }
// PHASE 4 thêm SUPERSEDE: 2 fact MÂU THUẪN (không phải trùng) → đánh dấu fact CŨ hết hiệu lực (valid_to=now), GIỮ file.
export type ConsolOp = 'ADD' | 'UPDATE' | 'DELETE' | 'SUPERSEDE' | 'NOOP'
export type Decision = { op: ConsolOp; keep: string; redundant: string; sim: number; reason: string; merged?: string }
export type Reflection = { topic: string; insight: string; from: string[] }
export type ConsolidationPlan = {
  scanned: number; candidatePairs: number
  decisions: Decision[]       // chỉ op ≠ NOOP (đáng hành động)
  noops: number
  reflections: Reflection[]
  applied: boolean
}

// Quyết định 1 cặp (keeper trust cao hơn) → op + lý do + (UPDATE) text gộp. Lỗi/parse fail → NOOP an toàn.
export type Decider = (keep: Fact, other: Fact) => Promise<{ op: ConsolOp; reason: string; merged?: string }>
// Sinh insight tầng cao từ 1 cụm fact liên quan. Lỗi/rỗng → null (bỏ qua).
export type Reflector = (facts: Fact[]) => Promise<{ topic: string; insight: string } | null>

// ── load facts từ claude-memory (bỏ MEMORY.md index) ──
export function loadFacts(vaultDir: string): Fact[] {
  const dir = path.join(vaultDir, MEM_DIR)
  let names: string[]
  try { names = fs.readdirSync(dir) } catch { return [] }
  const out: Fact[] = []
  for (const n of names) {
    if (!n.endsWith('.md') || n === 'MEMORY.md') continue
    const file = path.join(dir, n)
    try {
      if (!fs.statSync(file).isFile()) continue
      const raw = fs.readFileSync(file, 'utf8')
      const { data, body } = parseFrontmatter(raw)
      const type = extractType(raw, data)
      // trust-weight: fact về chủ nhân / feedback của chủ = nguồn cao → ×2 (ưu tiên GIỮ khi gộp)
      const trust = (type === 'user' || type === 'feedback') ? 2 : 1
      out.push({
        file, name: String(data.name || n.replace(/\.md$/, '')),
        description: String(data.description || '').replace(/^["']|["']$/g, ''),
        body: body.trim(), type, trust, mtime: fs.statSync(file).mtimeMs,
      })
    } catch { /* file lỗi → skip */ }
  }
  return out
}

// type của fact: ưu tiên frontmatter `type:`, fallback nested `metadata:\n  type:` (parseFrontmatter
// YAML-lite bỏ qua nesting nên đọc thẳng từ raw frontmatter block).
function extractType(raw: string, data: Record<string, unknown>): string {
  if (data.type) return String(data.type)
  const end = raw.startsWith('---') ? raw.indexOf('\n---', 3) : -1
  const fm = end > 0 ? raw.slice(3, end) : ''
  const m = fm.match(/^\s+type:\s*(\S+)/m)
  return m ? m[1] : 'reference'
}

function embedText(f: Fact): string {
  return [f.name, f.description, f.body].join('\n').replace(/\s+/g, ' ').trim().slice(0, 4000)
}

function cosine(a: number[], b: number[]): number {
  let dot = 0, na = 0, nb = 0
  const len = Math.min(a.length, b.length)
  for (let i = 0; i < len; i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i] }
  if (na === 0 || nb === 0) return 0
  return dot / (Math.sqrt(na) * Math.sqrt(nb))
}

// ── Decider mặc định: LLM rẻ (lane free) kiểu Mem0. Trả NOOP nếu không chắc / lỗi. ──
const defaultDecider: Decider = async (keep, other) => {
  const prompt = [
    'Bạn là bộ phận "gộp trí nhớ" của 1 trợ lý cá nhân. Có 2 mẩu ký ức GẦN GIỐNG nhau:',
    '',
    `## A (GIỮ — nguồn tin cậy hơn)`,
    `tiêu đề: ${keep.name}`, `mô tả: ${keep.description}`, `nội dung: ${keep.body.slice(0, 800)}`,
    '',
    `## B (ứng viên xử lý)`,
    `tiêu đề: ${other.name}`, `mô tả: ${other.description}`, `nội dung: ${other.body.slice(0, 800)}`,
    '',
    '## Việc của bạn — chọn ĐÚNG 1 hành động cho B so với A:',
    '- "NOOP": B nói chuyện KHÁC A (chỉ trùng chủ đề) → giữ cả hai, đừng đụng.',
    '- "DELETE": B trùng lặp hoàn toàn A, không thêm thông tin gì mới → xoá B (A đã đủ).',
    '- "UPDATE": B có thêm chi tiết/cập nhật đáng giữ → GỘP vào A; trả thêm "merged" = nội dung A đã bổ sung từ B (markdown gọn, giữ giọng, KHÔNG bịa).',
    '- "SUPERSEDE": A và B MÂU THUẪN nhau về cùng 1 sự việc (vd ngưỡng/giá/trạng thái khác hẳn, không thể đúng cả hai) → fact CŨ HƠN sẽ bị đánh dấu hết hiệu lực, KHÔNG xoá.',
    '',
    'Thận trọng: chỉ DELETE/UPDATE/SUPERSEDE khi CHẮC CHẮN. Nghi ngờ → NOOP.',
    'Trả về DUY NHẤT 1 JSON (không chữ nào khác): {"op":"NOOP|DELETE|UPDATE|SUPERSEDE","reason":"<1 câu>","merged":"<chỉ khi UPDATE>"}',
  ].join('\n')
  try {
    const raw = await auxComplete(prompt, { maxTokens: 700 })
    if (!raw) return { op: 'NOOP', reason: 'lane rỗng → giữ an toàn' }
    return parseDecision(raw)
  } catch { return { op: 'NOOP', reason: 'lỗi lane → giữ an toàn' } }
}

export function parseDecision(raw: string): { op: ConsolOp; reason: string; merged?: string } {
  let text = raw
  try { const d = JSON.parse(raw) as { result?: string }; if (typeof d.result === 'string') text = d.result } catch { /* không envelope */ }
  const m = text.match(/\{[\s\S]*\}/)
  if (!m) return { op: 'NOOP', reason: 'không parse được → giữ an toàn' }
  let o: Record<string, unknown>
  try { o = JSON.parse(m[0]) as Record<string, unknown> } catch { return { op: 'NOOP', reason: 'JSON hỏng → giữ an toàn' } }
  const op = String(o.op || '').toUpperCase()
  const reason = String(o.reason || '').slice(0, 200)
  if (op === 'DELETE') return { op: 'DELETE', reason }
  if (op === 'SUPERSEDE') return { op: 'SUPERSEDE', reason }
  if (op === 'UPDATE') {
    const merged = String(o.merged || '').trim()
    return merged ? { op: 'UPDATE', reason, merged } : { op: 'NOOP', reason: 'UPDATE thiếu merged → giữ an toàn' }
  }
  return { op: 'NOOP', reason: reason || 'khác nhau' }
}

// ── Reflector mặc định: tóm 1 cụm fact thành insight tầng cao (Generative-Agents). ──
const defaultReflector: Reflector = async (facts) => {
  const prompt = [
    'Bạn là bộ phận "suy ngẫm" của trợ lý cá nhân. Dưới đây là vài mẩu ký ức cùng cụm chủ đề:',
    '',
    facts.map((f, i) => `${i + 1}. [${f.name}] ${f.description} — ${f.body.slice(0, 300)}`).join('\n'),
    '',
    'Rút ra 1 INSIGHT TẦNG CAO (mẫu hình / kết luận bao quát) mà từng mẩu lẻ không nói thẳng.',
    'Trả DUY NHẤT 1 JSON: {"topic":"<chủ đề ngắn>","insight":"<1-2 câu insight>"} hoặc {} nếu không có gì đáng ngẫm.',
  ].join('\n')
  try {
    const raw = await auxComplete(prompt, { maxTokens: 400 })
    if (!raw) return null
    const m = raw.match(/\{[\s\S]*\}/)
    if (!m) return null
    const o = JSON.parse(m[0]) as { topic?: string; insight?: string }
    if (!o.insight || !o.insight.trim()) return null
    return { topic: String(o.topic || 'insight').slice(0, 80), insight: String(o.insight).trim().slice(0, 400) }
  } catch { return null }
}

// connected-components theo cạnh sim ≥ SIM_CLUSTER (union-find).
function clusters(facts: Fact[], sim: number[][]): Fact[][] {
  const parent = facts.map((_, i) => i)
  const find = (x: number): number => { while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x] } return x }
  const union = (a: number, b: number) => { parent[find(a)] = find(b) }
  for (let i = 0; i < facts.length; i++)
    for (let j = i + 1; j < facts.length; j++)
      if (sim[i][j] >= SIM_CLUSTER) union(i, j)
  const groups = new Map<number, Fact[]>()
  for (let i = 0; i < facts.length; i++) { const r = find(i); const g = groups.get(r) || []; g.push(facts[i]); groups.set(r, g) }
  return [...groups.values()].filter((g) => g.length >= 2)
}

export type ConsolidateOpts = { embedder?: Embedder; decider?: Decider; reflector?: Reflector; apply?: boolean; reflect?: boolean }

// ── DỰNG plan (dry-run thuần): KHÔNG đụng đĩa. apply ở applyPlan() riêng. ──
export async function planConsolidation(vaultDir: string, opts: ConsolidateOpts = {}): Promise<ConsolidationPlan> {
  const facts = loadFacts(vaultDir)
  const plan: ConsolidationPlan = { scanned: facts.length, candidatePairs: 0, decisions: [], noops: 0, reflections: [], applied: false }
  if (facts.length < 2) return plan
  const embedder = opts.embedder ?? jinaEmbed
  const decider = opts.decider ?? defaultDecider
  const reflector = opts.reflector ?? defaultReflector

  let vecs: number[][]
  try { vecs = await embedder(facts.map(embedText), 'retrieval.passage') }
  catch (e) { console.warn(`[consolidate] embed lỗi → bỏ qua: ${String(e).slice(0, 160)}`); return plan }

  const sim: number[][] = facts.map(() => new Array(facts.length).fill(0))
  for (let i = 0; i < facts.length; i++)
    for (let j = i + 1; j < facts.length; j++) { const s = cosine(vecs[i], vecs[j]); sim[i][j] = s; sim[j][i] = s }

  // cặp gần-trùng (sim ≥ SIM_DUP), mỗi cặp xử 1 lần; keeper = trust cao hơn (tie → mới hơn).
  const seen = new Set<string>()
  for (let i = 0; i < facts.length; i++) {
    for (let j = i + 1; j < facts.length; j++) {
      if (sim[i][j] < SIM_DUP) continue
      const key = [facts[i].name, facts[j].name].sort().join('|')
      if (seen.has(key)) continue
      seen.add(key)
      plan.candidatePairs++
      const a = facts[i], b = facts[j]
      const keep = (a.trust !== b.trust) ? (a.trust > b.trust ? a : b) : (a.mtime >= b.mtime ? a : b)
      const other = keep === a ? b : a
      let d: { op: ConsolOp; reason: string; merged?: string }
      try { d = await decider(keep, other) } catch { d = { op: 'NOOP', reason: 'decider lỗi' } }
      if (d.op === 'NOOP' || d.op === 'ADD') { plan.noops++; continue }
      // PHASE 4 SUPERSEDE: mâu thuẫn → GIỮ fact mới hơn, đánh dấu fact CŨ hết hiệu lực (theo mtime, KHÔNG theo trust).
      // GUARD an toàn: fact cũ lại có trust CAO HƠN (vd lời chủ nhân) → KHÔNG tự vô hiệu → NOOP để chủ nhân tự quyết.
      if (d.op === 'SUPERSEDE') {
        const newer = a.mtime >= b.mtime ? a : b
        const older = newer === a ? b : a
        if (older.trust > newer.trust) { plan.noops++; continue }
        plan.decisions.push({ op: 'SUPERSEDE', keep: newer.name, redundant: older.name, sim: Math.round(sim[i][j] * 1000) / 1000, reason: d.reason })
        continue
      }
      plan.decisions.push({ op: d.op, keep: keep.name, redundant: other.name, sim: Math.round(sim[i][j] * 1000) / 1000, reason: d.reason, merged: d.merged })
    }
  }

  // reflection (Generative-Agents): cụm đủ "quan trọng" (tổng trust ≥ ngưỡng) → sinh insight.
  if (opts.reflect !== false) {
    for (const g of clusters(facts, sim)) {
      const totalTrust = g.reduce((s, f) => s + f.trust, 0)
      if (totalTrust < REFLECT_MIN_TRUST) continue
      let r: { topic: string; insight: string } | null
      try { r = await reflector(g) } catch { r = null }
      if (r) plan.reflections.push({ topic: r.topic, insight: r.insight, from: g.map((f) => f.name) })
    }
  }
  return plan
}

// ── render diff cho người đọc (dry-run in ra + ghi report) ──
export function renderPlan(plan: ConsolidationPlan): string {
  const L: string[] = []
  L.push(`# Consolidation plan (${plan.applied ? 'ĐÃ ÁP DỤNG' : 'DRY-RUN — chưa đụng file'})`)
  L.push(`- quét ${plan.scanned} fact · ${plan.candidatePairs} cặp gần-trùng · ${plan.decisions.length} hành động · ${plan.noops} giữ nguyên · ${plan.reflections.length} insight`)
  L.push('')
  if (plan.decisions.length) {
    L.push('## Hành động đề xuất')
    for (const d of plan.decisions) {
      if (d.op === 'DELETE') L.push(`- 🗑️ DELETE \`${d.redundant}\` (trùng \`${d.keep}\`, sim ${d.sim}) — ${d.reason}`)
      else if (d.op === 'SUPERSEDE') L.push(`- ⛔ SUPERSEDE \`${d.redundant}\` (cũ, mâu thuẫn \`${d.keep}\`, sim ${d.sim}) → đánh dấu valid_to, GIỮ file — ${d.reason}`)
      else if (d.op === 'UPDATE') {
        L.push(`- ✏️ UPDATE \`${d.keep}\` ⟵ gộp \`${d.redundant}\` (sim ${d.sim}) — ${d.reason}`)
        if (d.merged) L.push('  ```\n  ' + d.merged.replace(/\n/g, '\n  ').slice(0, 600) + '\n  ```')
      }
    }
    L.push('')
  }
  if (plan.reflections.length) {
    L.push('## Insight (reflection)')
    for (const r of plan.reflections) L.push(`- 💡 [${r.topic}] ${r.insight}  _(từ: ${r.from.join(', ')})_`)
    L.push('')
  }
  if (!plan.decisions.length && !plan.reflections.length) L.push('_(không có gì đáng gộp — trí nhớ gọn)_')
  return L.join('\n')
}

// ── APPLY (gated LUCY_CONSOLIDATE_APPLY=1): snapshot → DELETE/UPDATE file thật + dọn pointer MEMORY.md. ──
export function applyPlan(vaultDir: string, plan: ConsolidationPlan, now: Date): { snapshot: string | null; deleted: string[]; updated: string[]; invalidated: string[] } {
  const memDir = path.join(vaultDir, MEM_DIR)
  const snap = snapshotMem(vaultDir, now)
  const deleted: string[] = [], updated: string[] = [], invalidated: string[] = []
  for (const d of plan.decisions) {
    try {
      if (d.op === 'SUPERSEDE') {
        // PHASE 4: KHÔNG xoá — chỉ đánh dấu valid_to=now vào frontmatter fact cũ (lịch sử vẫn truy được).
        const f = path.join(memDir, d.redundant + '.md')
        if (fs.existsSync(f)) {
          const raw = fs.readFileSync(f, 'utf8')
          fs.writeFileSync(f, upsertFrontmatterKey(raw, 'valid_to', now.toISOString()))
          invalidated.push(d.redundant)
        }
      } else if (d.op === 'DELETE') {
        const f = path.join(memDir, d.redundant + '.md')
        if (fs.existsSync(f)) { fs.unlinkSync(f); deleted.push(d.redundant) }
        stripPointer(memDir, d.redundant)
      } else if (d.op === 'UPDATE' && d.merged) {
        const f = path.join(memDir, d.keep + '.md')
        if (fs.existsSync(f)) {
          const raw = fs.readFileSync(f, 'utf8')
          const { body } = parseFrontmatter(raw)
          const head = raw.slice(0, raw.length - body.length) // giữ nguyên frontmatter
          fs.writeFileSync(f, head + d.merged.trim() + '\n')
          updated.push(d.keep)
        }
        // gộp xong → fact thừa đi luôn
        const rf = path.join(memDir, d.redundant + '.md')
        if (fs.existsSync(rf)) { fs.unlinkSync(rf); deleted.push(d.redundant) }
        stripPointer(memDir, d.redundant)
      }
    } catch { /* 1 hành động lỗi → bỏ qua, chạy tiếp */ }
  }
  plan.applied = true
  return { snapshot: snap, deleted, updated, invalidated }
}

// xoá dòng pointer của fact trong MEMORY.md (dạng "- [Title](name.md) — ...").
function stripPointer(memDir: string, name: string) {
  try {
    const idx = path.join(memDir, 'MEMORY.md')
    if (!fs.existsSync(idx)) return
    const lines = fs.readFileSync(idx, 'utf8').split('\n')
    const kept = lines.filter((l) => !l.includes(`(${name}.md)`))
    if (kept.length !== lines.length) fs.writeFileSync(idx, kept.join('\n'))
  } catch { /* */ }
}

// snapshot claude-memory vào .snapshots/ (gitignored) trước khi sửa — rollback tay được.
function snapshotMem(vaultDir: string, now: Date): string | null {
  try {
    const dest = path.join(vaultDir, '.snapshots', `consolidate-${now.toISOString().replace(/[:.]/g, '-')}`)
    fs.cpSync(path.join(vaultDir, MEM_DIR), path.join(dest, 'claude-memory'), { recursive: true })
    return dest
  } catch { return null }
}

// env-guard: vector phải bật (cần embed) + LUCY_CONSOLIDATE_APPLY mới ghi thật.
export function consolidateApplyOn(): boolean {
  const f = (process.env.LUCY_CONSOLIDATE_APPLY || '').toLowerCase()
  return f === '1' || f === 'true' || f === 'on'
}
export { vectorFlagOn, slug }
