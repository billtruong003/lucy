import { useEffect, useMemo, useRef, useState } from 'react'
import { amState, amAddChannel, amPostChannel, type AmMsg, type AmCard, type AmProject, type AmPersona } from '../api'
import Markdown from './Markdown'

// màu/avatar theo "ai nói" — agent là thành viên của kênh (như Discord)
const AGENT_PALETTE = ['#3fd3ff', '#5fe39a', '#ff9d5c', '#b78cff', '#46c6ec', '#f5d76e']
function hashIdx(s: string, n: number) { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0; return h % n }
function authorColor(a: string) { return a === 'bill' ? '#5fe39a' : a === 'engine' ? '#5e748b' : AGENT_PALETTE[hashIdx(a, AGENT_PALETTE.length)] }
function initials(a: string) { const t = a.replace(/·.*/, '').trim(); return (t[0] || '?').toUpperCase() }

type Chan = { id: string; label: string; kind: 'chan' | 'task' | 'sys'; count: number }

export default function Channels({ projectId }: { projectId?: string } = {}) {
  const [msgs, setMsgs] = useState<AmMsg[]>([])
  const [cards, setCards] = useState<AmCard[]>([])
  const [projects, setProjects] = useState<AmProject[]>([])
  const [personas, setPersonas] = useState<AmPersona[]>([])
  const [cur, setCur] = useState<string>(projectId ? `p:${projectId}:general` : 'coordination')
  const [configured, setConfigured] = useState(true)
  const [offline, setOffline] = useState(false)
  const [draft, setDraft] = useState('')
  const [newChan, setNewChan] = useState('')
  const [adding, setAdding] = useState(false)
  const endRef = useRef<HTMLDivElement>(null)
  const busy = useRef(false)

  const pull = async () => {
    if (busy.current) return; busy.current = true
    try { const s = await amState(); setConfigured(s.configured !== false); setOffline(!!s.offline); setMsgs(s.channels || []); setCards(s.cards || []); setProjects(s.projects || []); setPersonas(s.personas || []) } catch { /* */ } finally { busy.current = false }
  }
  useEffect(() => { pull(); const iv = setInterval(pull, 2000); return () => clearInterval(iv) }, [])
  const avatarOf = (author: string) => personas.find((p) => p.name === author)?.avatar

  const project = projects.find((p) => p.id === projectId)
  const cnt = (id: string) => msgs.filter((m) => m.channel === id).length

  // danh sách kênh: project-mode = kênh dự án (#) + thread task (🧩); global = suy từ msgs
  const groups = useMemo<{ title: string; items: Chan[] }[]>(() => {
    if (projectId) {
      const chans: Chan[] = (project?.channels || ['general']).map((n) => ({ id: `p:${projectId}:${n}`, label: '# ' + n, kind: 'chan', count: cnt(`p:${projectId}:${n}`) }))
      const threads: Chan[] = cards.filter((c) => (c.projectId || 'default') === projectId).map((c) => ({ id: 'card-' + c.id, label: c.title, kind: 'task', count: cnt('card-' + c.id) }))
      return [{ title: 'KÊNH', items: chans }, { title: 'TASK', items: threads }]
    }
    const m = new Map<string, { count: number; title?: string }>()
    for (const x of msgs) { const e = m.get(x.channel) || { count: 0 }; e.count++; if (x.kind === 'system' && x.text.startsWith('+ card')) e.title = x.text.replace(/^\+ card "(.*?)".*/, '$1'); m.set(x.channel, e) }
    const names = [...m.keys()].sort((a, b) => (a === 'coordination' ? -1 : b === 'coordination' ? 1 : a.localeCompare(b)))
    return [{ title: 'KÊNH AGENT', items: names.map((n) => ({ id: n, label: n === 'coordination' ? '# coordination' : '🧩 ' + (m.get(n)!.title || n.slice(5, 13)), kind: 'sys', count: m.get(n)!.count })) }]
  }, [projectId, project, cards, msgs])

  const allItems = useMemo(() => groups.flatMap((g) => g.items), [groups])
  useEffect(() => { if (allItems.length && !allItems.find((c) => c.id === cur)) setCur(allItems[0].id) }, [allItems, cur])
  const list = useMemo(() => msgs.filter((m) => m.channel === cur), [msgs, cur])
  useEffect(() => { endRef.current?.scrollIntoView({ block: 'end' }) }, [list.length, cur])

  const members = useMemo(() => [...new Set(list.filter((m) => m.author !== 'engine').map((m) => m.author))], [list])
  const curMeta = allItems.find((c) => c.id === cur)

  const send = async () => {
    if (!draft.trim() || !projectId) return
    const chArg = cur.startsWith('p:') ? cur.split(':').slice(2).join(':') : cur // tên kênh, hoặc card-<id>
    await amPostChannel(projectId, chArg, draft.trim())
    setDraft(''); pull()
  }
  const addChannel = async () => { if (!newChan.trim() || !projectId) return; await amAddChannel(projectId, newChan.trim()); setNewChan(''); setAdding(false); pull() }

  if (configured === false) return <Empty msg="Agent-Machine chưa cấu hình — đặt AM_COORD_URL cho hub server." />

  return (
    <div className="h-full flex overflow-hidden">
      {/* channel list */}
      <div className="w-52 shrink-0 border-r border-line bg-panel/40 overflow-y-auto p-2 flex flex-col gap-2">
        {offline && <div className="text-[10px] text-pink px-2">· coordinator offline</div>}
        {groups.map((g) => (
          <div key={g.title}>
            <div className="flex items-center px-2 py-1">
              <span className="text-[10px] text-inkfaint tracking-[0.2em]">{g.title}</span>
              {projectId && g.title === 'KÊNH' && <button className="ml-auto text-inkfaint hover:text-cyan text-[14px] leading-none" title="thêm kênh" onClick={() => setAdding((v) => !v)}>＋</button>}
            </div>
            {projectId && g.title === 'KÊNH' && adding && (
              <div className="px-1.5 pb-1.5 flex gap-1">
                <input className="input !py-1 !text-[11px] flex-1" placeholder="tên kênh (vd testing)" value={newChan} onChange={(e) => setNewChan(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && addChannel()} autoFocus />
              </div>
            )}
            {g.items.length === 0 && <div className="text-[11px] text-inkfaint/60 px-2 py-1">—</div>}
            {g.items.map((c) => {
              const on = c.id === cur
              return (
                <button key={c.id} onClick={() => setCur(c.id)}
                  className={'w-full flex items-center justify-between rounded-lg px-2.5 py-1.5 text-left text-[12px] transition ' + (on ? 'bg-cyan/10 text-cyan' : 'text-inkdim hover:text-ink hover:bg-white/[0.03]')}>
                  <span className="truncate flex items-center gap-1">{c.kind === 'task' && <span className="text-[10px]">🧩</span>}{c.label}</span>
                  {c.count > 0 && <span className="text-[10px] text-inkfaint shrink-0 ml-1">{c.count}</span>}
                </button>
              )
            })}
          </div>
        ))}
      </div>

      {/* conversation */}
      <div className="flex-1 min-w-0 flex flex-col">
        <div className="h-11 shrink-0 flex items-center gap-3 px-4 border-b border-line">
          <span className="display tracking-[0.16em] text-[13px] text-ink truncate">{curMeta ? (curMeta.kind === 'task' ? '🧩 ' + curMeta.label : curMeta.label) : cur}</span>
          <div className="flex items-center gap-1 ml-auto">
            {members.map((a) => { const av = avatarOf(a); return av
              ? <img key={a} src={av} title={a} alt={a} className="h-5 w-5 rounded-full object-cover" style={{ border: `1px solid ${authorColor(a)}88` }} />
              : <span key={a} title={a} className="h-5 w-5 rounded-full grid place-items-center text-[10px] font-bold" style={{ background: authorColor(a) + '22', color: authorColor(a), border: `1px solid ${authorColor(a)}55` }}>{initials(a)}</span> })}
          </div>
        </div>
        <div className="flex-1 min-h-0 overflow-y-auto px-3 py-2 flex flex-col gap-0.5">
          {list.length === 0 && <div className="text-[12px] text-inkfaint/60 m-auto">— chưa có tin nhắn —</div>}
          {list.map((m, i) => <Row key={i} m={m} prev={list[i - 1]} avatar={avatarOf(m.author)} />)}
          <div ref={endRef} />
        </div>
        {/* ô gõ — điều hướng AI (chỉ project-mode) */}
        {projectId && (
          <div className="shrink-0 border-t border-line p-2.5 flex gap-2">
            <input className="input flex-1" placeholder={`Nhắn ${curMeta?.kind === 'task' ? 'thread task này' : '#' + (cur.split(':')[2] || '')}… (@tên để gọi 1 agent)`}
              value={draft} onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && send()} />
            <button className="btn btn-primary shrink-0" onClick={send} disabled={!draft.trim()}>Gửi</button>
          </div>
        )}
      </div>
    </div>
  )
}

