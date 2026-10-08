import { EmptyState, ErrorState } from './ui'
import { useEffect, useState } from 'react'
import { amMcp, type McpServerInfo, type McpUiState } from '../api'

// T5 — tab "Kết nối": liệt kê MCP server (Tay của Lucy) + trạng thái + hướng dẫn bật.
// READ-ONLY: bật/tắt là env-flag ở worker (đổi runtime cần restart) → UI hiện trạng thái + lệnh bật, không toggle giả.

const STATE_TONE: Record<McpUiState, string> = {
  live: 'text-grn border-grn/40',
  'needs-creds': 'text-gold border-gold/40',
  disabled: 'text-inkfaint border-ink/30',
  'master-off': 'text-inkfaint border-ink/30',
  tripped: 'text-rose border-rose/40',
}
const STATE_LABEL: Record<McpUiState, string> = {
  live: '● live',
  'needs-creds': '○ chờ creds',
  disabled: '○ tắt (flag)',
  'master-off': '○ master tắt',
  tripped: '✕ lỗi (breaker)',
}
const SCOPE_ICON: Record<string, string> = { fs: '📁', web: '🌐', git: '🔧', memory: '🧠', github: '🐙', google: '📧', notion: '📝' }

export default function Connect() {
  const [servers, setServers] = useState<McpServerInfo[]>([])
  const [masterOn, setMasterOn] = useState(false)
  const [configured, setConfigured] = useState(true)
  const [loading, setLoading] = useState(true)
  const [open, setOpen] = useState<string | null>(null)

  const load = () => amMcp().then((d) => {
    setConfigured(d.configured !== false)
    setMasterOn(!!d.masterOn)
    setServers(d.servers || [])
  }).catch(() => { }).finally(() => setLoading(false))
  useEffect(() => { load() }, [])

  const connected = servers.filter((s) => s.state === 'live')
  const available = servers.filter((s) => s.state !== 'live')
  const live = connected.length

  const ServerCard = (s: McpServerInfo) => {
    const isOpen = open === s.id
    return (
      <div key={s.id} className={'reveal-host glass glass-hover p-4 flex flex-col gap-2 cursor-default ' + (s.state === 'live' ? 'border-grn/30' : '')}>
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <span className="text-[18px] leading-none">{SCOPE_ICON[s.id] || '🔌'}</span>
            <div className="min-w-0">
              <div className="font-semibold truncate">{s.title}</div>
              <div className="num text-[10px] text-inkfaint">id: {s.id} · {s.scopeLabel}</div>
            </div>
          </div>
          <span className={'chip num text-[10px] shrink-0 ' + STATE_TONE[s.state]}>{STATE_LABEL[s.state]}</span>
        </div>

        <div className="flex gap-1 flex-wrap">
          {s.status === 'scaffold' && <span className="chip num text-[9px] text-gold border-gold/40">scaffold</span>}
          {s.scopes.map((sc) => <span key={sc} className="chip num text-[9px]">{sc}</span>)}
          {s.envKeys.map((k) => (
            <span key={k} className={'chip num text-[9px] ' + (s.credsMissing.includes(k) ? 'text-rose border-rose/40' : 'text-grn border-grn/40')}>
              {s.credsMissing.includes(k) ? '✕ ' : '✓ '}{k}
            </span>
          ))}
        </div>

        {!!s.doc && (
          <button onClick={() => setOpen(isOpen ? null : s.id)} className="text-[11px] text-cyan text-left hover:underline">
            {isOpen ? '▾ Ẩn hướng dẫn' : '▸ Cách bật'}
          </button>
        )}
        {isOpen && <div className="text-[11px] text-inkdim leading-relaxed whitespace-pre-wrap">{s.doc}</div>}
      </div>
    )
  }

  return (
    <div className="h-full overflow-auto px-4 sm:px-6 py-5">
      <div className="max-w-5xl mx-auto">
        <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="chip">{servers.length} server</span>
            <span className={'chip num ' + (masterOn ? 'text-grn border-grn/40' : 'text-inkfaint border-ink/30')}>
              {masterOn ? `LUCY_MCP on · ${live} live` : 'LUCY_MCP tắt'}
            </span>
            <span className="text-[11px] text-inkfaint">Cái “tay” của Lucy — MCP tool (file · web · git · trí nhớ · GitHub · Notion…)</span>
          </div>
          <button onClick={() => { setLoading(true); load() }} className="btn">↻ Tải lại</button>
        </div>

        {!masterOn && (
          <div className="card p-3 mb-4 text-[12px] text-inkdim flex flex-col gap-1">
            <span className="text-gold">⚠ Master MCP đang TẮT (live an toàn).</span>
            <span>Bật: đặt <code className="num text-cyan">LUCY_MCP=1</code> trong env worker rồi restart <code className="num">lucy-vps-worker</code>. Từng server bật riêng: <code className="num text-cyan">LUCY_MCP_&lt;ID&gt;=on</code>.</span>
          </div>
        )}

        {loading && <div className="text-inkfaint text-sm">Đang tải…</div>}
        {!loading && !configured && <div className="text-inkfaint text-sm">Agent-Machine chưa cấu hình (AM_COORD_URL).</div>}

        {/* S3/E3.5 — nhóm Connected (đang sống) vs Available (chờ bật/creds) */}
        {connected.length > 0 && (
          <div className="mb-5">
            <div className="text-[12px] text-grn mb-2 flex items-center gap-2">
              <span className="h-1.5 w-1.5 rounded-full bg-grn" style={{ boxShadow: '0 0 6px #5fe39a' }} />
              Đang kết nối ({connected.length})
            </div>
            <div className="grid gap-3 md:grid-cols-2">{connected.map(ServerCard)}</div>
          </div>
        )}
        {available.length > 0 && (
          <div>
            <div className="text-[12px] text-inkdim mb-2">Có sẵn — chờ bật / creds ({available.length})</div>
            <div className="grid gap-3 md:grid-cols-2">{available.map(ServerCard)}</div>
          </div>
        )}
        {!loading && configured && servers.length === 0 && (
          <EmptyState title="Chưa có MCP server nào" />
        )}
      </div>
    </div>
  )
}
