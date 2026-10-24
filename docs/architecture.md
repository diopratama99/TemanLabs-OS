# TemanLabsOS architecture

For developers: how the frontend and backend work, how it's built, and every API endpoint.

**English** &nbsp;|&nbsp; [Bahasa Indonesia](architecture.id.md)

---

## Overview

```
┌──────────────── Browser ────────────────┐         ┌──────────── Ubuntu server ─────────────┐
│ React app (src/)                        │  HTTP   │ temanlabsos  (Go, systemd, :7700/:80)  │
│  ├─ Desktop: Window, Dock, Launcher,    │ ──────▶ │  ├─ static: frontend (embedded)        │
│  │   MenuBar, QuickSearch, widgets      │  /api/* │  ├─ auth + sameOrigin middleware       │
│  ├─ windows/*: one component per app    │         │  ├─ one handler file per area (*.go)   │
│  ├─ components/settings/*: Settings     │   WS    │  ├─ background: stats sampler, history,│
│  └─ api/: httpApi ⇄ mockApi             │ ──────▶ │  │   app health, backup schedule, jobs │
└─────────────────────────────────────────┘ /ws/... │  ├─ frame proxy per app (:7710–7799)   │
                                     share links /s/│  └─ public share-link pages (/s/…)     │
                                                    │        │                               │
                                                    │        ├─ Docker Engine (unix socket)  │
                                                    │        ├─ restic, rclone, k3s kubectl  │
                                                    │        └─ systemctl, journalctl, apt,  │
                                                    │           ufw, smbd, lsblk, crontab, … │
                                                    └────────────────────────────────────────┘
```

- **One binary.** `scripts/build-server.mjs` builds the frontend into `dist/`, copies it to `server/web/`, then `go build` embeds that folder (`//go:embed`) and compiles for Linux (`CGO_ENABLED=0`).
- **No database.** State lives in files under `stateDir` (`/var/lib/temanlabsos`), written atomically (a temporary file, then a rename), mostly mode `0600`:

  | File | What's in it |
  |---|---|
  | `config.json` | Address, root, user, password hash |
  | `apps/<id>/docker-compose.yml` | Apps installed from the App Center |
  | `wallpapers/`, `thumbs/` | Wallpapers and the thumbnail cache |
  | `backups.json`, `backup.key` | Backup plans and the recovery key every backup is encrypted with |
  | `links.json` | Share links (password hashes only) and the public address |
  | `files.json` | Color tags and recently opened files |
  | `history.bin` | One point a minute for 30 days (CPU, memory, temperature, network, disk, power) |
  | `health.json` | Each app's outages and its auto-restart setting |
  | `containerized.json` | Apps moved from pm2 into Docker, to move them back |
  | `devices.json`, `app-logins.json`, `sessions.json` | Other computers, saved app logins, signed-in browsers |
  | `trash/` | The Trash of the filesystem the state folder is on (other disks keep theirs in `.Trash-temanlabs` at their root) |

  Desktop preferences (theme, widgets, Launcher folders) stay in the browser's `localStorage`.

---

## Frontend (`src/`)

