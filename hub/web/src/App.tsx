import { useEffect, useRef, useState } from 'react'
import Login from './components/Login'
import Chat from './components/Chat'
import Tasks from './components/Tasks'
import Schedule from './components/Schedule'
import Projects from './components/Projects'
import ProjectsView from './components/ProjectsView'
import NeuralTab from './components/NeuralTab'
import Memory from './components/Memory'
import Aki from './components/Aki'
import Logs from './components/Logs'
import Settings from './components/Settings'
import Draw from './components/Draw'
import Dashboard from './components/Dashboard'
import Personas from './components/Personas'
import Connect from './components/Connect'
import Skills from './components/Skills'
import Prompts from './components/Prompts'
import AutoTask from './components/AutoTask'
import ReactorHome from './components/ReactorHome'
import Design from './components/Design'
import HudRail from './components/HudRail'
import CommandPalette, { type PaletteItem } from './components/CommandPalette'
import Vps from './components/Vps'
import { me, amState, amTrashProject, amCreateProject, promptArchStatus, type AmProject } from './api'
import { showToast } from './toast'
import { onGalaxyFocus } from './galaxyFocus'

// T2/U3: gom 13 tab → 4 nhóm. `group` quyết định nhóm hiển thị ở sidebar + palette.
// `kw` = từ khoá phụ cho Cmd+K (không dấu cũng search được nhờ normalize trong palette).
// S4/E2: trang chủ Reactor — FLAG-GATED (localStorage lucy.reactorHome, mặc định TẮT để chủ nhân duyệt vibe)
const REACTOR_TAB = { id: 'reactor', label: 'Reactor', icon: '⚛️', sub: 'Trang chủ · metric thật', group: 'Tổng quan', kw: 'home reactor trang chu hero arc' }
// CỤM B: tab Prompt Architect — chỉ chèn khi server bật flag LUCY_PROMPT_ARCHITECT (status enabled).
const PROMPTS_TAB = { id: 'prompts', label: 'Prompt Architect', icon: '🛠️', sub: 'Dựng prompt chuẩn', group: 'Trí tuệ', kw: 'prompt architect dung prompt refine meta' }

const BASE_TABS = [
  { id: 'dashboard', label: 'Dashboard', icon: '📊', sub: 'Cost · Providers · Agent Insights', group: 'Tổng quan', kw: 'home cost provider chi phi' },
  { id: 'chat', label: 'Chat', icon: '💬', sub: 'Trò chuyện & ra lệnh', group: 'Trí tuệ', kw: 'lucy hoi tro chuyen' },
  { id: 'memory', label: 'Bộ não', icon: '🧠', sub: 'Trí nhớ · recall · dream', group: 'Trí tuệ', kw: 'memory recall dream tri nho' },
  { id: 'brain', label: 'Tinh hà', icon: '🌌', sub: 'Tinh hà tri thức · Cây · Live', group: 'Trí tuệ', kw: 'galaxy neural tri thuc knowledge graph tree cay tri thuc folder vault gitnexus' },
  { id: 'personas', label: 'Experts', icon: '🧩', sub: 'Quản persona chuyên gia', group: 'Trí tuệ', kw: 'persona chuyen gia roster' },
  { id: 'workspace', label: 'Dự án', icon: '🗂️', sub: 'Kanban · Lucy · Channels', group: 'Việc', kw: 'kanban channel note' },
  { id: 'projects', label: 'Mã nguồn', icon: '📁', sub: 'Cây mã nguồn', group: 'Việc', kw: 'code repo source ma nguon' },
  { id: 'tasks', label: 'Tasks', icon: '⚙️', sub: 'Việc đang chạy', group: 'Việc', kw: 'task job running' },
  { id: 'autotask', label: 'Auto-Task', icon: '📦', sub: 'Project · sprint · research', group: 'Việc', kw: 'autotask project sprint research per-project' },
  { id: 'schedule', label: 'Schedule', icon: '🗓️', sub: 'Đặt lịch tự chạy', group: 'Việc', kw: 'cron lich schedule' },
  { id: 'connect', label: 'Kết nối', icon: '🔌', sub: 'MCP — tay của Lucy', group: 'Hệ thống', kw: 'mcp tool tay connect ket noi github notion' },
  { id: 'skills', label: 'Kỹ năng', icon: '🎯', sub: 'Thư viện skill · tự học', group: 'Hệ thống', kw: 'skill ky nang loader tu hoc proposed' },
  { id: 'draw', label: 'Draw', icon: '✏️', sub: 'Canvas vẽ tay', group: 'Hệ thống', kw: 'canvas ve draw' },
  { id: 'aki', label: 'Aki', icon: '📣', sub: 'Đẩy báo cáo Discord', group: 'Hệ thống', kw: 'discord report bao cao' },
  { id: 'vps', label: 'VPS', icon: '🖥️', sub: 'Status máy · dọn dẹp agent', group: 'Hệ thống', kw: 'vps status cpu ram disk pm2 don may cleanup' },
  { id: 'logs', label: 'Logs', icon: '📜', sub: 'Nhật ký hệ thống', group: 'Hệ thống', kw: 'log nhat ky' },
  { id: 'settings', label: 'Settings', icon: '🔐', sub: 'Bảo mật 2FA', group: 'Hệ thống', kw: 'setting 2fa bao mat' },
  { id: 'design', label: 'Design', icon: '🎨', sub: 'Design-system Cockpit v2', group: 'Hệ thống', kw: 'design system token primitive kitchen sink theme' },
]

