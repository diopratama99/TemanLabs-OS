package main

import (
	"html/template"
	"net/http"
	"strings"
)

// The pages a share link's visitor sees: one small self-contained HTML page, in English or
// Indonesian (by the browser's language), light or dark like the device.

type pageEntry struct {
	Name   string
	Size   string
	Href   string
	Folder bool
}

type pageData struct {
	ID, Host, Name, Title, Message, Expires string
	NeedPassword, Wrong                     bool
	Upload                                  bool
	Sent                                    string
	File                                    *pageEntry
	Folder                                  bool
	Sub, Up, Zip                            string
	Entries                                 []pageEntry
	T                                       map[string]string
}

var pageStrings = map[string]map[string]string{
	"en": {
		"lang": "en", "from": "Shared from %s", "download": "Download", "downloadAll": "Download All (zip)",
		"password": "Password", "open": "Open", "wrongPassword": "That password isn’t right.", "needPassword": "This link has a password.",
		"sendTitle": "Send files", "send": "Send", "choose": "Choose files", "sentN": "Sent. Thank you!", "sending": "Sending…",
		"sendHelp": "Files you send go into this folder. You can’t see what’s in it.", "until": "Available until %s",
		"empty": "This folder is empty.", "up": "Back", "gone": "Link not found", "goneText": "This link doesn’t exist, or it was turned off.",
		"missingText": "What this link shared isn’t there any more.", "expired": "Link expired", "expiredText": "This link has expired. Ask for a new one.",
		"slow": "Too many tries", "slowText": "Wait a few minutes, then try the password again.", "failed": "Sending failed. Try again.",
	},
	"id": {
		"lang": "id", "from": "Dibagikan dari %s", "download": "Unduh", "downloadAll": "Unduh Semua (zip)",
		"password": "Kata sandi", "open": "Buka", "wrongPassword": "Kata sandinya salah.", "needPassword": "Link ini memakai kata sandi.",
		"sendTitle": "Kirim file", "send": "Kirim", "choose": "Pilih file", "sentN": "Terkirim. Terima kasih!", "sending": "Mengirim…",
		"sendHelp": "File yang kamu kirim masuk ke folder ini. Isinya tidak bisa kamu lihat.", "until": "Tersedia sampai %s",
		"empty": "Folder ini kosong.", "up": "Kembali", "gone": "Link tidak ditemukan", "goneText": "Link ini tidak ada, atau sudah dimatikan.",
		"missingText": "Yang dibagikan link ini sudah tidak ada.", "expired": "Link kedaluwarsa", "expiredText": "Link ini sudah kedaluwarsa. Minta link yang baru.",
		"slow": "Terlalu banyak percobaan", "slowText": "Tunggu beberapa menit, lalu coba lagi.", "failed": "Gagal mengirim. Coba lagi.",
	},
}

func pageText(r *http.Request) map[string]string {
	if strings.HasPrefix(strings.ToLower(r.Header.Get("Accept-Language")), "id") {
		return pageStrings["id"]
	}
	return pageStrings["en"]
}