| Part | What it does |
|---|---|
| `App.tsx` | The desktop: open windows, z-order, each app's menu bar, the Dock, Launcher, Quick Search and toasts. `SYSTEM_WINDOWS` has each app's title and first size; `renderWindow` picks its component, wrapped in a `WindowErrorBoundary` so one crashing window doesn't blank the page. |
| `components/Window.tsx` | The window frame: dragging, resizing from every edge, minimize/zoom/close with animations (Web Animations API). `SystemWindowId` lists the built-in apps. |
| `components/settings/*` | Settings sections: `ServerSections` (network, ad blocking, remote access, power, sharing, startup apps, about), `DesktopSections`, `AppsSection` (installed apps, health, move to Docker), `BackupSection`. Pages inside a section are part of Settings' back/forward history. |
| `components/Glass.tsx` + `lib/displacement.ts` | The glass effect: a displacement map for `backdrop-filter` (Chromium), with a plain blur elsewhere. |
| `components/HistoryChart.tsx` | SVG line chart for System Monitor → History: one axis, gaps where the server was off, crosshair and tooltip. |
| `lib/systemApps.ts` | Names, icons, colors and place (Dock / Utilities folder) of the built-in apps. |
| `lib/appMenus.tsx` | `useAppMenus()`: an app registers its own menus in the menu bar. Keyboard shortcuts on menu items work by themselves. |
| `lib/windowChrome.tsx` | `WindowToolbar` and `ToolbarTitle`: a toolbar merged into the title bar. |
| `lib/contextMenu.tsx` | `useContextMenu().show(event, items)`: right-click menus, also used by `PopUpButton`. |
| `lib/i18n.ts` + `lib/i18n-id.ts` | Translations. The English text is the key: `tr('Open')`, values through `tr('{0} apps', n)`. The Indonesian dictionary is `i18n-id.ts`; text without a translation shows in English. |
| `hooks/useJob.ts` | Follows a server job (backup, restore, update, install) until it ends, retrying a failed poll. |
| `api/httpApi.ts` | Every call to the backend. |
| `api/mockApi.ts`, `api/mockSystem.ts` | The same `Api` with in-memory data, for `npm run dev:mock`. |
| `api/types.ts` | Types matching the backend's JSON. |

### Adding a built-in app

1. Create its component in `src/windows/AppName.tsx`.
2. Add its id to `SystemWindowId` in `components/Window.tsx`.
3. Add an entry to `SYSTEM_APPS` (`lib/systemApps.ts`). Use `utility: true, dock: false` for the Utilities folder. A new icon is registered in `lib/icons.ts`.
4. In `App.tsx`, add its title and size to `SYSTEM_WINDOWS`, a `case` in `renderWindow`, and `WINDOW_VARIANT` if it has a sidebar.
5. Add its API calls to `api/types.ts`, `httpApi.ts`, and `mockApi.ts` / `mockSystem.ts`.

---

## Backend (`server/`)

One file per area. Every handler is registered in `server.go` (`routes()`).

