import { useEffect, useRef, useState } from 'react'
import { EmptyState } from './ui'

type Ev = { t: number; level: 'info' | 'warn' | 'error'; type: string; msg: string }
const COL: Record<string, string> = { info: 'text-cyan', warn: 'text-warning', error: 'text-danger' }
const DOT: Record<string, string> = { info: 'bg-cyan', warn: 'bg-warning', error: 'bg-danger' }

export default function Logs() {
  const [logs, setLogs] = useState<Ev[]>([])
  const [filter, setFilter] = useState('')
  const paused = useRef(false)
  const load = () => { if (!paused.current) fetch('/api/logs').then((r) => r.json()).then((d) => setLogs(d.logs || [])).catch(() => {}) }
  useEffect(() => { load(); const t = setInterval(load, 3000); return () => clearInterval(t) }, [])
  const shown = logs.filter((e) => !filter || e.type === filter)
  const types = [...new Set(logs.map((e) => e.type))]
  const time = (t: number) => new Date(t).toLocaleTimeString('vi-VN', { hour12: false })

  return (
    <div className="h-full flex flex-col px-4 sm:px-6 py-5">
      <div className="max-w-3xl w-full mx-auto flex flex-col min-h-0 flex-1">
        <div className="flex items-center gap-2 mb-3 flex-wrap">
          <button onClick={() => setFilter('')} className={'chip cursor-pointer ' + (!filter ? 'chip-accent' : '')}>tất cả ({logs.length})</button>
          {types.map((ty) => <button key={ty} onClick={() => setFilter(ty)} className={'chip cursor-pointer ' + (filter === ty ? 'chip-accent' : '')}>{ty}</button>)}
          <div className="flex-1" />
          <button onClick={() => (paused.current = !paused.current)} className="btn !py-1 !px-2 text-xs" title="Tạm dừng auto-refresh">⏸ pause</button>
        </div>
        <div className="card flex-1 min-h-0 overflow-auto p-2 mono text-[12px]">
          {shown.length === 0 && <EmptyState title="Chưa có log" />}
          {shown.map((e, i) => (
            <div key={i} className="flex items-start gap-2 px-2 py-1 hover:bg-white/[0.03] rounded">
              <span className={'mt-1.5 h-1.5 w-1.5 rounded-full shrink-0 ' + (DOT[e.level] || 'bg-inkdim')} />
              <span className="text-inkfaint shrink-0">{time(e.t)}</span>
              <span className="text-inkfaint shrink-0 w-16 truncate">[{e.type}]</span>
              <span className={(COL[e.level] || 'text-inkdim') + ' break-words'}>{e.msg}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
