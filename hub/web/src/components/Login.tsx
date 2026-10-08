import { useState } from 'react'
import { login } from '../api'

export default function Login({ onOk }: { onOk: () => void }) {
  const [pw, setPw] = useState('')
  const [code, setCode] = useState('')
  const [needCode, setNeedCode] = useState(false)
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  async function go() {
    if (busy || !pw) return
    setBusy(true); setErr('')
    try {
      const res = await login(pw, needCode ? code : undefined)
      if (res.ok) return onOk()
      if (res.need_code) { setNeedCode(true); setErr(res.bad_code ? 'Mã 2FA sai.' : '') }
      else setErr('Sai mật khẩu.')
    } catch { setErr('Không kết nối được server.') }
    setBusy(false)
  }
  return (
    <div className="h-[100dvh] grid place-items-center bg-bg text-ink px-4">
      <div className="card w-full max-w-sm p-8 flex flex-col items-center gap-5">
        <span className="relative inline-flex h-20 w-20 items-center justify-center">
          <span className="absolute inset-0 rounded-full animate-[lucy-pulse_2.4s_ease-in-out_infinite]" style={{ background: 'radial-gradient(circle, rgba(56,208,255,.5), transparent 70%)' }} />
          <img src="/lucy.jpg" alt="Lucy" className="relative h-16 w-16 rounded-full object-cover" style={{ border: '2px solid rgba(56,208,255,0.55)', boxShadow: '0 0 22px rgba(56,208,255,.5)' }} />
        </span>
        <div className="text-center">
          <div className="display text-3xl tracking-[0.36em] text-cyan" style={{ textShadow: '0 0 16px rgba(56,208,255,.5)' }}>LUCY</div>
          <div className="text-inkfaint text-xs mt-2 tracking-wide">{needCode ? 'nhập mã 2FA từ app Authenticator' : 'personal AI hub · đăng nhập'}</div>
        </div>
        {!needCode ? (
          <input type="password" value={pw} autoFocus onChange={(e) => setPw(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && go()} placeholder="mật khẩu" className="input text-center" />
        ) : (
          <input value={code} autoFocus inputMode="numeric" maxLength={6} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} onKeyDown={(e) => e.key === 'Enter' && go()} placeholder="000000" className="input text-center mono tracking-[0.5em] text-lg" />
        )}
        <button onClick={go} disabled={busy} className="btn btn-primary w-full">{busy ? 'Đang vào…' : needCode ? 'XÁC NHẬN' : 'ĐĂNG NHẬP'}</button>
        <div className="text-pink text-xs h-4">{err}</div>
      </div>
    </div>
  )
}
