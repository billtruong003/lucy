#!/bin/bash
# Gắn pxpipe cho SHELL HIỆN TẠI + tự kiểm tra/vá pxpipe & 5 process Lucy live.
# CHẠY:  source /root/lucy/pxpipe/on.sh     (bắt buộc "source" — export mới áp dụng cho shell đang gõ)
# Không đụng ~/.claude/settings.json — chạy tay khi nào cần, không âm thầm đổi hành vi mặc định.
if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
  echo "⚠️  Chạy bằng 'source ${BASH_SOURCE[0]}' (không phải bash trực tiếp), nếu không export sẽ KHÔNG áp dụng cho shell này."
fi

PXURL="http://127.0.0.1:47821"
LUCY_PROCS=(lucy-bridge lucy-hub lucy-coordinator lucy-vps-worker lucy-autopilot)

echo "=== 1) pxpipe (proxy nén token) ==="
PX_STATUS=$(pm2 jlist 2>/dev/null | python3 -c "
import json,sys
d=json.load(sys.stdin)
m=[p['pm2_env']['status'] for p in d if p['name']=='lucy-pxpipe']
print(m[0] if m else 'missing')")
if [ "$PX_STATUS" != "online" ]; then
  echo "  lucy-pxpipe = $PX_STATUS → khởi động lại…"
  if pm2 describe lucy-pxpipe >/dev/null 2>&1; then
    pm2 restart lucy-pxpipe >/dev/null
  else
    (cd /root/lucy/pxpipe && PORT=47821 HOST=127.0.0.1 PXPIPE_MODELS="claude-fable-5,claude-fable-5-1,claude-sonnet-5,claude-sonnet-5-5,gpt-5.6" pm2 start node_modules/.bin/pxpipe --name lucy-pxpipe >/dev/null)
  fi
  sleep 2
fi
if curl -sf "$PXURL/" -o /dev/null; then
  echo "  ✅ pxpipe đang chạy · dashboard $PXURL"
else
  echo "  ❌ pxpipe KHÔNG phản hồi — kiểm tra tay: pm2 logs lucy-pxpipe"
fi

echo "=== 2) export cho shell này ==="
export ANTHROPIC_BASE_URL="$PXURL"
echo "  ✅ ANTHROPIC_BASE_URL=$PXURL — mọi lệnh 'claude' gõ SAU dòng này (trong shell hiện tại) sẽ đi qua pxpipe"

echo "=== 3) vá 5 process Lucy live nếu bị rớt env ==="
ok=0
for name in "${LUCY_PROCS[@]}"; do
  pid=$(pm2 jlist 2>/dev/null | python3 -c "
import json,sys
d=json.load(sys.stdin)
m=[p['pid'] for p in d if p['name']=='$name' and p['pm2_env']['status']=='online']
print(m[0] if m else '')")
  if [ -z "$pid" ]; then echo "  ⚠️  $name không chạy — bỏ qua"; continue; fi
  if tr '\0' '\n' < /proc/$pid/environ 2>/dev/null | grep -q "^ANTHROPIC_BASE_URL=$PXURL\$"; then
    echo "  ✅ $name"
    ok=$((ok+1))
  else
    echo "  🔧 $name thiếu env pxpipe — đang vá…"
    python3 /root/lucy/pxpipe/inject-env.py "$name" && ok=$((ok+1))
  fi
done
echo "  → $ok/${#LUCY_PROCS[@]} process Lucy live đã đi qua pxpipe"
[ "$ok" -eq "${#LUCY_PROCS[@]}" ] && pm2 save >/dev/null 2>&1

echo "=== XONG. Dashboard public: http://<VPS_IP>:47822/ (creds: pxpipe/DASHBOARD-LOGIN.txt) ==="
