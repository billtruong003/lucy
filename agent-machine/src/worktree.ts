// Worktree — blast-radius isolation: mỗi card làm trong 1 git worktree riêng.
// Agent có xoá sạch cũng chỉ chết worktree; repo gốc + branch chính còn nguyên. Gộp lại bằng git merge.
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

function git(repo: string, args: string[]): string {
  return execFileSync('git', ['-C', repo, ...args], { stdio: ['ignore', 'pipe', 'pipe'] }).toString().trim()
}

export function isGitRepo(repo: string): boolean {
  try { git(repo, ['rev-parse', '--is-inside-work-tree']); return true } catch { return false }
}

export function makeWorktree(repo: string, cardId: string, baseRef = 'HEAD'): { dir: string; branch: string } {
  const branch = `am/${cardId}`
  const dir = path.join(repo, '.am-worktrees', cardId)
  fs.mkdirSync(path.dirname(dir), { recursive: true })
  git(repo, ['worktree', 'add', '-b', branch, dir, baseRef])
  return { dir, branch }
}

export function removeWorktree(repo: string, dir: string, branch?: string) {
  try { git(repo, ['worktree', 'remove', '--force', dir]) } catch { /* */ }
  if (branch) { try { git(repo, ['branch', '-D', branch]) } catch { /* */ } }
}