var linkTemplate = template.Must(template.New("link").Funcs(template.FuncMap{
	"f": func(format, v string) string { return strings.Replace(format, "%s", v, 1) },
}).Parse(`<!doctype html>
<html lang="{{.T.lang}}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>{{.Title}}</title>
<style>
:root { --bg: #f2f2f7; --card: #fff; --text: #1c1c1e; --dim: #6e6e73; --line: rgba(0,0,0,.08); --accent: #0a84ff; --field: #f2f2f7; }
@media (prefers-color-scheme: dark) { :root { --bg: #000; --card: #1c1c1e; --text: #f5f5f7; --dim: #98989d; --line: rgba(255,255,255,.1); --field: #2c2c2e; } }
* { box-sizing: border-box; }
body { margin: 0; min-height: 100vh; display: flex; align-items: flex-start; justify-content: center; padding: 48px 16px; background: var(--bg); color: var(--text); font: 15px/1.45 -apple-system, BlinkMacSystemFont, "Segoe UI", Inter, Roboto, sans-serif; }
main { width: min(560px, 100%); background: var(--card); border-radius: 20px; padding: 28px; box-shadow: 0 10px 40px rgba(0,0,0,.08); }
h1 { margin: 0 0 4px; font-size: 22px; word-break: break-word; }
.dim { color: var(--dim); font-size: 13px; margin: 0; }
.msg { margin: 16px 0 0; }
.btn { display: inline-flex; align-items: center; justify-content: center; gap: 6px; min-height: 40px; padding: 0 18px; border: 0; border-radius: 10px; background: var(--accent); color: #fff; font: inherit; font-weight: 600; text-decoration: none; cursor: pointer; }
.btn.alt { background: var(--field); color: var(--text); }
.row-actions { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 20px; }
ul { list-style: none; margin: 18px 0 0; padding: 0; border-top: 1px solid var(--line); }
li a { display: flex; gap: 10px; align-items: center; padding: 11px 2px; border-bottom: 1px solid var(--line); color: inherit; text-decoration: none; }
li a:hover { color: var(--accent); }
li .n { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
li .s { color: var(--dim); font-size: 13px; }
.ico { width: 20px; text-align: center; }
input[type=password] { width: 100%; height: 42px; margin-top: 14px; padding: 0 12px; border: 1px solid var(--line); border-radius: 10px; background: var(--field); color: var(--text); font: inherit; }
.err { color: #ff453a; font-size: 13px; margin: 8px 0 0; }
.ok { color: #30d158; font-weight: 600; margin: 16px 0 0; }
.drop { display: block; margin-top: 18px; padding: 26px 16px; border: 2px dashed var(--line); border-radius: 14px; text-align: center; color: var(--dim); cursor: pointer; }
.drop input { display: block; margin: 10px auto 0; max-width: 100%; }
progress { width: 100%; margin-top: 14px; display: none; }
footer { margin-top: 22px; color: var(--dim); font-size: 12px; }
</style>
</head>
<body>
<main>
<h1>{{.Title}}</h1>
{{if .Host}}<p class="dim">{{f .T.from .Host}}{{if .Expires}} · {{f .T.until .Expires}}{{end}}</p>{{end}}
{{if .Message}}<p class="msg">{{.Message}}</p>{{end}}

{{if .NeedPassword}}
<form method="post" action="/s/{{.ID}}">
<p class="msg">{{.T.needPassword}}</p>
<input type="password" name="password" placeholder="{{.T.password}}" autofocus required>
{{if .Wrong}}<p class="err">{{.T.wrongPassword}}</p>{{end}}
<div class="row-actions"><button class="btn">{{.T.open}}</button></div>
</form>
{{else if .Upload}}
<p class="msg">{{.T.sendHelp}}</p>
{{if .Sent}}<p class="ok">{{.T.sentN}}</p>{{end}}
<form id="up" method="post" action="/s/{{.ID}}/upload" enctype="multipart/form-data">
<label class="drop">{{.T.choose}}<input type="file" name="file" multiple required></label>
<progress id="bar" max="100" value="0"></progress>
<p class="err" id="fail" hidden>{{.T.failed}}</p>
<div class="row-actions"><button class="btn" id="go">{{.T.send}}</button></div>
</form>
<script>
// Sends with a progress bar; without scripts the form posts as usual.
const form = document.getElementById('up'), bar = document.getElementById('bar'), go = document.getElementById('go')
form.addEventListener('submit', e => {
  e.preventDefault()
  const xhr = new XMLHttpRequest()
  xhr.open('POST', form.action)
  xhr.upload.onprogress = p => { if (p.lengthComputable) bar.value = (p.loaded / p.total) * 100 }
  xhr.onload = () => { if (xhr.status < 400) location.href = xhr.responseURL || location.href; else fail() }
  xhr.onerror = fail
  function fail() { go.disabled = false; go.textContent = {{.T.send}}; document.getElementById('fail').hidden = false }
  bar.style.display = 'block'; go.disabled = true; go.textContent = {{.T.sending}}
  xhr.send(new FormData(form))
})
</script>
{{else if .File}}
<ul><li><a href="{{.File.Href}}"><span class="ico">📄</span><span class="n">{{.File.Name}}</span><span class="s">{{.File.Size}}</span></a></li></ul>
<div class="row-actions"><a class="btn" href="{{.File.Href}}">{{.T.download}}</a></div>
{{else if .Folder}}
{{if .Sub}}<p class="dim" style="margin-top:6px">/{{.Sub}}</p>{{end}}
<ul>
{{if .Up}}<li><a href="{{.Up}}"><span class="ico">↩︎</span><span class="n">{{.T.up}}</span></a></li>{{end}}
{{range .Entries}}<li><a href="{{.Href}}"><span class="ico">{{if .Folder}}📁{{else}}📄{{end}}</span><span class="n">{{.Name}}</span><span class="s">{{.Size}}</span></a></li>
{{else}}<li><a><span class="n dim">{{$.T.empty}}</span></a></li>{{end}}
</ul>
{{if .Entries}}<div class="row-actions"><a class="btn" href="{{.Zip}}">{{.T.downloadAll}}</a></div>{{end}}
{{end}}
<footer>TemanLabsOS</footer>
</main>
</body>
</html>`))

func linkPage(w http.ResponseWriter, status int, t map[string]string, data pageData) {
	data.T = t
	h := w.Header()
	h.Set("Content-Type", "text/html; charset=utf-8")
	h.Set("Cache-Control", "no-store")
	h.Set("X-Content-Type-Options", "nosniff")
	h.Set("Referrer-Policy", "no-referrer")
	h.Set("X-Frame-Options", "DENY")
	h.Set("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'self'; form-action 'self'; img-src 'self'")
	w.WriteHeader(status)
	_ = linkTemplate.Execute(w, data)
}
