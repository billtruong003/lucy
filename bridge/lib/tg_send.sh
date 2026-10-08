# shellcheck shell=bash
# tg_send.sh — gửi Telegram an toàn cho cron (brief/tech/vn).
# Vấn đề cũ (brief sáng 06-14): parse_mode=Markdown gặp ký tự lỗi → Telegram trả
#   "can't parse entities" → tin BAY MẤT (cron nuốt lỗi bằng >/dev/null || true).
# Cách xử: (1) sanitize nhẹ trước khi gửi; (2) nếu parse lỗi → tự gửi lại PLAIN
#   (không parse_mode) để KHÔNG mất tin. In trạng thái ra stdout cho log.
#
# Dùng:
#   source "$(dirname "$0")/lib/tg_send.sh"
#   tg_send "$API" "$LUCY_ALLOWED_USER_ID" "$MSG"     # API = https://api.telegram.org/bot<token>

# Cân bằng/khử ký tự markdown dễ vỡ cho parse_mode=Markdown (legacy):
#   *bold* _italic_ `code` [text](url). Nếu số lượng *, _, ` LẺ (không đóng cặp)
#   → Telegram báo can't parse entities. Ta strip ký tự lẻ đó để parse không vỡ,
#   vẫn giữ nguyên chữ. KHÔNG đụng nội dung khác.
_tg_sanitize_md() {
  python3 - "$1" <<'PY'
import sys
t = sys.argv[1]
# bỏ ký tự điều khiển (trừ \n \t) — đôi khi lẫn vào output model
t = ''.join(ch for ch in t if ch >= ' ' or ch in '\n\t')
for ch in ('*', '_', '`'):
    if t.count(ch) % 2 == 1:          # lẻ → có cặp chưa đóng → vỡ parse
        # bỏ ký tự xuất hiện CUỐI cùng để về số chẵn (giữ tối đa định dạng đúng)
        idx = t.rfind(ch)
        t = t[:idx] + t[idx+1:]
sys.stdout.write(t)
PY
}

_tg_ok() {
  python3 -c "import sys,json
try: print('1' if json.load(sys.stdin).get('ok') else '0')
except Exception: print('0')" 2>/dev/null
}
_tg_desc() {
  python3 -c "import sys,json
try: print(json.load(sys.stdin).get('description',''))
except Exception: print('')" 2>/dev/null
}

# tg_send <api_base> <chat_id> <text>
tg_send() {
  local api="$1" chat="$2" text="$3" res ok desc
  local clean; clean="$(_tg_sanitize_md "$text")"

  res="$(curl -s "$api/sendMessage" \
    -d chat_id="$chat" -d disable_web_page_preview=true \
    -d parse_mode="Markdown" \
    --data-urlencode "text=$clean")"
  ok="$(printf '%s' "$res" | _tg_ok)"
  if [ "$ok" = "1" ]; then echo "TELEGRAM OK"; return 0; fi

  desc="$(printf '%s' "$res" | _tg_desc)"
  echo "TELEGRAM RETRY(plain) ← $desc"
  # Gửi lại PLAIN (không parse_mode) — chấp nhận hiện * thô còn hơn mất tin.
  res="$(curl -s "$api/sendMessage" \
    -d chat_id="$chat" -d disable_web_page_preview=true \
    --data-urlencode "text=$text")"
  ok="$(printf '%s' "$res" | _tg_ok)"
  if [ "$ok" = "1" ]; then echo "TELEGRAM OK(plain)"; return 0; fi
  echo "TELEGRAM FAIL ← $(printf '%s' "$res" | _tg_desc)"
  return 1
}
