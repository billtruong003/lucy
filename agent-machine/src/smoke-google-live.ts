// smoke-google-live.ts — G2: VERIFY THẬT Google MCP (mạng + OAuth refresh). KHÔNG in token, chỉ in tiêu đề/tên.
// Nạp .env.llm qua import './recall' (embed.ensureEnv chạy lúc import). Cần GOOGLE_REFRESH_TOKEN + .gcp-oauth.json.
import './recall' // side-effect: ensureEnv() nạp .env.llm → GOOGLE_REFRESH_TOKEN vào process.env
import { googleConfigured, gmailSearch, youtubeMyChannel, calendarUpcoming } from './google-mcp'

async function main(): Promise<void> {
  if (!googleConfigured()) {
    console.log('❌ google CHƯA cấu hình (thiếu GOOGLE_REFRESH_TOKEN hoặc .gcp-oauth.json)')
    process.exit(1)
  }
  console.log('✅ googleConfigured = true (có refresh token + client)\n')

  console.log('--- gmail_search("newer_than:7d", 3) ---')
  const gm = await gmailSearch('newer_than:7d', 3)
  console.log(gm.startsWith('ERROR') ? gm : gm.split('\n').slice(0, 12).join('\n'))

  console.log('\n--- youtube_my_channel ---')
  console.log(await youtubeMyChannel())

  console.log('\n--- calendar_upcoming(3) ---')
  console.log(await calendarUpcoming(3))

  const failed = [gm].some((s) => s.startsWith('ERROR'))
  console.log(`\n=== live smoke ${failed ? 'CÓ LỖI' : 'OK'} ===`)
  process.exit(failed ? 1 : 0)
}
main().catch((e) => { console.log('FATAL', String(e?.message || e)); process.exit(1) })
