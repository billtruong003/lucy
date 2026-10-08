import { useEffect, useState } from 'react'
import { amState, amConfig, type AmMsg } from '../api'

// S2/E1.4 — HUD panel phải (context-aware): bối cảnh Space hiện tại + lane đang chạy + Activity Feed THẬT.
// Desktop: cột phải gập được (persist localStorage). Mobile: sheet trượt (App điều khiển qua props open/onClose).

type Props = {
  tabId: string
  label: string
  sub: string
  icon: string
  // mobile sheet
  mobileOpen: boolean
  onMobileClose: () => void
}

function relTime(ts: number): string {
  const s = Math.max(0, Math.floor((Date.now() - ts) / 1000))
  if (s < 60) return s + 's'
  if (s < 3600) return Math.floor(s / 60) + 'm'
  if (s < 86400) return Math.floor(s / 3600) + 'h'
  return Math.floor(s / 86400) + 'd'
}

const KIND_ICON: Record<string, string> = {
  msg: '💬', report: '📄', error: '⚠️', stage: '⚙️', system: '🔧', gate: '⏸️', done: '✅',
}

export default function HudRail({ tabId, label, sub, icon, mobileOpen, onMobileClose }: Props) {
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem('lucy.hud.collapsed') === '1')
  const [events, setEvents] = useState<AmMsg[]>([])
  const [running, setRunning] = useState({ inFlight: 0, queued: 0, offline: true })
  const [cardsActive, setCardsActive] = useState(0)

  useEffect(() => { localStorage.setItem('lucy.hud.collapsed', collapsed ? '1' : '0') }, [collapsed])

  useEffect(() => {
    let alive = true
    const pull = async () => {
      try {
        const [s, c] = await Promise.all([amState(), amConfig()])
        if (!alive) return
        const evs = (s.channels || []).slice().sort((a, b) => b.ts - a.ts).slice(0, 14)
        setEvents(evs)
        setCardsActive((s.cards || []).filter((x) => !['done', 'rejected', 'archived'].includes(x.status)).length)
        setRunning({ inFlight: c.inFlight || 0, queued: c.queued || 0, offline: !!c.offline })
      } catch { /* offline — giữ trạng thái cũ */ }
    }
    pull()
    const iv = setInterval(pull, 6000)
    return () => { alive = false; clearInterval(iv) }
  }, [])

  // nội dung dùng chung cho desktop + sheet mobile
  const body = (
    <div className="flex flex-col h-full min-h-0">
      <div className="px-4 pt-4 pb-3 border-b border-line flex items-center gap-2 shrink-0">
        <span className="text-base shrink-0">{icon}</span>
        <div className="min-w-0 flex-1">
          <div className="display text-[11px] tracking-[0.18em] text-cyan/80 leading-none truncate">{label.toUpperCase()}</div>
          <div className="text-[10px] text-inkfaint mt-1 truncate">{sub}</div>
        </div>
        {/* gập (desktop) / đóng (mobile) */}
        <button
          onClick={() => { if (mobileOpen) onMobileClose(); else setCollapsed(true) }}
          className="text-inkfaint hover:text-ink transition text-sm w-7 h-7 flex items-center justify-center rounded shrink-0"
          aria-label="Thu gọn bảng HUD">{mobileOpen ? '✕' : '⟩'}</button>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto px-3 py-3 flex flex-col gap-3">
        {/* Voice orb — visualizer JARVIS (slot sẵn, wire audio sau) */}
        <div className="card hud-frame p-3 flex flex-col items-center">
          <div className="hud-lbl self-start mb-1">Voice · JARVIS</div>
          <svg width="96" height="96" viewBox="0 0 120 120" className="my-1">
            <circle cx="60" cy="60" r="50" fill="none" stroke="rgb(var(--cyan-ch)/0.14)" strokeWidth="1" />
            <circle cx="60" cy="60" r="40" fill="none" stroke="rgb(var(--cyan-ch)/0.22)" strokeWidth="1" strokeDasharray="4 6">
              <animateTransform attributeName="transform" type="rotate" from="0 60 60" to="360 60 60" dur="22s" repeatCount="indefinite" />
            </circle>
            <circle cx="60" cy="60" r="26" fill="none" stroke="var(--accent)" strokeWidth="2" style={{ filter: 'drop-shadow(0 0 6px var(--accent))' }} />
            <circle cx="60" cy="60" r="11" fill="rgb(var(--cyan-ch)/0.55)" style={{ filter: 'drop-shadow(0 0 12px var(--accent))' }}>
              <animate attributeName="r" values="9;14;9" dur="2.6s" repeatCount="indefinite" />
            </circle>
          </svg>
          <div className="hud-lbl text-cyan">◐ chờ voice</div>
        </div>

        {/* Đang chạy — số THẬT từ coordinator */}
        <div className="glass rounded-xl p-3">
          <div className="text-[9px] text-inkfaint uppercase tracking-widest mb-2">Đang chạy</div>
          {running.offline ? (
            <div className="text-[12px] text-inkfaint">⚪ coordinator offline</div>
          ) : (
            <div className="grid grid-cols-3 gap-2 text-center">
              <div>
                <div className="num text-base text-cyan">{running.inFlight}</div>
                <div className="text-[9px] text-inkfaint">lane chạy</div>
              </div>
              <div>
                <div className="num text-base text-gold">{running.queued}</div>
                <div className="text-[9px] text-inkfaint">chờ</div>
              </div>
              <div>
                <div className="num text-base text-ink">{cardsActive}</div>
                <div className="text-[9px] text-inkfaint">card mở</div>
              </div>
            </div>
          )}
        </div>

        {/* Activity Feed — sự kiện THẬT từ các channel */}
        <div className="flex flex-col gap-1.5">
          <div className="text-[9px] text-inkfaint uppercase tracking-widest px-1">Hoạt động gần đây</div>
          {events.length === 0 ? (
            <div className="text-[12px] text-inkfaint px-1 py-3">Chưa có hoạt động nào.</div>
          ) : (
            events.map((e, i) => (
              <div key={i} className="reveal-host group rounded-lg px-2.5 py-2 hover:bg-white/[0.04] transition-colors">
                <div className="flex items-center gap-1.5 mb-0.5">
                  <span className="text-[11px] shrink-0">{KIND_ICON[e.kind] || '•'}</span>
                  <span className="text-[10px] text-cyan/70 truncate flex-1">{e.author || e.channel}</span>
                  <span className="num text-[9px] text-inkfaint shrink-0">{relTime(e.ts)}</span>
                </div>
                <div className="text-[11px] text-inkdim line-clamp-2 leading-snug">{e.text}</div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  )

  return (
    <>
      {/* DESKTOP: cột phải gập được */}
      {collapsed ? (
        <button
          onClick={() => setCollapsed(false)}
          className="hidden lg:flex w-10 shrink-0 flex-col items-center gap-3 pt-4 border-l border-line bg-panel/30 hover:bg-white/[0.03] transition-colors"
          aria-label="Mở bảng HUD">
          <span className="text-cyan text-sm">⟨</span>
          <span className="text-[10px] text-inkfaint" style={{ writingMode: 'vertical-rl' }}>HUD · hoạt động</span>
        </button>
      ) : (
        <aside className="hidden lg:flex w-72 shrink-0 flex-col border-l border-line bg-panel/30">
          {body}
        </aside>
      )}

      {/* MOBILE/TABLET: sheet trượt từ phải */}
      <div className={'fixed inset-0 z-40 lg:hidden transition-opacity duration-200 ' + (mobileOpen ? 'opacity-100' : 'opacity-0 pointer-events-none')}>
        <div className="absolute inset-0 bg-black/50" onClick={onMobileClose} />
        <aside
          style={{ transition: 'transform 0.25s cubic-bezier(0.4,0,0.2,1)' }}
          className={'absolute inset-y-0 right-0 w-80 max-w-[86%] flex flex-col border-l border-line bg-panel backdrop-blur ' +
            (mobileOpen ? 'translate-x-0' : 'translate-x-full')}>
          {body}
        </aside>
      </div>
    </>
  )
}
