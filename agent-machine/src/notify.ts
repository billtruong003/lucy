// Notify — gửi cảnh báo Telegram (và sau này thêm kênh khác) cho TokenGuard + sự kiện autopilot.
// Dùng chung env với bridge: TELEGRAM_BOT_TOKEN + LUCY_ALLOWED_USER_ID.
// KHÔNG dep mới — dùng fetch (Node 20 built-in).

const BOT_TOKEN = () => process.env.TELEGRAM_BOT_TOKEN || ''
const CHAT_ID = () => process.env.LUCY_ALLOWED_USER_ID || ''

/** Gửi text tới Telegram (best-effort, không throw). */
export async function notifyTelegram(text: string): Promise<void> {
  const token = BOT_TOKEN()
  const chatId = CHAT_ID()
  if (!token || !chatId) return // không cấu hình → silent
  try {
    const url = `https://api.telegram.org/bot${token}/sendMessage`
    await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text: text.slice(0, 3800), parse_mode: 'MarkdownV2', link_preview_options: { is_disabled: true } }),
      signal: AbortSignal.timeout(10_000),
    })
  } catch { /* best-effort — network lỗi không phá luồng chính */ }
}

/** Escape MarkdownV2 cho Telegram (các ký tự đặc biệt _. * [] () ~ > # + - = | { } . !) */
function esc(text: string): string {
  return text.replace(/[_*[\]()~>#+\-=|{}.!]/g, '\\$&')
}

/** Format số an toàn cho MarkdownV2: locale en-US + escape mọi ký tự đặc biệt Telegram (., -, …). */
function safeNum(n: number): string {
  return esc(n.toLocaleString('en-US'))
}

/** Cảnh báo token soft limit */
export async function notifyTokenSoft(used: number, limit: number): Promise<void> {
  const msg = `⚠️ *Token mềm*: đã dùng ${safeNum(used)} / ${safeNum(limit)} tokens hôm nay\n→ Lucy hạ executor xuống model rẻ nhất để tiết kiệm`
  await notifyTelegram(msg)
}

/** Cảnh báo token hard limit */
export async function notifyTokenHard(used: number, limit: number): Promise<void> {
  const msg = `🚫 *Token cứng*: đã dùng ${safeNum(used)} / ${safeNum(limit)} tokens hôm nay\n→ Lucy tạm dừng nhận card mới. Bill kiểm tra lại token.`
  await notifyTelegram(msg)
}

/** Escalation thông báo */
export async function notifyEscalation(cardTitle: string, reason: string): Promise<void> {
  const msg = `🙋 *Lucy cần Bill*: card "${esc(cardTitle)}"\nLý do: ${esc(reason)}`
  await notifyTelegram(msg)
}

// Dedup câm: nhớ retryAfterMs gần nhất theo detail (provider/lý do). Cùng key + cùng retryAfter → bỏ qua,
// chỉ báo lại khi retryAfter ĐỔI (vd gia hạn). Tránh spam Telegram khi card re-queue lặp.
const lastRateLimitNotify = new Map<string, number>()

/** Thông báo card bị park do rate-limit (lane). Dedup theo (detail → retryAfterMs). */
export async function notifyRateLimitParked(retryAfterMs: number, detail: string): Promise<void> {
  const key = detail
  if (lastRateLimitNotify.get(key) === retryAfterMs) return // dedup: cùng key + cùng retryAfter → câm
  lastRateLimitNotify.set(key, retryAfterMs)
  const minutes = Math.round(retryAfterMs / 60_000)
  const msg = `⏸ *Rate-limit*: card dừng ${minutes} phút\nLý do: ${esc(detail.slice(0, 200))}`
  await notifyTelegram(msg)
}
