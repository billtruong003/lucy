// dashboard/Insights — agent error ranking + motive timeline + turn-log error stats. HUD.
import { useMemo, useState } from 'react'
import type { AmCard, AmPersona, ErrorStatsData } from '../../api'
import { EmptyState, ErrorState } from '../ui'
import {
  classifyReport, relTime, PersonaDot, ERR_CAT_LABEL, ERR_CAT_COLOR, KIND_COLOR, KIND_LABEL,
  type EnrichedReport, type AgentStat,
} from './helpers'

export default function Insights({ cards, personas, errorStats, iLoading, iOffline, iConfigured, onRefresh }:
  { cards: AmCard[]; personas: AmPersona[]; errorStats: ErrorStatsData; iLoading: boolean; iOffline: boolean; iConfigured: boolean; onRefresh: () => void }) {
  const [modelFilter, setModelFilter] = useState('all')
  const [agentFilter, setAgentFilter] = useState<string | null>(null)
  const [expandedKeys, setExpandedKeys] = useState<Set<string>>(new Set())
  const personaMap = useMemo(() => new Map(personas.map(p => [p.name, p])), [personas])

  const allReports = useMemo((): EnrichedReport[] => {
    const out: EnrichedReport[] = []
    for (const card of cards) {
      if (!card.reports?.length) continue
      for (const r of card.reports) {
        const p = personaMap.get(r.persona); if (!p) continue
        out.push({ ts: r.ts, personaId: r.persona, personaName: p.name, personaModel: p.model ?? 'unknown', personaAvatar: p.avatar, cardId: card.id, cardTitle: card.title, stage: r.stage, text: r.text, kind: classifyReport(r, card) })
      }
    }
    return out.sort((a, b) => b.ts - a.ts)
  }, [cards, personaMap])

  const models = useMemo(() => ['all', ...new Set(allReports.map(r => r.personaModel))], [allReports])
  const filteredReports = useMemo(() => allReports.filter(r =>
    (modelFilter === 'all' || r.personaModel === modelFilter) && (!agentFilter || r.personaId === agentFilter)), [allReports, modelFilter, agentFilter])

  const agentStats = useMemo((): AgentStat[] => {
    const map = new Map<string, AgentStat>()
    for (const r of allReports) {
      if (modelFilter !== 'all' && r.personaModel !== modelFilter) continue
      if (!map.has(r.personaId)) map.set(r.personaId, { personaId: r.personaId, name: r.personaName, model: r.personaModel, avatar: r.personaAvatar, failCount: 0, reworkCount: 0, decisionCount: 0, doneCount: 0, totalReports: 0 })
      const s = map.get(r.personaId)!; s.totalReports++
      if (r.kind === 'fail') s.failCount++; else if (r.kind === 'rework') s.reworkCount++; else if (r.kind === 'decision') s.decisionCount++; else if (r.kind === 'done') s.doneCount++
    }
    return [...map.values()].sort((a, b) => (b.failCount + b.reworkCount) - (a.failCount + a.reworkCount))
  }, [allReports, modelFilter])

  const maxErrors = useMemo(() => Math.max(1, ...agentStats.map(s => s.failCount + s.reworkCount)), [agentStats])
  const toggleExpand = (k: string) => setExpandedKeys(prev => { const n = new Set(prev); n.has(k) ? n.delete(k) : n.add(k); return n })
  const totalFail = agentStats.reduce((a, s) => a + s.failCount, 0)
  const totalRework = agentStats.reduce((a, s) => a + s.reworkCount, 0)
  const totalDone = agentStats.reduce((a, s) => a + s.doneCount, 0)

  if (iLoading) return <div className="flex-1 grid place-items-center"><div className="flex flex-col items-center gap-3"><span className="h-4 w-4 rounded-full border-2 border-cyan border-t-transparent" style={{ animation: 'lucy-spin .8s linear infinite' }} /><span className="mono text-inkfaint text-sm">Đang tải insights…</span></div></div>
  if (!iConfigured) return <ErrorState message="Agent-Machine chưa cấu hình (AM_COORD_URL + AM_TOKEN)." />

  const Bar = ({ w, color, glow }: { w: number; color: string; glow?: boolean }) => (
    <div className="flex-1 h-1.5 bg-white/5 overflow-hidden" style={{ borderRadius: 2 }}><div className="h-full transition-all" style={{ width: w + '%', background: color, borderRadius: 2, boxShadow: glow ? `0 0 6px ${color}` : undefined }} /></div>
  )

  return (
    <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
      <div className="shrink-0 px-4 sm:px-5 py-2.5 border-b border-line flex items-center gap-2 flex-wrap">
        <span className="chip chip-danger">✕ {totalFail} fail</span>
        <span className="chip chip-warning">↩ {totalRework} rework</span>
        <span className="chip chip-success">✓ {totalDone} done</span>
        {iOffline && <span className="chip chip-danger">offline</span>}
        <div className="ml-auto flex items-center gap-1.5 flex-wrap">
          <span className="hud-lbl">Model</span>
          {models.map(m => <button key={m} onClick={() => setModelFilter(m)} className={'chip transition cursor-pointer ' + (modelFilter === m ? 'chip-accent' : 'hover:text-ink')}>{m}</button>)}
        </div>
        <button onClick={onRefresh} className="btn btn-icon !w-7 !h-7 shrink-0 text-xs" title="Làm mới">↺</button>
      </div>

      <div className="shrink-0 px-4 sm:px-5 py-3 border-b border-line">
        <div className="flex items-center gap-2 mb-2.5"><span className="hud-lbl">Phân loại lỗi · turn-log</span><span className="chip">{errorStats.total}</span>{errorStats.offline && <span className="chip chip-danger">offline</span>}</div>
        {errorStats.total === 0 ? <div className="text-[11.5px] text-inkfaint">Chưa có turn-log / runner lane chưa chạy.</div>
          : <div className="flex gap-4 flex-wrap">
            <div className="flex-1 min-w-[240px] flex flex-col gap-1.5">
              {errorStats.byCategory.map((c) => { const max = errorStats.byCategory[0]?.count || 1; const color = ERR_CAT_COLOR[c.category]
                return <div key={c.category} className="flex items-center gap-2"><span className="text-[10px] text-inkdim w-[68px] shrink-0">{ERR_CAT_LABEL[c.category]}</span><Bar w={(c.count / max) * 100} color={color} /><span className="text-[11px] num w-5 text-right shrink-0" style={{ color }}>{c.count}</span></div> })}
            </div>
            <div className="w-[200px] shrink-0 flex flex-col gap-1">
              <span className="hud-lbl mb-0.5">Model lỗi</span>
              {errorStats.byModel.slice(0, 6).map((m) => <div key={m.model} className="flex items-center gap-2"><span className="text-[11px] text-inkdim truncate flex-1">{m.model}</span><span className="text-[11px] num text-inkfaint shrink-0">{m.count}</span></div>)}
            </div>
          </div>}
        {errorStats.scope && <div className="text-[10px] text-inkfaint mt-2 leading-snug">⚠ {errorStats.scope}</div>}
      </div>

      <div className="flex-1 min-h-0 flex overflow-hidden">
        <div className="w-[280px] xl:w-[320px] shrink-0 flex flex-col border-r border-line overflow-hidden">
          <div className="px-3 pt-3 pb-1.5 shrink-0 flex items-center gap-2"><span className="hud-lbl flex-1">Top lỗi · agent</span>{agentFilter && <button className="text-[10px] text-cyan" onClick={() => setAgentFilter(null)}>✕ bỏ lọc</button>}</div>
          <div className="flex-1 overflow-y-auto px-2 pb-3 flex flex-col gap-1.5">
            {agentStats.length === 0 ? <div className="py-10 text-center text-inkfaint text-[12px] px-4">Chưa có dữ liệu báo cáo agent.</div>
              : agentStats.map(s => { const sel = agentFilter === s.personaId; const errTotal = s.failCount + s.reworkCount
                return <button key={s.personaId} onClick={() => setAgentFilter(sel ? null : s.personaId)} className={'card card-raise p-3 text-left w-full ' + (sel ? '!border-cyan/50 bg-cyan/5' : '')}>
                  <div className="flex items-center gap-2 mb-2.5">{s.avatar ? <img src={s.avatar} alt="" className="h-6 w-6 rounded-full object-cover shrink-0" /> : <PersonaDot name={s.name} size={20} />}<span className="text-[12.5px] font-semibold text-ink truncate flex-1">{s.name.replace(/·.*/, '').trim()}</span><span className="chip">{s.model}</span></div>
                  {s.failCount > 0 && <div className="flex items-center gap-2 mb-1.5"><span className="hud-lbl w-10 shrink-0">fail</span><Bar w={(s.failCount / maxErrors) * 100} color="var(--danger)" glow /><span className="text-[11px] num w-4 text-right shrink-0" style={{ color: 'var(--danger)' }}>{s.failCount}</span></div>}
                  {s.reworkCount > 0 && <div className="flex items-center gap-2 mb-1.5"><span className="hud-lbl w-10 shrink-0">rework</span><Bar w={(s.reworkCount / maxErrors) * 100} color="var(--viz-4)" glow /><span className="text-[11px] num w-4 text-right shrink-0" style={{ color: 'var(--viz-4)' }}>{s.reworkCount}</span></div>}
                  {s.decisionCount > 0 && <div className="flex items-center gap-2 mb-1.5"><span className="hud-lbl w-10 shrink-0">ask</span><Bar w={(s.decisionCount / maxErrors) * 100} color="var(--viz-6)" /><span className="text-[11px] num w-4 text-right shrink-0" style={{ color: 'var(--viz-6)' }}>{s.decisionCount}</span></div>}
                  {s.doneCount > 0 && <div className="flex items-center gap-2"><span className="hud-lbl w-10 shrink-0">done</span><div className="flex-1 h-1 bg-white/5 overflow-hidden" style={{ borderRadius: 2 }}><div className="h-full" style={{ width: (s.doneCount / Math.max(s.totalReports, 1)) * 100 + '%', background: 'var(--success)', opacity: 0.5, borderRadius: 2 }} /></div><span className="text-[11px] num w-4 text-right shrink-0 text-grn">{s.doneCount}</span></div>}
                  {errTotal === 0 && s.doneCount === 0 && <div className="text-[11px] text-inkfaint mt-0.5">{s.totalReports} báo cáo</div>}
                </button> })}
          </div>
        </div>

        <div className="flex-1 min-w-0 flex flex-col overflow-hidden">
          <div className="px-4 pt-3 pb-1.5 shrink-0 flex items-center gap-2"><span className="hud-lbl">Motive timeline</span><span className="chip">{filteredReports.length}</span>{agentFilter && <span className="chip chip-accent">{agentStats.find(s => s.personaId === agentFilter)?.name.replace(/·.*/, '').trim()}</span>}</div>
          <div className="flex-1 overflow-y-auto px-3 pb-3 flex flex-col gap-1.5">
            {filteredReports.length === 0 ? <EmptyState title={allReports.length === 0 ? 'Chưa có báo cáo agent nào' : 'Không khớp bộ lọc'} hint={allReports.length === 0 ? 'Chạy một card để có dữ liệu.' : undefined} />
              : filteredReports.map((r, i) => { const key = `${r.cardId}-${r.ts}`; const expanded = expandedKeys.has(key); const preview = r.text.length > 130 ? r.text.slice(0, 130) + '…' : r.text; const color = KIND_COLOR[r.kind]
                return <div key={i} className="card px-3 py-2.5" style={r.kind === 'fail' ? { borderColor: 'rgb(255 87 101 / .22)' } : r.kind === 'rework' ? { borderColor: 'rgb(255 157 92 / .18)' } : undefined}>
                  <div className="flex items-start gap-2.5">
                    <div className="flex flex-col items-center gap-1 pt-0.5 shrink-0">{r.personaAvatar ? <img src={r.personaAvatar} alt="" className="h-5 w-5 rounded-full object-cover" /> : <PersonaDot name={r.personaName} size={16} />}<div className="w-0.5 min-h-[10px] flex-1 rounded-full" style={{ background: color, opacity: 0.4 }} /></div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5 flex-wrap mb-0.5"><span className="text-[12px] font-semibold text-ink">{r.personaName.replace(/·.*/, '').trim()}</span><span className="chip" style={{ color, borderColor: `${color}66` }}>{KIND_LABEL[r.kind]}</span><span className="text-[10px] text-inkfaint num ml-auto shrink-0">{relTime(r.ts)} ago</span></div>
                      <div className="text-[11.5px] text-inkdim truncate mb-1">{r.cardTitle}<span className="text-inkfaint"> · {r.stage}</span></div>
                      <div className="text-[11px] text-inkfaint leading-relaxed">{expanded ? r.text : preview}{r.text.length > 130 && <button className="ml-1.5 text-cyan text-[10px]" onClick={() => toggleExpand(key)}>{expanded ? 'thu gọn' : 'xem thêm'}</button>}</div>
                    </div>
                  </div>
                </div> })}
          </div>
        </div>
      </div>
    </div>
  )
}
