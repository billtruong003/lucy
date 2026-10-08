import { useEffect, useMemo, useState } from 'react'
import { amSkills, type SkillInfo } from '../api'
import PageShell from './ui/PageShell'
import { EmptyState, Skeleton } from './ui'

// T6 — tab "Kỹ năng": liệt kê skill active (INDEX.md) + proposed (_proposed, M3.3 self-improve).
// READ-ONLY: proposed CHƯA active (chưa vào INDEX → loader không nạp). Duyệt = move thủ công, không toggle ở UI.
// bỏ dấu tiếng Việt để search.
const deburr = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd')

export default function Skills() {
  const [active, setActive] = useState<SkillInfo[]>([])
  const [proposed, setProposed] = useState<SkillInfo[]>([])
  const [learnOn, setLearnOn] = useState(false)
  const [configured, setConfigured] = useState(true)
  const [loading, setLoading] = useState(true)
  const [q, setQ] = useState('')

  const load = () => amSkills().then((d) => {
    setConfigured(d.configured !== false)
    setLearnOn(!!d.learnOn)
    setActive(d.active || [])
    setProposed(d.proposed || [])
  }).catch(() => { }).finally(() => setLoading(false))
  useEffect(() => { load() }, [])

  const filtered = useMemo(() => {
    const nq = deburr(q.trim())
    if (!nq) return active
    return active.filter((s) => deburr(s.name + ' ' + s.description).includes(nq))
  }, [active, q])

  const lucy = filtered.filter((s) => s.name.startsWith('lucy-'))
  const rest = filtered.filter((s) => !s.name.startsWith('lucy-'))

  const Card = ({ s, tone }: { s: SkillInfo; tone?: string }) => (
    <div className={'glass glass-hover p-3 flex flex-col gap-1 ' + (tone || '')}>
      <div className="num text-[12px] font-semibold truncate text-cyan">{s.name}</div>
      <div className="text-[11px] text-inkdim leading-snug">{s.description}</div>
      <div className="num text-[9px] text-inkfaint truncate">{s.path}</div>
    </div>
  )

  return (
    <PageShell width="wide">
        <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="chip num">{active.length} active</span>
            <span className={'chip num ' + (proposed.length ? 'chip-value' : '')}>{proposed.length} đề xuất</span>
            <span className={'chip num ' + (learnOn ? 'text-grn border-grn/40' : 'text-inkfaint border-ink/30')}>
              {learnOn ? 'LUCY_SKILL_LEARN on' : 'tự-học tắt (dry-run)'}
            </span>
            <span className="text-[11px] text-inkfaint">Thư viện kỹ năng — loader nạp ĐÚNG skill khớp task (progressive disclosure)</span>
          </div>
          <button onClick={() => { setLoading(true); load() }} className="btn">↻ Tải lại</button>
        </div>

        {loading && <div className="grid gap-2">{[0, 1, 2].map((i) => <Skeleton key={i} h="3rem" />)}</div>}
        {!loading && !configured && <EmptyState title="Agent-Machine chưa cấu hình" hint="Thiếu AM_COORD_URL — coordinator chưa kết nối." />}

        {/* Đề xuất tự sinh (M3.3) — nổi bật, chờ duyệt */}
        {proposed.length > 0 && (
          <div className="mb-5">
            <div className="hud-lbl text-gold mb-2">🌱 Lucy đề xuất (self-improve) — chờ duyệt</div>
            <div className="card p-3 mb-3 text-[11px] text-inkdim">
              Skill đề xuất nằm ở <code className="num text-cyan">skills/_proposed/</code> — KHÔNG vào INDEX nên loader KHÔNG nạp.
              Duyệt = move sang thư viện chính + thêm dòng INDEX.md.
            </div>
            <div className="grid gap-3 md:grid-cols-2">
              {proposed.map((s) => <Card key={s.path} s={s} tone="border-gold/30" />)}
            </div>
          </div>
        )}

        {/* Search active */}
        <div className="mb-3">
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Tìm kỹ năng…" className="input" />
        </div>

        {/* Lucy nội bộ trước */}
        {lucy.length > 0 && (
          <div className="mb-4">
            <div className="hud-lbl text-cyan mb-2">🎯 Skill nội bộ Lucy ({lucy.length})</div>
            <div className="grid gap-3 md:grid-cols-2">
              {lucy.map((s) => <Card key={s.path} s={s} tone="border-cyan/20" />)}
            </div>
          </div>
        )}

        {rest.length > 0 && (
          <div>
            <div className="hud-lbl mb-2">Thư viện ({rest.length})</div>
            <div className="grid gap-3 md:grid-cols-2">
              {rest.map((s) => <Card key={s.path} s={s} />)}
            </div>
          </div>
        )}
        {!loading && configured && filtered.length === 0 && <EmptyState title={`Không có skill khớp “${q}”`} hint="Thử từ khoá khác hoặc xoá bộ lọc." />}
    </PageShell>
  )
}
