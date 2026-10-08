// session-summary.ts — CM-1: "nơi để đổ" ký ức xuyên phiên (episodic-summary).
// Khi 1 phiên hội thoại đóng (/new thủ công hoặc CC-2 auto-rollover ở bridge), summary được POST về
// coordinator → ghi thành 1 note .md trong Brain/episodes/ → pipeline note có sẵn TỰ embed Jina + FTS
// → phiên SAU recall ra "hôm trước đã làm X, file Y". Vá lỗ hổng #1 của CC (summary chỉ sống in-RAM, mất khi restart).
//
// Nguyên tắc (theo thiết kế 2026-06-19-context-memory-design.md):
//  - PROSE (summary) nén thoải mái; REFS (path/link/cmd/commit) giữ NGUYÊN VĂN, KHÔNG bịa.
//  - scrubSecrets() áp cho CẢ summary lẫn REFS trước khi ghi → key/token không lọt vào note + không gửi Jina.
//  - Thuần ghi file, không LLM ở bước này (LLM tóm tắt là việc của bridge CC-2 / CM-2).
//  - valid_to để TRỐNG → note còn hiệu lực, recall thấy (bi-temporal Phase 4 không loại).
import fs from 'node:fs'
import path from 'node:path'
import { scrubSecrets } from './redact'

export type SessionRef = { type?: string; value: string; note?: string }
export type SessionSummaryInput = {
  chatId?: string
  sessionId?: string
  summary: string
  refs?: SessionRef[]
  done?: string[]
}

export function sessionSummaryFlagOn(): boolean {
  return ['1', 'true', 'on'].includes((process.env.LUCY_SESSION_SUMMARY || '').toLowerCase())
}

// Tên file an toàn: chữ-số-gạch, cắt ngắn. Rỗng → fallback.
function fileSafe(s: string, fallback: string): string {
  const t = (s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40)
  return t || fallback
}

/**
 * CM-2 (JSONL tuyến tính): append 1 block ký ức phiên vào Brain/episodes/sessions-<chat>.jsonl.
 * Mỗi phiên = 1 dòng JSON {v, chat_id, session_id, at, summary, done, refs} nối đuôi nhau (append-only).
 * Phiên sau đọc N dòng cuối làm seed → giữ mạch. KHÔNG ghi .md rời, KHÔNG Jina-embed (file .jsonl
 * nằm ngoài tầm index của recall — listVaultFiles chỉ nhặt .md). Trả {file, rel} hoặc null nếu rỗng/lỗi.
 * @param now tiêm để test tái lập (mặc định Date hiện tại).
 */
export function writeSessionSummary(vaultDir: string, input: SessionSummaryInput, now: Date = new Date()): { file: string; rel: string } | null {
  const summary = scrubSecrets(String(input.summary || '').trim())
  if (!summary) return null
  try {
    const dir = path.join(vaultDir, 'Brain', 'episodes')
    fs.mkdirSync(dir, { recursive: true })
    const day = now.toISOString().slice(0, 10)
    const chat = fileSafe(String(input.chatId || ''), 'chat')
    const file = path.join(dir, `sessions-${chat}.jsonl`)

    // seq tuyến tính trong ngày: đếm block đã có cùng ngày của chat này, +1 → nhãn 'v' đọc được.
    let seq = 1
    try {
      const prev = fs.readFileSync(file, 'utf8').split('\n').filter(Boolean)
      seq = prev.filter((l) => l.includes(`"at":"${day}`)).length + 1
    } catch { /* chưa có file → seq=1 */ }

    const refs = (input.refs || [])
      .filter((r) => r && typeof r.value === 'string' && r.value.trim())
      .map((r) => ({ type: (r.type || 'ref').toString().trim(), value: scrubSecrets(r.value.trim()) }))
    const done = (input.done || [])
      .filter((d) => typeof d === 'string' && d.trim())
      .map((d) => scrubSecrets(d.trim()))
      .slice(0, 20)

    const entry = {
      v: `${chat}-${day}#${seq}`,
      chat_id: String(input.chatId || ''),
      session_id: String(input.sessionId || ''),
      at: now.toISOString(),
      summary,
      done,
      refs,
    }
    fs.appendFileSync(file, JSON.stringify(entry) + '\n')
    return { file, rel: path.relative(vaultDir, file).split(path.sep).join('/') }
  } catch {
    return null // ghi memory không được làm gãy đường hội thoại
  }
}

/**
 * Đọc N block phiên gần nhất của 1 chat từ sessions-<chat>.jsonl (mới → cũ giữ thứ tự xuất hiện).
 * Trả [] nếu chưa có file/lỗi. Dùng để dựng seed "ký ức phiên trước" lúc mở phiên mới.
 */
export function readRecentSessions(vaultDir: string, chatId: string, limit = 5): Array<Record<string, unknown>> {
  try {
    const chat = fileSafe(String(chatId || ''), 'chat')
    const file = path.join(vaultDir, 'Brain', 'episodes', `sessions-${chat}.jsonl`)
    const lines = fs.readFileSync(file, 'utf8').split('\n').filter(Boolean)
    return lines.slice(-limit).map((l) => { try { return JSON.parse(l) } catch { return null } }).filter(Boolean) as Array<Record<string, unknown>>
  } catch {
    return []
  }
}
