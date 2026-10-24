# Arsitektur TemanLabsOS

Dokumen untuk developer: cara kerja frontend dan backend, alur build, dan daftar endpoint API.

---

## Gambaran umum

```
┌──────────────── Browser ────────────────┐         ┌──────────── Server Ubuntu ─────────────┐
│ React app (src/)                        │  HTTP   │ temanlabsos  (Go, systemd, :7700)      │
│  ├─ Desktop: Window, Dock, Launcher,    │ ──────▶ │  ├─ static: frontend (embedded)        │
│  │   MenuBar, QuickSearch, widget       │  /api/* │  ├─ auth + sameOrigin middleware       │
│  ├─ windows/*: satu komponen per app    │         │  ├─ handler per area (*.go)            │
│  └─ api/: httpApi ⇄ mockApi             │   WS    │  ├─ background: stats sampler,         │
│                                         │ ──────▶ │  │   container monitor, jobs           │
└─────────────────────────────────────────┘ /ws/... │  └─ frame proxy per app (:7710–7799)   │
                                                    │        │                               │
                                                    │        ├─ Docker Engine (unix socket)  │
                                                    │        ├─ k3s kubectl                  │
                                                    │        └─ systemctl, journalctl, apt,  │
                                                    │           ufw, smbd, lsblk, crontab, … │
                                                    └────────────────────────────────────────┘
```

- **Satu binary.** `scripts/build-server.mjs` mem-build frontend ke `dist/`, menyalinnya ke `server/web/`, lalu `go build` meng-embed folder itu (`//go:embed`) dan meng-compile untuk Linux (`CGO_ENABLED=0`).
- **Tanpa database.** State disimpan di file:
  - `config.json`: alamat, root, user, hash password.
  - `stateDir/apps/<id>/docker-compose.yml`: app dari App Center.
  - `stateDir/wallpapers/` dan `stateDir/thumbs/`.
  - Pengaturan tampilan (tema, widget, folder Launcher) disimpan di `localStorage` browser.

---

## Frontend (`src/`)

| Bagian | Isi |
|---|---|
| `App.tsx` | Pengelola desktop: daftar jendela terbuka, z-order, menu bar per app, Dock, Launcher, Quick Search. `SYSTEM_WINDOWS` berisi judul dan ukuran awal tiap app; `renderWindow` memilih komponennya. |
| `components/Window.tsx` | Frame jendela: drag, resize, minimize/zoom/close dengan animasi (Web Animations API). `SystemWindowId` adalah daftar id app bawaan. |
| `components/Glass.tsx` + `lib/displacement.ts` | Efek kaca: peta displacement untuk `backdrop-filter` (Chromium), dengan fallback blur di browser lain. |
| `lib/systemApps.ts` | Nama, ikon, warna, dan posisi (Dock / folder Utilities) app bawaan. |
| `lib/appMenus.tsx` | `useAppMenus()`: app mendaftarkan menunya sendiri ke menu bar. Shortcut keyboard di item menu otomatis aktif. |
| `lib/windowChrome.tsx` | `WindowToolbar` dan `ToolbarTitle`: toolbar yang menyatu dengan title bar. |
| `lib/contextMenu.tsx` | `useContextMenu().show(event, items)`: menu klik kanan, juga dipakai `PopUpButton`. |
| `lib/i18n.ts` + `lib/i18n-id.ts` | Terjemahan. Teks Inggris jadi kunci: `tr('Open')`, nilai lewat `tr('{0} apps', n)`. Kamus Indonesia ada di `i18n-id.ts`; teks tanpa terjemahan tampil dalam bahasa Inggris. |
| `api/httpApi.ts` | Semua panggilan ke backend. |
| `api/mockApi.ts`, `api/mockSystem.ts` | Implementasi `Api` yang sama dengan data di memori, untuk `npm run dev:mock`. |
| `api/types.ts` | Tipe data yang sama dengan JSON dari backend. |

