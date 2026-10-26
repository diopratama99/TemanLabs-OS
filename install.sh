#!/usr/bin/env bash
# TemanLabsOS installer. Installs (or updates) the latest release as a systemd service:
#
#   curl -fsSL https://github.com/diopratama99/TemanLabs-OS/releases/latest/download/install.sh | sudo bash
#
# Options (environment variables):
#   TEMANLABS_VERSION=v1.2.0   install that release instead of the latest
#   TEMANLABS_USER=name        Linux user for the Terminal and new files (default: the sudo user)
#   TEMANLABS_PORT=8080        port for the web desktop (first install only; default 80 if free, else 7700)
#   TEMANLABS_SKIP_DOCKER=1    don't install Docker when it's missing
set -euo pipefail

REPO="${TEMANLABS_REPO:-diopratama99/TemanLabs-OS}"
VERSION="${TEMANLABS_VERSION:-latest}"

say() { printf '\033[1;34m==>\033[0m %s\n' "$*"; }
die() { printf '\033[1;31mError:\033[0m %s\n' "$*" >&2; exit 1; }

[ "$(id -u)" -eq 0 ] || die "run the installer with sudo:  curl -fsSL … | sudo bash"
command -v systemctl >/dev/null || die "TemanLabsOS needs a Linux with systemd (Ubuntu, Debian, …)"
command -v curl >/dev/null || die "curl is missing:  apt install curl"

case "$(uname -m)" in
  x86_64 | amd64) ARCH=amd64 ;;
  aarch64 | arm64) ARCH=arm64 ;;
  *) die "unsupported CPU: $(uname -m) (amd64 and arm64 are supported)" ;;
esac

APP_USER="${TEMANLABS_USER:-${SUDO_USER:-}}"
if [ -z "$APP_USER" ] || [ "$APP_USER" = root ]; then
  APP_USER="$(getent passwd | awk -F: '$3 >= 1000 && $3 < 65534 { print $1; exit }')"
fi
[ -n "$APP_USER" ] && id "$APP_USER" >/dev/null 2>&1 || die "no regular user found; set TEMANLABS_USER=<name>"

if ! command -v docker >/dev/null; then
  if [ "${TEMANLABS_SKIP_DOCKER:-}" = 1 ]; then
    say "Docker isn't installed; App Center and System Monitor need it (skipped as asked)."
  else
    say "Installing Docker (get.docker.com)…"
    curl -fsSL https://get.docker.com | sh
    usermod -aG docker "$APP_USER" || true
  fi
fi

if [ "$VERSION" = latest ]; then
  BASE="https://github.com/$REPO/releases/latest/download"
else
  BASE="https://github.com/$REPO/releases/download/$VERSION"
fi

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
cd "$TMP"
say "Downloading TemanLabsOS ($VERSION, $ARCH)…"
for f in "temanlabsos-linux-$ARCH" install-service.sh SHA256SUMS; do
  curl -fsSL -o "$f" "$BASE/$f" || die "couldn't download $f from $BASE"
done
grep -E " \*?(temanlabsos-linux-$ARCH|install-service\.sh)\$" SHA256SUMS | sha256sum -c - >/dev/null ||
  die "the download doesn't match SHA256SUMS"
chmod +x "temanlabsos-linux-$ARCH" install-service.sh

say "Installing for user $APP_USER…"
bash ./install-service.sh "./temanlabsos-linux-$ARCH" "$APP_USER"

IP="$(hostname -I 2>/dev/null | awk '{ print $1 }')"
PORT="$(grep -o '"addr": *"[^"]*"' /var/lib/temanlabsos/config.json 2>/dev/null | grep -o '[0-9]*"$' | tr -d '"')"
URL="http://${IP:-<server-ip>}"
[ "${PORT:-80}" = 80 ] || URL="$URL:$PORT"
say "TemanLabsOS is running: $URL"
say "Sign in with the INITIAL_PASSWORD above (first install), then change it in Settings → Account."
