// Search for the command book that understands what someone wants to do, in English or
// Indonesian: "cara lihat port yang terbuka", "disk penuh", "restart jellyfin". Offline and
// simple: filler words are dropped, words are matched with their synonyms in both languages,
// common Indonesian affixes and English endings are trimmed, small typos are forgiven, and
// results are ranked by how much of the sentence they cover.

export interface SearchDoc {
  title: string
  command: string
  keywords: string
  note?: string
  category?: string
}

// Words that carry no meaning in a question.
const STOP = new Set(
  (
    'a an the to of in on at for with and or my me i is are be can could do does how what which where why want need please ' +
    'it this that from into by using use show me let lets ' +
    'aku saya gue gw kamu mau ingin pengen pingin cara gimana bagaimana gmn yang yg di ke dari untuk buat utk dengan dgn ' +
    'apa ini itu dong sih ya yah deh kok bisa tolong mohon bisakah gak nggak ga tidak tdk juga aja saja lagi nih tuh pakai pake ' +
    'kenapa mengapa why kok terus lalu berapa'
  ).split(' '),
)
// "show" and "lihat" are kept apart from STOP on purpose: they pick the read-only commands.
STOP.delete('show')

const SYNONYMS: string[][] = [
  ['lihat', 'cek', 'check', 'show', 'view', 'see', 'tampil', 'tampilkan', 'display', 'list', 'daftar', 'status', 'info', 'detail', 'pantau', 'watch', 'monitor', 'baca', 'read'],
  ['hapus', 'delete', 'remove', 'rm', 'buang', 'copot', 'uninstall', 'bersih', 'bersihkan', 'clean', 'cleanup', 'prune'],
  ['pasang', 'install', 'instal', 'tambah', 'add'],
  ['buat', 'bikin', 'create', 'make', 'new', 'baru'],
  ['jalankan', 'jalan', 'run', 'start', 'nyalakan', 'hidupkan', 'mulai', 'running'],
  ['hentikan', 'stop', 'matikan', 'berhenti', 'kill', 'shutdown', 'off'],
  ['restart', 'reboot', 'ulang', 'reload'],
  ['update', 'upgrade', 'perbarui', 'pembaruan', 'terbaru', 'latest'],
  ['ruang', 'space', 'storage', 'penyimpanan', 'kapasitas', 'capacity', 'sisa', 'free', 'kosong'],
  ['penuh', 'full'],
  ['ukuran', 'size', 'besar', 'big', 'large', 'gede', 'terbesar', 'biggest'],
  ['file', 'berkas', 'dokumen', 'files'],
  ['folder', 'direktori', 'directory', 'dir', 'folders'],
  ['proses', 'process', 'program', 'aplikasi', 'app', 'apps', 'processes'],
  ['memori', 'memory', 'ram'],
  ['jaringan', 'network', 'internet', 'koneksi', 'connection', 'wifi', 'lan', 'online'],
  ['pengguna', 'user', 'akun', 'account', 'users'],
  ['izin', 'permission', 'akses', 'access', 'hak', 'denied', 'ditolak'],
  ['paket', 'package', 'software', 'packages'],
  ['cari', 'search', 'find', 'temukan', 'grep', 'dimana', 'where', 'lokasi'],
  ['salin', 'copy', 'duplikat', 'kopi', 'backup'],
  ['pindah', 'move', 'pindahkan'],
  ['kompres', 'compress', 'zip', 'arsip', 'archive', 'bungkus', 'tar'],
  ['ekstrak', 'extract', 'unzip', 'unpack'],
  ['unduh', 'download', 'ambil'],
  ['unggah', 'upload', 'kirim', 'send', 'transfer'],
  ['waktu', 'time', 'jam', 'tanggal', 'date', 'clock'],
  ['suhu', 'temperature', 'panas', 'hot', 'heat'],
  ['kecepatan', 'speed', 'cepat'],
  ['lambat', 'slow', 'lemot', 'lelet', 'berat', 'heavy', 'nge-lag', 'lag'],
  ['alamat', 'address', 'ip'],
  ['password', 'sandi', 'katasandi', 'passwd'],
  ['layanan', 'service', 'servis', 'daemon', 'services'],
  ['jadwal', 'schedule', 'cron', 'otomatis', 'automatic', 'terjadwal', 'tiap', 'setiap', 'every'],
  ['blokir', 'block', 'deny', 'ban', 'tutup'],
  ['buka', 'open', 'allow', 'izinkan', 'terbuka'],
  ['kontainer', 'container', 'containers'],
  ['log', 'logs', 'catatan', 'journal'],
  ['riwayat', 'history', 'histori'],
  ['error', 'errors', 'gagal', 'failed', 'fail', 'rusak', 'broken', 'masalah', 'problem', 'crash', 'bermasalah'],
  ['video', 'film', 'movie'],
  ['suara', 'audio', 'sound', 'musik', 'music', 'lagu'],
  ['konversi', 'convert', 'ubah', 'change', 'ganti'],
  ['nama', 'name', 'rename'],
  ['kunci', 'key', 'lock'],
  ['pakai', 'dipakai', 'terpakai', 'kepake', 'kepakai', 'used', 'unused', 'idle'],
  ['server', 'komputer', 'computer', 'mesin', 'machine'],
  ['disk', 'hdd', 'ssd', 'drive', 'harddisk', 'hardisk'],
]

