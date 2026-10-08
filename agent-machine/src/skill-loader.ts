// Skill-loader M3 — đọc skills/INDEX, match keyword task → chèn full SKILL.md vào system prompt.
// Pattern y hệt readActiveDigest (runner.ts:135): env-guard, try/catch, graceful return ''.
// KHÔNG throw, KHÔNG làm hỏng run. KHÔNG any.

import fs from 'node:fs'
import path from 'node:path'
import type { Card } from './types'

// ── Hằng số có tên ──
const CHARS_PER_TOKEN = 4
const TOKEN_CAP = 6000
const CHAR_CAP = CHARS_PER_TOKEN * TOKEN_CAP // 24000
const NAME_WEIGHT = 3
const DESC_WEIGHT = 1
const MIN_SCORE = 3
const TOP_N = 2

// stopword nhỏ (en+vi) — đã có normalize filter length ≥3 nên stopword chỉ bỏ vài từ hay gây nhiễu
const STOPWORDS = new Set([
  'the', 'and', 'for', 'are', 'not', 'but', 'you', 'all', 'can', 'has',
  'use', 'set', 'get', 'via', 'new', 'how', 'why', 'any', 'its', 'may',
  'cho', 'với', 'các', 'có', 'từ', 'file', 'code', 'data', 'tool',
])

// ── Kiểu IndexEntry ──
interface IndexEntry {
  name: string
  desc: string
  path: string
}

/**
 * parseIndex: regex theo format dòng INDEX.md
 * ```- **<name>** — <description>. · [`<path>`](...)```
 * Bỏ dòng không khớp (header/empty). Trả mảng rỗng nếu không match.
 */
