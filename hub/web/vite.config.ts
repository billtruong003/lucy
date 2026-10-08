import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Dev: Vite (5173) proxy /api + /login -> FastAPI (8800). Prod: vite build -> dist/ (FastAPI serve).
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      // preview Board/Channels: /api/am/* → coordinator agent-machine (token từ env, mặc định devtoken)
      '/api/am': {
        target: process.env.AM_COORD_URL || 'http://127.0.0.1:8780',
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/api\/am/, ''),
        configure: (proxy) => { proxy.on('proxyReq', (pr) => pr.setHeader('x-worker-token', process.env.AM_TOKEN || 'devtoken')) },
      },
      '/api': 'http://127.0.0.1:8800',
      '/login': 'http://127.0.0.1:8800',
    },
  },
})