const GROUP = new Map<string, number>()
SYNONYMS.forEach((group, i) => group.forEach(w => GROUP.set(w, i)))
// "Look" words (lihat, cek, show…) say little: most commands show something. A command that
// doesn't mention one isn't marked down for it.
const LOOK = GROUP.get('lihat')!
const isLook = (w: string) => GROUP.get(w) === LOOK || GROUP.get(stem(w)) === LOOK

export const normalize = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()

const words = (s: string) => normalize(s).split(' ').filter(Boolean)

/**
 * Trims Indonesian affixes (melihat → lihat, hapuskan → hapus) and English endings. Prefixes come
 * off only what was typed: in the library's own words they are often part of the word
 * ("termasuk" isn't "masuk").
 */
export function stem(w: string, typed = true) {
  let s = w
  for (const suffix of ['nya', 'kan', 'lah', 'kah']) {
    if (s.length > suffix.length + 3 && s.endsWith(suffix)) {
      s = s.slice(0, -suffix.length)
      break
    }
  }
  for (const prefix of typed ? ['meng', 'meny', 'mem', 'men', 'me', 'di', 'ber', 'ter'] : []) {
    if (s.length > prefix.length + 3 && s.startsWith(prefix) && !GROUP.has(s)) {
      s = s.slice(prefix.length)
      break
    }
  }
  for (const suffix of ['ing', 'ed', 'es', 's']) {
    if (s.length > suffix.length + 3 && s.endsWith(suffix)) {
      s = s.slice(0, -suffix.length)
      break
    }
  }
  return s
}

// Levenshtein distance, giving up past 1 (all a typo is allowed).
function nearlySame(a: string, b: string) {
  if (Math.abs(a.length - b.length) > 1) return false
  let i = 0
  let j = 0
  let edits = 0
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      i++
      j++
      continue
    }
    if (++edits > 1) return false
    if (a.length > b.length) i++
    else if (b.length > a.length) j++
    else {
      i++
      j++
    }
  }
  return edits + (a.length - i) + (b.length - j) <= 1
}

interface Field {
  weight: number
  tokens: string[]
  stems: string[]
}

export interface Indexed<T> {
  item: T
  fields: Field[]
  title: string
  command: string
}

const field = (text: string, weight: number): Field => {
  const tokens = words(text)
  return { weight, tokens, stems: tokens.map(t => stem(t, false)) }
}

export function indexDocs<T>(items: T[], doc: (item: T) => SearchDoc): Indexed<T>[] {
  return items.map(item => {
    const d = doc(item)
    return {
      item,
      title: normalize(d.title),
      command: d.command.toLowerCase(),
      fields: [field(d.title, 3), field(d.command, 2.5), field(d.keywords, 2), field(d.note ?? '', 1), field(d.category ?? '', 1)],
    }
  })
}

// How well one query word matches a field (0 to the field's weight).
function matchWord(q: string, f: Field): number {
  const qs = stem(q)
  const group = GROUP.get(q) ?? GROUP.get(qs)
  const synonyms = group === undefined ? [] : SYNONYMS[group]
  let best = 0
  for (let k = 0; k < f.tokens.length; k++) {
    const t = f.tokens[k]
    const ts = f.stems[k]
    let quality = 0
    if (t === q || ts === qs) quality = 1
    else if (q.length >= 3 && (t.startsWith(q) || ts.startsWith(qs))) quality = 0.8
    else if (synonyms.includes(t) || synonyms.includes(ts)) quality = 0.85
    else if (q.length >= 5 && t.length >= 5 && nearlySame(q, t)) quality = 0.6
    if (quality > best) best = quality
    if (best === 1) break
  }
  return best * f.weight
}

/** Ranks the indexed items for a query; returns the ones that match, best first. */
export function search<T>(index: Indexed<T>[], query: string): T[] {
  return rank(index, query).map(s => s.item)
}

/**
 * search, with the scores, and the names in the query that matched nothing in each result (words
 * we don't know): in "restart nginx" the service's name, which a command with a blank can take.
 */
export function rank<T>(index: Indexed<T>[], query: string): { item: T; score: number; leftover: string[] }[] {
  const all = words(query)
  if (all.length === 0) return []
  const meaningful = all.filter(w => !STOP.has(w))
  const terms = meaningful.length ? meaningful : all
  const phrase = normalize(query)
  const raw = query.trim().toLowerCase()

  const scored: { item: T; score: number; leftover: string[] }[] = []
  for (const entry of index) {
    let total = 0
    let matched = 0
    const leftover: string[] = []
    for (const q of terms) {
      let best = 0
      for (const f of entry.fields) best = Math.max(best, matchWord(q, f))
      if (best > 0) matched++
      else leftover.push(q)
      total += best
    }
    // A command with a blank takes an unmatched name ("nginx", not a word we know) as its value,
    // so that counts for most of a match.
    const names = leftover.filter(w => !GROUP.has(w) && !GROUP.has(stem(w)))
    const credit = entry.command.includes('{{') ? Math.min(names.length, 1) * 0.7 : 0
    const looks = leftover.filter(isLook).length
    const coverage = terms.length === looks ? 0 : (matched + credit) / (terms.length - looks)
    // A single word may match; longer questions need at least half their words.
    if (matched === 0 || (terms.length > 1 && coverage < 0.5)) continue
    let score = total * coverage * coverage
    if (phrase.length >= 3 && entry.title.includes(phrase)) score += 4
    if (raw.length >= 3 && entry.command.includes(raw)) score += 6
    scored.push({ item: entry.item, score, leftover: names })
  }
  return scored.sort((a, b) => b.score - a.score)
}
