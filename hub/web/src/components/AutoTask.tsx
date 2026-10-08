import { useEffect, useState, useCallback } from 'react'

// ATH-5: Auto-Task Hub tab — project grid + detail view (read-only)
// Build Hub: thêm panels auto-build + auto-build-free status (Build Hub yêu cầu Bill 2026-06-18)

type ATProject = {
  slug: string; title: string; status: string
  sprint_count: number; queued: number; done: number; failed: number
  total_usd: number; last_run: string | null; latest_research_date: string | null
}

type ATTaskItem = { id: string; title: string }
type ATResearch = { date: string; excerpt: string }
type ATSprint = { n: number; summary: string; usd: number }

type ATDetail = {
  project: Record<string, string>
  state: { sprint_count?: number; last_run?: string; total_usd?: number }
  research: ATResearch[]
  tasks: { queue: ATTaskItem[]; doing: ATTaskItem[]; done: ATTaskItem[]; failed: ATTaskItem[] }
  sprints: ATSprint[]
}

async function fetchProjects(): Promise<ATProject[]> {
  const r = await fetch('/api/autotask/projects')
  const d = await r.json()
  return d.projects || []
}

async function fetchDetail(slug: string): Promise<ATDetail | null> {
  const r = await fetch(`/api/autotask/projects/${encodeURIComponent(slug)}`)
  if (!r.ok) return null
  return r.json()
}

const statusColor = (s: string) => s === 'done' ? 'text-inkfaint' : s === 'paused' ? 'text-gold' : 'text-grn'
const statusIcon = (s: string) => s === 'done' ? '✅' : s === 'paused' ? '⏸️' : '🟢'

function ProjectCard({ p, onClick }: { p: ATProject; onClick: () => void }) {
  return (
    <button onClick={onClick} className="glass text-left w-full hover:border-lime/40 transition-colors">
      <div className="px-4 py-3 flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-sm">{statusIcon(p.status)}</span>
            <span className="text-[13px] font-semibold text-ink truncate">{p.title}</span>
          </div>
          <div className="text-[11px] text-inkfaint mono truncate">{p.slug}</div>
        </div>
        <span className={`text-[11px] font-medium shrink-0 ${statusColor(p.status)}`}>{p.status}</span>
      </div>
      <div className="px-4 pb-3 grid grid-cols-4 gap-2">
        <div className="text-center">
          <div className="num text-[15px] text-lime font-bold">{p.sprint_count}</div>
          <div className="hud-lbl">sprints</div>
        </div>
        <div className="text-center">
          <div className="num text-[15px] text-ink font-bold">{p.done}</div>
          <div className="hud-lbl">done</div>
        </div>
        <div className="text-center">
          <div className="num text-[15px] text-inkdim font-bold">{p.queued}</div>
          <div className="hud-lbl">queue</div>
        </div>
        <div className="text-center">
          <div className="num text-[15px] text-gold font-bold">${p.total_usd.toFixed(3)}</div>
          <div className="hud-lbl">cost</div>
        </div>
      </div>
      {p.latest_research_date && (
        <div className="px-4 pb-2.5 text-[10px] text-inkfaint">
          📄 research: {p.latest_research_date}
          {p.last_run && <span className="ml-2">· last: {p.last_run.slice(0, 10)}</span>}
        </div>
      )}
    </button>
  )
}

