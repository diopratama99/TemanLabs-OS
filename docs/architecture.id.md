# Arsitektur TemanLabsOS

Dokumen untuk developer: cara kerja frontend dan backend, alur build, dan daftar endpoint API.

[English](architecture.md) &nbsp;|&nbsp; **Bahasa Indonesia**

---

## Gambaran umum

```
┌──────────────── Browser ────────────────┐         ┌──────────── Server Ubuntu ─────────────┐
│ React app (src/)                        │  HTTP   │ temanlabsos  (Go, systemd, :7700/:80)  │
│  ├─ Desktop: Window, Dock, Launcher,    │ ──────▶ │  ├─ static: frontend (embedded)        │
│  │   MenuBar, QuickSearch, widget       │  /api/* │  ├─ auth + sameOrigin middleware       │
│  ├─ windows/*: satu komponen per app    │         │  ├─ satu file handler per area (*.go)  │
│  ├─ components/settings/*: Pengaturan   │   WS    │  ├─ background: stats sampler, riwayat,│
│  └─ api/: httpApi ⇄ mockApi             │ ──────▶ │  │   kesehatan app, jadwal backup, job │
└─────────────────────────────────────────┘ /ws/... │  ├─ frame proxy per app (:7710–7799)   │
                                    link berbagi /s/│  └─ halaman publik link berbagi (/s/…) │
                                                    │        │                               │
                                                    │        ├─ Docker Engine (unix socket)  │
                                                    │        ├─ restic, rclone, k3s kubectl  │
                                                    │        └─ systemctl, journalctl, apt,  │
                                                    │           ufw, smbd, lsblk, crontab, … │
                                                    └────────────────────────────────────────┘
```

- **Satu binary.** `scripts/build-server.mjs` mem-build frontend ke `dist/`, menyalinnya ke `server/web/`, lalu `go build` meng-embed folder itu (`//go:embed`) dan meng-compile untuk Linux (`CGO_ENABLED=0`).
- **Tanpa database.** State disimpan sebagai file di `stateDir` (`/var/lib/temanlabsos`), ditulis secara atomik (file sementara lalu rename), kebanyakan dengan mode `0600`:

  | File | Isi |
  |---|---|
  | `config.json` | Alamat, root, user, hash password |
  | `apps/<id>/docker-compose.yml` | App yang dipasang dari App Center |
  | `wallpapers/`, `thumbs/` | Wallpaper dan cache thumbnail |
  | `backups.json`, `backup.key` | Rencana backup dan kunci pemulihan yang mengenkripsi semua backup |
  | `links.json` | Link berbagi (hanya hash password-nya) dan alamat publik |
  | `files.json` | Tag warna dan file yang baru dibuka |
  | `history.bin` | Satu titik per menit selama 30 hari (CPU, memori, suhu, jaringan, disk, daya) |
  | `health.json` | Gangguan tiap app dan pengaturan restart otomatisnya |
  | `containerized.json` | App yang dipindah dari pm2 ke Docker, untuk mengembalikannya |
  | `devices.json`, `app-logins.json`, `sessions.json` | Komputer lain, login app yang disimpan, browser yang sedang login |
  | `trash/` | Sampah untuk filesystem tempat folder state berada (disk lain menyimpannya di `.Trash-temanlabs` di root disk itu) |

  Pengaturan tampilan (tema, widget, folder Launcher) disimpan di `localStorage` browser.

---

## Frontend (`src/`)

