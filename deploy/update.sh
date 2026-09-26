#!/usr/bin/env bash
# Deploys the latest commit: pull, install, build, restart. Run as root.
set -euo pipefail
APP_DIR=/opt/redmoon
APP_USER=redmoon

sudo -u "$APP_USER" -H env -u NODE_ENV bash -c "cd '$APP_DIR' && git pull --ff-only && npm ci --include=dev && npm run build"
systemctl restart redmoon
systemctl --no-pager --lines=5 status redmoon
