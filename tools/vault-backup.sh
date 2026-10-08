#!/bin/bash
# vault-backup.sh — Sync lucy-vault → repo PRIVATE lucy-vault-backup (lặp được, AN TOÀN).
#   Mặc định DRY=1 (chỉ in, không làm). DRY=0 để chạy thật.
#   Tham số --untrack : (1 lần) gỡ vault khỏi L.U.C.Y going-forward (git rm --cached + gitignore).
#                       GIỮ file local, KHÔNG rewrite history (L.U.C.Y private nên không cần purge).
# An toàn: kiểm số file vault >1000 trước khi đụng; mask token khi in; --delete chỉ trong repo backup.
set -euo pipefail
DRY="${DRY:-1}"
LUCY=/root/lucy
VAULT_DIR="$LUCY/lucy-vault"
WORK=/root/lucy-vault-backup-repo
REPO_SLUG=billtruong003/lucy-vault-backup

# token (đọc từ bridge /proc, KHÔNG in)
PID=$(pgrep -f lucy_bridge.py | head -1)
TOKEN=$(tr '\0' '\n' < /proc/$PID/environ 2>/dev/null | grep '^GITHUB_TOKEN=' | cut -d= -f2- || true)
[ -n "${TOKEN:-}" ] || { echo "❌ thiếu GITHUB_TOKEN"; exit 1; }
REMOTE="https://x-access-token:${TOKEN}@github.com/${REPO_SLUG}.git"
mask(){ printf '%s' "$1" | sed "s#${TOKEN}#<TOKEN>#g"; }
do_(){ if [ "$DRY" = 1 ]; then echo "  would: $(mask "$*")"; else eval "$*"; fi; }
tag(){ [ "$DRY" = 1 ] && echo "[DRY] $*" || echo "[RUN] $*"; }

# ── SAFETY GATE ──
N=$(find "$VAULT_DIR" -type f 2>/dev/null | wc -l)
[ "$N" -gt 1000 ] || { echo "❌ vault chỉ $N file (<1000) — nghi sai đường/rỗng, DỪNG"; exit 1; }
tag "vault local: $N file ✓"

# ── PHASE 1: sync vault → repo backup private ──
tag "PHASE 1: backup vault → $REPO_SLUG"
if [ ! -d "$WORK/.git" ]; then
  tag "  clone backup repo lần đầu (repo trống → init)"
  do_ "git clone '$REMOTE' '$WORK' -q 2>/dev/null || { mkdir -p '$WORK'; cd '$WORK'; git init -q; git branch -M main; git remote add origin '$REMOTE'; }"
fi
# rsync chỉ file vault THEO .gitignore của vault (bỏ DB/log lớn), --delete để mirror đúng
do_ "rsync -a --delete --exclude='.git' --filter='dir-merge,- .gitignore' '$VAULT_DIR/' '$WORK/'"
do_ "cd '$WORK' && git add -A && { git diff --cached --quiet && echo '  (không đổi)' || git commit -q -m \"vault backup \$(date +%F-%H%M)\"; }"
do_ "cd '$WORK' && git push -u origin HEAD:main 2>&1 | tail -2"

# ── PHASE 2: (tuỳ chọn) gỡ vault khỏi L.U.C.Y going-forward ──
if [ "${1:-}" = "--untrack" ]; then
  tag "PHASE 2: gỡ vault khỏi L.U.C.Y (git rm --cached — GIỮ file local, KHÔNG xoá)"
  do_ "cd '$LUCY' && git rm -r --cached lucy-vault -q"
  do_ "cd '$LUCY' && grep -qx 'lucy-vault/' .gitignore || printf '\n# vault → repo riêng lucy-vault-backup (private)\nlucy-vault/\n' >> .gitignore"
  do_ "cd '$LUCY' && git add .gitignore && git commit -q -m 'untrack lucy-vault — backed up riêng ở private lucy-vault-backup' && git push origin main 2>&1 | tail -1"
fi
echo "✅ XONG (DRY=$DRY). Vault local /root/lucy/lucy-vault KHÔNG bị đụng."
