// Static server nhỏ — xem trang web agent tạo trong 1 workspace.
// Chạy: AM_SERVE_DIR=<dir> AM_SERVE_PORT=8090 npx tsx src/serve-ws.ts
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'

const dir = path.resolve(process.env.AM_SERVE_DIR || process.argv[2] || '.')
const port = Number(process.env.AM_SERVE_PORT || 8090)
const host = process.env.AM_SERVE_HOST || '127.0.0.1'
const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif',
  '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.webp': 'image/webp', '.woff2': 'font/woff2',
}

http.createServer((req, res) => {
  let p = decodeURIComponent((req.url || '/').split('?')[0])
  if (p === '/' || p.endsWith('/')) p += 'index.html'
  const fp = path.join(dir, p)
  if (!path.resolve(fp).startsWith(dir)) { res.writeHead(403); return res.end('forbidden') }
  fs.readFile(fp, (e, data) => {
    if (e) { res.writeHead(404, { 'content-type': 'text/html; charset=utf-8' }); return res.end('<h3>404</h3>') }
    res.writeHead(200, { 'content-type': TYPES[path.extname(fp).toLowerCase()] || 'application/octet-stream' })
    res.end(data)
  })
}).listen(port, host, () => console.log(`🌐 web: http://${host}:${port}   (serve ${dir})`))
