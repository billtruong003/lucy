// providers-cli — xem nhanh trạng thái nguồn model. npm run providers
// Output dạng # SECTION + pipe-delimited columns — Lucy-director parse được.
import { providerStatus, MODEL_CATALOG } from './llm-lane.js'
import type { Role } from './llm-lane.js'

function main(): void {
  // ── Provider Status ──
  const statuses = providerStatus()
  // Header + data lines (pipe-delimited)
  const provRows: string[] = ['# PROVIDERS', 'provider | label | status']
  for (const p of statuses) {
    provRows.push(`${p.provider} | ${p.label} | ${p.hasKey ? 'alive' : 'dead'}`)
  }
  // In bảng thẳng cột
  const pIdMax = Math.max(...statuses.map(p => p.provider.length))
  const pLblMax = Math.max(...statuses.map(p => p.label.length))
  for (let i = 0; i < provRows.length; i++) {
    const r = provRows[i]
    if (r.startsWith('#')) { console.log(r); continue }
    const [id, label, status] = r.split(' | ')
    console.log(`  ${id.padEnd(pIdMax)} | ${label.padEnd(pLblMax)} | ${status}`)
  }

  // ── Model Catalog (nhóm theo role) ──
  const roles: Role[] = ['executor', 'reasoning', 'fast', 'content']
  const mdlRows: string[] = ['# MODELS', '.key | .label | .provider | .free | .ctx | .note']
  for (const role of roles) {
    const entries = MODEL_CATALOG.filter(m => m.role === role)
    if (!entries.length) continue
    mdlRows.push(`. ${role}`)
    for (const m of entries) {
      const ctx = m.ctx ?? ''
      const note = m.note ?? ''
      mdlRows.push(`${m.key} | ${m.label} | ${m.provider} | ${m.free ? 'free' : 'paid'} | ${ctx} | ${note}`)
    }
  }
  // In bảng thẳng cột
  const mKeyMax = Math.max(...MODEL_CATALOG.map(m => m.key.length))
  const mLblMax = Math.max(...MODEL_CATALOG.map(m => m.label.length))
  const mProvMax = Math.max(...MODEL_CATALOG.map(m => m.provider.length))
  for (const r of mdlRows) {
    if (r.startsWith('#')) { console.log(r); continue }
    if (r.startsWith('. ') && !r.includes(' | ')) { console.log(`\n  [${r.slice(2)}]`); continue }
    const [key, label, provider, free, ctx, note] = r.split(' | ')
    const ctxPad = ctx ? `  ctx:${ctx}` : ''
    const notePad = note ? `  (${note})` : ''
    console.log(`    ${key.padEnd(mKeyMax)} | ${label.padEnd(mLblMax)} | ${provider.padEnd(mProvMax)} | ${free}${ctxPad}${notePad}`)
  }
}

main()