### Menambah app bawaan baru

1. Buat komponen di `src/windows/NamaApp.tsx`.
2. Tambahkan id-nya ke `SystemWindowId` di `components/Window.tsx`.
3. Tambahkan entri di `SYSTEM_APPS` (`lib/systemApps.ts`). Pakai `utility: true, dock: false` kalau app-nya masuk folder Utilities. Kalau butuh ikon baru, daftarkan di `lib/icons.ts`.
4. Di `App.tsx`, tambahkan judul dan ukuran di `SYSTEM_WINDOWS`, `case` di `renderWindow`, dan `WINDOW_VARIANT` kalau app-nya punya sidebar.
5. Tambahkan fungsi API di `api/types.ts` (interface `Api`), `httpApi.ts`, dan `mockApi.ts` / `mockSystem.ts`.

---

## Backend (`server/`)

Satu file per area. Semua handler didaftarkan di `server.go` (`routes()`).

| File | Tanggung jawab |
|---|---|
| `main.go`, `config.go`, `auth.go` | Start server, konfigurasi, login (PBKDF2, session cookie, pembatasan percobaan login). |
| `server.go` | Routing, middleware `requireAuth` dan `sameOrigin` (tolak request lintas situs), log request. |
| `system.go` | Sampler `/proc`: CPU, memori, disk, jaringan, uptime, IP LAN/Tailscale. |
| `docker.go`, `monitor.go`, `apps.go` | Docker Engine API lewat Unix socket, statistik per container, daftar app (compose project dan metadata CasaOS). |
| `store.go`, `custom.go` | Katalog App Center (template compose) dan Custom Install. |
| `native.go`, `services.go`, `processes.go`, `ports.go` | App non-Docker (dideteksi dari socket yang listening), service systemd, proses, dan port. |
| `frameproxy.go`, `appauth.go` | Reverse proxy per app yang membuang `X-Frame-Options` / CSP `frame-ancestors`, supaya app bisa tampil di jendela. Untuk app dengan login HTTP Basic (mis. Supabase Studio di balik Kong), jendela meminta login sekali; server memeriksanya ke app, menyimpannya (`app-logins.json`, 0600), lalu proxy mengirimnya di setiap request dan membuang tantangan `WWW-Authenticate` supaya dialog login browser tidak muncul. |
| `files.go`, `copy.go`, `thumbs.go`, `media.go` | File manager, copy/move, thumbnail (Go untuk foto, `ffmpeg` untuk video), streaming media. |
| `terminal.go` | Shell login di PTY, dijembatani ke WebSocket. |
| `jobs.go` | Tugas panjang di latar belakang (apt, install k3s), dengan log yang dipantau UI. Satu job per jenis. |
| `updates.go`, `logs.go`, `disks.go`, `network.go`, `cron.go`, `users.go`, `smb.go`, `wallpaper.go` | Utilitas server. |
| `devices.go`, `remote.go` | Perangkat lain di jaringan: status (ping + ketuk port), Wake-on-LAN (magic packet ke semua broadcast LAN), pencarian (sapu /24 lalu baca tabel ARP; nama dari DNS, mDNS, NetBIOS). Remote layar: container `guacd` (`127.0.0.1:4822`) dijalankan lewat Docker API; server melakukan handshake Guacamole dengan password tersimpan, lalu meneruskan instruksi ke WebSocket. |
| `k8s.go` | Install/uninstall k3s, membaca resource cluster, dan aksi (`apply`, `scale`, `rollout`, `delete`, …) lewat `k3s kubectl`. |

### Prinsip keamanan di backend

- Input dari user divalidasi dengan regex sebelum dipakai sebagai argumen perintah (nama container, unit systemd, user, nama resource Kubernetes, dll.). Perintah dijalankan dengan `exec.Command` dan argumen terpisah, tanpa shell, supaya input tidak bisa menyisipkan perintah lain.
- Hanya ada dua pengecualian yang disengaja:
  - **Run Now** di Scheduled Tasks menjalankan perintah cron milik user, sebagai user itu sendiri (`runuser … sh -c`).
  - Installer k3s menjalankan script tetap yang ada di dalam kode, tanpa input dari user.
