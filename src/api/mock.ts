import type { FileEntry, StoreApp, SystemStats } from './types'

export const catalog: StoreApp[] = [
  { id: 'jellyfin', name: 'Jellyfin', icon: 'film', color: ['#a95ce0', '#00a4dc'], category: 'Media', description: 'Stream your movies, shows and music to any device.', port: 8096 },
  { id: 'nextcloud', name: 'Nextcloud', icon: 'cloud', color: ['#1cafff', '#0068b8'], category: 'Productivity', description: 'Your own private cloud for files, calendar and contacts.', port: 8081 },
  { id: 'homeassistant', name: 'Home Assistant', icon: 'house', color: ['#41d1ff', '#0389c4'], category: 'Smart Home', description: 'Open-source home automation that puts local control first.', port: 8123 },
  { id: 'pihole', name: 'Pi-hole', icon: 'shield', color: ['#ff4d5a', '#a3060e'], category: 'Network', description: 'Network-wide ad blocking through your own DNS server.', port: 8053 },
  { id: 'portainer', name: 'Portainer', icon: 'boxes', color: ['#3dd0ff', '#0b6fa4'], category: 'Developer', description: 'Manage Docker containers, images, volumes and networks.', port: 9000 },
  { id: 'vaultwarden', name: 'Vaultwarden', icon: 'key', color: ['#4c8dff', '#123a99'], category: 'Productivity', description: 'Lightweight Bitwarden-compatible password manager.', port: 8222 },
  { id: 'qbittorrent', name: 'qBittorrent', icon: 'download', color: ['#7fbdf7', '#2f67ba'], category: 'Media', description: 'Fast, open-source BitTorrent client with a web UI.', port: 8090 },
  { id: 'immich', name: 'Immich', icon: 'images', color: ['#ff7a59', '#e0418f'], category: 'Media', description: 'High-performance photo and video backup for your phone.', port: 2283 },
  { id: 'navidrome', name: 'Navidrome', icon: 'music', color: ['#3ec7ff', '#3d5afe'], category: 'Media', description: 'Modern music server compatible with Subsonic clients.', port: 4533 },
  { id: 'uptimekuma', name: 'Uptime Kuma', icon: 'activity', color: ['#6ee7a0', '#14a05a'], category: 'Network', description: 'Monitor your services and get alerts when they go down.', port: 3001 },
  { id: 'n8n', name: 'n8n', icon: 'workflow', color: ['#ff8a6b', '#e6366b'], category: 'Productivity', description: 'Workflow automation with hundreds of integrations.', port: 5678 },
  { id: 'codeserver', name: 'Code Server', icon: 'code', color: ['#4cc2ff', '#005fa3'], category: 'Developer', description: 'VS Code running in your browser, on your server.', port: 8443 },
]

export const initialInstalled: Record<string, 'running' | 'stopped'> = {
  jellyfin: 'running',
  nextcloud: 'running',
  homeassistant: 'running',
  pihole: 'running',
  portainer: 'stopped',
  vaultwarden: 'running',
  qbittorrent: 'stopped',
  immich: 'running',
}

const GB = 1024 ** 3
const bootTime = Date.now() - (12 * 86400 + 5 * 3600) * 1000
let cpu = 18
let mem = 6.4 * GB
let rx = 2.4e6
let tx = 0.6e6

const walk = (value: number, step: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value + (Math.random() - 0.5) * step))

export function nextStats(): SystemStats {
  cpu = walk(cpu, 14, 3, 92)
  mem = walk(mem, 0.4 * GB, 4 * GB, 13 * GB)
  rx = walk(rx, 2e6, 5e4, 12e6)
  tx = walk(tx, 6e5, 1e4, 4e6)
  return {
    hostname: 'teman-server',
    os: 'Ubuntu 24.04.3 LTS',
    kernel: '6.8.0-79-generic',
    uptime: (Date.now() - bootTime) / 1000,
    cpu: { usage: cpu, cores: 8, temp: 38 + cpu * 0.35, model: 'Intel Core i5-12400' },
    memory: { used: mem, total: 16 * GB },
    disks: [
      { name: 'System', mount: '/', used: 48 * GB, total: 256 * GB },
      { name: 'Data', mount: '/DATA', used: 1352 * GB, total: 2048 * GB },
    ],
    network: { rx, tx },
    addresses: {
      lan: { interface: 'eth0', ipv4: '192.168.1.20' },
      tailscale: { ipv4: '100.101.102.103', dnsName: 'teman-server.tail1a2b3c.ts.net' },
    },
  }
}

