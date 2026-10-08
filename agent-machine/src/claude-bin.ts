// claude-bin.ts — resolve binary claude THẬT trên Windows. npm cài claude = shim .cmd/.ps1 →
// spawn không-shell ENOENT, còn shell:true thì dính cmd-quoting-hell lồng nhau (lúc chạy lúc không
// tuỳ shell cha — bug 2026-06-11). Né hẳn: tìm claude.exe thật cạnh shim trong PATH → spawn thẳng,
// KHÔNG shell, không quoting. Không tìm thấy exe → fallback shim qua shell (đường cũ).
import fs from 'node:fs'
import path from 'node:path'

export type ResolvedClaude = { bin: string; shell: boolean }

let cached: ResolvedClaude | null = null
export function resolveClaude(bin: string = process.env.CLAUDE_BIN || 'claude'): ResolvedClaude {
  if (process.platform !== 'win32' || /\.(exe|js)$/i.test(bin) || path.isAbsolute(bin)) return { bin, shell: false }
  if (cached) return cached
  for (const d of (process.env.PATH || '').split(path.delimiter)) {
    if (!d) continue
    // npm global: <dir>\claude.cmd là shim → exe thật ở <dir>\node_modules\@anthropic-ai\claude-code\bin\claude.exe
    const viaNpm = path.join(d, 'node_modules', '@anthropic-ai', 'claude-code', 'bin', 'claude.exe')
    const direct = path.join(d, bin + '.exe')
    try {
      if (fs.existsSync(direct)) { cached = { bin: direct, shell: false }; return cached }
      if (fs.existsSync(path.join(d, bin + '.cmd')) && fs.existsSync(viaNpm)) { cached = { bin: viaNpm, shell: false }; return cached }
    } catch { /* dir hỏng → thử dir kế */ }
  }
  cached = { bin, shell: true } // đành đi đường shim + shell
  return cached
}
