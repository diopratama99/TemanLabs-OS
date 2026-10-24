<div align="center">

<img src="docs/assets/logo.svg" alt="TemanLabsOS" width="128" />

# TemanLabsOS

**A web desktop for your Ubuntu home server**

Manage Docker, files, storage, services, the network and the other computers in your home from the browser, through a polished desktop, without opening a terminal.

**English** &nbsp;|&nbsp; [Bahasa Indonesia](README.id.md)

<p>
  <img src="https://img.shields.io/badge/Go-1.27-00ADD8?style=for-the-badge&logo=go&logoColor=white" alt="Go" />
  <img src="https://img.shields.io/badge/React-19-61DAFB?style=for-the-badge&logo=react&logoColor=black" alt="React" />
  <img src="https://img.shields.io/badge/TypeScript-3178C6?style=for-the-badge&logo=typescript&logoColor=white" alt="TypeScript" />
  <img src="https://img.shields.io/badge/Vite-8-646CFF?style=for-the-badge&logo=vite&logoColor=white" alt="Vite" />
</p>
<p>
  <img src="https://img.shields.io/badge/Docker-2496ED?style=for-the-badge&logo=docker&logoColor=white" alt="Docker" />
  <img src="https://img.shields.io/badge/Kubernetes-k3s-326CE5?style=for-the-badge&logo=kubernetes&logoColor=white" alt="Kubernetes" />
  <img src="https://img.shields.io/badge/Ubuntu-22.04%20%7C%2024.04-E95420?style=for-the-badge&logo=ubuntu&logoColor=white" alt="Ubuntu" />
</p>
<p>
  <a href="https://github.com/diopratama99/TemanLabs-OS/commits"><img src="https://img.shields.io/github/last-commit/diopratama99/TemanLabs-OS?style=flat-square&color=0479ff" alt="Last commit" /></a>
  <img src="https://img.shields.io/badge/platform-linux-0479ff?style=flat-square&logo=linux&logoColor=white" alt="Platform" />
  <a href="https://github.com/diopratama99/TemanLabs-OS/stargazers"><img src="https://img.shields.io/github/stars/diopratama99/TemanLabs-OS?style=flat-square&color=0479ff" alt="Stars" /></a>
</p>