| File | Responsible for |
|---|---|
| `main.go`, `config.go`, `auth.go` | Starting up, configuration, signing in (PBKDF2, session cookies, login rate limiting), locking a session (423 until unlocked) and the list of signed-in browsers. |
| `server.go` | Routing, the `requireAuth` and `sameOrigin` middleware (cross-site requests are refused), request logging. |
| `system.go`, `hardware.go`, `power.go` | The `/proc` sampler (CPU, memory, disks, network, uptime, LAN/Tailscale addresses), the machine's model from DMI (mini PC, desktop, laptop, VPS…), power draw. |
| `history.go` | One point a minute from the sampler (plus disk throughput from `/proc/diskstats`), kept 30 days in memory and in `history.bin`, served in up to 360 buckets. |
| `docker.go`, `monitor.go`, `apps.go` | The Docker Engine API over its Unix socket, per-container statistics, the app list (compose projects and CasaOS metadata). |
| `health.go` | Checks every app each minute: Docker's own health check, else whether its web page answers. A crash counts at once, no answer after 3 minutes; an app that stops responding is restarted (at most 3 times an hour). An app stopped on purpose is never taken for a crash. |
| `startup.go` | Which apps start with the server: the containers' restart policy (also written into the compose file) or a native app's systemd unit. |
| `containerize.go` | Moving a Node.js app run by pm2 into Docker: the same folder, Node version, user and network; kept only once the container answers, else put back in pm2. |
| `store.go`, `appstore.go`, `custom.go`, `manage.go` | App Center catalogs (compose templates and community stores), Custom Install, app settings, updates and uninstalling. |
| `native.go`, `services.go`, `processes.go`, `ports.go` | Non-Docker apps (found by their listening sockets), systemd services, processes and ports. |
| `frameproxy.go`, `appauth.go` | A reverse proxy per app that strips `X-Frame-Options` / CSP `frame-ancestors` so apps show in windows. For apps behind HTTP Basic (e.g. Supabase Studio behind Kong) the window asks once; the server checks the login with the app, keeps it (`app-logins.json`, 0600), sends it with every request and drops the `WWW-Authenticate` challenge so the browser's dialog never appears. |
| `files.go`, `copy.go`, `thumbs.go`, `media.go`, `fileinfo.go` | The file manager, copy/move, thumbnails (Go for photos, `ffmpeg` for video), media streaming, Get Info. |
| `trash.go`, `filemeta.go` | The Trash (per filesystem, so moving there is a rename; restore to where it was; emptied after 30 days), color tags and Recents. |
| `sharelinks.go`, `sharepage.go` | Share links: a file or folder to download (one file, or a folder as zip), or a folder to send files into, with an optional expiry and password. Visitors get a small page at `/s/<id>` with no session; paths can't leave the shared folder, not even through symlinks. |
| `backups.go` | Backup plans run with restic: apps' compose folders and mounts (found from Docker) and chosen folders, to a disk or an rclone cloud drive, on a schedule, encrypted with the recovery key, thinned to the versions kept. Browse and restore a version, to where it came from (stopping the apps involved) or into another folder. |
| `adblock.go` | Ad blocking for the whole network: AdGuard Home in a container on port 53, its block lists, statistics and allow list. |
| `terminal.go` | A login shell in a PTY, bridged to a WebSocket. |
| `jobs.go` | Long tasks in the background (apt, k3s, backups, restores, updates) with a log the UI follows. One job per kind; Go jobs can be stopped. |
| `updates.go`, `logs.go`, `disks.go`, `storage.go`, `cloud.go`, `network.go`, `cron.go`, `users.go`, `smb.go`, `wallpaper.go`, `convert.go`, `commands.go` | Server tools. |
| `devices.go`, `remote.go` | Other computers: status (ping and port knocks), Wake-on-LAN (a magic packet to every LAN broadcast address), discovery (a /24 sweep, then the ARP table; names from DNS, mDNS, NetBIOS). Remote screens: a `guacd` container (`127.0.0.1:4822`) started through the Docker API; the server does the Guacamole handshake with the saved password, then relays instructions to the WebSocket. |
| `k8s.go` | Installing and removing k3s, reading cluster resources, and actions (`apply`, `scale`, `rollout`, `delete`, …) through `k3s kubectl`. |

### Security in the backend

- User input is checked with regular expressions before it becomes a command argument (container names, systemd units, users, Kubernetes resource names, backup versions…). Commands run through `exec.Command` with separate arguments and no shell, so input can't add a command of its own.
- There are two deliberate exceptions:
  - **Run Now** in Scheduled Tasks runs the user's own cron command, as that user (`runuser … sh -c`).
  - The k3s installer runs a fixed script that's part of the code, with no user input.
- Allow lists for what may be done, such as Kubernetes resource kinds and service actions.
- Important users, services and namespaces are protected from removal; SSH, Docker, TemanLabsOS and Tailscale always start with the server.
- Raw files (`/api/files/raw`) are sent with a CSP `sandbox`, so uploaded HTML/SVG can't run scripts on TemanLabsOS's origin. Share-link pages send their own strict CSP and no referrer.
- Samba's configuration is checked with `testparm` before reloading. Important ports can't be closed from the firewall page, so access can't be locked out.

---

## API endpoints

Every endpoint (except signing in, unlocking and the share-link pages) needs a session cookie. Answers are JSON; errors look like `{"error": "message"}`. Long tasks answer `202` with `{"job": "<kind>"}`; follow them at `/api/jobs/{kind}`.

