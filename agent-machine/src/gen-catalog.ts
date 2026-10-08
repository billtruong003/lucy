// gen-catalog — SINH 1 FILE JSON catalog model từ NGUỒN DUY NHẤT (llm-lane MODEL_CATALOG + chat-lane ROUTE_TABLE).
// F4: hết khai model 2 nơi. TS = nguồn sự thật; Python/bridge đọc file JSON này (fallback khi coordinator offline).
// Chạy: npm run gen:catalog  → ghi config/model-catalog.json
import fs from 'node:fs'
import path from 'node:path'
import { MODEL_CATALOG, PROVIDERS, FALLBACKS, CLAUDE_CHAT_MODELS } from './llm-lane'
import { ROUTE_TABLE } from './chat-lane'

// __dirname polyfill cho ESM
const here = path.dirname(new URL(import.meta.url).pathname)
export const CATALOG_PATH = path.resolve(here, '..', 'config', 'model-catalog.json')

export function buildCatalog() {
  return {
    _comment: 'AUTO-SINH bởi src/gen-catalog.ts từ llm-lane.MODEL_CATALOG + chat-lane.ROUTE_TABLE. ĐỪNG sửa tay — chạy `npm run gen:catalog`.',
    version: 1,
    providers: Object.fromEntries(Object.entries(PROVIDERS).map(([id, p]) => [id, { id: p.id, label: p.label, baseUrl: p.baseUrl }])), // KHÔNG xuất envKey (chỉ tên biến, không phải secret, nhưng giữ gọn)
    models: MODEL_CATALOG,
    claudeModels: CLAUDE_CHAT_MODELS,   // Claude subscription chat models (fallback cho bridge khi coordinator offline)
    fallbacks: FALLBACKS,
    routeTable: ROUTE_TABLE,
  }
}

/** Kiểm tra toàn vẹn nguồn: mọi key trong FALLBACKS + ROUTE_TABLE phải tồn tại trong MODEL_CATALOG (chống "khai 2 nơi" lệch nhau). */
export function validateCatalogIntegrity(): string[] {
  const keys = new Set(MODEL_CATALOG.map((m) => m.key))
  const errs: string[] = []
  for (const [role, list] of Object.entries(FALLBACKS)) for (const k of list) if (!keys.has(k)) errs.push(`FALLBACKS[${role}] → key lạ "${k}" (không có trong MODEL_CATALOG)`)
  for (const [head, list] of Object.entries(ROUTE_TABLE)) for (const k of list) if (!keys.has(k)) errs.push(`ROUTE_TABLE[${head}] → key lạ "${k}" (không có trong MODEL_CATALOG)`)
  return errs
}

// CLI: viết file (chỉ khi chạy trực tiếp — không khi bị import bởi smoke)
const invokedDirect = !!process.argv[1] && /gen-catalog(\.ts|\.js)?$/.test(process.argv[1])
if (invokedDirect) {
  const errs = validateCatalogIntegrity()
  if (errs.length) { console.error('❌ catalog không toàn vẹn:\n' + errs.map((e) => '  - ' + e).join('\n')); process.exit(1) }
  const cat = buildCatalog()
  fs.mkdirSync(path.dirname(CATALOG_PATH), { recursive: true })
  fs.writeFileSync(CATALOG_PATH, JSON.stringify(cat, null, 2))
  console.log(`✅ sinh catalog → ${CATALOG_PATH}  (${cat.models.length} model, ${Object.keys(cat.providers).length} provider, ${Object.keys(cat.routeTable).length} route-head)`)
}
