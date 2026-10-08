#!/usr/bin/env bash
# cron_guard.sh — vỏ bọc an toàn cho MỌI cron của Lucy (P4).
# Dùng trong crontab:  bash /root/lucy/bridge/cron_guard.sh <tên-job> <timeout-giây> <lệnh...>
#
# 3 lớp bảo vệ (trước đây: 0 lớp — cron chạy chồng, treo vô hạn, không có nút tắt khẩn):
#   1) KILL_SWITCH : tồn tại file /root/lucy/KILL_SWITCH → mọi cron SKIP ngay.
#      Tắt khẩn cấp 1 chạm:  touch /root/lucy/KILL_SWITCH   (mở lại: rm)
#   2) flock       : instance trước còn chạy → instance mới thoát luôn, không chạy chồng.
#   3) timeout     : quá hạn → TERM, lì thêm 30s → KILL. Không còn job zombie ăn quota/API.
set -u
JOB="${1:?thiếu tên job}"; TMO="${2:?thiếu timeout (giây)}"; shift 2
KS=/root/lucy/KILL_SWITCH
if [ -e "$KS" ]; then
  echo "[cron_guard] $(date -Is) $JOB SKIP: KILL_SWITCH đang bật ($KS)"
  exit 0
fi
LOCK="/tmp/lucy-cron-${JOB}.lock"
exec 9>"$LOCK"
if ! flock -n 9; then
  echo "[cron_guard] $(date -Is) $JOB SKIP: instance trước còn chạy (lock $LOCK)"
  exit 0
fi
echo "[cron_guard] $(date -Is) $JOB START (timeout ${TMO}s)"
timeout -k 30 "$TMO" "$@"
rc=$?
if [ $rc -eq 124 ]; then
  echo "[cron_guard] $(date -Is) $JOB TIMEOUT sau ${TMO}s — đã kill"
fi
echo "[cron_guard] $(date -Is) $JOB END rc=$rc"
exit $rc
