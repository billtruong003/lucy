// ProjectsView — mỗi dự án là 1 container: list/dashboard -> click vào workspace
// (3 tab: Kanban / Lucy / Channels). Repo URL -> agent clone & sửa repo thật.
import { useEffect, useMemo, useState } from 'react'
import { amState, amCreateProject, amTrashProject, amRestoreProject, amPurgeProject, type AmProject, type AmCard, type AmPipeline, type AmPersona, type AmMsg } from '../api'
import Board from './Board'
import Channels from './Channels'
import LucyChat from './LucyChat'
import FlowEditor from './FlowEditor'
import Mindmap from './Mindmap'
import Draw from './Draw'
import NoteEditor from './NoteEditor'

export default function ProjectsView({ openProjectId, onOpenProjectChange }: { openProjectId?: string | null; onOpenProjectChange?: (id: string | null) => void }) {
  const [projects, setProjects] = useState<AmProject[]>([])
  const [cards, setCards] = useState<AmCard[]>([])
  const [pipes, setPipes] = useState<AmPipeline[]>([])
  const [personas, setPersonas] = useState<AmPersona[]>([])
  const [channels, setChannels] = useState<AmMsg[]>([])
  const [active, setActive] = useState<string | null>(null)
  const [tab, setTab] = useState<'kanban' | 'lucy' | 'channels' | 'flow' | 'mindmap' | 'draw' | 'notes'>('kanban')
  const [configured, setConfigured] = useState(true)
  const [nf, setNf] = useState({ open: false, name: '', repoUrl: '', desc: '', skill: '' })
  const [showTrash, setShowTrash] = useState(false)

  const pull = async () => {
    try { const s = await amState(); setConfigured(s.configured !== false); setProjects(s.projects || []); setCards(s.cards || []); setPipes(s.pipelines || []); setPersonas(s.personas || []); setChannels(s.channels || []) } catch { /* */ }
  }
  useEffect(() => { pull(); const iv = setInterval(pull, 3000); return () => clearInterval(iv) }, [])

  // sync sidebar project selection → open that project
  useEffect(() => { if (openProjectId) setActive(openProjectId) }, [openProjectId])

  // dashboard per-project: đếm status + kinh phí + số agent tham gia
  const stats = useMemo(() => {
    const m = new Map<string, { total: number; cost: number; agents: Set<string>; byStatus: Record<string, number> }>()
    const get = (pid: string) => { let r = m.get(pid); if (!r) { r = { total: 0, cost: 0, agents: new Set(), byStatus: {} }; m.set(pid, r) } return r }
    for (const c of cards) { const r = get(c.projectId || 'default'); r.byStatus[c.status] = (r.byStatus[c.status] || 0) + 1; r.total++; r.cost += c.cost?.usd || 0 }
    const cardProj = new Map(cards.map((c) => ['card-' + c.id, c.projectId || 'default'] as const))
    for (const msg of channels) { const pid = cardProj.get(msg.channel); if (pid && msg.author !== 'engine' && msg.author !== 'bill') get(pid).agents.add(msg.author) }
    return m
  }, [cards, channels])

  const active_ = projects.filter((p) => !p.trashed)
  const trashed = projects.filter((p) => p.trashed)

  const createProject = async () => { if (!nf.name.trim()) return; await amCreateProject(nf.name.trim(), { repoUrl: nf.repoUrl.trim() || undefined, description: nf.desc.trim() || undefined, skill: nf.skill.trim() || undefined }); setNf({ open: false, name: '', repoUrl: '', desc: '', skill: '' }); pull() }
  const trashProject = async (id: string) => { await amTrashProject(id); pull() }
  const restoreProject = async (id: string) => { await amRestoreProject(id); pull() }
  const purgeProject = async (id: string) => { await amPurgeProject(id); pull() }

  if (configured === false) return <div className="h-full grid place-items-center text-inkfaint text-sm p-6">Agent-Machine chưa cấu hình — đặt AM_COORD_URL + AM_TOKEN cho hub server.</div>

  // ── WORKSPACE 1 dự án ──
  const proj = projects.find((p) => p.id === active)
  if (active && proj) {
    const TABS = [{ k: 'kanban', icon: '📋', label: 'Kanban' }, { k: 'lucy', icon: '✨', label: 'Lucy' }, { k: 'channels', icon: '💬', label: 'Channels' }, { k: 'flow', icon: '🧩', label: 'Flow' }, { k: 'mindmap', icon: '🗺', label: 'Mindmap' }, { k: 'draw', icon: '🎨', label: 'Draw' }, { k: 'notes', icon: '📝', label: 'Notes' }] as const
    const s = stats.get(proj.id)
    return (
      <div className="h-full flex flex-col overflow-hidden">
        <div className="shrink-0 border-b border-line bg-panel/30">
          {/* row 1: back + name + trash */}
          <div className="flex items-center gap-2 px-4 pt-2 pb-1.5">
            <button className="btn btn-icon !w-8 !h-8 shrink-0" title="về danh sách dự án" onClick={() => { setActive(null); onOpenProjectChange?.(null) }}>←</button>
            <span className="text-lg shrink-0">📁</span>
            <div className="min-w-0 flex-1">
              <div className="text-[14px] font-semibold text-ink truncate leading-tight">{proj.name}</div>
              {proj.repoUrl ? <a href={proj.repoUrl} target="_blank" rel="noreferrer" className="text-[10px] text-cyan hover:underline truncate block">{proj.repoUrl}</a> : <div className="text-[10px] text-inkfaint">workspace nháp (chưa gắn repo)</div>}
            </div>
            <button className="btn btn-icon !w-8 !h-8 shrink-0" title="ném dự án vào thùng rác" onClick={() => { trashProject(proj.id); setActive(null); onOpenProjectChange?.(null) }}>🗑</button>
          </div>
          {/* row 2: tabs */}
          <div className="tabs">
            {TABS.map((t) => (
              <button key={t.k} onClick={() => setTab(t.k)} className={'tab-btn ' + (tab === t.k ? 'active' : '')}>
                <span className="tab-icon">{t.icon}</span>
                <span>{t.label}</span>
              </button>
            ))}
          </div>
          {/* row 3: dashboard strip */}
          <div className="px-4 pb-2 flex items-center gap-1.5 flex-wrap">
            {proj.description && <span className="text-[11px] text-inkdim truncate max-w-[45%] mr-1" title={proj.description}>{proj.description}</span>}
            <Stat v={s?.total || 0} label="task" />
            {s?.byStatus.working ? <Stat v={s.byStatus.working} label="chạy" color="#3fd3ff" /> : null}
            {s?.byStatus.waiting_human ? <Stat v={s.byStatus.waiting_human} label="cần duyệt" color="#ff5d9e" /> : null}
            {s?.byStatus.done ? <Stat v={s.byStatus.done} label="xong" color="#5fe39a" /> : null}
            {s?.byStatus.failed ? <Stat v={s.byStatus.failed} label="lỗi" color="#ff6b6b" /> : null}
            <span className="chip !py-0.5 !text-[11px]"><b className="text-grn">${(s?.cost || 0).toFixed(3)}</b><span className="text-inkfaint ml-1">kinh phí</span></span>
            <span className="chip !py-0.5 !text-[11px]"><b className="text-cyan">{s?.agents.size || 0}</b><span className="text-inkfaint ml-1">agent tham gia</span></span>
          </div>
        </div>
        {/* giữ MOUNTED cả tab, ẩn bằng opacity+visibility -> đổi tab không mất state */}
        <div className="flex-1 min-h-0 relative">
          <div className={'absolute inset-0 transition-opacity duration-150 ' + (tab === 'kanban' ? '' : 'opacity-0 invisible pointer-events-none')}><Board projectId={proj.id} /></div>
          <div className={'absolute inset-0 transition-opacity duration-150 ' + (tab === 'lucy' ? '' : 'opacity-0 invisible pointer-events-none')}><LucyChat key={proj.id} project={proj.id} pipes={pipes} onCreated={pull} /></div>
          <div className={'absolute inset-0 transition-opacity duration-150 ' + (tab === 'channels' ? '' : 'opacity-0 invisible pointer-events-none')}><Channels projectId={proj.id} /></div>
          <div className={'absolute inset-0 transition-opacity duration-150 ' + (tab === 'flow' ? '' : 'opacity-0 invisible pointer-events-none')}><FlowEditor pipes={pipes} personas={personas} onChanged={pull} /></div>
          <div className={'absolute inset-0 transition-opacity duration-150 ' + (tab === 'mindmap' ? '' : 'opacity-0 invisible pointer-events-none')}><Mindmap key={proj.id} projectId={proj.id} /></div>
          <div className={'absolute inset-0 transition-opacity duration-150 ' + (tab === 'draw' ? '' : 'opacity-0 invisible pointer-events-none')}><Draw key={proj.id} projectId={proj.id} /></div>
          <div className={'absolute inset-0 transition-opacity duration-150 ' + (tab === 'notes' ? '' : 'opacity-0 invisible pointer-events-none')}><NoteEditor key={proj.id} projectId={proj.id} /></div>
        </div>
      </div>
    )
  }

  // ── DANH SÁCH dự án / empty states ──
  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* header */}
      <div className="shrink-0 border-b border-line bg-panel/30 px-4 py-2.5 flex items-center gap-2.5 flex-wrap">
        <div className="display text-[14px] tracking-[0.14em] text-ink">DỰ ÁN</div>
        <span className="text-[11px] text-inkfaint">{active_.length} dự án</span>
        {trashed.length > 0 && (
          <button className={'chip !text-[11px] ' + (showTrash ? '!text-pink !border-pink/40' : 'text-inkdim hover:text-ink')} onClick={() => setShowTrash((v) => !v)}>
            🗑 Thùng rác {trashed.length}
          </button>
        )}
        <button className="btn btn-primary ml-auto !py-1.5 !px-3 !text-[12px]" onClick={() => setNf({ ...nf, open: !nf.open })}>
          {nf.open ? 'Đóng' : '+ Dự án'}
        </button>
      </div>

      {/* scrollable area (trash + create form + main content) */}
      <div className="flex-1 min-h-0 overflow-auto">
        <div className="p-4 sm:p-6 flex flex-col gap-4 min-h-full">
          {showTrash && trashed.length > 0 && (
            <div className="card p-3" style={{ borderColor: '#ff5d9e33' }}>
              <div className="text-[11px] text-pink mb-2">🗑 Thùng rác — khôi phục, hoặc <b>xoá HẲN</b> (mất sạch card + workspace trên VPS, không hoàn tác)</div>
              <div className="flex flex-col gap-1.5">
                {trashed.map((p) => (
                  <div key={p.id} className="flex items-center gap-2 text-[12.5px]">
                    <span className="text-inkdim flex-1 truncate">📁 {p.name}{p.repoUrl ? ' · repo' : ''}</span>
                    <button className="btn !py-1 !text-[11px]" onClick={() => restoreProject(p.id)}>Khôi phục</button>
                    <button className="btn !py-1 !text-[11px]" style={{ borderColor: '#ff6b6b66', color: '#ff8a8a' }} onClick={() => { if (confirm(`Xoá HẲN dự án "${p.name}"? Mất sạch card + workspace, KHÔNG hoàn tác.`)) purgeProject(p.id) }}>🔥 Xoá hẳn</button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {nf.open && (
            <div className="card modal-card p-3 flex flex-col gap-2">
              <div className="flex flex-col sm:flex-row gap-2">
                <input className="input sm:!w-56" placeholder="Tên dự án…" value={nf.name} onChange={(e) => setNf({ ...nf, name: e.target.value })} autoFocus />
                <input className="input flex-1" placeholder="Repo URL (tuỳ chọn — agent sẽ CLONE & sửa repo thật)" value={nf.repoUrl} onChange={(e) => setNf({ ...nf, repoUrl: e.target.value })} />
                <button className="btn btn-primary shrink-0" onClick={createProject}>Tạo</button>
              </div>
              <input className="input w-full" placeholder="Mô tả / mục tiêu dự án (tuỳ chọn)" value={nf.desc} onChange={(e) => setNf({ ...nf, desc: e.target.value })} />
              <textarea className="input w-full !h-auto text-[12px]" rows={3} placeholder="SKILL dự án (tuỳ chọn) — dán nguyên SKILL.md domain (vd Unity/Colyseus) để MỌI agent dự án này thành chuyên gia…" value={nf.skill} onChange={(e) => setNf({ ...nf, skill: e.target.value })} />
            </div>
          )}

          {/* empty state: no notes */}
          {active_.length === 0 && !nf.open && (
            <div className="flex-1 flex flex-col items-center justify-center gap-3 text-center py-16">
              <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-inkfaint opacity-40">
                <path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"/>
                <polyline points="14 2 14 8 20 8"/>
                <line x1="16" y1="13" x2="8" y2="13"/>
                <line x1="16" y1="17" x2="8" y2="17"/>
                <line x1="10" y1="9" x2="8" y2="9"/>
              </svg>
              <div className="text-lg text-inkdim font-medium">Chưa có note nào</div>
              <div className="text-sm text-inkfaint">Nhấn + để tạo note đầu tiên</div>
              <button className="btn btn-primary mt-1" onClick={() => setNf({ ...nf, open: true })}>Tạo note</button>
            </div>
          )}

          {/* no note selected placeholder */}
          {active_.length > 0 && !nf.open && (
            <div className="flex flex-col items-center gap-2 py-4 text-center">
              <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.2" className="text-inkfaint" style={{ opacity: 0.3 }}>
                <path d="M2 6h4"/><path d="M2 10h4"/><path d="M2 14h4"/><path d="M2 18h4"/>
                <rect width="16" height="20" x="4" y="2" rx="2"/>
                <path d="M16 2v20"/>
              </svg>
              <div className="text-[13px] text-inkfaint">Chọn note để bắt đầu</div>
            </div>
          )}

          {/* project grid */}
          {active_.length > 0 && (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {active_.map((p, idx) => {
                const s = stats.get(p.id)
                return (
                  <div key={p.id} style={{ animationDelay: `${idx * 30}ms` }} className="note-item card p-4 text-left hover:border-cyan/40 transition cursor-pointer group" onClick={() => { setActive(p.id); setTab('kanban') }}>
                    <div className="flex items-center gap-2">
                      <span className="text-lg shrink-0">📁</span>
                      <span className="text-[14px] font-semibold text-ink truncate">{p.name}</span>
                      {p.repoUrl && <span className="chip !py-0 !px-1.5 !text-[9px] text-cyan shrink-0">repo</span>}
                      <button className="text-inkfaint hover:text-pink text-[13px] ml-auto shrink-0 opacity-0 group-hover:opacity-100 transition" title="ném vào thùng rác" onClick={(e) => { e.stopPropagation(); trashProject(p.id) }}>🗑</button>
                    </div>
                    {p.repoUrl && <div className="text-[10px] text-inkfaint truncate mt-1">{p.repoUrl}</div>}
                    {p.description && <div className="text-[11px] text-inkdim mt-1.5" style={{ display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{p.description}</div>}
                    <div className="flex items-center gap-1.5 mt-3 flex-wrap">
                      <Stat v={s?.total || 0} label="task" />
                      {s?.byStatus.working ? <Stat v={s.byStatus.working} label="chạy" color="#3fd3ff" /> : null}
                      {s?.byStatus.waiting_human ? <Stat v={s.byStatus.waiting_human} label="cần duyệt" color="#ff5d9e" /> : null}
                      {s?.byStatus.done ? <Stat v={s.byStatus.done} label="xong" color="#5fe39a" /> : null}
                      {s && s.cost > 0 ? <span className="chip !py-0.5 !text-[10px]"><b className="text-grn">${s.cost.toFixed(2)}</b></span> : null}
                      {s && s.agents.size > 0 ? <span className="chip !py-0.5 !text-[10px]"><b className="text-cyan">{s.agents.size}</b><span className="text-inkfaint ml-0.5">agent</span></span> : null}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function Stat({ v, label, color }: { v: number; label: string; color?: string }) {
  return <span className="chip !py-0.5 !text-[11px]"><b style={{ color: color || '#cfe0ee' }}>{v}</b> <span className="text-inkfaint ml-0.5">{label}</span></span>
}