| Bagian | Isi |
|---|---|
| `App.tsx` | Pengelola desktop: daftar jendela terbuka, z-order, menu bar per app, Dock, Launcher, Quick Search, dan notifikasi. `SYSTEM_WINDOWS` berisi judul dan ukuran awal tiap app; `renderWindow` memilih komponennya, dibungkus `WindowErrorBoundary` supaya satu jendela yang crash tidak membuat seluruh halaman blank. |
| `components/Window.tsx` | Frame jendela: drag, resize dari semua sisi, minimize/zoom/close dengan animasi (Web Animations API). `SystemWindowId` adalah daftar id app bawaan. |
| `components/settings/*` | Bagian-bagian Pengaturan: `ServerSections` (jaringan, blokir iklan, akses jarak jauh, daya, berbagi, app saat mulai, tentang), `DesktopSections`, `AppsSection` (app terpasang, kesehatan, pindah ke Docker), `BackupSection`. Halaman di dalam satu bagian ikut tercatat di riwayat back/forward Pengaturan. |
| `components/Glass.tsx` + `lib/displacement.ts` | Efek kaca: peta displacement untuk `backdrop-filter` (Chromium), dengan fallback blur di browser lain. |
| `components/HistoryChart.tsx` | Grafik garis SVG untuk System Monitor → Riwayat: satu sumbu, celah saat server mati, crosshair dan tooltip. |
| `lib/systemApps.ts` | Nama, ikon, warna, dan posisi (Dock / folder Utilities) app bawaan. |
| `lib/appMenus.tsx` | `useAppMenus()`: app mendaftarkan menunya sendiri ke menu bar. Shortcut keyboard di item menu otomatis aktif. |
| `lib/windowChrome.tsx` | `WindowToolbar` dan `ToolbarTitle`: toolbar yang menyatu dengan title bar. |
| `lib/contextMenu.tsx` | `useContextMenu().show(event, items)`: menu klik kanan, juga dipakai `PopUpButton`. |
| `lib/i18n.ts` + `lib/i18n-id.ts` | Terjemahan. Teks Inggris jadi kunci: `tr('Open')`, nilai lewat `tr('{0} apps', n)`. Kamus Indonesia ada di `i18n-id.ts`; teks tanpa terjemahan tampil dalam bahasa Inggris. |
| `hooks/useJob.ts` | Mengikuti job di server (backup, restore, update, install) sampai selesai, dan mencoba lagi kalau satu permintaan gagal. |
| `api/httpApi.ts` | Semua panggilan ke backend. |
| `api/mockApi.ts`, `api/mockSystem.ts` | Implementasi `Api` yang sama dengan data di memori, untuk `npm run dev:mock`. |
| `api/types.ts` | Tipe data yang sama dengan JSON dari backend. |

### Menambah app bawaan baru

1. Buat komponen di `src/windows/NamaApp.tsx`.
2. Tambahkan id-nya ke `SystemWindowId` di `components/Window.tsx`.
3. Tambahkan entri di `SYSTEM_APPS` (`lib/systemApps.ts`). Pakai `utility: true, dock: false` kalau app-nya masuk folder Utilities. Kalau butuh ikon baru, daftarkan di `lib/icons.ts`.
4. Di `App.tsx`, tambahkan judul dan ukuran di `SYSTEM_WINDOWS`, `case` di `renderWindow`, dan `WINDOW_VARIANT` kalau app-nya punya sidebar.
5. Tambahkan fungsi API di `api/types.ts`, `httpApi.ts`, dan `mockApi.ts` / `mockSystem.ts`.

---

## Backend (`server/`)

Satu file per area. Semua handler didaftarkan di `server.go` (`routes()`).