### Account & system
| Method | Path | What it does |
|---|---|---|
| POST | `/api/login` · `/api/logout` | Sign in / out |
| GET | `/api/me` | Signed in or not, locked or not, hostname |
| POST | `/api/password` | Change the password |
| POST | `/api/lock` · `/api/unlock` | Lock this session / unlock it with the password |
| GET · DELETE | `/api/sessions` · `/api/sessions/{id}` | Signed-in browsers / sign one out |
| POST | `/api/sessions/end-others` | Sign out every other browser |
| GET | `/api/system` | CPU, memory, disks, network, uptime, IP addresses |
| GET | `/api/system/hardware` | The machine: maker, model, kind, serial, VPS or not |
| GET | `/api/system/history?range=1h\|24h\|7d\|30d` | History, in up to 360 buckets (`null` where the server was off) |
| POST | `/api/power/{action}` | Restart / shut down the server |
| GET · POST | `/api/time` | Date, time zone, NTP |
| GET · POST | `/api/system/release` · `/install` | Check GitHub for a release / update itself (job `self-update`) |

### Apps & containers
| Method | Path | What it does |
|---|---|---|
| GET | `/api/store` | App Center catalog |
| GET | `/api/apps` | Installed apps (Docker and native) |
| POST | `/api/apps/custom` | Custom Install (an image or a compose file) |
| POST | `/api/apps/{id}/install` · `start` · `stop` | Install / start / stop an app |
| DELETE | `/api/apps/{id}?data=1` | Uninstall, optionally with its volumes and `/DATA/AppData/…` folder |
| GET | `/api/apps/{id}/frame` · `icon` | The frame proxy's address (plus `auth: "basic"`, `signedIn` for apps that ask for a login) / the app's icon |
| PUT · DELETE | `/api/apps/{id}/signin` | Save an app's HTTP Basic login (checked with the app first; wrong = 422) / forget it |
| GET · PUT | `/api/apps/{id}/config` | App settings (form for the main service, plus compose YAML) / save and recreate (job `app-{id}`) |
| POST | `/api/apps/{id}/update` | Pull newer images and recreate (compose or docker run) |
| GET | `/api/apps/updates?refresh=1` | Image digest checks against the registry, per app |
| GET · PUT | `/api/startup` · `/api/startup/{id}` | Which apps start with the server / change one |
| GET · PUT | `/api/health` · `/api/health/{id}` | Each app's status, uptime and outages / turn auto-restart on or off |
| GET · POST | `/api/apps/{id}/move` | Can this native app move into Docker (and the compose file it would get) / move it (job `move-{id}`) |
| GET · POST | `/api/moved` · `/api/moved/{project}/back` | Apps moved from pm2 / move one back |
| WS | `/ws/apps/{id}/terminal?container=` | A shell inside a container (`docker exec`) |
| GET | `/api/containers` · `/api/networks` | Containers (with statistics) and Docker networks |
| POST | `/api/containers/{id}/{action}` | Start / stop / restart a container |
| GET | `/api/containers/{id}/logs` | A container's log |
| GET | `/api/appstore` | Every app from the app stores (CasaOS format) and the list of stores |
| GET · POST | `/api/appstore/apps/{id}` · `/install` | Details and compose with its variables filled in / install |
| POST · PUT | `/api/appstore/refresh` · `/api/appstore/sources` | Download the stores again / change the list of stores |

### Backup
| Method | Path | What it does |
|---|---|---|
| GET · POST | `/api/backups` | Plans (with last result and next run) and whether restic is installed / add a plan |
| POST | `/api/backups/install` | Install restic (job `apt`) |
| GET · PUT | `/api/backups/key` | The recovery key / put back the key of older backups |
| GET | `/api/backups/destinations` · `/api/backups/apps` | Suggested destinations (other disks, rclone remotes) / the folders each app's backup covers |
| PUT · DELETE | `/api/backups/{id}` | Change / remove a plan (what it stored stays) |
| POST | `/api/backups/{id}/run` · `stop` | Back up now (job `backup-{id}`) / stop the running backup or restore |
| GET | `/api/backups/{id}/versions` | Versions at the plan's destination, newest first |
| GET | `/api/backups/{id}/versions/{version}/files?path=` | One folder of a version |
| POST | `/api/backups/{id}/restore` | `{version, paths, to}`: restore to where it came from (`to: ""`) or into a folder (job `restore-{id}`) |

