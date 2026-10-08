// Workspace — mỗi card 1 dir cô lập (blast-radius). M2.1 sẽ nâng thành git worktree thật.
import fs from 'node:fs'
import path from 'node:path'

export function makeWorkspace(root: string, cardId: string): string {
  const ws = path.join(root, 'workspaces', cardId)
  fs.mkdirSync(ws, { recursive: true })
  return ws
}

// FS defense (skeleton-level): kiểm 1 path có nằm TRONG workspace không (chặn xoá/ghi ra ngoài).
export function withinWorkspace(ws: string, target: string): boolean {
  const r = path.resolve(target)
  const base = path.resolve(ws)
  return r === base || r.startsWith(base + path.sep)
}
