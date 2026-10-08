// dashboard/ForLucy — "Cho Lucy": cần Bill · runway · nhật ký trực đêm · hôm nay học gì. HUD.
import type { MetricsData, AmCard, AmMsg, BrainSig } from '../../api'
import { EmptyState } from '../ui'
import { fmtTokens } from './helpers'

const WAIT_KIND: Record<string, string> = { gate: '🔍 chờ duyệt', decision: '💬 agent hỏi', cost: '💰 vượt cap', loop: '🔁 lặp', stuck: '🧩 kẹt → triage', 'size-gate': '📦 task to → tách' }

export default function ForLucy({ data, cards, channels, brainInbox }:
  { data: MetricsData; cards: AmCard[]; channels: AmMsg[]; brainInbox: BrainSig[] }) {
  const need = cards.filter((c) => c.status === 'waiting_human')
  // runway
  const used = data.tokenDay
  const soft = data.tokenGuard?.status?.softLimit ?? 0
  const dNow = new Date()
  const startOfDay = new Date(dNow.getFullYear(), dNow.getMonth(), dNow.getDate()).getTime()
  const hoursElapsed = Math.max(0.15, (Date.now() - startOfDay) / 3_600_000)
  const ratePerHour = used / hoursElapsed
  const remaining = Math.max(0, soft - used)
  const etaH = ratePerHour > 0 && soft ? remaining / ratePerHour : Infinity
  const rPct = soft ? Math.min(100, Math.round((used / soft) * 100)) : 0
  const overSoft = soft > 0 && used >= soft
  const rCol = overSoft ? 'var(--viz-4)' : rPct > 80 ? 'var(--warning)' : 'var(--success)'
  // night log
  const log = channels.filter((m) => (m.text || '').includes('🌙') || m.author === 'Lucy').sort((a, b) => b.ts - a.ts).slice(0, 14)
  // learned today
  const today = new Date().toISOString().slice(0, 10)
  const todayLearned = brainInbox.filter((s) => (s.created_at || '').slice(0, 10) === today)
  const learned = todayLearned.length ? todayLearned : brainInbox.slice(-6).reverse()

  return (
    <div className="flex-1 overflow-y-auto px-4 sm:px-6 py-5">
      <div className="max-w-4xl mx-auto flex flex-col gap-4">
        <div className="card p-4">
          <div className="flex items-center gap-2 mb-3"><span className="text-base">🆘</span><span className="hud-lbl text-rose">Cần Bill</span><span className="chip">{need.length}</span></div>
          {need.length === 0 ? <div className="text-[12.5px] text-inkfaint">✅ Không có gì chờ — Lucy tự xoay được.</div>
            : <div className="flex flex-col gap-2">{need.map((c) => (
              <div key={c.id} className="px-3 py-2" style={{ borderRadius: 4, border: '1px solid rgb(255 87 101 / .25)', background: 'rgb(255 87 101 / .05)' }}>
                <div className="text-[12.5px] font-semibold text-ink leading-tight">{c.title}</div>
                <div className="text-[11px] text-inkdim mt-0.5">{WAIT_KIND[c.waitKind || ''] || '⛔ chờ'} · {c.projectId}{c.pendingQuestion ? ' — ' + c.pendingQuestion.slice(0, 90) : ''}</div>
              </div>))}</div>}
        </div>

        <div className="card p-4">
          <div className="flex items-center gap-2 mb-3"><span className="text-base">⏳</span><span className="hud-lbl text-cyan">Runway · nhịp đốt</span></div>
          {!soft ? <div className="text-[12.5px] text-inkfaint">Token-guard chưa cấu hình (chưa có soft-cap).</div>
            : <>
              <div className="flex items-baseline justify-between text-[12.5px] mb-2">
                <span className="text-inkdim">đốt <b className="text-ink num">{fmtTokens(Math.round(ratePerHour))}</b>/giờ hôm nay</span>
                <span className="text-inkdim">{overSoft ? <span style={{ color: rCol }}>💰 đã chạm soft-cap</span> : <>còn <b className="text-ink num">{fmtTokens(remaining)}</b> · ETA <b className="text-ink num">{etaH === Infinity ? '∞' : '~' + etaH.toFixed(1) + 'h'}</b></>}</span>
              </div>
              <div className="h-2 overflow-hidden" style={{ background: '#ffffff14', borderRadius: 2 }}><div className="h-full" style={{ width: rPct + '%', background: rCol, boxShadow: `0 0 8px ${rCol}`, borderRadius: 2 }} /></div>
              <div className="text-[10.5px] text-inkfaint mt-1.5 num">{fmtTokens(used)} / soft {fmtTokens(soft)} ({rPct}%)</div>
            </>}
        </div>

        <div className="card p-4">
          <div className="flex items-center gap-2 mb-3"><span className="text-base">🌙</span><span className="hud-lbl" style={{ color: 'var(--viz-5)' }}>Nhật ký trực đêm</span><span className="chip">{log.length}</span></div>
          {log.length === 0 ? <div className="text-[12.5px] text-inkfaint">Chưa có hoạt động trực đêm gần đây.</div>
            : <div className="flex flex-col gap-1.5">{log.map((m, i) => (
              <div key={i} className="flex gap-2 text-[12px] leading-snug"><span className="text-inkfaint num shrink-0 text-[10.5px] pt-0.5">{new Date(m.ts).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })}</span><span className="text-inkdim">{(m.text || '').replace(/^🌙 Lucy trực đêm\s*/, '')}</span></div>))}</div>}
        </div>

        <div className="card p-4">
          <div className="flex items-center gap-2 mb-3"><span className="text-base">🧠</span><span className="hud-lbl text-grn">{todayLearned.length ? 'Hôm nay em học' : 'Gần đây em học'}</span><span className="chip">{learned.length}</span></div>
          {learned.length === 0 ? <EmptyState title="Chưa có signal mới" hint="Vault đang chờ dream gộp." />
            : <div className="flex flex-col gap-2">{learned.map((s, i) => (
              <div key={i} className="px-3 py-2 border border-line" style={{ borderRadius: 4 }}>
                <div className="text-[12.5px] text-ink leading-snug">{s.signal === 'negative' ? '⚠️' : '✅'} {s.principle}</div>
                <div className="text-[10.5px] text-inkfaint mt-0.5 num">{s.topic} · {s.agent}</div>
              </div>))}</div>}
        </div>
      </div>
    </div>
  )
}
