// session-note.ts — A3 "session-lineage": card kết thúc (done/failed) → ghi 1 note tóm tắt CÓ CẤU TRÚC
// vào lucy-vault/Daily/ (template Goal/Done/Pending/Files + TEMPORAL ANCHOR "đây là QUÁ KHỨ").
// Mục đích: chống "giải lại việc cũ" — phiên sau recall ra là biết việc ĐÃ xong, chỉ tra cứu, không làm lại.
// Crib: Hermes hermes_state.py (session lineage) + context_compressor.py (summary template + temporal anchor).
// THUẦN DETERMINISTIC từ dữ liệu card — không LLM, không bịa.
import fs from 'node:fs'
import path from 'node:path'
import type { Card } from './types'

export function writeSessionNote(vaultDir: string, card: Card, now: Date = new Date()): string | null {
  try {
    const dir = path.join(vaultDir, 'Daily')
    fs.mkdirSync(dir, { recursive: true })
    const day = now.toISOString().slice(0, 10)
    const stages = card.history.filter((h) => h.event === 'advance' || h.event === 'done' || h.event === 'rework').length
    const mins = Math.max(1, Math.round((now.getTime() - card.createdAt) / 60000))
    const files = card.artifacts?.files?.length ? card.artifacts.files.slice(0, 12).join(', ') : null
    const pending = card.status === 'failed'
      ? (card.pendingQuestion || card.reviewNotes?.slice(-1)[0] || 'fail — xem history')
      : null
    const reworks = card.history.filter((h) => h.event === 'rework' || h.event === 'reject-rework').length
    const md = [
      '---',
      `title: ${yamlStr(`phiên: ${card.title}`)}`,
      'type: daily',
      'kind: session-note',
      `card: ${card.id}`,
      `project: ${card.projectId}`,
      `status: ${card.status}`,
      `created_at: ${now.toISOString()}`,
      `tags: [session, ${card.projectId}]`,
      `permalink: session-${card.id}`,
      '---',
      '',
      `# Phiên: ${card.title}`,
      '',
      `> ⏳ Phiên này đã **KẾT THÚC ${day}** (${card.status.toUpperCase()}) — đây là **QUÁ KHỨ**, đừng giải lại;`,
      '> chỉ dùng để tra cứu "đã làm gì / còn gì treo".',
      '',
      `- [goal] ${one(card.brief, 300)} #${card.projectId}`,
      `- [done] ${one(card.lastSummary || '(không có tóm tắt)', 300)}`,
      ...(pending ? [`- [pending] ${one(pending, 300)}`] : []),
      ...(card.reviewNotes?.length ? [`- [feedback] ${one(card.reviewNotes.slice(-2).join(' · '), 300)}`] : []),
      ...(files ? [`- [files] ${one(files, 400)}`] : []),
      `- [cost] $${card.cost.usd.toFixed(3)} · ${stages} bước · ${reworks} rework · ~${mins} phút`,
      `- thuộc_dự_án [[project-${card.projectId}]]`,
      '',
    ].join('\n')
    const file = path.join(dir, `${day}-session-${card.id}.md`)
    fs.writeFileSync(file, md)
    return file
  } catch { return null } // ghi memory không được làm gãy pipeline
}

// env-guard như signal/evidence: không có vault → no-op (test/CI sạch).
export function writeSessionNoteSafe(card: Card): string | null {
  const vault = process.env.LUCY_VAULT
  if (!vault || !fs.existsSync(vault)) return null
  return writeSessionNote(vault, card)
}

const one = (s: string, n: number) => s.replace(/\s+/g, ' ').trim().slice(0, n)
function yamlStr(v: string): string {
  const t = v.replace(/\s+/g, ' ').trim()
  return /[:#"'[\]{}]/.test(t) ? JSON.stringify(t) : t
}
