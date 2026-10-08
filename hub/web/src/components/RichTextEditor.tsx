import { useRef, useState, useCallback } from 'react'

type ToolbarBtn = {
  key: string
  label: string | JSX.Element
  title: string
  prefix?: string
  suffix?: string
  block?: boolean   // true = insert at start of line (headings, lists)
  wrap?: string     // paired marker (bold, italic)
  prompt?: string   // ask for a URL
  template?: string // full template with cursor marker ‸
}

const IC = {
  Bold: () => (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M6 4h8a4 4 0 0 1 4 4 4 4 0 0 1-4 4H6z"/><path d="M6 12h9a4 4 0 0 1 4 4 4 4 0 0 1-4 4H6z"/>
    </svg>
  ),
  Italic: () => (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <line x1="19" y1="4" x2="10" y2="4"/><line x1="14" y1="20" x2="5" y2="20"/><line x1="15" y1="4" x2="9" y2="20"/>
    </svg>
  ),
  Link: () => (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/>
      <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>
    </svg>
  ),
  Image: () => (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/>
      <circle cx="8.5" cy="8.5" r="1.5"/>
      <polyline points="21 15 16 10 5 21"/>
    </svg>
  ),
  Video: () => (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2" ry="2"/>
    </svg>
  ),
  BulletList: () => (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="9" y1="6" x2="20" y2="6"/><line x1="9" y1="12" x2="20" y2="12"/><line x1="9" y1="18" x2="20" y2="18"/>
      <circle cx="4" cy="6" r="1.5" fill="currentColor" stroke="none"/>
      <circle cx="4" cy="12" r="1.5" fill="currentColor" stroke="none"/>
      <circle cx="4" cy="18" r="1.5" fill="currentColor" stroke="none"/>
    </svg>
  ),
  OrderedList: () => (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="10" y1="6" x2="21" y2="6"/><line x1="10" y1="12" x2="21" y2="12"/><line x1="10" y1="18" x2="21" y2="18"/>
      <text x="2" y="8" fontSize="7" fill="currentColor" stroke="none" fontFamily="monospace">1.</text>
      <text x="2" y="14" fontSize="7" fill="currentColor" stroke="none" fontFamily="monospace">2.</text>
      <text x="2" y="20" fontSize="7" fill="currentColor" stroke="none" fontFamily="monospace">3.</text>
    </svg>
  ),
}

const GROUPS: ToolbarBtn[][] = [
  [
    { key: 'bold',   label: <IC.Bold />,   title: 'Đậm (Ctrl+B)',   wrap: '**' },
    { key: 'italic', label: <IC.Italic />, title: 'Nghiêng (Ctrl+I)', wrap: '*' },
  ],
  [
    { key: 'h1', label: 'H1', title: 'Tiêu đề 1', block: true, prefix: '# ' },
    { key: 'h2', label: 'H2', title: 'Tiêu đề 2', block: true, prefix: '## ' },
    { key: 'h3', label: 'H3', title: 'Tiêu đề 3', block: true, prefix: '### ' },
  ],
  [
    { key: 'ul', label: <IC.BulletList />,   title: 'Danh sách bullet', block: true, prefix: '- ' },
    { key: 'ol', label: <IC.OrderedList />,  title: 'Danh sách số',     block: true, prefix: '1. ' },
  ],
  [
    { key: 'link',  label: <IC.Link />,  title: 'Chèn link',  template: '[‸](url)' },
    { key: 'image', label: <IC.Image />, title: 'Chèn ảnh',   template: '![‸](url)' },
    { key: 'video', label: <IC.Video />, title: 'Chèn video',  template: '[![‸](thumb)](video-url)' },
  ],
]

function detectActive(text: string, pos: number, btn: ToolbarBtn): boolean {
  if (btn.wrap) {
    const w = btn.wrap
    const before = text.slice(0, pos)
    const after = text.slice(pos)
    return before.includes(w) && after.includes(w) &&
      before.lastIndexOf(w) > before.lastIndexOf('\n')
  }
  if (btn.block && btn.prefix) {
    const lineStart = text.lastIndexOf('\n', pos - 1) + 1
    return text.slice(lineStart).startsWith(btn.prefix)
  }
  return false
}

