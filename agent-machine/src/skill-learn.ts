// skill-learn.ts — M3.3 self-improve: card DONE/review tốt → ĐỀ XUẤT skill tái dùng.
// ⚠️ AN TOÀN TUYỆT ĐỐI:
//   • Chỉ ĐỀ XUẤT → ghi skills/_proposed/<slug>/SKILL.md. KHÔNG bao giờ vào INDEX.md
//     → loader (loadSkillBlock đọc INDEX) KHÔNG nạp → KHÔNG auto-active. Chủ nhân/dream duyệt mới move.
//   • DRY-RUN mặc định: trả proposal, KHÔNG chạm đĩa. Ghi CHỈ khi LUCY_SKILL_LEARN=1.
//   • Drafter (LLM) injectable → smoke test không spawn model, không đốt token.
// Pattern: env-guard + try/catch graceful như session-note.ts / distill.ts.

import fs from 'node:fs'
import path from 'node:path'
import type { Card } from './types'
import { auxComplete } from './aux-client'
import { resolveSkillsDir } from './skill-loader'

const MAX_TAGS = 8
const MAX_STEPS = 12
const SLUG_MAX = 48

export interface SkillProposal {
  name: string
  description: string
  tags: string[]
  steps: string[]
}
export interface ProposeResult {
  proposed: boolean        // có đề xuất skill không (drafter bảo reusable)
  reason: string           // vì sao (đề xuất / bỏ qua)
  dryRun: boolean          // true = KHÔNG ghi đĩa (LUCY_SKILL_LEARN chưa bật)
  wrote: boolean           // có thực ghi file không
  slug?: string
  path?: string            // đường tương đối skills/_proposed/<slug>/SKILL.md
  proposal?: SkillProposal
}

export type Drafter = (prompt: string) => Promise<string | null>

export function skillLearnFlagOn(): boolean {
  return process.env.LUCY_SKILL_LEARN === '1'
}

// slug kebab từ name: bỏ dấu tiếng Việt, chỉ a-z0-9-, cắt SLUG_MAX.
export function slugify(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, SLUG_MAX)
    .replace(/-+$/g, '')
}

export function buildProposalPrompt(card: Card): string {
  const files = card.artifacts?.files?.length ? card.artifacts.files.slice(0, 12).join(', ') : '(không rõ)'
  const summary = (card.lastSummary || card.brief || '').replace(/\s+/g, ' ').trim().slice(0, 1200)
  return [
    'Bạn xét xem 1 VIỆC VỪA LÀM XONG có thành PATTERN TÁI DÙNG (skill) đáng lưu không.',
    'CHỈ đề xuất khi quy trình LẶP LẠI ĐƯỢC ở việc khác — KHÔNG đề xuất việc 1 lần, lỗi vặt, hay quá đặc thù.',
    '',
    `Tiêu đề: ${card.title}`,
    `Tóm tắt việc đã làm: ${summary}`,
    `File đụng tới: ${files}`,
    '',
    'Trả về DUY NHẤT 1 JSON (không markdown, không giải thích ngoài JSON):',
    '{"reusable": true|false, "name": "kebab-case-ngan", "description": "1 câu cô đọng", "tags": ["..."], "steps": ["bước 1", "bước 2", ...]}',
    'reusable=false thì các field khác để rỗng. name dạng kebab-case (vd "deploy-no-bridge"). steps là checklist hành động.',
  ].join('\n')
}

// Bóc JSON object đầu tiên trong raw (model hay bọc ```json…```), parse an toàn.
export function parseProposal(raw: string): SkillProposal | null {
  if (!raw) return null
  const start = raw.indexOf('{')
  const end = raw.lastIndexOf('}')
  if (start < 0 || end <= start) return null
  let obj: unknown
  try { obj = JSON.parse(raw.slice(start, end + 1)) } catch { return null }
  if (!obj || typeof obj !== 'object') return null
  const o = obj as Record<string, unknown>
  if (o.reusable !== true) return null
  const name = typeof o.name === 'string' ? o.name.trim() : ''
  const description = typeof o.description === 'string' ? o.description.trim() : ''
  if (!name || !description) return null
  const tags = Array.isArray(o.tags) ? o.tags.filter((t): t is string => typeof t === 'string').map((t) => t.trim()).filter(Boolean).slice(0, MAX_TAGS) : []
  const steps = Array.isArray(o.steps) ? o.steps.filter((t): t is string => typeof t === 'string').map((t) => t.trim()).filter(Boolean).slice(0, MAX_STEPS) : []
  return { name, description, tags, steps }
}