/** Text file contents by full path, for the code editor. */
export const contents: Record<string, string> = {
  '/DATA/Documents/Notes.md': `# Server notes

- Jellyfin library lives in \`/DATA/Media\`
- Nightly backup runs at 02:00 — see \`/DATA/Projects/scripts/backup.sh\`
- TODO: move Immich thumbnails to the SSD
- TODO: renew the Cloudflare tunnel token before December
`,
  '/DATA/Projects/README.md': `# Projects

Small things running on **teman-server**.

| Folder | What |
| --- | --- |
| \`temanlabs-site\` | Static landing page served by Caddy |
| \`scripts\` | Backup and health-check jobs (cron) |
`,
  '/DATA/Projects/temanlabs-site/index.html': `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>TemanLabs</title>
    <link rel="stylesheet" href="style.css" />
  </head>
  <body>
    <main class="hero">
      <h1>TemanLabs</h1>
      <p>Self-hosted services for friends and family.</p>
      <ul id="status"></ul>
    </main>
    <script type="module" src="app.js"></script>
  </body>
</html>
`,
  '/DATA/Projects/temanlabs-site/style.css': `:root {
  --accent: #5e5ce6;
  font-family: system-ui, sans-serif;
}

body {
  margin: 0;
  min-height: 100vh;
  display: grid;
  place-items: center;
  background: linear-gradient(160deg, #0d1b4c, #3a1f6e);
  color: white;
}

.hero h1 {
  font-size: clamp(2.5rem, 6vw, 4rem);
  margin: 0;
}

#status li.up::before {
  content: "●";
  color: #30d158;
  margin-right: 0.5em;
}
`,
  '/DATA/Projects/temanlabs-site/app.js': `const SERVICES = [
  { name: 'Jellyfin', url: '/jellyfin/health' },
  { name: 'Nextcloud', url: '/nextcloud/status.php' },
  { name: 'Immich', url: '/immich/api/server/ping' },
]

async function check(service) {
  try {
    const res = await fetch(service.url, { cache: 'no-store' })
    return { ...service, up: res.ok }
  } catch {
    return { ...service, up: false }
  }
}

const list = document.querySelector('#status')
const results = await Promise.all(SERVICES.map(check))

for (const { name, up } of results) {
  const item = document.createElement('li')
  item.textContent = \`\${name} — \${up ? 'online' : 'offline'}\`
  item.className = up ? 'up' : 'down'
  list.append(item)
}
`,
  '/DATA/Projects/scripts/backup.sh': `#!/usr/bin/env bash
# Nightly backup of app data to the external drive. Runs from cron at 02:00.
set -euo pipefail

SOURCE="/DATA/AppData"
TARGET="/mnt/backup/appdata"
KEEP_DAYS=14
STAMP="$(date +%Y-%m-%d)"

echo "[backup] starting $STAMP"
mkdir -p "$TARGET/$STAMP"

for app in "$SOURCE"/*/; do
  name="$(basename "$app")"
  tar -czf "$TARGET/$STAMP/$name.tar.gz" -C "$SOURCE" "$name"
  echo "[backup] saved $name"
done

find "$TARGET" -mindepth 1 -maxdepth 1 -type d -mtime +"$KEEP_DAYS" -exec rm -rf {} +
echo "[backup] done"
`,
  '/DATA/Projects/scripts/healthcheck.py': `"""Ping every app and report the ones that are down."""
import urllib.request

APPS = {
    "jellyfin": "http://localhost:8096/health",
    "nextcloud": "http://localhost:8081/status.php",
    "homeassistant": "http://localhost:8123/",
}


def is_up(url: str, timeout: float = 3.0) -> bool:
    try:
        with urllib.request.urlopen(url, timeout=timeout) as response:
            return response.status < 500
    except OSError:
        return False


if __name__ == "__main__":
    down = [name for name, url in APPS.items() if not is_up(url)]
    print("all good" if not down else f"down: {', '.join(down)}")
`,
  '/DATA/AppData/jellyfin/docker-compose.yml': `services:
  jellyfin:
    image: jellyfin/jellyfin:latest
    container_name: jellyfin
    restart: unless-stopped
    ports:
      - "8096:8096"
    volumes:
      - ./config:/config
      - ./cache:/cache
      - /DATA/Media:/media:ro
    environment:
      - TZ=Asia/Jakarta
`,
  '/DATA/AppData/nextcloud/docker-compose.yml': `services:
  nextcloud:
    image: nextcloud:stable
    container_name: nextcloud
    restart: unless-stopped
    ports:
      - "8081:80"
    volumes:
      - ./html:/var/www/html
    environment:
      - MYSQL_HOST=db
      - MYSQL_DATABASE=nextcloud
    depends_on:
      - db

  db:
    image: mariadb:11
    restart: unless-stopped
    volumes:
      - ./db:/var/lib/mysql
`,
}

