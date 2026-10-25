import { useEffect, useState } from 'react'
import { Check, ChevronRight, Copy, ExternalLink, Scale } from 'lucide-react'
import { api } from '../../api'
import type { CookieSite } from '../../api/types'
import { copyText } from '../../lib/clipboard'
import { language, tr, type Language } from '../../lib/i18n'
import LICENSE from '../../../LICENSE?raw'

// Settings → Privacy & Terms: what TemanLabsOS keeps and where it connects, the terms it's used
// under, and its license. Whole documents per language, rather than lines to translate.

interface LegalSection {
  heading: string
  paragraphs?: string[]
  /** Points, each a term and what it means. */
  items?: [string, string][]
}

interface LegalDoc {
  intro: string
  sections: LegalSection[]
  updated: string
}

const PRIVACY: Record<Language, LegalDoc> = {
  en: {
    intro:
      'TemanLabsOS runs on your own server, for you. It has no accounts with us and sends no analytics or usage data anywhere: nothing about you, your files or your server goes to the TemanLabsOS project. This page says what it keeps, and where it connects when you use a feature.',
    sections: [
      {
        heading: 'What stays on your server',
        paragraphs: [
          'TemanLabsOS keeps its data in /var/lib/temanlabsos on the server: your login (the password itself only as a hash), signed-in browsers, its settings, the download and recording lists, backup plans, share links and the history of the system graphs.',
          'Secrets are readable by the server’s administrator (root) alone: the cookies of signed-in sites, the backup recovery key, and passwords for other computers’ screens and for apps’ own logins. The browser never gets them back.',
          'Anyone with administrator access to the server can read all of this, as with any program running there.',
        ],
      },
      {
        heading: 'Cookies of signed-in sites',
        paragraphs: [
          'The Downloader and Live Recorder can use cookies you export from your browser (cookies.txt), for posts that only an account can see. Cookies work like being signed in: whoever has them can act as that account on that site. So:',
        ],
        items: [
          ['Where they are', '/var/lib/temanlabsos/tools/cookies.txt, readable by root alone.'],
          ['Who gets them', 'Only the site they belong to, when the download tools (yt-dlp, gallery-dl, streamlink) fetch from it, and Instagram when you press Check. Never anyone else.'],
          ['What the browser sees', 'Only which sites have cookies saved and whether one signs in, never the cookies themselves.'],
          ['Removing them', 'Per site in the Downloader’s settings, or all at once at the top of this page. Removing them here doesn’t sign the browser out; signing out in the browser ends them here too.'],
          ['Your account', 'Sites can limit or close accounts used by download tools, and some end a session that shows up on a server as well as in a browser. A second account kept for downloading keeps your own out of it.'],
        ],
      },
      {
        heading: 'Where the server connects',
        paragraphs: ['Only when you use the feature, and only to:'],
        items: [
          ['Software Update', 'GitHub, to check for and fetch TemanLabsOS releases.'],
          ['App Center', 'The app catalogues you add (the CasaOS store, community stores on GitHub) and app icons from cdn.jsdelivr.net; apps’ images from the registries they name, such as Docker Hub.'],
          ['Ad Blocking', 'Its block lists (HaGeZi, ABPindo and AdGuard’s, on GitHub). Lookups it doesn’t block go on to Google and Cloudflare DNS over HTTPS, as your devices’ lookups would to any DNS server.'],
          ['Downloader and Live Recorder', 'The sites of the links you give, Python’s package index (PyPI) to install their tools, and Codeberg for gallery-dl’s development version if you turn it on. Thumbnails come through the server.'],
          ['Backup', 'The disk or cloud drive you choose (through rclone); what’s sent there is encrypted with a key only your server holds.'],
          ['Remote Access', 'Tailscale, whose service connects your devices.'],
          ['System updates and Kubernetes', 'Your server’s package mirrors (apt) and the k3s installer, when you ask for them.'],
        ],
      },
      {
        heading: 'In your browser',
        paragraphs: [
          'Signing in leaves a cookie for this server’s session only (scripts can’t read it), and preferences such as language, look and window layout are kept in the browser’s own storage. Nothing tracks you across sites.',
        ],
      },
      {
        heading: 'Share links',
        paragraphs: [
          'Anyone with a share link reaches what was shared, and nothing else, until the link expires or is removed. A password on the link keeps it to those you tell.',
        ],
      },
    ],
    updated: 'Last updated 25 October 2026',
  },
  id: {
    intro:
      'TemanLabsOS berjalan di server milikmu sendiri, untukmu. Tidak ada akun di pihak kami dan tidak ada data analitik atau pemakaian yang dikirim ke mana pun: tidak ada informasi tentangmu, file-mu, atau server-mu yang sampai ke proyek TemanLabsOS. Halaman ini menjelaskan apa yang disimpan, dan ke mana server terhubung saat kamu memakai suatu fitur.',
    sections: [
      {
        heading: 'Yang tetap di server-mu',
        paragraphs: [
          'TemanLabsOS menyimpan datanya di /var/lib/temanlabsos di server: login-mu (kata sandinya hanya dalam bentuk hash), browser yang sedang login, pengaturan, daftar unduhan dan rekaman, rencana backup, tautan berbagi, serta riwayat grafik sistem.',
          'Data rahasia hanya bisa dibaca administrator server (root): cookies situs yang perlu login, kunci pemulihan backup, serta kata sandi layar komputer lain dan login aplikasi. Browser tidak pernah mendapatkannya kembali.',
          'Siapa pun yang punya akses administrator ke server bisa membaca semua ini, sama seperti program lain yang berjalan di sana.',
        ],
      },
      {
        heading: 'Cookies situs yang perlu login',
        paragraphs: [
          'Pengunduh dan Perekam Live bisa memakai cookies yang kamu ekspor dari browser (cookies.txt), untuk postingan yang hanya bisa dilihat dengan akun. Cookies sama seperti sedang login: siapa pun yang memegangnya bisa bertindak sebagai akun itu di situs tersebut. Karena itu:',
        ],
        items: [
          ['Lokasinya', '/var/lib/temanlabsos/tools/cookies.txt, hanya bisa dibaca root.'],
          ['Siapa yang menerimanya', 'Hanya situs pemilik cookies itu, saat alat unduh (yt-dlp, gallery-dl, streamlink) mengambil dari situs tersebut, dan Instagram saat kamu menekan Periksa. Tidak pernah pihak lain.'],
          ['Yang terlihat di browser', 'Hanya situs mana yang punya cookies dan apakah ada yang login, tidak pernah isi cookies-nya.'],
          ['Menghapusnya', 'Per situs di Pengaturan Pengunduh, atau semuanya sekaligus di bagian atas halaman ini. Menghapus di sini tidak membuat browser logout; logout di browser juga mengakhiri cookies di sini.'],
          ['Akunmu', 'Situs bisa membatasi atau menutup akun yang dipakai alat unduh, dan sebagian mengakhiri sesi yang muncul di server sekaligus di browser. Akun kedua khusus untuk mengunduh menjaga akun utamamu tetap aman.'],
        ],
      },
      {
        heading: 'Ke mana server terhubung',
        paragraphs: ['Hanya saat kamu memakai fiturnya, dan hanya ke:'],
        items: [
          ['Pembaruan Perangkat Lunak', 'GitHub, untuk memeriksa dan mengambil rilis TemanLabsOS.'],
          ['App Center', 'Katalog aplikasi yang kamu tambahkan (toko CasaOS, toko komunitas di GitHub) dan ikon aplikasi dari cdn.jsdelivr.net; image aplikasi dari registry yang disebutkannya, seperti Docker Hub.'],
          ['Pemblokir Iklan', 'Daftar blokirnya (HaGeZi, ABPindo, dan milik AdGuard, di GitHub). Pencarian nama yang tidak diblokir diteruskan ke DNS Google dan Cloudflare lewat HTTPS, seperti pencarian dari perangkatmu ke server DNS mana pun.'],
          ['Pengunduh dan Perekam Live', 'Situs dari tautan yang kamu berikan, indeks paket Python (PyPI) untuk memasang alatnya, dan Codeberg untuk versi pengembangan gallery-dl kalau kamu menyalakannya. Thumbnail diambil lewat server.'],
          ['Backup', 'Disk atau cloud drive pilihanmu (lewat rclone); yang dikirim ke sana dienkripsi dengan kunci yang hanya dipegang server-mu.'],
          ['Akses Jarak Jauh', 'Tailscale, yang layanannya menghubungkan perangkat-perangkatmu.'],
          ['Pembaruan sistem dan Kubernetes', 'Mirror paket server-mu (apt) dan installer k3s, saat kamu memintanya.'],
        ],
      },
      {
        heading: 'Di browser-mu',
        paragraphs: [
          'Login meninggalkan cookie untuk sesi server ini saja (tidak bisa dibaca skrip), dan preferensi seperti bahasa, tampilan, dan tata letak jendela disimpan di penyimpanan browser itu sendiri. Tidak ada yang melacakmu antar situs.',
        ],
      },
      {
        heading: 'Tautan berbagi',
        paragraphs: [
          'Siapa pun yang memegang tautan berbagi bisa membuka apa yang dibagikan, dan hanya itu, sampai tautannya kedaluwarsa atau dihapus. Kata sandi pada tautan membatasinya untuk orang yang kamu beri tahu.',
        ],
      },
    ],
    updated: 'Terakhir diperbarui 25 Oktober 2026',
  },
}

