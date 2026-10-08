import { useCallback, useEffect, useState, type ReactNode } from 'react'
import {
  Brain, Search, RefreshCw, Moon, ThumbsUp, ThumbsDown, Pin, Inbox, FolderTree,
  CircleCheck, CircleDashed, FileText, FolderGit2, Puzzle, NotebookPen, Sparkles, GitBranch, Trash2,
} from 'lucide-react'
import Markdown from './Markdown'
import { brainState, brainRecall, brainFile, brainReindex, brainDream, brainEvidence, brainPin, memoryJunk, memoryClean, type BrainState, type BrainHit, type BrainPref, type BrainRelated, type MemJunkItem } from '../api'
import { showToast } from '../toast'
import { openGalaxyTab } from '../galaxyFocus'

// Tab "Bộ não" (M1 + B) — trí nhớ bền của Lucy: tinh hà sống (hero) · recall (FTS5) · preference đã học (confidence)
// · gộp "dream". Premium dark (NORTH_STAR §4). Khác tab Neural (BrainViz = graph agent live).

const BAND: Record<string, { col: string }> = { high: { col: 'var(--grn)' }, medium: { col: 'var(--cyan)' }, low: { col: 'var(--inkdim)' } }
const STATUS_COL: Record<string, string> = { confirmed: 'text-grn', unconfirmed: 'text-cyan', stale: 'text-yellow-300', rebutted: 'text-pink', expired: 'text-inkfaint' }
const TYPE_ICON: Record<string, ReactNode> = {
  project: <FolderGit2 size={13} />, note: <FileText size={13} />, skill: <Puzzle size={13} />,
  daily: <NotebookPen size={13} />, preference: <Brain size={13} />, identity: <Sparkles size={13} />,
}

function Snippet({ text }: { text: string }) {
  const parts = text.split(/«|»/)
  return <>{parts.map((p, i) => (i % 2 === 1 ? <span key={i} className="text-cyan bg-cyan/10 rounded px-0.5">{p}</span> : <span key={i}>{p}</span>))}</>
}

