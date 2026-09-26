#!/usr/bin/env bash
# First-time setup of a Red Moon Pub server on Ubuntu 24.04. Run as root:
#
#   CERT_EMAIL=you@example.com bash /opt/redmoon/deploy/install.sh redmoonpub.hu www.redmoonpub.hu
#
# Before running: the checkout is at /opt/redmoon with a filled-in .env next
# to it (see README → Deployment), and the domain's A record points here so
# certbot can issue the certificate. Safe to run again: every step checks
# what is already there.
set -euo pipefail

if [[ $# -lt 1 ]]; then
  echo "usage: bash deploy/install.sh <domain> [<more domains>...]" >&2
  exit 1
fi
DOMAINS=("$@")
APP_DIR=/opt/redmoon
APP_USER=redmoon
REPO=${REPO:-https://github.com/sunwahtong/redmoonpub.git}
CERT_EMAIL=${CERT_EMAIL:-}

export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-get install -y ca-certificates curl git nginx ufw certbot python3-certbot-nginx

# Node 24 (see .nvmrc) from NodeSource.
if ! command -v node >/dev/null 2>&1 || [[ "$(node -v)" != v24.* ]]; then
  curl -fsSL https://deb.nodesource.com/setup_24.x | bash -
  apt-get install -y nodejs
fi

# 2 GB of RAM is enough to run the site, tight to build it: give the build swap.
if [[ ! -f /swapfile ]]; then
  fallocate -l 2G /swapfile
  chmod 600 /swapfile
  mkswap /swapfile
  swapon /swapfile
  echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi

# The service runs as its own user with no login shell.
id -u "$APP_USER" >/dev/null 2>&1 || useradd --system --create-home --home-dir "/var/lib/$APP_USER" --shell /usr/sbin/nologin "$APP_USER"

# The checkout, owned by the service user (git refuses to work in a directory owned by someone else).
if [[ -d $APP_DIR/.git ]]; then
  chown -R "$APP_USER:$APP_USER" "$APP_DIR"
  sudo -u "$APP_USER" -H git -C "$APP_DIR" pull --ff-only
else
  install -d -o "$APP_USER" -g "$APP_USER" "$APP_DIR"
  sudo -u "$APP_USER" -H git clone --depth 1 "$REPO" "$APP_DIR"
fi
if [[ ! -f $APP_DIR/.env ]]; then
  cp "$APP_DIR/.env.example" "$APP_DIR/.env"
  chown "$APP_USER:$APP_USER" "$APP_DIR/.env"
  echo "Created $APP_DIR/.env from .env.example. Fill it in, then run this script again." >&2
  exit 1
fi
chmod 600 "$APP_DIR/.env"

# Build. NODE_ENV must not be "production" here: the build needs devDependencies.
sudo -u "$APP_USER" -H env -u NODE_ENV bash -c "cd '$APP_DIR' && npm ci --include=dev && npm run build"

# The service.
install -m 644 "$APP_DIR/deploy/redmoon.service" /etc/systemd/system/redmoon.service
systemctl daemon-reload
systemctl enable redmoon
systemctl restart redmoon

# nginx in front: TLS, the tile pack from disk, everything else to Node on 127.0.0.1:3000.
sed "s#__DOMAIN__#${DOMAINS[*]}#" "$APP_DIR/deploy/nginx.conf" > /etc/nginx/sites-available/redmoon
ln -sf /etc/nginx/sites-available/redmoon /etc/nginx/sites-enabled/redmoon
rm -f /etc/nginx/sites-enabled/default
nginx -t
systemctl reload nginx

# Firewall: SSH and the web ports only. Node's port stays local.
ufw allow OpenSSH
ufw allow 'Nginx Full'
ufw --force enable

# The certificate (Let's Encrypt; certbot's timer renews it). Needs the DNS record in place.
CERT_ARGS=()
for domain in "${DOMAINS[@]}"; do CERT_ARGS+=(-d "$domain"); done
if [[ -n $CERT_EMAIL ]]; then CERT_ARGS+=(-m "$CERT_EMAIL"); else CERT_ARGS+=(--register-unsafely-without-email); fi
if ! certbot --nginx --non-interactive --agree-tos --redirect "${CERT_ARGS[@]}"; then
  echo "certbot failed. Check that ${DOMAINS[0]} resolves to this server, then run: certbot --nginx --redirect ${CERT_ARGS[*]}" >&2
fi

echo
echo "Done. Site: https://${DOMAINS[0]}"
echo "Logs: journalctl -u redmoon -f    Update: bash $APP_DIR/deploy/update.sh"
