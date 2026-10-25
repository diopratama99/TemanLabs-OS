// The desktop's own apps, with the same glyphs and colors as their icons in TemanLabsOS
// (src/lib/systemApps.ts and src/lib/icons.ts in the app).
import {
  Activity,
  ArrowRightLeft,
  BookMarked,
  Braces,
  CalendarClock,
  CircleFadingArrowUp,
  CloudDownload,
  Film,
  Folder,
  HardDrive,
  DatabaseBackup,
  Images,
  LayoutGrid,
  MonitorSmartphone,
  Music,
  Network,
  Radio,
  ScrollText,
  Settings,
  Share2,
  ShieldCheck,
  ShipWheel,
  ShoppingBag,
  SquareTerminal,
} from 'lucide-static'
import type { Lang } from '../i18n/types'

export type Group = 'apps' | 'files' | 'network' | 'tools'

export interface App {
  id: string
  glyph: string
  color: [string, string]
  group: Group
  name: Record<Lang, string>
  text: Record<Lang, string>
}

const glyph = (svg: string) => svg.replace(/\s*class="[^"]*"/, '').replace(/\s+width="24"\s+height="24"/, '').trim()

export const LAUNCHER: Pick<App, 'glyph' | 'color'> = { glyph: glyph(LayoutGrid), color: ['#ff8ad8', '#7d5cff'] }