export default function Memory({ visible }: { visible: boolean }) {
  const [st, setSt] = useState<BrainState | null>(null)
  const [q, setQ] = useState('')
  const [hits, setHits] = useState<BrainHit[] | null>(null)
  const [related, setRelated] = useState<BrainRelated[]>([])
  const [sel, setSel] = useState<string | null>(null)
  const [doc, setDoc] = useState('')
  const [busy, setBusy] = useState(false)

  const load = useCallback(() => { brainState().then(setSt).catch(() => { /* */ }) }, [])
  useEffect(() => { if (visible) load() }, [visible, load])

  const openFile = (path: string) => { setSel(path); setHits(null); setDoc(''); brainFile(path).then((d) => setDoc(d.content || '_(không đọc được)_')) }
  const backToGalaxy = () => { setSel(null); setHits(null); setQ('') }
  const search = () => {
    const term = q.trim()
    if (!term) { setHits(null); setRelated([]); return }
    setSel(null); brainRecall(term).then((d) => { setHits(d.hits || []); setRelated(d.related || []) })
  }
  const reindex = async () => {
    setBusy(true)
    try { const d = await brainReindex(); showToast(`Reindex: ${d.stats?.total ?? '?'} note`, 'success'); load() }
    catch { showToast('Reindex lỗi', 'error') } finally { setBusy(false) }
  }
  const runDream = async () => {
    setBusy(true)
    try {
      const d = await brainDream(); const s = d.summary
      if (!s) showToast('Dream lỗi', 'error')
      else if (!s.changed && !s.contradictions.length) showToast('Dream: không có gì mới', 'info')
      else showToast(`Dream: +${s.graduated.length} học · ${s.confirmed.length} confirmed · ${s.activePrefs} sống`, 'success')
      load()
    } catch { showToast('Dream lỗi', 'error') } finally { setBusy(false) }
  }
  // B: feed evidence (👍/👎) → confirm/giảm confidence ngay. Galaxy poll 4s sẽ tự cập nhật độ sáng hành tinh.
  const sendEvidence = async (prefId: string, kind: 'applied' | 'violated') => {
    try {
      const d = await brainEvidence(prefId, kind)
      const conf = d.summary?.confirmed?.length || 0
      showToast(kind === 'applied' ? `👍 áp dụng${conf ? ` · ${conf} confirmed` : ''}` : '👎 ghi vi phạm', kind === 'applied' ? 'success' : 'info')
      load()
    } catch { showToast('Ghi evidence lỗi', 'error') }
  }
  const togglePin = async (p: BrainPref) => {
    try { await brainPin(p.id, !p.pinned); showToast(p.pinned ? 'Bỏ ghim' : '📌 Đã ghim (miễn auto-retire)', 'info'); load() }
    catch { showToast('Pin lỗi', 'error') }
  }
  // 🧹 Memory rác: quét note rỗng/trùng/conflict → confirm → move vào vault/.trash (khôi phục được)
  const [junk, setJunk] = useState<MemJunkItem[] | null>(null)
  const scanJunk = async () => {
    setBusy(true)
    try {
      const d = await memoryJunk()
      if (!d.total) showToast('✨ Memory sạch — không có rác', 'success')
      else setJunk(d.items)
    } catch { showToast('Quét rác lỗi', 'error') } finally { setBusy(false) }
  }
  const cleanJunk = async () => {
    if (!junk?.length) return
    setBusy(true)
    try {
      const d = await memoryClean(junk.map((i) => i.path))
      showToast(`🧹 Đã chuyển ${d.moved} file vào ${d.trash}${d.errors.length ? ` · ${d.errors.length} lỗi` : ''}`, d.errors.length ? 'info' : 'success')
      setJunk(null); load()
    } catch { showToast('Dọn rác lỗi', 'error') } finally { setBusy(false) }
  }

  if (st && st.configured === false) return (
    <div className="h-full grid place-items-center px-6">
      <div className="card max-w-md p-7 text-center">
        <Brain size={32} className="mx-auto mb-3 text-cyan" />
        <div className="display text-cyan tracking-wide mb-2">BỘ NÃO CHƯA BẬT</div>
        <p className="text-[13px] text-inkdim leading-relaxed">
          Đặt env <code className="text-cyan">LUCY_VAULT</code> cho coordinator (trỏ <code className="text-cyan">lucy-vault/</code>) rồi restart agent-machine.
          {st.offline && <span className="block mt-2 text-pink">· coordinator đang offline.</span>}
        </p>
      </div>
    </div>
  )

  const prefs = st?.preferences || []
  const inbox = st?.inbox || []
  const confirmed = prefs.filter((p) => p.status === 'confirmed').length
  const overview = hits === null && !sel

  return (
    <div className="h-full flex flex-col relative">
      {/* ── modal xác nhận dọn memory rác ── */}
      {junk && (
        <div className="absolute inset-0 z-40 grid place-items-center bg-black/60 p-4" onClick={() => setJunk(null)}>
          <div className="card max-w-lg w-full max-h-[70vh] flex flex-col p-4" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center gap-2 mb-1">
              <Trash2 size={15} className="text-pink" />
              <span className="text-ink font-medium text-[14px]">Memory rác · {junk.length} file</span>
            </div>
            <p className="text-[11px] text-inkfaint mb-2">Chỉ MOVE vào <code className="text-cyan">vault/.trash/</code> — không xoá thật, khôi phục được.</p>
            <div className="flex-1 overflow-y-auto mono text-[11px] space-y-1 mb-3 pr-1">
              {junk.map((i) => (
                <div key={i.path} className="flex items-center gap-2">
                  <span className="text-inkdim truncate flex-1" title={i.path}>{i.path}</span>
                  <span className="text-inkfaint shrink-0">{i.reason}</span>
                </div>
              ))}
            </div>
            <div className="flex gap-2 justify-end">
              <button className="btn !py-1.5" onClick={() => setJunk(null)}>Đóng</button>
              <button className="btn btn-primary !py-1.5 gap-1.5" onClick={cleanJunk} disabled={busy}><Trash2 size={13} /> Dọn {junk.length} file</button>
            </div>
          </div>
        </div>
      )}
      {/* ── HEADER: stat cards + actions ── */}
      <div className="shrink-0 flex items-center gap-2 px-4 sm:px-5 py-3 border-b border-line flex-wrap">
        <div className="flex items-center gap-2 mr-1"><Brain size={18} className="text-cyan" /><span className="display text-[15px] tracking-wide text-ink hidden sm:block">Bộ não</span></div>
        <Stat icon={<FileText size={15} />} value={st?.stats?.total ?? '–'} label="note" />
        <Stat icon={<Brain size={15} />} value={prefs.length} label="đã học" sub={confirmed ? `${confirmed} ✓` : undefined} />
        <Stat icon={<Inbox size={15} />} value={inbox.length} label="inbox" />
        <div className="flex-1 min-w-[120px]" />
        <div className="flex items-center gap-1 order-last sm:order-none w-full sm:w-auto">
          <div className="relative flex-1 sm:w-64">
            <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-inkfaint pointer-events-none" />
            <input className="input !py-1.5 !pl-8 text-[13px] w-full" placeholder="recall — tìm trong trí nhớ…"
              value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') search() }} />
          </div>
          <button className="btn !py-1.5 !px-2.5 shrink-0" onClick={reindex} disabled={busy} title="Dựng lại index FTS5"><RefreshCw size={14} className={busy ? 'animate-spin' : ''} /></button>
          <button className="btn !py-1.5 !px-2.5 shrink-0" onClick={scanJunk} disabled={busy} title="Quét memory rác (note rỗng / trùng / conflict) → dọn vào .trash"><Trash2 size={14} /></button>
          <button className="btn btn-primary !py-1.5 !px-3 shrink-0 gap-1.5" onClick={runDream} disabled={busy} title="Gộp signal → preference"><Moon size={14} /> <span className="hidden sm:inline text-[12px]">Dream</span></button>
        </div>
      </div>

      <div className="flex-1 min-h-0 flex">
        {/* ── LEFT: preferences (premium) + inbox + vault — U4: width co theo viewport ── */}
        <div className="w-full max-w-[300px] md:w-[clamp(240px,26vw,320px)] shrink-0 border-r border-line overflow-y-auto p-3 hidden md:block">
          <Section icon={<Brain size={12} />} title={`Đã học · ${prefs.length}`}>
            {prefs.length === 0 && <Empty text="Chưa học preference nào — chạy việc + Dream" />}
            {prefs.map((p) => <PrefCard key={p.id} p={p} active={sel === p.path}
              onClick={() => openFile(p.path)} onEvidence={(k) => sendEvidence(p.id, k)} onPin={() => togglePin(p)} />)}
          </Section>

          <Section icon={<Inbox size={12} />} title={`Inbox · chờ dream · ${inbox.length}`}>
            {inbox.length === 0 && <Empty text="Trống — chưa có signal mới" />}
            {inbox.map((s) => (
              <button key={s.id} onClick={() => openFile(s.path)}
                className={'w-full text-left rounded-lg px-2 py-1.5 mb-0.5 transition-colors ' + (sel === s.path ? 'bg-cyan/10' : 'hover:bg-white/[0.04]')}>
                <div className="flex items-center gap-1.5">
                  {s.signal === 'negative' ? <CircleDashed size={12} className="text-pink shrink-0" /> : <CircleCheck size={12} className="text-grn shrink-0" />}
                  <span className="text-[11px] text-inkfaint truncate flex-1">{s.topic}</span>
                  <span className="chip !py-0 !px-1 !text-[9px] shrink-0">{s.agent}</span>
                </div>
                <div className="text-[12px] text-inkdim truncate mt-0.5">{s.principle}</div>
              </button>
            ))}
          </Section>

          <Section icon={<FolderTree size={12} />} title="Vault">
            {(st?.tree || []).map((grp) => (
              <div key={grp.dir} className="mb-2">
                <div className="text-[10px] text-inkfaint uppercase tracking-widest px-2 mb-0.5">{grp.dir}</div>
                {grp.files.map((f) => (
                  <button key={f.path} onClick={() => openFile(f.path)}
                    className={'w-full text-left rounded-lg px-2 py-1 mb-0.5 flex items-center gap-1.5 transition-colors ' + (sel === f.path ? 'bg-cyan/10' : 'hover:bg-white/[0.04]')}>
                    <span className={'shrink-0 ' + (sel === f.path ? 'text-cyan' : 'text-inkfaint')}>{TYPE_ICON[f.type] || <FileText size={13} />}</span>
                    <span className={'text-[12px] truncate flex-1 ' + (sel === f.path ? 'text-cyan' : 'text-inkdim')}>{f.title}</span>
                    {f.status && <span className={'!text-[9px] shrink-0 ' + (STATUS_COL[f.status] || 'text-inkfaint')}>{f.status}</span>}
                  </button>
                ))}
              </div>
            ))}
          </Section>
        </div>

        {/* ── RIGHT: overview landing (U2: tinh hà gom về tab Tinh hà, đây chỉ recall) | hits | doc ── */}
        <div className="flex-1 min-w-0 relative">
          {overview && (
            <div className="absolute inset-0 grid place-items-center p-6">
              <div className="glass glass-hover p-7 sm:p-9 max-w-md text-center reveal-host">
                {/* Jarvis hero mini: arc-reactor + 2 vòng HUD */}
                <div className="relative mx-auto mb-5 h-24 w-24">
                  <div className="absolute inset-0 hud-ring" />
                  <div className="absolute inset-2 hud-ring-rev hud-ring-gold" />
                  <div className="absolute inset-[34%] arc-reactor" />
                  <Brain size={26} className="absolute inset-0 m-auto text-cyan" />
                </div>
                <div className="display text-cyan tracking-wide mb-1.5">TRÍ NHỚ BỀN</div>
                <p className="text-[13px] text-inkdim leading-relaxed mb-1">
                  <span className="num text-ink">{st?.stats?.total ?? '–'}</span> note ·
                  <span className="num text-ink"> {prefs.length}</span> đã học ·
                  <span className="num text-ink"> {confirmed}</span> ✓ confirmed
                </p>
                <p className="text-[12px] text-inkfaint leading-relaxed mb-4">Recall ở ô tìm kiếm trên, hoặc duyệt vault bên trái.</p>
                <button className="btn btn-primary gap-1.5" onClick={openGalaxyTab}><Sparkles size={14} /> Mở Tinh hà</button>
              </div>
            </div>
          )}

          {hits !== null && (
            <div className="absolute inset-0 overflow-y-auto p-4 sm:p-6">
              <div className="max-w-3xl mx-auto">
                <div className="flex items-center gap-2 mb-3">
                  <button className="btn !py-1 !px-2 !text-[11px] gap-1" onClick={backToGalaxy}><Sparkles size={12} /> Tinh hà</button>
                  <span className="text-[12px] text-inkfaint">{hits.length} kết quả cho “{q}”{hits[0]?.tri ? <span className="text-cyan"> · substring</span> : hits[0]?.relaxed ? <span className="text-cyan"> · relaxed-OR</span> : null}</span>
                </div>
                {hits.length === 0 && <Empty text="Không tìm thấy — thử từ khoá khác / Reindex" />}
                {hits.map((h) => (
                  <button key={h.file_path} onClick={() => openFile(h.file_path)} className="card w-full text-left p-3 mb-2 hover:border-cyan/40 transition-colors">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="shrink-0 text-inkfaint">{TYPE_ICON[h.type] || <FileText size={13} />}</span>
                      <span className="text-[13px] text-cyan font-medium truncate flex-1">{h.title}</span>
                      <span className="text-[10px] text-inkfaint shrink-0 mono">{h.file_path}</span>
                    </div>
                    <div className="text-[12px] text-inkdim leading-relaxed"><Snippet text={h.snippet} /></div>
                  </button>
                ))}
                {/* A7 graph-walk: note nối các hit qua wikilink (1 bước, 2 chiều) */}
                {related.length > 0 && (
                  <div className="mt-4">
                    <div className="text-[11px] text-inkfaint mb-2 flex items-center gap-1.5"><GitBranch size={12} /> Kéo theo (nối wikilink)</div>
                    {related.map((r) => (
                      <button key={r.file_path} onClick={() => openFile(r.file_path)} className="card w-full text-left px-3 py-2 mb-1.5 hover:border-cyan/40 transition-colors flex items-center gap-2">
                        <span className="text-[12px] text-ink truncate flex-1">{r.title}</span>
                        <span className="text-[10px] text-inkfaint shrink-0">{r.via}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          {sel && (
            <div className="absolute inset-0 overflow-y-auto p-4 sm:p-6">
              <div className="max-w-3xl mx-auto">
                <div className="flex items-center gap-2 mb-3">
                  <button className="btn !py-1 !px-2 !text-[11px] gap-1" onClick={backToGalaxy}><Sparkles size={12} /> Tinh hà</button>
                  <span className="text-[11px] text-inkfaint mono truncate">{sel}</span>
                </div>
                <div className="card p-5"><Markdown>{stripFm(doc)}</Markdown></div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function Stat({ icon, value, label, sub }: { icon: ReactNode; value: ReactNode; label: string; sub?: string }) {
  return (
    <div className="card hud-frame flex items-center gap-2 px-3 py-1.5">
      <span className="text-cyan/80 shrink-0">{icon}</span>
      <div className="leading-none">
        <span className="num text-[15px] font-bold text-cyan">{value}</span>
        <span className="hud-lbl ml-1.5">{label}</span>
        {sub && <span className="num text-[10px] text-grn ml-1">{sub}</span>}
      </div>
    </div>
  )
}

function Section({ icon, title, children }: { icon: ReactNode; title: string; children: ReactNode }) {
  return (
    <div className="mb-4">
      <div className="hud-lbl flex items-center gap-1.5 px-2 mb-1.5">{icon}<span>{title}</span></div>
      {children}
    </div>
  )
}
function Empty({ text }: { text: string }) { return <div className="text-[11px] text-inkfaint px-2 py-1.5 italic">{text}</div> }

// Preference card premium: thanh confidence Wilson (màu theo band) + status + 👍/👎 evidence + 📌 pin.
function PrefCard({ p, active, onClick, onEvidence, onPin }: { p: BrainPref; active: boolean; onClick: () => void; onEvidence: (k: 'applied' | 'violated') => void; onPin: () => void }) {
  const live = p.status === 'unconfirmed' || p.status === 'confirmed' // chỉ pref sống mới feed evidence/pin
  const col = (BAND[p.band] || BAND.low).col
  const pct = Math.round(Math.min(1, Math.max(0, p.confidence)) * 100)
  return (
    <div className={'rounded-xl border px-2.5 py-2 mb-1.5 transition-colors ' + (active ? 'border-cyan/40 bg-cyan/[0.06]' : 'border-line hover:border-cyan/25 hover:bg-white/[0.02]')}>
      <button onClick={onClick} className="w-full text-left">
        <div className="flex items-start gap-1.5">
          {p.sign === 'negative' ? <CircleDashed size={13} className="text-pink mt-0.5 shrink-0" /> : <CircleCheck size={13} className="text-grn mt-0.5 shrink-0" />}
          <span className="text-[12.5px] text-ink leading-snug flex-1">{p.principle}</span>
          {p.pinned && <Pin size={11} className="text-cyan shrink-0 mt-0.5" fill="currentColor" />}
        </div>
        <div className="mt-2 flex items-center gap-2">
          <div className="flex-1 h-1.5 rounded-full bg-white/[0.07] overflow-hidden">
            <div className="h-full rounded-full transition-all duration-500" style={{ width: pct + '%', background: col, boxShadow: pct > 0 ? `0 0 7px ${col}` : 'none' }} />
          </div>
          <span className="text-[10px] mono shrink-0" style={{ color: col }}>{p.confidence.toFixed(2)}</span>
          <span className={'text-[8.5px] uppercase tracking-wider shrink-0 ' + (STATUS_COL[p.status] || 'text-inkfaint')}>{p.status}</span>
        </div>
      </button>
      {live && (
        <div className="flex items-center gap-1 mt-1.5">
          <button onClick={() => onEvidence('applied')} className="flex items-center gap-1 chip !py-0.5 !px-1.5 !text-[10px] hover:border-grn/50 hover:text-grn transition-colors" title="Lucy áp dụng đúng → +1 applied (tăng confidence)"><ThumbsUp size={11} /> áp dụng</button>
          <button onClick={() => onEvidence('violated')} className="flex items-center gap-1 chip !py-0.5 !px-1.5 !text-[10px] hover:border-pink/50 hover:text-pink transition-colors" title="Sai/vi phạm → +1 violated"><ThumbsDown size={11} /> bác</button>
          <div className="flex-1" />
          <button onClick={onPin} className={'p-1 rounded-md transition-colors ' + (p.pinned ? 'text-cyan' : 'text-inkfaint hover:text-cyan')} title={p.pinned ? 'bỏ ghim' : 'ghim — miễn auto-retire'}><Pin size={12} fill={p.pinned ? 'currentColor' : 'none'} /></button>
        </div>
      )}
    </div>
  )
}

function stripFm(md: string): string { return md.replace(/^---[\s\S]*?\n---\n/, '').trim() }
