#!/bin/bash
# PHASE 2 — LỚP CHẶN Ô NHIỄM VAULT khi chạy kịch bản kiểm thử.
#
# Vì sao cần: Lucy chạy với bypassPermissions và có tool ghi file thật. Trong lần chạy baseline
# 2026-08-16, kịch bản G1 đưa một câu GIẢ ĐỊNH ("từ giờ autobuild dùng Sonnet") và Lucy đã ghi
# thẳng vào Brain/claude-memory/ như một sở thích bền của chủ nhân. Tắt episodic KHÔNG đủ —
# đó là đường ghi khác (memory tool của harness).
#
# Cách dùng:
#   bash qa_vault_guard.sh snapshot     # chụp trước khi chạy test
#   ... chạy qa_harness.py / qa_longsession.py ...
#   bash qa_vault_guard.sh diff         # xem test đã đụng gì
#   bash qa_vault_guard.sh restore      # trả vault về nguyên trạng
set -u
VAULT="${LUCY_VAULT:-/root/lucy/lucy-vault}"
SNAP="/root/lucy/.state/vault-snapshot"
# Chỉ bảo vệ nhánh Lucy hay tự ghi. KHÔNG đụng .index (DB dựng lại được) và các nhánh khác.
DIRS=("Brain/claude-memory" "Context" "Brain/inbox")

case "${1:-}" in
  snapshot)
    rm -rf "$SNAP"; mkdir -p "$SNAP"
    for d in "${DIRS[@]}"; do
      [ -d "$VAULT/$d" ] || continue
      mkdir -p "$SNAP/$d"
      cp -a "$VAULT/$d/." "$SNAP/$d/" 2>/dev/null
    done
    find "$SNAP" -type f | wc -l | xargs echo "📸 đã chụp file:"
    ;;
  diff)
    [ -d "$SNAP" ] || { echo "chưa có snapshot"; exit 1; }
    for d in "${DIRS[@]}"; do
      [ -d "$VAULT/$d" ] || continue
      diff -rq "$SNAP/$d" "$VAULT/$d" 2>/dev/null | sed "s|^|  |"
    done
    echo "(trống = test không đụng vào vault)"
    ;;
  restore)
    [ -d "$SNAP" ] || { echo "chưa có snapshot — không khôi phục được"; exit 1; }
    for d in "${DIRS[@]}"; do
      [ -d "$SNAP/$d" ] || continue
      # xoá file test TẠO MỚI (có trong vault, không có trong snapshot)
      (cd "$VAULT/$d" && find . -type f) 2>/dev/null | while read -r f; do
        [ -f "$SNAP/$d/$f" ] || { echo "  ⊖ gỡ file test tạo: $d/$f"; rm -f "$VAULT/$d/$f"; }
      done
      cp -a "$SNAP/$d/." "$VAULT/$d/" 2>/dev/null   # phục hồi nội dung file bị sửa
    done
    echo "✅ vault đã về nguyên trạng trước test"
    ;;
  *)
    echo "dùng: bash qa_vault_guard.sh {snapshot|diff|restore}"; exit 1;;
esac
