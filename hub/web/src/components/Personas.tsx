import { EmptyState, ErrorState } from './ui'
import { useEffect, useState } from 'react'
import { amPersonas, amSavePersona, amDeletePersona, amPersonaRoute, type AmPersona, type PersonaRouteReply } from '../api'
import { showToast } from '../toast'
import PersonaChatPanel from './PersonaChatPanel'

const TOOLS = ['Read', 'Write', 'Edit', 'Bash', 'Glob', 'Grep', 'WebSearch', 'WebFetch']
const KINDS: AmPersona['kind'][] = ['specialist', 'orchestrator', 'executor']
const KIND_LABEL: Record<string, string> = { specialist: 'Specialist (chuyên gia)', orchestrator: 'Orchestrator (điều phối)', executor: 'Executor (lane rẻ)' }
const KIND_TONE: Record<string, string> = { specialist: 'text-cyan border-cyan/40', orchestrator: 'text-gold border-gold/40', executor: 'text-grn border-grn/40' }

const EMPTY: AmPersona = { id: '', name: '', systemPrompt: '', model: 'sonnet', kind: 'specialist', tags: [] }
const initials = (name: string) => (name || '?').replace(/·.*/, '').trim().slice(0, 2).toUpperCase()

export default function Personas() {
  const [list, setList] = useState<AmPersona[]>([])
  const [configured, setConfigured] = useState(true)
  const [editing, setEditing] = useState<AmPersona | null>(null)
  const [isNew, setIsNew] = useState(false)
  const [tagsRaw, setTagsRaw] = useState('')
  const [saving, setSaving] = useState(false)
  const [chatWith, setChatWith] = useState<AmPersona | null>(null)
  // M3.5 auto-route tester
  const [routeQ, setRouteQ] = useState('')
  const [routing, setRouting] = useState(false)
  const [route, setRoute] = useState<PersonaRouteReply | null>(null)

  const load = () => amPersonas().then((d) => { setConfigured(d.configured !== false); setList((d.personas || []).slice().sort((a, b) => a.name.localeCompare(b.name))) }).catch(() => {})
  useEffect(() => { load() }, [])

  const openEdit = (p: AmPersona) => { setEditing({ ...p, allowedTools: p.allowedTools || [], tags: p.tags || [] }); setTagsRaw((p.tags || []).join(', ')); setIsNew(false) }
  const openNew = () => { setEditing({ ...EMPTY }); setTagsRaw(''); setIsNew(true) }
  const close = () => { setEditing(null); setIsNew(false) }

  const set = (patch: Partial<AmPersona>) => setEditing((e) => e ? { ...e, ...patch } : e)
  const toggleTool = (t: string) => setEditing((e) => {
    if (!e) return e
    const has = (e.allowedTools || []).includes(t)
    return { ...e, allowedTools: has ? (e.allowedTools || []).filter((x) => x !== t) : [...(e.allowedTools || []), t] }
  })

  const save = async () => {
    if (!editing) return
    const p: AmPersona = { ...editing, tags: tagsRaw.split(',').map((s) => s.trim()).filter(Boolean) }
    if (!p.id.trim() || !p.name.trim() || !(p.systemPrompt || '').trim()) { showToast('Cần id + tên + system prompt'); return }
    if (!/^[a-z0-9][a-z0-9_-]{0,48}$/i.test(p.id)) { showToast('id chỉ chữ/số/-/_ (vd: finance)'); return }
    setSaving(true)
    const r = await amSavePersona(p)
    setSaving(false)
    if (r.ok) { showToast('Đã lưu expert ' + p.name); close(); load() }
    else showToast('Lỗi: ' + (r.error || 'không lưu được'))
  }

  const del = async (p: AmPersona) => {
    if (!confirm('Xoá expert "' + p.name + '" (' + p.id + ')? File config bị xoá.')) return
    const r = await amDeletePersona(p.id)
    if (r.ok) { showToast('Đã xoá ' + p.name); if (editing?.id === p.id) close(); load() }
    else showToast('Lỗi: ' + (r.error || 'không xoá được'))
  }

  const doRoute = async () => {
    const q = routeQ.trim()
    if (!q || routing) return
    setRouting(true); setRoute(null)
    const r = await amPersonaRoute(q)
    setRouting(false); setRoute(r)
    if (r.off) showToast('Auto-route đang tắt (LUCY_PERSONA_CHAT=1 để bật)')
  }
  const matched = route?.personaId ? list.find((p) => p.id === route!.personaId) : null

  return (
    <div className="h-full overflow-auto px-4 sm:px-6 py-5">
      <div className="max-w-5xl mx-auto">
        <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
          <div className="flex items-center gap-2">
            <span className="chip">{list.length} expert</span>
            <span className="text-[11px] text-inkfaint">Roster chuyên gia — Lucy hỏi ý kiến (consult) · nhắn tin trực tiếp · tự chọn đúng người</span>
          </div>
          <button onClick={openNew} className="btn btn-primary">+ Expert mới</button>
        </div>

        {/* M3.5 — thanh "Lucy tự chọn chuyên gia" (auto-route) */}
        {configured && (
          <div className="card p-3 mb-4 flex flex-col gap-2">
            <div className="flex gap-2 flex-wrap items-center">
              <span className="text-[12px] text-gold">🔮 Lucy tự chọn chuyên gia</span>
              <input className="input flex-1 !min-w-48 !py-2" placeholder="Mô tả việc cần (vd: giá BTC hôm nay, sửa bug build, phối màu UI)…"
                value={routeQ} onChange={(e) => setRouteQ(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') doRoute() }} />
              <button onClick={doRoute} disabled={routing || !routeQ.trim()} className="btn">{routing ? '…' : 'Chọn'}</button>
            </div>
            {route && !route.off && route.personaId && (
              <div className="flex items-center gap-2 flex-wrap text-[12px]">
                <span className="text-inkdim">→ hợp nhất:</span>
                <span className="chip text-cyan border-cyan/40">{route.name}</span>
                <span className="num text-inkfaint">tin cậy {Math.round((route.confidence || 0) * 100)}%</span>
                <span className="num text-inkfaint">[{route.mode}]</span>
                {matched && <button onClick={() => setChatWith(matched)} className="btn btn-primary !py-1 !px-2 text-xs">Nhắn tin →</button>}
                {route.why && <span className="text-inkfaint truncate w-full">{route.why}</span>}
              </div>
            )}
          </div>
        )}

        {!configured && (
          <ErrorState message="Agent-Machine chưa cấu hình (AM_COORD_URL)." />
        )}

        {editing && (
          <div className="card p-4 mb-4 flex flex-col gap-3">
            <div className="flex gap-2 flex-wrap">
              <input className="input mono !w-44" placeholder="id (vd: finance)" value={editing.id} disabled={!isNew}
                onChange={(e) => set({ id: e.target.value })} title={isNew ? 'id duy nhất, làm tên file' : 'id không đổi được'} />
              <input className="input flex-1 !min-w-48" placeholder="Tên hiển thị (vd: Eru · Finance)" value={editing.name} onChange={(e) => set({ name: e.target.value })} />
            </div>
            <textarea className="input resize-none" rows={6} placeholder="System prompt — vai trò, thế mạnh, cách trả lời…" value={editing.systemPrompt} onChange={(e) => set({ systemPrompt: e.target.value })} />
            <div className="flex gap-2 flex-wrap items-center">
              <select className="btn !py-2" value={editing.kind} onChange={(e) => set({ kind: e.target.value as AmPersona['kind'] })} title="Loại agent">
                {KINDS.map((k) => <option key={k} value={k} className="bg-panel">{KIND_LABEL[k!]}</option>)}
              </select>
              <select className="btn !py-2" value={editing.model} onChange={(e) => set({ model: e.target.value as 'sonnet' | 'opus' })} title="Tier Claude khi chạy thật">
                <option value="sonnet" className="bg-panel">sonnet (nhanh)</option>
                <option value="opus" className="bg-panel">opus (sâu)</option>
              </select>
              <input className="input mono !w-52" placeholder="laneModel (vd: or-nemotron-super)" value={editing.laneModel || ''} onChange={(e) => set({ laneModel: e.target.value })} title="Key model lane rẻ — bỏ trống nếu không dùng" />
              <input className="input !w-40" placeholder="realm (anime gốc)" value={editing.realm || ''} onChange={(e) => set({ realm: e.target.value })} />
            </div>
            <input className="input" placeholder="tags (skill), phẩy ngăn: finance, market, trading" value={tagsRaw} onChange={(e) => setTagsRaw(e.target.value)} />
            <div className="flex gap-2 flex-wrap items-center">
              <span className="text-[12px] text-inkdim">Tool cho phép:</span>
              {TOOLS.map((t) => {
                const on = (editing.allowedTools || []).includes(t)
                return <button key={t} onClick={() => toggleTool(t)} className={'chip mono cursor-pointer ' + (on ? 'text-grn border-grn/50' : 'text-inkfaint opacity-60')}>{on ? '✓ ' : ''}{t}</button>
              })}
            </div>
            <div className="flex gap-2 flex-wrap items-center">
              <input className="input mono !w-32" type="number" placeholder="maxTurns" value={editing.maxTurns ?? ''} onChange={(e) => set({ maxTurns: e.target.value ? Number(e.target.value) : undefined })} title="Số turn tối đa" />
              <input className="input mono !w-32" type="number" placeholder="timeoutSec" value={editing.timeoutSec ?? ''} onChange={(e) => set({ timeoutSec: e.target.value ? Number(e.target.value) : undefined })} title="Timeout giây" />
              <div className="flex-1" />
              <button onClick={close} className="btn">Đóng</button>
              <button onClick={save} disabled={saving} className="btn btn-primary">{saving ? '…' : isNew ? 'Tạo expert' : 'Lưu'}</button>
            </div>
          </div>
        )}

        {configured && list.length === 0 && !editing && (
          <EmptyState title="Chưa có expert" hint="Tạo để Lucy hỏi ý kiến chuyên sâu." />
        )}

        {/* RPG hero roster grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {list.map((p) => {
            const tone = KIND_TONE[p.kind || 'specialist']
            const hi = matched?.id === p.id
            return (
              <div key={p.id} className={'reveal-host glass glass-hover p-4 flex flex-col gap-2 cursor-default ' + (hi ? 'border-cyan/50 ring-1 ring-cyan/30' : '')}>
                <div className="flex items-start gap-3">
                  <div className="relative w-11 h-11 shrink-0">
                    <div className="arc-reactor absolute inset-0" />
                    <div className="absolute inset-0 flex items-center justify-center num text-[13px] text-cyan font-bold">{initials(p.name)}</div>
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="font-semibold text-ink truncate">{p.name}</div>
                    <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
                      <span className={'chip text-[10px] ' + tone}>{p.kind || 'specialist'}</span>
                      <span className="num text-[10px] text-inkfaint uppercase">{p.model}</span>
                      {p.laneModel && <span className="num text-[10px] text-gold" title="lane rẻ">⚡</span>}
                    </div>
                  </div>
                </div>
                {p.systemPrompt && <div className="text-[11.5px] text-inkdim line-clamp-2 leading-snug">{p.systemPrompt}</div>}
                {!!(p.tags && p.tags.length) && <div className="flex gap-1 flex-wrap">{p.tags.slice(0, 5).map((t) => <span key={t} className="chip num text-[9px]">{t}</span>)}</div>}
                {/* hành động — hiện khi hover (desktop), luôn hiện ở mobile */}
                <div className="hover-reveal flex gap-1.5 mt-auto pt-1">
                  <button onClick={() => setChatWith(p)} className="btn btn-primary !py-1 !px-2 text-xs flex-1">💬 Nhắn tin</button>
                  <button onClick={() => openEdit(p)} className="btn !py-1 !px-2 text-xs">Sửa</button>
                  <button onClick={() => del(p)} className="btn !py-1 !px-2 text-xs text-pink/80" title="Xoá">✕</button>
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {chatWith && <PersonaChatPanel persona={chatWith} onClose={() => setChatWith(null)} />}
    </div>
  )
}
