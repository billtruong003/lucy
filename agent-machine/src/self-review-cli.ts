#!/usr/bin/env node
// self-review-cli.ts -- BH-D meta-learning: generate markdown self-review report.
// Usage: npx tsx src/self-review-cli.ts [--output-file path.md]
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { Store } from './store.js'
import { buildErrorStats } from './error-stats.js'
import { readOutcomes, groupByModel } from './routing-outcome.js'

function parseArgs(argv: string[]): { outputFile?: string } {
  const args = argv.slice(2)
  const idx = args.indexOf('--output-file')
  const outputFile = idx !== -1 ? args[idx + 1] : undefined
  return { outputFile }
}

function pad(s: string, n: number): string {
  return s.length >= n ? s : s + ' '.repeat(n - s.length)
}

function table(headers: string[], rows: string[][]): string {
  const widths = headers.map((h, i) => Math.max(h.length, ...rows.map((r) => (r[i] ?? '').length)))
  const sep = '|' + widths.map((w) => '-'.repeat(w + 2)).join('|') + '|'
  const head = '|' + headers.map((h, i) => ' ' + pad(h, widths[i]) + ' ').join('|') + '|'
  const body = rows.map((r) => '|' + r.map((c, i) => ' ' + pad(c ?? '', widths[i]) + ' ').join('|') + '|').join('\n')
  return [head, sep, body].join('\n')
}

function formatDate(d: Date): string {
  return d.toISOString().slice(0, 10)
}

async function main() {
  const { outputFile } = parseArgs(process.argv)

  const dataDir = process.env.AM_DATA ?? path.join(process.cwd(), '.data')
  const logDir = process.env.AM_TURNS_LOG ?? path.join(process.cwd(), '.data')
  const vaultDir = process.env.LUCY_VAULT ?? path.join(os.homedir(), 'lucy', 'lucy-vault')

  // Ensure dataDir exists for Store
  fs.mkdirSync(dataDir, { recursive: true })
  const store = new Store(dataDir)

  const errStats = buildErrorStats(store, logDir)
  const outcomes = readOutcomes(vaultDir)
  const modelStats = groupByModel(outcomes)

  const now = new Date()
  const lines: string[] = []

  lines.push(`# Lucy Self-Review — ${formatDate(now)}`)
  lines.push(`Generated: ${now.toISOString()}`)
  lines.push('')

  // Error analysis section
  lines.push(`## Phan tich loi Lane (${errStats.total} loi)`)
  lines.push('')
  if (errStats.byCategory.length > 0) {
    lines.push(table(['Category', 'Count'], errStats.byCategory.map((x) => [x.category, String(x.count)])))
  } else {
    lines.push('_Khong co loi nao._')
  }
  lines.push('')

  lines.push('### Theo model')
  lines.push('')
  if (errStats.byModel.length > 0) {
    lines.push(table(['Model', 'Loi'], errStats.byModel.map((x) => [x.model, String(x.count)])))
  } else {
    lines.push('_Khong co du lieu model._')
  }
  lines.push('')

  // Routing outcomes section
  lines.push(`## Routing Outcomes (${outcomes.length} feedback)`)
  lines.push('')
  if (modelStats.length > 0) {
    const sorted = [...modelStats].sort((a, b) => b.score - a.score)
    lines.push(table(
      ['Model', '👍', '👎', 'Score%'],
      sorted.map((s) => [s.model, String(s.good), String(s.bad), String(s.score) + '%']),
    ))
  } else {
    lines.push('_Chua co feedback routing._')
  }
  lines.push('')

  // Routing suggestions
  lines.push('### Goi y routing')
  lines.push('')
  const warnings = modelStats.filter((s) => s.score < 50 && s.total >= 3)
  if (warnings.length > 0) {
    for (const w of warnings) {
      lines.push(`- **${w.model}**: score ${w.score}% (${w.good}/${w.total}) — xem xet giam uu tien`)
    }
  } else {
    lines.push('_Khong co model nao can canh bao (can >= 3 feedback, score < 50%)._')
  }
  lines.push('')
  lines.push('---')
  lines.push('_Tu dong boi Lucy self-review-cli.ts · BH-D meta-learning_')

  const report = lines.join('\n')

  if (outputFile) {
    fs.mkdirSync(path.dirname(path.resolve(outputFile)), { recursive: true })
    fs.writeFileSync(outputFile, report, 'utf8')
    console.log(`OK: ${outputFile}`)
  } else {
    console.log(report)
  }

  process.exit(0)
}

main().catch((err) => {
  console.error(err)
  process.exit(0)
})