| File | Tanggung jawab |
|---|---|
| `main.go`, `config.go`, `auth.go` | Start server, konfigurasi, login (PBKDF2, session cookie, pembatasan percobaan login), mengunci sesi (423 sampai dibuka lagi), dan daftar browser yang sedang login. |
| `server.go` | Routing, middleware `requireAuth` dan `sameOrigin` (tolak request lintas situs), log request. |
| `system.go`, `hardware.go`, `power.go` | Sampler `/proc` (CPU, memori, disk, jaringan, uptime, IP LAN/Tailscale), model mesin dari DMI (mini PC, desktop, laptop, VPS…), pemakaian daya. |
| `history.go` | Satu titik per menit dari sampler (plus kecepatan disk dari `/proc/diskstats`), disimpan 30 hari di memori dan di `history.bin`, dikirim dalam maksimal 360 bucket. |
| `docker.go`, `monitor.go`, `apps.go` | Docker Engine API lewat Unix socket, statistik per container, daftar app (compose project dan metadata CasaOS). |
| `health.go` | Mengecek setiap app tiap menit: health check milik Docker kalau ada, kalau tidak, apakah halaman web-nya menjawab. Crash langsung dihitung, tidak menjawab baru dihitung setelah 3 menit; app yang tidak merespons di-restart (maksimal 3 kali per jam). App yang sengaja dihentikan tidak pernah dianggap crash. |
| `startup.go` | App mana yang menyala bersama server: restart policy container (ikut ditulis ke file compose) atau unit systemd app native. |
| `containerize.go` | Memindah app Node.js yang dijalankan pm2 ke Docker: folder, versi Node, user, dan jaringan yang sama; baru dipakai setelah container-nya menjawab, kalau tidak dikembalikan ke pm2. |
| `store.go`, `appstore.go`, `custom.go`, `manage.go` | Katalog App Center (template compose dan store komunitas), Custom Install, pengaturan app, update, dan uninstall. |
| `native.go`, `services.go`, `processes.go`, `ports.go` | App non-Docker (dideteksi dari socket yang listening), service systemd, proses, dan port. |
| `frameproxy.go`, `appauth.go` | Reverse proxy per app yang membuang `X-Frame-Options` / CSP `frame-ancestors`, supaya app bisa tampil di jendela. Untuk app dengan login HTTP Basic (mis. Supabase Studio di balik Kong), jendela meminta login sekali; server memeriksanya ke app, menyimpannya (`app-logins.json`, 0600), lalu proxy mengirimnya di setiap request dan membuang tantangan `WWW-Authenticate` supaya dialog login browser tidak muncul. |
| `files.go`, `copy.go`, `thumbs.go`, `media.go`, `fileinfo.go` | File manager, copy/move, thumbnail (Go untuk foto, `ffmpeg` untuk video), streaming media, Lihat Info. |
| `trash.go`, `filemeta.go` | Sampah (per filesystem, jadi memindah ke sana cukup rename; bisa dikembalikan ke lokasi asal; dikosongkan setelah 30 hari), tag warna, dan Terbaru. |
| `sharelinks.go`, `sharepage.go` | Link berbagi: file atau folder untuk diunduh (satu file, atau folder sebagai zip), atau folder untuk menerima kiriman file, dengan batas waktu dan password opsional. Pengunjung mendapat halaman kecil di `/s/<id>` tanpa session; path tidak bisa keluar dari folder yang dibagikan, termasuk lewat symlink. |
| `backups.go` | Rencana backup dengan restic: folder compose dan mount tiap app (dibaca dari Docker) serta folder pilihan, ke disk atau cloud drive rclone, sesuai jadwal, terenkripsi dengan kunci pemulihan, dan dirampingkan ke jumlah versi yang disimpan. Telusuri dan pulihkan satu versi, ke lokasi asal (app terkait dihentikan dulu) atau ke folder lain. |
| `adblock.go` | Blokir iklan untuk satu rumah: AdGuard Home di container pada port 53, daftar blokir, statistik, dan daftar izin. |
| `terminal.go` | Shell login di PTY, dijembatani ke WebSocket. |
| `jobs.go` | Tugas panjang di latar belakang (apt, k3s, backup, restore, update), dengan log yang dipantau UI. Satu job per jenis; job Go bisa dihentikan. |
| `updates.go`, `logs.go`, `disks.go`, `storage.go`, `cloud.go`, `network.go`, `cron.go`, `users.go`, `smb.go`, `wallpaper.go`, `convert.go`, `commands.go` | Utilitas server. |
| `devices.go`, `remote.go` | Perangkat lain di jaringan: status (ping + ketuk port), Wake-on-LAN (magic packet ke semua broadcast LAN), pencarian (sapu /24 lalu baca tabel ARP; nama dari DNS, mDNS, NetBIOS). Remote layar: container `guacd` (`127.0.0.1:4822`) dijalankan lewat Docker API; server melakukan handshake Guacamole dengan password tersimpan, lalu meneruskan instruksi ke WebSocket. |
| `k8s.go` | Install/uninstall k3s, membaca resource cluster, dan aksi (`apply`, `scale`, `rollout`, `delete`, …) lewat `k3s kubectl`. |

### Prinsip keamanan di backend

- Input dari user divalidasi dengan regex sebelum dipakai sebagai argumen perintah (nama container, unit systemd, user, nama resource Kubernetes, versi backup, dll.). Perintah dijalankan dengan `exec.Command` dan argumen terpisah, tanpa shell, supaya input tidak bisa menyisipkan perintah lain.
- Hanya ada dua pengecualian yang disengaja:
  - **Run Now** di Scheduled Tasks menjalankan perintah cron milik user, sebagai user itu sendiri (`runuser … sh -c`).
  - Installer k3s menjalankan script tetap yang ada di dalam kode, tanpa input dari user.
- Daftar putih (whitelist) untuk aksi yang diizinkan, misalnya jenis resource Kubernetes dan aksi service.
- User, service, dan namespace sistem yang penting dilindungi dari penghapusan; SSH, Docker, TemanLabsOS, dan Tailscale selalu menyala bersama server.
- File mentah (`/api/files/raw`) dikirim dengan CSP `sandbox`, supaya file HTML/SVG yang diunggah tidak bisa menjalankan script di origin TemanLabsOS. Halaman link berbagi mengirim CSP ketat sendiri dan tanpa referrer.
- Konfigurasi Samba divalidasi dengan `testparm` sebelum reload. Port penting tidak bisa ditutup dari halaman firewall, supaya akses tidak terkunci.

