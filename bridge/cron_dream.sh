#!/usr/bin/env bash
# Dream đêm — "gộp đêm" trí nhớ Lucy: Brain/inbox signal → preference → active.md (+ dọn inbox quá hạn).
# THUẦN DETERMINISTIC, 0 token. Chạy xong reindex để recall thấy note mới trong ngày.
# Cron 2h sáng VN:
#   0 2 * * * /root/lucy/bridge/cron_dream.sh >> /root/lucy-workspace/dream-cron.log 2>&1
set -e
cd "$(dirname "$0")"
set -a; [ -f .env ] && . ./.env; set +a
export PATH="$PATH:/usr/local/bin:/usr/bin"

VAULT="${LUCY_VAULT:-$HOME/lucy/lucy-vault}"
AM_DIR="$(cd .. && pwd)/agent-machine"
DATE_STR="$(date +%F)"

echo "== dream $DATE_STR $(date +%T) =="
OUT_ERR=""
# Phase 3+4 consolidation BẬT (2026-07-02, Bill duyệt Phase B audit): gộp/dedupe fact + bi-temporal supersede.
# Dry-run verify 2026-07-02: 60 fact, 0 cặp trùng, 0 hành động — an toàn. Report mỗi đêm: Brain/proposals/consolidate-<date>.md
OUT="$(cd "$AM_DIR" && LUCY_VAULT="$VAULT" LUCY_CONSOLIDATE=1 LUCY_CONSOLIDATE_APPLY=1 npm run --silent dream 2>&1)" || OUT_ERR=1
echo "$OUT"

# reindex incremental (mtime+checksum — rẻ) → recall + tab Bộ não thấy mọi note ghi trong ngày
(cd "$AM_DIR" && LUCY_VAULT="$VAULT" npm run --silent reindex 2>&1) || true

# Heartbeat việc học — 1 dòng để chủ nhân thấy học có SỐNG không (tránh tắt im lặng: coordinator lỗi / vector 429 / episodic ngừng)
HEARTBEAT="$(cd "$AM_DIR" && LUCY_VAULT="$VAULT" npm run --silent recall -- stats 2>/dev/null | tail -1)" || HEARTBEAT=""
echo "$HEARTBEAT"

# Báo Telegram CHỈ khi não có thay đổi (no-op → im lặng, đừng spam chủ nhân mỗi sáng)
if [ -n "${TELEGRAM_BOT_TOKEN:-}" ] && [ -n "${LUCY_ALLOWED_USER_ID:-}" ]; then
  MSG=""
  if [ -n "$OUT_ERR" ]; then
    MSG="⚠️ Dream đêm $DATE_STR lỗi — chủ nhân xem log: dream-cron.log
$(echo "$OUT" | head -c 600)"
  elif ! echo "$OUT" | grep -q "không có gì mới"; then
    MSG="🌙 Dream đêm $DATE_STR — em vừa gộp trí nhớ:
$(echo "$OUT" | head -c 2800)
${HEARTBEAT:+
$HEARTBEAT}
Xem tab Bộ não / Tinh hà để thấy hành tinh mới ạ."
  else
    # Không có note mới NHƯNG vẫn báo heartbeat để chủ nhân biết học còn sống (im lặng lâu = nghi ngờ)
    MSG="${HEARTBEAT:+🌙 Dream đêm $DATE_STR — không có note mới.
$HEARTBEAT}"
  fi
  if [ -n "$MSG" ]; then
    curl -s "https://api.telegram.org/bot$TELEGRAM_BOT_TOKEN/sendMessage" \
      -d chat_id="$LUCY_ALLOWED_USER_ID" \
      --data-urlencode "text=$MSG" >/dev/null || true
  fi
fi