const TERMS: Record<Language, LegalDoc> = {
  en: {
    intro:
      'These terms cover your use of TemanLabsOS, the software and its apps. By installing or using it, you agree to them. They are written to be read; if one part doesn’t fit your situation, the rest still applies.',
    sections: [
      {
        heading: 'Using TemanLabsOS',
        paragraphs: [
          'You may install and use TemanLabsOS on servers you own or are allowed to manage, for yourself, your home or your organisation. Its source code is public on GitHub under the MIT License (the License tab): you may copy, change and pass it on, keeping its copyright notice.',
        ],
      },
      {
        heading: 'Your server, your responsibility',
        paragraphs: [
          'TemanLabsOS acts on the server with an administrator’s rights when you ask it to: it installs and removes software and apps, changes network and system settings, and can format disks and delete files. Keep backups of what matters, and check what an action will do before you confirm it.',
        ],
      },
      {
        heading: 'Downloading and recording',
        paragraphs: ['The Downloader and Live Recorder save what you point them at. You are responsible for what you save and what you do with it:'],
        items: [
          ['Rights', 'Save only what you own, what its creator allows, or what the law where you live lets you keep for yourself (in Indonesia, Law No. 28 of 2014 on Copyright).'],
          ['Sites’ terms', 'Many sites don’t allow automated downloading or recording; using these tools there may break their terms.'],
          ['Sharing', 'Don’t pass on other people’s content without their permission.'],
          ['Accounts and cookies', 'Add cookies only of accounts that are yours. Sites may limit or close accounts used with download tools; that risk is yours.'],
        ],
      },
      {
        heading: 'Other people’s software and services',
        paragraphs: [
          'TemanLabsOS installs and runs software made by others, each under its own license: among them yt-dlp, gallery-dl, streamlink and Deno (downloads), FFmpeg (video), restic and rclone (backups), Docker and k3s (apps), AdGuard Home (ad blocking) and Tailscale (remote access). Their terms apply to them. Site and product names belong to their owners; TemanLabsOS isn’t affiliated with or endorsed by them.',
        ],
      },
      {
        heading: 'No warranty',
        paragraphs: [
          'TemanLabsOS is provided “as is”, without warranties of any kind. As far as the law allows, its developers aren’t liable for any loss or damage from using it, including lost data, downtime, or accounts limited by other services.',
        ],
      },
      {
        heading: 'Changes',
        paragraphs: ['These terms may change with new versions of TemanLabsOS; the date below says which version you’re reading.'],
      },
    ],
    updated: 'Last updated 25 October 2026',
  },
  id: {
    intro:
      'Ketentuan ini mengatur pemakaian TemanLabsOS, perangkat lunak beserta aplikasinya. Dengan memasang atau memakainya, kamu menyetujuinya. Ketentuan ini ditulis untuk dibaca; kalau ada bagian yang tidak sesuai dengan keadaanmu, bagian lainnya tetap berlaku.',
    sections: [
      {
        heading: 'Memakai TemanLabsOS',
        paragraphs: [
          'Kamu boleh memasang dan memakai TemanLabsOS di server milikmu atau yang boleh kamu kelola, untuk dirimu, rumahmu, atau organisasimu. Kode sumbernya terbuka di GitHub dengan Lisensi MIT (tab Lisensi): kamu boleh menyalin, mengubah, dan membagikannya, asalkan pemberitahuan hak ciptanya tetap disertakan.',
        ],
      },
      {
        heading: 'Server-mu, tanggung jawabmu',
        paragraphs: [
          'TemanLabsOS bertindak di server dengan hak administrator saat kamu memintanya: memasang dan menghapus perangkat lunak dan aplikasi, mengubah pengaturan jaringan dan sistem, serta bisa memformat disk dan menghapus file. Simpan backup dari yang penting, dan periksa apa yang akan dilakukan suatu tindakan sebelum mengonfirmasinya.',
        ],
      },
      {
        heading: 'Mengunduh dan merekam',
        paragraphs: ['Pengunduh dan Perekam Live menyimpan apa yang kamu tunjuk. Kamu bertanggung jawab atas apa yang kamu simpan dan apa yang kamu lakukan dengannya:'],
        items: [
          ['Hak', 'Simpan hanya milikmu sendiri, yang diizinkan pembuatnya, atau yang menurut hukum di tempatmu boleh kamu simpan untuk dirimu sendiri (di Indonesia, Undang-Undang No. 28 Tahun 2014 tentang Hak Cipta).'],
          ['Ketentuan situs', 'Banyak situs tidak mengizinkan pengunduhan atau perekaman otomatis; memakai alat ini di sana bisa melanggar ketentuannya.'],
          ['Membagikan', 'Jangan menyebarkan konten milik orang lain tanpa izin mereka.'],
          ['Akun dan cookies', 'Tambahkan hanya cookies dari akun milikmu. Situs bisa membatasi atau menutup akun yang dipakai dengan alat unduh; risiko itu ada padamu.'],
        ],
      },
      {
        heading: 'Perangkat lunak dan layanan pihak lain',
        paragraphs: [
          'TemanLabsOS memasang dan menjalankan perangkat lunak buatan pihak lain, masing-masing dengan lisensinya sendiri: di antaranya yt-dlp, gallery-dl, streamlink, dan Deno (unduhan), FFmpeg (video), restic dan rclone (backup), Docker dan k3s (aplikasi), AdGuard Home (pemblokir iklan), serta Tailscale (akses jarak jauh). Ketentuan mereka berlaku untuk masing-masing. Nama situs dan produk adalah milik pemiliknya; TemanLabsOS tidak berafiliasi dengan atau didukung oleh mereka.',
        ],
      },
      {
        heading: 'Tanpa jaminan',
        paragraphs: [
          'TemanLabsOS disediakan “sebagaimana adanya”, tanpa jaminan apa pun. Sejauh diizinkan hukum, pengembangnya tidak bertanggung jawab atas kerugian atau kerusakan akibat pemakaiannya, termasuk data yang hilang, waktu henti, atau akun yang dibatasi layanan lain.',
        ],
      },
      {
        heading: 'Perubahan',
        paragraphs: ['Ketentuan ini bisa berubah bersama versi baru TemanLabsOS; tanggal di bawah menunjukkan versi yang sedang kamu baca.'],
      },
    ],
    updated: 'Terakhir diperbarui 25 Oktober 2026',
  },
}