---

## Daftar endpoint API

Semua endpoint (kecuali login, unlock, dan halaman link berbagi) butuh session cookie. Respons berupa JSON, dan error berbentuk `{"error": "pesan"}`. Tugas panjang menjawab `202` dengan `{"job": "<jenis>"}`; pantau di `/api/jobs/{jenis}`.

### Akun & sistem
| Method | Path | Fungsi |
|---|---|---|
| POST | `/api/login` · `/api/logout` | Masuk / keluar |
| GET | `/api/me` | Status login, terkunci atau tidak, hostname |
| POST | `/api/password` | Ganti password |
| POST | `/api/lock` · `/api/unlock` | Kunci sesi ini / buka dengan password |
| GET · DELETE | `/api/sessions` · `/api/sessions/{id}` | Browser yang sedang login / keluarkan satu |
| POST | `/api/sessions/end-others` | Keluarkan semua browser lain |
| GET | `/api/system` | CPU, memori, disk, jaringan, uptime, alamat IP |
| GET | `/api/system/hardware` | Mesin: pembuat, model, jenis, nomor seri, VPS atau bukan |
| GET | `/api/system/history?range=1h\|24h\|7d\|30d` | Riwayat, maksimal 360 bucket (`null` saat server mati) |
| POST | `/api/power/{action}` | Restart / shutdown server |
| GET · POST | `/api/time` | Tanggal, zona waktu, NTP |
| GET · POST | `/api/system/release` · `/install` | Cek rilis GitHub / update diri sendiri (job `self-update`) |

### App & container
| Method | Path | Fungsi |
|---|---|---|
| GET | `/api/store` | Katalog App Center |
| GET | `/api/apps` | App terpasang (Docker + native) |
| POST | `/api/apps/custom` | Custom Install (image atau compose) |
| POST | `/api/apps/{id}/install` · `start` · `stop` | Install / start / stop app |
| DELETE | `/api/apps/{id}?data=1` | Uninstall, opsional hapus volume dan folder `/DATA/AppData/…` |
| GET | `/api/apps/{id}/frame` · `icon` | Alamat frame proxy (plus `auth: "basic"`, `signedIn` untuk app yang minta login) / ikon app |
| PUT · DELETE | `/api/apps/{id}/signin` | Simpan login HTTP Basic app (dicek dulu ke app; salah = 422) / lupakan |
| GET · PUT | `/api/apps/{id}/config` | Pengaturan app (form layanan utama + compose YAML) / simpan dan buat ulang container (job `app-{id}`) |
| POST | `/api/apps/{id}/update` | Pull image baru lalu recreate (compose atau docker run) |
| GET | `/api/apps/updates?refresh=1` | Hasil cek digest image ke registry, per app |
| GET · PUT | `/api/startup` · `/api/startup/{id}` | App yang menyala bersama server / ubah satu |
| GET · PUT | `/api/health` · `/api/health/{id}` | Status, uptime, dan gangguan tiap app / nyalakan atau matikan restart otomatis |
| GET · POST | `/api/apps/{id}/move` | Apakah app native ini bisa pindah ke Docker (dan file compose-nya nanti) / pindahkan (job `move-{id}`) |
| GET · POST | `/api/moved` · `/api/moved/{project}/back` | App yang dipindah dari pm2 / kembalikan satu |
| WS | `/ws/apps/{id}/terminal?container=` | Shell di dalam container (`docker exec`) |
| GET | `/api/containers` · `/api/networks` | Container (dengan statistik) dan network Docker |
| POST | `/api/containers/{id}/{action}` | Start / stop / restart container |
| GET | `/api/containers/{id}/logs` | Log container |
| GET | `/api/appstore` | Semua app dari app store (format CasaOS) dan daftar store |
| GET · POST | `/api/appstore/apps/{id}` · `/install` | Detail + compose yang sudah diisi variabelnya / install |
| POST · PUT | `/api/appstore/refresh` · `/api/appstore/sources` | Unduh ulang store / ganti daftar store |

