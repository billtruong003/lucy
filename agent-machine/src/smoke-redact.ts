// smoke-redact — BẢO MẬT: verify scrubSecrets() giấu key/token nhưng KHÔNG đụng văn xuôi thường.
//   npm run smoke:redact
import { scrubSecrets } from './redact'

let fails = 0
const check = (name: string, ok: boolean, detail = '') => {
  console.log(`${ok ? '✅' : '❌'} ${name}${detail ? ` — ${detail}` : ''}`)
  if (!ok) fails++
}
const hidden = (s: string) => scrubSecrets(s).includes('[REDACTED]')
const intact = (s: string) => scrubSecrets(s) === s

// ── PHẢI redact ──
check('jina key', hidden('key là jina_1234567890abcdefghijABCDEF token'))
check('openai sk-', hidden('OPENAI=sk-proj-abcdEFGH1234ijklMNOP5678qrst'))
check('github ghp_', hidden('dùng ghp_AbCdEf0123456789AbCdEf0123456789xyz'))
check('Bearer token', hidden('Authorization: Bearer eyJhbGciOiJIUzI1Nidef.payload.sig'))
check('FOO_API_KEY=', hidden('export MY_API_KEY=supersecretvalue123'))
check('TOKEN=', hidden('COORD_TOKEN: abc123XYZsecret'))
check('AWS AKIA', hidden('aws AKIAIOSFODNN7EXAMPLE creds'))
check('xoxb slack', hidden('slack xoxb-1234-5678-abcdEFGHijkl'))
check('long base64 token', hidden('blob=YWxhZGRpbjpvcGVuc2VzYW1lQUJDabcXYZ0123456789plusMore=='))
check('giữ tên biến khi =value', scrubSecrets('MY_API_KEY=topsecretlongvalue').startsWith('MY_API_KEY=[REDACTED]'))

// ── KHÔNG được đụng văn xuôi/đời thường ──
check('câu tiếng Việt thường', intact('Chủ nhân muốn em báo cáo giá BTC và vàng mỗi sáng nhé.'))
check('câu tiếng Anh thường', intact('The gold breakout above the key level looks strong today.'))
check('git sha hex 40 (toàn thường+số) KHÔNG redact', intact('commit 3d7e16eabc1234567890abcdef1234567890abcd done'))
check('số/giá KHÔNG redact', intact('RSI 70, giá 105000 USD, lãi suất 4.5%'))
check('câu có chữ token-nhỏ KHÔNG redact', intact('token này là gì hả em'))

// ── idempotent ──
const once = scrubSecrets('jina_1234567890abcdefghijABCDEF')
check('idempotent (chạy 2 lần == 1 lần)', scrubSecrets(once) === once)

console.log(fails ? `\n❌ ${fails} fail` : '\n✅ smoke-redact PASS')
process.exit(fails ? 1 : 0)