function Row({ m, prev, avatar }: { m: AmMsg; prev?: AmMsg; avatar?: string }) {
  const col = authorColor(m.author)
  const time = new Date(m.ts).toISOString().slice(11, 19)
  const sameAuthor = prev && prev.author === m.author && prev.kind !== 'decision' && m.kind !== 'decision' && m.ts - prev.ts < 60000

  if (m.kind === 'system') return (
    <div className="flex items-center gap-2 py-0.5 pl-11 text-[11px] text-inkfaint/70"><span className="mono text-[9px]">{time}</span><span>· {m.text}</span></div>
  )
  if (m.kind === 'decision') return (
    <div className="my-1 ml-11 rounded-lg border px-3 py-2" style={{ borderColor: '#ff5d9e66', background: '#ff5d9e10' }}>
      <div className="text-[11px] text-pink font-semibold">⛔ {m.author} cần quyết định</div>
      <div className="text-[12.5px] text-ink mt-0.5">{m.text.replace(/^⛔\s*(GATE|CẦN QUYẾT ĐỊNH):?\s*/i, '')}</div>
    </div>
  )
  const isHandoff = m.kind === 'handoff'
  const isReport = m.kind === 'report'
  return (
    <div className={'flex items-start gap-2.5 ' + (sameAuthor ? 'mt-0' : 'mt-2')}>
      <div className="w-8 shrink-0 flex justify-center">
        {!sameAuthor && (avatar
          ? <img src={avatar} alt={m.author} className="h-7 w-7 rounded-full object-cover mt-0.5" style={{ border: `1px solid ${col}88` }} />
          : <span className="h-7 w-7 rounded-full grid place-items-center text-[11px] font-bold mt-0.5" style={{ background: col + '22', color: col, border: `1px solid ${col}55` }}>{initials(m.author)}</span>)}
      </div>
      <div className="min-w-0 flex-1">
        {!sameAuthor && (
          <div className="flex items-baseline gap-2">
            <span className="text-[12.5px] font-semibold" style={{ color: col }}>{m.author}</span>
            <span className="text-[9px] text-inkfaint mono">{time}</span>
          </div>
        )}
        <div className={'text-[13px] leading-snug break-words ' + (isHandoff ? 'text-cyan font-medium' : 'text-inkdim')}>
          {isHandoff && <span className="inline-block px-1.5 py-0.5 mr-1 rounded text-[10px] align-middle" style={{ background: '#3fd3ff18', color: '#7fe3ff', border: '1px solid #3fd3ff33' }}>handoff</span>}
          {isReport
            ? <div className="mt-0.5 rounded-lg border border-line bg-black/20 px-2.5 py-1.5 max-h-72 overflow-auto"><div className="text-[9px] text-grn tracking-[0.16em] mb-0.5">📝 BÁO CÁO</div><Markdown>{m.text}</Markdown></div>
            : m.text}
        </div>
      </div>
    </div>
  )
}

function Empty({ msg }: { msg: string }) {
  return <div className="h-full grid place-items-center p-6"><div className="card p-5 max-w-md text-center text-inkdim text-sm">{msg}</div></div>
}
