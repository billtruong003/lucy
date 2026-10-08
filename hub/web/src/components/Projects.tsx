import { EmptyState } from './ui'
import { useEffect, useState } from 'react'
import { tree, readFile, type Entry } from '../api'
import Markdown from './Markdown'

type FileView = { name?: string; content?: string; binary?: boolean; tooBig?: boolean; size?: number }

export default function Projects() {
  const [path, setPath] = useState('.')
  const [root, setRoot] = useState('')
  const [entries, setEntries] = useState<Entry[]>([])
  const [file, setFile] = useState<FileView | null>(null)

  function load(p: string) {
    tree(p).then((d) => { if (d.entries) { setPath(d.path); setRoot(d.root); setEntries(d.entries); setFile(null) } })
  }
  useEffect(() => { load('.') }, [])

  function open(e: Entry) {
    const np = path === '.' ? e.name : path + '/' + e.name
    if (e.type === 'dir') load(np)
    else readFile(np).then((d) => setFile({ name: e.name, ...d }))
  }
  function up() { if (path === '.') return; const parts = path.split('/'); parts.pop(); load(parts.join('/') || '.') }

  const crumbs = path === '.' ? ['~'] : ['~', ...path.split('/')]

  return (
    <div className="h-full flex">
      {/* TREE */}
      <aside className="w-44 sm:w-72 shrink-0 border-r border-line overflow-auto p-2 sm:p-3 bg-panel/30">
        <div className="text-[10px] text-inkfaint mb-2 truncate mono" title={root}>{root || '…'}</div>
        {path !== '.' && (
          <button onClick={up} className="flex items-center gap-2 w-full text-left rounded-lg px-2 py-1.5 text-sm text-inkdim hover:text-cyan hover:bg-white/[0.03]">↩ lên thư mục</button>
        )}
        <div className="mt-1 flex flex-col">
          {entries.map((e) => (
            <button key={e.name} onClick={() => open(e)}
              className={'flex items-center gap-2 w-full text-left rounded-lg px-2 py-1.5 text-sm truncate hover:bg-white/[0.04] ' + (file?.name === e.name ? 'text-cyan bg-cyan/10' : 'text-inkdim hover:text-ink')}>
              <span className="opacity-80">{e.type === 'dir' ? '📂' : '📄'}</span> {e.name}
            </button>
          ))}
        </div>
      </aside>

      {/* VIEWER */}
      <div className="flex-1 overflow-auto p-5 min-w-0">
        <div className="flex items-center gap-1 text-xs text-inkfaint mb-3 mono flex-wrap">
          {crumbs.map((c, i) => <span key={i}>{i > 0 && <span className="opacity-50"> / </span>}{c}</span>)}
        </div>
        {!file && <EmptyState title="Chọn file để xem" hint="Duyệt cây mã nguồn bên trái." />}
        {file?.binary && <div className="card p-4 text-inkfaint text-sm">🖼️ {file.name} — binary ({Math.round((file.size || 0) / 1024)} KB), không hiển thị.</div>}
        {file?.tooBig && <div className="card p-4 text-inkfaint text-sm">{file.name} — quá lớn ({Math.round((file.size || 0) / 1024)} KB).</div>}
        {file && !file.binary && !file.tooBig && file.content != null && (
          <div className="card p-4">
            <div className="flex items-center gap-2 text-cyan text-sm mb-3 pb-2 border-b border-line">📄 {file.name}</div>
            {file.name?.endsWith('.md')
              ? <Markdown>{file.content}</Markdown>
              : <pre className="mono text-xs text-cyan/90 whitespace-pre-wrap break-words leading-relaxed">{file.content}</pre>}
          </div>
        )}
      </div>
    </div>
  )
}
