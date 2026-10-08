import { useEffect, useMemo, useRef, useState } from 'react'
import { amState, amSetLanes, amCreateCard, amApprove, amReject, amAnswer, amRemoveCard, amActivate, type AmCard, type AmPipeline, type AmPersona } from '../api'
import Planner from './Planner'
import RichTextEditor from './RichTextEditor'
import Markdown from './Markdown'
import TaskFlow from './TaskFlow'

const STATUS: Record<string, { label: string; color: string; icon: string }> = {
  backlog: { label: 'ĐỂ SAU', color: '#8aa0b5', icon: '🕓' },
  queued: { label: 'XẾP HÀNG', color: '#9fb4c9', icon: '◦' },
  working: { label: 'ĐANG CHẠY', color: '#3fd3ff', icon: '⏳' },
  waiting_human: { label: 'CHỜ BẠN DUYỆT', color: '#ff5d9e', icon: '⛔' },
  blocked: { label: 'HOLD', color: '#c9a85f', icon: '⏸' },
  parked: { label: 'RATE-LIMIT', color: '#ff9d5c', icon: '⏸' },
  done: { label: 'XONG', color: '#5fe39a', icon: '✓' },
  failed: { label: 'LỖI', color: '#ff6b6b', icon: '✕' },
}
const ORDER = ['backlog', 'queued', 'working', 'waiting_human', 'blocked', 'parked', 'done', 'failed']

// Sub-badge: hiện rõ LÕI điều phối đang tác động lên card (triage/split/size-gate/rate-limit)
// ngoài cột status — để Bill thấy "não" đang làm gì chứ không chỉ trạng thái thô.
function subBadge(c: { status: string; waitKind?: string; blockKind?: string; blockedBy?: string[]; retryAfter?: number }): { t: string; c: string } | null {
  if (c.status === 'parked') { const m = c.retryAfter ? Math.max(0, Math.round((c.retryAfter - Date.now()) / 60000)) : 0; return { t: `⏸ rate-limit · còn ~${m}′`, c: '#ff9d5c' } }
  if (c.waitKind === 'stuck') return { t: '🧩 kẹt → triage', c: '#b78cff' }
  if (c.waitKind === 'size-gate') return { t: '📦 task to → tách', c: '#ff9d5c' }
  if (c.status === 'blocked' && c.blockKind === 'delegate') return { t: `🧩 split · ${c.blockedBy?.length || 0} việc con`, c: '#b78cff' }
  return null
}
const EVENT_ICON: Record<string, string> = { created: '✚', 'created-backlog': '🕓', activated: '▶', 'enter-stage': '→', advance: '↑', done: '🏁', delegate: '📨', needs_decision: '⛔', fail: '✕', 'reject-rework': '↩', recovered: '♻' }
const fmtElapsed = (ms: number) => { const s = Math.max(0, Math.floor(ms / 1000)); const m = Math.floor(s / 60); return m > 0 ? `${m}:${String(s % 60).padStart(2, '0')}` : `${s}s` }

