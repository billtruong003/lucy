// Smoke: C1-fix dedup — verify notify.ts xử lý đúng 2 case:
// (1) same key + same retryAfterMs → suppress (dedup câm)
// (2) same key + retryAfterMs đổi → fire lại
// Nếu fail → rework engineer.

import fs from 'node:fs'
import path from 'node:path'

let pass = 0
let fail = 0
function check(name: string, cond: boolean, detail = '') {
  if (cond) { pass++; console.log(`  ✅ ${name}`) }
  else { fail++; console.log(`  ❌ ${name}${detail ? ' — ' + detail : ''}`) }
}

// ── 1. Source-level: notify.ts phải có Map-based dedup ──
console.log('── CHECK 1: notify.ts có Map dedup ──')
const src = fs.readFileSync(path.join(process.cwd(), 'src', 'notify.ts'), 'utf8')

const hasMap = /new Map\b/.test(src)
check('notify.ts dùng Map (không phải Set/boolean) để dedup', hasMap)

const trackRetryAfter = /\.get\(.*\)|\.set\(.*retryAfter/i.test(src) || /lastRetry|seenRetry|retryMap|dedupMap/i.test(src)
check('notify.ts track giá trị retryAfter trong Map', trackRetryAfter)

// ── 2. Runtime: mock fetch rồi gọi notifyRateLimitParked ──
console.log('\n── CHECK 2: runtime dedup (mock fetch) ──')

let fetchCount = 0
const origFetch = (globalThis as any).fetch
;(globalThis as any).fetch = async (..._args: unknown[]) => {
  fetchCount++
  return { ok: true } as Response
}

// Đặt env để không bị skip vì thiếu token
process.env.TELEGRAM_BOT_TOKEN = 'test-token'
process.env.LUCY_ALLOWED_USER_ID = '12345'

async function runCase2() {
  // Import sau khi set env (module cache nên gọi lại hàm trực tiếp)
  const mod = await import('./notify.js').catch(() => null)
  if (!mod) {
    check('CASE 1: import notify.ts thành công', false, 'import thất bại')
    check('CASE 2: import notify.ts thành công', false, 'import thất bại')
    return
  }
  const { notifyRateLimitParked } = mod

  // CASE 1: same key + same retryAfterMs → dedup (chỉ 1 fetch)
  fetchCount = 0
  await notifyRateLimitParked(1_800_000, 'provider X — same')
  await notifyRateLimitParked(1_800_000, 'provider X — same')
  check(
    'CASE 1: same retryAfterMs 1800000 → dedup (1 fetch)',
    fetchCount === 1,
    `fetchCount=${fetchCount} (expect 1)`
  )

  // CASE 2: same detail/key + retryAfterMs ĐỔI → fire lại (2 fetch)
  fetchCount = 0
  await notifyRateLimitParked(1_800_000, 'provider X — changed')
  await notifyRateLimitParked(3_600_000, 'provider X — changed')  // gia hạn lên 60ph
  check(
    'CASE 2: retryAfterMs tăng 1800000→3600000 → notify lại (2 fetch)',
    fetchCount === 2,
    `fetchCount=${fetchCount} (expect 2)`
  )

  // CASE 3: reset sau khi gọi key khác → không leak state
  fetchCount = 0
  await notifyRateLimitParked(600_000, 'provider Y')
  await notifyRateLimitParked(600_000, 'provider Y')
  check(
    'CASE 3: provider Y (key mới) dedup đúng (1 fetch)',
    fetchCount === 1,
    `fetchCount=${fetchCount} (expect 1)`
  )
}

runCase2()
  .then(() => {
    // Restore
    ;(globalThis as any).fetch = origFetch
    console.log(`\n${fail === 0 ? '✅ GATE PASS' : `❌ GATE FAIL — ${fail} fail`} — ${pass} pass, ${fail} fail`)
    if (fail > 0) process.exit(1)
  })
  .catch((e) => {
    ;(globalThis as any).fetch = origFetch
    console.error('Fatal:', e)
    process.exit(1)
  })