function LegalDocument({ doc }: { doc: LegalDoc }) {
  return (
    <div className="legal">
      <p className="legal-lead">{doc.intro}</p>
      {doc.sections.map(s => (
        <section key={s.heading} className="group legal-card">
          <h4>{s.heading}</h4>
          {s.paragraphs?.map(p => <p key={p}>{p}</p>)}
          {s.items && (
            <dl>
              {s.items.map(([term, text]) => (
                <div key={term}>
                  <dt>{term}</dt>
                  <dd>{text}</dd>
                </div>
              ))}
            </dl>
          )}
        </section>
      ))}
      <p className="legal-updated">{doc.updated}</p>
    </div>
  )
}

const TABS = [
  { id: 'privacy', label: tr('Privacy') },
  { id: 'terms', label: tr('Terms of Use') },
  { id: 'license', label: tr('License') },
] as const

type Tab = (typeof TABS)[number]['id']

/** Settings → Privacy & Terms: the privacy notice (with the saved cookies to remove), the terms of use, and the license. */
export function PrivacyTermsSection() {
  const [tab, setTab] = useState<Tab>('privacy')
  return (
    <>
      <div className="segmented legal-tabs" role="tablist">
        {TABS.map(t => (
          <button key={t.id} type="button" role="tab" aria-selected={tab === t.id} className={tab === t.id ? 'is-active' : ''} onClick={() => setTab(t.id)}>
            {t.label}
          </button>
        ))}
      </div>
      {tab === 'privacy' && (
        <>
          <SavedCookies />
          <LegalDocument doc={PRIVACY[language]} />
        </>
      )}
      {tab === 'terms' && <LegalDocument doc={TERMS[language]} />}
      {tab === 'license' && <LicenseText />}
    </>
  )
}