export default function Board({ projectId }: { projectId?: string } = {}) {
  const [cards, setCards] = useState<AmCard[]>([])
  const [pipes, setPipes] = useState<AmPipeline[]>([])
  const [personas, setPersonas] = useState<AmPersona[]>([])
  const [limits, setLimits] = useState<{ maxLanes?: number; queued?: number; inFlight?: number }>({})
  const [cfgState, setCfgState] = useState<'ok' | 'unconfigured' | 'offline'>('ok')
  const [sel, setSel] = useState<string | null>(null)
  const [proj, setProj] = useState(projectId || 'all')
  useEffect(() => { if (projectId) setProj(projectId) }, [projectId])
  const [form, setForm] = useState({ title: '', brief: '', pipeline: '', project: '', model: '', personaId: '', defer: false, open: false })
  const [lanes, setLanes] = useState('')
  const [planOpen, setPlanOpen] = useState(false)
  const [flow, setFlow] = useState(false)   // view DAG phụ thuộc task (A→B→C)
  const busy = useRef(false)

  const pull = async () => {
    if (busy.current) return; busy.current = true
    try {
      const s = await amState()
      if ((s as any).configured === false) { setCfgState('unconfigured'); return }
      setCfgState(s.offline ? 'offline' : 'ok')
      setCards(s.cards || []); setPipes(s.pipelines || []); setPersonas(s.personas || [])
      const lm = (s as any).limits || {}; setLimits(lm)
      if (!lanes && lm.maxLanes != null) setLanes(String(lm.maxLanes))
    } catch { /* */ } finally { busy.current = false }
  }
  useEffect(() => { pull(); const iv = setInterval(pull, 2000); return () => clearInterval(iv) }, [])
  // B2: default pipeline hợp lý khi pipes load (ưu tiên 'feature' cho engineer, không cứng 'course')
  useEffect(() => {
    if (!pipes.length || pipes.find((p) => p.id === form.pipeline)) return
    setForm((f) => ({ ...f, pipeline: (pipes.find((p) => p.id === 'feature') || pipes[0]).id }))
  }, [pipes])
  const [now, setNow] = useState(Date.now())
  useEffect(() => { const iv = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(iv) }, [])

  const pipeMap = useMemo(() => new Map(pipes.map((p) => [p.id, p])), [pipes])
  const personaMap = useMemo(() => new Map(personas.map((p) => [p.id, p])), [personas])
  // BUG-1b: effective persona cho laneModel guard (form.personaId → pipeline stage-0)
  const effectivePersonaId = form.personaId || (form.pipeline && pipeMap.get(form.pipeline)?.stages[0]?.personaId)
  const effectivePersona = effectivePersonaId ? personaMap.get(effectivePersonaId) : undefined
  const laneModelAvailable = !!effectivePersona?.laneModel
  // BUG-1b: nếu persona/pipeline đổi và laneModel không khả dụng → reset form.model
  useEffect(() => {
    if (form.model === 'laneModel' && effectivePersonaId && !laneModelAvailable) {
      setForm((f) => ({ ...f, model: '' }))
    }
  }, [form.personaId, form.pipeline, effectivePersonaId])
  const stageOf = (c: AmCard) => pipeMap.get(c.pipelineId)?.stages[c.stageIndex]
  const personaOf = (c: AmCard) => { const st = stageOf(c); return st ? personaMap.get(st.personaId) : undefined }
  const projects = useMemo(() => [...new Set(cards.map((c) => c.projectId || 'default'))].sort(), [cards])
  const shown = proj === 'all' ? cards : cards.filter((c) => (c.projectId || 'default') === proj)
  const waiting = shown.filter((c) => c.status === 'waiting_human')
  const selected = cards.find((c) => c.id === sel) || null

  const create = async () => { if (!form.title.trim()) return; const pj = projectId || form.project.trim() || (proj !== 'all' ? proj : 'default'); const mdl = form.model === 'opus' || form.model === 'sonnet' || form.model === 'laneModel' ? (form.model as 'sonnet' | 'opus' | 'laneModel') : undefined; const pid = form.personaId || undefined; await amCreateCard(form.title.trim(), form.brief.trim(), form.pipeline.trim() || pipes[0]?.id || 'feature', pj, form.defer, mdl, undefined, pid); setForm({ ...form, title: '', brief: '', personaId: '', open: false }); pull() }
  const approve = async (id: string) => { await amApprove(id); pull() }
  const reject = async (id: string, fb: string) => { await amReject(id, fb); pull() }
  const answer = async (id: string, text: string) => { await amAnswer(id, text); pull() }
  const remove = async (id: string) => { await amRemoveCard(id); setSel(null); pull() }
  const activate = async (id: string) => { await amActivate(id); pull() }
  const setLanesNow = async () => { const n = Number(lanes); if (n >= 1) { await amSetLanes(n); pull() } }

  if (cfgState === 'unconfigured') return <Empty icon="📋" msg="Agent-Machine chưa cấu hình — đặt AM_COORD_URL + AM_TOKEN cho hub server." />

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* ── header ── */}
      <div className="shrink-0 px-4 sm:px-5 py-3 border-b border-line flex items-center gap-2 flex-wrap">
        <span className="chip"><span className={'h-1.5 w-1.5 rounded-full ' + (limits.inFlight ? 'bg-cyan' : 'bg-inkfaint')} /> {limits.inFlight ?? 0} chạy · {limits.queued ?? 0} chờ</span>
        {waiting.length > 0 && <span className="chip" style={{ color: '#ff5d9e', borderColor: '#ff5d9e55' }}>⛔ {waiting.length} cần bạn duyệt</span>}
        {cfgState === 'offline' && <span className="chip text-pink">coordinator offline</span>}
        <div className="ml-auto flex items-center gap-1.5 text-inkdim">
          <span className="text-[11px]">queue</span>
          <input className="input !w-12 text-center !py-1.5" value={lanes} onChange={(e) => setLanes(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && setLanesNow()} title="số agent chạy song song (maxLanes)" />
          <button className="btn !py-1.5" onClick={setLanesNow}>set</button>
        </div>
        <button className="btn" style={flow ? { borderColor: '#3fd3ff55', color: '#3fd3ff' } : undefined} onClick={() => setFlow((v) => !v)} title="Xem luồng phụ thuộc giữa các task (A→B→C)">🔗 Flow</button>
        <button className="btn" style={{ borderColor: '#3fd3ff55', color: '#3fd3ff' }} onClick={() => setPlanOpen((v) => !v)} title="Lucy tự soạn card từ mục tiêu">✨ Lucy</button>
        <button className="btn btn-primary" onClick={() => setForm({ ...form, open: !form.open })}>{form.open ? 'Đóng' : '+ Card'}</button>
      </div>
      {planOpen && <Planner project={proj} pipes={pipes} onDone={pull} onClose={() => setPlanOpen(false)} />}

      {/* ── project selector (chỉ hiện khi KHÔNG bị scope vào 1 dự án) ── */}
      {!projectId && projects.length > 0 && (
        <div className="shrink-0 px-4 sm:px-5 py-2 border-b border-line flex items-center gap-1.5 overflow-x-auto">
          <span className="text-[10px] text-inkfaint tracking-[0.16em] shrink-0 mr-1">DỰ ÁN</span>
          <button onClick={() => setProj('all')} className={'chip shrink-0 transition ' + (proj === 'all' ? '!text-cyan !border-cyan/50 bg-cyan/5' : 'hover:text-ink')}>Tất cả <span className="opacity-50 ml-0.5">{cards.length}</span></button>
          {projects.map((p) => {
            const n = cards.filter((c) => (c.projectId || 'default') === p).length
            const act = cards.filter((c) => (c.projectId || 'default') === p && (c.status === 'working' || c.status === 'waiting_human')).length
            return (
              <button key={p} onClick={() => setProj(p)} className={'chip shrink-0 transition ' + (proj === p ? '!text-cyan !border-cyan/50 bg-cyan/5' : 'hover:text-ink')}>
                {p} <span className="opacity-50 ml-0.5">{n}</span>{act > 0 && <span className="ml-1 text-cyan">●{act}</span>}
              </button>
            )
          })}
        </div>
      )}

      {/* ── create form ── */}
      {form.open && (
        <div className="modal-card shrink-0 px-4 sm:px-5 py-4 border-b border-line bg-panel/30 flex flex-col gap-3">
          {/* row 1: title + meta */}
          <div className="flex flex-col sm:flex-row gap-2">
            <input className="input flex-1" placeholder="Tên việc…" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} onKeyDown={(e) => e.key === 'Enter' && create()} autoFocus />
            {!projectId && <input className="input sm:!w-32" placeholder="dự án" value={form.project} onChange={(e) => setForm({ ...form, project: e.target.value })} />}
            <select className="input sm:!w-40" value={form.pipeline} onChange={(e) => setForm({ ...form, pipeline: e.target.value })}>
              {pipes.length === 0 && <option value="">(chưa có pipeline)</option>}
              {pipes.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
            <select className="input sm:!w-32" value={form.personaId} onChange={(e) => setForm({ ...form, personaId: e.target.value })} title="Persona cho stage đầu (mặc định = theo pipeline)">
              <option value="">agent: (mặc định)</option>
              {personas.map((p) => <option key={p.id} value={p.id}>{p.avatar ? `${p.avatar} ` : ''}{p.name}</option>)}
            </select>
            <select className="input sm:!w-28" value={form.model} onChange={(e) => setForm({ ...form, model: e.target.value })} title="Model cho card (mặc định = theo persona)">
              <option value="">model: auto</option>
              <option value="sonnet">sonnet</option>
              <option value="opus">opus</option>
              {laneModelAvailable && <option value="laneModel">laneModel (rẻ)</option>}
            </select>
          </div>
          {/* row 2: rich text brief */}
          <RichTextEditor
            value={form.brief}
            onChange={(v) => setForm({ ...form, brief: v })}
            placeholder="Mô tả / brief… (hỗ trợ **bold**, *italic*, ## heading, - list, [link](url))"
            rows={4}
          />
          {/* row 3: actions */}
          <div className="flex items-center gap-2">
            <label className="flex items-center gap-1.5 px-2 text-[12px] text-inkdim cursor-pointer select-none" title="Tạo nhưng KHÔNG chạy ngay — để backlog, khi nào muốn bấm Chạy">
              <input type="checkbox" checked={form.defer} onChange={(e) => setForm({ ...form, defer: e.target.checked })} /> 🕓 để sau
            </label>
            <div className="ml-auto flex gap-2">
              <button className="btn" onClick={() => setForm({ ...form, open: false })}>Huỷ</button>
              <button className="btn btn-primary" onClick={create}>Tạo card</button>
            </div>
          </div>
        </div>
      )}

      {/* ── needs-you banner (nổi bật chỗ phải làm) ── */}
      {waiting.length > 0 && (
        <div className="shrink-0 px-4 sm:px-5 py-3 border-b" style={{ borderColor: '#ff5d9e33', background: '#ff5d9e0c' }}>
          <div className="flex items-center gap-2 mb-2"><span className="text-pink text-sm font-semibold">🔔 Cần bạn quyết định</span></div>
          <div className="flex flex-col gap-2">
            {waiting.map((c) => (
              <div key={c.id} className="flex items-center gap-3 card !bg-black/20 px-3 py-2">
                <button className="text-left flex-1 min-w-0" onClick={() => setSel(c.id)}>
                  <div className="text-[13px] font-semibold text-ink truncate">{c.title}</div>
                  <div className="text-[12px] text-pink truncate">{c.pendingQuestion || 'cần duyệt để chạy tiếp'}</div>
                </button>
                <button className="btn btn-primary shrink-0" onClick={() => approve(c.id)}>✓ Duyệt</button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── kanban / flow-DAG + drawer ── */}
      <div className="flex-1 min-h-0 flex">
        {flow ? (
          <div className="flex-1 min-w-0"><TaskFlow cards={shown} status={STATUS} sel={sel} onSelect={setSel} /></div>
        ) : (
        <div className="flex-1 min-w-0 overflow-x-auto p-3 sm:p-4">
          <div className="h-full grid grid-flow-col auto-cols-[minmax(230px,1fr)] gap-3">
            {ORDER.map((s) => {
              const meta = STATUS[s]; const list = shown.filter((c) => c.status === s)
              if (s === 'failed' && list.length === 0) return null
              return (
                <div key={s} className="flex flex-col min-h-0">
                  <div className="flex items-center gap-2 mb-2.5 px-1 shrink-0">
                    <span className="h-2 w-2 rounded-full" style={{ background: meta.color, boxShadow: `0 0 8px ${meta.color}88` }} />
                    <span className="display text-[10.5px] tracking-[0.18em]" style={{ color: meta.color }}>{meta.label}</span>
                    <span className="chip !py-0 !px-1.5 text-[10px]">{list.length}</span>
                  </div>
                  <div className="flex-1 min-h-0 overflow-y-auto flex flex-col gap-2 pr-0.5">
                    {list.map((c) => {
                      const st = stageOf(c); const pr = personaOf(c)
                      const flag = c.status === 'waiting_human'
                      return (
                        <button key={c.id} onClick={() => setSel(c.id)} className="card p-3 text-left transition hover:border-cyan/40"
                          style={flag ? { borderColor: '#ff5d9e66', boxShadow: '0 0 0 1px #ff5d9e22' } : sel === c.id ? { borderColor: '#3fd3ff66' } : undefined}>
                          <div className="text-[13px] font-semibold text-ink leading-tight">{c.title}</div>
                          <div className="text-[11px] text-inkfaint mt-1.5 flex items-center gap-1.5 flex-wrap">
                            <span className="truncate">{pipeMap.get(c.pipelineId)?.name || c.pipelineId}</span>
                            {st && <span className="text-inkdim">· {st.name}</span>}
                          </div>
                          {/* B1: stepper tiến độ pipeline — thấy ngay đang ở bước nào / còn mấy bước */}
                          <Stepper stages={pipeMap.get(c.pipelineId)?.stages || []} idx={c.stageIndex} done={c.status === 'done'} color={meta.color} />
                          {(() => { const b = subBadge(c); return b ? <div className="mt-1.5 text-[10px] font-semibold leading-none" style={{ color: b.c }}>{b.t}</div> : null })()}
                          <div className="mt-2 flex items-center gap-2 text-[10.5px]">
                            {pr && <span className="flex items-center gap-1 text-inkdim">{pr.avatar ? <img src={pr.avatar} alt="" className="h-4 w-4 rounded-full object-cover" /> : <Dot s={pr.name} />} {pr.name.replace(/·.*/, '').trim()}</span>}
                            {c.status === 'working' && c.updatedAt && <span className="flex items-center gap-1 text-cyan mono"><span className="inline-block h-1.5 w-1.5 rounded-full bg-cyan animate-pulse" />{fmtElapsed(now - c.updatedAt)}</span>}
                            <span className="text-inkfaint ml-auto mono">${c.cost?.usd?.toFixed(3) ?? '0'}</span>
                          </div>
                        </button>
                      )
                    })}
                    {list.length === 0 && <div className="text-[11px] text-inkfaint/60 px-1 py-2">—</div>}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
        )}

        {/* detail drawer */}
        {selected && <Detail c={selected} stage={stageOf(selected)} persona={personaOf(selected)} pipeName={pipeMap.get(selected.pipelineId)?.name} personaMap={personaMap} onClose={() => setSel(null)} onApprove={() => approve(selected.id)} onReject={(fb) => reject(selected.id, fb)} onAnswer={(t) => answer(selected.id, t)} onRemove={() => remove(selected.id)} onActivate={() => activate(selected.id)} now={now} />}
      </div>
    </div>
  )
}

function Detail({ c, stage, persona, pipeName, personaMap, onClose, onApprove, onReject, onAnswer, onRemove, onActivate, now }: { c: AmCard; stage: any; persona: any; pipeName?: string; personaMap: Map<string, AmPersona>; onClose: () => void; onApprove: () => void; onReject: (feedback: string) => void; onAnswer: (text: string) => void; onRemove: () => void; onActivate: () => void; now: number }) {
  const [fb, setFb] = useState('')
  const [confirmDel, setConfirmDel] = useState(false)
  const meta = STATUS[c.status]
  return (
    <div className="w-[330px] sm:w-[360px] shrink-0 border-l border-line bg-panel/40 backdrop-blur flex flex-col">
      <div className="h-12 shrink-0 flex items-center gap-2 px-4 border-b border-line">
        <span className="h-2 w-2 rounded-full" style={{ background: meta.color, boxShadow: `0 0 8px ${meta.color}` }} />
        <span className="display text-[12px] tracking-[0.14em]" style={{ color: meta.color }}>{meta.label}</span>
        {(() => { const b = subBadge(c); return b ? <span className="text-[10.5px] font-semibold" style={{ color: b.c }}>{b.t}</span> : null })()}
        <button className="btn btn-icon !w-7 !h-7 ml-auto" title="Xoá card" onClick={() => setConfirmDel(true)}>🗑</button>
        <button className="btn btn-icon !w-7 !h-7" onClick={onClose}>✕</button>
      </div>
      <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-3">
        {confirmDel && (
          <div className="rounded-xl border p-3" style={{ borderColor: '#ff6b6b66', background: '#ff6b6b12' }}>
            <div className="text-[12.5px] text-ink mb-2">Xoá hẳn card <b>"{c.title}"</b>? Không hoàn tác.</div>
            <div className="flex gap-2">
              <button className="btn flex-1" style={{ borderColor: '#ff6b6b88', color: '#ff8a8a' }} onClick={onRemove}>🗑 Xoá thật</button>
              <button className="btn flex-1" onClick={() => setConfirmDel(false)}>Huỷ</button>
            </div>
          </div>
        )}
        <div className="text-[15px] font-semibold text-ink leading-tight">{c.title}</div>
        {c.brief && <div className="text-[12.5px] text-inkdim">{c.brief}</div>}

        <div className="grid grid-cols-2 gap-2 text-[11.5px]">
          <Field k="Dự án" v={c.projectId} />
          <Field k="Pipeline" v={pipeName || c.pipelineId} />
          <Field k="Stage" v={stage ? `${stage.name}${stage.gate ? ' 🔒' : ''}` : `#${c.stageIndex}`} />
          <Field k="Agent" v={persona?.name || '—'} />
          <Field k="Chi phí" v={`$${c.cost?.usd?.toFixed(4) ?? '0'}`} />
          {c.depth > 0 && <Field k="Delegate depth" v={String(c.depth)} />}
          {c.blockedBy?.length > 0 && <Field k="Đang chờ" v={`${c.blockedBy.length} ${c.blockKind === 'dep' ? 'task trước' : 'việc con'}`} />}
        </div>

        {/* đang chạy: trấn an "không chết" + đồng hồ */}
        {c.status === 'working' && (
          <div className="rounded-xl border p-3 flex items-center gap-2" style={{ borderColor: '#3fd3ff44', background: '#3fd3ff0c' }}>
            <span className="inline-block h-2 w-2 rounded-full bg-cyan animate-pulse shrink-0" />
            <span className="text-[12.5px] text-cyan mono">{c.updatedAt ? fmtElapsed(now - c.updatedAt) : ''}</span>
            <span className="text-[10.5px] text-inkfaint ml-auto text-right">agent đang chạy — kết quả hiện khi xong stage</span>
          </div>
        )}
        {c.reviewNotes && c.reviewNotes.length > 0 && (
          <div className="rounded-xl border p-3" style={{ borderColor: '#ff9d5c44', background: '#ff9d5c0c' }}>
            <div className="text-[10px] text-[#ff9d5c] tracking-[0.16em] mb-1">↩ FEEDBACK ĐÃ TRẢ LẠI</div>
            {c.reviewNotes.map((n, i) => <div key={i} className="text-[12px] text-inkdim">• {n}</div>)}
          </div>
        )}

        {/* backlog: để sau -> kích hoạt chạy */}
        {c.status === 'backlog' && (
          <button className="btn btn-primary w-full" onClick={onActivate}>▶ Chạy ngay (đang để sau)</button>
        )}

        {/* khối CẦN BẠN — decision = agent HỎI (trả lời), gate/cost = DUYỆT */}
        {c.status === 'waiting_human' && (
          <div className="rounded-xl border p-3" style={{ borderColor: '#ff5d9e55', background: '#ff5d9e10' }}>
            <div className="text-[11px] text-pink font-semibold mb-1">{c.waitKind === 'decision' ? '💬 Agent hỏi bạn' : '⛔ Cần bạn duyệt'}</div>
            <div className="text-[13px] text-ink mb-2">{c.pendingQuestion || 'Tiếp tục?'}</div>
            <textarea className="input w-full !h-auto mb-2 text-[12.5px]" rows={3}
              placeholder={c.waitKind === 'decision' ? 'Trả lời / chọn option cho agent (agent sẽ làm tiếp với câu trả lời này)…' : "Có vấn đề? Ghi yêu cầu / lỗi cần sửa rồi bấm 'Trả lại'…"}
              value={fb} onChange={(e) => setFb(e.target.value)} />
            {c.waitKind === 'decision' ? (
              <div className="flex gap-2">
                <button className="btn btn-primary flex-1" onClick={() => onAnswer(fb)} disabled={!fb.trim()}>💬 Trả lời → agent làm tiếp</button>
                <button className="btn flex-1" onClick={() => onAnswer('')} title="để agent tự quyết, chạy tiếp">Tự quyết</button>
              </div>
            ) : (
              <div className="flex gap-2">
                <button className="btn btn-primary flex-1" onClick={onApprove}>✓ Duyệt & tiếp</button>
                <button className="btn flex-1" style={{ borderColor: '#ff9d5c66', color: '#ff9d5c' }}
                  onClick={() => onReject(fb)} title="Trả card về cho agent sửa theo feedback">↩ Trả lại sửa</button>
              </div>
            )}
          </div>
        )}

        {/* V1: BÁO CÁO — đổi gì + ở đâu */}
        {c.artifacts && ((c.artifacts.files && c.artifacts.files.length > 0) || c.artifacts.diffstat) && (
          <div className="rounded-xl border border-line p-3 bg-black/20">
            <div className="text-[10px] text-grn tracking-[0.16em] mb-1.5">📋 BÁO CÁO{c.artifacts.stage ? ` · ${c.artifacts.stage}` : ''}{c.artifacts.isRepo ? ' · repo' : ''}</div>
            {c.artifacts.files && c.artifacts.files.length > 0 && (
              <div className="mb-2">
                <div className="text-[10px] text-inkfaint mb-1">{c.artifacts.files.length} file {c.artifacts.isRepo ? 'thay đổi' : 'tạo ra'}:</div>
                <div className="flex flex-col gap-0.5 max-h-40 overflow-auto">
                  {c.artifacts.files.map((f, i) => <div key={i} className="text-[11.5px] text-inkdim mono truncate">{f}</div>)}
                </div>
              </div>
            )}
            {c.artifacts.diffstat && <pre className="text-[10px] text-inkfaint mono whitespace-pre-wrap bg-black/30 rounded p-2 max-h-32 overflow-auto">{c.artifacts.diffstat}</pre>}
            <div className="text-[10px] text-inkfaint mt-2">Trên máy worker: <span className="mono text-cyan">agent-machine/{c.artifacts.isRepo ? `.worker/repos/${c.projectId.replace(/[^\w.-]+/g, '_')}` : `.worker/${c.id}`}</span></div>
          </div>
        )}

        {/* C2: BÁO CÁO AGENT — narrative đầy đủ "đã làm như nào", render Markdown, expand */}
        {c.reports && c.reports.length > 0 && <ReportLog reports={c.reports} />}

        {/* timeline */}
        <div>
          <div className="text-[10px] text-inkfaint tracking-[0.18em] mb-2">LỊCH SỬ</div>
          <div className="flex flex-col gap-1.5">
            {(c.history || []).slice().reverse().map((h, i) => (
              <div key={i} className="flex items-start gap-2 text-[11.5px]">
                <span className="mono text-[9px] text-inkfaint w-12 shrink-0 mt-0.5">{new Date(h.ts).toISOString().slice(11, 19)}</span>
                <span className="shrink-0">{EVENT_ICON[h.event] || '·'}</span>
                <span className="text-inkdim break-words">{h.event}{h.stage && h.stage !== '-' ? ` · ${h.stage}` : ''}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

function Field({ k, v }: { k: string; v: string }) {
  return <div><div className="text-[9.5px] text-inkfaint tracking-wide">{k.toUpperCase()}</div><div className="text-ink truncate">{v}</div></div>
}
// C2: log báo cáo agent — mỗi stage 1 block, render Markdown, click mở/đóng (mặc định mở cái mới nhất)
function ReportLog({ reports }: { reports: NonNullable<AmCard['reports']> }) {
  const [open, setOpen] = useState<number | null>(reports.length - 1)
  return (
    <div>
      <div className="text-[10px] text-grn tracking-[0.18em] mb-2">📝 BÁO CÁO AGENT</div>
      <div className="flex flex-col gap-2">
        {reports.slice().reverse().map((r, i) => {
          const idx = reports.length - 1 - i
          const isOpen = open === idx
          return (
            <div key={idx} className="rounded-xl border border-line bg-black/20 overflow-hidden">
              <button className="w-full flex items-center gap-2 px-3 py-2 text-left" onClick={() => setOpen(isOpen ? null : idx)}>
                <span className="text-[11.5px] font-semibold text-grn truncate">{r.persona}</span>
                <span className="text-[10px] text-inkdim shrink-0">· {r.stage}</span>
                <span className="text-[9px] text-inkfaint mono ml-auto shrink-0">{new Date(r.ts).toISOString().slice(11, 16)}</span>
                <span className="text-inkfaint text-[10px] shrink-0">{isOpen ? '▾' : '▸'}</span>
              </button>
              {isOpen && <div className="px-3 pb-3 pt-1 border-t border-line max-h-80 overflow-auto"><Markdown>{r.text}</Markdown></div>}
            </div>
          )
        })}
      </div>
    </div>
  )
}
function Dot({ s }: { s: string }) {
  const pal = ['#3fd3ff', '#5fe39a', '#ff9d5c', '#b78cff', '#46c6ec']; let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0
  return <span className="h-2 w-2 rounded-full inline-block" style={{ background: pal[h % pal.length] }} />
}
// B1: thanh tiến độ pipeline — done=xanh, current=màu status, chưa tới=xám
function Stepper({ stages, idx, done, color }: { stages: { id: string; name: string }[]; idx: number; done: boolean; color: string }) {
  if (stages.length <= 1) return null
  return (
    <div className="mt-2 flex items-center gap-1" title={`bước ${Math.min(idx + 1, stages.length)}/${stages.length}: ${stages[idx]?.name || ''}`}>
      {stages.map((s, i) => (
        <span key={s.id} className="h-1 flex-1 rounded-full" style={{ background: done || i < idx ? '#5fe39a' : i === idx ? color : 'rgba(127,179,214,0.18)' }} />
      ))}
    </div>
  )
}
function Empty({ icon, msg }: { icon: string; msg: string }) {
  return <div className="h-full grid place-items-center p-6"><div className="card p-8 text-center text-inkfaint text-sm max-w-md"><div className="text-2xl mb-2">{icon}</div>{msg}</div></div>
}