const folder = (name: string, modified = '2026-10-20'): FileEntry => ({ name, kind: 'folder', modified })

const textFile = (dir: string, name: string, modified = '2026-10-20'): FileEntry => ({
  name,
  kind: name.endsWith('.md') ? 'document' : 'code',
  size: contents[`${dir}/${name}`]?.length ?? 0,
  modified,
})

export const files: Record<string, FileEntry[]> = {
  '/DATA': [folder('AppData'), folder('Documents'), folder('Downloads'), folder('Gallery'), folder('Media'), folder('Projects')],
  '/DATA/AppData': [folder('homeassistant'), folder('immich'), folder('jellyfin'), folder('nextcloud'), folder('pihole'), folder('vaultwarden')],
  '/DATA/AppData/jellyfin': [folder('config'), textFile('/DATA/AppData/jellyfin', 'docker-compose.yml', '2026-09-02')],
  '/DATA/AppData/nextcloud': [folder('html'), textFile('/DATA/AppData/nextcloud', 'docker-compose.yml', '2026-09-02')],
  '/DATA/Projects': [folder('scripts'), folder('temanlabs-site'), textFile('/DATA/Projects', 'README.md', '2026-10-12')],
  '/DATA/Projects/scripts': [
    textFile('/DATA/Projects/scripts', 'backup.sh', '2026-10-05'),
    textFile('/DATA/Projects/scripts', 'healthcheck.py', '2026-10-18'),
  ],
  '/DATA/Projects/temanlabs-site': [
    textFile('/DATA/Projects/temanlabs-site', 'app.js', '2026-10-21'),
    textFile('/DATA/Projects/temanlabs-site', 'index.html', '2026-10-21'),
    textFile('/DATA/Projects/temanlabs-site', 'style.css', '2026-10-21'),
  ],
  '/DATA/Documents': [
    folder('Backups'),
    { name: 'Invoice-September.pdf', kind: 'document', size: 248_000, modified: '2026-10-02' },
    { name: 'Network-Diagram.png', kind: 'image', size: 1_420_000, modified: '2026-09-28' },
    textFile('/DATA/Documents', 'Notes.md', '2026-10-21'),
  ],
  '/DATA/Documents/Backups': [
    { name: 'homeassistant-2026-10-01.tar', kind: 'archive', size: 412_000_000, modified: '2026-10-01' },
    { name: 'nextcloud-db-2026-10-15.sql.gz', kind: 'archive', size: 88_000_000, modified: '2026-10-15' },
  ],
  '/DATA/Downloads': [
    { name: 'ubuntu-24.04.3-live-server-amd64.iso', kind: 'archive', size: 3_100_000_000, modified: '2026-09-12' },
    { name: 'wallpaper-pack.zip', kind: 'archive', size: 86_000_000, modified: '2026-10-18' },
    { name: 'podcast-episode-42.mp3', kind: 'audio', size: 54_000_000, modified: '2026-10-19' },
  ],
  '/DATA/Gallery': [
    folder('Bali 2026'),
    { name: 'IMG_2041.jpg', kind: 'image', size: 4_100_000, modified: '2026-10-11' },
    { name: 'IMG_2042.jpg', kind: 'image', size: 3_800_000, modified: '2026-10-11' },
    { name: 'Birthday.mov', kind: 'video', size: 612_000_000, modified: '2026-08-30' },
  ],
  '/DATA/Gallery/Bali 2026': [
    { name: 'Uluwatu.jpg', kind: 'image', size: 5_200_000, modified: '2026-07-04' },
    { name: 'Ubud-Rice-Terrace.jpg', kind: 'image', size: 4_900_000, modified: '2026-07-05' },
    { name: 'Sunset-Kuta.mov', kind: 'video', size: 840_000_000, modified: '2026-07-06' },
  ],
  '/DATA/Media': [folder('Movies'), folder('Music'), folder('TV Shows')],
  '/DATA/Media/Movies': [
    { name: 'Big Buck Bunny (2008).mkv', kind: 'video', size: 2_300_000_000, modified: '2026-05-02' },
    { name: 'Sintel (2010).mkv', kind: 'video', size: 1_900_000_000, modified: '2026-05-02' },
  ],
  '/DATA/Media/Music': [
    { name: 'Lo-fi Beats.flac', kind: 'audio', size: 38_000_000, modified: '2026-06-14' },
    { name: 'Morning Jazz.flac', kind: 'audio', size: 41_000_000, modified: '2026-06-14' },
  ],
  '/DATA/Media/TV Shows': [],
}
