<div align="center">

<img src="docs/assets/logo.svg" alt="TemanLabsOS" width="128" />

# TemanLabsOS

**Web desktop untuk home server Ubuntu**

Kelola Docker, file, backup, storage, layanan, jaringan, dan komputer lain di rumahmu langsung dari browser, lewat tampilan desktop yang rapi, tanpa harus membuka terminal.

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

[**Instalasi**](docs/installation.id.md) &nbsp;•&nbsp; [**Dari TrueNAS**](docs/migrate-truenas.id.md) &nbsp;•&nbsp; [**Fitur**](#fitur) &nbsp;•&nbsp; [**Tampilan**](#tampilan) &nbsp;•&nbsp; [**Arsitektur**](docs/architecture.id.md) &nbsp;•&nbsp; [**API**](docs/architecture.id.md#daftar-endpoint-api)

<br />

<img src="docs/screenshots/desktop.png" alt="Desktop TemanLabsOS" width="100%" />

</div>

<br />

## Sorotan

<table>
  <tr>
    <td align="center" width="33%">
      <br />
      <img src="docs/assets/highlights/one-binary.svg" width="52" height="52" alt="" />
      <p><b>Satu file binary</b><br /><sub>Go dengan desktop React di dalamnya. Salin satu file, jalankan installer.</sub></p>
      <br />
    </td>
    <td align="center" width="33%">
      <br />
      <img src="docs/assets/highlights/apps.svg" width="52" height="52" alt="" />
      <p><b>Ratusan app</b><br /><sub>App Center dengan halaman untuk setiap app, dan update sekali klik.</sub></p>
      <br />
    </td>
    <td align="center" width="33%">
      <br />
      <img src="docs/assets/highlights/backup.svg" width="52" height="52" alt="" />
      <p><b>Backup bawaan</b><br /><sub>App dan folder ke disk atau cloud drive, terenkripsi, versi mana pun bisa dipulihkan.</sub></p>
      <br />
    </td>
  </tr>
  <tr>
    <td align="center" width="33%">
      <br />
      <img src="docs/assets/highlights/health.svg" width="52" height="52" alt="" />
      <p><b>Menjaga app-mu</b><br /><sub>Dicek tiap menit, di-restart kalau macet, dengan riwayat 30 hari.</sub></p>
      <br />
    </td>
    <td align="center" width="33%">
      <br />
      <img src="docs/assets/highlights/docker.svg" width="52" height="52" alt="" />
      <p><b>Docker tanpa terminal</b><br /><sub>Port, folder, variabel, update, shell, dan app saat mulai, semua lewat form.</sub></p>
      <br />
    </td>
    <td align="center" width="33%">
      <br />
      <img src="docs/assets/highlights/devices.svg" width="52" height="52" alt="" />
      <p><b>Komputer lainmu</b><br /><sub>Wake-on-LAN dari mana saja, dan layarnya di sebuah jendela.</sub></p>
      <br />
    </td>
  </tr>
  <tr>
    <td align="center" width="33%">
      <br />
      <img src="docs/assets/highlights/share.svg" width="52" height="52" alt="" />
      <p><b>Berbagi lewat link</b><br /><sub>Unduh atau kirim file untuk siapa saja, dengan batas waktu dan password.</sub></p>
      <br />
    </td>
    <td align="center" width="33%">
      <br />
      <img src="docs/assets/highlights/adblock.svg" width="52" height="52" alt="" />
      <p><b>Blokir iklan satu rumah</b><br /><sub>Iklan, pelacak, dan situs judi terblokir di semua perangkat di Wi-Fi.</sub></p>
      <br />
    </td>
    <td align="center" width="33%">
      <br />
      <img src="docs/assets/highlights/security.svg" width="52" height="52" alt="" />
      <p><b>Aman secara default</b><br /><sub>Password ter-hash, kunci layar, dan rahasia tersimpan hanya di server.</sub></p>
      <br />
    </td>
  </tr>
</table>

## Mulai cepat

Satu perintah di server Ubuntu/Debian (amd64 atau arm64):

```bash
curl -fsSL https://github.com/diopratama99/TemanLabs-OS/releases/latest/download/install.sh | sudo bash
```

Installer mengunduh rilis terbaru, mencocokkan checksum, memasang Docker kalau belum ada, lalu menjalankan TemanLabsOS sebagai service. Buka alamat yang dicetak installer, `http://<ip-server>`, dan login dengan `INITIAL_PASSWORD` yang juga dicetaknya. TemanLabsOS memakai port 80 supaya tidak perlu menulis port; kalau port 80 sudah dipakai program lain (CasaOS, nginx…), ia memakai `:7700`. Versi berikutnya bisa dipasang dari **Pengaturan → Umum → Pembaruan Software**.

Panduan lengkap (persyaratan, update, konfigurasi, development, troubleshooting) ada di **[docs/installation.id.md](docs/installation.id.md)**.

## Fitur

### Desktop
- **Dock** yang mulus saat menambah, menggeser, dan menghapus app (seret dari Launcher), badge untuk update yang menunggu, dan **Sampah** di ujungnya. **Launcher** berupa panel melayang dengan kategori, app yang baru dipakai, dan folder, **Quick Search** (`Ctrl/⌘ + K`), dan menu bar yang mengikuti app aktif.
- **Status bar** yang bisa diklik: prosesor (proses teratas), pemakaian daya dalam watt, jaringan (alamat IP, kecepatan), **Perangkat Saya** (nyalakan dari sana), serta tanggal dengan kalender. **Quick Settings** berisi tombol untuk mode gelap, blokir iklan, Tailscale, kunci layar, dan lainnya.
- **Tentang Server Ini**: model mesin (dibaca dari firmware-nya, atau "Server virtual" di VPS), prosesor, memori, dan nomor seri.
- **Widget desktop**: jam, CPU, memori, storage, jaringan, app, daya, server, kalender, **sticky note**, dan **daftar tugas**.
- Jendela bisa digeser, di-resize dari sisi mana pun, diperkecil, di-**snap** ke setengah, seperempat, atau sepertiga layar, dan dibuat **layar penuh**, dengan animasi halus. Ada tema terang/gelap, warna aksen, wallpaper dari foto sendiri, dan efek kaca yang bisa dimatikan.
- **Kunci layar** (manual atau otomatis setelah ditinggal), dan daftar browser yang sedang login, yang bisa dikeluarkan satu per satu.
- Tampilan menyesuaikan layar HP: jendela penuh, sidebar jadi tab, Dock bisa digeser.
- Antarmuka tersedia dalam **Bahasa Indonesia** dan English.

### App & container
| App | Fungsi |
|---|---|
| **App Center** | Ratusan app dari app store komunitas (store resmi dan BigBear, bisa tambah store lain). Tiap app punya **halaman sendiri** berisi screenshot, deskripsi, tips, dan apa yang dipasangnya (image, port, folder data), lalu pengaturannya bisa diubah sebelum di-install. **Custom Install** untuk image atau compose apa pun. Tab **Updates** mengecek image baru dan **Update All**. |
| **App Settings** | Untuk setiap app Docker, apa pun cara memasangnya (App Center, compose buatan sendiri, `docker run`): ubah port, volume, variabel, dan image lewat form atau YAML; log; shell di dalam container; update; uninstall (dengan opsi hapus data). |
| **Pengaturan → Aplikasi** | Semua app terpasang di satu halaman: start dan stop, alamatnya, **menyala bersama server atau tidak**, update, dan **kesehatannya**: merespons atau tidak, uptime 24 jam, 7 dan 30 hari, gangguan sebelumnya, dan **restart kalau tidak merespons**. App Node.js yang dijalankan pm2 bisa **dipindah ke Docker** (file, versi Node, dan user yang sama; otomatis dikembalikan kalau tidak merespons), dan dikembalikan lagi. |
| **Jendela app** | App terbuka di jendelanya sendiri. App yang menolak ditampilkan di dalam halaman lain dibuka lewat proxy bawaan, dan app dengan login HTTP Basic (misalnya Supabase Studio) **login dari jendelanya**, bukan dari dialog browser. |
| **System Monitor** | CPU, memori, network, dan disk per container, layanan systemd, proses, port yang listening, dan **Riwayat**: 1 jam sampai 30 hari CPU, memori, suhu, jaringan, disk, dan daya, lengkap dengan saat tersibuknya. |
| **Kubernetes** | Install k3s, lalu kelola Deployment, StatefulSet, DaemonSet, Pod, Service, PVC, dan Event: scale, rolling update dan rollback, logs, describe, dan YAML. |

### File & media
| App | Fungsi |
|---|---|
| **Files** | Tampilan ikon / list / galeri, thumbnail foto & video, drag & drop, upload file dan folder, copy/cut/paste, **Buka Dengan**, dan **Lihat Info** di jendela sendiri. **Terbaru**, **Tag** warna, dan **Sampah** yang isinya bisa dikembalikan (tiap disk punya Sampah sendiri, jadi folder besar pun pindah seketika; dikosongkan setelah 30 hari). |
| **Link berbagi** | Klik kanan file atau folder → **Bagikan Link…** supaya siapa saja bisa mengunduhnya (folder bisa ditelusuri atau diunduh sebagai zip), atau folder → **Minta File…** supaya siapa saja bisa mengirim file ke sana tanpa melihat isinya. Link bisa diberi batas waktu dan password. |
| **Code** | Editor berbasis Monaco (mesin editor VS Code) dengan explorer, search, tab, dan terminal. |
| **Image Viewer · Video Player · Music Player** | Buka media langsung dari Files, navigasi pakai tombol panah. Video Player punya kontrol sendiri (maju/mundur 10 detik, kecepatan, layar penuh) dan **melanjutkan dari menit terakhir** di perangkat mana pun. |
| **Remux** | Ubah format video dan suara di server dengan ffmpeg: remux ke MP4, MKV, atau TS dalam hitungan detik tanpa kehilangan kualitas, konversi ke H.264, H.265, VP9, atau AV1, ubah ukuran, atau ambil suaranya saja (MP3, M4A, FLAC), dengan antrean dan progres. |
| **Pengunduh** | Tempel tautan dari YouTube, Instagram, X, TikTok, Facebook, Reddit dan ratusan situs lainnya untuk menyimpan videonya (sampai kualitas pilihanmu), suaranya saja sebagai MP3, atau foto-foto sebuah postingan, langsung ke server, dengan antrean dan progres. Seluruh playlist dan profil juga bisa, atau **Pilih Item…** menampilkan isi profil, channel atau playlist sebagai thumbnail untuk dipilih. Simpan ke folder di server atau **langsung ke perangkat yang kamu pakai**, dan **cookies.txt** membuka postingan yang butuh akun. Dibuat di atas [yt-dlp](https://github.com/yt-dlp/yt-dlp) dan [gallery-dl](https://github.com/mikf/gallery-dl), dipasang sekali klik dan diperbarui dari aplikasinya. |
| **Perekam Live** | Tambahkan channel dari Twitch, YouTube, Kick, TikTok dan situs lain yang dikenal [streamlink](https://streamlink.github.io/). Dicek tiap beberapa menit dan **direkam sejak mulai live** sampai siarannya selesai, lalu disimpan sebagai MP4 di folder per channel. Pilih kualitas dan foldernya, rekam manual, dan simpan rekaman selama jumlah hari tertentu. Rekaman tetap berjalan walau TemanLabsOS di-restart atau diperbarui. |
| **File Sharing** | Share folder via SMB (Samba) dan kelola user-nya dari web. |

### Backup & jaringan
| Tempat | Fungsi |
|---|---|
| **Pengaturan → Backup** | Rencana backup dengan [restic](https://restic.net/): **pengaturan dan data semua app** (folder compose dan mount-nya, dibaca dari Docker) plus folder pilihan, ke disk lain atau cloud drive (Google Drive dan lainnya lewat rclone), harian, mingguan, atau manual. App bisa dijeda saat disalin supaya database tetap utuh. Telusuri versi mana pun, lalu pulihkan file ke lokasi asalnya (app terkait dihentikan sementara) atau ke folder baru. **Kunci pemulihan** membuka backup di server yang dipasang ulang. |
| **Pengaturan → Blokir Iklan** | AdGuard Home untuk satu rumah: tiga tingkat kekuatan, plus daftar untuk situs judi online, iklan pop-up, iklan bawaan HP, dan server iklan Indonesia, statistik per perangkat, daftar izin, dan langkah kalau iklan masih lolos. |
| **Pengaturan → Akses Jarak Jauh** | Akses server dari mana saja lewat Tailscale, langkah demi langkah. |

### Utilitas server
| App | Fungsi |
|---|---|
| **Devices** | Komputer lain di jaringanmu: status menyala/mati, **Wake-on-LAN** untuk menyalakannya dari mana saja, pemindaian jaringan yang menemukannya beserta namanya, dan **layarnya di sebuah jendela** lewat VNC atau RDP. Mesin remote desktop-nya berjalan di container kecil yang hanya bisa diakses server sendiri. |
| **Terminal** | Shell penuh di browser (xterm.js + PTY). |
| **Commands** | Ratusan perintah terminal untuk Ubuntu dan tool yang terpasang (Docker, Compose, Kubernetes, ffmpeg, rclone, git…), perintah untuk setiap app terpasang, riwayat shell, dan perintah simpananmu sendiri. Cari dengan kalimat biasa (“cara lihat port yang terbuka”), isi bagian yang kosong, lalu kirim ke Terminal. |
| **Disk Manager** | Drive, partisi, kesehatan SMART, mount dan **mount saat startup**, **format** (ext4, xfs, btrfs, exFAT, NTFS), analisis ruang, **merged storage** (mergerfs), auto-mount dan eject USB, **cloud drive** lewat rclone, serta **pool ZFS**: import dari TrueNAS (baca-saja dulu), kesehatannya, scrub, dan snapshot harian. Lihat [Pindah dari TrueNAS SCALE](docs/migrate-truenas.id.md). |
| **System Updates** | Update paket `apt` dengan log langsung dan pemberitahuan kalau perlu restart. |
| **Log Viewer** | Journal systemd per kategori atau per service. |
| **Network Tools** | Interface, ping, traceroute, DNS, koneksi aktif, dan firewall (ufw). |
| **Router** | Modem, router, dan access point dicek setiap 30 detik: mana yang mati, apakah internetnya putus, uptime, dan riwayat gangguan. Restart lewat SSH (MikroTik, OpenWrt) atau smart plug (Tasmota, Shelly), manual maupun otomatis, lengkap dengan apa yang perlu dicek sendiri kalau restart tidak membantu. |
| **Scheduled Tasks** | Cron job per user dan timer systemd. |
| **Pengaturan** | Tertata seperti pengaturan desktop: jaringan, blokir iklan, akses jarak jauh, backup, daya, aplikasi, umum (tentang, pembaruan software, storage, tanggal & waktu, bahasa, app saat mulai, berbagi), tampilan, Dock, bar menu, wallpaper, kunci layar, user & grup Linux, dan login-mu. |

## Tampilan

<table>
  <tr>
    <td width="50%"><img src="docs/screenshots/backup.png" alt="Backup" /><p align="center"><b>Backup</b>: app dan folder, semua versi bisa dipulihkan</p></td>
    <td width="50%"><img src="docs/screenshots/history.png" alt="Riwayat System Monitor" /><p align="center"><b>Riwayat</b>: 30 hari CPU, memori, suhu, jaringan, dan disk</p></td>
  </tr>
  <tr>
    <td width="50%"><img src="docs/screenshots/apps.png" alt="Aplikasi" /><p align="center"><b>Aplikasi</b>: kesehatan, uptime, dan restart otomatis tiap app</p></td>
    <td width="50%"><img src="docs/screenshots/share.png" alt="Link berbagi" /><p align="center"><b>Link berbagi</b>: link ke file atau folder, dengan batas waktu</p></td>
  </tr>
  <tr>
    <td width="50%"><img src="docs/screenshots/app-center.png" alt="App Center" /><p align="center"><b>App Center</b>: setiap app punya halaman sendiri</p></td>
    <td width="50%"><img src="docs/screenshots/devices.png" alt="Devices" /><p align="center"><b>Devices</b>: Wake-on-LAN dan remote layar</p></td>
  </tr>
  <tr>
    <td width="50%"><img src="docs/screenshots/files.png" alt="Files" /><p align="center"><b>Files</b>: Terbaru, Sampah, dan Tag di sidebar</p></td>
    <td width="50%"><img src="docs/screenshots/launcher.png" alt="Launcher" /><p align="center"><b>Launcher</b>: semua app dan folder</p></td>
  </tr>
  <tr>
    <td width="50%"><img src="docs/screenshots/about.png" alt="Tentang Server Ini" /><p align="center"><b>Tentang Server Ini</b>: mesinnya, dibaca dari firmware</p></td>
    <td width="50%"><img src="docs/screenshots/light.png" alt="Tema terang" /><p align="center"><b>Tema terang</b>: panel status bar dan widget</p></td>
  </tr>
  <tr>
    <td width="50%"><img src="docs/screenshots/commands.png" alt="Commands" /><p align="center"><b>Commands</b>: cari perintah dengan kalimat biasa</p></td>
    <td width="50%"><img src="docs/screenshots/snap.png" alt="Jendela di-snap" /><p align="center"><b>Snap</b>: dua jendela berdampingan</p></td>
  </tr>
  <tr>
    <td width="50%"><img src="docs/screenshots/monitor.png" alt="System Monitor" /><p align="center"><b>System Monitor</b>: statistik per container</p></td>
    <td width="50%"><img src="docs/screenshots/code.png" alt="Code" /><p align="center"><b>Code</b>: edit file di server</p></td>
  </tr>
</table>

## Arsitektur

```
Browser ──HTTP/WebSocket──▶ temanlabsos (Go, systemd)
                              ├─ frontend React (embedded)
                              ├─ REST API /api/*  ·  WebSocket /ws/terminal, /ws/remote
                              ├─ halaman link berbagi /s/* (tanpa login)
                              ├─ Docker Engine ──▶ container app
                              ├─ proxy per app ──▶ app yang tampil di jendela
                              ├─ latar belakang: riwayat, kesehatan app, jadwal backup
                              ├─ guacd (container) ──▶ VNC / RDP ke komputer lain
                              ├─ AdGuard Home (container) ──▶ DNS untuk satu rumah
                              ├─ k3s / kubectl ──▶ cluster Kubernetes (opsional)
                              └─ tool sistem: systemctl, journalctl, apt, ufw, smbd, lsblk, ffmpeg, rclone, restic, …
```

<details>
<summary><b>Struktur proyek</b></summary>

```
├─ src/                     Frontend (React + TypeScript)
│  ├─ App.tsx               Desktop: jendela, Dock, Launcher, menu bar
│  ├─ api/                  httpApi.ts (server), mockApi.ts + mockSystem.ts (data contoh), types.ts
│  ├─ components/           Window, Dock, Launcher, QuickSearch, MenuBar, Glass, widget, dialog
│  │  └─ settings/          Bagian Pengaturan: server, desktop, aplikasi, backup
│  ├─ windows/              Isi tiap app: Files, AppCenter, Devices, SystemMonitor, Terminal, …
│  ├─ hooks/  lib/          State, helper, pustaka perintah, pengaturan
│  └─ styles/               base.css (token tema), glass.css (efek kaca), app.css (layout)
├─ server/                  Backend Go: satu file per area (docker.go, backups.go, health.go, files.go, …)
├─ deploy/install.sh        Installer systemd
├─ scripts/build-server.mjs Build frontend → embed → cross-compile binary Linux
└─ docs/                    Dokumentasi dan screenshot
```

</details>

Detail cara kerja dan daftar endpoint API ada di **[docs/architecture.id.md](docs/architecture.id.md)**.

## Keamanan

> [!WARNING]
> TemanLabsOS memberi **akses penuh ke server** (service berjalan sebagai root). Jangan buka port-nya langsung ke internet. Akses lewat LAN, VPN (mis. Tailscale), atau reverse proxy dengan HTTPS.

- **Login**:
  - Password di-hash dengan PBKDF2-SHA256.
  - Session cookie `HttpOnly` + `SameSite=Lax`, berlaku 30 hari. Semua browser yang sedang login tampil di Pengaturan dan bisa dikeluarkan.
  - IP dikunci sementara setelah 8 kali gagal login dalam 10 menit.
  - Layar bisa terkunci sendiri setelah ditinggal; sesi yang terkunci tidak bisa melakukan apa-apa sampai dibuka lagi.
- Request lintas situs ditolak, dan input divalidasi sebelum dijalankan sebagai perintah sistem.
- Password untuk layar komputer lain dan login app disimpan di server (hanya bisa dibaca root); browser tidak pernah menerimanya kembali. Backup dienkripsi dengan kunci yang hanya dipegang server.
- **Link berbagi** hanya membuka yang dibagikan: path tidak bisa keluar dari folder yang dibagikan (termasuk lewat symlink), file tersembunyi tetap tersembunyi, dan percobaan password dibatasi. Link bisa dibuka di mana pun TemanLabsOS bisa dibuka; pakai alamat publik terpisah untuk link yang dikirim ke luar.
- Folder sistem, user penting, dan service penting dilindungi dari penghapusan atau penghentian lewat UI.

## Dokumentasi

| Dokumen | Isi |
|---|---|
| Instalasi · [English](docs/installation.md) · [Bahasa Indonesia](docs/installation.id.md) | Persyaratan, instalasi & update, konfigurasi, development, troubleshooting |
| Arsitektur · [English](docs/architecture.md) · [Bahasa Indonesia](docs/architecture.id.md) | Cara kerja frontend & backend, menambah app, daftar endpoint API |

## Kredit

Dibangun dengan [React](https://react.dev/), [Vite](https://vite.dev/), [Lucide](https://lucide.dev/), [Inter](https://rsms.me/inter/), [Monaco Editor](https://microsoft.github.io/monaco-editor/), [xterm.js](https://xtermjs.org/), [Apache Guacamole](https://guacamole.apache.org/), [restic](https://restic.net/), [rclone](https://rclone.org/), [AdGuard Home](https://adguard.com/adguard-home/overview.html), [coder/websocket](https://github.com/coder/websocket), [creack/pty](https://github.com/creack/pty), [k3s](https://k3s.io/), [yt-dlp](https://github.com/yt-dlp/yt-dlp), [gallery-dl](https://codeberg.org/mikf/gallery-dl), [streamlink](https://streamlink.github.io/), dan [Simple Icons](https://simpleicons.org/). Ikon app dari [selfh.st/icons](https://selfh.st/icons/). Daftar blokir dari [HaGeZi](https://github.com/hagezi/dns-blocklists) dan [ABPindo](https://github.com/ABPindo/indonesianadblockrules).

TemanLabsOS adalah proyek independen dan tidak berafiliasi dengan vendor sistem operasi mana pun. Nama dan logo app pihak ketiga di App Center adalah milik pemiliknya masing-masing.

## Lisensi

TemanLabsOS dirilis dengan [Lisensi MIT](LICENSE). Alat dan app yang dipasangnya tetap memakai lisensinya masing-masing. Pengaturan → Privasi & Ketentuan di server menjelaskan apa yang disimpan TemanLabsOS, ke mana ia terhubung, dan ketentuan penggunaannya.

<div align="center">
<br />
<sub>Dibuat oleh <a href="https://github.com/diopratama99">Dio Pratama</a></sub>
</div>
