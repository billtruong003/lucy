// Autopilot poller — "Lucy trực đêm". Process riêng (như worker), CẦN có claude (chạy director opus).
// Poll /state → gate nào không phải deploy/security → Lucy-director đọc & /approve hoặc /reject.
// Bật = chạy process này; tắt = kill. max quyết/phiên chống đốt token đêm.
// Tích hợp TokenGuard: soft → hạ executor + cảnh báo, hard → dừng nhận card.
import { isProtectedGate, directorDecide, directorAnswer, directorCost } from './autopilot'
import { notifyTokenSoft, notifyTokenHard } from './notify'
import type { TokenGuardStatus } from './token-guard'
import type { Card, Persona, Pipeline } from './types'

const URL = process.env.AM_COORD_URL || 'http://127.0.0.1:8780'
const TOKEN = process.env.AM_TOKEN || ''
const POLL = Number(process.env.AM_AUTOPILOT_POLL_MS || 6000)
const MAX = Number(process.env.AM_AUTOPILOT_MAX || 100)
const headers: Record<string, string> = { 'content-type': 'application/json', ...(TOKEN ? { 'x-worker-token': TOKEN } : {}) }

let decisions = 0
const inFlight = new Set<string>()
const escalated = new Set<string>()

// Token status — NGUỒN DUY NHẤT là engine.tokenGuard (process coordinator), đọc qua HTTP.
// Cập nhật 1 lần/tick rồi dùng lại trong các message; null = coordinator tạm mất (fail-open).
let lastStatus: TokenGuardStatus | null = null
let softNotifiedToday = false  // chỉ notify 1 lần/ngày
let hardNotifiedToday = false
let lastNotifiedDate = ''      // YYYY-MM-DD UTC — reset flags khi sang ngày mới

/** Reset notification flags nếu đã sang ngày UTC mới. */
function refreshNotifiedFlags(): void {
  const today = new Date()
  const dateStr = `${today.getUTCFullYear()}-${String(today.getUTCMonth() + 1).padStart(2, '0')}-${String(today.getUTCDate()).padStart(2, '0')}`
  if (lastNotifiedDate && lastNotifiedDate !== dateStr) {
    softNotifiedToday = false
    hardNotifiedToday = false
  }
  lastNotifiedDate = dateStr
}

async function post(p: string, body: object): Promise<void> {
  try { await fetch(URL + p, { method: 'POST', headers, body: JSON.stringify(body) }) } catch { /* coordinator tạm mất */ }
}

/** Đọc token status từ coordinator (nguồn duy nhất). Lỗi mạng / chưa cấu hình → null (fail-open). */
async function fetchTokenStatus(): Promise<TokenGuardStatus | null> {
  try {
    const r = await fetch(URL + '/token-guard', { headers })
    const body = await r.json() as { configured?: boolean; status?: TokenGuardStatus }
    return body.status ?? null
  } catch { return null }
}

/** Cộng token ước lượng (director "Lucy trực đêm" gọi opus) vào ledger CHUNG qua /spend. DASH-FIX S2: source='lane', model='opus' → có usd + attribution. */
async function addTokens(inTok: number, outTok: number): Promise<void> {
  await post('/spend', { source: 'lane', model: 'opus', inTok, outTok })
}

const HARD_USD = Number(process.env.AM_CARD_HARD_USD || 8)

function buildCtx(card: Card, allCards: Card[]): string {
  const pid = card.projectId || 'default'
  const sibs = allCards.filter((x) => (x.projectId || 'default') === pid)
  const lines = sibs.map((x) => `  - [${x.status}${x.waitKind ? '/' + x.waitKind : ''}] $${(x.cost?.usd || 0).toFixed(2)} ${x.title}${x.id === card.id ? '   ← ĐANG XÉT' : ''}`).join('\n')
  return `Dự án "${pid}" — ${sibs.length} card trong sprint:\n${lines}`
}

/** Hậu tố token status cho mọi message — minh bạch Bill đọc biết Lucy đang ở chế độ nào. */
function tokenSuffix(): string {
  const s = lastStatus
  if (!s) return 'token ?'  // coordinator tạm mất
  if (s.hard) return '⛔ DỪNG (hard limit)'
  if (s.soft) return `💰 tiết kiệm (${s.used.toLocaleString()}/${s.softLimit.toLocaleString()} token)`
  return `token OK (${s.used.toLocaleString()} hôm nay)`
}

/** Đăng message với prefix "🌙 Lucy trực đêm" + token status. */
async function say(proj: string, text: string): Promise<void> {
  await post('/channel/post', { projectId: proj, channel: 'general', text: `🌙 Lucy trực đêm [${tokenSuffix()}] — ${text}` })
}

