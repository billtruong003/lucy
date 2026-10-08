// Smoke B — rate-guard (cross-process) + cred-pool (đa key) + quota (header). File-based, không LLM thật.
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'

let pass = 0, fail = 0
const check = (n: string, c: boolean, e = '') => { if (c) { pass++; console.log(`  ✅ ${n}`) } else { fail++; console.log(`  ❌ ${n} ${e}`) } }

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'smoke-B-'))
process.env.LUCY_STATE_DIR = tmp

const { guardedFor, markGuarded, guardSnapshot } = await import('./rate-guard')
const { keysFor, availableKeys, markKeyCooldown, hasAnyKey } = await import('./cred-pool')
const { recordQuota, quotaSnapshot, isNearlyExhausted } = await import('./quota')

console.log('🧪 smoke:provider-resilience — rate-guard + cred-pool + quota')

// ── rate-guard ──
const now = Date.now()
check('chưa mark → guardedFor = 0', guardedFor('groq', now) === 0)
markGuarded('groq', 60_000, 'HTTP 429', now)
check('sau mark → guardedFor > 0', guardedFor('groq', now + 1000) > 0)
check('guardedFor ~ còn lại đúng', Math.abs(guardedFor('groq', now + 1000) - 59_000) < 50)
check('hết hạn → guardedFor = 0', guardedFor('groq', now + 61_000) === 0)
// chỉ kéo dài, không rút ngắn
markGuarded('groq', 120_000, 'lần 2', now)
markGuarded('groq', 10_000, 'ngắn hơn', now)
check('mark ngắn hơn KHÔNG rút mốc xa', guardedFor('groq', now + 1000) > 100_000)
// cross-process: đọc lại từ file (mô phỏng process khác)
{
  const raw = JSON.parse(fs.readFileSync(path.join(tmp, 'rate-guard.json'), 'utf8'))
  check('state ghi ra FILE (process khác đọc được)', !!raw.groq && raw.groq.until > now)
}
check('guardSnapshot liệt kê provider đang guard', guardSnapshot(now).some((g) => g.provider === 'groq'))

// ── cred-pool ──
delete process.env.GROQ_API_KEY
check('không key → keysFor rỗng', keysFor('groq').length === 0)
check('không key → hasAnyKey false', !hasAnyKey('groq'))
process.env.GROQ_API_KEY = 'key_a'
process.env.GROQ_API_KEY_2 = 'key_b'
process.env.GROQ_API_KEY_3 = 'key_c'
check('đa key qua _2/_3 → keysFor = 3', keysFor('groq').length === 3, `(got ${keysFor('groq').length})`)
process.env.OPENROUTER_API_KEY = 'k1,k2,k3'
check('CSV trong 1 biến → tách thành nhiều key', keysFor('openrouter').length === 3)
// cooldown 1 key → availableKeys giảm
const t = Date.now()
markKeyCooldown('groq', 'key_a', 60_000, t)
check('cooldown 1 key → availableKeys = 2', availableKeys('groq', t + 1000).length === 2, `(got ${availableKeys('groq', t + 1000).length})`)
check('key cooldown hết hạn → quay lại đủ', availableKeys('groq', t + 61_000).length === 3)
// tất cả cooldown → rỗng
markKeyCooldown('groq', 'key_a', 60_000, t); markKeyCooldown('groq', 'key_b', 60_000, t); markKeyCooldown('groq', 'key_c', 60_000, t)
check('mọi key cooldown → availableKeys rỗng (→ provider guard)', availableKeys('groq', t + 1000).length === 0)
check('có key (kể cả cooldown) → hasAnyKey true', hasAnyKey('groq'))

// ── quota (parse header) ──
const hdr = (o: Record<string, string>) => new Headers(o)
recordQuota('gemini', hdr({ 'x-ratelimit-remaining-requests': '3', 'x-ratelimit-reset-requests': '120' }))
const q = quotaSnapshot().gemini
check('quota ghi remainingRequests từ header', q?.remainingRequests === 3, JSON.stringify(q))
check('quota suy resetAt (delta giây → epoch)', !!q?.resetAt && q.resetAt > Date.now())
check('isNearlyExhausted (3 ≤ 5) → true', isNearlyExhausted('gemini', 5))
check('isNearlyExhausted ngưỡng 2 → false', !isNearlyExhausted('gemini', 2))
recordQuota('mistral', hdr({ 'content-type': 'application/json' })) // không header quota
check('không header quota → KHÔNG ghi rác', quotaSnapshot().mistral === undefined)

console.log(`\n${fail === 0 ? '✅ ALL PASS' : '❌ FAIL'} — ${pass} pass, ${fail} fail`)
fs.rmSync(tmp, { recursive: true, force: true })
process.exit(fail === 0 ? 0 : 1)
