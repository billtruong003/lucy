#!/usr/bin/env bash
# P1.4 + P1.5 — Cảnh báo ngưỡng pxpipe + retention payload dump.
# Chạy qua cron 15' (bọc cron_guard khi P4.2 xong). --dry: in thay vì gửi Telegram.
# Ngưỡng chỉnh qua env: PXPIPE_RATIO_ALERT (median ratio, default 1.25 — baseline 2026-07-09 đã ~1.11),
#   PXPIPE_FB_ALERT_MS (p95 first_byte_ms, default 15000), PXPIPE_PIXEL_ALERT (max pixels/req, default 12000000).
set -u
EVENTS="${PXPIPE_EVENTS:-/root/.pxpipe/events.jsonl}"
DUMP_DIR="${PXPIPE_DUMP_DIR:-/root/.pxpipe/payloads}"
STATE=/root/.pxpipe/.check_pxpipe_state
DRY=0; [ "${1:-}" = "--dry" ] && DRY=1

alerts=$(python3 - "$EVENTS" <<'PY'
import json, os, statistics as st, sys
ratio_a = float(os.environ.get("PXPIPE_RATIO_ALERT", "1.25"))
fb_a = float(os.environ.get("PXPIPE_FB_ALERT_MS", "15000"))
px_a = float(os.environ.get("PXPIPE_PIXEL_ALERT", "12000000"))
try:
    lines = open(sys.argv[1], "rb").readlines()[-40:]
except FileNotFoundError:
    print(f"events.jsonl không tồn tại: {sys.argv[1]}"); sys.exit()
ratios, fbs, pxs = [], [], []
for ln in lines:
    try: e = json.loads(ln)
    except Exception: continue
    i = e.get("info") or e
    oc = i.get("origChars") or i.get("orig_chars")
    cc = i.get("compressedChars") or i.get("compressed_chars")
    if oc and cc: ratios.append(cc / oc)
    fb = i.get("first_byte_ms") or e.get("first_byte_ms")
    if fb: fbs.append(fb)
    px = i.get("imagePixels") or i.get("image_pixels")
    if px: pxs.append(px)
out = []
if ratios and st.median(ratios) > ratio_a:
    out.append(f"nén âm nặng: median ratio {st.median(ratios):.3f} > {ratio_a} (n={len(ratios)})")
if fbs:
    fbs.sort(); p95 = fbs[int(len(fbs) * 0.95) - 1 if len(fbs) > 1 else 0]
    if p95 > fb_a: out.append(f"first_byte chậm: p95 {p95:.0f}ms > {fb_a:.0f}ms")
if pxs and max(pxs) > px_a:
    out.append(f"ảnh quá lớn: max {max(pxs)/1e6:.1f}Mpx > {px_a/1e6:.1f}Mpx")
print("\n".join(out))
PY
)

if [ -n "$alerts" ]; then
  # dedupe: không gửi lại cùng nội dung trong 6h
  h=$(printf '%s' "$alerts" | md5sum | cut -c1-8)
  last=$(cat "$STATE" 2>/dev/null || true)
  now=$(date +%s)
  lh="${last%% *}"; lt="${last##* }"
  if [ "$lh" != "$h" ] || [ $((now - ${lt:-0})) -gt 21600 ]; then
    msg="🔴 pxpipe alert:
$alerts"
    if [ "$DRY" = 1 ]; then
      echo "[dry] $msg"
    else
      set -a; . /root/lucy/bridge/.env 2>/dev/null; set +a
      curl -sS ${LUCY_TG_PROXY:+--proxy "$LUCY_TG_PROXY"} -m 15 \
        "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage" \
        -d chat_id="${LUCY_ALLOWED_USER_ID}" --data-urlencode text="$msg" >/dev/null \
        && echo "$h $now" > "$STATE" || echo "gửi Telegram fail" >&2
    fi
    [ "$DRY" = 1 ] && echo "$h $now" > "$STATE"
  else
    echo "alert trùng trong 6h, bỏ qua"
  fi
else
  echo "OK: không vượt ngưỡng"
fi

# P1.5 retention 48h trên dump dir (file phẳng + report)
if [ -d "$DUMP_DIR" ]; then
  find "$DUMP_DIR" -maxdepth 2 -type f -mmin +2880 -delete 2>/dev/null
  python3 /root/lucy/tools/build_pxpipe_report.py "$DUMP_DIR" >/dev/null 2>&1 || true
fi
