// The command book's library: commands for Ubuntu and the tools a home server runs, each with
// what it does in English and Indonesian and the words people search with. This is content, so
// both languages live here (not in the i18n dictionary); search matches either, whatever the
// UI language.
//
// Commands hold blanks as {{name}} or {{name:default}}; PARAMS says what each blank is.
import {
  Archive,
  Boxes,
  CalendarClock,
  Cloud,
  Cpu,
  FileText,
  Film,
  FolderTree,
  GitBranch,
  HardDrive,
  KeyRound,
  Layers,
  ListTree,
  Network,
  Package,
  ScrollText,
  Server,
  Share2,
  ShieldCheck,
  ShipWheel,
  Users,
  Waypoints,
  type LucideIcon,
} from 'lucide-react'

export type Text = [en: string, id: string]

export type CategoryId =
  | 'packages'
  | 'services'
  | 'logs'
  | 'processes'
  | 'system'
  | 'disk'
  | 'files'
  | 'archives'
  | 'network'
  | 'firewall'
  | 'users'
  | 'ssh'
  | 'schedule'
  | 'sharing'
  | 'docker'
  | 'compose'
  | 'kubernetes'
  | 'media'
  | 'cloud'
  | 'git'
  | 'vpn'
  | 'snap'
  | 'dev'

export interface Category {
  id: CategoryId
  label: Text
  icon: LucideIcon
  group: 'ubuntu' | 'tools'
  /** The program the whole category is about; hidden when it isn't installed. */
  tool?: string
}

export const CATEGORIES: Category[] = [
  { id: 'packages', label: ['Packages & Updates', 'Paket & Update'], icon: Package, group: 'ubuntu' },
  { id: 'services', label: ['Services', 'Layanan'], icon: Server, group: 'ubuntu' },
  { id: 'logs', label: ['Logs', 'Log'], icon: ScrollText, group: 'ubuntu' },
  { id: 'processes', label: ['Processes', 'Proses'], icon: ListTree, group: 'ubuntu' },
  { id: 'system', label: ['System & Hardware', 'Sistem & Hardware'], icon: Cpu, group: 'ubuntu' },
  { id: 'disk', label: ['Disks & Space', 'Disk & Ruang'], icon: HardDrive, group: 'ubuntu' },
  { id: 'files', label: ['Files & Folders', 'File & Folder'], icon: FolderTree, group: 'ubuntu' },
  { id: 'archives', label: ['Archives', 'Arsip'], icon: Archive, group: 'ubuntu' },
  { id: 'network', label: ['Network', 'Jaringan'], icon: Network, group: 'ubuntu' },
  { id: 'firewall', label: ['Firewall & Security', 'Firewall & Keamanan'], icon: ShieldCheck, group: 'ubuntu' },
  { id: 'users', label: ['Users & Permissions', 'User & Izin'], icon: Users, group: 'ubuntu' },
  { id: 'ssh', label: ['SSH & Remote', 'SSH & Remote'], icon: KeyRound, group: 'ubuntu' },
  { id: 'schedule', label: ['Scheduled Jobs', 'Tugas Terjadwal'], icon: CalendarClock, group: 'ubuntu' },
  { id: 'sharing', label: ['File Sharing (Samba)', 'Berbagi File (Samba)'], icon: Share2, group: 'tools', tool: 'smbd' },
  { id: 'docker', label: ['Docker', 'Docker'], icon: Boxes, group: 'tools', tool: 'docker' },
  { id: 'compose', label: ['Docker Compose', 'Docker Compose'], icon: Layers, group: 'tools', tool: 'docker' },
  { id: 'kubernetes', label: ['Kubernetes', 'Kubernetes'], icon: ShipWheel, group: 'tools', tool: 'kubectl' },
  { id: 'media', label: ['Video & Audio (ffmpeg)', 'Video & Audio (ffmpeg)'], icon: Film, group: 'tools', tool: 'ffmpeg' },
  { id: 'cloud', label: ['Cloud Drives (rclone)', 'Cloud Drive (rclone)'], icon: Cloud, group: 'tools', tool: 'rclone' },
  { id: 'git', label: ['Git', 'Git'], icon: GitBranch, group: 'tools', tool: 'git' },
  { id: 'vpn', label: ['Tailscale', 'Tailscale'], icon: Waypoints, group: 'tools', tool: 'tailscale' },
  { id: 'snap', label: ['Snap', 'Snap'], icon: Package, group: 'tools', tool: 'snap' },
  { id: 'dev', label: ['Python & Node', 'Python & Node'], icon: FileText, group: 'tools', tool: 'python3' },
]

export type ParamKind = 'service' | 'container' | 'user' | 'path' | 'text'

export interface Param {
  label: Text
  kind?: ParamKind
  /** An example, shown in the empty field. */
  example?: string
}

export const PARAMS: Record<string, Param> = {
  package: { label: ['Package', 'Paket'], example: 'nginx' },
  program: { label: ['Program', 'Program'], example: 'ffmpeg' },
  word: { label: ['Word', 'Kata'], example: 'media server' },
  service: { label: ['Service', 'Layanan'], kind: 'service', example: 'ssh' },
  lines: { label: ['Lines', 'Baris'], example: '100' },
  since: { label: ['Since', 'Sejak'], example: '1 hour ago' },
  size: { label: ['Size', 'Ukuran'], example: '500M' },
  name: { label: ['Name', 'Nama'], example: 'myapp' },
  pid: { label: ['Process ID (PID)', 'ID proses (PID)'], example: '1234' },
  port: { label: ['Port', 'Port'], example: '8080' },
  localport: { label: ['Port on this computer', 'Port di komputer ini'], example: '8080' },
  command: { label: ['Command', 'Perintah'], example: './backup.sh' },
  time: { label: ['When', 'Kapan'], example: '+10' },
  timezone: { label: ['Time zone', 'Zona waktu'], example: 'Asia/Jakarta' },
  path: { label: ['Path', 'Path'], kind: 'path', example: '/DATA' },
  file: { label: ['File', 'File'], kind: 'path', example: '/DATA/notes.txt' },
  source: { label: ['From', 'Dari'], kind: 'path', example: '/DATA/Photos' },
  destination: { label: ['To', 'Ke'], kind: 'path', example: '/mnt/HDD_DATA/Photos' },
  target: { label: ['Points to', 'Menunjuk ke'], kind: 'path', example: '/mnt/HDD_DATA/Media' },
  link: { label: ['Link name', 'Nama link'], kind: 'path', example: '/DATA/Media' },
  archive: { label: ['Archive name', 'Nama arsip'], example: 'backup' },
  text: { label: ['Text', 'Teks'], example: 'error' },
  mode: { label: ['Permissions', 'Izin'], example: '755' },
  minutes: { label: ['Minutes', 'Menit'], example: '60' },
  disk: { label: ['Disk', 'Disk'], example: 'sda' },
  partition: { label: ['Partition', 'Partisi'], example: 'sdb1' },
  host: { label: ['Host or IP', 'Host atau IP'], example: '192.168.1.10' },
  url: { label: ['Address (URL)', 'Alamat (URL)'], example: 'https://example.com' },
  ip: { label: ['IP address', 'Alamat IP'], example: '192.168.1.50' },
  mac: { label: ['MAC address', 'Alamat MAC'], example: 'aa:bb:cc:dd:ee:ff' },
  number: { label: ['Rule number', 'Nomor aturan'], example: '3' },
  user: { label: ['User', 'User'], kind: 'user', example: 'dio' },
  group: { label: ['Group', 'Grup'], example: 'docker' },
  email: { label: ['Email', 'Email'], example: 'me@example.com' },
  container: { label: ['Container', 'Container'], kind: 'container', example: 'jellyfin' },
  image: { label: ['Image', 'Image'], example: 'nginx:latest' },
  dir: { label: ['Compose folder', 'Folder compose'], kind: 'path', example: '/DATA/AppData/myapp' },
  part: { label: ['Service in the compose file', 'Service di file compose'], example: 'web' },
  namespace: { label: ['Namespace', 'Namespace'], example: 'default' },
  pod: { label: ['Pod', 'Pod'], example: 'web-7d4b9c-x2k8p' },
  deployment: { label: ['Deployment', 'Deployment'], example: 'web' },
  replicas: { label: ['Replicas', 'Replika'], example: '3' },
  svc: { label: ['Kubernetes service', 'Service Kubernetes'], example: 'web' },
  input: { label: ['Input file', 'File masukan'], kind: 'path', example: 'film.mkv' },
  output: { label: ['Output file', 'File hasil'], example: 'film.mp4' },
  start: { label: ['Start', 'Mulai'], example: '00:01:00' },
  end: { label: ['End', 'Selesai'], example: '00:02:00' },
  remote: { label: ['Remote', 'Remote'], example: 'GoogleDrive' },
  folder: { label: ['Folder there', 'Folder di sana'], example: 'Backup' },
  repo: { label: ['Repository URL', 'URL repository'], example: 'https://github.com/user/repo.git' },
  branch: { label: ['Branch', 'Branch'], example: 'main' },
  message: { label: ['Message', 'Pesan'], example: 'Fix the config' },
  script: { label: ['Script', 'Script'], example: 'build' },
}

