// market-tools.ts — helper REST thị trường KEYLESS cho MCP finance (X3). Binance public (giá/nến crypto), KHÔNG cần API key.
// Read-only, host CỐ ĐỊNH api.binance.com → không cần SSRF guard động. Lỗi/timeout → trả ERROR string (không nổ).
// Chỉ crypto. CK/forex/vàng XAU → dùng Twelve Data MCP (scaffold, cần key) ở mcp-registry.

const BINANCE = process.env.BINANCE_REST_URL || 'https://api.binance.com'
const INTERVALS = new Set(['1m', '3m', '5m', '15m', '30m', '1h', '2h', '4h', '6h', '8h', '12h', '1d', '3d', '1w', '1M'])

async function timed(url: string, ms = 12000): Promise<Response> {
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), ms)
  try { return await fetch(url, { signal: ctrl.signal, headers: { accept: 'application/json' } }) }
  finally { clearTimeout(t) }
}

// chuẩn hoá symbol: bỏ ký tự lạ, in hoa (BTCUSDT, ethusdt → ETHUSDT). Giữ A-Z0-9.
function normSym(s: string): string { return (s || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 20) }

// Giá hiện tại + thống kê 24h của 1 cặp (vd BTCUSDT). Trả text gọn cho LLM.
export async function binanceTicker24h(symbol: string): Promise<string> {
  const sym = normSym(symbol)
  if (!sym) return 'ERROR: symbol rỗng (vd BTCUSDT)'
  try {
    const r = await timed(`${BINANCE}/api/v3/ticker/24hr?symbol=${sym}`)
    if (!r.ok) return `ERROR binance_price ${r.status}: ${(await r.text().catch(() => '')).slice(0, 160)}`
    const d = (await r.json()) as Record<string, string>
    if (!d.lastPrice) return `ERROR: không có dữ liệu cho ${sym} (kiểm tra symbol)`
    return [
      `${sym} (Binance, 24h, nguồn api.binance.com):`,
      `• giá: ${d.lastPrice}`,
      `• đổi 24h: ${d.priceChange} (${d.priceChangePercent}%)`,
      `• cao/thấp 24h: ${d.highPrice} / ${d.lowPrice}`,
      `• khối lượng 24h: ${d.volume} ${sym.replace(/USDT$|USDC$|BUSD$/, '')} (~${d.quoteVolume} quote)`,
    ].join('\n')
  } catch (e) { return 'ERROR binance_price: ' + String((e as Error)?.message || e).slice(0, 160) }
}

// Nến OHLCV. interval: 1m/5m/15m/1h/4h/1d/1w… limit ≤ 200. Trả bảng text gọn (mỗi dòng 1 nến).
export async function binanceKlines(symbol: string, interval = '1h', limit = 50): Promise<string> {
  const sym = normSym(symbol)
  if (!sym) return 'ERROR: symbol rỗng (vd BTCUSDT)'
  const itv = INTERVALS.has(interval) ? interval : '1h'
  const lim = Math.max(1, Math.min(Math.floor(limit) || 50, 200))
  try {
    const r = await timed(`${BINANCE}/api/v3/klines?symbol=${sym}&interval=${itv}&limit=${lim}`)
    if (!r.ok) return `ERROR binance_klines ${r.status}: ${(await r.text().catch(() => '')).slice(0, 160)}`
    const rows = (await r.json()) as (string | number)[][]
    if (!Array.isArray(rows) || !rows.length) return `ERROR: không có nến cho ${sym} ${itv}`
    // [openTime, open, high, low, close, volume, ...]
    const lines = rows.map((k) => {
      const t = new Date(Number(k[0])).toISOString().replace('.000Z', 'Z')
      return `${t}  O ${k[1]}  H ${k[2]}  L ${k[3]}  C ${k[4]}  V ${k[5]}`
    })
    return `${sym} ${itv} — ${rows.length} nến OHLCV (Binance, cũ→mới):\n${lines.join('\n')}`
  } catch (e) { return 'ERROR binance_klines: ' + String((e as Error)?.message || e).slice(0, 160) }
}
