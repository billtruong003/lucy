import { useEffect, useState } from 'react'
import { getReduceFx, setReduceFx } from '../fx'

type Provider = { provider: string; label: string; hasKey: boolean }
type Model = { key: string; label: string; provider: string; model: string; role: string; free: boolean; ctx?: string; note?: string }
type LlmData = { providers: Provider[]; catalog: Model[] }

const ROLES = ['executor', 'reasoning', 'fast', 'content'] as const
type Role = (typeof ROLES)[number]

const ROLE_META: Record<Role, { label: string; desc: string }> = {
  executor:  { label: 'Executor',  desc: 'Coding / agentic — task nặng, tool-calling' },
  reasoning: { label: 'Reasoning', desc: 'Suy luận sâu, bài toán phức tạp' },
  fast:      { label: 'Fast',      desc: 'Việc nhẹ / phân loại / draft nhanh' },
  content:   { label: 'Content',   desc: 'Viết / tóm tắt / dịch' },
}

export default function Settings() {
  const [enabled, setEnabled] = useState<boolean | null>(null)
  const [qr, setQr] = useState('')
  const [secret, setSecret] = useState('')
  const [code, setCode] = useState('')
  const [msg, setMsg] = useState('')

  const [reduceFx, setReduceFxState] = useState<boolean>(() => getReduceFx())
  const toggleFx = () => { const v = !reduceFx; setReduceFxState(v); setReduceFx(v) }

  // S4/E2: bật/tắt trang chủ Reactor (thử nghiệm). App đọc flag lúc mount → reload để áp dụng.
  const [reactorHome, setReactorHome] = useState<boolean>(() => localStorage.getItem('lucy.reactorHome') === '1')
  const toggleReactor = () => {
    const v = !reactorHome
    setReactorHome(v)
    localStorage.setItem('lucy.reactorHome', v ? '1' : '0')
    setTimeout(() => location.reload(), 250)
  }

  const [llm, setLlm] = useState<LlmData | null>(null)
  const [llmLoading, setLlmLoading] = useState(false)
  const [checkedAt, setCheckedAt] = useState<Date | null>(null)
  const [activeRole, setActiveRole] = useState<Role>('executor')
  const [execModel, setExecModel] = useState<string>(() => localStorage.getItem('lucy.executorModel') || 'executor')

  const pickModel = (k: string) => { setExecModel(k); localStorage.setItem('lucy.executorModel', k) }

  const loadLlm = async () => {
    setLlmLoading(true)
    try {
      const d: LlmData = await fetch('/api/llm/models').then(r => r.json())
      if (d?.catalog) { setLlm(d); setCheckedAt(new Date()) }
    } finally { setLlmLoading(false) }
  }

  const load2fa = () =>
    fetch('/api/2fa/status').then(r => r.json()).then(d => setEnabled(!!d.enabled)).catch(() => setEnabled(false))

  useEffect(() => { load2fa(); loadLlm() }, [])

  async function setup() {
    setMsg('')
    const r = await fetch('/api/2fa/setup', { method: 'POST' })
    const d = await r.json()
    setQr(d.qr); setSecret(d.secret)
  }
  async function enable() {
    const r = await fetch('/api/2fa/enable', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ code }) })
    if (r.ok) { setQr(''); setSecret(''); setCode(''); setMsg('✓ Đã bật 2FA. Lần sau đăng nhập cần mã.'); load2fa() }
    else setMsg('✗ Mã sai, thử lại.')
  }
  async function disable() {
    const r = await fetch('/api/2fa/disable', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ code }) })
    if (r.ok) { setCode(''); setMsg('Đã tắt 2FA.'); load2fa() }
    else setMsg('✗ Mã sai.')
  }

  const aliveCount = llm ? llm.providers.filter(p => p.hasKey).length : 0
  const activeModels = llm ? llm.catalog.filter(m => m.role === activeRole) : []
  const selectedModel = llm && execModel !== 'executor' ? llm.catalog.find(m => m.key === execModel) ?? null : null
  const selectedProvider = selectedModel ? llm?.providers.find(p => p.provider === selectedModel.provider) : null
  const fmtTime = (d: Date) => d.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })

  return (
    <div className="h-full overflow-auto px-4 sm:px-6 py-5">
      <div className="max-w-2xl mx-auto flex flex-col gap-4">

        {/* ── S1/U0: Hiệu ứng & a11y ── */}
        <div className="card p-5">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-lg">✨</span>
            <h3 className="hud-lbl !text-[12px]">HIỆU ỨNG & TRỢ NĂNG</h3>
            <span className={'chip ml-auto ' + (reduceFx ? 'text-grn border-grn/40' : 'text-inkfaint')}>
              {reduceFx ? 'GỌN NHẸ' : 'ĐẦY ĐỦ'}
            </span>
          </div>
          <p className="text-[12px] text-inkdim mb-4">
            Bật "giảm hiệu ứng" để tắt animation, chuyển glass sang nền đặc và gỡ backdrop-blur —
            đỡ chóng mặt + nhẹ GPU trên máy yếu. Cài đặt hệ thống (reduced-motion / transparency / contrast) luôn được tôn trọng riêng.
          </p>
          <button
            onClick={toggleFx}
            className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg border border-line hover:border-cyan/30 hover:bg-white/[0.02] transition-colors text-left"
            aria-pressed={reduceFx}
          >
            <span className="switch" data-on={reduceFx} />
            <span className="flex-1 min-w-0">
              <span className="block text-[13px] text-ink">Giảm hiệu ứng (reduce effects)</span>
              <span className="block text-[11px] text-inkfaint">Tắt motion · glass→đặc · không blur</span>
            </span>
          </button>

          {/* S4/E2: trang chủ Reactor (thử nghiệm, flag-gated) */}
          <button
            onClick={toggleReactor}
            className="w-full flex items-center gap-3 px-3 py-2.5 mt-2 rounded-lg border border-line hover:border-gold/30 hover:bg-white/[0.02] transition-colors text-left"
            aria-pressed={reactorHome}
          >
            <span className="switch" data-on={reactorHome} />
            <span className="flex-1 min-w-0">
              <span className="block text-[13px] text-ink">Trang chủ Reactor ⚛️ (thử nghiệm)</span>
              <span className="block text-[11px] text-inkfaint">Hero arc-reactor + vòng đo metric thật · tải lại trang khi đổi</span>
            </span>
          </button>
        </div>

        {/* ── 2FA ── */}
        <div className="card p-5">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-lg">🔐</span>
            <h3 className="hud-lbl !text-[12px]">XÁC THỰC 2 LỚP (2FA)</h3>
            <span className={'chip ml-auto ' + (enabled ? 'text-grn border-grn/40' : 'text-inkfaint')}>
              {enabled === null ? '…' : enabled ? 'ĐANG BẬT' : 'TẮT'}
            </span>
          </div>
          <p className="text-[12px] text-inkdim mb-4">Bảo vệ hub bằng mã TOTP (Google Authenticator / Authy / 1Password). Cần thiết trước khi mở ra internet.</p>

          {enabled === false && !qr && (
            <button onClick={setup} className="btn btn-primary">Bật 2FA</button>
          )}
          {qr && (
            <div className="flex flex-col items-center gap-3 border border-line rounded-xl p-4">
              <div className="text-[12px] text-inkdim text-center">Quét QR bằng app Authenticator, rồi nhập mã 6 số để xác nhận:</div>
              <img src={qr} alt="2FA QR" className="w-44 h-44 rounded-lg bg-white/5" />
              <div className="mono text-[11px] text-inkfaint break-all text-center">key: {secret}</div>
              <input className="input text-center mono tracking-[0.4em]" maxLength={6} inputMode="numeric" placeholder="000000" value={code} onChange={e => setCode(e.target.value.replace(/\D/g, ''))} />
              <button onClick={enable} className="btn btn-primary w-full">Xác nhận & bật</button>
            </div>
          )}
          {enabled && (
            <div className="flex flex-col gap-2 border border-line rounded-xl p-4">
              <div className="text-[12px] text-inkdim">Tắt 2FA — nhập mã hiện tại để xác nhận:</div>
              <div className="flex gap-2">
                <input className="input text-center mono tracking-[0.4em]" maxLength={6} inputMode="numeric" placeholder="000000" value={code} onChange={e => setCode(e.target.value.replace(/\D/g, ''))} />
                <button onClick={disable} className="btn text-pink/90 border-pink/40 shrink-0">Tắt 2FA</button>
              </div>
            </div>
          )}
          {msg && <div className="text-[12px] mt-3 text-cyan">{msg}</div>}
        </div>

        {/* ── Provider Health ── */}
        <div className="card p-5">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-lg">🔌</span>
            <h3 className="hud-lbl !text-[12px]">NGUỒN API</h3>
            <span className={'chip ' + (llm ? (aliveCount > 0 ? 'text-grn border-grn/40' : 'text-pink border-pink/40') : 'text-inkfaint')}>
              {llm ? `${aliveCount}/${llm.providers.length} alive` : '…'}
            </span>
            <button
              onClick={loadLlm}
              disabled={llmLoading}
              title="Refresh"
              className="btn btn-icon ml-auto text-inkdim hover:text-cyan"
            >
              <svg
                width="14" height="14" viewBox="0 0 16 16" fill="none"
                stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
                style={llmLoading ? { animation: 'lucy-spin 0.7s linear infinite' } : undefined}
              >
                <path d="M13.5 4A6 6 0 1 0 14 8" />
                <polyline points="14,1 14,5 10,5" />
              </svg>
            </button>
          </div>
          <p className="text-[12px] text-inkdim mb-4">
            Key quản tại <span className="mono">.env.llm</span> — không lộ ra đây.{' '}
            <span className="text-pink/80">claude -p (não) vẫn đi thẳng Anthropic.</span>
          </p>

          {!llm && !llmLoading && (
            <div className="text-[12px] text-inkfaint">Không tải được — cần AM_COORD_URL.</div>
          )}
          {llmLoading && !llm && (
            <div className="text-[12px] text-inkfaint">Đang kiểm tra…</div>
          )}
          {llm && (
            <>
              <div className="grid grid-cols-2 gap-1.5">
                {llm.providers.map(p => (
                  <div
                    key={p.provider}
                    className={'flex items-center gap-2.5 px-3 py-2 rounded-lg border transition-colors ' +
                      (p.hasKey ? 'border-grn/25 bg-grn/[0.05]' : 'border-line bg-transparent')}
                  >
                    <span className={'text-[10px] leading-none ' + (p.hasKey ? 'text-grn' : 'text-inkfaint')}>●</span>
                    <span className={'text-[13px] ' + (p.hasKey ? 'text-ink' : 'text-inkfaint')}>{p.label}</span>
                    <span className={'chip ml-auto text-[10px] ' + (p.hasKey ? 'text-grn border-grn/40' : 'text-inkfaint border-line')}>
                      {p.hasKey ? 'alive' : 'no key'}
                    </span>
                  </div>
                ))}
              </div>
              {checkedAt && (
                <div className="mono text-[10px] text-inkfaint mt-3 text-right">
                  checked {fmtTime(checkedAt)}
                </div>
              )}
            </>
          )}
        </div>

        {/* ── Model Catalog ── */}
        {llm && (
          <div className="card p-5">
            <div className="flex items-center gap-2 mb-4">
              <span className="text-lg">📋</span>
              <h3 className="hud-lbl !text-[12px]">MODEL CATALOG</h3>
              <span className="chip ml-auto text-inkfaint">{llm.catalog.length} model</span>
            </div>

            <div className="flex gap-1.5 flex-wrap mb-3">
              {ROLES.map(role => {
                const count = llm.catalog.filter(m => m.role === role).length
                const isActive = activeRole === role
                return (
                  <button
                    key={role}
                    onClick={() => setActiveRole(role)}
                    className={
                      'chip cursor-pointer transition-colors ' +
                      (isActive
                        ? 'text-cyan border-cyan/50 bg-cyan/[0.07]'
                        : 'text-inkfaint border-line hover:text-ink hover:border-line/80')
                    }
                  >
                    {ROLE_META[role].label}
                    <span className="opacity-50 text-[10px] ml-0.5">{count}</span>
                  </button>
                )
              })}
            </div>
            <p className="text-[11px] text-inkdim mb-3">{ROLE_META[activeRole].desc}</p>

            <div className="flex flex-col gap-1">
              {activeModels.map(m => {
                const prov = llm.providers.find(p => p.provider === m.provider)
                return (
                  <div
                    key={m.key}
                    className="flex items-center gap-2 px-3 py-2.5 rounded-lg border border-line/60 hover:border-line hover:bg-white/[0.02] transition-colors"
                  >
                    <span className="text-[13px] text-ink flex-1 min-w-0 truncate">{m.label}</span>
                    <span className={'chip text-[10px] shrink-0 ' + (prov?.hasKey ? 'text-cyan/80 border-cyan/25' : 'text-inkfaint border-line/60 opacity-60')}>
                      {m.provider}
                    </span>
                    <span className={'chip text-[10px] shrink-0 ' + (m.free ? 'text-grn/80 border-grn/25' : 'text-pink/60 border-pink/20')}>
                      {m.free ? 'free' : 'paid'}
                    </span>
                    {m.ctx && (
                      <span className="mono text-[10px] text-inkfaint shrink-0">{m.ctx}</span>
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        )}

        {/* ── Executor Picker ── */}
        {llm && (
          <div className="card p-5">
            <div className="flex items-center gap-2 mb-1">
              <span className="text-lg">⚡</span>
              <h3 className="hud-lbl !text-[12px]">EXECUTOR MẶC ĐỊNH</h3>
            </div>
            <p className="text-[12px] text-inkdim mb-4">
              Model chạy card nặng / bulk. Lưu vào localStorage — mỗi browser nhớ riêng.
            </p>

            <select className="input mb-3" value={execModel} onChange={e => pickModel(e.target.value)}>
              <option value="executor">⚡ Auto — executor role + fallback chain</option>
              {ROLES.map(role => (
                <optgroup key={role} label={ROLE_META[role].label}>
                  {llm.catalog.filter(m => m.role === role).map(m => (
                    <option key={m.key} value={m.key}>
                      {m.label} · {m.free ? 'free' : 'paid'} ({m.provider})
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>

            {selectedModel ? (
              <div className="border border-cyan/20 rounded-xl px-4 py-3 bg-cyan/[0.04] flex flex-col gap-1.5">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-[13px] text-ink">{selectedModel.label}</span>
                  <span className={'chip text-[10px] ' + (selectedProvider?.hasKey ? 'text-grn border-grn/40' : 'text-pink border-pink/40')}>
                    {selectedProvider?.hasKey ? '● alive' : '○ no key'}
                  </span>
                  <span className={'chip ml-auto text-[10px] ' + (selectedModel.free ? 'text-grn/80 border-grn/25' : 'text-pink/60 border-pink/20')}>
                    {selectedModel.free ? 'free' : 'paid'}
                  </span>
                </div>
                {selectedModel.note && (
                  <div className="text-[11px] text-inkdim">{selectedModel.note}</div>
                )}
                <div className="mono text-[10px] text-inkfaint">{selectedModel.model}</div>
              </div>
            ) : (
              <div className="border border-line rounded-xl px-4 py-3 bg-white/[0.02]">
                <div className="text-[12px] text-inkdim">Auto: thử lần lượt executor fallback chain cho tới khi có kết quả.</div>
              </div>
            )}
          </div>
        )}

      </div>
    </div>
  )
}
