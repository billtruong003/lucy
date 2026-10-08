// dashboard/helpers — pure formatters, color/label maps, atom presentational (Sparkline/TokBreakdown/PersonaDot).
// Không state, không fetch. Component tab import từ đây.
import type { AmCard, ErrorCategory, SeriesPoint, SeriesRange, MetricsData, ErrorStatsData } from '../../api'

/* ── formatters ── */
export function fmtTokens(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(2) + 'M'
  if (n >= 1_000) return (n / 1_000).toFixed(1) + 'k'
  return String(n)
}
export function fmtUsd(n: number): string {
  if (n === 0) return '$0'
  if (n >= 1) return '$' + n.toFixed(3)
  return '$' + n.toFixed(4)
}
export function pct(v: number, total: number): number {
  return !total ? 0 : Math.min(100, Math.round((v / total) * 100))
}
export function relTime(ts: number): string {
  const s = Math.floor((Date.now() - ts) / 1000)
  if (s < 60) return `${s}s`
  if (s < 3600) return `${Math.floor(s / 60)}m`
  if (s < 86400) return `${Math.floor(s / 3600)}h`
  return `${Math.floor(s / 86400)}d`
}
export const RANGE_LABEL: Record<SeriesRange, string> = { '24h': '24h', '7d': '7 ngày', '30d': '30 ngày' }
export function fmtBucketTime(t: number, range: SeriesRange): string {
  const d = new Date(t)
  if (range === '24h') return String(d.getHours()).padStart(2, '0') + 'h'
  return (d.getMonth() + 1) + '/' + d.getDate()
}

/* ── label / color maps ── */
export const SOURCE_LABEL: Record<string, string> = {
  worker: '🤖 Worker (agent)', autobuild: '🏗️ Auto-build', bridge: '✈️ Telegram',
  hub: '🖥️ Hub chat', lane: '🛤️ Lane (model rẻ)', cron: '⏰ Cron',
  autotask: '📋 Auto-task', unknown: '❔ Khác (chưa gắn nguồn)',
}
export const ERR_CAT_LABEL: Record<ErrorCategory, string> = {
  'llm-error': 'LLM lỗi', 'out-of-turns': 'Hết lượt', 'salvage': 'Salvage', 'build-fail': 'Build',
  'spec-fail': 'Test/Spec', 'loop': 'Lặp', 'wrong-output': 'Output sai', 'other': 'Khác',
}
export const ERR_CAT_COLOR: Record<ErrorCategory, string> = {
  'llm-error': 'var(--danger)', 'out-of-turns': 'var(--viz-4)', 'salvage': 'var(--success)', 'build-fail': 'var(--viz-5)',
  'spec-fail': 'var(--viz-6)', 'loop': 'var(--accent)', 'wrong-output': 'var(--viz-7)', 'other': 'var(--text-muted)',
}

export type ReportKind = 'fail' | 'rework' | 'decision' | 'done' | 'working'
export type EnrichedReport = {
  ts: number; personaId: string; personaName: string; personaModel: string; personaAvatar: string | undefined
  cardId: string; cardTitle: string; stage: string; text: string; kind: ReportKind
}
export type AgentStat = {
  personaId: string; name: string; model: string; avatar: string | undefined
  failCount: number; reworkCount: number; decisionCount: number; doneCount: number; totalReports: number
}
export const KIND_COLOR: Record<ReportKind, string> = {
  fail: 'var(--danger)', rework: 'var(--viz-4)', decision: 'var(--viz-6)', done: 'var(--success)', working: 'var(--accent)',
}
export const KIND_LABEL: Record<ReportKind, string> = {
  fail: 'FAIL', rework: 'REWORK', decision: 'ASK', done: 'DONE', working: 'RAN',
}
export function classifyReport(r: NonNullable<AmCard['reports']>[number], card: AmCard): ReportKind {
  const isLast = card.reports?.[card.reports.length - 1] === r
  if (isLast && card.status === 'failed') return 'fail'
  if (isLast && card.status === 'done') return 'done'
  const hist = card.history ?? []
  if (hist.some(h => (h.event === 'reject-rework' || h.event === 'rework') && h.stage === r.stage && h.ts >= r.ts)) return 'rework'
  if (hist.some(h => h.event === 'needs_decision' && h.stage === r.stage && h.ts >= r.ts)) return 'decision'
  return 'working'
}

