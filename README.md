<div align="center">

<img src="docs/assets/logo.svg" alt="TemanLabsOS" width="128" />

# TemanLabsOS

**Web desktop untuk home server Ubuntu**

Kelola Docker, Kubernetes, file, layanan, dan jaringan server langsung dari browser, lewat tampilan desktop yang rapi, tanpa harus membuka terminal.

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

[**Instalasi**](docs/installation.md) &nbsp;•&nbsp; [**Fitur**](#fitur) &nbsp;•&nbsp; [**Lab Kubernetes**](docs/kubernetes-lab.md) &nbsp;•&nbsp; [**Arsitektur**](docs/architecture.md) &nbsp;•&nbsp; [**API**](docs/architecture.md#daftar-endpoint-api)

<br />

<img src="docs/screenshots/desktop.png" alt="Desktop TemanLabsOS" width="100%" />

</div>

<br />

## Sorotan

<table>
  <tr>
    <td width="33%" valign="top">
      <h3>Satu file binary</h3>
      Backend Go dengan frontend React yang sudah di-embed. Cukup salin satu file, lalu jalankan installer.
    </td>
    <td width="33%" valign="top">
      <h3>Akur dengan CasaOS</h3>
      Jalan di port <code>7700</code> di samping CasaOS (port 80), dan membaca app-nya tanpa mengubah apa pun.
    </td>
    <td width="33%" valign="top">
      <h3>Belajar Kubernetes</h3>
      Install k3s sekali klik, lalu deploy web, database, dan monitoring. Setiap klik menampilkan perintah <code>kubectl</code>-nya.
    </td>
  </tr>
  <tr>
    <td width="33%" valign="top">
      <h3>Docker tanpa terminal</h3>
      App Center untuk app self-hosted, Custom Install untuk image apa pun, dan statistik per container.
    </td>
    <td width="33%" valign="top">
      <h3>Semua utilitas server</h3>
      Update apt, log systemd, disk & SMART, jaringan & firewall, cron, user Linux, dan share SMB.
    </td>
    <td width="33%" valign="top">
      <h3>Aman secara default</h3>
      Password PBKDF2, session HttpOnly, pembatasan percobaan login, dan perlindungan CSRF.
    </td>
  </tr>
</table>

## Mulai cepat

```bash
# 1. Build (butuh Node.js 20.19+ dan Go 1.27+)
npm install
npm run build:server

# 2. Salin ke server lalu install
scp server/bin/temanlabsos-linux-amd64 deploy/install.sh user@server:temanlabsos-deploy/
ssh user@server 'cd temanlabsos-deploy && sudo ./install.sh ./temanlabsos-linux-amd64 <linux-user>'

# 3. Buka http://<ip-server>:7700 dan login dengan INITIAL_PASSWORD yang dicetak installer
```

Panduan lengkap (persyaratan, update, konfigurasi, development, troubleshooting) ada di **[docs/installation.md](docs/installation.md)**.

## Fitur

### Desktop
- **Dock**, **Launcher** dengan folder, **Quick Search** (`Ctrl/⌘ + K`), dan menu bar yang mengikuti app aktif.
- **Widget desktop**: jam, CPU, memori, storage, jaringan, dan app yang berjalan.
- Jendela bisa digeser, di-resize, diperkecil, dan di-zoom dengan animasi halus. Ada tema terang/gelap, wallpaper dari foto sendiri, dan efek kaca yang bisa dimatikan.

### Container & orkestrasi
| App | Fungsi |
|---|---|
| **App Center** | Katalog app self-hosted (Jellyfin, Nextcloud, Vaultwarden, Home Assistant, …) lewat `docker compose`, plus **Custom Install** untuk image Docker apa pun. |
| **System Monitor** | CPU, memori, network, dan disk per container, plus layanan systemd, proses, dan port yang listening. |
| **Kubernetes** | Install k3s, lalu kelola Deployment, StatefulSet, DaemonSet, Pod, Service, PVC, dan Event. Mendukung scale, rolling update/rollback, logs, describe, YAML, dan template **Lab Stack**. |

### File & media
| App | Fungsi |
|---|---|
| **Files** | Tampilan ikon / list / galeri, thumbnail foto & video, drag & drop, upload file dan folder, copy/cut/paste. |
| **Code** | Editor berbasis Monaco (mesin editor VS Code) dengan explorer, search, tab, dan terminal. |
| **Image Viewer · Video Player · Music Player** | Buka media langsung dari Files, navigasi pakai tombol panah. |
| **File Sharing** | Share folder via SMB (Samba) dan kelola user-nya dari web. |

### Utilitas server
| App | Fungsi |
|---|---|
| **Terminal** | Shell penuh di browser (xterm.js + PTY). |
| **System Updates** | Update paket `apt` dengan log langsung dan pemberitahuan kalau perlu restart. |
| **Log Viewer** | Journal systemd per kategori atau per service. |
| **Disk Manager** | Drive, partisi, kesehatan SMART, mount, dan analisis ruang. |
| **Network Tools** | Interface, ping, traceroute, DNS, koneksi aktif, dan firewall (ufw). |
| **Scheduled Tasks** | Cron job per user dan timer systemd. |
| **Settings** | Tampilan, akun, user & grup Linux, tanggal & zona waktu. |

## Tampilan

<table>
  <tr>
    <td width="50%"><img src="docs/screenshots/kubernetes.png" alt="Kubernetes" /><p align="center"><b>Kubernetes</b>: workload, replika, dan panel kubectl</p></td>
    <td width="50%"><img src="docs/screenshots/monitor.png" alt="System Monitor" /><p align="center"><b>System Monitor</b>: statistik per container</p></td>
  </tr>
  <tr>
    <td width="50%"><img src="docs/screenshots/files.png" alt="Files" /><p align="center"><b>Files</b>: file manager dengan sidebar</p></td>
    <td width="50%"><img src="docs/screenshots/launcher.png" alt="Launcher" /><p align="center"><b>Launcher</b>: semua app dan folder</p></td>
  </tr>
</table>

## Lab Kubernetes

TemanLabsOS bisa dipakai untuk belajar **container orchestration**:

1. Install k3s dari app **Kubernetes**.
2. Deploy **Lab Stack**: web nginx 3 replika, PostgreSQL dengan persistent volume, Prometheus + Grafana.
3. Coba load balancing, scaling, self-healing, rolling update, persistensi data, dan monitoring.

| Layanan | Port | Isi |
|---|---|---|
| Web | `30080` | Deployment nginx ×3 + Service NodePort |
| Adminer | `30081` | UI untuk PostgreSQL (StatefulSet + PVC) |
| Prometheus | `30090` | Metrik dari node-exporter (DaemonSet) |
| Grafana | `30300` | Dashboard CPU, memori, jaringan, disk |

Panduan dan latihannya ada di **[docs/kubernetes-lab.md](docs/kubernetes-lab.md)**, dan manifest-nya di [docs/k8s/lab.yaml](docs/k8s/lab.yaml).

## Arsitektur

```
Browser ──HTTP/WebSocket──▶ temanlabsos (Go, :7700, systemd)
                              ├─ frontend React (embedded)
                              ├─ REST API /api/*  ·  terminal /ws/terminal
                              ├─ Docker Engine ──▶ container (CasaOS & App Center)
                              ├─ k3s / kubectl ──▶ cluster Kubernetes (opsional)
                              └─ tool sistem: systemctl, journalctl, apt, ufw, smbd, lsblk, …
```

<details>
<summary><b>Struktur proyek</b></summary>

```
├─ src/                     Frontend (React + TypeScript)
│  ├─ App.tsx               Desktop: jendela, Dock, Launcher, menu bar
│  ├─ api/                  httpApi.ts (server), mockApi.ts + mockSystem.ts (data contoh), types.ts
│  ├─ components/           Window, Dock, Launcher, QuickSearch, MenuBar, Glass, widget, dialog
│  ├─ windows/              Isi tiap app: Files, Kubernetes, SystemMonitor, AppCenter, Terminal, …
│  ├─ hooks/  lib/          State, helper, template Kubernetes, pengaturan
│  └─ styles/               base.css (token tema), glass.css (efek kaca), app.css (layout)
├─ server/                  Backend Go: satu file per area (docker.go, k8s.go, files.go, smb.go, …)
├─ deploy/install.sh        Installer systemd
├─ scripts/build-server.mjs Build frontend → embed → cross-compile binary Linux
└─ docs/                    Dokumentasi, manifest Kubernetes, screenshot
```

</details>

Detail cara kerja dan daftar endpoint API ada di **[docs/architecture.md](docs/architecture.md)**.

## Keamanan

> [!WARNING]
> TemanLabsOS memberi **akses penuh ke server** (service berjalan sebagai root, seperti CasaOS). Jangan buka port `7700` langsung ke internet. Akses lewat LAN, VPN (mis. Tailscale), atau reverse proxy dengan HTTPS.

- **Login**:
  - Password di-hash dengan PBKDF2-SHA256.
  - Session cookie `HttpOnly` + `SameSite=Lax`, berlaku 30 hari.
  - IP dikunci sementara setelah 8 kali gagal login dalam 10 menit.
- Request lintas situs ditolak, dan input divalidasi sebelum dijalankan sebagai perintah sistem.
- Folder sistem, user penting, dan service penting dilindungi dari penghapusan lewat UI.
- Password contoh di Lab Kubernetes (`admin/admin`, `lab-password`) hanya untuk belajar.

## Dokumentasi

| Dokumen | Isi |
|---|---|
| [Instalasi](docs/installation.md) | Persyaratan, instalasi & update, konfigurasi, development, troubleshooting |
| [Lab Kubernetes](docs/kubernetes-lab.md) | Web, database, dan monitoring di Kubernetes, lengkap dengan latihan |
| [Arsitektur](docs/architecture.md) | Cara kerja frontend & backend, menambah app, daftar endpoint API |

## Kredit

Dibangun dengan [React](https://react.dev/), [Vite](https://vite.dev/), [Lucide](https://lucide.dev/), [Inter](https://rsms.me/inter/), [Monaco Editor](https://microsoft.github.io/monaco-editor/), [xterm.js](https://xtermjs.org/), [coder/websocket](https://github.com/coder/websocket), [creack/pty](https://github.com/creack/pty), dan [k3s](https://k3s.io/). Ikon app dari [selfh.st/icons](https://selfh.st/icons/).

TemanLabsOS adalah proyek independen dan tidak berafiliasi dengan vendor sistem operasi mana pun. Nama dan logo app pihak ketiga di App Center adalah milik pemiliknya masing-masing.

<div align="center">
<br />
<sub>Dibuat oleh <a href="https://github.com/diopratama99">Dio Pratama</a></sub>
</div>
