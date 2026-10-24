# Instalasi TemanLabsOS

Panduan memasang TemanLabsOS di server, mengubah konfigurasi, menjalankan versi development, dan mengatasi masalah umum.

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
- Docker Engine (untuk App Center dan System Monitor).
- Opsional, untuk fitur tertentu: CasaOS (membaca app-nya), `ffmpeg` (thumbnail video, dipasang otomatis oleh installer), `smartmontools`, `samba`, `ufw`, `udisks2`.
- Kubernetes **tidak perlu disiapkan**: k3s bisa dipasang langsung dari app Kubernetes.

**Komputer untuk build**
- Node.js 20.19+ atau 22.12+.
- Go 1.27+.

**Browser**: Chrome, Edge, atau Brave untuk efek kaca penuh. Firefox dan Safari tetap bisa dipakai dengan efek blur yang lebih sederhana.

---

## Instalasi di server

### 1. Build

```bash
npm install
npm run build:server          # → server/bin/temanlabsos-linux-amd64
# untuk server ARM (mis. Raspberry Pi):  node scripts/build-server.mjs arm64
```

Perintah ini mem-build frontend, meng-embed-nya ke backend, lalu meng-compile binary Linux.

### 2. Salin ke server dan install

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

### 3. Buka

Buka `http://<ip-server>:7700`, lalu login dengan password tadi. Password bisa diganti di **Settings → Account**.

---

## Update

Ulangi langkah 1–2. Konfigurasi dan password tidak akan berubah.

> Kalau binary lama sedang berjalan, `scp` langsung ke nama yang sama bisa gagal dengan error *text file busy*. Upload dengan nama lain (mis. `.new`), lalu `mv`.

---

## Konfigurasi

File: `/var/lib/temanlabsos/config.json`

| Kunci | Bawaan | Arti |
|---|---|---|
| `addr` | `:7700` | Alamat dan port yang didengarkan. |
| `root` | `/` | Folder teratas untuk Files dan Code. Isi `/DATA` untuk membatasi. |
| `user` | (dari installer) | User Linux untuk Terminal dan pemilik file baru. |
| `stateDir` | `/var/lib/temanlabsos` | Tempat file compose app, wallpaper, dan cache thumbnail. |
| `passwordHash` | (dibuat otomatis) | Hash PBKDF2 dari password. Jangan diedit manual; pakai `set-password`. |

Restart service setelah mengubah konfigurasi.

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

Cara kerja kode dan daftar endpoint API ada di [architecture.md](architecture.md).

---

## Troubleshooting

| Masalah | Solusi |
|---|---|
| Lupa password | `sudo /opt/temanlabsos/temanlabsos -config /var/lib/temanlabsos/config.json set-password` |
| Halaman tidak terbuka | `systemctl status temanlabsos`, lalu `journalctl -u temanlabsos -n 50`. Pastikan port 7700 diizinkan di firewall. |
| `scp` gagal: *text file busy* | Upload dengan nama lain lalu `mv` (lihat [Update](#update)). |
| App tidak bisa dibuka di jendela | Pakai tombol **Open in New Tab**. Beberapa app menolak ditampilkan di dalam frame. |
| Thumbnail video tidak muncul | Install `ffmpeg`: `sudo apt install ffmpeg`. |
| Pod Kubernetes lama di *ContainerCreating* | Image masih diunduh. Cek **Kubernetes → Events**. Lihat juga [kubernetes-lab.md](kubernetes-lab.md#10-troubleshooting). |
| Efek kaca tidak muncul | Pakai browser berbasis Chromium, atau matikan *Reduce transparency* di Settings. |
