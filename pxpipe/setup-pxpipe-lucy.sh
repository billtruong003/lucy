#!/bin/bash
# setup-pxpipe-lucy.sh — gắn pxpipe (proxy nén token) vào toàn bộ Lucy live.
# CHẠY BẰNG TAY (Bill), không phải agent — do rule an toàn chặn agent tự khởi động proxy
# chặn/biến đổi toàn bộ traffic Claude của hệ thống. Đọc kỹ trước khi chạy.
#
# Làm gì:
#   1. Khởi động lucy-pxpipe (proxy local :47821, chỉ bind 127.0.0.1, dashboard không auth)
#   2. Gắn ANTHROPIC_BASE_URL vào bridge/.env + hub/server/.env (2 process tự đọc .env khi boot)
#   3. Gắn ANTHROPIC_BASE_URL vào coordinator/worker/autopilot qua kỹ thuật /proc (process
#      không đọc .env, phải tái dựng env sống rồi restart --update-env, theo đúng cách đã làm
#      trước đây — xem memory pm2-live-services-not-ecosystem)
#   4. pm2 save + verify từng process có ANTHROPIC_BASE_URL trong /proc/<pid>/environ
# PXPIPE_MODELS="claude-fable-5,claude-fable-5-1,claude-sonnet-5,claude-sonnet-5-5,gpt-5.6" — Bill quyết định 2026-07-xx bật nén
# cho Sonnet 5 luôn dù CHƯA benchmark độ chính xác đọc ảnh (rủi ro chấp nhận có chủ đích, xem
# memory token-guard-default-trap / note "sonnet-5 chưa tồn tại" là claim giả bị bơm vào, bỏ qua).
set -euo pipefail
PXURL="http://127.0.0.1:47821"

echo "=== 1) Khởi động lucy-pxpipe ==="
cd /root/lucy/pxpipe
if ! pm2 describe lucy-pxpipe >/dev/null 2>&1; then
  PORT=47821 HOST=127.0.0.1 PXPIPE_MODELS="claude-fable-5,claude-fable-5-1,claude-sonnet-5,claude-sonnet-5-5,gpt-5.6" pm2 start node_modules/.bin/pxpipe --name lucy-pxpipe
else
  echo "lucy-pxpipe đã chạy, bỏ qua start"
fi
sleep 2
curl -sf "$PXURL/" -o /dev/null && echo "  dashboard OK: $PXURL" || { echo "  LỖI: dashboard không phản hồi, dừng lại"; exit 1; }

echo "=== 2) bridge + hub (tự đọc .env khi boot — dễ) ==="
for f in /root/lucy/bridge/.env /root/lucy/hub/server/.env; do
  if ! grep -q "^ANTHROPIC_BASE_URL=" "$f" 2>/dev/null; then
    echo "ANTHROPIC_BASE_URL=$PXURL" >> "$f"
    echo "  đã thêm vào $f"
  else
    sed -i "s#^ANTHROPIC_BASE_URL=.*#ANTHROPIC_BASE_URL=$PXURL#" "$f"
    echo "  đã cập nhật $f (đã có dòng cũ)"
  fi
done
pm2 restart lucy-bridge lucy-hub
sleep 2

echo "=== 3) coordinator + worker + autopilot (process.env thuần — cần /proc) ==="
inject_proc_env() {
  local name="$1"
  local pid
  pid=$(pm2 jlist | python3 -c "import json,sys; d=json.load(sys.stdin); [print(p['pid']) for p in d if p['name']=='$name']")
  if [ -z "$pid" ]; then echo "  BỎ QUA $name (không tìm thấy pid đang chạy)"; return; fi
  # tái dựng env sống từ /proc, thêm/ghi đè ANTHROPIC_BASE_URL, restart --update-env
  env -i $(tr '\0' '\n' < /proc/$pid/environ | grep -v '^ANTHROPIC_BASE_URL=') \
    ANTHROPIC_BASE_URL="$PXURL" \
    bash -c "pm2 restart $name --update-env" >/dev/null
  echo "  $name (pid cũ $pid) restart --update-env xong"
}
inject_proc_env lucy-coordinator
inject_proc_env lucy-vps-worker
inject_proc_env lucy-autopilot
sleep 3

echo "=== 4) pm2 save + verify ==="
pm2 save >/dev/null
echo "Kiểm tra ANTHROPIC_BASE_URL trong từng process:"
for name in lucy-bridge lucy-hub lucy-coordinator lucy-vps-worker lucy-autopilot; do
  pid=$(pm2 jlist | python3 -c "import json,sys; d=json.load(sys.stdin); [print(p['pid']) for p in d if p['name']=='$name']" 2>/dev/null)
  if [ -n "$pid" ] && tr '\0' '\n' < /proc/$pid/environ 2>/dev/null | grep -q "^ANTHROPIC_BASE_URL=$PXURL$"; then
    echo "  ✅ $name"
  else
    echo "  ❌ $name — CHƯA có ANTHROPIC_BASE_URL, cần check tay"
  fi
done

echo
echo "=== XONG. Dashboard theo dõi tiết kiệm token: $PXURL/ ==="
echo "Lưu ý: autotask/autobuild hiện đang STOPPED — nếu bật lại sau này, export ANTHROPIC_BASE_URL=$PXURL trước khi pm2 start."
