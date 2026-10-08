// signal.ts — ghi "brain-signal" thô vào lucy-vault/Brain/inbox/ (kênh TỰ ĐỘNG, bổ sung cho agent tự ghi).
// "dream" (Mảnh 3) sau gộp signal cùng topic+dấu thành preference. KHÔNG LLM ở đây — CHỈ CHÉP SỰ THẬT
// (outcome có thật / feedback Bill có thật), không bịa "rule". Topic per-card-family → chỉ graduate khi 1
// việc lặp lại vấn đề nhiều lần (tín hiệu thật), tránh đẻ preference rác.
import fs from 'node:fs'
import path from 'node:path'
import { slug } from './vault'

export type SignalInput = {
  topic: string
  signal: 'positive' | 'negative'
  principle: string
  scope?: string
  cardId: string
  raw?: string
  agent?: string // 'engine' (auto) | 'bill' (feedback người) | 'lucy'
}

export function writeSignal(vaultDir: string, s: SignalInput): string | null {
  try {
    const inbox = path.join(vaultDir, 'Brain', 'inbox')
    fs.mkdirSync(inbox, { recursive: true })
    const now = new Date()
    const day = now.toISOString().slice(0, 10)
    const id = `sig-${day}-${(slug(s.topic).slice(0, 32) || 'x')}-${now.getTime().toString(36)}`
    const md = [
      '---',
      'kind: brain-signal',
      `id: ${id}`,
      `created_at: ${now.toISOString()}`,
      `topic: ${yamlStr(s.topic)}`,
      `signal: ${s.signal}`,
      `agent: ${s.agent || 'engine'}`,
      `principle: ${yamlStr(s.principle)}`,
      ...(s.scope ? [`scope: ${s.scope}`] : []),
      `evidenced_by: [${s.cardId}]`,
      '---',
      '## Raw',
      (s.raw || s.principle).slice(0, 1000),
      '',
    ].join('\n')
    const file = path.join(inbox, id + '.md')
    fs.writeFileSync(file, md)
    return file
  } catch { return null } // ghi memory KHÔNG được phép làm gãy pipeline
}

// env-guard: chỉ ghi khi LUCY_VAULT trỏ vault thật (test/CI không set → no-op, không bẩn repo).
export function writeSignalSafe(s: SignalInput): string | null {
  const vault = process.env.LUCY_VAULT
  if (!vault || !fs.existsSync(vault)) return null
  return writeSignal(vault, s)
}

function yamlStr(v: string): string {
  const t = v.replace(/\s+/g, ' ').trim()
  return /[:#"'[\]{}]/.test(t) ? JSON.stringify(t) : t
}
