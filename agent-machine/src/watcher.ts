// watcher.ts - CF-4 Event-driven Awareness: framework detector nhe chay cron.
// Dang ky WatcherSpec vao config/watchers.json; watcher-cli check dinh ky.
// Chi ping Telegram khi trigger. 4 kind built-in: health/disk/process/price

import { exec } from 'node:child_process'
import { promisify } from 'node:util'
import fs from 'node:fs/promises'
import { notifyTelegram } from './notify.js'

const execAsync = promisify(exec)

export interface WatcherSpec {
  id: string
  name: string
  kind: 'health' | 'disk' | 'process' | 'price' | 'rsi'
  enabled: boolean
  params: Record<string, unknown>
  cooldownMin?: number
}

export interface WatcherResult {
  id: string; name: string; triggered: boolean
  message?: string; error?: string; skippedCooldown?: boolean
}

interface WatcherState { [id: string]: { lastAlertAt?: number } }

async function checkHealth(p: Record<string, unknown>): Promise<{ triggered: boolean; message?: string }> {
  const url = String(p.url || '')
  if (!url) return { triggered: false }
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(10_000) })
    if (r.ok) return { triggered: false }
    return { triggered: true, message: url + ' -> HTTP ' + r.status }
  } catch (e) {
    return { triggered: true, message: url + ' khong ket noi: ' + String((e as Error).message || '').slice(0, 120) }
  }
}

async function checkDisk(p: Record<string, unknown>): Promise<{ triggered: boolean; message?: string }> {
  const mp = String(p.path || '/')
  const maxPct = Number(p.maxPercent || 85)
  try {
    const { stdout } = await execAsync('df ' + JSON.stringify(mp) + ' 2>/dev/null | tail -1')
    const pctStr = stdout.trim().split(/\s+/).find((x) => x.endsWith('%')) || '0%'
    const pct = parseInt(pctStr, 10)
    if (isNaN(pct)) return { triggered: false }
    if (pct >= maxPct) return { triggered: true, message: 'Disk ' + mp + ': ' + pct + '% (nguong ' + maxPct + '%)' }
    return { triggered: false }
  } catch { return { triggered: false } }
}

async function checkProcess(p: Record<string, unknown>): Promise<{ triggered: boolean; message?: string }> {
  const name = String(p.name || '')
  if (!name) return { triggered: false }
  try {
    const { stdout } = await execAsync('pgrep -fc ' + JSON.stringify(name) + ' 2>/dev/null || echo 0')
    const count = parseInt(stdout.trim(), 10)
    if (count > 0) return { triggered: false }
    return { triggered: true, message: 'Process "' + name + '" khong chay (pgrep=0)' }
  } catch { return { triggered: false } }
}

async function checkPrice(p: Record<string, unknown>): Promise<{ triggered: boolean; message?: string }> {
  const cgId = String(p.coinGeckoId || '')
  const sym = String(p.symbol || cgId.toUpperCase())
  const above = p.above != null ? Number(p.above) : null
  const below = p.below != null ? Number(p.below) : null
  if (!cgId || (above == null && below == null)) return { triggered: false }
  try {
    const url = 'https://api.coingecko.com/api/v3/simple/price?ids=' + encodeURIComponent(cgId) + '&vs_currencies=usd'
    const r = await fetch(url, { signal: AbortSignal.timeout(15_000) })
    if (!r.ok) return { triggered: false }
    const data = await r.json() as Record<string, { usd?: number }>
    const price = data[cgId]?.usd
    if (price == null) return { triggered: false }
    const fmt = (n: number) => n.toLocaleString('en-US', { maximumFractionDigits: 2 })
    if (above != null && price >= above) return { triggered: true, message: sym + ' $' + fmt(price) + ' >= nguong $' + fmt(above) }
    if (below != null && price <= below) return { triggered: true, message: sym + ' $' + fmt(price) + ' <= nguong $' + fmt(below) }
    return { triggered: false }
  } catch { return { triggered: false } }
}


