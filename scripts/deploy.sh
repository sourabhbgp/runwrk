#!/usr/bin/env bash
set -euo pipefail

VPS="root@72.62.74.106"
DIR="/data/runwrk/repo"

echo "Deploying to VPS..."
ssh "$VPS" "cd $DIR && git pull origin main && docker compose -f docker-compose.prod.yml up -d --build"
echo "Deploy complete."
