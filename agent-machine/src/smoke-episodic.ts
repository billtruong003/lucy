// smoke-episodic — PHASE 2: verify episodic store (recordTurn + searchTurns FTS + retention prune).
// Không cần mạng. Chứng minh: ghi turn → tra lại được (cross-session), relaxed-OR, retention dọn turn cũ, flag off.
//   npm run smoke:episodic
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { Recall, episodicFlagOn } from './recall'

let fails = 0
const check = (name: string, ok: boolean, detail = '') => {
  console.log(`${ok ? '✅' : '❌'} ${name}${detail ? ` — ${detail}` : ''}`)
  if (!ok) fails++
}

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lucy-smoke-epi-'))
const V = path.join(root, 'vault')
fs.mkdirSync(path.join(V, 'Context'), { recursive: true })

async function main() {
  const r = new Recall(V, { vector: false })

  // ghi vài turn hội thoại (giả lập tg + hub)
  const id1 = r.recordTurn({ source: 'tg', chatId: '123', role: 'user', content: 'Ngưỡng RSI bitcoin mình chốt là 70 nhé' })
  const id2 = r.recordTurn({ source: 'tg', chatId: '123', role: 'assistant', content: 'Dạ em ghi nhận, BTC RSI 70 là mức chủ nhân chốt.' })
  const id3 = r.recordTurn({ source: 'hub', chatId: 'hub', role: 'user', content: 'Kế hoạch vàng breakout ra sao' })
  check('recordTurn trả id', !!id1 && !!id2 && !!id3, `id=${id1},${id2},${id3}`)
  check('episodicStats đếm 3 turn', r.episodicStats().turns === 3, `turns=${r.episodicStats().turns}`)

  // content rỗng → null, không ghi.
  check('recordTurn content rỗng → null', r.recordTurn({ source: 'tg', role: 'user', content: '   ' }) === null)

  // searchTurns: tra "rsi bitcoin" → kéo đúng turn cũ (cross-session).
  const h1 = r.searchTurns('rsi bitcoin', { limit: 5 })
  check('searchTurns bắt turn "rsi bitcoin"', h1.some((h) => h.content.includes('RSI bitcoin')), `hits=${h1.length}`)

  // relaxed-OR: query nhiều từ, không khớp AND đủ → vẫn ra.
  const h2 = r.searchTurns('vàng breakout kế hoạch xyz', { limit: 5 })
  check('searchTurns relaxed-OR bắt turn vàng', h2.some((h) => h.content.includes('vàng breakout')), `hits=${h2.length}`)

  // query rỗng → []
  check('searchTurns query rỗng → []', r.searchTurns('   ').length === 0)

  // retention: chèn 1 turn cũ 100 ngày → pruneTurns(90) dọn đúng nó, giữ turn mới.
  r.recordTurn({ source: 'tg', role: 'user', content: 'turn rất cũ cần dọn', ts: Date.now() - 100 * 86400e3 })
  check('trước prune có 4 turn', r.episodicStats().turns === 4, `turns=${r.episodicStats().turns}`)
  const pruned = r.pruneTurns(90)
  check('pruneTurns(90) dọn đúng 1 turn cũ', pruned === 1, `pruned=${pruned}`)
  check('sau prune còn 3 turn', r.episodicStats().turns === 3, `turns=${r.episodicStats().turns}`)
  // turn cũ đã biến khỏi FTS (không tra ra)
  check('turn cũ không còn tra được', r.searchTurns('rất cũ cần dọn').length === 0)
  r.close()

  // flag: mặc định ON; LUCY_EPISODIC=0 → off.
  check('episodicFlagOn mặc định ON', episodicFlagOn())
  process.env.LUCY_EPISODIC = '0'
  check('LUCY_EPISODIC=0 → off', !episodicFlagOn())
  delete process.env.LUCY_EPISODIC

  fs.rmSync(root, { recursive: true, force: true })
  console.log(fails ? `\n❌ ${fails} fail` : '\n✅ smoke-episodic PASS')
  process.exit(fails ? 1 : 0)
}
main()
