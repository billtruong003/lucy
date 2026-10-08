import { useMemo, useState } from 'react'
import { diffLines, diffStat } from './promptDiff'
import { copyText } from './copyText'
import type { PromptScorecard } from '../api'

// PA-D — khối UX nâng cao tab Prompt Architect:
//  • CompareView  : side-by-side 2 prompt (cũ↔mới / biến thể A↔B / bản gốc↔bản sửa) + tô màu diff dòng.
//  • Scorecard    : render điểm rubric DETERMINISTIC (intel.scorePromptDraft) — tổng + tiêu chí + chỗ yếu.
//  • VariantTabs  : khi variants≥2 → chuyển tab từng biến thể + nút so sánh.

function CopyMini({ text }: { text: string }) {
  const [done, setDone] = useState(false)
  if (!text?.trim()) return null
  return (
    <button
      className="btn !py-0.5 !px-2 !text-[10px] shrink-0"
      onClick={() => { copyText(text); setDone(true); setTimeout(() => setDone(false), 1400) }}
    >{done ? '✓' : '📋'}</button>
  )
}

// Side-by-side diff. leftLabel/rightLabel mô tả 2 cột.
export function CompareView({ left, right, leftLabel, rightLabel }: {
  left: string; right: string; leftLabel: string; rightLabel: string
}) {
  const rows = useMemo(() => diffLines(left, right), [left, right])
  const stat = useMemo(() => diffStat(left, right), [left, right])
  return (
    <div className="mt-2 rounded-xl border border-line overflow-hidden">
      <div className="flex items-center gap-2 px-2.5 py-1.5 bg-white/[0.03] border-b border-line">
        <span className="num text-[9px] text-inkfaint flex-1 truncate">{leftLabel} <span className="text-inkfaint/60">↔</span> {rightLabel}</span>
        <span className="num text-[9px] text-grn">+{stat.add}</span>
        <span className="num text-[9px] text-red-400">−{stat.del}</span>
      </div>
      <div className="grid grid-cols-2 text-[10px] leading-snug max-h-72 overflow-y-auto font-mono">
        <div className="border-r border-line">
          {rows.map((r, i) => (
            <div key={i} className={'px-2 py-px whitespace-pre-wrap break-words ' + (r.kind === 'del' ? 'bg-red-500/10 text-red-300' : r.kind === 'add' ? 'bg-white/[0.015] text-inkfaint/40' : 'text-inkdim')}>
              {r.left ?? ' '}
            </div>
          ))}
        </div>
        <div>
          {rows.map((r, i) => (
            <div key={i} className={'px-2 py-px whitespace-pre-wrap break-words ' + (r.kind === 'add' ? 'bg-grn/10 text-grn' : r.kind === 'del' ? 'bg-white/[0.015] text-inkfaint/40' : 'text-inkdim')}>
              {r.right ?? ' '}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

// Điểm rubric — gọn (chip total) → mở ra danh sách tiêu chí + chỗ yếu.
export function Scorecard({ card }: { card: PromptScorecard }) {
  const [open, setOpen] = useState(false)
  const tone = card.total >= 85 ? 'text-grn border-grn/40' : card.total >= 65 ? 'text-gold border-gold/40' : 'text-red-400 border-red-400/40'
  return (
    <div className="mt-2">
      <button onClick={() => setOpen((o) => !o)} className={'chip num !text-[9px] ' + tone} title="Điểm rubric (deterministic)">
        ⭐ {card.total}/100 {card.weak.length > 0 ? `· ${card.weak.length} điểm yếu` : '· đạt'} {open ? '▲' : '▼'}
      </button>
      {open && (
        <div className="mt-1.5 rounded-xl border border-line p-2.5 bg-white/[0.02] flex flex-col gap-1.5">
          {card.summary && <div className="text-[11px] text-inkdim leading-snug">{card.summary}</div>}
          {card.criteria.map((c) => (
            <div key={c.key} className="flex items-center gap-2">
              <div className="flex-1 h-1.5 rounded-full bg-white/[0.06] overflow-hidden">
                <div className={'h-full rounded-full ' + (c.score >= 85 ? 'bg-grn' : c.score >= 65 ? 'bg-gold' : 'bg-red-400')} style={{ width: Math.max(4, Math.min(100, c.score)) + '%' }} />
              </div>
              <span className="num text-[9px] text-inkfaint w-24 shrink-0 truncate" title={c.note}>{c.label}</span>
              <span className="num text-[9px] text-inkdim w-7 text-right shrink-0">{c.score}</span>
            </div>
          ))}
          {card.weak.length > 0 && (
            <div className="text-[10px] text-gold/90 leading-snug pt-1 border-t border-line">⚠️ {card.weak.join(' · ')}</div>
          )}
        </div>
      )}
    </div>
  )
}

// Đa biến thể: tab chọn 1 biến thể + copy; nút "so sánh" 2 biến thể đang chọn.
export function VariantTabs({ variants }: { variants: string[] }) {
  const [sel, setSel] = useState(0)
  const [cmp, setCmp] = useState<number | null>(null)
  if (!variants || variants.length < 2) return null
  return (
    <div className="mt-2">
      <div className="flex items-center gap-1.5 flex-wrap mb-1.5">
        <span className="num text-[9px] text-inkfaint mr-1">{variants.length} biến thể:</span>
        {variants.map((_, i) => (
          <button key={i} onClick={() => { setSel(i); setCmp(null) }}
            className={'btn !py-0.5 !px-2 !text-[10px] ' + (sel === i ? 'border-cyan/50 text-cyan' : '')}>{String.fromCharCode(65 + i)}</button>
        ))}
        <span className="flex-1" />
        <button onClick={() => setCmp(cmp === null ? (sel === 0 ? 1 : 0) : null)}
          className={'btn !py-0.5 !px-2 !text-[10px] ' + (cmp !== null ? 'border-gold/50 text-gold' : '')}>
          {cmp !== null ? '✕ đóng so sánh' : '⇄ so sánh'}
        </button>
        <CopyMini text={variants[sel]} />
      </div>
      {cmp === null ? (
        <pre className="num text-[10px] text-inkdim whitespace-pre-wrap leading-snug max-h-72 overflow-y-auto bg-white/[0.02] rounded-lg p-2 border border-line">{variants[sel]}</pre>
      ) : (
        <CompareView
          left={variants[sel]} right={variants[cmp]}
          leftLabel={'Biến thể ' + String.fromCharCode(65 + sel)} rightLabel={'Biến thể ' + String.fromCharCode(65 + cmp)}
        />
      )}
    </div>
  )
}
