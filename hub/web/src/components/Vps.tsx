// Tab VPS — theo dõi status máy (CPU/RAM/disk/pm2) + nút tool dọn máy: bấm → agent tự chạy
// prompt allowlisted (server /api/vps/clean → runClaude) → poll kết quả hiện tại chỗ.
import { useEffect, useRef, useState } from 'react'
import PageShell from './ui/PageShell'
import { Card, Stat, Chip, Button, Eyebrow, SkeletonCard, Meter } from './ui'
import { systemStats, vpsTools, vpsClean, poll, type SystemStats } from '../api'

const gb = (n: number) => (n / 1073741824).toFixed(1)
const pct = (used: number, total: number) => (total ? Math.round((used / total) * 100) : 0)
const fmtUp = (s: number) => {
  const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600)
  return d > 0 ? `${d}d ${h}h` : `${h}h ${Math.floor((s % 3600) / 60)}m`
}

export default function Vps({ visible }: { visible: boolean }) {
  const [st, setSt] = useState<SystemStats | null>(null)
  const [tools, setTools] = useState<{ id: string; label: string }[]>([])
  const [runningTool, setRunningTool] = useState<string | null>(null)   // tool id đang chạy
  const [result, setResult] = useState<{ tool: string; text: string } | null>(null)
  const [elapsed, setElapsed] = useState(0)
  const jobRef = useRef<string | null>(null)

  // poll status 5s khi tab hiện
  useEffect(() => {
    if (!visible) return
    let dead = false
    const tick = () => systemStats().then((d) => { if (!dead) setSt(d) }).catch(() => { })
    tick()
    const iv = setInterval(tick, 5000)
    return () => { dead = true; clearInterval(iv) }
  }, [visible])

  useEffect(() => { if (visible && !tools.length) vpsTools().then((d) => setTools(d.tools)).catch(() => { }) }, [visible, tools.length])

  const run = async (toolId: string, label: string) => {
    if (runningTool) return
    setRunningTool(toolId); setResult(null); setElapsed(0)
    try {
      const { job_id, error } = await vpsClean(toolId)
      if (!job_id) { setResult({ tool: label, text: '❌ ' + (error || 'không tạo được job') }); setRunningTool(null); return }
      jobRef.current = job_id
      const iv = setInterval(async () => {
        try {
          const p = await poll(job_id)
          setElapsed(p.elapsed)
          if (p.status === 'done') {
            clearInterval(iv)
            setResult({ tool: label, text: p.result || '(rỗng)' })
            setRunningTool(null)
          }
        } catch { /* giữ poll */ }
      }, 2500)
    } catch (e) {
      setResult({ tool: label, text: '❌ ' + String(e) }); setRunningTool(null)
    }
  }

  const memUsed = st ? st.memTotal - st.memAvail : 0
  const loadPct = st ? Math.min(100, Math.round((st.load1 / st.cores) * 100)) : 0
  const online = st?.pm2.filter((p) => p.status === 'online').length ?? 0

  return (
    <PageShell title="VPS" sub="Trạng thái máy chủ · pm2 · dọn dẹp bằng agent" width="wide">
      {!st ? (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3"><SkeletonCard /><SkeletonCard /><SkeletonCard /><SkeletonCard /></div>
      ) : (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <Stat label="CPU load (1m)" value={st.load1.toFixed(2)} unit={`/ ${st.cores} core`}
              tone={loadPct > 85 ? 'danger' : loadPct > 60 ? 'value' : 'default'} barPct={loadPct}
              hint={`5m ${st.load5.toFixed(2)} · 15m ${st.load15.toFixed(2)}`} />
            <Stat label="RAM" value={pct(memUsed, st.memTotal)} unit="%"
              tone={pct(memUsed, st.memTotal) > 88 ? 'danger' : pct(memUsed, st.memTotal) > 70 ? 'value' : 'default'}
              barPct={pct(memUsed, st.memTotal)}
              hint={`${gb(memUsed)} / ${gb(st.memTotal)} GB${st.swapUsed > 0 ? ` · swap ${gb(st.swapUsed)}G` : ''}`} />
            <Stat label="Disk /" value={pct(st.diskUsed, st.diskTotal)} unit="%"
              tone={pct(st.diskUsed, st.diskTotal) > 85 ? 'danger' : pct(st.diskUsed, st.diskTotal) > 70 ? 'value' : 'default'}
              barPct={pct(st.diskUsed, st.diskTotal)}
              hint={`còn trống ${gb(st.diskAvail)} GB / ${gb(st.diskTotal)} GB`} />
            <Stat label="Uptime" value={fmtUp(st.uptimeSec)} tone="success" hint={`pm2: ${online}/${st.pm2.length} online`} />
          </div>

          {/* pm2 processes */}
          <Card className="mt-4 p-0 overflow-hidden">
            <div className="px-4 pt-3 pb-2 flex items-center justify-between">
              <Eyebrow>PM2 processes</Eyebrow>
              <Chip tone={online === st.pm2.length ? 'success' : 'warning'}>{online}/{st.pm2.length} online</Chip>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead><tr className="text-inkfaint text-left border-t border-line">
                  <th className="px-4 py-2 font-normal">process</th><th className="px-2 py-2 font-normal">status</th>
                  <th className="px-2 py-2 font-normal">link</th>
                  <th className="px-2 py-2 font-normal text-right">cpu</th><th className="px-2 py-2 font-normal text-right">ram</th>
                  <th className="px-2 py-2 font-normal text-right">↻</th><th className="px-4 py-2 font-normal text-right">uptime</th>
                </tr></thead>
                <tbody>
                  {st.pm2.map((p) => (
                    <tr key={p.name} className="border-t border-line/50">
                      <td className="px-4 py-1.5 mono text-ink">{p.name}</td>
                      <td className="px-2 py-1.5"><span className={p.status === 'online' ? 'text-grn' : 'text-rose'}>● {p.status}</span></td>
                      <td className="px-2 py-1.5 mono">
                        {p.url ? (
                          <a href={p.url} target="_blank" rel="noreferrer" className="text-cyan hover:underline" title={p.url}>
                            ↗ {p.url.replace(/^https?:\/\//, '').slice(0, 32)}
                          </a>
                        ) : p.port ? (
                          <a href={`http://${location.hostname}:${p.port}`} target="_blank" rel="noreferrer"
                            className="text-inkdim hover:text-cyan hover:underline" title={`cổng nội bộ :${p.port} — mở qua IP máy`}>
                            :{p.port}
                          </a>
                        ) : <span className="text-inkfaint/50">–</span>}
                      </td>
                      <td className="px-2 py-1.5 num text-right text-inkdim">{p.cpu}%</td>
                      <td className="px-2 py-1.5 num text-right text-inkdim">{p.memMB}MB</td>
                      <td className={'px-2 py-1.5 num text-right ' + (p.restarts > 50 ? 'text-rose' : 'text-inkfaint')}>{p.restarts}</td>
                      <td className="px-4 py-1.5 num text-right text-inkfaint">{p.uptimeMin >= 1440 ? Math.floor(p.uptimeMin / 1440) + 'd' : Math.floor(p.uptimeMin / 60) + 'h'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>

          {/* tool dọn máy bằng agent */}
          <Card className="mt-4 p-4">
            <div className="flex items-center justify-between mb-3">
              <Eyebrow>🧹 Dọn máy — agent tự chạy</Eyebrow>
              {runningTool && <Chip tone="warning"><span className="animate-pulse">●</span> đang dọn · {elapsed}s</Chip>}
            </div>
            <div className="flex flex-wrap gap-2">
              {tools.map((t) => (
                <Button key={t.id} variant={t.id === 'analyze' ? 'secondary' : 'danger'} disabled={!!runningTool}
                  className={'text-xs ' + (runningTool === t.id ? 'animate-pulse' : '')}
                  onClick={() => run(t.id, t.label)}>
                  {runningTool === t.id ? '⏳ ' : ''}{t.label}
                </Button>
              ))}
            </div>
            <p className="text-[11px] text-inkfaint mt-2">Bấm nút → agent Sonnet chạy prompt dọn đóng khung (cấm đụng vault/source/DB), xong báo kết quả tại đây.</p>
            {result && (
              <div className="mt-3 rounded-lg border border-line bg-surface1 p-3">
                <div className="text-[11px] text-inkdim mb-1.5">Kết quả · {result.tool}</div>
                <pre className="text-[11px] text-ink whitespace-pre-wrap break-words mono max-h-72 overflow-auto">{result.text}</pre>
              </div>
            )}
          </Card>
        </>
      )}
    </PageShell>
  )
}