function DetailView({ slug, onBack }: { slug: string; onBack: () => void }) {
  const [detail, setDetail] = useState<ATDetail | null>(null)
  const [openResearch, setOpenResearch] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    setLoading(true)
    fetchDetail(slug).then((d) => { setDetail(d); setLoading(false) }).catch(() => setLoading(false))
  }, [slug])

  if (loading) return (
    <div className="flex-1 flex items-center justify-center text-inkfaint text-[13px]">đang tải…</div>
  )
  if (!detail) return (
    <div className="flex-1 flex items-center justify-center text-inkfaint text-[13px]">Không tải được detail</div>
  )

  const { project, state, research, tasks, sprints } = detail

  return (
    <div className="flex-1 min-h-0 overflow-y-auto p-4 sm:p-6">
      {/* header */}
      <div className="flex items-center gap-3 mb-5">
        <button onClick={onBack} className="btn btn-icon !w-8 !h-8 text-inkfaint hover:text-ink">←</button>
        <div>
          <div className="text-[15px] font-bold text-ink">{project.title || slug}</div>
          <div className="text-[11px] text-inkfaint">{project.goal}</div>
        </div>
      </div>

      {/* stats */}
      <div className="glass px-4 py-3 mb-4 flex flex-wrap gap-5">
        {[
          ['sprints', state.sprint_count ?? 0, 'text-lime'],
          ['done', tasks.done.length, 'text-grn'],
          ['queue', tasks.queue.length, 'text-inkdim'],
          ['failed', tasks.failed.length, 'text-red-400'],
        ].map(([lbl, val, cls]) => (
          <div key={lbl as string} className="text-center min-w-[52px]">
            <div className={`num text-[18px] font-bold ${cls}`}>{val}</div>
            <div className="hud-lbl">{lbl}</div>
          </div>
        ))}
        <div className="text-center min-w-[70px]">
          <div className="num text-[18px] font-bold text-gold">${(state.total_usd ?? 0).toFixed(4)}</div>
          <div className="hud-lbl">total $</div>
        </div>
        {state.last_run && (
          <div className="text-center min-w-[70px]">
            <div className="num text-[11px] text-inkdim pt-1">{state.last_run.slice(0, 10)}</div>
            <div className="hud-lbl">last run</div>
          </div>
        )}
      </div>

      <div className="grid md:grid-cols-2 gap-4">
        {/* Research history */}
        <div>
          <div className="text-[11px] text-inkfaint uppercase tracking-wider mb-2">📄 Research</div>
          {research.length === 0 ? (
            <div className="glass px-3 py-4 text-[12px] text-inkfaint text-center">Chưa có research</div>
          ) : (
            <div className="flex flex-col gap-2">
              {research.map((r) => (
                <div key={r.date} className="glass overflow-hidden">
                  <button className="w-full px-3 py-2 flex items-center justify-between text-left"
                    onClick={() => setOpenResearch(openResearch === r.date ? null : r.date)}>
                    <span className="text-[12px] font-medium text-lime">{r.date}</span>
                    <span className="text-inkfaint text-[11px]">{openResearch === r.date ? '▾' : '▸'}</span>
                  </button>
                  {openResearch === r.date && (
                    <div className="px-3 pb-3 text-[11px] text-inkdim border-t border-line pt-2 whitespace-pre-wrap font-mono">
                      {r.excerpt}…
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Sprints */}
        <div>
          <div className="text-[11px] text-inkfaint uppercase tracking-wider mb-2">⚡ Sprints</div>
          {sprints.length === 0 ? (
            <div className="glass px-3 py-4 text-[12px] text-inkfaint text-center">Chưa có sprint</div>
          ) : (
            <div className="flex flex-col gap-2">
              {sprints.map((s) => (
                <div key={s.n} className="glass px-3 py-2.5">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-[12px] font-semibold text-ink">Sprint #{s.n}</span>
                    <span className="num text-[11px] text-gold">${s.usd.toFixed(4)}</span>
                  </div>
                  <div className="text-[10px] text-inkfaint truncate">{s.summary}</div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Task lists */}
      <div className="mt-4 grid sm:grid-cols-2 md:grid-cols-4 gap-3">
        {([['queue', tasks.queue, 'text-inkdim', '⏳'],
           ['doing', tasks.doing, 'text-lime', '⚙️'],
           ['done', tasks.done, 'text-grn', '✅'],
           ['failed', tasks.failed, 'text-red-400', '❌']] as const).map(([col, list, cls, icon]) => (
          <div key={col}>
            <div className={`text-[10px] uppercase tracking-wider mb-1.5 flex items-center gap-1 ${cls}`}>
              <span>{icon}</span>{col} ({list.length})
            </div>
            <div className="flex flex-col gap-1">
              {list.length === 0 ? (
                <div className="text-[11px] text-inkfaint px-2">—</div>
              ) : list.map((t) => (
                <div key={t.id} className="glass !border-0 bg-white/[0.03] px-2 py-1.5">
                  <div className="text-[11px] text-ink truncate">{t.title || t.id}</div>
                  <div className="text-[9px] text-inkfaint mono truncate">{t.id}</div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

// ─── Build Hub types + component ─────────────────────────────────────────────
type BuildStatus = {
  running: boolean; lastTs: string; logTail: string[]
  currentTask?: string; sprintEnd?: string
}

async function fetchBuildStatus(tool: 'autobuild' | 'autobuild-free' | 'auto-task'): Promise<BuildStatus> {
  const r = await fetch(`/api/${tool}/status`)
  if (!r.ok) throw new Error(`HTTP ${r.status}`)
  return r.json()
}

function BuildStatusCard({ title, icon, tool, model }: {
  title: string; icon: string; tool: 'autobuild' | 'autobuild-free' | 'auto-task'; model: string
}) {
  const [st, setSt] = useState<BuildStatus | null>(null)
  const [err, setErr] = useState('')
  const [showLog, setShowLog] = useState(false)

  const reload = useCallback(() => {
    fetchBuildStatus(tool).then(setSt).catch((e) => setErr(String(e)))
  }, [tool])

  useEffect(() => {
    reload()
    const id = setInterval(reload, 8000)
    return () => clearInterval(id)
  }, [reload])

  const running = st?.running
  const currentTask = st?.currentTask?.match(/--- task (.+?) ---/)?.[1]
  const sprintDone = st?.sprintEnd?.match(/SPRINT END: (.+)/)?.[1]

  return (
    <div className={`glass border transition-colors ${running ? 'border-lime/30' : 'border-white/10'}`}>
      <div className="px-4 py-3 flex items-center gap-3">
        <span className="text-xl">{icon}</span>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-[13px] font-semibold text-ink">{title}</span>
            <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${running ? 'bg-lime/20 text-lime' : 'bg-white/10 text-inkfaint'}`}>
              {running ? '● RUNNING' : '○ idle'}
            </span>
          </div>
          <div className="text-[11px] text-inkfaint mono mt-0.5">{model}</div>
        </div>
        <button onClick={reload} className="text-inkfaint hover:text-lime text-[13px]">↻</button>
      </div>

      {err && <div className="px-4 pb-2 text-[11px] text-red-400">{err}</div>}

      {st && (
        <div className="px-4 pb-3 space-y-1.5">
          {currentTask && (
            <div className="text-[11px] text-gold">
              ▶ {currentTask}
            </div>
          )}
          {sprintDone && !running && (
            <div className="text-[11px] text-grn">✓ {sprintDone}</div>
          )}
          {st.lastTs && (
            <div className="text-[10px] text-inkfaint">last: {st.lastTs}</div>
          )}
          <button
            onClick={() => setShowLog(l => !l)}
            className="text-[10px] text-inkfaint hover:text-ink underline"
          >
            {showLog ? 'ẩn log' : 'xem log'}
          </button>
          {showLog && st.logTail.length > 0 && (
            <div className="mt-1 bg-black/30 rounded p-2 overflow-x-auto max-h-32 overflow-y-auto">
              {st.logTail.map((l, i) => (
                <div key={i} className="text-[10px] mono text-inkfaint whitespace-nowrap">{l}</div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ─── Main AutoTask export ─────────────────────────────────────────────────────
export default function AutoTask() {
  const [projects, setProjects] = useState<ATProject[]>([])
  const [loading, setLoading] = useState(true)
  const [detail, setDetail] = useState<string | null>(null)
  const [err, setErr] = useState('')

  const reload = () => {
    setLoading(true)
    fetchProjects()
      .then((ps) => { setProjects(ps); setLoading(false); setErr('') })
      .catch((e) => { setErr(String(e)); setLoading(false) })
  }

  useEffect(() => { reload() }, [])

  if (detail) return <DetailView slug={detail} onBack={() => setDetail(null)} />

  return (
    <div className="flex-1 min-h-0 overflow-y-auto p-4 sm:p-6">
      <div className="flex items-center justify-between mb-4">
        <div>
          <div className="text-[15px] font-bold text-ink">Build Pipeline</div>
          <div className="text-[11px] text-inkfaint">auto-build · auto-build-free · auto-task</div>
        </div>
        <button onClick={reload} className="btn btn-icon !w-8 !h-8 text-inkfaint hover:text-lime" title="Refresh">↻</button>
      </div>

      {/* Build Hub — status cards */}
      <div className="grid sm:grid-cols-2 gap-3 mb-6">
        <BuildStatusCard
          title="Auto-Build"
          icon="🏗️"
          tool="autobuild"
          model="Sonnet plan → Sonnet execute"
        />
        <BuildStatusCard
          title="Auto-Build Free"
          icon="🆓"
          tool="autobuild-free"
          model="Sonnet plan → mimo execute → Sonnet escalate"
        />
        <BuildStatusCard
          title="Auto-Task"
          icon="🤖"
          tool="auto-task"
          model="queue loop · Sonnet/lane"
        />
      </div>

      <div className="text-[12px] font-semibold text-inkdim mb-3 flex items-center gap-2">
        <span>📦</span> Auto-Task Projects
      </div>

      {err && <div className="glass border-red-400/30 px-3 py-2 text-[12px] text-red-400 mb-4">{err}</div>}

      {loading ? (
        <div className="flex items-center justify-center py-16 text-inkfaint text-[13px]">đang tải…</div>
      ) : projects.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 gap-3 text-center">
          <div className="text-4xl">📦</div>
          <div className="text-[14px] font-medium text-inkdim">Chưa có project nào</div>
          <div className="text-[12px] text-inkfaint max-w-xs">
            Tạo project trong <code className="mono bg-white/10 px-1 rounded">tasks/projects/&lt;slug&gt;/project.md</code>
          </div>
        </div>
      ) : (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {projects.map((p) => (
            <ProjectCard key={p.slug} p={p} onClick={() => setDetail(p.slug)} />
          ))}
        </div>
      )}
    </div>
  )
}