// BH-F: RSI(period) tinh tu daily closes qua CoinGecko /market_chart.
// Trigger khi RSI <= oversoldBelow (qua ban) hoac >= overboughtAbove (qua mua).
async function checkRSI(p: Record<string, unknown>): Promise<{ triggered: boolean; message?: string }> {
  const cgId = String(p.coinGeckoId || '')
  const sym = String(p.symbol || cgId.toUpperCase())
  const period = Math.max(2, Math.min(100, Number(p.period || 14)))
  const oversold = p.oversoldBelow != null ? Number(p.oversoldBelow) : null
  const overbought = p.overboughtAbove != null ? Number(p.overboughtAbove) : null
  if (!cgId || (oversold == null && overbought == null)) return { triggered: false }
  try {
    const days = period + 2
    const url = 'https://api.coingecko.com/api/v3/coins/' + encodeURIComponent(cgId) + '/market_chart?vs_currency=usd&days=' + days + '&interval=daily'
    const r = await fetch(url, { signal: AbortSignal.timeout(20_000) })
    if (!r.ok) return { triggered: false }
    const data = await r.json() as { prices?: [number, number][] }
    const closes = (data.prices || []).map(([, price]) => price)
    if (closes.length < period + 1) return { triggered: false }
    const slice = closes.slice(-(period + 1))
    let sumGain = 0, sumLoss = 0
    for (let i = 1; i < slice.length; i++) {
      const diff = slice[i] - slice[i - 1]
      if (diff > 0) sumGain += diff; else sumLoss -= diff
    }
    const avgGain = sumGain / period
    const avgLoss = sumLoss / period
    const rsi = avgLoss === 0 ? 100 : 100 - (100 / (1 + avgGain / avgLoss))
    const fmt2 = (n: number) => n.toFixed(2)
    if (oversold != null && rsi <= oversold)
      return { triggered: true, message: sym + ' RSI(' + period + ')=' + fmt2(rsi) + ' <= ' + oversold + ' (qua ban)' }
    if (overbought != null && rsi >= overbought)
      return { triggered: true, message: sym + ' RSI(' + period + ')=' + fmt2(rsi) + ' >= ' + overbought + ' (qua mua)' }
    return { triggered: false }
  } catch { return { triggered: false } }
}

async function loadState(statePath: string): Promise<WatcherState> {
  try { return JSON.parse(await fs.readFile(statePath, 'utf8')) } catch { return {} }
}

async function saveState(statePath: string, state: WatcherState): Promise<void> {
  try { await fs.writeFile(statePath, JSON.stringify(state, null, 2), 'utf8') } catch { /* best-effort */ }
}

function escMd(t: string): string {
  return t.replace(/[_*[\]()~>#+\-=|{}.!]/g, '\\$&')
}

export async function runWatchers(
  watchers: WatcherSpec[],
  statePath: string,
  dryRun = false,
): Promise<WatcherResult[]> {
  const state = await loadState(statePath)
  const now = Date.now()
  const results: WatcherResult[] = []

  for (const w of watchers) {
    if (!w.enabled) continue
    const cooldown = (w.cooldownMin ?? 60) * 60_000
    const lastAlert = state[w.id]?.lastAlertAt ?? 0
    const inCooldown = now - lastAlert < cooldown

    let check: { triggered: boolean; message?: string } = { triggered: false }
    let err: string | undefined
    try {
      if (w.kind === 'health')       check = await checkHealth(w.params)
      else if (w.kind === 'disk')    check = await checkDisk(w.params)
      else if (w.kind === 'process') check = await checkProcess(w.params)
      else if (w.kind === 'price')   check = await checkPrice(w.params)
      else if (w.kind === 'rsi')     check = await checkRSI(w.params)
    } catch (e) { err = String((e as Error).message || e).slice(0, 200) }

    results.push({ id: w.id, name: w.name, triggered: check.triggered, message: check.message, error: err, skippedCooldown: check.triggered && inCooldown })

    if (check.triggered && !inCooldown && !dryRun) {
      const msg = '⚡ *Watcher alert*: ' + escMd(w.name) + '\n' + escMd(check.message || 'Dieu kien kich hoat')
      await notifyTelegram(msg)
      state[w.id] = { lastAlertAt: now }
    }
  }

  if (!dryRun) await saveState(statePath, state)
  return results
}

export async function loadWatchers(configPath: string): Promise<WatcherSpec[]> {
  try {
    const raw = await fs.readFile(configPath, 'utf8')
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? (parsed as WatcherSpec[]) : []
  } catch { return [] }
}
