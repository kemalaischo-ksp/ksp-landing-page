#!/usr/bin/env bash
# Deploy Dashboard Traffic KSP ke VPS + cloudflared tunnel
# Pakai: ./deploy-vps.sh
set -euo pipefail

VPS_USER="ubuntu"
VPS_HOST="43.156.130.183"
REMOTE_DIR="~/ksp-dashboard"
LOCAL_DIR="$(cd "$(dirname "$0")" && pwd)"
TUNNEL_TOKEN="${CLOUDFLARE_TUNNEL_TOKEN:-}"
APP_PORT="3100"

echo "==> 1/4 Kirim folder ke ${VPS_USER}@${VPS_HOST}:${REMOTE_DIR}"
rsync -avz --exclude 'node_modules' --exclude 'server/node_modules' \
  --exclude 'server/.env' --exclude '.env' --exclude '.DS_Store' --exclude '*.log' \
  "${LOCAL_DIR}/" "${VPS_USER}@${VPS_HOST}:${REMOTE_DIR}/"

echo "==> 2/4 Siapkan .env produksi di VPS (jika belum ada)"
ssh "${VPS_USER}@${VPS_HOST}" "cd ${REMOTE_DIR} && \
  if [ ! -f .env ]; then cp .env.prod.example .env && chmod 600 .env && echo 'BUAT .env DARI TEMPLATE - ISI CLICKUP_TOKEN!'; \
  else echo '.env sudah ada, dilewati'; fi"

echo "==> 3/4 Build & jalankan container (bind 127.0.0.1:${APP_PORT})"
ssh "${VPS_USER}@${VPS_HOST}" "cd ${REMOTE_DIR} && docker compose up -d --build && sleep 8 && \
  curl -s http://127.0.0.1:${APP_PORT}/api/health && echo"

echo "==> 4/4 cloudflared tunnel"
if [ -n "${TUNNEL_TOKEN}" ]; then
  ssh "${VPS_USER}@${VPS_HOST}" "which cloudflared >/dev/null 2>&1 || { \
    curl -fsSL https://pkg.cloudflare.com/cloudflare-main.gpg | sudo tee /usr/share/keyrings/cloudflare-main.gpg >/dev/null && \
    echo 'deb [signed-by=/usr/share/keyrings/cloudflare-main.gpg] https://pkg.cloudflare.com/cloudflared any main' | sudo tee /etc/apt/sources.list.d/cloudflared.list >/dev/null && \
    sudo apt-get update -qq && sudo apt-get install -y cloudflared; }
  sudo cloudflared service install ${TUNNEL_TOKEN}
  sudo systemctl enable --now cloudflared && sudo systemctl status cloudflared --no-pager | head -5"
  echo ">>> Pastikan Public Hostname di Zero Trust dashboard -> Service: http://localhost:${APP_PORT}"
else
  echo "CLOUDFLARE_TUNNEL_TOKEN tidak di-set. Lewati langkah tunnel."
  echo "Jalankan manual: sudo cloudflared service install <TOKEN>"
fi

echo "==> Selesai. Health: http://127.0.0.1:${APP_PORT}/api/health"
