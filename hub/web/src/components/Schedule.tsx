import { EmptyState, ErrorState } from './ui'
import { useEffect, useState } from 'react'

type Sched = { id: string; name: string; prompt: string; model: string; times: string[]; enabled: boolean; lastRun: number | null; lastStatus: string; lastResult: string }
type Cron = { times: string[]; schedule: string; command: string; label: string; raw: string }

export default function Schedule() {
  const [list, setList] = useState<Sched[]>([])
  const [crons, setCrons] = useState<Cron[]>([])
  const [push, setPush] = useState(false)
  const [name, setName] = useState('')
  const [prompt, setPrompt] = useState('')
  const [model, setModel] = useState('sonnet')
  const [times, setTimes] = useState('07:30')
  const [open, setOpen] = useState(false)

  const load = () => {
    fetch('/api/schedules').then((r) => r.json()).then((d) => { setList(d.schedules || []); setPush(!!d.push) }).catch(() => {})
    fetch('/api/crontab').then((r) => r.json()).then((d) => setCrons(d.crons || [])).catch(() => {})
  }
  useEffect(() => { load(); const t = setInterval(load, 5000); return () => clearInterval(t) }, [])

  async function create() {
    if (!name.trim() || !prompt.trim()) return
    await fetch('/api/schedules', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name, prompt, model, times }) })
    setName(''); setPrompt(''); setTimes('07:30'); setOpen(false); load()
  }
  const toggle = (s: Sched) => fetch('/api/schedules/' + s.id, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ enabled: !s.enabled }) }).then(load)
  const del = (s: Sched) => { if (confirm('Xoá lịch "' + s.name + '"?')) fetch('/api/schedules/' + s.id, { method: 'DELETE' }).then(load) }
  const run = (s: Sched) => fetch('/api/schedules/' + s.id + '/run', { method: 'POST' }).then(() => setTimeout(load, 1500))

  return (
    <div className="h-full overflow-auto px-4 sm:px-6 py-5">
      <div className="max-w-3xl mx-auto">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <span className="chip">{list.length} lịch</span>
            <span className="chip" title="Đẩy kết quả ra Telegram nếu đã cấu hình token">{push ? '📲 Telegram: bật' : '📲 Telegram: tắt'}</span>
          </div>
          <button onClick={() => setOpen(!open)} className="btn btn-primary">{open ? 'Đóng' : '+ Lịch mới'}</button>
        </div>

        {open && (
          <div className="card p-4 mb-4 flex flex-col gap-3">
            <input className="input" placeholder="Tên (vd: Research crypto sáng)" value={name} onChange={(e) => setName(e.target.value)} />
            <textarea className="input resize-none" rows={3} placeholder="Prompt Lucy chạy (vd: Research BTC/ETH/vàng hôm nay, tóm tắt + cảnh báo rủi ro)" value={prompt} onChange={(e) => setPrompt(e.target.value)} />
            <div className="flex gap-2 flex-wrap items-center">
              <input className="input mono !w-40" placeholder="07:30,20:00" value={times} onChange={(e) => setTimes(e.target.value)} title="Giờ chạy mỗi ngày (VN), phẩy ngăn cách" />
              <select className="btn !py-2" value={model} onChange={(e) => setModel(e.target.value)}>
                <option value="sonnet" className="bg-panel">sonnet (nhanh)</option>
                <option value="opus" className="bg-panel">opus (sâu)</option>
              </select>
              <div className="flex-1" />
              <button onClick={create} className="btn btn-primary">Tạo lịch</button>
            </div>
            <div className="text-[11px] text-inkfaint">Giờ theo VN (UTC+7). Chạy mỗi ngày vào các mốc giờ trên.</div>
          </div>
        )}

        {list.length === 0 && !open && (
          <EmptyState title="Chưa có lịch" hint="Tạo để Lucy tự chạy research/brief theo giờ." />
        )}

        <div className="flex flex-col gap-2">
          {list.map((s) => (
            <div key={s.id} className="card p-4">
              <div className="flex items-center gap-3">
                <button onClick={() => toggle(s)} className="switch" data-on={s.enabled} title={s.enabled ? 'Đang bật' : 'Đang tắt'} />
                <span className="font-semibold text-ink flex-1 truncate">{s.name}</span>
                <span className="mono text-[11px] text-inkdim uppercase">{s.model}</span>
                {s.times.map((t) => <span key={t} className="chip mono">{t}</span>)}
                <button onClick={() => run(s)} className="btn !py-1 !px-2 text-xs" title="Chạy ngay">▶ chạy</button>
                <button onClick={() => del(s)} className="btn !py-1 !px-2 text-xs text-pink/80" title="Xoá">✕</button>
              </div>
              <div className="text-[12px] text-inkdim mt-2 truncate">{s.prompt}</div>
              {s.lastRun && (
                <div className="mt-2 pt-2 border-t border-line text-[11px]">
                  <span className={s.lastStatus === 'ok' ? 'text-grn' : 'text-pink'}>{s.lastStatus === 'ok' ? '✓' : '✗'} lần cuối {new Date(s.lastRun).toLocaleString('vi-VN')}</span>
                  {s.lastResult && <div className="text-inkfaint mt-1 line-clamp-2">{s.lastResult}</div>}
                </div>
              )}
            </div>
          ))}
        </div>

        {crons.length > 0 && (
          <div className="mt-6">
            <div className="flex items-center gap-2 mb-2">
              <span className="text-sm font-semibold text-ink">🛠️ Cron hệ thống</span>
              <span className="chip">chỉ xem</span>
              <span className="text-[11px] text-inkfaint">crontab của VPS — sửa bằng cách bảo Lucy</span>
            </div>
            <div className="flex flex-col gap-2">
              {crons.map((c, i) => (
                <div key={i} className="card p-3 opacity-90">
                  <div className="flex items-center gap-3 flex-wrap">
                    <span className="font-semibold text-ink flex-1 truncate">{c.label}</span>
                    {c.times.length > 0
                      ? c.times.map((t) => <span key={t} className="chip mono">{t}</span>)
                      : <span className="chip mono" title={c.schedule}>{c.schedule}</span>}
                  </div>
                  <div className="text-[11px] text-inkfaint mono mt-1.5 truncate" title={c.command}>{c.command}</div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