### Backup
| Method | Path | Fungsi |
|---|---|---|
| GET · POST | `/api/backups` | Rencana (dengan hasil terakhir dan jadwal berikutnya) dan status restic / tambah rencana |
| POST | `/api/backups/install` | Pasang restic (job `apt`) |
| GET · PUT | `/api/backups/key` | Kunci pemulihan / pakai kunci dari backup lama |
| GET | `/api/backups/destinations` · `/api/backups/apps` | Saran tujuan (disk lain, remote rclone) / folder yang dicakup backup tiap app |
| PUT · DELETE | `/api/backups/{id}` | Ubah / hapus rencana (isinya tetap tersimpan) |
| POST | `/api/backups/{id}/run` · `stop` | Backup sekarang (job `backup-{id}`) / hentikan backup atau restore yang berjalan |
| GET | `/api/backups/{id}/versions` | Versi di tujuan rencana, yang terbaru dulu |
| GET | `/api/backups/{id}/versions/{version}/files?path=` | Satu folder dari sebuah versi |
| POST | `/api/backups/{id}/restore` | `{version, paths, to}`: pulihkan ke lokasi asal (`to: ""`) atau ke sebuah folder (job `restore-{id}`) |

### Storage & cloud
| Method | Path | Fungsi |
|---|---|---|
| POST | `/api/disks/automount` · `format` · `eject` | Mount saat startup (fstab) / format (job `disk-format`) / eject USB |
| GET | `/api/storage` | Entri fstab, merged storage, status mergerfs, auto-mount USB |
| POST · DELETE | `/api/storage/merge[/{name}]` | Buat / hapus merged storage (mergerfs) |
| PUT | `/api/storage/usb` | Nyalakan / matikan auto-mount USB |
| GET · POST · DELETE | `/api/cloud[/{name}]` | Cloud drive (rclone) |
| POST | `/api/cloud/auth` · `/api/cloud/{name}/{action}` | Login browser (OAuth) / mount, unmount, restart |

### Media, perintah & perangkat
| Method | Path | Fungsi |
|---|---|---|
| GET | `/api/convert` · `/api/convert/probe?path=` | Remux: status ffmpeg, encoder, antrean / isi file (stream, codec) |
| POST · DELETE | `/api/convert` · `/api/convert/tasks[/{id}]` | Tambah konversi ke antrean / batalkan, hapus, atau bersihkan yang selesai |
| POST | `/api/convert/ffmpeg` | Pasang ffmpeg (job `apt`) |
| GET · PUT | `/api/commands?tools=` · `/api/commands/book` | Commands: tool dan app terpasang, perintah simpanan, riwayat shell / simpan perintah sendiri dan favorit |
| GET · PUT | `/api/media/position` | Posisi terakhir video (untuk melanjutkan menonton) |
| GET · POST | `/api/devices` | Daftar perangkat (tanpa password) dan status mesin remote desktop / tambah perangkat |
| PUT · DELETE | `/api/devices/{id}` | Ubah / hapus perangkat (password kosong = tetap) |
| GET | `/api/devices/status` · `/discover` · `/mac?host=` | Menyala/mati dan port layar terbuka / cari komputer di jaringan / cari alamat MAC |
| POST | `/api/devices/{id}/wake` · `/api/devices/engine` | Kirim Wake-on-LAN / pasang dan jalankan mesin remote desktop (`guacd`) |

### Blokir iklan
| Method | Path | Fungsi |
|---|---|---|
| GET · DELETE | `/api/adblock` | Status, statistik, daftar blokir, dan domain yang diizinkan / hapus |
| POST | `/api/adblock/install` · `protection` · `test` | Pasang / nyalakan, matikan, atau jeda perlindungan / cek apakah pemblokiran berjalan |
| POST | `/api/adblock/list` | Nyalakan atau matikan daftar blokir tambahan (tingkat kekuatan, judi online, pop-up, iklan bawaan HP, …) |
| POST · DELETE | `/api/adblock/allow` | Izinkan domain / blokir lagi |

### Layanan, proses, log
| Method | Path | Fungsi |
|---|---|---|
| GET | `/api/services` | Service systemd |
| POST | `/api/services/{unit}/{action}` | Start / stop / restart / enable / disable |
| GET | `/api/services/{unit}/logs` | Log service |
| GET | `/api/processes` · `/api/ports` | Proses dan port yang listening |
| POST | `/api/processes/{pid}/kill` | Hentikan proses |
| GET | `/api/logs` | Journal systemd (filter per kategori/unit) |
| GET | `/api/jobs/{kind}` | Status dan log job latar belakang |