[**Install**](docs/installation.md) &nbsp;•&nbsp; [**Features**](#features) &nbsp;•&nbsp; [**Screenshots**](#screenshots) &nbsp;•&nbsp; [**Architecture**](docs/architecture.md) &nbsp;•&nbsp; [**API**](docs/architecture.md#daftar-endpoint-api)

<br />

<img src="docs/screenshots/desktop.png" alt="The TemanLabsOS desktop" width="100%" />

</div>

<br />

## Highlights

<table>
  <tr>
    <td width="33%" valign="top">
      <h3>One binary</h3>
      A Go backend with the React frontend embedded. Copy one file, run the installer, done.
    </td>
    <td width="33%" valign="top">
      <h3>Hundreds of apps</h3>
      An App Center with a page for every app (screenshots, ports, folders) and one-click updates for everything already running.
    </td>
    <td width="33%" valign="top">
      <h3>Your other computers</h3>
      Wake your PC from anywhere with Wake-on-LAN and use its screen (VNC or RDP) in a window.
    </td>
  </tr>
  <tr>
    <td width="33%" valign="top">
      <h3>Docker without a terminal</h3>
      Install, change ports, folders and variables, update, open a shell in a container, and uninstall, for every Docker app.
    </td>
    <td width="33%" valign="top">
      <h3>Complete storage</h3>
      Format disks, mount at startup, merge disks (mergerfs), auto-mount USB, and cloud drives (Google Drive, Dropbox, OneDrive, WebDAV…).
    </td>
    <td width="33%" valign="top">
      <h3>Secure by default</h3>
      PBKDF2 passwords, HttpOnly sessions, login rate limiting and CSRF protection. Saved passwords never reach the browser.
    </td>
  </tr>
</table>

## Quick start

One command on an Ubuntu or Debian server (amd64 or arm64):

```bash
curl -fsSL https://github.com/diopratama99/TemanLabs-OS/releases/latest/download/install.sh | sudo bash
```

The installer downloads the latest release, checks its checksum, installs Docker if it's missing and runs TemanLabsOS as a service. Open `http://<server-ip>:7700` and sign in with the `INITIAL_PASSWORD` the installer prints. To open it without a port (`http://<server-ip>/`), set `"addr": ":80"` in the config. Later versions install from **Settings → About → Update**.

The full guide (requirements, updating, configuration, development, troubleshooting) is in **[docs/installation.md](docs/installation.md)**.

## Features

### Desktop
- **Dock** with smooth adding, reordering and removing (drag apps in from the Launcher), a floating **Launcher** with categories, “Recently Used” and folders, **Quick Search** (`Ctrl/⌘ + K`), and a menu bar that follows the app in front.
- **Status bar** items you can click: processor (top processes), power draw in watts, network (IP addresses, speeds), and the date with a calendar.
- **Desktop widgets**: clock, CPU, memory, storage, network, apps, power, server, calendar, **sticky notes** and **to-do lists**.
- Windows can be moved, resized, minimised, **snapped** to halves, quarters or thirds, and made **full screen**, with smooth animations. Light and dark themes, your own photos as wallpaper, and a glass effect you can turn off.
- Works on a phone too: full-screen windows, sidebars become tabs, and the Dock scrolls.
- The interface is available in **English** and **Bahasa Indonesia**.

### Apps & containers
| App | What it does |
|---|---|
| **App Center** | Hundreds of apps from community app stores (the official store and BigBear, and you can add more). Every app has **its own page** with screenshots, a description, tips and what it sets up (image, ports, data folders), then lets you adjust the settings before it installs. **Custom Install** takes any image or compose file. **Updates** checks for newer images, with **Update All**. |
| **App Settings** | For every Docker app, however it was installed (App Center, your own compose file, `docker run`): change ports, volumes, variables and the image in a form or as YAML; logs; a shell inside the container; update; uninstall (optionally with its data). |
| **App windows** | Apps open in their own window. Apps that refuse to be embedded are shown through a built-in proxy, and apps behind an HTTP Basic login (such as Supabase Studio) are **signed in from the window** instead of the browser's dialog. |
| **System Monitor** | CPU, memory, network and disk per container, plus systemd services, processes and listening ports. |
| **Kubernetes** | Install k3s, then manage Deployments, StatefulSets, DaemonSets, Pods, Services, PVCs and Events: scale, rolling update and rollback, logs, describe and YAML. |

### Files & media
| App | What it does |
|---|---|
| **Files** | Icon, list and gallery views, photo and video thumbnails, drag and drop, file and folder uploads, copy/cut/paste, **Open With**, and **Get Info** in its own window (size, dates, permissions, disk, media details). |
| **Code** | A Monaco-based editor (the editor inside VS Code) with an explorer, search, tabs and a terminal. |
| **Image Viewer · Video Player · Music Player** | Open media straight from Files and step through it with the arrow keys. The Video Player has its own controls (10-second skips, speed, full screen) and **continues where you left off**, on any device. |
| **Remux** | Change video and sound formats on the server with ffmpeg: remux to MP4, MKV or TS in seconds without losing quality, convert to H.264, H.265, VP9 or AV1, resize, or keep just the sound (MP3, M4A, FLAC), with a queue and progress. |
| **File Sharing** | Share folders over SMB (Samba) and manage its users from the web. |

### Server tools
| App | What it does |
|---|---|
| **Devices** | The other computers on your network: on/off status, **Wake-on-LAN** to switch them on from anywhere, a network scan that finds them by name, and their **screens in a window** over VNC or RDP. The remote desktop engine runs in a small container that only the server itself can reach. |
| **Terminal** | A full shell in the browser (xterm.js + PTY). |
| **Commands** | Hundreds of terminal commands for Ubuntu and the tools you have (Docker, Compose, Kubernetes, ffmpeg, rclone, git…), commands for every installed app, your shell history and your own saved commands. Search in plain words (“see which ports are open”), fill in the blanks and send it to the Terminal. |
| **Disk Manager** | Drives, partitions, SMART health, mounting and **mount at startup**, **formatting** (ext4, xfs, btrfs, exFAT, NTFS), space analysis, **merged storage** (mergerfs), USB auto-mount and eject, and **cloud drives** through rclone. |
| **System Updates** | `apt` updates with a live log and a notice when a restart is needed. |
| **Log Viewer** | The systemd journal by category or by service. |
| **Network Tools** | Interfaces, ping, traceroute, DNS, active connections and the firewall (ufw). |
| **Scheduled Tasks** | Per-user cron jobs and systemd timers. |
| **Settings** | Appearance, **language**, account, Linux users and groups, date and time zone, and TemanLabsOS updates. |

## Screenshots

<table>
  <tr>
    <td width="50%"><img src="docs/screenshots/app-center.png" alt="App Center" /><p align="center"><b>App Center</b>: every app has its own page</p></td>
    <td width="50%"><img src="docs/screenshots/devices.png" alt="Devices" /><p align="center"><b>Devices</b>: Wake-on-LAN and remote screens</p></td>
  </tr>
  <tr>
    <td width="50%"><img src="docs/screenshots/commands.png" alt="Commands" /><p align="center"><b>Commands</b>: find a command by describing it</p></td>
    <td width="50%"><img src="docs/screenshots/snap.png" alt="Snapped windows" /><p align="center"><b>Snap</b>: windows side by side</p></td>
  </tr>
  <tr>
    <td width="50%"><img src="docs/screenshots/monitor.png" alt="System Monitor" /><p align="center"><b>System Monitor</b>: statistics per container</p></td>
    <td width="50%"><img src="docs/screenshots/code.png" alt="Code" /><p align="center"><b>Code</b>: edit files on the server</p></td>
  </tr>
  <tr>
    <td width="50%"><img src="docs/screenshots/kubernetes.png" alt="Kubernetes" /><p align="center"><b>Kubernetes</b>: workloads, replicas and the kubectl panel</p></td>
    <td width="50%"><img src="docs/screenshots/light.png" alt="Light theme" /><p align="center"><b>Light theme</b>: status bar panels and widgets</p></td>
  </tr>
  <tr>
    <td width="50%"><img src="docs/screenshots/files.png" alt="Files" /><p align="center"><b>Files</b>: a file manager with a sidebar</p></td>
    <td width="50%"><img src="docs/screenshots/launcher.png" alt="Launcher" /><p align="center"><b>Launcher</b>: every app and folder</p></td>
  </tr>
</table>

## Architecture

```
Browser ──HTTP/WebSocket──▶ temanlabsos (Go, systemd)
                              ├─ React frontend (embedded)
                              ├─ REST API /api/*  ·  WebSockets /ws/terminal, /ws/remote
                              ├─ Docker Engine ──▶ app containers
                              ├─ per-app proxies ──▶ apps shown in windows
                              ├─ guacd (container) ──▶ VNC / RDP to other computers
                              ├─ k3s / kubectl ──▶ Kubernetes cluster (optional)
                              └─ system tools: systemctl, journalctl, apt, ufw, smbd, lsblk, ffmpeg, rclone…
```

<details>
<summary><b>Project layout</b></summary>

```
├─ src/                     Frontend (React + TypeScript)
│  ├─ App.tsx               The desktop: windows, Dock, Launcher, menu bar
│  ├─ api/                  httpApi.ts (server), mockApi.ts + mockSystem.ts (sample data), types.ts
│  ├─ components/           Window, Dock, Launcher, QuickSearch, MenuBar, Glass, widgets, dialogs
│  ├─ windows/              Each app: Files, AppCenter, Devices, SystemMonitor, Terminal, …
│  ├─ hooks/  lib/          State, helpers, command library, settings
│  └─ styles/               base.css (theme tokens), glass.css (glass effect), app.css (layout)
├─ server/                  Go backend, one file per area (docker.go, devices.go, files.go, smb.go, …)
├─ deploy/install.sh        systemd installer
├─ scripts/build-server.mjs Builds the frontend, embeds it and cross-compiles the Linux binary
└─ docs/                    Documentation and screenshots
```

</details>

How it works, and every API endpoint, is in **[docs/architecture.md](docs/architecture.md)**.

## Security

> [!WARNING]
> TemanLabsOS gives **full access to the server** (the service runs as root). Don't expose its port directly to the internet. Use it on your LAN, over a VPN (for example Tailscale), or behind a reverse proxy with HTTPS.

- **Sign-in**:
  - Passwords are hashed with PBKDF2-SHA256.
  - Session cookies are `HttpOnly` and `SameSite=Lax`, valid for 30 days.
  - An IP is locked out for a while after 8 failed sign-ins in 10 minutes.
- Cross-site requests are refused, and input is validated before it's used in a system command.
- Passwords for other computers' screens and for apps' own logins stay on the server (readable by root only); the browser never gets them back.
- System folders, important users and important services are protected from being deleted through the UI.

## Documentation

| Document | Contents |
|---|---|
| [Installation](docs/installation.md) | Requirements, install and update, configuration, development, troubleshooting |
| [Architecture](docs/architecture.md) | How the frontend and backend work, adding an app, the API endpoints |

The documentation pages are in Indonesian.

## Credits

Built with [React](https://react.dev/), [Vite](https://vite.dev/), [Lucide](https://lucide.dev/), [Inter](https://rsms.me/inter/), [Monaco Editor](https://microsoft.github.io/monaco-editor/), [xterm.js](https://xtermjs.org/), [Apache Guacamole](https://guacamole.apache.org/), [coder/websocket](https://github.com/coder/websocket), [creack/pty](https://github.com/creack/pty) and [k3s](https://k3s.io/). App icons from [selfh.st/icons](https://selfh.st/icons/).

TemanLabsOS is an independent project and isn't affiliated with any operating system vendor. Third-party app names and logos in the App Center belong to their owners.

<div align="center">
<br />
<sub>Made by <a href="https://github.com/diopratama99">Dio Pratama</a></sub>
</div>
