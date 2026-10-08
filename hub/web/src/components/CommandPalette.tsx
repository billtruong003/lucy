import { useEffect, useMemo, useRef, useState } from 'react'

export type PaletteItem = {
  id: string
  label: string
  icon: string
  sub?: string
  group?: string
  /** từ khoá phụ để search (vd "kanban repo") */
  keywords?: string
  onPick: () => void
}

type Props = {
  open: boolean
  onClose: () => void
  items: PaletteItem[]
}

/** bỏ dấu tiếng Việt để search "tinh ha" cũng ra "Tinh hà" */
function norm(s: string) {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
}

export default function CommandPalette({ open, onClose, items }: Props) {
  const [q, setQ] = useState('')
  const [sel, setSel] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  const filtered = useMemo(() => {
    const nq = norm(q.trim())
    if (!nq) return items
    return items.filter((it) => {
      const hay = norm(`${it.label} ${it.sub || ''} ${it.group || ''} ${it.keywords || ''}`)
      // match từng token rời (vd "ti ha")
      return nq.split(/\s+/).every((t) => hay.includes(t))
    })
  }, [q, items])

  // reset khi mở
  useEffect(() => {
    if (open) {
      setQ('')
      setSel(0)
      setTimeout(() => inputRef.current?.focus(), 30)
    }
  }, [open])

  // sel không vượt danh sách đã lọc
  useEffect(() => { setSel((s) => Math.min(s, Math.max(0, filtered.length - 1))) }, [filtered.length])

  // scroll item đang chọn vào tầm nhìn
  useEffect(() => {
    const el = listRef.current?.querySelector<HTMLElement>(`[data-idx="${sel}"]`)
    el?.scrollIntoView({ block: 'nearest' })
  }, [sel])

  if (!open) return null

  const pick = (i: number) => {
    const it = filtered[i]
    if (!it) return
    it.onPick()
    onClose()
  }

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setSel((s) => Math.min(s + 1, filtered.length - 1)) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setSel((s) => Math.max(s - 1, 0)) }
    else if (e.key === 'Enter') { e.preventDefault(); pick(sel) }
    else if (e.key === 'Escape') { e.preventDefault(); onClose() }
  }

  return (
    <div
      className="fixed inset-0 z-[60] flex items-start justify-center pt-[12vh] px-4 bg-black/55 backdrop-blur-sm"
      onClick={onClose}>
      <div
        className="glass glass-hi w-full max-w-xl rounded-2xl overflow-hidden shadow-2xl"
        style={{ border: '1px solid rgba(var(--gold-rgb),0.22)' }}
        onClick={(e) => e.stopPropagation()}>
        {/* input */}
        <div className="flex items-center gap-2.5 px-4 py-3 border-b border-line">
          <span className="text-cyan text-base">⌘</span>
          <input
            ref={inputRef}
            value={q}
            onChange={(e) => { setQ(e.target.value); setSel(0) }}
            onKeyDown={onKey}
            placeholder="Đi tới… (gõ tên tab, vd 'tinh ha', 'chat')"
            className="flex-1 bg-transparent outline-none text-[14px] text-ink placeholder:text-inkfaint"
          />
          <kbd className="text-[10px] text-inkfaint border border-line rounded px-1.5 py-0.5 mono">esc</kbd>
        </div>

        {/* list */}
        <div ref={listRef} className="max-h-[52vh] overflow-y-auto py-1.5">
          {filtered.length === 0 ? (
            <div className="px-4 py-8 text-center text-[13px] text-inkfaint">Không có mục nào khớp “{q}”</div>
          ) : (
            filtered.map((it, i) => {
              const on = i === sel
              return (
                <button
                  key={it.id}
                  data-idx={i}
                  onMouseEnter={() => setSel(i)}
                  onClick={() => pick(i)}
                  className={'w-full flex items-center gap-3 px-4 py-2 text-left transition-colors ' +
                    (on ? 'bg-cyan/10' : 'hover:bg-white/[0.04]')}>
                  <span className="text-base shrink-0 opacity-90">{it.icon}</span>
                  <span className="flex-1 min-w-0">
                    <span className={'block text-[13px] font-medium truncate ' + (on ? 'text-cyan' : 'text-ink')}>{it.label}</span>
                    {it.sub && <span className="block text-[10px] text-inkfaint truncate">{it.sub}</span>}
                  </span>
                  {it.group && <span className="chip !py-0 !px-1.5 !text-[9px] text-inkfaint shrink-0">{it.group}</span>}
                  {on && <kbd className="text-[10px] text-cyan border border-cyan/30 rounded px-1.5 py-0.5 mono shrink-0">↵</kbd>}
                </button>
              )
            })
          )}
        </div>

        {/* footer hint */}
        <div className="px-4 py-2 border-t border-line flex items-center gap-3 text-[10px] text-inkfaint">
          <span><kbd className="mono">↑↓</kbd> chọn</span>
          <span><kbd className="mono">↵</kbd> mở</span>
          <span><kbd className="mono">esc</kbd> đóng</span>
        </div>
      </div>
    </div>
  )
}
