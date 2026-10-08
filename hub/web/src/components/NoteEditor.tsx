// NoteEditor.tsx — rich-text contenteditable editor (per-project, auto-saved to localStorage)
// Security: XSS-safe link/image/video insertion; YouTube iframe strictly by 11-char video ID only.
import { useCallback, useEffect, useRef, useState } from 'react'
import { showToast } from '../toast'

// ── security constants ──────────────────────────────────────────────────────
const SAFE_URL_RE = /^(https?|ftp|mailto):/i

// YouTube video ID is EXACTLY 11 chars (letters, digits, _ or -)
// Any match that is longer or shorter is rejected as false positive.
const YT_ID_STRICT = /^[A-Za-z0-9_-]{11}$/
// Anchored host check — prevents "fakeyoutube.com" substring bypass.
// Allows www/music/m subdomains; requires the path separator after host.
const YOUTUBE_HOST_RE = /^https?:\/\/(?:(?:www|music|m)\.)?youtube\.com\/|^https?:\/\/youtu\.be\//i
const YT_EXTRACT: RegExp[] = [
  /[?&]v=([A-Za-z0-9_-]{11})(?:[&?#]|$)/,
  /youtu\.be\/([A-Za-z0-9_-]{11})(?:[?#]|$)/,
  /youtube\.com\/embed\/([A-Za-z0-9_-]{11})(?:[?#]|$)/,
  /youtube\.com\/shorts\/([A-Za-z0-9_-]{11})(?:[?#]|$)/,
]
const VIDEO_EXT_RE = /\.(mp4|webm|ogg)(\?[^"]*)?$/i

const AUTOSAVE_MS = 600

// ── helpers ─────────────────────────────────────────────────────────────────

function storageKey(projectId: string) {
  return `note_editor_${projectId}`
}

function safeUrl(raw: string): string | null {
  const url = raw.trim()
  return SAFE_URL_RE.test(url) ? url : null
}

// Returns YouTube video ID (exactly 11 chars) or null.
// Guards: (1) YOUTUBE_HOST_RE anchors to exact host — prevents "fakeyoutube.com" bypass.
//         (2) YT_ID_STRICT enforces exactly 11 chars to reject false positives.
function getYouTubeId(url: string): string | null {
  if (!YOUTUBE_HOST_RE.test(url)) return null
  for (const pat of YT_EXTRACT) {
    const m = url.match(pat)
    if (m?.[1] && YT_ID_STRICT.test(m[1])) return m[1]
  }
  return null
}

// Escape characters that could break HTML attribute values
function escAttr(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

// ── types ────────────────────────────────────────────────────────────────────

type DialogType = 'link' | 'image' | 'video'
interface DialogState {
  type: DialogType
  url: string
  error: string
}

// ── component ────────────────────────────────────────────────────────────────

export default function NoteEditor({ projectId }: { projectId: string }) {
  const editorRef = useRef<HTMLDivElement>(null)
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const savedRange = useRef<Range | null>(null)
  const [dialog, setDialog] = useState<DialogState | null>(null)

  // Load saved content whenever project changes
  useEffect(() => {
    const el = editorRef.current
    if (!el) return
    el.innerHTML = localStorage.getItem(storageKey(projectId)) ?? ''
  }, [projectId])

  // Debounced auto-save to localStorage
  const scheduleAutoSave = useCallback(() => {
    if (saveTimer.current) clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(() => {
      const el = editorRef.current
      if (!el) return
      try {
        localStorage.setItem(storageKey(projectId), el.innerHTML)
      } catch {
        showToast('Không thể lưu — bộ nhớ đầy', 'error')
      }
    }, AUTOSAVE_MS)
  }, [projectId])

  const exportJSON = useCallback(() => {
    const content = editorRef.current?.innerHTML ?? ''
    const data = JSON.stringify({ projectId, content, exportedAt: new Date().toISOString() }, null, 2)
    triggerDownload(`note-${projectId}.json`, 'application/json', data)
  }, [projectId])

  const exportHTML = useCallback(() => {
    const content = editorRef.current?.innerHTML ?? ''
    const html = `<!DOCTYPE html>\n<html lang="vi">\n<head>\n<meta charset="UTF-8">\n<title>Note Export</title>\n<style>\nbody{font-family:Inter,system-ui,sans-serif;max-width:860px;margin:40px auto;padding:0 24px;line-height:1.6;color:#1a1a1a}\nimg,video,iframe{max-width:100%;border-radius:4px}\n</style>\n</head>\n<body>${content}</body>\n</html>`
    triggerDownload(`note-${projectId}.html`, 'text/html', html)
  }, [projectId])

  // Save current selection before opening dialog (dialog click steals focus)
  const saveSelection = () => {
    const sel = window.getSelection()
    if (sel && sel.rangeCount > 0) {
      savedRange.current = sel.getRangeAt(0).cloneRange()
    }
  }

  // Restore selection then run execCommand (used after dialog closes)
  const restoreAndExec = (cmd: string, value?: string) => {
    const el = editorRef.current
    if (!el) return
    el.focus()
    const sel = window.getSelection()
    if (savedRange.current && sel) {
      sel.removeAllRanges()
      sel.addRange(savedRange.current)
    }
    // eslint-disable-next-line @typescript-eslint/no-deprecated
    document.execCommand(cmd, false, value)
    scheduleAutoSave()
  }

  // Direct exec without selection restore (for toolbar buttons that don't open dialog)
  const exec = (cmd: string, value?: string) => {
    const el = editorRef.current
    if (!el) return
    el.focus()
    // eslint-disable-next-line @typescript-eslint/no-deprecated
    document.execCommand(cmd, false, value)
    scheduleAutoSave()
  }

  // Tab = indent list item; Shift+Tab = dedent
  const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Tab') {
      e.preventDefault()
      // eslint-disable-next-line @typescript-eslint/no-deprecated
      document.execCommand(e.shiftKey ? 'outdent' : 'indent', false)
      scheduleAutoSave()
    }
  }

  // ── dialog submit ──────────────────────────────────────────────────────────

  const submitDialog = () => {
    if (!dialog) return

    if (dialog.type === 'link') {
      const url = safeUrl(dialog.url)
      if (!url) {
        setDialog({ ...dialog, error: 'URL không hợp lệ — phải bắt đầu bằng http://, https://, hoặc mailto:' })
        return
      }
      restoreAndExec('createLink', url)
      setDialog(null)
      return
    }

    if (dialog.type === 'image') {
      const url = safeUrl(dialog.url)
      if (!url) {
        setDialog({ ...dialog, error: 'URL ảnh không hợp lệ — phải bắt đầu bằng http:// hoặc https://' })
        return
      }
      restoreAndExec('insertHTML', `<img src="${escAttr(url)}" alt="" style="max-width:100%;border-radius:4px">`)
      setDialog(null)
      return
    }

    if (dialog.type === 'video') {
      const raw = dialog.url.trim()

      // YouTube: extract ID strictly (exactly 11 chars) → safe embed URL only
      const ytId = getYouTubeId(raw)
      if (ytId) {
        restoreAndExec(
          'insertHTML',
          `<iframe width="560" height="315" ` +
          `src="https://www.youtube.com/embed/${escAttr(ytId)}" ` +
          `frameborder="0" allowfullscreen ` +
          `style="max-width:100%;display:block;border-radius:4px"></iframe>`
        )
        setDialog(null)
        return
      }

      // Direct video file (.mp4 / .webm / .ogg) — must be https/http
      const safeVideoUrl = safeUrl(raw)
      if (safeVideoUrl && VIDEO_EXT_RE.test(safeVideoUrl)) {
        restoreAndExec(
          'insertHTML',
          `<video src="${escAttr(safeVideoUrl)}" controls style="max-width:100%;display:block;border-radius:4px"></video>`
        )
        setDialog(null)
        return
      }

      setDialog({ ...dialog, error: 'URL không hợp lệ — nhập YouTube link hoặc URL .mp4/.webm/.ogg' })
    }
  }

  // ── render ─────────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* ── toolbar ── */}
      <div className="shrink-0 flex flex-wrap items-center gap-1 px-3 py-2 border-b border-line bg-panel/40">
        <ToolBtn title="Bold (Ctrl+B)" onClick={() => exec('bold')}><b>B</b></ToolBtn>
        <ToolBtn title="Italic (Ctrl+I)" onClick={() => exec('italic')}><i>I</i></ToolBtn>
        <ToolBtn title="Underline (Ctrl+U)" onClick={() => exec('underline')}><u>U</u></ToolBtn>
        <Sep />
        <ToolBtn title="Heading 1" onClick={() => exec('formatBlock', '<h1>')}>H1</ToolBtn>
        <ToolBtn title="Heading 2" onClick={() => exec('formatBlock', '<h2>')}>H2</ToolBtn>
        <Sep />
        <ToolBtn title="Unordered list" onClick={() => exec('insertUnorderedList')}>≡·</ToolBtn>
        <ToolBtn title="Ordered list" onClick={() => exec('insertOrderedList')}>1·</ToolBtn>
        <Sep />
        <ToolBtn title="Insert link" onClick={() => { saveSelection(); setDialog({ type: 'link', url: '', error: '' }) }}>🔗</ToolBtn>
        <ToolBtn title="Insert image" onClick={() => { saveSelection(); setDialog({ type: 'image', url: '', error: '' }) }}>🖼</ToolBtn>
        <ToolBtn title="Insert video" onClick={() => { saveSelection(); setDialog({ type: 'video', url: '', error: '' }) }}>🎬</ToolBtn>
        <div className="ml-auto flex items-center gap-1">
          <ToolBtn title="Export JSON" onClick={exportJSON}>↓J</ToolBtn>
          <ToolBtn title="Export HTML" onClick={exportHTML}>↓H</ToolBtn>
          <span className="text-[10px] text-inkfaint pl-1">auto-save</span>
        </div>
      </div>

      {/* ── editor area ── */}
      <div
        ref={editorRef}
        contentEditable
        suppressContentEditableWarning
        data-testid="note-editor"
        className="note-editor-body flex-1 min-h-0 overflow-auto p-4 focus:outline-none"
        onInput={scheduleAutoSave}
        onKeyDown={handleKeyDown}
      />

      {/* ── dialog overlay ── */}
      {dialog && (
        <div
          className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4"
          onKeyDown={(e) => { if (e.key === 'Escape') setDialog(null) }}
        >
          <div className="card p-5 w-full max-w-sm flex flex-col gap-3" onClick={(e) => e.stopPropagation()}>
            <div className="text-[14px] font-semibold text-ink">
              {dialog.type === 'link' ? '🔗 Chèn liên kết'
                : dialog.type === 'image' ? '🖼 Chèn ảnh'
                : '🎬 Chèn video'}
            </div>
            <input
              autoFocus
              className="input"
              placeholder={
                dialog.type === 'video'
                  ? 'YouTube URL hoặc .mp4 URL…'
                  : 'https://…'
              }
              value={dialog.url}
              onChange={(e) => setDialog({ ...dialog, url: e.target.value, error: '' })}
              onKeyDown={(e) => {
                if (e.key === 'Enter') { e.preventDefault(); submitDialog() }
                if (e.key === 'Escape') setDialog(null)
              }}
            />
            {dialog.error && (
              <div className="text-[12px] text-pink leading-snug">{dialog.error}</div>
            )}
            <div className="flex gap-2 justify-end">
              <button className="btn" onClick={() => setDialog(null)}>Huỷ</button>
              <button className="btn btn-primary" onClick={submitDialog}>Chèn</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ── sub-components ────────────────────────────────────────────────────────────

function ToolBtn({
  title,
  onClick,
  children,
}: {
  title: string
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      title={title}
      // onMouseDown + preventDefault keeps editor focus alive during toolbar click
      onMouseDown={(e) => { e.preventDefault(); onClick() }}
      className="btn btn-icon !w-8 !h-8 text-[13px]"
    >
      {children}
    </button>
  )
}

function Sep() {
  return <span className="w-px h-5 bg-line mx-0.5 shrink-0" />
}

function triggerDownload(filename: string, mimeType: string, content: string) {
  const blob = new Blob([content], { type: mimeType })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}