export default function RichTextEditor({
  value,
  onChange,
  placeholder = 'Nội dung…',
  rows = 5,
  className = '',
}: {
  value: string
  onChange: (v: string) => void
  placeholder?: string
  rows?: number
  className?: string
}) {
  const ref = useRef<HTMLTextAreaElement>(null)
  const [focused, setFocused] = useState(false)
  const [cursorPos, setCursorPos] = useState(0)

  const trackCursor = useCallback(() => {
    setCursorPos(ref.current?.selectionStart ?? 0)
  }, [])

  const applyFormat = useCallback((btn: ToolbarBtn) => {
    const ta = ref.current
    if (!ta) return

    const start = ta.selectionStart
    const end = ta.selectionEnd
    const sel = value.slice(start, end)
    const before = value.slice(0, start)
    const after = value.slice(end)

    let next = value
    let newStart = start
    let newEnd = end

    if (btn.wrap) {
      const w = btn.wrap
      if (sel) {
        next = before + w + sel + w + after
        newStart = start + w.length
        newEnd = end + w.length
      } else {
        next = before + w + w + after
        newStart = start + w.length
        newEnd = newStart
      }
    } else if (btn.block && btn.prefix) {
      const lineStart = before.lastIndexOf('\n') + 1
      const linePrefix = value.slice(lineStart, lineStart + btn.prefix.length)
      if (linePrefix === btn.prefix) {
        // toggle off
        next = value.slice(0, lineStart) + value.slice(lineStart + btn.prefix.length)
        newStart = Math.max(lineStart, start - btn.prefix.length)
        newEnd = Math.max(lineStart, end - btn.prefix.length)
      } else {
        next = value.slice(0, lineStart) + btn.prefix + value.slice(lineStart)
        newStart = start + btn.prefix.length
        newEnd = end + btn.prefix.length
      }
    } else if (btn.template) {
      const cursor = btn.template.indexOf('‸')
      const tpl = btn.template.replace('‸', sel || '')
      next = before + tpl + after
      if (sel) {
        newStart = start + cursor
        newEnd = start + cursor + sel.length
      } else {
        newStart = newEnd = start + cursor
      }
    }

    onChange(next)

    // restore selection after state update
    requestAnimationFrame(() => {
      if (!ref.current) return
      ref.current.focus()
      ref.current.setSelectionRange(newStart, newEnd)
      setCursorPos(newStart)
    })
  }, [value, onChange])

  // keyboard shortcuts
  const onKeyDown = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'b') { e.preventDefault(); applyFormat(GROUPS[0][0]) }
    if ((e.ctrlKey || e.metaKey) && e.key === 'i') { e.preventDefault(); applyFormat(GROUPS[0][1]) }
  }, [applyFormat])

  return (
    <div
      className={'rounded-xl overflow-hidden ' + className}
      style={{
        border: `1px solid ${focused ? 'rgba(56,208,255,0.55)' : 'var(--line)'}`,
        boxShadow: focused ? '0 0 0 3px rgba(56,208,255,0.10)' : 'none',
        background: 'rgba(3,7,16,0.7)',
        transition: 'border-color 0.15s, box-shadow 0.15s',
      }}
    >
      {/* ── Toolbar ── */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '2px',
          padding: '5px 8px',
          borderBottom: '1px solid var(--line)',
          background: 'rgba(255,255,255,0.02)',
          flexWrap: 'wrap',
        }}
      >
        {GROUPS.map((grp, gi) => (
          <div key={gi} style={{ display: 'flex', alignItems: 'center', gap: '1px' }}>
            {gi > 0 && (
              <span style={{ width: 1, height: 16, background: 'var(--line)', margin: '0 4px', display: 'inline-block', flexShrink: 0 }} />
            )}
            {grp.map((btn) => {
              const active = detectActive(value, cursorPos, btn)
              return (
                <button
                  key={btn.key}
                  type="button"
                  title={btn.title}
                  onMouseDown={(e) => { e.preventDefault(); applyFormat(btn) }}
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    minWidth: 26,
                    height: 26,
                    padding: '0 5px',
                    borderRadius: 6,
                    border: active ? '1px solid rgba(56,208,255,0.55)' : '1px solid transparent',
                    background: active ? 'rgba(56,208,255,0.12)' : 'transparent',
                    color: active ? '#3fd3ff' : '#9fb4c9',
                    cursor: 'pointer',
                    fontSize: 11,
                    fontWeight: 700,
                    fontFamily: '"Space Grotesk", Inter, sans-serif',
                    letterSpacing: '0.04em',
                    transition: 'all 0.12s',
                    lineHeight: 1,
                  }}
                  onMouseEnter={(e) => {
                    if (!active) {
                      (e.currentTarget as HTMLElement).style.color = '#e7f1fb'
                      ;(e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,0.06)'
                    }
                  }}
                  onMouseLeave={(e) => {
                    if (!active) {
                      (e.currentTarget as HTMLElement).style.color = '#9fb4c9'
                      ;(e.currentTarget as HTMLElement).style.background = 'transparent'
                    }
                  }}
                >
                  {btn.label}
                </button>
              )
            })}
          </div>
        ))}
      </div>

      {/* ── Editor textarea ── */}
      <textarea
        ref={ref}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={onKeyDown}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        onSelect={trackCursor}
        onKeyUp={trackCursor}
        onClick={trackCursor}
        placeholder={placeholder}
        rows={rows}
        style={{
          display: 'block',
          width: '100%',
          background: 'transparent',
          border: 'none',
          outline: 'none',
          resize: 'vertical',
          padding: '10px 12px',
          color: '#e7f1fb',
          fontFamily: 'Inter, system-ui, sans-serif',
          fontSize: 13.5,
          lineHeight: 1.7,
          letterSpacing: '0.01em',
          minHeight: rows * 22 + 20,
        }}
      />
    </div>
  )
}