export interface LibraryCommand {
  id: string
  cat: CategoryId
  title: Text
  command: string
  note?: Text
  /** Words people search with, in either language. */
  keywords: string
  /** The program it needs, when that isn't the category's own. */
  tool?: string
  /** The apt package that provides tool, when it's named differently. */
  pkg?: string
  /** Deletes or changes something that's hard to undo. */
  danger?: true
}

const C = (
  id: string,
  cat: CategoryId,
  title: Text,
  command: string,
  keywords: string,
  extra: Partial<Pick<LibraryCommand, 'note' | 'tool' | 'pkg' | 'danger'>> = {},
): LibraryCommand => ({ id, cat, title, command, keywords, ...extra })

export const LIBRARY: LibraryCommand[] = [
  // ----- Packages & updates -----
  C('apt-update', 'packages', ['Refresh the list of available updates', 'Perbarui daftar update yang tersedia'], 'sudo apt update', 'apt update refresh repository repo daftar paket cek update check updates ubuntu'),
  C('apt-upgrade', 'packages', ['Install all updates', 'Pasang semua update'], 'sudo apt update && sudo apt upgrade -y', 'upgrade update semua all perbarui sistem system patch ubuntu os server', {
    note: ['Restart afterwards if a kernel update came in.', 'Restart setelahnya kalau ada update kernel.'],
  }),
  C('apt-full-upgrade', 'packages', ['Install all updates, including ones that add or remove packages', 'Pasang semua update, termasuk yang menambah atau menghapus paket'], 'sudo apt full-upgrade -y', 'full upgrade dist-upgrade kernel held back tertahan'),
  C('apt-install', 'packages', ['Install a program', 'Pasang program'], 'sudo apt install -y {{package}}', 'install pasang tambah add aplikasi app software program paket'),
  C('apt-remove', 'packages', ['Uninstall a program', 'Hapus program'], 'sudo apt remove {{package}}', 'uninstall remove hapus copot buang aplikasi program paket'),
  C('apt-purge', 'packages', ['Uninstall a program and its settings', 'Hapus program beserta pengaturannya'], 'sudo apt purge {{package}}', 'purge hapus bersih config konfigurasi settings total', { danger: true }),
  C('apt-autoremove', 'packages', ['Remove packages nothing needs any more', 'Hapus paket yang sudah tidak dipakai'], 'sudo apt autoremove -y', 'autoremove bersih clean unused tidak terpakai sisa leftover ruang space'),
  C('apt-clean', 'packages', ['Free the space taken by downloaded packages', 'Kosongkan ruang dari paket yang sudah diunduh'], 'sudo apt clean', 'clean cache bersih ruang space hemat'),
  C('apt-search', 'packages', ['Search for a program to install', 'Cari program untuk dipasang'], 'apt search {{word}}', 'search cari find temukan paket program'),
  C('apt-show', 'packages', ['Details about a package', 'Detail sebuah paket'], 'apt show {{package}}', 'show info detail versi version deskripsi'),
  C('apt-installed', 'packages', ['List installed packages', 'Daftar paket terpasang'], 'apt list --installed', 'list installed terpasang daftar semua paket'),
  C('apt-upgradable', 'packages', ['See which packages have updates', 'Lihat paket yang punya update'], 'apt list --upgradable', 'upgradable update tersedia available pending'),
  C('dpkg-owner', 'packages', ['Find which package a program came from', 'Cari asal paket sebuah program'], 'dpkg -S "$(command -v {{program}})"', 'which package owner asal paket dpkg program berasal'),
  C('apt-reinstall', 'packages', ['Reinstall a package', 'Pasang ulang paket'], 'sudo apt install --reinstall {{package}}', 'reinstall pasang ulang rusak broken perbaiki'),
  C('apt-fix', 'packages', ['Fix broken installs', 'Perbaiki instalasi yang rusak'], 'sudo apt --fix-broken install', 'fix broken rusak error dependency dependensi perbaiki dpkg'),
  C('dpkg-configure', 'packages', ['Finish an interrupted install', 'Selesaikan instalasi yang terputus'], 'sudo dpkg --configure -a', 'interrupted terputus dpkg lock configure lanjutkan'),
  C('apt-history', 'packages', ['See recently installed packages', 'Lihat paket yang baru dipasang'], 'grep " install " /var/log/dpkg.log | tail -n 30', 'history riwayat baru dipasang recently installed log'),
  C('reboot-required', 'packages', ['Check if the server needs a restart', 'Cek apakah server perlu restart'], 'cat /var/run/reboot-required 2>/dev/null || echo "No restart needed"', 'reboot restart required perlu dibutuhkan kernel update'),
  C('ppa-add', 'packages', ['Add a PPA software source', 'Tambah sumber software PPA'], 'sudo add-apt-repository ppa:{{name}} && sudo apt update', 'ppa repository repo sumber tambah add'),

  // ----- Services -----
  C('svc-status', 'services', ['See whether a service is running', 'Lihat apakah layanan berjalan'], 'systemctl status {{service}}', 'status service layanan jalan running cek check aktif active'),
  C('svc-start', 'services', ['Start a service', 'Jalankan layanan'], 'sudo systemctl start {{service}}', 'start mulai jalankan nyalakan service layanan'),
  C('svc-stop', 'services', ['Stop a service', 'Hentikan layanan'], 'sudo systemctl stop {{service}}', 'stop hentikan matikan service layanan'),
  C('svc-restart', 'services', ['Restart a service', 'Restart layanan'], 'sudo systemctl restart {{service}}', 'restart ulang mulai ulang service layanan reload'),
  C('svc-reload', 'services', ['Reload a service’s settings without stopping it', 'Muat ulang pengaturan layanan tanpa menghentikannya'], 'sudo systemctl reload {{service}}', 'reload config konfigurasi muat ulang'),
  C('svc-enable', 'services', ['Start a service now and at every startup', 'Jalankan layanan sekarang dan setiap startup'], 'sudo systemctl enable --now {{service}}', 'enable boot startup otomatis automatic nyala saat hidup'),
  C('svc-disable', 'services', ['Stop a service and keep it off at startup', 'Hentikan layanan dan jangan jalankan saat startup'], 'sudo systemctl disable --now {{service}}', 'disable boot startup matikan otomatis nonaktif'),
  C('svc-running', 'services', ['List running services', 'Daftar layanan yang berjalan'], 'systemctl list-units --type=service --state=running', 'list running daftar layanan services jalan'),
  C('svc-failed', 'services', ['List services that failed', 'Daftar layanan yang gagal'], 'systemctl --failed', 'failed gagal error rusak crash service'),
  C('svc-cat', 'services', ['Show a service’s settings file', 'Tampilkan file pengaturan layanan'], 'systemctl cat {{service}}', 'unit file config cat show tampilkan'),
  C('svc-edit', 'services', ['Change a service’s settings safely (override)', 'Ubah pengaturan layanan dengan aman (override)'], 'sudo systemctl edit {{service}}', 'edit override ubah config environment'),
  C('svc-daemon-reload', 'services', ['Reload service files after editing them', 'Muat ulang file layanan setelah diedit'], 'sudo systemctl daemon-reload', 'daemon reload unit file edit changed'),
  C('boot-blame', 'services', ['See what makes startup slow', 'Lihat apa yang bikin startup lambat'], 'systemd-analyze blame | head -n 20', 'boot startup lambat slow lama analyze blame'),

  // ----- Logs -----
  C('log-follow', 'logs', ['Watch a service’s log live', 'Pantau log layanan secara langsung'], 'journalctl -u {{service}} -f', 'log live follow pantau realtime service layanan journal'),
  C('log-last', 'logs', ['Last lines of a service’s log', 'Baris terakhir log layanan'], 'journalctl -u {{service}} -n {{lines:100}} --no-pager', 'log terakhir last recent service journal'),
  C('log-errors', 'logs', ['Errors since the last startup', 'Error sejak startup terakhir'], 'journalctl -p err -b --no-pager', 'error errors masalah problem boot gagal'),
  C('log-previous-boot', 'logs', ['Log from before the last restart (after a crash)', 'Log sebelum restart terakhir (setelah crash)'], 'journalctl -b -1 -e', 'crash mati sendiri restart sebelumnya previous boot hang freeze'),
  C('log-since', 'logs', ['Everything logged since a time', 'Semua log sejak waktu tertentu'], 'journalctl --since "{{since:1 hour ago}}" --no-pager', 'since sejak jam waktu time today hari ini'),
  C('log-kernel', 'logs', ['Kernel messages (drives, USB, hardware)', 'Pesan kernel (disk, USB, hardware)'], 'sudo dmesg -T | tail -n 50', 'dmesg kernel hardware usb disk error driver'),
  C('log-size', 'logs', ['How much space logs take', 'Berapa ruang yang dipakai log'], 'journalctl --disk-usage', 'log size ukuran ruang space besar'),
  C('log-vacuum', 'logs', ['Shrink old logs', 'Kecilkan log lama'], 'sudo journalctl --vacuum-size={{size:500M}}', 'vacuum shrink kecilkan hapus log lama bersih ruang space'),
  C('log-syslog', 'logs', ['Watch the system log', 'Pantau log sistem'], 'sudo tail -f /var/log/syslog', 'syslog system log pantau live'),
  C('log-logins', 'logs', ['Recent logins and sudo use', 'Login dan pemakaian sudo terbaru'], 'sudo tail -n 50 /var/log/auth.log', 'auth login masuk sudo keamanan security'),
  C('log-failed-logins', 'logs', ['Failed login attempts', 'Percobaan login yang gagal'], 'sudo grep "Failed password" /var/log/auth.log | tail -n 20', 'failed password gagal login hack brute force ssh serangan attack'),

  // ----- Processes -----
  C('proc-htop', 'processes', ['See what’s using CPU and memory (live)', 'Lihat apa yang memakai CPU dan memori (live)'], 'htop', 'htop top task manager cpu ram memori proses lambat berat server lemot usage pemakaian', { tool: 'htop' }),
  C('proc-mem', 'processes', ['Programs using the most memory', 'Program yang paling banyak memakai memori'], 'ps aux --sort=-%mem | head -n 15', 'memory ram memori boros banyak terbesar proses server lambat usage pemakaian'),
  C('proc-cpu', 'processes', ['Programs using the most CPU', 'Program yang paling banyak memakai CPU'], 'ps aux --sort=-%cpu | head -n 15', 'cpu prosesor berat lambat panas proses server lemot'),
  C('proc-find', 'processes', ['Find a running program', 'Cari program yang berjalan'], 'pgrep -a {{name}}', 'find cari process proses running jalan pid'),
  C('proc-kill', 'processes', ['Stop a program by its PID', 'Hentikan program lewat PID'], 'kill {{pid}}', 'kill stop hentikan matikan proses pid'),
  C('proc-kill-force', 'processes', ['Force-stop a stuck program', 'Paksa hentikan program yang macet'], 'sudo kill -9 {{pid}}', 'kill force paksa hang macet stuck not responding', { danger: true }),
  C('proc-pkill', 'processes', ['Stop every program with a name', 'Hentikan semua program dengan nama tertentu'], 'pkill {{name}}', 'pkill killall stop semua nama', { danger: true }),
  C('proc-port', 'processes', ['What is using a port', 'Apa yang memakai sebuah port'], 'sudo lsof -i :{{port}}', 'port dipakai used address in use bentrok conflict siapa who', { tool: 'lsof' }),
  C('proc-tree', 'processes', ['All processes as a tree', 'Semua proses dalam bentuk pohon'], 'ps -ef --forest | less', 'tree pohon parent child process'),
  C('proc-nohup', 'processes', ['Keep a command running after you log out', 'Biarkan perintah tetap jalan setelah logout'], 'nohup {{command}} > output.log 2>&1 &', 'background latar logout tetap jalan nohup disconnect'),
  C('tmux-new', 'processes', ['Start a session that survives disconnects (tmux)', 'Mulai sesi yang tetap jalan walau putus (tmux)'], 'tmux new -s {{name}}', 'tmux screen session sesi disconnect putus koneksi', { tool: 'tmux' }),
  C('tmux-attach', 'processes', ['Go back into a tmux session', 'Kembali ke sesi tmux'], 'tmux attach -t {{name}}', 'tmux attach kembali resume sesi', { tool: 'tmux' }),

  // ----- System & hardware -----
  C('sys-uptime', 'system', ['How long the server has been on, and its load', 'Berapa lama server menyala, dan bebannya'], 'uptime', 'uptime nyala lama load beban server lambat berat'),
  C('sys-version', 'system', ['Ubuntu version', 'Versi Ubuntu'], 'lsb_release -a', 'version versi ubuntu os release'),
  C('sys-kernel', 'system', ['Kernel version', 'Versi kernel'], 'uname -r', 'kernel uname versi linux'),
  C('sys-memory', 'system', ['Free memory (RAM)', 'Memori (RAM) yang tersisa'], 'free -h', 'memory ram memori sisa free kosong swap usage pemakaian terpakai'),
  C('sys-cpu', 'system', ['Processor details', 'Detail prosesor'], 'lscpu', 'cpu processor prosesor core inti info'),
  C('sys-temp', 'system', ['Temperatures (CPU, drives)', 'Suhu (CPU, disk)'], 'sensors', 'temperature suhu panas heat cpu fan kipas', { tool: 'sensors', pkg: 'lm-sensors' }),
  C('sys-hardware', 'system', ['Hardware summary', 'Ringkasan hardware'], 'sudo lshw -short', 'hardware perangkat spesifikasi spec komponen', { tool: 'lshw' }),
  C('sys-usb', 'system', ['Connected USB devices', 'Perangkat USB yang tersambung'], 'lsusb', 'usb perangkat device colok terhubung'),
  C('sys-hostname', 'system', ['Rename the server', 'Ganti nama server'], 'sudo hostnamectl set-hostname {{name}}', 'hostname nama server ganti rename'),
  C('sys-timezone', 'system', ['Change the time zone', 'Ganti zona waktu'], 'sudo timedatectl set-timezone {{timezone:Asia/Jakarta}}', 'timezone zona waktu jam time clock wib'),
  C('sys-time', 'system', ['Time, time zone and clock sync', 'Waktu, zona waktu, dan sinkronisasi jam'], 'timedatectl', 'time waktu jam tanggal date ntp sync'),
  C('sys-reboot', 'system', ['Restart the server', 'Restart server'], 'sudo reboot', 'reboot restart mulai ulang nyalakan ulang', { danger: true }),
  C('sys-shutdown', 'system', ['Turn the server off', 'Matikan server'], 'sudo shutdown -h now', 'shutdown matikan off poweroff', { danger: true }),
  C('sys-reboot-later', 'system', ['Restart in a few minutes', 'Restart beberapa menit lagi'], 'sudo shutdown -r {{time:+10}}', 'schedule jadwal restart nanti later menit'),
  C('sys-shutdown-cancel', 'system', ['Cancel a planned restart or shutdown', 'Batalkan restart atau shutdown yang dijadwalkan'], 'sudo shutdown -c', 'cancel batal shutdown restart'),
  C('sys-who', 'system', ['Who is logged in', 'Siapa yang sedang login'], 'who', 'who siapa login user session'),
  C('sys-last', 'system', ['Recent logins', 'Login terakhir'], 'last -n 20', 'last login riwayat history masuk'),
  C('sys-swap', 'system', ['Show swap space', 'Tampilkan swap'], 'swapon --show', 'swap memori virtual'),
  C('sys-swapfile', 'system', ['Add a swap file', 'Tambah file swap'], 'sudo fallocate -l {{size:4G}} /swapfile && sudo chmod 600 /swapfile && sudo mkswap /swapfile && sudo swapon /swapfile', 'swap tambah add memori kurang ram'),

  // ----- Disks & space -----
  C('disk-free', 'disk', ['Free space on every drive', 'Ruang kosong di setiap disk'], 'df -h', 'disk space ruang kosong free penuh full storage penyimpanan sisa cek lihat check berapa'),
  C('disk-folders', 'disk', ['Which folders take the most space', 'Folder mana yang paling makan ruang'], 'sudo du -sh {{path:.}}/* 2>/dev/null | sort -h', 'folder size ukuran besar makan ruang penuh du'),
  C('disk-big-files', 'disk', ['Find the biggest files', 'Cari file paling besar'], 'sudo find {{path:/}} -xdev -type f -size +{{size:500M}} -exec ls -lh {} + 2>/dev/null | sort -k5 -h | tail -n 20', 'big besar file ukuran find penuh space'),
  C('disk-ncdu', 'disk', ['Browse disk usage (interactive)', 'Jelajahi pemakaian disk (interaktif)'], 'sudo ncdu {{path:/}}', 'ncdu disk usage ruang interaktif jelajah', { tool: 'ncdu' }),
  C('disk-list', 'disk', ['List drives and partitions', 'Daftar disk dan partisi'], 'lsblk -f', 'lsblk disk drive partisi partition hdd ssd usb'),
  C('disk-uuid', 'disk', ['IDs (UUID) of partitions', 'ID (UUID) partisi'], 'sudo blkid', 'uuid blkid id partisi fstab'),
  C('disk-health', 'disk', ['Check a drive’s health (SMART)', 'Cek kesehatan disk (SMART)'], 'sudo smartctl -a /dev/{{disk:sda}}', 'smart health kesehatan rusak bad sector disk hdd', { tool: 'smartctl', pkg: 'smartmontools' }),
  C('disk-mount', 'disk', ['Mount a partition', 'Mount partisi'], 'sudo mkdir -p {{path:/mnt/usb}} && sudo mount /dev/{{partition:sdb1}} {{path:/mnt/usb}}', 'mount pasang usb disk partisi'),
  C('disk-umount', 'disk', ['Unmount a drive', 'Unmount disk'], 'sudo umount {{path:/mnt/usb}}', 'umount unmount lepas cabut eject'),
  C('disk-fstab', 'disk', ['Edit what mounts at startup (fstab)', 'Edit mount saat startup (fstab)'], 'sudo nano /etc/fstab', 'fstab startup mount otomatis'),
  C('disk-mount-all', 'disk', ['Mount everything in fstab (tests it)', 'Mount semua yang ada di fstab (sekaligus tes)'], 'sudo mount -a', 'mount all fstab tes test'),
  C('disk-busy', 'disk', ['What keeps a drive busy (can’t unmount)', 'Apa yang bikin disk sibuk (tidak bisa unmount)'], 'sudo lsof +f -- {{path}}', 'busy sibuk target is busy unmount gagal', { tool: 'lsof' }),
  C('disk-io', 'disk', ['Which programs read and write the disk', 'Program yang membaca dan menulis disk'], 'sudo iotop -o', 'iotop io disk read write baca tulis lambat server berat', { tool: 'iotop' }),
  C('disk-speed', 'disk', ['Test a drive’s write speed', 'Tes kecepatan tulis disk'], 'dd if=/dev/zero of={{path:/DATA}}/speedtest.img bs=1M count=1024 oflag=direct status=progress && rm {{path:/DATA}}/speedtest.img', 'speed kecepatan tes test disk tulis write benchmark'),
  C('disk-inodes', 'disk', ['Check inodes (no room for new files though space is free)', 'Cek inode (tidak bisa buat file baru padahal masih ada ruang)'], 'df -i', 'inode no space left on device'),

  // ----- Files & folders -----
  C('ls', 'files', ['List a folder with sizes and hidden files', 'Isi folder lengkap dengan ukuran dan file tersembunyi'], 'ls -lah {{path:.}}', 'ls list daftar isi folder hidden tersembunyi'),
  C('find-name', 'files', ['Find files by name', 'Cari file berdasarkan nama'], 'find {{path:.}} -iname "*{{name}}*"', 'find cari file nama temukan lokasi dimana where'),
  C('grep-text', 'files', ['Find text inside files', 'Cari teks di dalam file'], 'grep -rni "{{text}}" {{path:.}}', 'grep search cari teks isi text inside'),
  C('cp', 'files', ['Copy a file or folder', 'Salin file atau folder'], 'cp -a {{source}} {{destination}}', 'copy salin duplikat cp'),
  C('mv', 'files', ['Move or rename', 'Pindahkan atau ganti nama'], 'mv {{source}} {{destination}}', 'move pindah rename ganti nama mv'),
  C('rm', 'files', ['Delete a folder and everything in it', 'Hapus folder beserta isinya'], 'rm -rf {{path}}', 'delete hapus remove rm folder buang', { danger: true }),
  C('mkdir', 'files', ['Make a folder', 'Buat folder'], 'mkdir -p {{path}}', 'mkdir buat folder baru new direktori'),
  C('chmod', 'files', ['Change permissions', 'Ubah izin'], 'chmod {{mode:755}} {{path}}', 'chmod permission izin akses executable'),
  C('chown', 'files', ['Give a folder to a user', 'Jadikan user sebagai pemilik folder'], 'sudo chown -R {{user}}:{{user}} {{path}}', 'chown owner pemilik permission denied izin ditolak akses'),
  C('tail', 'files', ['Last lines of a file', 'Baris terakhir sebuah file'], 'tail -n {{lines:50}} {{file}}', 'tail akhir baris terakhir lihat file'),
  C('tail-follow', 'files', ['Watch a file grow (live)', 'Pantau file bertambah (live)'], 'tail -f {{file}}', 'tail follow live pantau log file'),
  C('nano', 'files', ['Edit a file', 'Edit file'], 'nano {{file}}', 'edit ubah nano editor file teks'),
  C('count-files', 'files', ['Count the files in a folder', 'Hitung jumlah file di folder'], 'find {{path:.}} -type f | wc -l', 'count hitung jumlah banyak file'),
  C('recent-files', 'files', ['Files changed recently', 'File yang baru diubah'], 'find {{path:.}} -type f -mmin -{{minutes:60}}', 'recent baru diubah modified changed terbaru'),
  C('rsync', 'files', ['Copy a folder, resuming where it left off', 'Salin folder, bisa lanjut dari terakhir'], 'rsync -avh --progress {{source}}/ {{destination}}/', 'rsync sync salin copy backup lanjut resume besar'),
  C('rsync-mirror', 'files', ['Make a folder an exact copy of another', 'Jadikan folder salinan persis folder lain'], 'rsync -avh --delete {{source}}/ {{destination}}/', 'mirror sinkron sync persis exact backup', {
    danger: true,
    note: ['Files only in the destination are deleted.', 'File yang hanya ada di tujuan akan dihapus.'],
  }),
  C('rsync-remote', 'files', ['Copy to another server', 'Salin ke server lain'], 'rsync -avz -e ssh {{source}} {{user}}@{{host}}:{{path}}', 'rsync ssh remote server lain kirim transfer'),
  C('ln', 'files', ['Make a shortcut (symlink)', 'Buat shortcut (symlink)'], 'ln -s {{target}} {{link}}', 'symlink shortcut link pintasan ln'),
  C('sha256', 'files', ['Checksum of a file', 'Checksum file'], 'sha256sum {{file}}', 'checksum hash sha256 verifikasi verify'),
  C('download', 'files', ['Download a file', 'Unduh file'], 'wget -c {{url}}', 'download unduh wget curl ambil'),
  C('tree', 'files', ['Show a folder as a tree', 'Tampilkan folder sebagai pohon'], 'tree -L 2 {{path:.}}', 'tree pohon struktur folder', { tool: 'tree' }),
  C('dupes', 'files', ['Find duplicate files', 'Cari file duplikat'], 'fdupes -r {{path}}', 'duplicate duplikat kembar sama double', { tool: 'fdupes' }),

  // ----- Archives -----
  C('tar-create', 'archives', ['Pack a folder into a .tar.gz', 'Bungkus folder jadi .tar.gz'], 'tar -czvf {{archive:backup}}.tar.gz {{path}}', 'tar gz compress kompres arsip bungkus backup'),
  C('tar-extract', 'archives', ['Unpack a .tar.gz', 'Ekstrak .tar.gz'], 'tar -xzvf {{file}} -C {{destination:.}}', 'tar extract ekstrak buka unpack gz'),
  C('tar-list', 'archives', ['See what’s in a .tar.gz', 'Lihat isi .tar.gz'], 'tar -tzvf {{file}}', 'tar list isi lihat'),
  C('tar-dated', 'archives', ['Back up a folder with today’s date', 'Backup folder dengan tanggal hari ini'], 'tar -czf {{archive:backup}}-$(date +%F).tar.gz {{path}}', 'backup tanggal date harian daily'),
  C('zip', 'archives', ['Zip a folder', 'Zip folder'], 'zip -r {{archive:backup}}.zip {{path}}', 'zip compress kompres arsip', { tool: 'zip' }),
  C('unzip', 'archives', ['Unzip a file', 'Ekstrak file zip'], 'unzip {{file}} -d {{destination:.}}', 'unzip extract ekstrak buka zip', { tool: 'unzip' }),
  C('7z', 'archives', ['Unpack a .7z (or most archives)', 'Ekstrak .7z (atau arsip lain)'], '7z x {{file}}', '7z 7zip extract ekstrak', { tool: '7z', pkg: 'p7zip-full' }),
  C('unrar', 'archives', ['Unpack a .rar', 'Ekstrak .rar'], 'unrar x {{file}}', 'rar unrar extract ekstrak', { tool: 'unrar' }),

  // ----- Network -----
  C('net-ip', 'network', ['This server’s IP addresses', 'Alamat IP server ini'], 'ip -br a', 'ip address alamat lokal local lan interface'),
  C('net-public-ip', 'network', ['Public IP address (internet)', 'Alamat IP publik (internet)'], 'curl -s https://ifconfig.me && echo', 'public publik ip internet luar wan'),
  C('net-ports', 'network', ['Which ports are open and by what', 'Port mana yang terbuka dan oleh apa'], 'sudo ss -tulpn', 'port terbuka open listening dipakai used ss netstat lihat cek daftar'),
  C('net-ping', 'network', ['Check if a computer answers', 'Cek apakah komputer lain merespons'], 'ping -c 4 {{host}}', 'ping cek koneksi connection reachable internet'),
  C('net-trace', 'network', ['See the route to a host', 'Lihat rute ke host'], 'tracepath {{host}}', 'traceroute tracepath rute route hop lambat'),
  C('net-dns', 'network', ['Look up a domain', 'Cari IP sebuah domain'], 'resolvectl query {{host:google.com}}', 'dns domain resolve nslookup dig lookup'),
  C('net-dns-status', 'network', ['Which DNS servers are used', 'DNS server yang dipakai'], 'resolvectl status', 'dns server resolver nameserver'),
  C('net-port-test', 'network', ['Test if a port is reachable on another computer', 'Tes apakah port di komputer lain bisa dijangkau'], 'nc -zv {{host}} {{port}}', 'port test tes reachable terbuka telnet nc'),
  C('net-curl-head', 'network', ['Check a website answers', 'Cek website merespons'], 'curl -I {{url}}', 'curl http website web status header cek'),
  C('net-speed', 'network', ['Internet speed test', 'Tes kecepatan internet'], 'speedtest-cli --simple', 'speedtest kecepatan internet speed download upload', { tool: 'speedtest-cli' }),
  C('net-usage', 'network', ['Live network traffic', 'Lalu lintas jaringan (live)'], 'sudo nload', 'traffic bandwidth pemakaian usage live jaringan', { tool: 'nload' }),
  C('net-routes', 'network', ['Routes (gateway)', 'Rute (gateway)'], 'ip route', 'route rute gateway default'),
  C('net-netplan', 'network', ['Edit the network settings (netplan)', 'Edit pengaturan jaringan (netplan)'], 'sudo nano /etc/netplan/*.yaml', 'netplan static ip tetap config jaringan'),
  C('net-netplan-apply', 'network', ['Apply network settings', 'Terapkan pengaturan jaringan'], 'sudo netplan try', 'netplan apply terapkan try', {
    note: ['“try” rolls back by itself if you lose the connection.', '“try” kembali sendiri kalau koneksi putus.'],
  }),
  C('net-hosts', 'network', ['Edit the hosts file', 'Edit file hosts'], 'sudo nano /etc/hosts', 'hosts domain lokal local nama'),
  C('net-wol', 'network', ['Wake a computer over the network', 'Nyalakan komputer lewat jaringan'], 'wakeonlan {{mac}}', 'wake on lan wol nyalakan', { tool: 'wakeonlan' }),
  C('net-iperf', 'network', ['Measure speed to another computer (iperf3)', 'Ukur kecepatan ke komputer lain (iperf3)'], 'iperf3 -c {{host}}', 'iperf speed lan kecepatan jaringan lokal', { tool: 'iperf3' }),

  // ----- Firewall & security -----
  C('ufw-status', 'firewall', ['Firewall rules', 'Aturan firewall'], 'sudo ufw status numbered', 'ufw firewall status rules aturan'),
  C('ufw-allow', 'firewall', ['Open a port in the firewall', 'Buka port di firewall'], 'sudo ufw allow {{port}}/tcp', 'ufw allow buka port izinkan firewall'),
  C('ufw-allow-ip', 'firewall', ['Allow everything from one IP', 'Izinkan semua dari satu IP'], 'sudo ufw allow from {{ip}}', 'ufw allow ip izinkan whitelist'),
  C('ufw-deny', 'firewall', ['Block a port', 'Blokir port'], 'sudo ufw deny {{port}}', 'ufw deny block blokir tutup port'),
  C('ufw-delete', 'firewall', ['Delete a firewall rule', 'Hapus aturan firewall'], 'sudo ufw delete {{number}}', 'ufw delete hapus aturan rule'),
  C('ufw-enable', 'firewall', ['Turn the firewall on (keeps SSH open)', 'Nyalakan firewall (SSH tetap terbuka)'], 'sudo ufw allow OpenSSH && sudo ufw enable', 'ufw enable nyalakan aktifkan firewall', { danger: true }),
  C('f2b-status', 'firewall', ['Banned IPs (fail2ban)', 'IP yang diblokir (fail2ban)'], 'sudo fail2ban-client status sshd', 'fail2ban banned blokir ban serangan', { tool: 'fail2ban-client', pkg: 'fail2ban' }),
  C('f2b-unban', 'firewall', ['Unban an IP (fail2ban)', 'Lepas blokir IP (fail2ban)'], 'sudo fail2ban-client set sshd unbanip {{ip}}', 'fail2ban unban lepas blokir', { tool: 'fail2ban-client', pkg: 'fail2ban' }),
  C('sec-updates', 'firewall', ['Install security updates automatically', 'Pasang update keamanan otomatis'], 'sudo apt install -y unattended-upgrades && sudo dpkg-reconfigure -plow unattended-upgrades', 'unattended otomatis automatic security keamanan update'),

  // ----- Users & permissions -----
  C('user-add', 'users', ['Add a user', 'Tambah user'], 'sudo adduser {{user}}', 'adduser useradd tambah user akun account baru'),
  C('user-sudo', 'users', ['Let a user use sudo', 'Izinkan user memakai sudo'], 'sudo usermod -aG sudo {{user}}', 'sudo admin root akses izin'),
  C('user-group', 'users', ['Add a user to a group', 'Masukkan user ke grup'], 'sudo usermod -aG {{group}} {{user}}', 'group grup usermod tambah'),
  C('user-docker', 'users', ['Use Docker without sudo', 'Pakai Docker tanpa sudo'], 'sudo usermod -aG docker $USER', 'docker group sudo permission denied tanpa', {
    note: ['Log out and back in afterwards.', 'Logout lalu login lagi setelahnya.'],
  }),
  C('user-passwd', 'users', ['Change a user’s password', 'Ganti password user'], 'sudo passwd {{user}}', 'password kata sandi ganti ubah reset'),
  C('user-del', 'users', ['Delete a user and their home folder', 'Hapus user beserta folder home-nya'], 'sudo deluser --remove-home {{user}}', 'delete hapus user akun', { danger: true }),
  C('user-list', 'users', ['List the people’s accounts', 'Daftar akun pengguna'], "awk -F: '$3>=1000 && $3<65534 {print $1}' /etc/passwd", 'list daftar user akun pengguna'),
  C('user-groups', 'users', ['Groups a user is in', 'Grup yang dimiliki user'], 'groups {{user}}', 'groups grup anggota member'),
  C('user-id', 'users', ['Who am I (user and groups)', 'Saya siapa (user dan grup)'], 'id', 'whoami id saya user siapa'),
  C('user-switch', 'users', ['Work as another user', 'Masuk sebagai user lain'], 'sudo -iu {{user}}', 'switch su ganti user login sebagai'),
  C('user-lock', 'users', ['Lock an account', 'Kunci akun'], 'sudo passwd -l {{user}}', 'lock kunci blokir disable akun'),

  // ----- SSH & remote -----
  C('ssh-connect', 'ssh', ['Connect to another server', 'Sambung ke server lain'], 'ssh {{user}}@{{host}}', 'ssh connect sambung remote login masuk'),
  C('ssh-keygen', 'ssh', ['Make an SSH key', 'Buat kunci SSH'], 'ssh-keygen -t ed25519 -C "{{email}}"', 'ssh key kunci generate buat keygen'),
  C('ssh-copy-id', 'ssh', ['Log in without a password (copy your key)', 'Login tanpa password (salin kunci)'], 'ssh-copy-id {{user}}@{{host}}', 'ssh copy id key tanpa password passwordless'),
  C('ssh-pubkey', 'ssh', ['Show your public key', 'Tampilkan kunci publik'], 'cat ~/.ssh/id_ed25519.pub', 'public key kunci publik github'),
  C('scp-to', 'ssh', ['Send a file to another server', 'Kirim file ke server lain'], 'scp {{file}} {{user}}@{{host}}:{{path}}', 'scp kirim upload transfer file'),
  C('scp-from', 'ssh', ['Fetch a file from another server', 'Ambil file dari server lain'], 'scp {{user}}@{{host}}:{{file}} {{destination:.}}', 'scp ambil download transfer'),
  C('ssh-tunnel', 'ssh', ['Reach a port on another server through SSH', 'Akses port server lain lewat SSH'], 'ssh -L {{localport:8080}}:localhost:{{port}} {{user}}@{{host}}', 'tunnel port forward terowongan'),
  C('sshd-config', 'ssh', ['Edit the SSH server settings', 'Edit pengaturan SSH server'], 'sudo nano /etc/ssh/sshd_config', 'sshd config port password root login'),
  C('sshd-restart', 'ssh', ['Restart the SSH server', 'Restart SSH server'], 'sudo systemctl restart ssh', 'ssh restart sshd'),

  // ----- Scheduled jobs -----
  C('cron-edit', 'schedule', ['Edit your scheduled jobs', 'Edit tugas terjadwalmu'], 'crontab -e', 'cron crontab jadwal schedule otomatis'),
  C('cron-list', 'schedule', ['List your scheduled jobs', 'Daftar tugas terjadwalmu'], 'crontab -l', 'cron list daftar jadwal'),
  C('cron-root', 'schedule', ['Edit root’s scheduled jobs', 'Edit tugas terjadwal root'], 'sudo crontab -e', 'cron root admin jadwal'),
  C('cron-daily', 'schedule', ['Run a command every day at 3:00', 'Jalankan perintah setiap hari jam 3:00'], '(crontab -l 2>/dev/null; echo "0 3 * * * {{command}}") | crontab -', 'daily harian setiap hari otomatis jadwal backup malam'),
  C('timers', 'schedule', ['List systemd timers', 'Daftar timer systemd'], 'systemctl list-timers', 'timer systemd jadwal'),
  C('at-later', 'schedule', ['Run a command once, later', 'Jalankan perintah sekali, nanti'], 'echo "{{command}}" | at {{time:now + 1 hour}}', 'at nanti later sekali once jadwal', { tool: 'at' }),

  // ----- File sharing (Samba) -----
  C('smb-user', 'sharing', ['Let a user sign in to shares', 'Izinkan user login ke share'], 'sudo smbpasswd -a {{user}}', 'samba smb password user share windows'),
  C('smb-test', 'sharing', ['Check the Samba settings', 'Cek pengaturan Samba'], 'testparm -s', 'samba testparm config cek'),
  C('smb-restart', 'sharing', ['Restart Samba', 'Restart Samba'], 'sudo systemctl restart smbd', 'samba restart smbd share'),
  C('smb-status', 'sharing', ['Who is connected to the shares', 'Siapa yang terhubung ke share'], 'sudo smbstatus', 'samba status connected terhubung'),

  // ----- Docker -----
  C('docker-ps', 'docker', ['Running containers', 'Container yang berjalan'], 'docker ps', 'docker ps container running jalan list daftar'),
  C('docker-ps-all', 'docker', ['All containers, also stopped ones', 'Semua container, termasuk yang berhenti'], 'docker ps -a', 'docker all semua stopped berhenti exited'),
  C('docker-logs', 'docker', ['A container’s log (live)', 'Log container (live)'], 'docker logs -f --tail {{lines:100}} {{container}}', 'docker logs log container error lihat'),
  C('docker-shell', 'docker', ['Open a shell inside a container', 'Buka shell di dalam container'], 'docker exec -it {{container}} sh', 'docker exec shell bash masuk container terminal console'),
  C('docker-restart', 'docker', ['Restart a container', 'Restart container'], 'docker restart {{container}}', 'docker restart container ulang'),
  C('docker-stop', 'docker', ['Stop a container', 'Hentikan container'], 'docker stop {{container}}', 'docker stop hentikan matikan container'),
  C('docker-start', 'docker', ['Start a container', 'Jalankan container'], 'docker start {{container}}', 'docker start jalankan container'),
  C('docker-stats', 'docker', ['CPU and memory of every container', 'CPU dan memori setiap container'], 'docker stats', 'docker stats cpu memory ram pemakaian resource'),
  C('docker-df', 'docker', ['Space used by Docker', 'Ruang yang dipakai Docker'], 'docker system df', 'docker disk space ruang size ukuran'),
  C('docker-prune', 'docker', ['Remove stopped containers and unused images', 'Hapus container berhenti dan image tak terpakai'], 'docker system prune -a', 'docker prune bersih clean cleanup hapus ruang space unused terpakai container image', { danger: true }),
  C('docker-images', 'docker', ['Downloaded images', 'Image yang sudah diunduh'], 'docker images', 'docker images image daftar'),
  C('docker-pull', 'docker', ['Download an image', 'Unduh image'], 'docker pull {{image}}', 'docker pull unduh download image update'),
  C('docker-rmi', 'docker', ['Delete an image', 'Hapus image'], 'docker rmi {{image}}', 'docker rmi hapus image delete'),
  C('docker-run', 'docker', ['Start a new container that restarts by itself', 'Jalankan container baru yang restart sendiri'], 'docker run -d --name {{name}} -p {{port}}:{{port}} --restart unless-stopped {{image}}', 'docker run jalankan baru new container deploy'),
  C('docker-rm', 'docker', ['Delete a container', 'Hapus container'], 'docker rm -f {{container}}', 'docker rm hapus delete container', { danger: true }),
  C('docker-volumes', 'docker', ['List volumes', 'Daftar volume'], 'docker volume ls', 'docker volume data penyimpanan'),
  C('docker-networks', 'docker', ['List networks', 'Daftar network'], 'docker network ls', 'docker network jaringan'),
  C('docker-cp', 'docker', ['Copy a file out of a container', 'Salin file keluar dari container'], 'docker cp {{container}}:{{path}} {{destination:.}}', 'docker cp copy salin file container'),
  C('docker-ports', 'docker', ['A container’s ports', 'Port sebuah container'], 'docker port {{container}}', 'docker port container mapping'),
  C('docker-inspect-ip', 'docker', ['A container’s settings (IP, mounts, env)', 'Pengaturan container (IP, mount, env)'], 'docker inspect {{container}} | less', 'docker inspect ip mount env detail'),
  C('docker-autostart', 'docker', ['Make a container start with the server', 'Buat container nyala bersama server'], 'docker update --restart unless-stopped {{container}}', 'docker restart policy otomatis startup boot'),

  // ----- Docker Compose -----
  C('compose-ls', 'compose', ['All compose projects', 'Semua project compose'], 'docker compose ls', 'compose ls project daftar stack'),
  C('compose-up', 'compose', ['Start a compose project', 'Jalankan project compose'], 'cd {{dir}} && docker compose up -d', 'compose up start jalankan deploy'),
  C('compose-down', 'compose', ['Stop and remove a compose project', 'Hentikan dan hapus project compose'], 'cd {{dir}} && docker compose down', 'compose down stop hentikan hapus'),
  C('compose-update', 'compose', ['Update a compose project', 'Update project compose'], 'cd {{dir}} && docker compose pull && docker compose up -d', 'compose update pull perbarui versi baru image'),
  C('compose-logs', 'compose', ['A compose project’s log (live)', 'Log project compose (live)'], 'cd {{dir}} && docker compose logs -f --tail 100', 'compose logs log'),
  C('compose-restart', 'compose', ['Restart one service of a project', 'Restart satu service dari project'], 'cd {{dir}} && docker compose restart {{part}}', 'compose restart service ulang'),
  C('compose-config', 'compose', ['Check a compose file for mistakes', 'Cek file compose dari kesalahan'], 'cd {{dir}} && docker compose config', 'compose config validate cek error yaml'),

  // ----- Kubernetes -----
  C('k8s-nodes', 'kubernetes', ['Cluster nodes', 'Node cluster'], 'kubectl get nodes -o wide', 'kubernetes k8s nodes node cluster'),
  C('k8s-pods', 'kubernetes', ['All pods', 'Semua pod'], 'kubectl get pods -A', 'kubernetes pods pod daftar list'),
  C('k8s-all', 'kubernetes', ['Everything in a namespace', 'Semua yang ada di namespace'], 'kubectl get all -n {{namespace:default}}', 'kubernetes all semua namespace'),
  C('k8s-describe', 'kubernetes', ['Why a pod isn’t running (describe)', 'Kenapa pod tidak jalan (describe)'], 'kubectl describe pod {{pod}} -n {{namespace:default}}', 'kubernetes describe pending crashloop error pod'),
  C('k8s-logs', 'kubernetes', ['A pod’s log (live)', 'Log pod (live)'], 'kubectl logs -f {{pod}} -n {{namespace:default}}', 'kubernetes logs log pod'),
  C('k8s-exec', 'kubernetes', ['Open a shell in a pod', 'Buka shell di pod'], 'kubectl exec -it {{pod}} -n {{namespace:default}} -- sh', 'kubernetes exec shell masuk pod'),
  C('k8s-scale', 'kubernetes', ['Change the number of replicas', 'Ubah jumlah replika'], 'kubectl scale deployment {{deployment}} --replicas={{replicas:3}} -n {{namespace:default}}', 'kubernetes scale replika replicas skala'),
  C('k8s-restart', 'kubernetes', ['Restart a deployment (rolling)', 'Restart deployment (bergilir)'], 'kubectl rollout restart deployment {{deployment}} -n {{namespace:default}}', 'kubernetes rollout restart deployment'),
  C('k8s-undo', 'kubernetes', ['Roll a deployment back', 'Kembalikan deployment ke versi sebelumnya'], 'kubectl rollout undo deployment {{deployment}} -n {{namespace:default}}', 'kubernetes rollback undo kembali versi'),
  C('k8s-apply', 'kubernetes', ['Apply a YAML file', 'Terapkan file YAML'], 'kubectl apply -f {{file}}', 'kubernetes apply yaml manifest deploy'),
  C('k8s-delete-pod', 'kubernetes', ['Delete a pod (it comes back fresh)', 'Hapus pod (akan dibuat ulang)'], 'kubectl delete pod {{pod}} -n {{namespace:default}}', 'kubernetes delete hapus pod restart'),
  C('k8s-top', 'kubernetes', ['CPU and memory of pods', 'CPU dan memori pod'], 'kubectl top pods -A', 'kubernetes top cpu memory resource'),
  C('k8s-events', 'kubernetes', ['Recent cluster events', 'Event cluster terbaru'], 'kubectl get events -A --sort-by=.lastTimestamp', 'kubernetes events kejadian error'),
  C('k8s-forward', 'kubernetes', ['Open a service on this computer (port-forward)', 'Buka service di komputer ini (port-forward)'], 'kubectl port-forward svc/{{svc}} {{localport:8080}}:{{port:80}} -n {{namespace:default}}', 'kubernetes port forward akses service'),

  // ----- Video & audio -----
  C('ff-info', 'media', ['What’s inside a video (codecs, size)', 'Isi sebuah video (codec, ukuran)'], 'ffprobe -hide_banner {{input}}', 'ffprobe info codec detail video audio', { tool: 'ffprobe' }),
  C('ff-remux', 'media', ['Change the format without converting (MKV → MP4)', 'Ganti format tanpa konversi (MKV → MP4)'], 'ffmpeg -i {{input}} -c copy {{output:output.mp4}}', 'remux mkv mp4 ts format ganti convert cepat', {
    note: ['The Remux app does this with a few clicks.', 'App Remux bisa melakukan ini dengan beberapa klik.'],
  }),
  C('ff-h264', 'media', ['Convert a video to MP4 that plays everywhere', 'Konversi video ke MP4 yang bisa diputar di mana saja'], 'ffmpeg -i {{input}} -c:v libx264 -crf 22 -preset medium -c:a aac {{output:output.mp4}}', 'convert konversi h264 mp4 encode kompatibel'),
  C('ff-audio', 'media', ['Take the sound out as MP3', 'Ambil suaranya jadi MP3'], 'ffmpeg -i {{input}} -vn -c:a libmp3lame -q:a 2 {{output:audio.mp3}}', 'audio suara mp3 extract ambil lagu musik'),
  C('ff-cut', 'media', ['Cut a clip without converting', 'Potong klip tanpa konversi'], 'ffmpeg -ss {{start:00:01:00}} -to {{end:00:02:00}} -i {{input}} -c copy {{output:clip.mp4}}', 'cut potong trim klip clip bagian'),
  C('ff-resize', 'media', ['Make a video 720p', 'Ubah video jadi 720p'], 'ffmpeg -i {{input}} -vf scale=-2:720 -c:a copy {{output:720p.mp4}}', 'resize kecilkan resolusi 720p scale ukuran'),
  C('ff-frame', 'media', ['Save a frame as a picture', 'Simpan satu frame jadi gambar'], 'ffmpeg -ss {{start:00:00:10}} -i {{input}} -frames:v 1 {{output:frame.jpg}}', 'screenshot frame gambar thumbnail foto'),
  C('ff-gif', 'media', ['Turn a clip into a GIF', 'Ubah klip jadi GIF'], 'ffmpeg -i {{input}} -vf "fps=10,scale=480:-1" {{output:clip.gif}}', 'gif animasi animation'),
  C('ff-record', 'media', ['Record a live stream', 'Rekam siaran langsung'], 'ffmpeg -i "{{url}}" -c copy {{output:recording.ts}}', 'record rekam stream live siaran m3u8 iptv'),

  // ----- Cloud drives -----
  C('rc-remotes', 'cloud', ['Your rclone remotes', 'Remote rclone milikmu'], 'rclone listremotes', 'rclone remote daftar cloud', {
    note: ['Cloud drives added in Disk Manager are mounted under /DATA/Cloud, where cp and rsync work too.', 'Cloud drive dari Disk Manager ter-mount di /DATA/Cloud, di sana cp dan rsync juga bisa dipakai.'],
  }),
  C('rc-ls', 'cloud', ['List files in the cloud', 'Daftar file di cloud'], 'rclone lsf {{remote}}:{{folder}}', 'rclone list ls cloud file'),
  C('rc-copy', 'cloud', ['Upload a folder to the cloud', 'Unggah folder ke cloud'], 'rclone copy {{source}} {{remote}}:{{folder}} -P', 'rclone upload unggah copy backup cloud google drive'),
  C('rc-sync', 'cloud', ['Make a cloud folder an exact copy', 'Jadikan folder cloud salinan persis'], 'rclone sync {{source}} {{remote}}:{{folder}} -P', 'rclone sync sinkron mirror backup', { danger: true }),
  C('rc-about', 'cloud', ['Space left in the cloud', 'Sisa ruang di cloud'], 'rclone about {{remote}}:', 'rclone quota kuota ruang space sisa'),
  C('rc-config', 'cloud', ['Set up a remote by hand', 'Atur remote secara manual'], 'rclone config', 'rclone config tambah remote'),

  // ----- Git -----
  C('git-clone', 'git', ['Download a repository', 'Unduh repository'], 'git clone {{repo}}', 'git clone unduh download repo github'),
  C('git-status', 'git', ['What changed', 'Apa yang berubah'], 'git status', 'git status berubah changes'),
  C('git-pull', 'git', ['Get the latest changes', 'Ambil perubahan terbaru'], 'git pull', 'git pull update terbaru'),
  C('git-commit', 'git', ['Save all changes (commit)', 'Simpan semua perubahan (commit)'], 'git add -A && git commit -m "{{message}}"', 'git commit simpan save add'),
  C('git-push', 'git', ['Upload your commits', 'Unggah commit'], 'git push', 'git push unggah upload'),
  C('git-log', 'git', ['History', 'Riwayat'], 'git log --oneline --graph -n 20', 'git log riwayat history'),
  C('git-branch', 'git', ['Start a new branch', 'Mulai branch baru'], 'git switch -c {{branch}}', 'git branch cabang baru'),
  C('git-discard', 'git', ['Throw away all uncommitted changes', 'Buang semua perubahan yang belum di-commit'], 'git reset --hard && git clean -fd', 'git reset buang discard batal', { danger: true }),

  // ----- Tailscale -----
  C('ts-status', 'vpn', ['Devices on your tailnet', 'Perangkat di tailnet'], 'tailscale status', 'tailscale vpn status perangkat'),
  C('ts-ip', 'vpn', ['This server’s Tailscale IP', 'IP Tailscale server ini'], 'tailscale ip -4', 'tailscale ip alamat'),
  C('ts-up', 'vpn', ['Connect to Tailscale', 'Sambung ke Tailscale'], 'sudo tailscale up', 'tailscale up connect sambung login'),

  // ----- Snap -----
  C('snap-list', 'snap', ['Installed snaps', 'Snap terpasang'], 'snap list', 'snap list daftar'),
  C('snap-refresh', 'snap', ['Update snaps', 'Update snap'], 'sudo snap refresh', 'snap update refresh'),
  C('snap-install', 'snap', ['Install a snap', 'Pasang snap'], 'sudo snap install {{package}}', 'snap install pasang'),
  C('snap-remove', 'snap', ['Remove a snap', 'Hapus snap'], 'sudo snap remove {{package}}', 'snap remove hapus'),

  // ----- Python & Node -----
  C('py-server', 'dev', ['Share a folder over the web quickly', 'Bagikan folder lewat web dengan cepat'], 'python3 -m http.server {{port:8000}}', 'python http server web share bagikan cepat'),
  C('py-venv', 'dev', ['Make a Python virtual environment', 'Buat virtual environment Python'], 'python3 -m venv .venv && . .venv/bin/activate', 'python venv virtualenv environment'),
  C('py-pip', 'dev', ['Install a project’s Python packages', 'Pasang paket Python sebuah project'], 'pip install -r requirements.txt', 'pip install requirements python'),
  C('npm-install', 'dev', ['Install a project’s Node packages', 'Pasang paket Node sebuah project'], 'npm install', 'npm node install', { tool: 'npm' }),
  C('npm-run', 'dev', ['Run a project script', 'Jalankan script project'], 'npm run {{script}}', 'npm run script build dev start', { tool: 'npm' }),
  C('pm2-list', 'dev', ['Node apps kept running by pm2', 'App Node yang dijalankan pm2'], 'pm2 list', 'pm2 node list proses', { tool: 'pm2' }),
]

/** The blanks in a command, in order: name and default. */
export function blanks(command: string): { name: string; value?: string }[] {
  const seen = new Set<string>()
  const out: { name: string; value?: string }[] = []
  for (const m of command.matchAll(/\{\{([a-z][a-z0-9_]*)(?::([^}]*))?\}\}/g)) {
    if (seen.has(m[1])) continue
    seen.add(m[1])
    out.push({ name: m[1], value: m[2] })
  }
  return out
}

/** Fills the blanks; ones without a value stay as ‹name›. */
export function fill(command: string, values: Record<string, string>) {
  return command.replace(/\{\{([a-z][a-z0-9_]*)(?::([^}]*))?\}\}/g, (_, name: string, def?: string) => values[name]?.trim() || def || `‹${name}›`)
}

/** Every program the library may need, for the server to check. */
export const LIBRARY_TOOLS = [...new Set([...CATEGORIES.map(c => c.tool), ...LIBRARY.map(c => c.tool), 'k3s'].filter((t): t is string => !!t))]