### Storage & cloud
| Method | Path | What it does |
|---|---|---|
| POST | `/api/disks/automount` · `format` · `eject` | Mount at startup (fstab) / format (job `disk-format`) / eject USB |
| GET | `/api/storage` | fstab entries, merged storage, mergerfs status, USB auto-mount |
| POST · DELETE | `/api/storage/merge[/{name}]` | Create / remove merged storage (mergerfs) |
| PUT | `/api/storage/usb` | USB auto-mount on or off |
| GET · POST · DELETE | `/api/cloud[/{name}]` | Cloud drives (rclone) |
| POST | `/api/cloud/auth` · `/api/cloud/{name}/{action}` | Browser sign-in (OAuth) / mount, unmount, restart |

### Media, commands & devices
| Method | Path | What it does |
|---|---|---|
| GET | `/api/convert` · `/api/convert/probe?path=` | Remux: ffmpeg status, encoders, queue / a file's streams and codecs |
| POST · DELETE | `/api/convert` · `/api/convert/tasks[/{id}]` | Queue a conversion / cancel, remove or clear finished ones |
| POST | `/api/convert/ffmpeg` | Install ffmpeg (job `apt`) |
| GET · PUT | `/api/commands?tools=` · `/api/commands/book` | Commands: installed tools and apps, saved commands, shell history / save your own commands and favorites |
| GET · PUT | `/api/media/position` | Where a video was left off |
| GET · POST | `/api/devices` | Devices (without passwords) and the remote desktop engine / add a device |
| PUT · DELETE | `/api/devices/{id}` | Change / remove a device (an empty password keeps the saved one) |
| GET | `/api/devices/status` · `/discover` · `/mac?host=` | On/off and open screen ports / find computers on the network / find a MAC address |
| POST | `/api/devices/{id}/wake` · `/api/devices/engine` | Send Wake-on-LAN / install and start the remote desktop engine (`guacd`) |

### Ad blocking
| Method | Path | What it does |
|---|---|---|
| GET · DELETE | `/api/adblock` | Status, statistics, lists and allowed domains / remove it |
| POST | `/api/adblock/install` · `protection` · `test` | Install / turn protection on or off (or pause) / check that blocking works |
| POST | `/api/adblock/list` | Turn an extra block list on or off (strength levels, gambling, pop-ups, phones, …) |
| POST · DELETE | `/api/adblock/allow` | Allow a domain / block it again |

### Services, processes, logs
| Method | Path | What it does |
|---|---|---|
| GET | `/api/services` | systemd services |
| POST | `/api/services/{unit}/{action}` | Start / stop / restart / enable / disable |
| GET | `/api/services/{unit}/logs` | A service's log |
| GET | `/api/processes` · `/api/ports` | Processes and listening ports |
| POST | `/api/processes/{pid}/kill` | Stop a process |
| GET | `/api/logs` | The systemd journal (by category or unit) |
| GET | `/api/jobs/{kind}` | A background job's status and log |

### Server maintenance
| Method | Path | What it does |
|---|---|---|
| GET | `/api/updates` | Available apt updates and whether a restart is needed |
| POST | `/api/updates/check` · `/api/updates/install` | `apt update` / `apt upgrade` (job) |
| GET | `/api/disks` · `/api/disks/usage` | Drives, partitions, SMART, space use |
| POST | `/api/disks/mount` | Mount / unmount |
| GET | `/api/network/interfaces` · `/api/network/connections` | Interfaces and active connections |
| POST | `/api/network/tool` | Ping / traceroute |
| GET | `/api/network/dns` | DNS lookup |
| GET · POST | `/api/firewall` | ufw rules |
| GET | `/api/cron` · PUT `/api/cron/{user}` · POST `/api/cron/run` | Cron jobs and timers |
| GET · POST | `/api/users` · `/api/users/{name}` · DELETE `/api/users/{name}` | Linux users and groups |

