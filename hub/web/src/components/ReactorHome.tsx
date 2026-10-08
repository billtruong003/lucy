import { useEffect, useState } from 'react'
import { metricsData, amConfig, type MetricsData } from '../api'

// S4/E2.1-E2.2 — Trang chủ Reactor (Jarvis hero). FLAG-GATED (lucy.reactorHome).
// Nguyên tắc R1: no-motion-first, map metric THẬT (token/lane/card/cost — KHÔNG bịa thị trường),
// honor reduced-motion (vòng .hud-ring tự tắt spin qua .reduce-fx / prefers-reduced-motion).
// Tái dùng class T1 .arc-reactor/.hud-ring/.glass/.num — KHÔNG tạo theme mới.

type Props = {
  visible: boolean
  onNavigate: (tabId: string) => void
}

// vòng đo SVG — fill THẬT theo pct (0..1). pct=null → chỉ hiện số, không vẽ cung (metric chưa có ngưỡng).
function RingGauge({ pct, color, size = 132, stroke = 7 }: { pct: number | null; color: string; size?: number; stroke?: number }) {
  const r = (size - stroke) / 2
  const c = 2 * Math.PI * r
  const clamped = pct == null ? 0 : Math.max(0, Math.min(1, pct))
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="block">
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="rgba(127,179,214,0.14)" strokeWidth={stroke} />
      {pct != null && (
        <circle
          cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth={stroke}
          strokeLinecap="round" strokeDasharray={c} strokeDashoffset={c * (1 - clamped)}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
          style={{ transition: 'stroke-dashoffset 0.6s cubic-bezier(0.4,0,0.2,1)' }}
        />
      )}
    </svg>
  )
}

function fmtTok(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(n >= 10_000_000 ? 0 : 1) + 'M'
  if (n >= 1000) return (n / 1000).toFixed(n >= 10_000 ? 0 : 1) + 'k'
  return String(n)
}

// các Space để "radial entry" — đi nhanh vào khu chính
const ENTRIES = [
  { id: 'chat', icon: '💬', label: 'Chat' },
  { id: 'memory', icon: '🧠', label: 'Bộ não' },
  { id: 'brain', icon: '🌌', label: 'Tinh hà' },
  { id: 'workspace', icon: '🗂️', label: 'Dự án' },
  { id: 'tasks', icon: '⚙️', label: 'Tasks' },
  { id: 'dashboard', icon: '📊', label: 'Dashboard' },
]

