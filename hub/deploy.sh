#!/usr/bin/env bash
# Lucy Hub — deploy/update trên VPS. Chạy: bash hub/deploy.sh
set -e
cd "$(dirname "$0")"

echo "== [1/3] cài deps server =="
( cd server && npm install )

echo "== [2/3] build web =="
( cd web && npm install && npm run build )

echo "== [3/3] (re)start pm2 =="
if command -v pm2 >/dev/null 2>&1; then
  pm2 startOrReload ecosystem.config.cjs
  pm2 save
  echo "OK — hub chạy local 127.0.0.1:8800 (qua pm2). Nginx proxy vào đó."
else
  echo "⚠️ chưa có pm2 (npm i -g pm2). Tạm chạy: cd server && LUCY_HUB_HOST=127.0.0.1 npm start"
fi