### File sharing (SMB)
| Method | Path | What it does |
|---|---|---|
| GET | `/api/smb` · `/api/smb/status` | Shares, Samba users, active sessions |
| POST | `/api/smb/restart` | Restart Samba |
| POST · PUT · DELETE | `/api/smb/shares[/{name}]` | Create / change / remove a share |
| POST | `/api/smb/users` · `/api/smb/users/{name}/{action}` | Add a user, change a password, enable/disable, remove |

### Files
| Method | Path | What it does |
|---|---|---|
| GET · POST · DELETE | `/api/files` | List a folder / create a file / delete for good |
| POST | `/api/files/folders` · `rename` · `copy` | Create a folder, rename, copy/move |
| GET · PUT | `/api/files/content` | Read / save a text file |
| GET | `/api/files/raw` · `/api/files/thumb` | The raw file (streamed) / a thumbnail |
| GET | `/api/files/info` | Get Info: size (folders added up), dates, owner and permissions, disk, media details |
| GET | `/api/files/search` · `/api/files/tree` | Search file contents / list files (Go to File) |
| POST | `/api/files/upload` | Upload (multipart) |
| GET · POST | `/api/trash` | What's in the Trash / move paths there |
| POST | `/api/trash/restore` | Put items back where they were |
| DELETE | `/api/trash/{id}` · `/api/trash` | Delete one item for good / empty the Trash |
| GET · PUT | `/api/files/tags` | Every file's tags / set the tags of some paths |
| GET | `/api/files/tagged?tag=` | Everything with one tag |
| GET · POST | `/api/files/recents` | Recently opened files / note one |
| GET · POST · DELETE | `/api/wallpapers[/{name}]`, POST `/api/wallpapers/from-file` | Wallpapers |

### Share links
| Method | Path | What it does |
|---|---|---|
| GET · POST | `/api/links` | Every link and the public address / make a link `{path, upload, hours, password}` |
| DELETE | `/api/links/{id}` | Turn a link off |
| PUT | `/api/links/settings` | The public address links are given out with |
| GET · POST | `/s/{id}` | The visitor's page / its password form (no session) |
| GET | `/s/{id}/file?p=` · `/s/{id}/zip?p=` | Download a file / a folder as zip |
| POST | `/s/{id}/upload` | Send files into the folder of an upload link |

### Kubernetes
| Method | Path | What it does |
|---|---|---|
| GET | `/api/k8s` | Installed/running, nodes (with `top`), namespaces |
| POST | `/api/k8s/install` · `/api/k8s/uninstall` | Install / remove k3s (log: `/api/jobs/k8s`) |
| GET | `/api/k8s/resources?namespace=` | Workloads, pods, services, PVCs, events |
| POST | `/api/k8s/action` | `apply`, `delete`, `scale`, `restart`, `image`, `undo`, `namespace`, `deleteNamespace` |
| GET | `/api/k8s/text/{view}` | A resource's `logs`, `describe`, `yaml` |
| GET | `/api/k8s/rollout` | Rollout status |

### WebSockets
| Path | What it does |
|---|---|
| `/ws/terminal` | PTY. Binary frames = terminal input/output; text frames = JSON control (`{"type":"resize","cols":80,"rows":24}`). |
| `/ws/remote/{id}` | A device's screen (subprotocol `guacamole`). The server opens a VNC/RDP session in `guacd` with the saved password, then relays whole Guacamole instructions both ways; the tunnel's pings are answered by the server. |