// Render SKILL.md đúng format frontmatter (giống skill bundled). Đánh dấu rõ ĐANG ĐỀ XUẤT.
export function renderSkillMd(p: SkillProposal, card: Card, nowIso: string): string {
  const slug = slugify(p.name) || 'proposed-skill'
  const lines = [
    '---',
    `name: ${slug}`,
    `description: ${JSON.stringify(p.description)}`,
    'version: 0.1.0',
    'author: Lucy (M3.3 self-improve — ĐỀ XUẤT, chưa duyệt)',
    'status: proposed',
    `created_at: ${nowIso}`,
    `evidenced_by: [${card.id}]`,
    'metadata:',
    '  lucy:',
    `    tags: [${p.tags.join(', ')}]`,
    '---',
    '',
    `# ${p.name}`,
    '',
    '> ⚠️ Skill ĐỀ XUẤT tự động (M3.3) — CHƯA active. Chủ nhân/dream duyệt mới move sang thư viện chính (thêm vào INDEX.md).',
    '',
    '## Mô tả',
    p.description,
    '',
    '## Các bước',
    ...(p.steps.length ? p.steps.map((s) => `- [ ] ${s}`) : ['- (drafter không nêu bước)']),
    '',
    `## Nguồn`,
    `- Sinh từ card \`${card.id}\`: ${(card.title || '').replace(/\s+/g, ' ').trim().slice(0, 200)}`,
    '',
  ]
  return lines.join('\n')
}

/**
 * proposeSkillFrom — orchestrate M3.3.
 * opts.drafter: hàm gọi LLM (mặc định auxComplete model rẻ). Inject để test.
 * opts.apply:   ép ghi/không-ghi (mặc định = skillLearnFlagOn()).
 * opts.now:     ISO time (test reproducible).
 * Graceful: mọi lỗi → proposed:false, không throw (không được làm gãy pipeline DONE).
 */
export async function proposeSkillFrom(
  card: Card,
  opts: { drafter?: Drafter; apply?: boolean; now?: string; proposedDir?: string } = {},
): Promise<ProposeResult> {
  const dryRun = !(opts.apply ?? skillLearnFlagOn())
  try {
    const drafter: Drafter = opts.drafter || ((prompt) => auxComplete(prompt, { maxTokens: 700 }))
    const raw = await drafter(buildProposalPrompt(card))
    if (!raw) return { proposed: false, reason: 'drafter không trả (không có model rẻ / lỗi)', dryRun, wrote: false }
    const proposal = parseProposal(raw)
    if (!proposal) return { proposed: false, reason: 'không phải pattern tái dùng (reusable=false / parse fail)', dryRun, wrote: false }

    const slug = slugify(proposal.name) || `card-${card.id}`
    const rel = `skills/_proposed/${slug}/SKILL.md`
    const nowIso = opts.now || new Date().toISOString()
    const md = renderSkillMd(proposal, card, nowIso)

    if (dryRun) {
      return { proposed: true, reason: 'DRY-RUN (LUCY_SKILL_LEARN chưa bật) — chỉ đề xuất, không ghi', dryRun, wrote: false, slug, path: rel, proposal }
    }

    const baseDir = opts.proposedDir || path.join(resolveSkillsDir(), '_proposed')
    const dir = path.join(baseDir, slug)
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(path.join(dir, 'SKILL.md'), md)
    return { proposed: true, reason: 'đã ghi đề xuất (chưa active — chờ duyệt)', dryRun: false, wrote: true, slug, path: rel, proposal }
  } catch (e) {
    return { proposed: false, reason: `lỗi: ${String(e instanceof Error ? e.message : e)}`, dryRun, wrote: false }
  }
}
