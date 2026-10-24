<div align="center">

<img src="docs/assets/logo.svg" alt="TemanLabsOS" width="128" />

# TemanLabsOS

**Web desktop untuk home server Ubuntu**

Kelola Docker, file, storage, layanan, jaringan, dan komputer lain di rumahmu langsung dari browser, lewat tampilan desktop yang rapi, tanpa harus membuka terminal.

[English](README.md) &nbsp;|&nbsp; **Bahasa Indonesia**

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

[**Instalasi**](docs/installation.md) &nbsp;•&nbsp; [**Fitur**](#fitur) &nbsp;•&nbsp; [**Tampilan**](#tampilan) &nbsp;•&nbsp; [**Arsitektur**](docs/architecture.md) &nbsp;•&nbsp; [**API**](docs/architecture.md#daftar-endpoint-api)

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
      <h3>Ratusan app</h3>
      App Center dengan halaman untuk setiap app (screenshot, port, folder) dan update sekali klik untuk semua app yang sudah berjalan.
    </td>
    <td width="33%" valign="top">
      <h3>Komputer lainmu</h3>
      Nyalakan PC dari mana saja dengan Wake-on-LAN, dan pakai layarnya (VNC atau RDP) di sebuah jendela.
    </td>
  </tr>
  <tr>
    <td width="33%" valign="top">
      <h3>Docker tanpa terminal</h3>
      Install, ubah port/folder/variabel, update, buka shell di container, dan uninstall untuk semua app Docker.
    </td>
    <td width="33%" valign="top">
      <h3>Storage lengkap</h3>
      Format disk, mount saat startup, gabung disk (mergerfs), auto-mount USB, dan cloud drive (Google Drive, Dropbox, OneDrive, WebDAV…).
    </td>
    <td width="33%" valign="top">
      <h3>Aman secara default</h3>
      Password PBKDF2, session HttpOnly, pembatasan percobaan login, dan perlindungan CSRF. Password yang disimpan tidak pernah dikirim ke browser.
    </td>
  </tr>
</table>

## Mulai cepat

Satu perintah di server Ubuntu/Debian (amd64 atau arm64):

```bash
curl -fsSL https://github.com/diopratama99/TemanLabs-OS/releases/latest/download/install.sh | sudo bash
```

Installer mengunduh rilis terbaru, mencocokkan checksum, memasang Docker kalau belum ada, lalu menjalankan TemanLabsOS sebagai service. Buka `http://<ip-server>:7700` dan login dengan `INITIAL_PASSWORD` yang dicetak installer. Supaya bisa dibuka tanpa port (`http://<ip-server>/`), isi `"addr": ":80"` di konfigurasi. Versi berikutnya bisa dipasang dari **Settings → About → Update**.

Panduan lengkap (persyaratan, update, konfigurasi, development, troubleshooting) ada di **[docs/installation.md](docs/installation.md)**.

## Fitur

### Desktop
- **Dock** yang mulus saat menambah, menggeser, dan menghapus app (seret dari Launcher), **Launcher** berupa panel melayang dengan kategori, “Baru Dipakai”, dan folder, **Quick Search** (`Ctrl/⌘ + K`), dan menu bar yang mengikuti app aktif.
- **Status bar** yang bisa diklik: prosesor (proses teratas), pemakaian daya dalam watt, jaringan (alamat IP, kecepatan), serta tanggal dengan kalender.
- **Widget desktop**: jam, CPU, memori, storage, jaringan, app, daya, server, kalender, **sticky note**, dan **daftar tugas**.
- Jendela bisa digeser, di-resize, diperkecil, di-**snap** ke setengah, seperempat, atau sepertiga layar, dan dibuat **layar penuh**, dengan animasi halus. Ada tema terang/gelap, wallpaper dari foto sendiri, dan efek kaca yang bisa dimatikan.
- Tampilan menyesuaikan layar HP: jendela penuh, sidebar jadi tab, Dock bisa digeser.
- Antarmuka tersedia dalam **Bahasa Indonesia** dan English.

### App & container
| App | Fungsi |
|---|---|
| **App Center** | Ratusan app dari app store komunitas (store resmi dan BigBear, bisa tambah store lain). Tiap app punya **halaman sendiri** berisi screenshot, deskripsi, tips, dan apa yang dipasangnya (image, port, folder data), lalu pengaturannya bisa diubah sebelum di-install. **Custom Install** untuk image atau compose apa pun. Tab **Updates** mengecek image baru dan **Update All**. |
| **App Settings** | Untuk setiap app Docker, apa pun cara memasangnya (App Center, compose buatan sendiri, `docker run`): ubah port, volume, variabel, dan image lewat form atau YAML; log; shell di dalam container; update; uninstall (dengan opsi hapus data). |
| **Jendela app** | App terbuka di jendelanya sendiri. App yang menolak ditampilkan di dalam halaman lain dibuka lewat proxy bawaan, dan app dengan login HTTP Basic (misalnya Supabase Studio) **login dari jendelanya**, bukan dari dialog browser. |
| **System Monitor** | CPU, memori, network, dan disk per container, plus layanan systemd, proses, dan port yang listening. |
| **Kubernetes** | Install k3s, lalu kelola Deployment, StatefulSet, DaemonSet, Pod, Service, PVC, dan Event: scale, rolling update dan rollback, logs, describe, dan YAML. |

### File & media
| App | Fungsi |
|---|---|
| **Files** | Tampilan ikon / list / galeri, thumbnail foto & video, drag & drop, upload file dan folder, copy/cut/paste, **Buka Dengan**, dan **Lihat Info** di jendela sendiri (ukuran, tanggal, izin, disk, detail media). |
| **Code** | Editor berbasis Monaco (mesin editor VS Code) dengan explorer, search, tab, dan terminal. |
| **Image Viewer · Video Player · Music Player** | Buka media langsung dari Files, navigasi pakai tombol panah. Video Player punya kontrol sendiri (maju/mundur 10 detik, kecepatan, layar penuh) dan **melanjutkan dari menit terakhir** di perangkat mana pun. |
| **Remux** | Ubah format video dan suara di server dengan ffmpeg: remux ke MP4, MKV, atau TS dalam hitungan detik tanpa kehilangan kualitas, konversi ke H.264, H.265, VP9, atau AV1, ubah ukuran, atau ambil suaranya saja (MP3, M4A, FLAC), dengan antrean dan progres. |
| **File Sharing** | Share folder via SMB (Samba) dan kelola user-nya dari web. |

### Utilitas server
| App | Fungsi |
|---|---|
| **Devices** | Komputer lain di jaringanmu: status menyala/mati, **Wake-on-LAN** untuk menyalakannya dari mana saja, pemindaian jaringan yang menemukannya beserta namanya, dan **layarnya di sebuah jendela** lewat VNC atau RDP. Mesin remote desktop-nya berjalan di container kecil yang hanya bisa diakses server sendiri. |
| **Terminal** | Shell penuh di browser (xterm.js + PTY). |
| **Commands** | Ratusan perintah terminal untuk Ubuntu dan tool yang terpasang (Docker, Compose, Kubernetes, ffmpeg, rclone, git…), perintah untuk setiap app terpasang, riwayat shell, dan perintah simpananmu sendiri. Cari dengan kalimat biasa (“cara lihat port yang terbuka”), isi bagian yang kosong, lalu kirim ke Terminal. |
| **Disk Manager** | Drive, partisi, kesehatan SMART, mount dan **mount saat startup**, **format** (ext4, xfs, btrfs, exFAT, NTFS), analisis ruang, **merged storage** (mergerfs), auto-mount dan eject USB, serta **cloud drive** lewat rclone. |
| **System Updates** | Update paket `apt` dengan log langsung dan pemberitahuan kalau perlu restart. |
| **Log Viewer** | Journal systemd per kategori atau per service. |
| **Network Tools** | Interface, ping, traceroute, DNS, koneksi aktif, dan firewall (ufw). |
| **Scheduled Tasks** | Cron job per user dan timer systemd. |
| **Settings** | Tampilan, **bahasa**, akun, user & grup Linux, tanggal & zona waktu, dan update TemanLabsOS. |

## Tampilan

<table>
  <tr>
    <td width="50%"><img src="docs/screenshots/app-center.png" alt="App Center" /><p align="center"><b>App Center</b>: setiap app punya halaman sendiri</p></td>
    <td width="50%"><img src="docs/screenshots/devices.png" alt="Devices" /><p align="center"><b>Devices</b>: Wake-on-LAN dan remote layar</p></td>
  </tr>
  <tr>
    <td width="50%"><img src="docs/screenshots/commands.png" alt="Commands" /><p align="center"><b>Commands</b>: cari perintah dengan kalimat biasa</p></td>
    <td width="50%"><img src="docs/screenshots/snap.png" alt="Jendela di-snap" /><p align="center"><b>Snap</b>: dua jendela berdampingan</p></td>
  </tr>
  <tr>
    <td width="50%"><img src="docs/screenshots/monitor.png" alt="System Monitor" /><p align="center"><b>System Monitor</b>: statistik per container</p></td>
    <td width="50%"><img src="docs/screenshots/code.png" alt="Code" /><p align="center"><b>Code</b>: edit file di server</p></td>
  </tr>
  <tr>
    <td width="50%"><img src="docs/screenshots/kubernetes.png" alt="Kubernetes" /><p align="center"><b>Kubernetes</b>: workload, replika, dan panel kubectl</p></td>
    <td width="50%"><img src="docs/screenshots/light.png" alt="Tema terang" /><p align="center"><b>Tema terang</b>: panel status bar dan widget</p></td>
  </tr>
  <tr>
    <td width="50%"><img src="docs/screenshots/files.png" alt="Files" /><p align="center"><b>Files</b>: file manager dengan sidebar</p></td>
    <td width="50%"><img src="docs/screenshots/launcher.png" alt="Launcher" /><p align="center"><b>Launcher</b>: semua app dan folder</p></td>
  </tr>
</table>

## Arsitektur

```
Browser ──HTTP/WebSocket──▶ temanlabsos (Go, systemd)
                              ├─ frontend React (embedded)
                              ├─ REST API /api/*  ·  WebSocket /ws/terminal, /ws/remote
                              ├─ Docker Engine ──▶ container app
                              ├─ proxy per app ──▶ app yang tampil di jendela
                              ├─ guacd (container) ──▶ VNC / RDP ke komputer lain
                              ├─ k3s / kubectl ──▶ cluster Kubernetes (opsional)
                              └─ tool sistem: systemctl, journalctl, apt, ufw, smbd, lsblk, ffmpeg, rclone, …
```

<details>
<summary><b>Struktur proyek</b></summary>

```
├─ src/                     Frontend (React + TypeScript)
│  ├─ App.tsx               Desktop: jendela, Dock, Launcher, menu bar
│  ├─ api/                  httpApi.ts (server), mockApi.ts + mockSystem.ts (data contoh), types.ts
│  ├─ components/           Window, Dock, Launcher, QuickSearch, MenuBar, Glass, widget, dialog
│  ├─ windows/              Isi tiap app: Files, AppCenter, Devices, SystemMonitor, Terminal, …
│  ├─ hooks/  lib/          State, helper, pustaka perintah, pengaturan
│  └─ styles/               base.css (token tema), glass.css (efek kaca), app.css (layout)
├─ server/                  Backend Go: satu file per area (docker.go, devices.go, files.go, smb.go, …)
├─ deploy/install.sh        Installer systemd
├─ scripts/build-server.mjs Build frontend → embed → cross-compile binary Linux
└─ docs/                    Dokumentasi dan screenshot
```

</details>

Detail cara kerja dan daftar endpoint API ada di **[docs/architecture.md](docs/architecture.md)**.

## Keamanan

> [!WARNING]
> TemanLabsOS memberi **akses penuh ke server** (service berjalan sebagai root). Jangan buka port-nya langsung ke internet. Akses lewat LAN, VPN (mis. Tailscale), atau reverse proxy dengan HTTPS.

- **Login**:
  - Password di-hash dengan PBKDF2-SHA256.
  - Session cookie `HttpOnly` + `SameSite=Lax`, berlaku 30 hari.
  - IP dikunci sementara setelah 8 kali gagal login dalam 10 menit.
- Request lintas situs ditolak, dan input divalidasi sebelum dijalankan sebagai perintah sistem.
- Password untuk layar komputer lain dan login app disimpan di server (hanya bisa dibaca root); browser tidak pernah menerimanya kembali.
- Folder sistem, user penting, dan service penting dilindungi dari penghapusan lewat UI.

## Dokumentasi

| Dokumen | Isi |
|---|---|
| [Instalasi](docs/installation.md) | Persyaratan, instalasi & update, konfigurasi, development, troubleshooting |
| [Arsitektur](docs/architecture.md) | Cara kerja frontend & backend, menambah app, daftar endpoint API |

## Kredit

Dibangun dengan [React](https://react.dev/), [Vite](https://vite.dev/), [Lucide](https://lucide.dev/), [Inter](https://rsms.me/inter/), [Monaco Editor](https://microsoft.github.io/monaco-editor/), [xterm.js](https://xtermjs.org/), [Apache Guacamole](https://guacamole.apache.org/), [coder/websocket](https://github.com/coder/websocket), [creack/pty](https://github.com/creack/pty), dan [k3s](https://k3s.io/). Ikon app dari [selfh.st/icons](https://selfh.st/icons/).

TemanLabsOS adalah proyek independen dan tidak berafiliasi dengan vendor sistem operasi mana pun. Nama dan logo app pihak ketiga di App Center adalah milik pemiliknya masing-masing.

<div align="center">
<br />
<sub>Dibuat oleh <a href="https://github.com/diopratama99">Dio Pratama</a></sub>
</div>
