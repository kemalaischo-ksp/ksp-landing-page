#!/usr/bin/env bash
# Deploy Dashboard Traffic KSP ke VPS (cloudflared tunnel sudah terpasang).
# Pakai: ./deploy-vps.sh
#
# Alur: kode diambil dari GitHub (branch main) → jadi push dulu sebelum deploy.
#   1. Cek kode lokal sudah di-push
#   2. Backup database auth (akun & sesi) di VPS
#   3. Tarik main dari GitHub di VPS (commit lokal VPS disimpan di branch backup)
#   4. Rebuild & jalankan container ksp-dashboard saja (hr30 tidak disentuh)
#   5. Cek kesehatan
set -euo pipefail

VPS_USER="ubuntu"
VPS_HOST="43.156.130.183"
SSH_PORT="${SSH_PORT:-2222}"
SSH_KEY="${SSH_KEY:-$HOME/.ssh/KSP_MacBook_2026.pem}"
REMOTE_REPO="~/ksp-landing-page"
REPO_URL="https://github.com/kemalaischo-ksp/ksp-landing-page.git"
BRANCH="main"
APP_PORT="3100"
PUBLIC_URL="https://ksp.office-alwildan.id"

SSH=(ssh -p "$SSH_PORT" -i "$SSH_KEY" -o ConnectTimeout=15 "${VPS_USER}@${VPS_HOST}")

echo "==> 1/5 Cek kode lokal sudah di-push ke GitHub"
cd "$(dirname "$0")"
git fetch -q origin "$BRANCH"
if [ -n "$(git status --porcelain --untracked-files=no -- .)" ]; then
  echo "✗ Ada perubahan ksp-dashboard yang belum di-commit. Commit & push dulu."; exit 1
fi
if [ "$(git rev-parse HEAD)" != "$(git rev-parse "origin/$BRANCH")" ]; then
  echo "✗ HEAD lokal ≠ origin/$BRANCH. Jalankan: git push origin $BRANCH"; exit 1
fi
echo "   ✓ $(git log --oneline -1)"

echo "==> 2-4/5 Backup DB, tarik kode, rebuild container di VPS"
"${SSH[@]}" "set -e
  TS=\$(date +%Y%m%d-%H%M%S); mkdir -p ~/backups
  if docker ps --format '{{.Names}}' | grep -qx ksp-dashboard; then
    docker cp ksp-dashboard:/app/data/auth.db ~/backups/ksp-auth-\$TS.db && chmod 600 ~/backups/ksp-auth-\$TS.db
    echo \"   ✓ backup: ~/backups/ksp-auth-\$TS.db\"
  fi
  cd ${REMOTE_REPO}
  if [ -n \"\$(git status --porcelain --untracked-files=no)\" ]; then
    echo '✗ Ada perubahan belum di-commit di VPS — deploy dibatalkan agar tidak tertimpa.'; git status --short; exit 1
  fi
  git fetch -q ${REPO_URL} ${BRANCH}
  if ! git merge-base --is-ancestor HEAD FETCH_HEAD; then
    git branch -f backup/vps-\$TS HEAD
    echo \"   • commit lokal VPS disimpan di branch backup/vps-\$TS\"
  fi
  git reset -q --hard FETCH_HEAD
  echo \"   ✓ kode VPS: \$(git log --oneline -1)\"
  cd ksp-dashboard && docker compose up -d --build 2>&1 | tail -2"

echo "==> 5/5 Cek kesehatan"
sleep 12
"${SSH[@]}" "docker ps --filter name=ksp-dashboard --format '   container: {{.Status}}'
  docker logs --since 1m ksp-dashboard 2>&1 | grep -v 'cache refreshed' | tail -5 | sed 's/^/   /'
  curl -s -o /dev/null -w '   lokal  /login.html: %{http_code}\n' http://127.0.0.1:${APP_PORT}/login.html"
curl -s -o /dev/null -w "   publik /login.html: %{http_code}\n" -m 10 "${PUBLIC_URL}/login.html"

echo "==> Selesai. ${PUBLIC_URL}"
echo "   Rollback DB bila perlu: docker cp ~/backups/<file>.db ksp-dashboard:/app/data/auth.db && docker restart ksp-dashboard"