export const APPS: App[] = [
  { id: 'files', glyph: glyph(Folder), color: ['#6fd8ff', '#1a8cff'], group: 'files', name: { en: 'Files', id: 'Berkas' }, text: { en: 'Thumbnails, tags, Trash and share links', id: 'Thumbnail, tag, Sampah, dan link berbagi' } },
  { id: 'store', glyph: glyph(ShoppingBag), color: ['#3fc1ff', '#2d55ff'], group: 'apps', name: { en: 'App Center', id: 'Pusat Aplikasi' }, text: { en: 'Hundreds of apps, a page for each', id: 'Ratusan app, satu halaman per app' } },
  { id: 'code', glyph: glyph(Braces), color: ['#4fc3ff', '#1f5fd6'], group: 'files', name: { en: 'Code', id: 'Code' }, text: { en: 'An editor with explorer and terminal', id: 'Editor dengan explorer dan terminal' } },
  { id: 'terminal', glyph: glyph(SquareTerminal), color: ['#4a4a4f', '#1c1c1e'], group: 'tools', name: { en: 'Terminal', id: 'Terminal' }, text: { en: 'A full shell in the browser', id: 'Shell lengkap di browser' } },
  { id: 'activity', glyph: glyph(Activity), color: ['#5be37d', '#14883a'], group: 'apps', name: { en: 'System Monitor', id: 'Monitor Sistem' }, text: { en: 'Containers, services and 30 days of history', id: 'Container, layanan, dan riwayat 30 hari' } },
  { id: 'kubernetes', glyph: glyph(ShipWheel), color: ['#6a9bff', '#2349c9'], group: 'apps', name: { en: 'Kubernetes', id: 'Kubernetes' }, text: { en: 'Install k3s, then manage workloads', id: 'Pasang k3s, lalu kelola workload' } },
  { id: 'music', glyph: glyph(Music), color: ['#ff7a93', '#f5203e'], group: 'files', name: { en: 'Music Player', id: 'Pemutar Musik' }, text: { en: 'Your music, straight from Files', id: 'Musikmu, langsung dari Berkas' } },
  { id: 'downloader', glyph: glyph(CloudDownload), color: ['#ffd36b', '#ff8a00'], group: 'files', name: { en: 'Downloader', id: 'Pengunduh' }, text: { en: 'Videos and photos from a link', id: 'Video dan foto dari link' } },
  { id: 'recorder', glyph: glyph(Radio), color: ['#ff8a8a', '#e0245e'], group: 'files', name: { en: 'Live Recorder', id: 'Perekam Live' }, text: { en: 'Streams recorded as they go live', id: 'Siaran direkam begitu dimulai' } },
  { id: 'settings', glyph: glyph(Settings), color: ['#a1a1a8', '#55555b'], group: 'network', name: { en: 'Settings', id: 'Pengaturan' }, text: { en: 'Backup, ad blocking, remote access and more', id: 'Backup, blokir iklan, akses jarak jauh, dan lainnya' } },
  { id: 'devices', glyph: glyph(MonitorSmartphone), color: ['#7cc8ff', '#3b5bfd'], group: 'tools', name: { en: 'Devices', id: 'Perangkat' }, text: { en: 'Wake-on-LAN and remote screens', id: 'Wake-on-LAN dan layar jarak jauh' } },
  { id: 'sharing', glyph: glyph(Share2), color: ['#5ee0d0', '#0d8f88'], group: 'network', name: { en: 'File Sharing', id: 'Berbagi File' }, text: { en: 'SMB shares and their users', id: 'Folder SMB dan user-nya' } },
  { id: 'updates', glyph: glyph(CircleFadingArrowUp), color: ['#8e8e93', '#48484a'], group: 'tools', name: { en: 'System Updates', id: 'Pembaruan Sistem' }, text: { en: 'apt updates with a live log', id: 'Update apt dengan log langsung' } },
  { id: 'console', glyph: glyph(ScrollText), color: ['#4a4a4f', '#1c1c1e'], group: 'tools', name: { en: 'Log Viewer', id: 'Penampil Log' }, text: { en: 'The journal, by category or service', id: 'Journal per kategori atau layanan' } },
  { id: 'disks', glyph: glyph(HardDrive), color: ['#b8bcc6', '#5f6470'], group: 'tools', name: { en: 'Disk Manager', id: 'Pengelola Disk' }, text: { en: 'SMART, formatting, merged storage', id: 'SMART, format, penyimpanan gabungan' } },
  { id: 'network', glyph: glyph(Network), color: ['#64d2ff', '#0a6cff'], group: 'network', name: { en: 'Network Tools', id: 'Alat Jaringan' }, text: { en: 'Ping, DNS, connections, firewall', id: 'Ping, DNS, koneksi, firewall' } },
  { id: 'scheduler', glyph: glyph(CalendarClock), color: ['#ff9f6b', '#e6501e'], group: 'tools', name: { en: 'Scheduled Tasks', id: 'Tugas Terjadwal' }, text: { en: 'Cron jobs and systemd timers', id: 'Cron dan timer systemd' } },
  { id: 'remux', glyph: glyph(ArrowRightLeft), color: ['#ffc25c', '#ff6a2b'], group: 'files', name: { en: 'Remux', id: 'Remux' }, text: { en: 'Convert video and sound with ffmpeg', id: 'Ubah format video dan suara dengan ffmpeg' } },
  { id: 'commands', glyph: glyph(BookMarked), color: ['#5eead4', '#0f8a7a'], group: 'tools', name: { en: 'Commands', id: 'Perintah' }, text: { en: 'Find a command by describing it', id: 'Cari perintah dengan menjelaskannya' } },
  { id: 'preview', glyph: glyph(Images), color: ['#7fd3ff', '#2f7bff'], group: 'files', name: { en: 'Image Viewer', id: 'Penampil Gambar' }, text: { en: 'Swipe through a folder of photos', id: 'Geser untuk lihat foto satu folder' } },
  { id: 'video', glyph: glyph(Film), color: ['#5a5a62', '#1c1c1e'], group: 'files', name: { en: 'Video Player', id: 'Pemutar Video' }, text: { en: 'Picks up where you left off', id: 'Lanjut dari terakhir ditonton' } },
  { id: 'backup', glyph: glyph(DatabaseBackup), color: ['#7ad3a0', '#1f8f5a'], group: 'network', name: { en: 'Backup', id: 'Backup' }, text: { en: 'Encrypted, to a disk or a cloud drive', id: 'Terenkripsi, ke disk atau cloud drive' } },
  { id: 'adblock', glyph: glyph(ShieldCheck), color: ['#ff8a80', '#e53935'], group: 'network', name: { en: 'Ad Blocking', id: 'Blokir Iklan' }, text: { en: 'AdGuard Home for the whole home', id: 'AdGuard Home untuk seisi rumah' } },
]