function SavedCookies() {
  const [sites, setSites] = useState<CookieSite[] | null>(null)
  const [removing, setRemoving] = useState(false)
  const load = () => api.downloads().then(d => setSites(d.cookieSites ?? []), () => setSites([]))
  useEffect(() => {
    void load()
  }, [])
  return (
    <div className="group legal-cookies">
      <div className="row">
        <span>
          {tr('Saved cookies')}
          <small>{sites === null ? tr('Loading…') : sites.length ? sites.map(c => c.site).join(', ') : tr('None saved.')}</small>
        </span>
        <button
          className="btn"
          disabled={!sites?.length || removing}
          onClick={() => {
            setRemoving(true)
            api
              .removeDownloadCookies()
              .then(load)
              .finally(() => setRemoving(false))
          }}
        >
          {tr('Remove All')}
        </button>
      </div>
    </div>
  )
}

const REPO = 'https://github.com/diopratama99/TemanLabs-OS'

// What the MIT License comes to, in rows like the rest of Settings.
const MIT_SUMMARY: [string, string][] = [
  [tr('Use, change and share it'), tr('For any purpose, commercial ones too.')],
  [tr('Keep the notice'), tr('The copyright and license text go along with any copy.')],
  [tr('No warranty'), tr('It comes as it is; its authors aren’t liable for what happens with it.')],
]

