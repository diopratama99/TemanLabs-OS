#!/usr/bin/env bash
# Installs or updates TemanLabsOS as a systemd service. Run on the server, as root:
#   sudo ./install.sh <path-to-temanlabsos-binary> [linux-user]
# A first install listens on port 80, so the desktop opens without a port, unless something else
# has it (CasaOS, nginx, another web server): then on 7700. TEMANLABS_PORT picks one outright.
set -euo pipefail

BIN_SRC="${1:?usage: install.sh <binary> [user]}"
APP_USER="${2:-${SUDO_USER:-}}"
PORT="${TEMANLABS_PORT:-}"
# File manager root: "/" browses the whole filesystem like CasaOS; TEMANLABS_ROOT=/DATA limits it.
ROOT_DIR="${TEMANLABS_ROOT:-/}"

INSTALL_DIR=/opt/temanlabsos
STATE_DIR=/var/lib/temanlabsos
CONFIG="$STATE_DIR/config.json"
UNIT=/etc/systemd/system/temanlabsos.service

if [ "$(id -u)" -ne 0 ]; then
  echo "install.sh must run as root (sudo)." >&2
  exit 1
fi
if [ -z "$APP_USER" ] || ! id "$APP_USER" >/dev/null 2>&1; then
  echo "Give the Linux user the terminal should run as: install.sh <binary> <user>" >&2
  exit 1
fi

install -d -m 0755 "$INSTALL_DIR"
install -m 0755 "$BIN_SRC" "$INSTALL_DIR/temanlabsos.new"
mv -f "$INSTALL_DIR/temanlabsos.new" "$INSTALL_DIR/temanlabsos"

install -d -m 0700 "$STATE_DIR"
if [ ! -f "$CONFIG" ]; then
  # Port 80 if nothing listens there and CasaOS (which wants it back at boot) isn't installed.
  if [ -z "$PORT" ]; then
    if command -v ss >/dev/null && ! ss -Hltn 'sport = :80' 2>/dev/null | grep -q . && ! systemctl cat casaos-gateway.service >/dev/null 2>&1 && ! systemctl cat casaos.service >/dev/null 2>&1; then
      PORT=80
    else
      PORT=7700
      echo "Port 80 is in use, so TemanLabsOS listens on 7700. To move it later, see docs/installation.md (addr)."
    fi
  fi
  cat >"$CONFIG" <<EOF
{
  "addr": ":$PORT",
  "root": "$ROOT_DIR",
  "user": "$APP_USER",
  "stateDir": "$STATE_DIR"
}
EOF
  chmod 0600 "$CONFIG"
fi

# First install: set a random password and print it once. Change it later in
# Settings → Account, or with: sudo /opt/temanlabsos/temanlabsos set-password
if ! grep -q '"passwordHash": *"pbkdf2' "$CONFIG"; then
  PASSWORD="$(head -c 18 /dev/urandom | base64 | tr -d '/+=' | cut -c1-16)"
  printf '%s\n' "$PASSWORD" | "$INSTALL_DIR/temanlabsos" -config "$CONFIG" set-password >/dev/null 2>&1
  echo "INITIAL_PASSWORD=$PASSWORD"
fi

cat >"$UNIT" <<EOF
[Unit]
Description=TemanLabsOS web desktop
After=network-online.target docker.service
Wants=network-online.target

[Service]
ExecStart=$INSTALL_DIR/temanlabsos -config $CONFIG
WorkingDirectory=$STATE_DIR
Restart=on-failure
RestartSec=3

[Install]
WantedBy=multi-user.target
EOF

# Files shows video thumbnails with ffmpeg; photos work without it.
if ! command -v ffmpeg >/dev/null 2>&1 && command -v apt-get >/dev/null 2>&1; then
  echo "Installing ffmpeg for video thumbnails…"
  DEBIAN_FRONTEND=noninteractive apt-get install -y -qq ffmpeg >/dev/null || echo "ffmpeg not installed; video thumbnails are off" >&2
fi

systemctl daemon-reload
systemctl enable temanlabsos >/dev/null 2>&1
systemctl restart temanlabsos
sleep 1
systemctl --no-pager --lines=5 status temanlabsos | head -12
