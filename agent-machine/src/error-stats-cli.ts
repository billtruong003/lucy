// error-stats-cli — in bảng text gọn lỗi agent ra stdout.
// Dùng: AM_TURNS_LOG=<dir> tsx src/error-stats-cli.ts   (hoặc đối số 1 = logDir)
import path from 'node:path'
import { Store } from './store'
import { loadConfig } from './config'
import { buildErrorStats, ERROR_CATEGORIES, type ErrorCategory } from './error-stats'

const DATA = process.env.AM_DATA || path.join(process.cwd(), '.data')
const CONFIG = process.env.AM_CONFIG || path.join(process.cwd(), 'config')
const LOG_DIR = process.argv[2] || process.env.AM_TURNS_LOG

const store = new Store(DATA)
loadConfig(store, CONFIG) // nạp personas để resolve model

const stats = buildErrorStats(store, LOG_DIR)

console.log(`\n📊 THỐNG KÊ LỖI AGENT — scope: ${stats.scope}`)
console.log(`Tổng lỗi: ${stats.total}\n`)

if (stats.total === 0) {
  console.log('0 lỗi (turn-log rỗng hoặc không có record lỗi nào).')
  process.exit(0)
}

// Bảng 1: theo category (desc).
console.log('── Lỗi theo NHÓM (nhiều → ít) ──')
for (const { category, count } of stats.byCategory) {
  console.log(`  ${category.padEnd(14)} ${count}`)
}

// Helper in cross-table agent/model × category (chỉ cột có số liệu).
const activeCats: ErrorCategory[] = ERROR_CATEGORIES.filter((c) => stats.byCategory.some((x) => x.category === c))
function printCross(title: string, rows: { key: string; count: number; byCategory: Record<ErrorCategory, number> }[]) {
  console.log(`\n── ${title} ──`)
  for (const r of rows) {
    const parts = activeCats.filter((c) => r.byCategory[c] > 0).map((c) => `${c}=${r.byCategory[c]}`)
    console.log(`  ${r.key.padEnd(16)} tổng ${String(r.count).padEnd(4)} [${parts.join(', ')}]`)
  }
}

printCross('Theo AGENT', stats.byAgent.map((a) => ({ key: a.agent, count: a.count, byCategory: a.byCategory })))
printCross('Theo MODEL', stats.byModel.map((m) => ({ key: m.model, count: m.count, byCategory: m.byCategory })))

console.log(`\n🔝 TOP lỗi: ${stats.topCategory}`)