export default function ReactorHome({ visible, onNavigate }: Props) {
  const [m, setM] = useState<MetricsData | null>(null)
  const [lanes, setLanes] = useState({ inFlight: 0, queued: 0, maxLanes: 0, offline: true })

  // poll metric THẬT — chỉ khi tab đang xem (perf: không poll nền)
  useEffect(() => {
    if (!visible) return
    let alive = true
    const pull = async () => {
      try {
        const [md, cfg] = await Promise.all([metricsData(), amConfig()])
        if (!alive) return
        setM(md)
        setLanes({ inFlight: cfg.inFlight || 0, queued: cfg.queued || 0, maxLanes: cfg.maxLanes || 0, offline: !!cfg.offline })
      } catch { /* offline — giữ số cũ */ }
    }
    pull()
    const iv = setInterval(pull, 8000)
    return () => { alive = false; clearInterval(iv) }
  }, [visible])

  const guard = m?.tokenGuard?.configured ? m.tokenGuard.status : undefined
  const tokenPct = guard && guard.hardLimit > 0 ? guard.used / guard.hardLimit : null
  const tokenLabel = guard ? `${fmtTok(guard.used)}/${fmtTok(guard.hardLimit)}` : (m ? fmtTok(m.tokenDay) : '—')
  const tokenWarn = !!(guard && (guard.hard || guard.soft))

  const lanePct = lanes.maxLanes > 0 ? lanes.inFlight / lanes.maxLanes : null
  const cardPct = m && m.cardsTotal > 0 ? m.cardsRunning / m.cardsTotal : null
  const costDay = m ? m.costDay : 0

  return (
    <div className="h-full overflow-auto px-4 sm:px-6 py-6 flex flex-col items-center">
      <div className="w-full max-w-3xl flex flex-col items-center gap-8">

        {/* ── HERO: arc-reactor + vòng HUD (số THẬT) ── */}
        <div className="relative grid place-items-center" style={{ width: 300, height: 300 }}>
          {/* vòng HUD trang trí (spin tự tắt khi reduce-fx) */}
          <div className="absolute inset-0 hud-ring" />
          <div className="absolute inset-[26px] hud-ring hud-ring-rev hud-ring-gold" />
          {/* lõi reactor — số core = chi phí hôm nay (tiền = gold trong theme) */}
          <div className="arc-reactor grid place-items-center" style={{ width: 168, height: 168 }}>
            <div className="text-center">
              <div className="text-[10px] text-inkfaint uppercase tracking-widest">Chi phí hôm nay</div>
              <div className="num text-3xl text-gold leading-tight" style={{ textShadow: '0 0 16px rgba(255,157,50,.45)' }}>
                ${costDay.toFixed(2)}
              </div>
              <div className="text-[10px] text-inkdim mt-1">
                {lanes.offline ? '⚪ coordinator offline' : '🟢 hệ thống online'}
              </div>
            </div>
          </div>
        </div>

        {/* ── 3 VÒNG ĐO METRIC THẬT ── */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 w-full">
          {/* Token */}
          <div className="glass rounded-2xl p-4 flex flex-col items-center gap-2">
            <div className="relative grid place-items-center">
              <RingGauge pct={tokenPct} color={tokenWarn ? '#fb7185' : '#f5b54a'} />
              <div className="absolute text-center">
                <div className={'num text-lg ' + (tokenWarn ? 'text-rose' : 'text-gold')}>{tokenLabel}</div>
                <div className="text-[9px] text-inkfaint uppercase tracking-widest">token{guard ? '' : '/ngày'}</div>
              </div>
            </div>
            <div className="text-[11px] text-inkdim text-center">
              {guard ? (tokenWarn ? '⚠️ chạm ngưỡng guard' : 'trong ngưỡng token-guard') : 'chưa đặt token-guard'}
            </div>
          </div>

          {/* Lanes */}
          <div className="glass rounded-2xl p-4 flex flex-col items-center gap-2">
            <div className="relative grid place-items-center">
              <RingGauge pct={lanePct} color="#3fd3ff" />
              <div className="absolute text-center">
                <div className="num text-lg text-cyan">{lanes.inFlight}<span className="text-inkfaint text-sm">/{lanes.maxLanes || '—'}</span></div>
                <div className="text-[9px] text-inkfaint uppercase tracking-widest">lane</div>
              </div>
            </div>
            <div className="text-[11px] text-inkdim text-center">
              {lanes.offline ? 'coordinator offline' : `${lanes.queued} đang chờ`}
            </div>
          </div>

          {/* Cards */}
          <div className="glass rounded-2xl p-4 flex flex-col items-center gap-2">
            <div className="relative grid place-items-center">
              <RingGauge pct={cardPct} color="#5fe39a" />
              <div className="absolute text-center">
                <div className="num text-lg text-grn">{m?.cardsRunning ?? 0}<span className="text-inkfaint text-sm">/{m?.cardsTotal ?? 0}</span></div>
                <div className="text-[9px] text-inkfaint uppercase tracking-widest">card</div>
              </div>
            </div>
            <div className="text-[11px] text-inkdim text-center">
              {m ? `${m.cardsWaiting} chờ duyệt` : '—'}
            </div>
          </div>
        </div>

        {/* ── RADIAL ENTRY: đi nhanh vào Space ── */}
        <div className="w-full">
          <div className="text-[10px] text-inkfaint uppercase tracking-widest mb-2 text-center">Vào khu làm việc</div>
          <div className="grid grid-cols-3 sm:grid-cols-6 gap-3">
            {ENTRIES.map((e) => (
              <button key={e.id} onClick={() => onNavigate(e.id)}
                className="glass glass-hover rounded-2xl py-4 flex flex-col items-center gap-1.5 transition-transform hover:scale-[1.03]">
                <span className="text-2xl">{e.icon}</span>
                <span className="text-[11px] text-inkdim">{e.label}</span>
              </button>
            ))}
          </div>
        </div>

        {/* cảnh báo THẬT từ metrics (nếu có) */}
        {m && m.alerts.length > 0 && (
          <div className="w-full flex flex-col gap-1.5">
            {m.alerts.map((a, i) => (
              <div key={i} className="glass rounded-xl px-3 py-2 text-[12px] text-rose border-rose/30">⚠️ {a.message}</div>
            ))}
          </div>
        )}

        <div className="text-[10px] text-inkfaint text-center max-w-md">
          Vòng đo bám số THẬT từ coordinator/metrics. Feed thị trường (giá vàng/crypto) chạy phía Telegram — chưa nối vào Hub.
        </div>
      </div>
    </div>
  )
}
