// agent-brain — não NGHỀ riêng từng persona (C4 / Track C1).
// Mỗi persona tích luỹ bài học theo thời gian → lần sau prepend vào system prompt (như active.md),
// để agent giỏi dần ở nghề mình, bớt lặp lỗi cũ → bớt rework/đốt token.
// Nguồn bài học = review feedback (rework) + card done — KHÔNG cần LLM call riêng.
// Ghi vào lucy-vault/Brain/agents/<personaId>.md (máy quản, KHÁC Brain/preferences & active.md).
import fs from 'node:fs'
import path from 'node:path'

const MAX_LESSONS = 12       // giữ N bài gần nhất → prompt không phình, cache-parity ổn
const MAX_LESSON_LEN = 220
export const CONSOLIDATE_THRESHOLD = 16 // ≥ N bài thô → đáng "dream" gộp lại thành rule class-level
export const MAX_CONSOLIDATED = 8        // sau gộp giữ ≤ N rule đúc kết

function agentsDir(): string | null {
  const vault = process.env.LUCY_VAULT
  if (!vault) return null
  return path.join(vault, 'Brain', 'agents')
}

function fileFor(personaId: string): string | null {
  const dir = agentsDir()
  if (!dir || !/^[a-z0-9_-]+$/i.test(personaId)) return null // chặn path traversal
  return path.join(dir, `${personaId}.md`)
}

function clean(s: string): string {
  return s.replace(/\s+/g, ' ').trim().slice(0, MAX_LESSON_LEN)
}

/** Đọc não nghề của persona → digest chèn vào system prompt. '' nếu chưa học gì (giữ prefix ổn định). */
export function readAgentBrain(personaId: string): string {
  const f = fileFor(personaId)
  if (!f) return ''
  try {
    const raw = fs.readFileSync(f, 'utf8')
    const lessons = raw.split('\n').filter((l) => l.trim().startsWith('- '))
    if (!lessons.length) return ''
    const recent = lessons.slice(-MAX_LESSONS).join('\n')
    return `NÃO NGHỀ CỦA BẠN (đã học từ các lần trước — tránh lặp lỗi cũ, phát huy cái đúng):\n${recent}\n\n---\n`
  } catch { return '' }
}

/** Ghi 1 bài học cho persona. kind: 'miss' = bị trả lại/lỗi · 'win' = hoàn thành tốt. Dedup + cap N. */
export function appendAgentLesson(personaId: string, lesson: string, kind: 'miss' | 'win'): void {
  const f = fileFor(personaId)
  if (!f) return
  const text = clean(lesson)
  if (text.length < 8) return // bỏ bài rỗng/vô nghĩa
  const day = new Date().toISOString().slice(0, 10)
  const line = `- [${kind === 'miss' ? '⚠️ tránh' : '✅ tốt'} · ${day}] ${text}`
  try {
    const dir = path.dirname(f)
    fs.mkdirSync(dir, { recursive: true })
    let lines: string[] = []
    try { lines = fs.readFileSync(f, 'utf8').split('\n').filter((l) => l.trim().startsWith('- ')) } catch { /* file mới */ }
    // dedup theo nội dung (bỏ tiền tố ngày/kind) → không nhồi lặp
    const sig = (l: string) => l.replace(/^- \[[^\]]*\]\s*/, '').toLowerCase()
    if (lines.some((l) => sig(l) === sig(line))) return
    lines.push(line)
    const kept = lines.slice(-MAX_LESSONS * 2) // giữ rộng hơn cap đọc một chút (lịch sử)
    const header = `# Não nghề — \`${personaId}\`\n\n> Máy quản (engine ghi từ review/done). Lần sau persona này chạy sẽ tự nạp ${MAX_LESSONS} bài gần nhất.\n\n`
    fs.writeFileSync(f, header + kept.join('\n') + '\n')
  } catch { /* ghi não không critical — nuốt lỗi để không hỏng card */ }
}

// ── C4: dream-per-persona — đọc bài thô + ghi đè bằng rule đã đúc kết ──

/** Số bài học thô đang lưu (để quyết có cần consolidate không). */
export function lessonCount(personaId: string): number {
  const f = fileFor(personaId)
  if (!f) return 0
  try { return fs.readFileSync(f, 'utf8').split('\n').filter((l) => l.trim().startsWith('- ')).length } catch { return 0 }
}