- Daftar putih (whitelist) untuk aksi yang diizinkan, misalnya jenis resource Kubernetes dan aksi service.
- User, service, dan namespace sistem yang penting dilindungi dari penghapusan.
- File mentah (`/api/files/raw`) dikirim dengan CSP `sandbox`, supaya file HTML/SVG yang diunggah tidak bisa menjalankan script di origin TemanLabsOS.
- Konfigurasi Samba divalidasi dengan `testparm` sebelum reload. Port penting tidak bisa ditutup dari halaman firewall, supaya akses tidak terkunci.

---

## Daftar endpoint API

Semua endpoint (kecuali login) butuh session cookie. Respons berupa JSON, dan error berbentuk `{"error": "pesan"}`.

### Akun & sistem
| Method | Path | Fungsi |
|---|---|---|
| POST | `/api/login` · `/api/logout` | Masuk / keluar |
| GET | `/api/me` | Status login dan hostname |
| POST | `/api/password` | Ganti password |
| GET | `/api/system` | CPU, memori, disk, jaringan, uptime, alamat IP |
| POST | `/api/power/{action}` | Restart / shutdown server |
| GET · POST | `/api/time` | Tanggal, zona waktu, NTP |

### App & container
| Method | Path | Fungsi |
|---|---|---|
| GET | `/api/store` | Katalog App Center |
| GET | `/api/apps` | App terpasang (Docker + native) |
| POST | `/api/apps/custom` | Custom Install (image atau compose) |
| POST | `/api/apps/{id}/install` · `start` · `stop` | Install / start / stop app |
| DELETE | `/api/apps/{id}` | Uninstall |
| GET | `/api/apps/{id}/frame` · `icon` | Alamat frame proxy (plus `auth: "basic"`, `signedIn` untuk app yang minta login) / ikon app |
| PUT · DELETE | `/api/apps/{id}/signin` | Simpan login HTTP Basic app (dicek dulu ke app; salah = 422) / lupakan |
| GET | `/api/containers` · `/api/networks` | Container (dengan statistik) dan network Docker |
| POST | `/api/containers/{id}/{action}` | Start / stop / restart container |
| GET | `/api/containers/{id}/logs` | Log container |

### Mengelola app & App Store
| Method | Path | Fungsi |
|---|---|---|
| GET · PUT | `/api/apps/{id}/config` | Pengaturan app (form layanan utama + compose YAML) / simpan dan buat ulang container (job `app-{id}`) |
| POST | `/api/apps/{id}/update` | Pull image baru lalu recreate (compose atau docker run) |
| GET | `/api/apps/updates?refresh=1` | Hasil cek digest image ke registry, per app |
| DELETE | `/api/apps/{id}?data=1` | Uninstall, opsional hapus volume dan folder `/DATA/AppData/…` |
| WS | `/ws/apps/{id}/terminal?container=` | Shell di dalam container (`docker exec`) |
| GET | `/api/appstore` | Semua app dari app store (format CasaOS) dan daftar store |
| GET · POST | `/api/appstore/apps/{id}` · `/install` | Detail + compose yang sudah diisi variabelnya / install |
| POST · PUT | `/api/appstore/refresh` · `/api/appstore/sources` | Unduh ulang store / ganti daftar store |

