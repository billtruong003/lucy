// dashboard/Overview — KPI + token-guard + series + cost breakdowns. HUD styled.
import { useState } from 'react'
import type { MetricsData, GuardData, SeriesRange } from '../../api'
import { EmptyState } from '../ui'
import { fmtTokens, fmtUsd, pct, fmtBucketTime, RANGE_LABEL, SOURCE_LABEL, Sparkline, BarRow } from './helpers'

export default function Overview({ data, guard, oLoading, lastRefresh, onRefresh }:
  { data: MetricsData; guard: GuardData | null; oLoading: boolean; lastRefresh: number; onRefresh: () => void }) {
  const [seriesRange, setSeriesRange] = useState<SeriesRange>('7d')
  const maxModelUsd = Math.max(...data.costByModel.map(m => m.usd), 0.0001)
  const maxAgentUsd = Math.max(...data.costByAgent.map(a => a.usd), 0.0001)
  const sources = data.costBySource ?? []
  const maxSourceTok = Math.max(...sources.map(s => s.tokens), 1)
  const elapsed = lastRefresh ? Math.round((Date.now() - lastRefresh) / 1000) : null
  const series = data.series
  const pts = series?.[seriesRange] ?? []
  const hasData = pts.some((p) => p.tokens > 0 || p.usd > 0)
  const sumTok = pts.reduce((a, p) => a + p.tokens, 0)
  const sumUsd = pts.reduce((a, p) => a + p.usd, 0)

  const KPI = [
    { label: 'Token / ngày', value: fmtTokens(data.tokenDay), sub: 'ledger · mọi nguồn + cache', tone: 'cyan' },
    { label: 'Token / tháng', value: fmtTokens(data.tokenMonth), sub: 'ledger · mọi nguồn', tone: 'cyan' },
    { label: 'Chi phí hôm nay', value: fmtUsd(data.costDay), sub: 'USD · mọi nguồn', tone: data.costDay > 1 ? 'gold' : 'cyan' },
    { label: 'Chi phí tháng', value: fmtUsd(data.costMonth), sub: 'USD tháng này', tone: data.costMonth > 5 ? 'gold' : 'cyan' },
  ]

  return (
    <div className="flex-1 overflow-auto px-4 sm:px-6 py-5">
      <div className="max-w-4xl mx-auto flex flex-col gap-4">
        <div className="flex items-center gap-2.5">
          <span className="chip">
            <span className={'h-1.5 w-1.5 rounded-full ' + (oLoading ? 'bg-inkfaint' : data.offline ? 'bg-rose' : 'bg-grn')}
              style={oLoading ? undefined : { boxShadow: data.offline ? '0 0 8px var(--danger)' : '0 0 8px var(--success)' }} />
            {oLoading ? 'đang tải…' : data.offline ? 'coordinator offline' : data.configured ? 'live' : 'unconfigured'}
          </span>
          <div className="flex-1" />
          {elapsed !== null && <span className="text-[11px] text-inkfaint num">{elapsed}s ago</span>}
          <button className="btn !py-1 !px-3 !text-[12px]" onClick={onRefresh} disabled={oLoading}>↺ refresh</button>
        </div>

        {data.alerts.map((a, i) => (
          <div key={i} className="flex items-center gap-2.5 px-4 py-2.5 text-[13px] border"
            style={{ borderRadius: 4, borderColor: a.kind === 'cost' ? 'var(--danger)' : 'var(--warning)', background: 'rgb(255 87 101 / 0.06)', color: a.kind === 'cost' ? 'var(--danger)' : 'var(--warning)' }}>
            <span className="text-base shrink-0">{a.kind === 'cost' ? '⚠' : '!'}</span>{a.message}
          </div>
        ))}

        {data.tokenGuard?.configured && data.tokenGuard.status && (() => {
          const g = data.tokenGuard!.status!
          const col = g.hard ? 'var(--danger)' : g.soft ? 'var(--warning)' : 'var(--success)'
          const label = g.hard ? '⛔ DỪNG (chạm hard limit)' : g.soft ? '💰 TIẾT KIỆM (đã hạ executor rẻ)' : '✅ Bình thường'
          const p = Math.min(100, Math.round((g.used / Math.max(1, g.hardLimit)) * 100))
          return (
            <div className="card px-4 py-2.5">
              <div className="flex items-center justify-between text-[12.5px]">
                <span className="font-semibold" style={{ color: col }}>Token-guard hôm nay: {label}</span>
                <span className="num text-[11px] text-inkdim">{fmtTokens(g.used)} / mềm {fmtTokens(g.softLimit)} · cứng {fmtTokens(g.hardLimit)}</span>
              </div>
              <div className="mt-1.5 h-1.5 overflow-hidden" style={{ background: '#ffffff14', borderRadius: 2 }}>
                <div className="h-full" style={{ width: p + '%', background: col, boxShadow: `0 0 8px ${col}`, borderRadius: 2 }} />
              </div>
            </div>
          )
        })()}

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {KPI.map((s) => (
            <div key={s.label} className="card px-4 py-3.5">
              <div className="hud-lbl mb-1.5">{s.label}</div>
              <div className={'num text-2xl font-bold leading-none ' + (s.tone === 'gold' ? 'text-gold' : 'text-cyan')}
                style={{ textShadow: `0 0 18px ${s.tone === 'gold' ? 'rgb(var(--gold-ch)/.4)' : 'rgb(var(--cyan-ch)/.35)'}` }}>{s.value}</div>
              <div className="text-[10px] text-inkfaint mt-1.5">{s.sub}</div>
            </div>
          ))}
        </div>

        <div className="card px-4 py-4">
          <div className="flex items-center justify-between mb-3">
            <div className="hud-lbl">Diễn biến token · chi phí</div>
            <div className="flex gap-1">
              {(['24h', '7d', '30d'] as SeriesRange[]).map((r) => (
                <button key={r} onClick={() => setSeriesRange(r)}
                  className={'text-[11px] px-2 py-0.5 transition ' + (seriesRange === r ? 'bg-cyan/20 text-cyan' : 'text-inkfaint hover:text-ink')} style={{ borderRadius: 3 }}>
                  {RANGE_LABEL[r]}</button>
              ))}
            </div>
          </div>
          {!series ? <div className="text-[12px] text-inkfaint py-3">Agent-Machine chưa gửi chuỗi thời gian.</div>
            : !hasData ? <div className="text-[12px] text-inkfaint py-3">Chưa có dữ liệu trong {RANGE_LABEL[seriesRange]} gần đây.</div>
              : (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <div className="flex items-baseline justify-between mb-1"><span className="text-[11px] text-inkdim">Token</span><span className="num text-[11px] text-cyan">{fmtTokens(sumTok)}</span></div>
                    <Sparkline points={pts} color="var(--accent)" accessor={(p) => p.tokens} />
                  </div>
                  <div>
                    <div className="flex items-baseline justify-between mb-1"><span className="text-[11px] text-inkdim">Chi phí</span><span className="num text-[11px] text-gold">{fmtUsd(sumUsd)}</span></div>
                    <Sparkline points={pts} color="var(--value)" accessor={(p) => p.usd} />
                  </div>
                  <div className="sm:col-span-2 flex justify-between text-[10px] text-inkfaint -mt-1"><span>{fmtBucketTime(pts[0].t, seriesRange)}</span><span>{fmtBucketTime(pts[pts.length - 1].t, seriesRange)}</span></div>
                </div>
              )}
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
          <div className="card px-4 py-4">
            <div className="hud-lbl mb-3">Models · Providers</div>
            {data.providers.length === 0 ? <div className="text-[12px] text-inkfaint py-2">{data.configured ? 'Chưa có provider nào' : 'Agent-Machine chưa kết nối'}</div>
              : <div className="flex flex-col gap-1.5">{data.providers.map((p) => (
                <div key={p.provider} className="flex items-center gap-2.5">
                  <span className={'h-2 w-2 rounded-full shrink-0 ' + (p.hasKey ? 'bg-grn' : 'bg-rose')} style={{ boxShadow: p.hasKey ? '0 0 7px var(--success)' : '0 0 7px var(--danger)' }} />
                  <span className="text-[13px] flex-1 truncate">{p.label}</span>
                  <span className={'num text-[11px] ' + (p.hasKey ? 'text-grn' : 'text-inkfaint')}>{p.hasKey ? 'alive' : 'dead'}</span>
                </div>))}</div>}
            {guard && (guard.guarded?.length > 0 || Object.keys(guard.quota || {}).length > 0) && (
              <div className="mt-3 pt-3 border-t border-line flex flex-col gap-1.5">
                {guard.guarded?.length > 0 ? guard.guarded.map((g) => (
                  <div key={g.provider} className="flex items-center gap-2.5">
                    <span className="h-2 w-2 rounded-full shrink-0" style={{ background: 'var(--viz-4)', boxShadow: '0 0 7px var(--viz-4)' }} />
                    <span className="text-[12.5px] flex-1 truncate">⏸ {g.provider}</span>
                    <span className="num text-[11px]" style={{ color: 'var(--viz-4)' }}>rate-limit · còn ~{Math.ceil(g.secondsLeft / 60)}′</span>
                  </div>)) : <div className="text-[11.5px] text-grn">✓ không provider nào bị rate-limit</div>}
                {Object.entries(guard.quota || {}).map(([prov, q]) => (
                  <div key={prov} className="flex items-center gap-2.5">
                    <span className="text-[11.5px] text-inkfaint flex-1 truncate">{prov} · quota</span>
                    <span className="num text-[11px] text-inkdim">{q.remainingRequests != null ? `${q.remainingRequests} req` : ''}{q.creditsRemainingUsd != null ? ` · $${q.creditsRemainingUsd.toFixed(2)}` : ''}</span>
                  </div>))}
              </div>)}
          </div>

          <div className="card px-4 py-4">
            <div className="hud-lbl mb-3">Cost by Model</div>
            {data.costByModel.length === 0 ? <div className="text-[12px] text-inkfaint py-2">Chưa có ledger — chạy card đầu tiên.</div>
              : <div className="flex flex-col gap-2.5">{data.costByModel.map((m) => (
                <BarRow key={m.model} label={m.model} usd={m.usd} tokens={m.tokens} ratio={pct(m.usd, maxModelUsd)} inTok={m.inTok} outTok={m.outTok} cacheTok={m.cacheTok} />))}</div>}
          </div>

          <div className="card px-4 py-4">
            <div className="hud-lbl mb-3">Cost by Agent</div>
            {data.costByAgent.length === 0 ? <div className="text-[12px] text-inkfaint py-2">Chưa có ledger — chạy card đầu tiên.</div>
              : <div className="flex flex-col gap-2.5">{data.costByAgent.map((a) => (
                <BarRow key={a.agent} label={a.agent} usd={a.usd} tokens={a.tokens} ratio={pct(a.usd, maxAgentUsd)} inTok={a.inTok} outTok={a.outTok} cacheTok={a.cacheTok} />))}</div>}
          </div>
        </div>

        <div className="card px-4 py-4">
          <div className="flex items-center gap-2 mb-3"><span className="hud-lbl flex-1">Nguồn đốt token</span><span className="chip">{sources.length}</span></div>
          {sources.length === 0 ? <div className="text-[12px] text-inkfaint py-2">Chưa có ledger — chờ nguồn đốt đầu tiên.</div>
            : <div className="flex flex-col gap-2.5">{sources.map((s) => (
              <BarRow key={s.source} label={SOURCE_LABEL[s.source] ?? s.source} usd={s.usd} tokens={s.tokens} ratio={pct(s.tokens, maxSourceTok)} color="var(--viz-5)" inTok={s.inTok} outTok={s.outTok} cacheTok={s.cacheTok} />))}</div>}
        </div>

        <div className="card px-4 py-4">
          <div className="flex items-center gap-2 mb-3">
            <span className="hud-lbl flex-1">Cards live</span>
            <span className="chip"><span className={'h-1.5 w-1.5 rounded-full ' + (data.cardsRunning ? 'bg-grn' : 'bg-inkfaint')} /> {data.cardsRunning} chạy</span>
            <span className="chip chip-warning">{data.cardsWaiting} chờ</span>
            <span className="chip">{data.cardsTotal} active</span>
          </div>
          {data.cardsTotal === 0 ? <EmptyState title="Không có card nào đang chạy" />
            : <div className="flex flex-col gap-1.5 max-h-48 overflow-y-auto">{data.costByCard.map((c) => (
              <div key={c.cardId} className="flex items-center gap-2.5 py-1.5 border-b border-line last:border-0">
                <span className="h-1.5 w-1.5 rounded-full bg-cyan/60 shrink-0" />
                <span className="text-[12px] text-ink flex-1 truncate" title={c.title}>{c.title}</span>
                <span className="num text-[11px] text-inkdim">{fmtUsd(c.usd)}</span>
                <span className="num text-[10px] text-inkfaint">{fmtTokens(c.tokens)}</span>
              </div>))}</div>}
        </div>
      </div>
    </div>
  )
}