/** Danh sách persona đã có file não (cho dream quét toàn bộ). */
export function listAgentBrains(): string[] {
  const dir = agentsDir()
  if (!dir) return []
  try { return fs.readdirSync(dir).filter((n) => n.endsWith('.md')).map((n) => n.slice(0, -3)).filter((id) => /^[a-z0-9_-]+$/i.test(id)) } catch { return [] }
}

/** Bài học thô (cả miss/win) làm input cho consolidate — bỏ tiền tố markdown, giữ nhãn+nội dung. */
export function readRawLessons(personaId: string): string[] {
  const f = fileFor(personaId)
  if (!f) return []
  try {
    return fs.readFileSync(f, 'utf8').split('\n').filter((l) => l.trim().startsWith('- ')).map((l) => l.replace(/^- /, '').trim())
  } catch { return [] }
}

// ── C4 (Đợt C) Curator: dọn bài thô CŨ tràn → archive (KHÔNG xoá), giữ rule đúc kết + N bài gần nhất. ──
// Deterministic, no-LLM (rẻ). Chạy trong dream. Giữ não active gọn → prompt nhẹ + cache ổn.
export function curateAgentBrain(personaId: string, keepRaw = MAX_LESSONS): { archived: number } | null {
  const f = fileFor(personaId)
  if (!f) return null
  try {
    const lines = fs.readFileSync(f, 'utf8').split('\n').filter((l) => l.trim().startsWith('- '))
    const consolidated = lines.filter((l) => l.includes('🧠 đúc kết'))
    const raw = lines.filter((l) => !l.includes('🧠 đúc kết'))
    if (raw.length <= keepRaw) return null // chưa tràn → khỏi dọn
    const overflow = raw.slice(0, raw.length - keepRaw) // bài CŨ nhất (append theo thời gian → đầu mảng = cũ)
    const keep = raw.slice(raw.length - keepRaw)
    // archive (append, không xoá) → Brain/agents/_archive/<id>.md
    const archiveDir = path.join(path.dirname(f), '_archive')
    fs.mkdirSync(archiveDir, { recursive: true })
    const af = path.join(archiveDir, `${personaId}.md`)
    let prev = ''
    try { prev = fs.readFileSync(af, 'utf8') } catch { /* archive mới */ }
    fs.writeFileSync(af, (prev || `# Não nghề ARCHIVE — \`${personaId}\` (bài cũ, giữ để truy vết)\n\n`) + overflow.join('\n') + '\n')
    // ghi lại active = đúc kết + bài gần nhất
    const header = `# Não nghề — \`${personaId}\`\n\n> Máy quản. Đã curate: archive ${overflow.length} bài cũ. Active = đúc kết + ${keep.length} bài gần.\n\n`
    fs.writeFileSync(f, header + consolidated.concat(keep).join('\n') + '\n')
    return { archived: overflow.length }
  } catch { return null }
}

/** Curate MỌI persona có não. Cho dream cron. */
export function curateAllAgentBrains(): { personaId: string; archived: number }[] {
  const out: { personaId: string; archived: number }[] = []
  for (const id of listAgentBrains()) { const r = curateAgentBrain(id); if (r) out.push({ personaId: id, ...r }) }
  return out
}

/** Ghi đè não bằng các rule ĐÃ ĐÚC KẾT (class-level). Thay bài thô lẻ tẻ → giảm phình, tăng chất. */
export function writeConsolidated(personaId: string, rules: string[], day = new Date().toISOString().slice(0, 10)): boolean {
  const f = fileFor(personaId)
  if (!f) return false
  const clean2 = rules.map((r) => clean(r)).filter((r) => r.length >= 8).slice(0, MAX_CONSOLIDATED)
  if (!clean2.length) return false // không có gì để ghi → giữ nguyên bài thô, không xoá trắng
  const lines = clean2.map((r) => `- [🧠 đúc kết · ${day}] ${r}`)
  const header = `# Não nghề — \`${personaId}\`\n\n> Máy quản. Đã đúc kết ${day} (${clean2.length} rule class-level từ bài thô). Lần sau persona tự nạp.\n\n`
  try { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, header + lines.join('\n') + '\n'); return true } catch { return false }
}