// Other people's work: what ships inside TemanLabsOS, and what it installs when a feature asks.
const BUILT_IN: [string, string, string][] = [
  ['React', tr('The interface'), 'MIT'],
  ['Monaco Editor', tr('Code'), 'MIT'],
  ['xterm.js', tr('Terminal'), 'MIT'],
  ['Apache Guacamole', tr('Remote screens'), 'Apache-2.0'],
  ['Lucide', tr('Icons'), 'ISC'],
  ['Simple Icons', tr('Sites’ logos'), 'CC0-1.0'],
  ['Inter', tr('Typeface'), 'OFL-1.1'],
  ['coder/websocket · creack/pty', tr('Server connections and terminals'), 'ISC · MIT'],
  ['golang.org/x · yaml.v3', tr('Server libraries'), 'BSD-3-Clause · MIT'],
]
const INSTALLED: [string, string, string][] = [
  ['yt-dlp', tr('Downloader'), 'Unlicense'],
  ['gallery-dl', tr('Downloader'), 'GPL-2.0'],
  ['streamlink', tr('Live Recorder'), 'BSD-2-Clause'],
  ['Deno', tr('Downloader'), 'MIT'],
  ['FFmpeg', tr('Video and sound'), 'LGPL-2.1+'],
  ['restic · rclone', tr('Backup'), 'BSD-2-Clause · MIT'],
  ['Docker · k3s', tr('Apps and Kubernetes'), 'Apache-2.0'],
  ['AdGuard Home', tr('Ad Blocking'), 'GPL-3.0'],
  ['Tailscale', tr('Remote Access'), 'BSD-3-Clause'],
  ['guacd', tr('Remote screens'), 'Apache-2.0'],
]