async function tick(): Promise<void> {
  // Reset notification flags nếu sang ngày UTC mới (tránh mất cảnh báo ngày 2+)
  refreshNotifiedFlags()

  // ── TokenGuard: đọc trạng thái từ NGUỒN DUY NHẤT (coordinator) ──
  lastStatus = await fetchTokenStatus()
  const ts = lastStatus
  if (!ts) {
    // Coordinator tạm mất → fail-open: bỏ token-gating tick này, vẫn xử lý card như cũ.
    console.warn('[autopilot] token status null (coordinator?) — bỏ token-gating tick này')
  } else if (ts.hard) {
    if (!hardNotifiedToday) {
      hardNotifiedToday = true
      await say('default', `⛔ DỪNG nhận card mới — token hôm nay đã dùng ${ts.used.toLocaleString()} / ${ts.hardLimit.toLocaleString()} (hard limit).`)
      await notifyTokenHard(ts.used, ts.hardLimit)
      console.log(`[autopilot] HARD — dừng, đã dùng ${ts.used}, limit ${ts.hardLimit}`)
    }
    return // không xử lý card mới khi hard
  } else if (ts.soft) {
    if (!softNotifiedToday) {
      softNotifiedToday = true
      await say('default', `⚠️ Token mềm — đã dùng ${ts.used.toLocaleString()} / ${ts.softLimit.toLocaleString()}. Hạ executor xuống model rẻ nhất.`)
      await notifyTokenSoft(ts.used, ts.softLimit)
      console.log(`[autopilot] SOFT — tiết kiệm, đã dùng ${ts.used}`)
    }
    // executor model sẽ được hạ ở worker (đọc token-guard endpoint) — không cần action thêm ở đây
  }

  // ── Xử lý card waiting_human ──
  let state: { cards?: Card[]; personas?: Persona[]; pipelines?: Pipeline[] }
  try { state = await fetch(URL + '/state', { headers }).then((r) => r.json()) } catch { return }
  const personas = Object.fromEntries((state.personas || []).map((p) => [p.id, p]))
  const pipes = Object.fromEntries((state.pipelines || []).map((p) => [p.id, p]))
  const cards = state.cards || []
  for (const c of cards) {
    if (decisions >= MAX) return
    if (c.status !== 'waiting_human' || inFlight.has(c.id) || escalated.has(c.id)) continue
    if (c.waitKind !== 'gate' && c.waitKind !== 'decision' && c.waitKind !== 'cost') continue
    const pipe = pipes[c.pipelineId]
    const stage = pipe?.stages[c.stageIndex]
    const persona = stage ? personas[stage.personaId] : undefined
    if (isProtectedGate(pipe, persona)) continue
    const proj = c.projectId || 'default'
    const ctx = buildCtx(c, cards)
    const sn = stage?.name || '?'
    const esc = async (reason: string, kind: string) => { escalated.add(c.id); await say(proj, `ESCALATE (${kind}) "${c.title}": ${reason}`); console.log(`[autopilot] ESCALATE(${kind}) "${c.title}" — ${reason}`) }
    inFlight.add(c.id)
    try {
      if (c.waitKind === 'gate') {
        const d = await directorDecide(c, sn, ctx); decisions++
        // Ước lượng token cho director call (opus ~4k in + 500 out) → ghi vào nguồn duy nhất
        await addTokens(4000, 500)
        if (d.action === 'escalate') { await esc(d.reason, 'gate') }
        else {
          const tag = d.action === 'approve' ? '✅ DUYỆT' : '↩ TRẢ LẠI'
          await say(proj, `${tag} "${c.title}": ${d.reason}`)
          await post(d.action === 'approve' ? '/approve' : '/reject', d.action === 'approve' ? { cardId: c.id, actor: 'lucy' } : { cardId: c.id, feedback: `[Lucy trực đêm] ${d.reason}`, actor: 'lucy' })
          console.log(`[autopilot] ${tag} "${c.title}" — ${d.reason}`)
        }
      } else if (c.waitKind === 'decision') {
        const ans = await directorAnswer(c, sn, ctx); decisions++
        await addTokens(3000, 400)
        if (/^ESCALATE/i.test(ans)) await esc('cần Bill quyết', 'decision')
        else { await say(proj, `💬 trả lời "${c.title}": ${ans.slice(0, 180)}`); await post('/answer', { cardId: c.id, text: `[Lucy trực đêm] ${ans}`, actor: 'lucy' }); console.log(`[autopilot] 💬 answered "${c.title}" — ${ans.slice(0, 120)}`) }
      } else { // 'cost'
        decisions++
        await addTokens(3000, 400)
        if ((c.cost?.usd || 0) >= HARD_USD) { await esc(`đã $${(c.cost?.usd || 0).toFixed(2)} ≥ trần $${HARD_USD}`, 'cost') }
        else {
          const d = await directorCost(c, sn, ctx)
          if (d.action === 'continue') { await say(proj, `💰 CẤP THÊM "${c.title}" (tiếp): ${d.reason}`); await post('/approve', { cardId: c.id, actor: 'lucy' }); console.log(`[autopilot] 💰 continue "${c.title}" — ${d.reason}`) }
          else await esc(d.reason, 'cost')
        }
      }
    } catch (e) { console.error('[autopilot] lỗi', String(e instanceof Error ? e.message : e)) }
    finally { inFlight.delete(c.id) }
  }
}

async function loop(): Promise<void> {
  const init = await fetchTokenStatus()
  const tokInfo = init
    ? `token/day: ${init.used.toLocaleString()} / soft ${init.softLimit.toLocaleString()} / hard ${init.hardLimit.toLocaleString()}`
    : 'token/day: ? (coordinator chưa sẵn sàng)'
  console.log(`🌙 Lucy autopilot → ${URL}  (${tokInfo}; gates + decision + cost; trừ deploy/security; max ${MAX} quyết; poll ${POLL}ms)`)
  for (;;) {
    await tick()
    if (decisions >= MAX) { console.log('[autopilot] đạt max quyết — DỪNG (chống đốt token đêm). Restart để reset.'); return }
    await new Promise((s) => setTimeout(s, POLL))
  }
}
loop().catch((e) => { console.error(e); process.exit(1) })
