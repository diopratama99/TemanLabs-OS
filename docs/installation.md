# Installing TemanLabsOS

How to install TemanLabsOS on a server, change its configuration, run the development version, and fix common problems.

**English** &nbsp;|&nbsp; [Bahasa Indonesia](installation.id.md)

Coming from TrueNAS SCALE? [Moving from TrueNAS SCALE](migrate-truenas.md) shows how to bring your ZFS pool, shares and apps over safely.

---

## Contents

- [Requirements](#requirements)
- [Installing on a server](#installing-on-a-server)
- [Updating](#updating)
- [Configuration](#configuration)
- [Useful commands](#useful-commands)
- [Development](#development)
- [Troubleshooting](#troubleshooting)

---

## Requirements

**Server**
- Ubuntu 22.04 / 24.04 (tested on 24.04) with systemd.
- Docker Engine (for the App Center, System Monitor and most features).
- Optional, for some features:
  - `ffmpeg`: video thumbnails and Remux (the installer adds it).
  - `restic`: backups. Install it from **Settings → Backup** when you set one up.
  - `rclone`: cloud drives, and backups to them.
  - `smartmontools`, `samba`, `ufw`, `udisks2`: disk health, file sharing, the firewall, USB drives.
  - CasaOS: its apps are read too, if it's there.
- Kubernetes **doesn't need setting up**: k3s can be installed from the Kubernetes app.

**Computer to build on**
- Node.js 20.19+ or 22.12+.
- Go 1.27+.

**Browser**: Chrome, Edge or Brave for the full glass effect. Firefox and Safari work too, with a simpler blur.

---

## Installing on a server

### Quick install (one command)

```bash
curl -fsSL https://github.com/diopratama99/TemanLabs-OS/releases/latest/download/install.sh | sudo bash
```

The script:
- detects the server's architecture (amd64 / arm64),
- installs Docker through get.docker.com if it's missing (skip with `TEMANLABS_SKIP_DOCKER=1`),
- downloads the binary from GitHub Releases and checks it against `SHA256SUMS`,
- runs the service installer (the same as the manual way below).

Options are environment variables, for example `curl … | sudo TEMANLABS_VERSION=v1.0.0 bash`:

| Variable | Meaning |
|---|---|
| `TEMANLABS_VERSION` | Install this release instead of the latest |
| `TEMANLABS_USER` | Linux user for the Terminal and owner of new files (default: the user running sudo) |
| `TEMANLABS_PORT` | Port of the web desktop, on the first install only (default 80 if nothing else uses it, else 7700) |
| `TEMANLABS_SKIP_DOCKER` | `1` = don't install Docker |

### Manual: build it yourself

#### 1. Build

```bash
npm install
npm run build:server          # → server/bin/temanlabsos-linux-amd64
# for an ARM server (e.g. Raspberry Pi):  node scripts/build-server.mjs arm64
```

This builds the frontend, embeds it in the backend and compiles the Linux binary.

#### 2. Copy it to the server and install

```bash
scp server/bin/temanlabsos-linux-amd64 deploy/install.sh user@server:temanlabsos-deploy/
ssh user@server
cd temanlabsos-deploy
sudo ./install.sh ./temanlabsos-linux-amd64 <linux-user>
```

`<linux-user>` is the Linux user the Terminal runs as, and the owner of new files.

The installer:
- installs the binary to `/opt/temanlabsos/temanlabsos`,
- writes the configuration `/var/lib/temanlabsos/config.json` (mode `0600`),
- creates and starts the systemd service `temanlabsos`,
- on the first install, makes a **random password** and prints it once as `INITIAL_PASSWORD=…`. Keep it somewhere safe.

Optional variables:
- `TEMANLABS_PORT=8080`
- `TEMANLABS_ROOT=/DATA`, to limit Files to the data folder (the default is `/`, the whole filesystem).

For example: `sudo TEMANLABS_ROOT=/DATA ./install.sh ./temanlabsos-linux-amd64 <linux-user>`. These are only used on the first install, when `config.json` is created. After that, change them in the [configuration](#configuration).

#### 3. Open it

Open the address the installer prints (`http://<server-ip>`, or `http://<server-ip>:7700` when port 80 was taken) and sign in with that password. Change it in **Settings → Login & Password**.

---

## Updating

- **From the desktop**: Settings → General → Software Update → *Check for Updates*. TemanLabsOS downloads the newest release from GitHub, checks its checksum, swaps its binary and restarts itself. If the checksum doesn't match, nothing changes. Settings shows a badge when a new version is out.
- **From a terminal**: run the one-line command above again.
- **Your own build**: repeat manual steps 1–2.

The configuration, password and everything in the state folder stay as they are.

### Making a release (for the repository's maintainers)

Push a version tag. GitHub Actions (`.github/workflows/release.yml`) builds amd64 and arm64 and makes a Release with the binaries, `install.sh`, `install-service.sh` and `SHA256SUMS`:

```bash
git tag v1.0.0
git push origin v1.0.0
```

> While the old binary runs, `scp` straight onto the same name can fail with *text file busy*. Upload it under another name (e.g. `.new`), then `mv` it.

---

## Configuration

File: `/var/lib/temanlabsos/config.json`

| Key | Default | Meaning |
|---|---|---|
| `addr` | `:80` (`:7700` if port 80 was taken at install) | Address and port to listen on. `:80` opens it without a port (`http://<server-ip>/`), as long as nothing else uses port 80. |
| `redirectFrom` | (empty) | Old addresses that redirect to `addr`, for example `[":7700"]` after moving to `:80`, so old bookmarks keep working. |
| `root` | `/` | Top folder for Files and Code. Set `/DATA` to limit it. |
| `user` | (from the installer) | Linux user for the Terminal and owner of new files. |
| `stateDir` | `/var/lib/temanlabsos` | Where TemanLabsOS keeps its own files: app compose files, wallpapers, thumbnails, backup plans and the recovery key, share links, tags, the 30-day history and app health. |
| `passwordHash` | (made automatically) | PBKDF2 hash of the password. Don't edit it by hand; use `set-password`. |

Restart the service after changing the configuration.

### Moving from CasaOS

TemanLabsOS can run next to CasaOS. To remove CasaOS and give TemanLabsOS port 80:

1. Make sure the data disks are mounted through `/etc/fstab` (**Disk Manager → Mount at startup**), not by CasaOS.
2. Back up, then stop the CasaOS services (`casaos`, `casaos-gateway`, `casaos-app-management`, `casaos-local-storage`, `casaos-message-bus`, `casaos-user-service`, and the `rclone` and `devmon@devmon` it set up), and remove their unit files and `/usr/bin/casaos*`.
3. **Don't** use `casaos-uninstall` if its apps should keep running: that script can remove every container, image and `/DATA/AppData`. Also keep `/var/lib/casaos/apps` (the apps' compose files, which TemanLabsOS manages them with), `/etc/samba/smb.casa.conf` (Samba shares) and `/usr/bin/rclone` (cloud drives).
4. Set `"addr": ":80"` and `"redirectFrom": [":7700"]`, then restart TemanLabsOS. If nginx is installed with its default site on port 80, disable it so they don't race for the port at boot.

Docker apps aren't affected: Docker starts their containers again by their own restart policy.

---

## Useful commands

```bash
journalctl -u temanlabsos -f                       # log
sudo systemctl restart temanlabsos                 # restart
sudo systemctl status temanlabsos                  # status
sudo /opt/temanlabsos/temanlabsos -config /var/lib/temanlabsos/config.json set-password   # reset the password
```

---

## Development

```bash
npm install
npm run dev:mock     # the UI only, with sample data in memory, no server → http://localhost:5173
npm run dev          # the UI with hot reload, talking to a real TemanLabsOS server
npm run build        # type-check and build the frontend into dist/
```

`npm run dev` proxies `/api` and `/ws` to `http://localhost:7700`. To use another server, create `.env.local` (not committed):

```bash
TEMANLABS_SERVER=http://my-server:7700
```

Or through an SSH tunnel: `ssh -L 7700:localhost:7700 user@server`.

If signing in shows **Bad Gateway** in dev mode, the server can't be reached. Check `.env.local` or the tunnel.

How the code works, and every API endpoint, is in [architecture.md](architecture.md).

---

## Troubleshooting

| Problem | Fix |
|---|---|
| Forgot the password | `sudo /opt/temanlabsos/temanlabsos -config /var/lib/temanlabsos/config.json set-password` |
| The page doesn't open | `systemctl status temanlabsos`, then `journalctl -u temanlabsos -n 50`. Make sure TemanLabsOS's port (80, or 7700 when port 80 was taken at install) is allowed by the firewall and not used by another program. |
| `scp` fails: *text file busy* | Upload under another name, then `mv` (see [Updating](#updating)). |
| An app won't show in its window | Use **Open in New Tab**. Some apps refuse to be shown inside a frame. |
| A window says *Something went wrong in this window* | Click **Reload Window**. The rest of the desktop keeps working; the message under it says what failed. |
| Video thumbnails don't appear | Install `ffmpeg`: `sudo apt install ffmpeg`. |
| A backup to a cloud drive fails | Check the drive is connected in **Disk Manager → Cloud Drives**. The error from the last run is shown on the backup's page. |
| Backups can't be read after a reinstall | Enter the old recovery key in **Settings → Backup → Recovery Key → Backups from before**, then add a backup plan with the same destination. |
| A share link doesn't open for someone else | Links use the address you opened TemanLabsOS with, which only works on your network or Tailscale. Point a public address (a Cloudflare Tunnel or Tailscale Funnel) at the server and enter it in **Settings → General → Sharing → Address for links**. |
| Kubernetes pods stay in *ContainerCreating* | The images are still downloading. Check **Kubernetes → Events**. See also [kubernetes-lab.md](kubernetes-lab.md#10-troubleshooting). |
| No glass effect | Use a Chromium-based browser, or turn off *Reduce Transparency* in Settings. |