export const EMPTY_METRICS: MetricsData = {
  configured: false, tokenDay: 0, tokenMonth: 0, costDay: 0, costMonth: 0,
  costByModel: [], costByAgent: [], costByCard: [], cardsRunning: 0, cardsWaiting: 0, cardsTotal: 0,
  providers: [], alerts: [],
}
export const EMPTY_ERROR_STATS: ErrorStatsData = {
  configured: false, total: 0, byCategory: [], byAgent: [], byModel: [], topCategory: null, scope: '',
}

/* ── atoms ── */
export function TokBreakdown({ inTok, outTok, cacheTok }: { inTok?: number; outTok?: number; cacheTok?: number }) {
  if (inTok == null && outTok == null && cacheTok == null) return null
  return (
    <div className="flex gap-2 num text-[9.5px] text-inkfaint mt-0.5">
      <span>in {fmtTokens(inTok ?? 0)}</span>
      <span>out {fmtTokens(outTok ?? 0)}</span>
      {!!cacheTok && <span style={{ color: 'var(--viz-5)' }}>cache {fmtTokens(cacheTok)}</span>}
    </div>
  )
}
export function Sparkline({ points, color, accessor }: { points: SeriesPoint[]; color: string; accessor: (p: SeriesPoint) => number }) {
  const W = 240, H = 44, PAD = 3
  const vals = points.map(accessor)
  const max = Math.max(1, ...vals)
  const n = points.length
  const x = (i: number) => n <= 1 ? PAD : PAD + (i / (n - 1)) * (W - 2 * PAD)
  const y = (v: number) => H - PAD - (v / max) * (H - 2 * PAD)
  const line = vals.map((v, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ')
  const area = `${line} L${x(n - 1).toFixed(1)},${H - PAD} L${x(0).toFixed(1)},${H - PAD} Z`
  const gid = 'sp' + color.replace(/[^a-z0-9]/gi, '')
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ height: H }} preserveAspectRatio="none">
      <defs>
        <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.30" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={area} fill={`url(#${gid})`} />
      <path d={line} fill="none" stroke={color} strokeWidth="1.6" strokeLinejoin="round" strokeLinecap="round"
        style={{ filter: `drop-shadow(0 0 3px ${color})` }} />
    </svg>
  )
}
export function PersonaDot({ name, size = 16 }: { name: string; size?: number }) {
  const pal = ['var(--viz-1)', 'var(--viz-2)', 'var(--viz-4)', 'var(--viz-5)', 'var(--viz-7)']
  let h = 0
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0
  return <span className="rounded-full inline-block shrink-0" style={{ width: size, height: size, background: pal[h % pal.length] }} />
}

/* ── Bar readout HUD (dùng chung cho cost-by-*) ── */
export function BarRow({ label, usd, tokens, ratio, color = 'var(--accent)', inTok, outTok, cacheTok }:
  { label: string; usd: number; tokens: number; ratio: number; color?: string; inTok?: number; outTok?: number; cacheTok?: number }) {
  return (
    <div>
      <div className="flex items-center gap-2 mb-1">
        <span className="text-[12px] text-ink flex-1 truncate">{label}</span>
        <span className="num text-[11px] text-cyan">{fmtUsd(usd)}</span>
        <span className="num text-[10px] text-inkfaint">{fmtTokens(tokens)}</span>
      </div>
      <div className="h-1.5 bg-white/5 overflow-hidden" style={{ borderRadius: 2 }}>
        <div className="h-full transition-all duration-500" style={{ width: ratio + '%', background: color, borderRadius: 2 }} />
      </div>
      <TokBreakdown inTok={inTok} outTok={outTok} cacheTok={cacheTok} />
    </div>
  )
}