const reactorOn = () => localStorage.getItem('lucy.reactorHome') === '1'

// thứ tự nhóm hiển thị ở sidebar
const GROUP_ORDER = ['Tổng quan', 'Trí tuệ', 'Việc', 'Hệ thống']

// S2/E1.5: bottom bar mobile — 4 Space chính + nút Menu (mở sidebar đầy đủ)
const MOBILE_TABS = ['dashboard', 'chat', 'memory', 'workspace']

export default function App() {
  // CỤM B: hỏi server flag LUCY_PROMPT_ARCHITECT → chèn tab Prompt Architect khi ON.
  const [promptsOn, setPromptsOn] = useState(false)
  // S4/E2: chèn tab Reactor lên đầu nhóm Tổng quan khi flag bật → cũng là tab mặc định
  const baseTabs = promptsOn ? [...BASE_TABS, PROMPTS_TAB] : BASE_TABS
  const TABS = reactorOn() ? [REACTOR_TAB, ...baseTabs] : baseTabs

  const [authed, setAuthed] = useState<boolean | null>(null)
  const [tab, setTab] = useState(reactorOn() ? 'reactor' : 'dashboard')
  const [open, setOpen] = useState(false)   // sidebar drawer (mobile)
  const [hudOpen, setHudOpen] = useState(false)   // S2/E1.5: HUD sheet (mobile/tablet)
  const [paletteOpen, setPaletteOpen] = useState(false)  // T2/U3 Cmd+K
  const mainRef = useRef<HTMLElement>(null)   // reset scroll khi đổi tab (chat scrollIntoView cuộn ngầm main)
  const rootRef = useRef<HTMLDivElement>(null)   // scrollIntoView cuộn tận root/body → reset cả đây

  // project list for sidebar "note list"
  const [projects, setProjects] = useState<AmProject[]>([])
  const [openProjectId, setOpenProjectId] = useState<string | null>(null)
  const [newProjName, setNewProjName] = useState('')
  const [showNewProj, setShowNewProj] = useState(false)
  const newProjRef = useRef<HTMLInputElement>(null)

  useEffect(() => { me().then((d) => setAuthed(d.authed)).catch(() => setAuthed(false)) }, [])

  // CỤM B: chỉ hiện tab Prompt Architect khi server bật flag (sau khi đã đăng nhập).
  useEffect(() => { if (authed) promptArchStatus().then((d) => setPromptsOn(!!d.enabled)).catch(() => { }) }, [authed])

  // U2: "xem trong tinh hà" từ tab Bộ não → nhảy sang tab Neural (Galaxy tự ngắm node)
  useEffect(() => onGalaxyFocus(() => { setTab('brain'); setOpen(false) }), [])

  // Reset scroll main khi đổi tab — các panel chat (mount sẵn) gọi scrollIntoView cuộn ngầm <main>
  // dù overflow-clip; vài lần delayed để bắt scrollIntoView async.
  useEffect(() => {
    const reset = () => {
      for (const el of [mainRef.current, rootRef.current, document.scrollingElement, document.body] as (Element | null)[]) {
        if (el && el.scrollTop !== 0) el.scrollTop = 0
      }
    }
    reset(); const ids = [0, 60, 200, 500, 900].map((ms) => setTimeout(reset, ms))
    return () => ids.forEach(clearTimeout)
  }, [tab])

  // T2/U3: Cmd+K (mac) / Ctrl+K (win) mở command palette
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && (e.key === 'k' || e.key === 'K')) {
        e.preventDefault()
        setPaletteOpen((v) => !v)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  useEffect(() => {
    const fetchProjects = () =>
      amState().then((s) => setProjects((s.projects || []).filter((p) => !p.trashed))).catch(() => { /* */ })
    fetchProjects()
    const iv = setInterval(fetchProjects, 5000)
    return () => clearInterval(iv)
  }, [])

  useEffect(() => {
    if (showNewProj) setTimeout(() => newProjRef.current?.focus(), 50)
  }, [showNewProj])

  if (authed === null) return <div className="h-[100dvh] grid place-items-center text-cyan mono bg-bg">…</div>
  if (!authed) return <Login onOk={() => setAuthed(true)} />

  const cur = TABS.find((t) => t.id === tab)!
  const pick = (id: string) => { setTab(id); setOpen(false) }

  // T2/U3: nguồn cho Cmd+K — mọi tab + jump nhanh tới từng dự án
  const paletteItems: PaletteItem[] = [
    ...TABS.map((t) => ({ id: t.id, label: t.label, icon: t.icon, sub: t.sub, group: t.group, keywords: t.kw, onPick: () => pick(t.id) })),
    ...projects.map((p) => ({ id: 'proj:' + p.id, label: p.name, icon: '📁', sub: 'Mở dự án', group: 'Dự án', keywords: 'project note ' + p.name, onPick: () => pickProject(p.id) })),
  ]

  const pickProject = (id: string) => {
    setOpenProjectId(id)
    setTab('workspace')
    setOpen(false)
  }

  const createProject = async () => {
    if (!newProjName.trim()) return
    try {
      await amCreateProject(newProjName.trim())
      setNewProjName('')
      setShowNewProj(false)
      const s = await amState()
      setProjects((s.projects || []).filter((p) => !p.trashed))
      showToast('Đã tạo note mới', 'success')
    } catch {
      showToast('Lỗi khi tạo note', 'error')
    }
  }

  const trashProject = async (id: string) => {
    const proj = projects.find((p) => p.id === id)
    try {
      await amTrashProject(id)
      setProjects((prev) => prev.filter((p) => p.id !== id))
      if (openProjectId === id) setOpenProjectId(null)
      showToast(`Đã xóa "${proj?.name || 'note'}"`, 'info')
    } catch {
      showToast('Lỗi khi xóa note', 'error')
    }
  }

  return (
    <div ref={rootRef} className="h-[100dvh] flex bg-bg text-ink overflow-clip">
      {/* overlay mobile — luôn render, fade in/out bằng opacity */}
      <div className={'fixed inset-0 bg-black/50 z-30 md:hidden transition-opacity duration-200 ' + (open ? 'opacity-100' : 'opacity-0 pointer-events-none')} onClick={() => setOpen(false)} />

      {/* SIDEBAR */}
      <nav
        style={{ transition: 'transform 0.25s cubic-bezier(0.4,0,0.2,1)' }}
        className={'fixed md:static z-40 inset-y-0 left-0 w-60 shrink-0 flex flex-col border-r border-line bg-panel md:bg-panel/60 backdrop-blur ' +
          (open ? 'translate-x-0' : '-translate-x-full md:translate-x-0')}>

        {/* header */}
        <div className="px-5 pt-5 pb-4 border-b border-line flex items-center gap-2.5">
          <img src="/lucy.jpg" alt="Lucy" className="h-9 w-9 rounded-full object-cover shrink-0" style={{ border: '1px solid rgba(56,208,255,0.5)', boxShadow: '0 0 12px rgba(56,208,255,.45)' }} />
          <div className="flex-1 min-w-0">
            <div className="mono text-cyan text-lg tracking-[0.42em] leading-none" style={{ textShadow: '0 0 12px rgba(56,208,255,.45)' }}>LUCY</div>
            <div className="hud-lbl mt-1">personal AI hub</div>
          </div>
          {/* close button — mobile only */}
          <button onClick={() => setOpen(false)} className="md:hidden text-inkfaint hover:text-ink transition text-lg !w-11 !h-11 flex items-center justify-center rounded" aria-label="Đóng sidebar">✕</button>
        </div>

        {/* Cmd+K trigger */}
        <div className="px-3 pt-3">
          <button onClick={() => setPaletteOpen(true)}
            className="w-full flex items-center gap-2 rounded-lg px-3 py-2 text-[12px] text-inkfaint border border-line hover:border-cyan/30 hover:text-inkdim transition-colors bg-white/[0.02]">
            <span className="text-cyan">⌘</span>
            <span className="flex-1 text-left">Đi tới…</span>
            <kbd className="text-[10px] border border-line rounded px-1.5 py-0.5 mono">⌘K</kbd>
          </button>
        </div>

        {/* nav items — gom theo nhóm (T2/U3) */}
        <div className="p-3 pt-2 flex flex-col gap-2.5">
          {GROUP_ORDER.map((grp) => {
            const items = TABS.filter((t) => t.group === grp)
            if (items.length === 0) return null
            return (
              <div key={grp} className="flex flex-col gap-0.5">
                <div className="px-3 pb-0.5 text-[9px] text-inkfaint uppercase tracking-widest">{grp}</div>
                {items.map((t) => {
                  const on = tab === t.id
                  return (
                    <button key={t.id} onClick={() => pick(t.id)}
                      className={'group relative flex items-center gap-3 rounded-xl px-3 py-2 text-left transition-colors duration-100 ' +
                        (on ? 'bg-cyan/10 text-ink' : 'text-inkdim hover:text-ink hover:bg-white/[0.05]')}>
                      {on && <span className="absolute left-0 top-1/2 -translate-y-1/2 h-5 w-[3px] rounded-r bg-cyan" style={{ boxShadow: '0 0 10px rgba(56,208,255,.8)' }} />}
                      <span className={'text-base transition-transform ' + (on ? 'scale-110' : 'opacity-70 group-hover:opacity-100')}>{t.icon}</span>
                      <span className="flex-1 min-w-0">
                        <span className={'block text-[13px] font-semibold truncate ' + (on ? 'text-cyan' : '')}>{t.label}</span>
                        <span className="block text-[10px] text-inkfaint truncate">{t.sub}</span>
                      </span>
                    </button>
                  )
                })}
              </div>
            )
          })}
        </div>

        {/* PROJECT NOTE LIST */}
        <div className="flex-1 min-h-0 flex flex-col border-t border-line overflow-hidden">
          <div className="px-4 pt-3 pb-1.5 flex items-center gap-1.5 shrink-0">
            <span className="text-[10px] text-inkfaint uppercase tracking-widest flex-1">Dự án</span>
            <button
              onClick={() => setShowNewProj((v) => !v)}
              className="text-inkfaint hover:text-cyan transition text-base leading-none w-5 h-5 flex items-center justify-center"
              title="Tạo dự án mới" aria-label="Tạo dự án mới">+</button>
          </div>

          {/* create new project inline */}
          {showNewProj && (
            <div className="px-3 pb-2 flex gap-1 shrink-0">
              <input
                ref={newProjRef}
                className="input !py-1.5 text-[12px] flex-1"
                placeholder="Tên dự án…"
                value={newProjName}
                onChange={(e) => setNewProjName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') createProject()
                  if (e.key === 'Escape') { setShowNewProj(false); setNewProjName('') }
                }}
              />
              <button className="btn btn-primary !py-1 !text-[11px] shrink-0" onClick={createProject} disabled={!newProjName.trim()}>Tạo</button>
            </div>
          )}

          {/* project list */}
          <div className="flex-1 overflow-y-auto px-2 pb-3">
            {projects.length === 0 && !showNewProj ? (
              <div className="py-8 flex flex-col items-center gap-2 text-center px-3">
                <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-inkfaint opacity-40 shrink-0">
                  <path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"/>
                  <polyline points="14 2 14 8 20 8"/>
                  <line x1="16" y1="13" x2="8" y2="13"/>
                  <line x1="16" y1="17" x2="8" y2="17"/>
                  <line x1="10" y1="9" x2="8" y2="9"/>
                </svg>
                <div className="text-[13px] font-medium text-inkdim leading-snug">Chưa có note nào</div>
                <div className="text-[11px] text-inkfaint leading-snug">Nhấn + để tạo note đầu tiên</div>
                <button className="btn btn-primary !py-1.5 !px-4 !text-[12px] mt-1" onClick={() => setShowNewProj(true)}>Tạo note</button>
              </div>
            ) : (
              projects.map((p, idx) => {
                const isActive = tab === 'workspace' && openProjectId === p.id
                return (
                  <div
                    key={p.id}
                    onClick={() => pickProject(p.id)}
                    style={{ animationDelay: `${idx * 30}ms` }}
                    className={'note-item group relative flex items-center gap-2 rounded-lg px-2 py-1.5 min-h-[44px] cursor-pointer transition-colors duration-100 select-none ' +
                      (isActive ? 'bg-cyan/10' : 'hover:bg-white/[0.05]')}>
                    {isActive && <span className="absolute left-0 top-1/2 -translate-y-1/2 h-4 w-[2px] rounded-r bg-cyan" style={{ boxShadow: '0 0 8px rgba(56,208,255,.7)' }} />}
                    <span className="text-sm shrink-0 opacity-80">📁</span>
                    <span className={'text-[12px] truncate flex-1 ' + (isActive ? 'text-cyan font-medium' : 'text-inkdim group-hover:text-ink')}>{p.name}</span>
                    {p.repoUrl && <span className="chip !py-0 !px-1 !text-[9px] text-cyan shrink-0 opacity-70 group-hover:opacity-100">repo</span>}
                    <button
                      className="shrink-0 text-inkfaint hover:text-pink opacity-0 group-hover:opacity-100 transition text-[12px] w-5 h-5 flex items-center justify-center rounded"
                      title="Xoá dự án" aria-label={'Xoá dự án ' + p.name}
                      onClick={(e) => { e.stopPropagation(); trashProject(p.id) }}>
                      🗑
                    </button>
                  </div>
                )
              })
            )}
          </div>
        </div>

        {/* status bar */}
        <div className="p-4 border-t border-line flex items-center gap-2 text-[11px] text-inkdim shrink-0">
          <span className="h-2 w-2 rounded-full bg-grn" style={{ boxShadow: '0 0 8px #5fe39a' }} />
          online · claude engine
        </div>
      </nav>

      {/* MAIN */}
      <main ref={mainRef} className="flex-1 min-w-0 min-h-0 flex flex-col overflow-clip">
        <header className="h-14 shrink-0 flex items-center justify-between px-4 sm:px-6 border-b border-line bg-panel/30">
          <div className="flex items-center gap-3 min-w-0">
            <button onClick={() => setOpen(true)} className="btn btn-icon md:hidden !w-11 !h-11 shrink-0" aria-label="Mở menu điều hướng">☰</button>
            <span className="text-lg shrink-0">{cur.icon}</span>
            <div className="min-w-0">
              <div className="display text-sm tracking-[0.18em] text-ink leading-none truncate">{cur.label.toUpperCase()}</div>
              <div className="text-[11px] text-inkfaint mt-0.5 truncate">{cur.sub}</div>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <span className="chip"><span className="h-1.5 w-1.5 rounded-full bg-cyan" /> Lucy</span>
            {/* S2/E1.5: mở HUD (mobile/tablet — desktop HUD luôn ở cột phải) */}
            <button onClick={() => setHudOpen(true)} className="btn btn-icon lg:hidden !w-9 !h-9" aria-label="Mở bảng HUD hoạt động" title="HUD · hoạt động">📡</button>
          </div>
        </header>

        <section className="flex-1 min-h-0 relative">
          {reactorOn() && (
            <div className={'absolute inset-0 transition-opacity duration-150 ' + (tab === 'reactor' ? '' : 'opacity-0 pointer-events-none')}><ReactorHome visible={tab === 'reactor'} onNavigate={pick} /></div>
          )}
          <div className={'absolute inset-0 transition-opacity duration-150 ' + (tab === 'dashboard' ? '' : 'opacity-0 pointer-events-none')}><Dashboard /></div>
          <div className={'absolute inset-0 transition-opacity duration-150 ' + (tab === 'chat' ? '' : 'opacity-0 pointer-events-none')}><Chat /></div>
          <div className={'absolute inset-0 transition-opacity duration-150 ' + (tab === 'workspace' ? '' : 'opacity-0 pointer-events-none')}>
            <ProjectsView openProjectId={openProjectId} onOpenProjectChange={setOpenProjectId} />
          </div>
          <div className={'absolute inset-0 transition-opacity duration-150 ' + (tab === 'memory' ? '' : 'opacity-0 pointer-events-none')}><Memory visible={tab === 'memory'} /></div>
          <div className={'absolute inset-0 transition-opacity duration-150 ' + (tab === 'tasks' ? '' : 'opacity-0 pointer-events-none')}><Tasks /></div>
          <div className={'absolute inset-0 transition-opacity duration-150 ' + (tab === 'schedule' ? '' : 'opacity-0 pointer-events-none')}><Schedule /></div>
          <div className={'absolute inset-0 transition-opacity duration-150 ' + (tab === 'projects' ? '' : 'opacity-0 pointer-events-none')}><Projects /></div>
          <div className={'absolute inset-0 transition-opacity duration-150 ' + (tab === 'brain' ? '' : 'opacity-0 pointer-events-none')}><NeuralTab visible={tab === 'brain'} /></div>
          <div className={'absolute inset-0 transition-opacity duration-150 ' + (tab === 'personas' ? '' : 'opacity-0 pointer-events-none')}><Personas /></div>
          <div className={'absolute inset-0 transition-opacity duration-150 ' + (tab === 'connect' ? '' : 'opacity-0 pointer-events-none')}><Connect /></div>
          <div className={'absolute inset-0 transition-opacity duration-150 ' + (tab === 'skills' ? '' : 'opacity-0 pointer-events-none')}><Skills /></div>
          {promptsOn && <div className={'absolute inset-0 transition-opacity duration-150 ' + (tab === 'prompts' ? '' : 'opacity-0 pointer-events-none')}><Prompts /></div>}
          <div className={'absolute inset-0 transition-opacity duration-150 ' + (tab === 'draw' ? '' : 'opacity-0 pointer-events-none')}><Draw /></div>
          <div className={'absolute inset-0 transition-opacity duration-150 ' + (tab === 'aki' ? '' : 'opacity-0 pointer-events-none')}><Aki /></div>
          <div className={'absolute inset-0 transition-opacity duration-150 ' + (tab === 'autotask' ? '' : 'opacity-0 pointer-events-none')}><AutoTask /></div>
          <div className={'absolute inset-0 transition-opacity duration-150 ' + (tab === 'vps' ? '' : 'opacity-0 pointer-events-none')}><Vps visible={tab === 'vps'} /></div>
          <div className={'absolute inset-0 transition-opacity duration-150 ' + (tab === 'logs' ? '' : 'opacity-0 pointer-events-none')}><Logs /></div>
          <div className={'absolute inset-0 transition-opacity duration-150 ' + (tab === 'settings' ? '' : 'opacity-0 pointer-events-none')}><Settings /></div>
          <div className={'absolute inset-0 transition-opacity duration-150 ' + (tab === 'design' ? '' : 'opacity-0 pointer-events-none')}><Design /></div>
        </section>

        {/* S2/E1.5: bottom bar — chỉ mobile (md:hidden), 4 Space chính + Menu */}
        <nav className="md:hidden shrink-0 flex items-stretch border-t border-line bg-panel/80 backdrop-blur" style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}>
          {MOBILE_TABS.map((id) => {
            const t = TABS.find((x) => x.id === id)!
            const on = tab === id
            return (
              <button key={id} onClick={() => pick(id)}
                className={'flex-1 flex flex-col items-center justify-center gap-0.5 py-2 min-h-[52px] transition-colors ' + (on ? 'text-cyan' : 'text-inkfaint')}>
                <span className={'text-lg leading-none ' + (on ? 'scale-110' : '')}>{t.icon}</span>
                <span className="text-[9px] font-medium">{t.label}</span>
              </button>
            )
          })}
          <button onClick={() => setOpen(true)}
            className="flex-1 flex flex-col items-center justify-center gap-0.5 py-2 min-h-[52px] text-inkfaint transition-colors">
            <span className="text-lg leading-none">☰</span>
            <span className="text-[9px] font-medium">Menu</span>
          </button>
        </nav>
      </main>

      {/* S2/E1.4 — HUD panel phải (context-aware) */}
      <HudRail tabId={cur.id} label={cur.label} sub={cur.sub} icon={cur.icon} mobileOpen={hudOpen} onMobileClose={() => setHudOpen(false)} />

      {/* T2/U3 — command palette */}
      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} items={paletteItems} />
    </div>
  )
}
