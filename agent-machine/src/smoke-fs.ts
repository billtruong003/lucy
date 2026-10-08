// Smoke FS-defense — guard (lệnh nguy hiểm / path) + git worktree blast-radius. Exit 1 nếu fail.
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { isWithin, isProtected, looksDangerous } from './guard'
import { makeWorktree, removeWorktree, isGitRepo } from './worktree'

let pass = 0
let fail = 0
const check = (n: string, c: boolean, e = '') => { if (c) { pass++; console.log(`  ✅ ${n}`) } else { fail++; console.log(`  ❌ ${n} ${e}`) } }

function tGuard() {
  console.log('\nFS-1 — guard (path + lệnh nguy hiểm)')
  const ws = path.resolve('/tmp/ws')
  check('isWithin: trong workspace', isWithin(ws, path.join(ws, 'a/b.txt')))
  check('isWithin: ngoài workspace = false', !isWithin(ws, '/tmp/other/x'))
  check('isProtected: trúng path bảo vệ', isProtected('/root/.ssh/id_rsa', ['/root/.ssh', '/etc']))
  check('isProtected: path thường = false', !isProtected('/tmp/ws/a', ['/root/.ssh']))
  check('danger: rm -rf /', looksDangerous('rm -rf /').danger)
  check('danger: rm -rf $HOME', looksDangerous('sudo rm -rf $HOME/stuff').danger)
  check('danger: git push', looksDangerous('git push origin main').danger)
  check('danger: git reset --hard', looksDangerous('git reset --hard HEAD~5').danger)
  check('an toàn: ls + npm test = không nguy', !looksDangerous('ls -la && npm test').danger)
  check('an toàn: rm file trong ws = không match rule /~/*', !looksDangerous('rm -f ./build/out.txt').danger)
}

function tWorktree() {
  console.log('\nFS-2 — git worktree blast-radius (xoá trong worktree, repo gốc còn nguyên)')
  const repo = path.join(process.cwd(), '.smoke-fs-repo')
  fs.rmSync(repo, { recursive: true, force: true })
  fs.mkdirSync(repo, { recursive: true })
  const g = (args: string[]) => execFileSync('git', ['-C', repo, ...args], { stdio: ['ignore', 'pipe', 'pipe'] })
  g(['init', '-q'])
  fs.writeFileSync(path.join(repo, 'important.txt'), 'DỮ LIỆU QUAN TRỌNG')
  g(['add', '-A'])
  g(['-c', 'user.email=am@lucy', '-c', 'user.name=am', 'commit', '-q', '-m', 'init'])

  check('isGitRepo nhận diện repo', isGitRepo(repo))
  const wt = makeWorktree(repo, 'cardX')
  check('worktree tạo ra dir riêng', fs.existsSync(wt.dir) && fs.existsSync(path.join(wt.dir, 'important.txt')))

  // agent "phá": xoá sạch file trong worktree
  fs.rmSync(path.join(wt.dir, 'important.txt'), { force: true })
  check('file BỊ XOÁ trong worktree', !fs.existsSync(path.join(wt.dir, 'important.txt')))
  check('repo GỐC vẫn còn file (blast-radius)', fs.existsSync(path.join(repo, 'important.txt')))

  removeWorktree(repo, wt.dir, wt.branch)
  check('dọn worktree xong', !fs.existsSync(wt.dir))
  fs.rmSync(repo, { recursive: true, force: true })
}

function main() {
  console.log('🧪 FS-defense smoke (no token burn)')
  tGuard()
  tWorktree()
  console.log(`\n${fail === 0 ? '✅ ALL PASS' : '❌ FAIL'} — ${pass} pass, ${fail} fail`)
  process.exit(fail === 0 ? 0 : 1)
}
main()
