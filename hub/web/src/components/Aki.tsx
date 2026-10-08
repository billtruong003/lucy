import { useEffect, useState } from 'react'

export default function Aki() {
  const [configured, setConfigured] = useState<boolean | null>(null)
  // report
  const [channel, setChannel] = useState('')
  const [text, setText] = useState('')
  // channel/thread
  const [name, setName] = useState('')
  const [ctype, setCtype] = useState<'text' | 'thread'>('text')
  const [parent, setParent] = useState('')
  const [starter, setStarter] = useState('')
  const [msg, setMsg] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => { fetch('/api/aki/status').then((r) => r.json()).then((d) => setConfigured(!!d.configured)).catch(() => setConfigured(false)) }, [])

  async function post(url: string, body: unknown) {
    setBusy(true); setMsg('')
    try {
      const r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
      const d = await r.json()
      setMsg(r.ok ? '✓ Aki đã làm: ' + JSON.stringify(d) : '✗ ' + (d.error || r.status))
    } catch (e) { setMsg('✗ ' + e) }
    setBusy(false)
  }
  const sendReport = () => { if (channel.trim() && text.trim()) post('/api/aki/report', { channel, text }) }
  const makeChannel = () => { if (name.trim()) post('/api/aki/channel', { name, type: ctype, parent, message: starter }) }

  return (
    <div className="h-full overflow-auto px-4 sm:px-6 py-5">
      <div className="max-w-2xl mx-auto flex flex-col gap-4">
        <div className="flex items-center gap-2">
          <span className="chip">{configured === null ? '…' : configured ? '🟢 Aki đã nối' : '⚪ chưa cấu hình'}</span>
          <span className="text-[11px] text-inkfaint">Lucy → radiant-bot (Aki) trên Discord, ký HMAC</span>
        </div>

        {configured === false && (
          <div className="card p-5 text-sm text-inkdim leading-relaxed">
            <div className="text-cyan mb-2 font-semibold">Chưa nối Aki</div>
            Đặt trong <code className="md">hub/server/.env</code>: <br />
            <code className="md">RADIANT_BOT_API_URL</code> (vd http://127.0.0.1:3030) + <code className="md">RADIANT_BOT_AGENT_SECRET</code><br />
            và trên radiant-bot đặt <code className="md">AGENT_HMAC_SECRET</code> (CÙNG giá trị) + <code className="md">HEALTH_PORT</code> &gt; 0. Restart cả 2.
          </div>
        )}

        {configured && (
          <>
            <div className="card p-4 flex flex-col gap-3">
              <div className="hud-lbl text-cyan flex items-center gap-1.5">📣 Đẩy báo cáo vào kênh</div>
              <input className="input" placeholder="kênh (tên hoặc ID, vd: truong-lao)" value={channel} onChange={(e) => setChannel(e.target.value)} />
              <textarea className="input resize-none" rows={5} placeholder="Nội dung báo cáo Aki sẽ post lên Discord…" value={text} onChange={(e) => setText(e.target.value)} />
              <div className="flex justify-end"><button onClick={sendReport} disabled={busy} className="btn btn-primary">Đẩy qua Aki</button></div>
            </div>

            <div className="card p-4 flex flex-col gap-3">
              <div className="hud-lbl text-cyan flex items-center gap-1.5">➕ Tạo kênh / thread</div>
              <div className="flex gap-2 flex-wrap">
                <input className="input flex-1 min-w-[160px]" placeholder="tên kênh/thread" value={name} onChange={(e) => setName(e.target.value)} />
                <select className="btn !py-2" value={ctype} onChange={(e) => setCtype(e.target.value as 'text' | 'thread')}>
                  <option value="text" className="bg-panel">kênh text</option>
                  <option value="thread" className="bg-panel">thread</option>
                </select>
              </div>
              {ctype === 'thread' && (
                <>
                  <input className="input" placeholder="kênh cha (tên/ID) — thread tạo trong đây" value={parent} onChange={(e) => setParent(e.target.value)} />
                  <input className="input" placeholder="(tuỳ chọn) tin nhắn mở đầu thread" value={starter} onChange={(e) => setStarter(e.target.value)} />
                </>
              )}
              <div className="flex justify-end"><button onClick={makeChannel} disabled={busy} className="btn btn-primary">Tạo qua Aki</button></div>
            </div>
          </>
        )}

        {msg && <div className={'card p-3 text-[12px] break-words ' + (msg.startsWith('✓') ? 'text-grn' : 'text-pink')}>{msg}</div>}
      </div>
    </div>
  )
}