### Pemeliharaan server
| Method | Path | Fungsi |
|---|---|---|
| GET | `/api/updates` | Update apt yang tersedia dan status perlu-restart |
| POST | `/api/updates/check` · `/api/updates/install` | `apt update` / `apt upgrade` (job) |
| GET | `/api/disks` · `/api/disks/usage` | Drive, partisi, SMART, pemakaian ruang |
| POST | `/api/disks/mount` | Mount / unmount |
| GET | `/api/network/interfaces` · `/api/network/connections` | Interface dan koneksi aktif |
| POST | `/api/network/tool` | Ping / traceroute |
| GET | `/api/network/dns` | DNS lookup |
| GET · POST | `/api/firewall` | Aturan ufw |
| GET | `/api/cron` · PUT `/api/cron/{user}` · POST `/api/cron/run` | Cron job dan timer |
| GET · POST | `/api/users` · `/api/users/{name}` · DELETE `/api/users/{name}` | User dan grup Linux |

### File sharing (SMB)
| Method | Path | Fungsi |
|---|---|---|
| GET | `/api/smb` · `/api/smb/status` | Share, user Samba, sesi aktif |
| POST | `/api/smb/restart` | Restart Samba |
| POST · PUT · DELETE | `/api/smb/shares[/{name}]` | Buat / ubah / hapus share |
| POST | `/api/smb/users` · `/api/smb/users/{name}/{action}` | Tambah user, ganti password, aktif/nonaktif, hapus |

### File
| Method | Path | Fungsi |
|---|---|---|
| GET · POST · DELETE | `/api/files` | List folder / buat file / hapus permanen |
| POST | `/api/files/folders` · `rename` · `copy` | Buat folder, rename, copy/move |
| GET · PUT | `/api/files/content` | Baca / simpan file teks |
| GET | `/api/files/raw` · `/api/files/thumb` | File mentah (streaming) / thumbnail |
| GET | `/api/files/info` | Lihat Info: ukuran (folder dihitung), tanggal, pemilik dan izin, disk, detail media |
| GET | `/api/files/search` · `/api/files/tree` | Cari isi file / daftar file (Go to File) |
| POST | `/api/files/upload` | Upload (multipart) |
| GET · POST | `/api/trash` | Isi Sampah / pindahkan path ke sana |
| POST | `/api/trash/restore` | Kembalikan item ke lokasi asal |
| DELETE | `/api/trash/{id}` · `/api/trash` | Hapus permanen satu item / kosongkan Sampah |
| GET · PUT | `/api/files/tags` | Tag semua file / atur tag beberapa path |
| GET | `/api/files/tagged?tag=` | Semua yang punya satu tag |
| GET · POST | `/api/files/recents` | File yang baru dibuka / catat satu |
| GET · POST · DELETE | `/api/wallpapers[/{name}]`, POST `/api/wallpapers/from-file` | Wallpaper |

### Link berbagi
| Method | Path | Fungsi |
|---|---|---|
| GET · POST | `/api/links` | Semua link dan alamat publik / buat link `{path, upload, hours, password}` |
| DELETE | `/api/links/{id}` | Matikan link |
| PUT | `/api/links/settings` | Alamat publik yang dipakai link |
| GET · POST | `/s/{id}` | Halaman pengunjung / form password-nya (tanpa session) |
| GET | `/s/{id}/file?p=` · `/s/{id}/zip?p=` | Unduh file / folder sebagai zip |
| POST | `/s/{id}/upload` | Kirim file ke folder dari link minta file |

### Kubernetes
| Method | Path | Fungsi |
|---|---|---|
| GET | `/api/k8s` | Terpasang/berjalan, node (dengan `top`), namespace |
| POST | `/api/k8s/install` · `/api/k8s/uninstall` | Job install / hapus k3s (log: `/api/jobs/k8s`) |
| GET | `/api/k8s/resources?namespace=` | Workload, pod, service, PVC, event |
| POST | `/api/k8s/action` | `apply`, `delete`, `scale`, `restart`, `image`, `undo`, `namespace`, `deleteNamespace` |
| GET | `/api/k8s/text/{view}` | `logs`, `describe`, `yaml` sebuah resource |
| GET | `/api/k8s/rollout` | Status rollout |

### WebSocket
| Path | Fungsi |
|---|---|
| `/ws/terminal` | PTY. Binary frame = input/output terminal; text frame = JSON kontrol (`{"type":"resize","cols":80,"rows":24}`). |
| `/ws/remote/{id}` | Layar perangkat (subprotocol `guacamole`). Server membuka sesi VNC/RDP di `guacd` dengan password tersimpan, lalu meneruskan instruksi Guacamole utuh dua arah; ping tunnel dijawab server. |