export function parseIndex(text: string): IndexEntry[] {
  const lines = text.split('\n')
  const out: IndexEntry[] = []
  // Regex: bắt đầu "- **", tên đến "** — ", desc đến ". · [`, path trong backtick
  const re = /^- \*\*([^*]+)\*\* — (.+?)\. · \[`([^`]+)`\]\(/
  for (const line of lines) {
    const m = line.match(re)
    if (m) {
      out.push({ name: m[1].trim(), desc: m[2].trim(), path: m[3].trim() })
    }
  }
  return out
}

/**
 * normalize(s): lowercase, NFD-bỏ-dấu tiếng Việt, split trên non-alnum,
 * drop token <3 ký tự + stopword. Dùng cho cả card text và skill desc/name.
 */
export function normalize(s: string): string[] {
  const lowered = s.toLowerCase()
  // NFD + strip combining marks (dấu tiếng Việt)
  const stripped = lowered
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
  // split trên mọi ký tự không phải alnum (giữ a-z0-9)
  const tokens = stripped.split(/[^a-z0-9]+/).filter(Boolean)
  return tokens.filter((t) => t.length >= 3 && !STOPWORDS.has(t))
}

/**
 * score(cardTokens, skill): card token match với skill name/desc.
 * name token = name.split('-'). name match +NAME_WEIGHT, desc match +DESC_WEIGHT.
 */
export function score(cardTokens: string[], entry: IndexEntry): number {
  const nameTokens = new Set(entry.name.split('-').map((t) => t.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')))
  const descTokens = new Set(normalize(entry.desc))
  let s = 0
  for (const tok of cardTokens) {
    if (nameTokens.has(tok)) {
      s += NAME_WEIGHT
    } else if (descTokens.has(tok)) {
      s += DESC_WEIGHT
    }
  }
  return s
}

/**
 * resolveSkillsDir: env LUCY_SKILLS → fallback path.resolve(__dirname,'..','..','skills')
 * Đây là module ESM — dùng import.meta.url để tính __dirname.
 */
export function resolveSkillsDir(): string {
  if (process.env.LUCY_SKILLS) return process.env.LUCY_SKILLS
  // __dirname polyfill cho ESM
  const dir = path.dirname(new URL(import.meta.url).pathname)
  return path.resolve(dir, '..', '..', 'skills')
}

/**
 * loadSkillBlock(card): nếu skill match → trả block:
 * ```
 * SKILL ÁP DỤNG (procedure khớp task — đọc kỹ & theo):
 * <full SKILL.md>
 * ---
 * ```
 * Không match / lỗi → '' (graceful, không throw).
 */
export function loadSkillBlock(card: Card): string {
  try {
    const skillsDir = resolveSkillsDir()
    const indexPath = path.join(skillsDir, 'INDEX.md')
    if (!fs.existsSync(indexPath)) return ''

    const raw = fs.readFileSync(indexPath, 'utf8')
    const entries = parseIndex(raw)
    if (entries.length === 0) return ''

    // Token từ card.title + card.brief
    const cardTokens = normalize(`${card.title} ${card.brief}`)
    if (cardTokens.length === 0) return ''

    // Score từng entry
    const scored: { entry: IndexEntry; score: number }[] = []
    for (const entry of entries) {
      const s = score(cardTokens, entry)
      if (s >= MIN_SCORE) scored.push({ entry, score: s })
    }
    if (scored.length === 0) return ''

    // Sort giảm dần, lấy TOP_N
    scored.sort((a, b) => b.score - a.score)
    const top = scored.slice(0, TOP_N)

    // Đọc file SKILL.md, cộng dồn tới CHAR_CAP
    // entry.path có dạng "skills/bundled/.../SKILL.md" (từ INDEX.md) → strip prefix "skills/"
    let combined = 'SKILL ÁP DỤNG (procedure khớp task — đọc kỹ & theo):\n\n'
    let remaining = CHAR_CAP
    for (const { entry } of top) {
      const rel = entry.path.startsWith('skills/') ? entry.path.slice(7) : entry.path
      const skillPath = path.join(skillsDir, rel)
      let content: string
      try {
        content = fs.readFileSync(skillPath, 'utf8')
      } catch {
        continue // bỏ qua cái lỗi
      }
      if (content.length > remaining) {
        combined += content.slice(0, remaining) + '\n\n'
        remaining = 0
        break
      }
      combined += content + '\n\n'
      remaining -= content.length
    }
    if (combined === 'SKILL ÁP DỤNG (procedure khớp task — đọc kỹ & theo):\n\n') return '' // không đọc được cái nào

    return combined + '---\n'
  } catch {
    return ''
  }
}

// ─────────────────────────── M3.6 — overview cho UI "Kỹ năng" ───────────────────────────
// active = skill trong INDEX.md (loader nạp được). proposed = skills/_proposed/ (M3.3 đề xuất, CHƯA active).
export interface SkillInfo { name: string; description: string; path: string }
export interface SkillsOverview {
  configured: boolean
  learnOn: boolean
  skillsDir: string
  activeCount: number
  proposedCount: number
  active: SkillInfo[]
  proposed: SkillInfo[]
}

// Đọc 1 field frontmatter YAML đơn giản (name/description) — không kéo lib YAML cho 2 dòng.
function frontmatterField(text: string, key: string): string {
  const re = new RegExp(`^${key}:\\s*(.+)$`, 'm')
  const m = text.match(re)
  if (!m) return ''
  return m[1].trim().replace(/^["']|["']$/g, '')
}

function scanProposed(skillsDir: string): SkillInfo[] {
  const root = path.join(skillsDir, '_proposed')
  if (!fs.existsSync(root)) return []
  const out: SkillInfo[] = []
  let dirs: string[]
  try { dirs = fs.readdirSync(root) } catch { return [] }
  for (const slug of dirs.sort()) {
    const file = path.join(root, slug, 'SKILL.md')
    if (!fs.existsSync(file)) continue
    let raw: string
    try { raw = fs.readFileSync(file, 'utf8') } catch { continue }
    out.push({
      name: frontmatterField(raw, 'name') || slug,
      description: frontmatterField(raw, 'description') || '(chưa có mô tả)',
      path: `skills/_proposed/${slug}/SKILL.md`,
    })
  }
  return out
}

export function skillsOverview(): SkillsOverview {
  const skillsDir = resolveSkillsDir()
  const indexPath = path.join(skillsDir, 'INDEX.md')
  let active: SkillInfo[] = []
  let configured = false
  try {
    if (fs.existsSync(indexPath)) {
      configured = true
      active = parseIndex(fs.readFileSync(indexPath, 'utf8')).map((e) => ({ name: e.name, description: e.desc, path: e.path }))
    }
  } catch { /* graceful */ }
  const proposed = scanProposed(skillsDir)
  return {
    configured,
    learnOn: process.env.LUCY_SKILL_LEARN === '1',
    skillsDir,
    activeCount: active.length,
    proposedCount: proposed.length,
    active,
    proposed,
  }
}
