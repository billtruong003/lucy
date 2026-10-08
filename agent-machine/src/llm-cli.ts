// llm-cli — tay lái lát API. `npm run llm -- status` | `npm run llm -- "câu hỏi"` [modelKeyOrRole]
import { callLLM, providerStatus, MODEL_CATALOG } from './llm-lane.js'

const args = process.argv.slice(2)
const cmd = args[0]

async function main(): Promise<void> {
  if (cmd === 'status' || !cmd) {
    console.log('=== providers (key sống?) ===')
    for (const p of providerStatus()) console.log(`  ${p.hasKey ? '✓' : '✗'} ${p.label.padEnd(14)} ${p.provider}`)
    console.log('\n=== catalog (dropdown) ===')
    for (const m of MODEL_CATALOG) console.log(`  [${m.role.padEnd(9)}] ${m.key.padEnd(20)} ${m.free ? 'FREE' : 'paid'}  → ${m.provider}/${m.model}`)
    console.log('\nDùng: npm run llm -- "câu hỏi" [executor|ds-v4-flash|...]')
    return
  }
  const q = cmd
  const model = args[1] || 'executor'
  console.log(`🔎 model/role="${model}"  q="${q}"`)
  const t0 = Date.now()
  const r = await callLLM(model, [{ role: 'user', content: q }], { maxTokens: 256 })
  console.log(`✅ qua ${r.provider}/${r.model} (${Date.now() - t0}ms)`)
  console.log(`   ${r.content.replace(/\n/g, ' ').slice(0, 300)}`)
  console.log(`   usage: ${JSON.stringify(r.usage)}`)
}

main().catch((e) => { console.error('❌', e instanceof Error ? e.message : e); process.exit(1) })
