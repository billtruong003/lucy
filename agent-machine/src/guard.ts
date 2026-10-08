// Guard — FS defense (defense-in-depth chống agent xoá/đụng bậy).
import path from 'node:path'

export function isWithin(base: string, target: string): boolean {
  const r = path.resolve(target)
  const b = path.resolve(base)
  return r === b || r.startsWith(b + path.sep)
}

// target có rơi vào (hoặc chứa) path được bảo vệ không -> hard-deny
export function isProtected(target: string, protectedPaths: string[]): boolean {
  const r = path.resolve(target)
  return protectedPaths.some((p) => {
    const pp = path.resolve(p)
    return r === pp || r.startsWith(pp + path.sep) || pp.startsWith(r + path.sep)
  })
}

// phát hiện lệnh shell nguy hiểm (xoá lan man / push / reset cứng / tắt sandbox / phá đĩa)
const DANGER: RegExp[] = [
  /\brm\s+-[a-z]*r[a-z]*f?\s+(\/|~|\$HOME|\*)/i, // rm -rf / ~ $HOME *
  /\brm\s+-[a-z]*r[a-z]*f?\b[^\n]*\.\.(\/|\s|$)/, // rm -r ... .. (ra ngoài)
  /\bgit\s+push\b/i,
  /\bgit\s+reset\s+--hard\b/i,
  /\bgit\s+clean\s+-[a-z]*f/i,
  /\b(shutdown|reboot|halt|mkfs|dd\s+if=)/i,
  /:\(\)\s*\{\s*:\|:/, // fork bomb
  /dangerouslyOverrideSandbox|--dangerously/i,
]

export function looksDangerous(cmd: string): { danger: boolean; rule?: string } {
  for (const re of DANGER) if (re.test(cmd)) return { danger: true, rule: re.source }
  return { danger: false }
}