function LicenseText() {
  const [copied, setCopied] = useState(false)
  const text = LICENSE.trim()
  const [, copyright, ...body] = text.split(/\n\s*\n/)
  return (
    <div className="legal">
      <div className="group lic-hero">
        <span className="lic-badge">
          <Scale size={22} />
        </span>
        <span className="lic-hero-text">
          <strong>{tr('MIT License')}</strong>
          <small>{copyright.replace('(c)', '©')} · {tr('Open source')}</small>
        </span>
        <a className="btn" href={`${REPO}/blob/master/LICENSE`} target="_blank" rel="noreferrer">
          <ExternalLink size={13} /> GitHub
        </a>
      </div>
      <div className="group lic-summary">
        {MIT_SUMMARY.map(([title, text]) => (
          <div key={title} className="row">
            <span>
              {title}
              <small>{text}</small>
            </span>
          </div>
        ))}
      </div>

      <details className="group lic-full">
        <summary>
          <ChevronRight size={14} /> {tr('Full license text')}
          <span className="tb-spacer" />
          <button
            type="button"
            className="btn"
            onClick={e => {
              e.preventDefault()
              void copyText(text).then(() => {
                setCopied(true)
                setTimeout(() => setCopied(false), 1500)
              })
            }}
          >
            {copied ? <Check size={13} /> : <Copy size={13} />} {copied ? tr('Copied') : tr('Copy')}
          </button>
        </summary>
        <div className="lic-text">
          <h5>MIT License</h5>
          <p>{copyright}</p>
          {body.map(p => (
            <p key={p.slice(0, 24)} className={p === p.toUpperCase() ? 'is-caps' : ''}>
              {p.replace(/\s*\n\s*/g, ' ')}
            </p>
          ))}
        </div>
      </details>

      <ThirdParty title={tr('Inside TemanLabsOS')} rows={BUILT_IN} />
      <ThirdParty title={tr('Installed when a feature needs it')} rows={INSTALLED} />
      <p className="legal-updated">{tr('Each keeps its own license; their names and logos belong to their owners.')}</p>
    </div>
  )
}

function ThirdParty({ title, rows }: { title: string; rows: [string, string, string][] }) {
  return (
    <section className="lic-third">
      <h4 className="lic-heading">{title}</h4>
      <div className="group">
        {rows.map(([name, what, license]) => (
          <div key={name} className="row">
            <span>
              {name}
              <small>{what}</small>
            </span>
            <span className="lic-pill">{license}</span>
          </div>
        ))}
      </div>
    </section>
  )
}
