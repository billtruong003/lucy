// pm2 config cho Lucy Hub. Dùng: pm2 startOrReload ecosystem.config.cjs ; pm2 save
// Env chính đặt trong server/.env (server tự load dotenv). Đây chỉ ép nghe local cho nginx.
module.exports = {
  apps: [
    {
      name: 'lucy-hub',
      cwd: __dirname + '/server',
      script: 'npm',
      args: 'start',
      env: {
        LUCY_HUB_HOST: '127.0.0.1', // chỉ nghe localhost -> chỉ nginx proxy vào (an toàn)
        LUCY_HUB_PORT: '8800',
      },
      autorestart: true,
      max_restarts: 10,
      restart_delay: 3000,
    },
  ],
}
