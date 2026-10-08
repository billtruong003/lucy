// redact.ts — BẢO MẬT: scrub secret khỏi text TRƯỚC khi (1) embed gửi Jina hoặc (2) ghi episodic turn.
// Mục tiêu: key/token KHÔNG bao giờ rời máy qua API embedding bên thứ 3, KHÔNG lọt vào memory.db turns.
// Conservative: chỉ thay pattern giống secret thật → [REDACTED]; văn xuôi thường KHÔNG bị đụng (tránh false-positive).
// Mirror 1-1 với scrub_secrets() (bridge lucy_bridge.py) và scrubSecrets() (hub/server) — sửa 1 chỗ nhớ đồng bộ 3.

type Rule = { re: RegExp; repl: string }

// Thứ tự QUAN TRỌNG: bắt prefix-token + KEY=value TRƯỚC, rule base64 dài (rộng nhất) ĐỂ CUỐI.
const RULES: Rule[] = [
  // Bearer <token>
  { re: /\bBearer\s+[A-Za-z0-9._\-]{8,}/gi, repl: 'Bearer [REDACTED]' },
  // provider key prefixes: sk-/rk-/pk- (OpenAI/Anthropic/Stripe), jina_, ghp_/gho_/ghs_/ghr_/github_pat_, xoxb-…, AKIA…
  { re: /\b(?:sk|rk|pk)-[A-Za-z0-9_\-]{16,}/g, repl: '[REDACTED]' },
  { re: /\bjina_[A-Za-z0-9]{16,}/g, repl: '[REDACTED]' },
  { re: /\b(?:ghp|gho|ghs|ghr|github_pat)_[A-Za-z0-9_]{16,}/g, repl: '[REDACTED]' },
  { re: /\bxox[baprs]-[A-Za-z0-9-]{10,}/g, repl: '[REDACTED]' },
  { re: /\bAKIA[0-9A-Z]{16}\b/g, repl: '[REDACTED]' },
  // FOO_API_KEY=... / *_TOKEN=... / *_SECRET=... / *PASSWORD=...  (giữ tên biến, giấu giá trị)
  { re: /\b([A-Za-z0-9_]*(?:API[_-]?KEY|TOKEN|SECRET|PASSWORD|PASSWD|ACCESS[_-]?KEY))\s*[=:]\s*\S+/gi, repl: '$1=[REDACTED]' },
]

// base64/token dài >40 ký tự — chỉ redact khi "trông như secret" (mixed-case+digit HOẶC có ký tự base64 +/=)
// → KHÔNG đụng git-sha hex (toàn thường+số, không hoa) hay từ tiếng Việt/Anh (hiếm khi ≥40 ký tự liền).
const LONG_RE = /[A-Za-z0-9+/_\-]{40,}={0,2}/g
function looksSecret(t: string): boolean {
  const hasB64 = /[+/=]/.test(t)
  const hasUpper = /[A-Z]/.test(t), hasLower = /[a-z]/.test(t), hasDigit = /[0-9]/.test(t)
  return hasB64 || (hasUpper && hasLower && hasDigit)
}

/** Thay mọi pattern giống secret bằng [REDACTED]. Idempotent, không ném. Input rỗng → trả nguyên. */
export function scrubSecrets(text: string): string {
  if (!text) return text
  let s = text
  for (const { re, repl } of RULES) s = s.replace(re, repl)
  s = s.replace(LONG_RE, (m) => (looksSecret(m) ? '[REDACTED]' : m))
  return s
}
