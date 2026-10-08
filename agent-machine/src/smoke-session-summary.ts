// smoke-session-summary — CM-2 (JSONL tuyến tính): verify ký ức xuyên phiên ghi dạng append-only JSONL.
// Không cần mạng. Chứng minh: append 1 dòng JSON/phiên vào Brain/episodes/sessions-<chat>.jsonl →
// field {v,summary,done,refs} đúng → REFS giữ NGUYÊN VĂN → secret bị redact → phiên 2 NỐI ĐUÔI (không đè) →
// readRecentSessions đọc lại N block cuối đúng thứ tự (seed phiên mới).
//   npx tsx src/smoke-session-summary.ts
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { writeSessionSummary, readRecentSessions, sessionSummaryFlagOn } from './session-summary'

let fails = 0
const check = (name: string, ok: boolean, detail = '') => {
  console.log(`${ok ? '✅' : '❌'} ${name}${detail ? ` — ${detail}` : ''}`)
  if (!ok) fails++
}

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lucy-smoke-ss-'))
const V = path.join(root, 'vault')
fs.mkdirSync(path.join(V, 'Context'), { recursive: true })

async function main() {
  const NOW = new Date('2026-06-19T10:00:00.000Z')

  // 1) input rỗng → null (không ghi rác)
  check('summary rỗng → null', writeSessionSummary(V, { summary: '   ' }, NOW) === null)

  // 2) ghi 1 block phiên có REFS + done + secret lẫn trong cmd
  const out = writeSessionSummary(V, {
    chatId: '123',
    sessionId: 'sess-abc',
    summary: 'Chủ nhân nhờ fix context-memory. Em làm CM-2: ghi JSONL tuyến tính.',
    done: ['Đổi sang JSONL append-only', 'Sửa _extract_refs'],
    refs: [
      { type: 'file', value: 'agent-machine/src/session-summary.ts' },
      { type: 'cmd', value: 'export ANTHROPIC_API_KEY=sk-ant-abcdefghijklmnop1234567890 && npm run smoke' },
      { type: 'link', value: 'http://<VPS_IP>/reports/' },
    ],
  }, NOW)
  check('writeSessionSummary trả file', !!out && !!out.rel, out?.rel)
  check('ghi đúng sessions-<chat>.jsonl', !!out && out.rel === 'Brain/episodes/sessions-123.jsonl', out?.rel)

  const abs = path.join(V, out!.rel)
  const lines = fs.readFileSync(abs, 'utf8').split('\n').filter(Boolean)
  check('append đúng 1 dòng', lines.length === 1, `lines=${lines.length}`)
  const e1 = JSON.parse(lines[0])
  check('nhãn v tuyến tính #1', e1.v === '123-2026-06-19#1', e1.v)
  check('field summary đúng', String(e1.summary).includes('CM-2'))
  check('field done là list, đủ mục', Array.isArray(e1.done) && e1.done.length === 2, JSON.stringify(e1.done))
  check('REFS file giữ nguyên văn', e1.refs.some((r: any) => r.value === 'agent-machine/src/session-summary.ts'))
  check('REFS link giữ nguyên văn', e1.refs.some((r: any) => r.value === 'http://<VPS_IP>/reports/'))

  // 3) secret trong cmd PHẢI bị redact, KHÔNG lọt vào JSONL
  const raw = fs.readFileSync(abs, 'utf8')
  check('secret sk-ant... bị redact', !raw.includes('sk-ant-abcdefghijklmnop') && raw.includes('[REDACTED]'))

  // 4) phiên 2 cùng ngày cùng chat → NỐI ĐUÔI (append-only), seq +1, không đè
  const out2 = writeSessionSummary(V, { chatId: '123', summary: 'Phiên 2 cùng ngày, không sid.', done: ['việc A'] }, NOW)
  check('phiên 2 cùng file (nối đuôi)', !!out2 && out2!.rel === out!.rel, out2?.rel)
  const lines2 = fs.readFileSync(abs, 'utf8').split('\n').filter(Boolean)
  check('giờ có 2 dòng', lines2.length === 2, `lines=${lines2.length}`)
  check('nhãn v #2 tăng tuyến tính', JSON.parse(lines2[1]).v === '123-2026-06-19#2', JSON.parse(lines2[1]).v)

  // 5) readRecentSessions đọc lại N block cuối đúng thứ tự (seed phiên mới)
  const recent = readRecentSessions(V, '123', 5)
  check('readRecentSessions trả 2 block', recent.length === 2, `n=${recent.length}`)
  check('thứ tự cũ→mới giữ đúng', recent[0].v === '123-2026-06-19#1' && recent[1].v === '123-2026-06-19#2')
  check('chat khác → rỗng', readRecentSessions(V, '999', 5).length === 0)

  // 6) flag mặc định off (an toàn live)
  check('sessionSummaryFlagOn() mặc định off', sessionSummaryFlagOn() === false)
  process.env.LUCY_SESSION_SUMMARY = '1'
  check('flag bật khi LUCY_SESSION_SUMMARY=1', sessionSummaryFlagOn() === true)

  fs.rmSync(root, { recursive: true, force: true })
  console.log(fails === 0 ? '\n🎉 CM-2 smoke PASS' : `\n💥 ${fails} fail`)
  process.exit(fails === 0 ? 0 : 1)
}
main()
