// pm2 ecosystem — toàn bộ process của Lucy. Khởi động: `pm2 start ecosystem.config.cjs && pm2 save`
//
// Mọi cấu hình lấy từ các file env (gitignored, chmod 600), KHÔNG từ shell đang gõ lệnh:
//   .env.llm            key provider LLM, MCP (GitHub/Google/TwelveData), Jina
//   agent-machine/.env  coordinator/worker: AM_TOKEN, ngân sách, concurrency
//   bridge/.env         Telegram token, user được phép, persona, proxy
//   .env.runtime        biến dùng chung: mật khẩu hub, đường dẫn vault/state, cờ tính năng
// File sau đè file trước. Thiếu file nào thì bỏ qua (process tự báo lỗi nếu thiếu biến bắt buộc).
const fs = require('fs')
const path = require('path')

const ROOT = __dirname
const AM = path.join(ROOT, 'agent-machine')

function loadEnv(file) {
  const out = {}
  let text
  try { text = fs.readFileSync(path.join(ROOT, file), 'utf8') } catch { return out }
  for (const line of text.split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/)
    if (m) out[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2')
  }
  return out
}

const SHARED = {
  ...loadEnv('.env.llm'),
  ...loadEnv('agent-machine/.env'),
  ...loadEnv('bridge/.env'),
  ...loadEnv('.env.runtime'),
}

if (!SHARED.LUCY_HUB_PASSWORD) console.error('⚠️  [SECURITY] LUCY_HUB_PASSWORD chưa có trong .env.runtime — hub sẽ từ chối mọi lượt đăng nhập.')
if (!SHARED.AM_TOKEN) console.error('⚠️  [SECURITY] AM_TOKEN chưa có trong agent-machine/.env — coordinator không xác thực được worker.')

// filter_env: không cho biến của shell gọi `pm2 start` (vd CLAUDE_CODE_SESSION_ID, mật khẩu) lọt vào process.
const app = (name, cwd, script, args, env = {}, extra = {}) => ({
  name, cwd, script, args,
  autorestart: true,
  filter_env: true,
  env: { ...SHARED, ...env },
  ...extra,
})

module.exports = {
  apps: [
    app('lucy-pxpipe', path.join(ROOT, 'pxpipe'), 'node_modules/.bin/pxpipe', undefined,
      { HOST: '127.0.0.1', PORT: '47821', PXPIPE_MODELS: 'claude-fable-5,claude-fable-5-1,claude-sonnet-5,claude-sonnet-5-5,gpt-5.6' }),
    app('lucy-coordinator', AM, 'npm', 'run coordinator'),
    app('lucy-vps-worker', AM, 'npx', 'tsx src/worker-main.ts', { AM_RUNNER: 'claude' }),
    app('lucy-autopilot', AM, 'npm', 'run autopilot', { AM_AUTOPILOT_MAX: '50' }),
    app('lucy-hub', path.join(ROOT, 'hub', 'server'), 'npm', 'start'),
    app('lucy-bridge', path.join(ROOT, 'bridge'), 'python3', 'lucy_bridge.py',
      { PYTHONUNBUFFERED: '1' }, { interpreter: 'none' }),
    app('noteflow-view', AM, 'npx', 'tsx src/serve-ws.ts',
      { AM_SERVE_HOST: '127.0.0.1', AM_SERVE_PORT: '8090', AM_SERVE_DIR: path.join(AM, '.worker', 'card_mq46pruh0') }),
  ],
}