### Storage & cloud
| Method | Path | Fungsi |
|---|---|---|
| POST | `/api/disks/automount` · `format` · `eject` | Mount saat startup (fstab) / format (job `disk-format`) / eject USB |
| GET | `/api/storage` | Entri fstab, merged storage, status mergerfs, auto-mount USB |
| POST · DELETE | `/api/storage/merge[/{name}]` | Buat / hapus merged storage (mergerfs) |
| PUT | `/api/storage/usb` | Nyalakan / matikan auto-mount USB |
| GET · POST · DELETE | `/api/cloud[/{name}]` | Cloud drive (rclone) |
| POST | `/api/cloud/auth` · `/api/cloud/{name}/{action}` | Login browser (OAuth) / mount, unmount, restart |
| GET | `/api/convert` · `/api/convert/probe?path=` | Remux: status ffmpeg, encoder, antrean / isi file (stream, codec) |
| POST | `/api/convert` | Tambah konversi ke antrean (remux atau encode ulang dengan ffmpeg) |
| DELETE | `/api/convert/tasks[/{id}]` | Batalkan / hapus konversi, atau bersihkan yang sudah selesai |
| POST | `/api/convert/ffmpeg` | Pasang ffmpeg (job `apt`) |
| GET | `/api/commands?tools=` | Commands: tool yang terpasang, app terpasang (container, folder compose, unit), perintah simpanan, riwayat shell |
| PUT | `/api/commands/book` | Simpan perintah sendiri dan favorit |
| GET · PUT | `/api/media/position` | Posisi terakhir video (untuk melanjutkan menonton) |
| GET · POST | `/api/devices` | Devices: daftar perangkat (tanpa password) dan status mesin remote desktop / tambah perangkat |
| PUT · DELETE | `/api/devices/{id}` | Ubah / hapus perangkat (password kosong = tetap) |
| GET | `/api/devices/status` · `/discover` · `/mac?host=` | Menyala/mati dan port layar terbuka / cari komputer di jaringan / cari alamat MAC |
| POST | `/api/devices/{id}/wake` · `/api/devices/engine` | Kirim Wake-on-LAN / pasang dan jalankan mesin remote desktop (`guacd`) |
| GET · POST | `/api/system/release` · `/install` | Cek rilis GitHub / update diri sendiri (job `self-update`) |

### Kubernetes
| Method | Path | Fungsi |
|---|---|---|
| GET | `/api/k8s` | Terpasang/berjalan, node (dengan `top`), namespace |
| POST | `/api/k8s/install` · `/api/k8s/uninstall` | Job install / hapus k3s (log: `/api/jobs/k8s`) |
| GET | `/api/k8s/resources?namespace=` | Workload, pod, service, PVC, event |
| POST | `/api/k8s/action` | `apply`, `delete`, `scale`, `restart`, `image`, `undo`, `namespace`, `deleteNamespace` |
| GET | `/api/k8s/text/{view}` | `logs`, `describe`, `yaml` sebuah resource |
| GET | `/api/k8s/rollout` | Status rollout |

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
| GET · POST · DELETE | `/api/files` | List folder / buat file / hapus |
| POST | `/api/files/folders` · `rename` · `copy` | Buat folder, rename, copy/move |
| GET · PUT | `/api/files/content` | Baca / simpan file teks |
| GET | `/api/files/raw` · `/api/files/thumb` | File mentah (streaming) / thumbnail |
| GET | `/api/files/info` | Lihat Info: ukuran (folder dihitung), tanggal, pemilik dan izin, disk, detail media |
| GET | `/api/files/search` · `/api/files/tree` | Cari isi file / daftar file (Go to File) |
| POST | `/api/files/upload` | Upload (multipart) |
| GET · POST · DELETE | `/api/wallpapers[/{name}]`, POST `/api/wallpapers/from-file` | Wallpaper |

### WebSocket
| Path | Fungsi |
|---|---|
| `/ws/terminal` | PTY. Binary frame = input/output terminal; text frame = JSON kontrol (`{"type":"resize","cols":80,"rows":24}`). |
| `/ws/remote/{id}` | Layar perangkat (subprotocol `guacamole`). Server membuka sesi VNC/RDP di `guacd` dengan password tersimpan, lalu meneruskan instruksi Guacamole utuh dua arah; ping tunnel dijawab server. |
