# Instalasi TemanLabsOS

Panduan memasang TemanLabsOS di server, mengubah konfigurasi, menjalankan versi development, dan mengatasi masalah umum.

[English](installation.md) &nbsp;|&nbsp; **Bahasa Indonesia**

---

## Daftar isi

- [Persyaratan](#persyaratan)
- [Instalasi di server](#instalasi-di-server)
- [Update](#update)
- [Konfigurasi](#konfigurasi)
- [Perintah berguna](#perintah-berguna)
- [Development](#development)
- [Troubleshooting](#troubleshooting)

---

## Persyaratan

**Server**
- Ubuntu 22.04 / 24.04 (sudah diuji di 24.04) dengan systemd.
- Docker Engine (untuk App Center, System Monitor, dan sebagian besar fitur).
- Opsional, untuk fitur tertentu:
  - `ffmpeg`: thumbnail video dan Remux (dipasang otomatis oleh installer).
  - `restic`: backup. Dipasang dari **Pengaturan → Backup** saat menyiapkan backup.
  - `rclone`: cloud drive, termasuk backup ke cloud drive.
  - `smartmontools`, `samba`, `ufw`, `udisks2`: kesehatan disk, file sharing, firewall, drive USB.
  - CasaOS: app-nya ikut terbaca, kalau terpasang.
- Kubernetes **tidak perlu disiapkan**: k3s bisa dipasang langsung dari app Kubernetes.

**Komputer untuk build**
- Node.js 20.19+ atau 22.12+.
- Go 1.27+.

**Browser**: Chrome, Edge, atau Brave untuk efek kaca penuh. Firefox dan Safari tetap bisa dipakai dengan efek blur yang lebih sederhana.

---

## Instalasi di server

### Cara cepat (satu perintah)

```bash
curl -fsSL https://github.com/diopratama99/TemanLabs-OS/releases/latest/download/install.sh | sudo bash
```

Script ini:
- mendeteksi arsitektur server (amd64 / arm64),
- memasang Docker lewat get.docker.com kalau belum ada (lewati dengan `TEMANLABS_SKIP_DOCKER=1`),
- mengunduh binary dari GitHub Releases dan mencocokkannya dengan `SHA256SUMS`,
- menjalankan installer service (sama dengan cara manual di bawah).

Opsi lewat variabel lingkungan, misalnya `curl … | sudo TEMANLABS_VERSION=v1.0.0 bash`:

| Variabel | Arti |
|---|---|
| `TEMANLABS_VERSION` | Pasang rilis tertentu, bukan yang terbaru |
| `TEMANLABS_USER` | User Linux untuk Terminal dan pemilik file baru (bawaan: user yang memakai sudo) |
| `TEMANLABS_PORT` | Port web desktop, hanya saat instalasi pertama (bawaan 7700) |
| `TEMANLABS_SKIP_DOCKER` | `1` = jangan pasang Docker |

### Cara manual: build sendiri

#### 1. Build

```bash
npm install
npm run build:server          # → server/bin/temanlabsos-linux-amd64
# untuk server ARM (mis. Raspberry Pi):  node scripts/build-server.mjs arm64
```

Perintah ini mem-build frontend, meng-embed-nya ke backend, lalu meng-compile binary Linux.

#### 2. Salin ke server dan install

```bash
scp server/bin/temanlabsos-linux-amd64 deploy/install.sh user@server:temanlabsos-deploy/
ssh user@server
cd temanlabsos-deploy
sudo ./install.sh ./temanlabsos-linux-amd64 <linux-user>
```

`<linux-user>` adalah user Linux yang dipakai oleh Terminal dan menjadi pemilik file baru.

Installer akan:
- memasang binary ke `/opt/temanlabsos/temanlabsos`,
- membuat konfigurasi `/var/lib/temanlabsos/config.json` (mode `0600`),
- membuat dan menyalakan systemd service `temanlabsos`,
- pada instalasi pertama, membuat **password acak** dan mencetaknya sekali sebagai `INITIAL_PASSWORD=…`. Simpan baik-baik.

Variabel opsional:
- `TEMANLABS_PORT=7700`
- `TEMANLABS_ROOT=/DATA`, untuk membatasi Files ke folder data saja (bawaannya `/`, seluruh filesystem).

Contoh: `sudo TEMANLABS_ROOT=/DATA ./install.sh ./temanlabsos-linux-amd64 <linux-user>`. Variabel ini hanya dipakai saat instalasi pertama, ketika `config.json` dibuat. Setelah itu, ubah lewat [Konfigurasi](#konfigurasi).

#### 3. Buka

Buka `http://<ip-server>:7700`, lalu login dengan password tadi. Password bisa diganti di **Pengaturan → Login & Kata Sandi**.

---

## Update

- **Dari desktop**: Pengaturan → Umum → Pembaruan Software → *Cek Pembaruan*. TemanLabsOS mengunduh rilis terbaru dari GitHub, mencocokkan checksum, mengganti binary-nya, lalu restart sendiri. Kalau checksum tidak cocok, tidak ada yang diubah. Ikon Pengaturan di Dock menampilkan badge kalau ada versi baru.
- **Dari terminal**: jalankan lagi perintah satu baris di atas.
- **Build sendiri**: ulangi langkah manual 1–2.

Konfigurasi, password, dan semua isi folder state tidak berubah saat update.

### Membuat rilis (untuk pengelola repo)

Push tag versi; GitHub Actions (`.github/workflows/release.yml`) mem-build amd64 dan arm64 lalu membuat Release berisi binary, `install.sh`, `install-service.sh`, dan `SHA256SUMS`:

```bash
git tag v1.0.0
git push origin v1.0.0
```

> Kalau binary lama sedang berjalan, `scp` langsung ke nama yang sama bisa gagal dengan error *text file busy*. Upload dengan nama lain (mis. `.new`), lalu `mv`.

---

## Konfigurasi

File: `/var/lib/temanlabsos/config.json`

| Kunci | Bawaan | Arti |
|---|---|---|
| `addr` | `:7700` | Alamat dan port yang didengarkan. Isi `:80` supaya bisa dibuka tanpa port (`http://<ip-server>/`), asal port 80 tidak dipakai program lain. |
| `redirectFrom` | (kosong) | Alamat lama yang diarahkan ke `addr`, misalnya `[":7700"]` setelah pindah ke `:80`, supaya bookmark lama tetap jalan. |
| `root` | `/` | Folder teratas untuk Files dan Code. Isi `/DATA` untuk membatasi. |
| `user` | (dari installer) | User Linux untuk Terminal dan pemilik file baru. |
| `stateDir` | `/var/lib/temanlabsos` | Tempat file milik TemanLabsOS sendiri: file compose app, wallpaper, thumbnail, rencana backup dan kunci pemulihan, link berbagi, tag, riwayat 30 hari, dan kesehatan app. |
| `passwordHash` | (dibuat otomatis) | Hash PBKDF2 dari password. Jangan diedit manual; pakai `set-password`. |

Restart service setelah mengubah konfigurasi.

### Pindah dari CasaOS

TemanLabsOS bisa berjalan bersama CasaOS. Kalau CasaOS mau dilepas dan TemanLabsOS memakai port 80:

1. Pastikan disk data dipasang lewat `/etc/fstab` (**Disk Manager → Mount saat startup**), bukan oleh CasaOS.
2. Backup lalu hentikan service CasaOS (`casaos`, `casaos-gateway`, `casaos-app-management`, `casaos-local-storage`, `casaos-message-bus`, `casaos-user-service`, serta `rclone` dan `devmon@devmon` yang dipasangnya), dan hapus file unit serta `/usr/bin/casaos*`.
3. **Jangan** pakai `casaos-uninstall` kalau app-nya mau tetap jalan: script itu bisa menghapus semua container, image, dan `/DATA/AppData`. Jangan hapus juga `/var/lib/casaos/apps` (file compose app-nya, dipakai TemanLabsOS untuk mengelola app itu), `/etc/samba/smb.casa.conf` (share Samba), dan `/usr/bin/rclone` (dipakai cloud drive).
4. Set `"addr": ":80"` dan `"redirectFrom": [":7700"]`, lalu restart TemanLabsOS. Kalau nginx terpasang dengan situs default di port 80, nonaktifkan supaya tidak berebut port saat boot.

App Docker tidak terpengaruh: container dijalankan ulang oleh Docker sendiri sesuai restart policy-nya.

---

## Perintah berguna

```bash
journalctl -u temanlabsos -f                       # log
sudo systemctl restart temanlabsos                 # restart
sudo systemctl status temanlabsos                  # status
sudo /opt/temanlabsos/temanlabsos -config /var/lib/temanlabsos/config.json set-password   # reset password
```

---

## Development

```bash
npm install
npm run dev:mock     # UI saja, dengan data contoh di memori, tanpa server → http://localhost:5173
npm run dev          # UI dengan hot reload, terhubung ke server TemanLabsOS sungguhan
npm run build        # type-check + build frontend ke dist/
```

`npm run dev` mem-proxy `/api` dan `/ws` ke `http://localhost:7700`. Untuk memakai server lain, buat file `.env.local` (tidak ikut ter-commit):

```bash
TEMANLABS_SERVER=http://my-server:7700
```

Atau lewat tunnel SSH: `ssh -L 7700:localhost:7700 user@server`.

Kalau login di mode dev menampilkan **Bad Gateway**, artinya server tujuan tidak bisa dihubungi. Periksa `.env.local` atau tunnel-nya.

Cara kerja kode dan daftar endpoint API ada di [architecture.id.md](architecture.id.md).

---

## Troubleshooting

| Masalah | Solusi |
|---|---|
| Lupa password | `sudo /opt/temanlabsos/temanlabsos -config /var/lib/temanlabsos/config.json set-password` |
| Halaman tidak terbuka | `systemctl status temanlabsos`, lalu `journalctl -u temanlabsos -n 50`. Pastikan port TemanLabsOS (bawaan 7700, atau 80) diizinkan di firewall dan tidak dipakai program lain. |
| `scp` gagal: *text file busy* | Upload dengan nama lain lalu `mv` (lihat [Update](#update)). |
| App tidak bisa dibuka di jendela | Pakai tombol **Buka di Tab Baru**. Beberapa app menolak ditampilkan di dalam frame. |
| Jendela menampilkan *Ada yang error di jendela ini* | Klik **Muat Ulang Jendela**. Bagian desktop lain tetap jalan; pesan di bawahnya menjelaskan apa yang gagal. |
| Thumbnail video tidak muncul | Install `ffmpeg`: `sudo apt install ffmpeg`. |
| Backup ke cloud drive gagal | Pastikan drive-nya terhubung di **Disk Manager → Cloud Drive**. Error dari backup terakhir tampil di halaman backup-nya. |
| Backup tidak bisa dibaca setelah pasang ulang | Masukkan kunci pemulihan lama di **Pengaturan → Backup → Kunci Pemulihan → Backup dari sebelumnya**, lalu tambahkan rencana backup dengan tujuan yang sama. |
| Link berbagi tidak bisa dibuka orang lain | Link memakai alamat yang kamu pakai membuka TemanLabsOS, yang hanya bisa dibuka di jaringanmu atau lewat Tailscale. Arahkan alamat publik (Cloudflare Tunnel atau Tailscale Funnel) ke server, lalu isi di **Pengaturan → Umum → Berbagi → Alamat untuk link**. |
| Pod Kubernetes lama di *ContainerCreating* | Image masih diunduh. Cek **Kubernetes → Events**. Lihat juga [kubernetes-lab.id.md](kubernetes-lab.id.md#10-troubleshooting). |
| Efek kaca tidak muncul | Pakai browser berbasis Chromium, atau matikan *Kurangi Transparansi* di Pengaturan. |
