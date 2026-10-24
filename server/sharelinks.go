package main

import (
	"archive/zip"
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"mime"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"

	"golang.org/x/crypto/bcrypt"
)

// Share links: a file or folder anyone with the link can download, or a folder they can upload
// into, without signing in. Each link can expire and have a password. Visitors get plain pages
// served from /s/<id>, outside the desktop.

type shareLink struct {
	ID      string     `json:"id"`
	Path    string     `json:"path"`
	Upload  bool       `json:"upload"`
	Created time.Time  `json:"created"`
	Expires *time.Time `json:"expires,omitempty"`
	// bcrypt; empty for no password.
	PassHash  string `json:"passHash,omitempty"`
	Downloads int    `json:"downloads"`
	Uploads   int    `json:"uploads"`
}

func (l *shareLink) expired() bool { return l.Expires != nil && time.Now().After(*l.Expires) }

// shareLinkView is a link as the desktop shows it (no password hash).
type shareLinkView struct {
	ID          string     `json:"id"`
	Path        string     `json:"path"`
	Name        string     `json:"name"`
	Folder      bool       `json:"folder"`
	Upload      bool       `json:"upload"`
	Created     time.Time  `json:"created"`
	Expires     *time.Time `json:"expires,omitempty"`
	Expired     bool       `json:"expired"`
	HasPassword bool       `json:"hasPassword"`
	Downloads   int        `json:"downloads"`
	Uploads     int        `json:"uploads"`
	// The item is gone (deleted or moved since).
	Missing bool `json:"missing,omitempty"`
}

type shareLinks struct {
	mu   sync.Mutex
	file string
	// The address links are given out with, when the server is reachable from the internet
	// under another one (a Cloudflare Tunnel, Tailscale Funnel); empty for the desktop's own.
	BaseURL string       `json:"baseUrl"`
	Links   []*shareLink `json:"links"`
	limiter *loginLimiter
}

func newShareLinks(stateDir string) *shareLinks {
	st := &shareLinks{file: filepath.Join(stateDir, "links.json"), limiter: newLoginLimiter()}
	if data, err := os.ReadFile(st.file); err == nil {
		_ = json.Unmarshal(data, st)
	}
	return st
}

// save writes the file; the caller holds mu.
func (st *shareLinks) save() error {
	data, err := json.MarshalIndent(st, "", "  ")
	if err != nil {
		return err
	}
	tmp := st.file + ".tmp"
	if err := os.WriteFile(tmp, data, 0o600); err != nil {
		return err
	}
	return os.Rename(tmp, st.file)
}

func (st *shareLinks) get(id string) *shareLink {
	st.mu.Lock()
	defer st.mu.Unlock()
	for _, l := range st.Links {
		if subtle.ConstantTimeCompare([]byte(l.ID), []byte(id)) == 1 {
			c := *l
			return &c
		}
	}
	return nil
}

func (st *shareLinks) count(id string, upload bool, n int) {
	st.mu.Lock()
	defer st.mu.Unlock()
	for _, l := range st.Links {
		if l.ID == id {
			if upload {
				l.Uploads += n
			} else {
				l.Downloads += n
			}
			_ = st.save()
			return
		}
	}
}

func viewOf(l *shareLink) shareLinkView {
	v := shareLinkView{ID: l.ID, Path: l.Path, Name: filepath.Base(l.Path), Upload: l.Upload, Created: l.Created, Expires: l.Expires,
		Expired: l.expired(), HasPassword: l.PassHash != "", Downloads: l.Downloads, Uploads: l.Uploads}
	if info, err := os.Stat(l.Path); err != nil {
		v.Missing = true
	} else {
		v.Folder = info.IsDir()
	}
	return v
}

// ----- The desktop's side -----

func (s *server) handleListLinks(w http.ResponseWriter, r *http.Request) {
	s.links.mu.Lock()
	links := make([]*shareLink, len(s.links.Links))
	copy(links, s.links.Links)
	base := s.links.BaseURL
	s.links.mu.Unlock()
	views := []shareLinkView{}
	for i := len(links) - 1; i >= 0; i-- {
		views = append(views, viewOf(links[i]))
	}
	writeJSON(w, http.StatusOK, map[string]any{"baseUrl": base, "links": views})
}

func (s *server) handleCreateLink(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Path     string `json:"path"`
		Upload   bool   `json:"upload"`
		Hours    int    `json:"hours"`
		Password string `json:"password"`
	}
	if decodeJSON(r, &body) != nil {
		writeError(w, http.StatusBadRequest, "invalid request")
		return
	}
	full, err := s.resolve(body.Path)
	if err != nil {
		writeFSError(w, err)
		return
	}
	info, err := os.Stat(full)
	if err != nil {
		writeFSError(w, err)
		return
	}
	if body.Upload && !info.IsDir() {
		writeError(w, http.StatusBadRequest, "files can only be sent into a folder")
		return
	}
	b := make([]byte, 16)
	_, _ = rand.Read(b)
	l := &shareLink{ID: base64.RawURLEncoding.EncodeToString(b), Path: full, Upload: body.Upload, Created: time.Now()}
	if body.Hours > 0 {
		t := time.Now().Add(time.Duration(body.Hours) * time.Hour)
		l.Expires = &t
	}
	if body.Password != "" {
		hash, err := bcrypt.GenerateFromPassword([]byte(body.Password), bcrypt.DefaultCost)
		if err != nil {
			writeError(w, http.StatusBadRequest, err.Error())
			return
		}
		l.PassHash = string(hash)
	}
	s.links.mu.Lock()
	s.links.Links = append(s.links.Links, l)
	err = s.links.save()
	s.links.mu.Unlock()
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusCreated, viewOf(l))
}

func (s *server) handleDeleteLink(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	s.links.mu.Lock()
	defer s.links.mu.Unlock()
	kept := s.links.Links[:0]
	for _, l := range s.links.Links {
		if l.ID != id {
			kept = append(kept, l)
		}
	}
	s.links.Links = kept
	if err := s.links.save(); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *server) handleLinkSettings(w http.ResponseWriter, r *http.Request) {
	var body struct {
		BaseURL string `json:"baseUrl"`
	}
	if decodeJSON(r, &body) != nil {
		writeError(w, http.StatusBadRequest, "invalid request")
		return
	}
	base := strings.TrimRight(strings.TrimSpace(body.BaseURL), "/")
	if base != "" {
		if u, err := url.Parse(base); err != nil || (u.Scheme != "http" && u.Scheme != "https") || u.Host == "" {
			writeError(w, http.StatusBadRequest, "enter an address such as https://files.example.com")
			return
		}
	}
	s.links.mu.Lock()
	defer s.links.mu.Unlock()
	s.links.BaseURL = base
	if err := s.links.save(); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// ----- The visitor's side -----

// linkCookie proves the password was given: only the server knows the hash it's made from.
func linkCookie(l *shareLink) (name, value string) {
	sum := sha256.Sum256([]byte(l.ID + "\x00" + l.PassHash))
	return "tl_link_" + l.ID[:8], hex.EncodeToString(sum[:])
}

func unlocked(r *http.Request, l *shareLink) bool {
	if l.PassHash == "" {
		return true
	}
	name, want := linkCookie(l)
	c, err := r.Cookie(name)
	return err == nil && subtle.ConstantTimeCompare([]byte(c.Value), []byte(want)) == 1
}

// openLink finds a usable link, or answers with a page saying why not.
func (s *server) openLink(w http.ResponseWriter, r *http.Request) *shareLink {
	l := s.links.get(r.PathValue("id"))
	t := pageText(r)
	switch {
	case l == nil:
		linkPage(w, http.StatusNotFound, t, pageData{Title: t["gone"], Message: t["goneText"]})
		return nil
	case l.expired():
		linkPage(w, http.StatusGone, t, pageData{Title: t["expired"], Message: t["expiredText"]})
		return nil
	}
	if _, err := os.Stat(l.Path); err != nil {
		linkPage(w, http.StatusNotFound, t, pageData{Title: t["gone"], Message: t["missingText"]})
		return nil
	}
	return l
}

// within resolves rel inside the shared folder, refusing anything (a symlink too) that leads out.
func within(base, rel string) (string, error) {
	realBase, err := filepath.EvalSymlinks(base)
	if err != nil {
		return "", err
	}
	full := filepath.Join(base, filepath.Clean("/"+rel))
	real, err := filepath.EvalSymlinks(full)
	if err != nil {
		return "", err
	}
	if real != realBase && !strings.HasPrefix(real, realBase+"/") {
		return "", errOutsideRoot
	}
	return full, nil
}

// hiddenFromVisitors: dotfiles and the Trash stay private in a shared folder.
func hiddenFromVisitors(name string) bool { return strings.HasPrefix(name, ".") }

func (s *server) handleLinkPage(w http.ResponseWriter, r *http.Request) {
	l := s.openLink(w, r)
	if l == nil {
		return
	}
	t := pageText(r)
	info, _ := os.Stat(l.Path)
	data := pageData{ID: l.ID, Host: hostLabel(), Name: filepath.Base(l.Path)}
	if l.Expires != nil {
		data.Expires = l.Expires.Format("2 Jan 2006, 15:04")
	}
	if !unlocked(r, l) {
		data.Title, data.NeedPassword, data.Wrong = data.Name, true, r.URL.Query().Get("wrong") == "1"
		linkPage(w, http.StatusOK, t, data)
		return
	}
	switch {
	case l.Upload:
		data.Title, data.Upload = data.Name, true
		data.Sent = r.URL.Query().Get("sent")
	case !info.IsDir():
		data.Title, data.File = data.Name, &pageEntry{Name: data.Name, Size: humanSize(info.Size()), Href: "/s/" + l.ID + "/file"}
	default:
		rel := strings.Trim(r.URL.Query().Get("p"), "/")
		dir, err := within(l.Path, rel)
		st, statErr := os.Stat(dir)
		if err != nil || statErr != nil || !st.IsDir() {
			linkPage(w, http.StatusNotFound, t, pageData{Title: t["gone"], Message: t["missingText"]})
			return
		}
		data.Title, data.Folder = data.Name, true
		data.Zip = "/s/" + l.ID + "/zip?p=" + url.QueryEscape(rel)
		if rel != "" {
			data.Sub = rel
			data.Up = "/s/" + l.ID + "?p=" + url.QueryEscape(filepath.Dir("/" + rel)[1:])
		}
		items, _ := os.ReadDir(dir)
		for _, d := range items {
			if hiddenFromVisitors(d.Name()) {
				continue
			}
			child := strings.TrimPrefix(rel+"/"+d.Name(), "/")
			e := pageEntry{Name: d.Name()}
			if fi, err := os.Stat(filepath.Join(dir, d.Name())); err == nil && fi.IsDir() {
				e.Folder, e.Href = true, "/s/"+l.ID+"?p="+url.QueryEscape(child)
			} else {
				if err == nil {
					e.Size = humanSize(fi.Size())
				}
				e.Href = "/s/" + l.ID + "/file?p=" + url.QueryEscape(child)
			}
			data.Entries = append(data.Entries, e)
		}
		sort.Slice(data.Entries, func(i, j int) bool {
			if data.Entries[i].Folder != data.Entries[j].Folder {
				return data.Entries[i].Folder
			}
			return strings.ToLower(data.Entries[i].Name) < strings.ToLower(data.Entries[j].Name)
		})
	}
	linkPage(w, http.StatusOK, t, data)
}

func (s *server) handleLinkPassword(w http.ResponseWriter, r *http.Request) {
	l := s.openLink(w, r)
	if l == nil {
		return
	}
	key := clientAddr(r) + " " + l.ID
	if s.links.limiter.blocked(key) {
		t := pageText(r)
		linkPage(w, http.StatusTooManyRequests, t, pageData{Title: t["slow"], Message: t["slowText"]})
		return
	}
	if l.PassHash == "" || bcrypt.CompareHashAndPassword([]byte(l.PassHash), []byte(r.FormValue("password"))) != nil {
		s.links.limiter.fail(key)
		http.Redirect(w, r, "/s/"+l.ID+"?wrong=1", http.StatusSeeOther)
		return
	}
	s.links.limiter.reset(key)
	name, value := linkCookie(l)
	http.SetCookie(w, &http.Cookie{Name: name, Value: value, Path: "/s/" + l.ID, MaxAge: 86400, HttpOnly: true, SameSite: http.SameSiteLaxMode, Secure: r.TLS != nil})
	http.Redirect(w, r, "/s/"+l.ID, http.StatusSeeOther)
}

func attachment(w http.ResponseWriter, name string) {
	w.Header().Set("Content-Disposition", mime.FormatMediaType("attachment", map[string]string{"filename": name}))
}

func (s *server) handleLinkFile(w http.ResponseWriter, r *http.Request) {
	l := s.openLink(w, r)
	if l == nil || l.Upload {
		if l != nil {
			http.NotFound(w, r)
		}
		return
	}
	if !unlocked(r, l) {
		http.Redirect(w, r, "/s/"+l.ID, http.StatusSeeOther)
		return
	}
	target := l.Path
	if info, err := os.Stat(l.Path); err == nil && info.IsDir() {
		var err error
		if target, err = within(l.Path, r.URL.Query().Get("p")); err != nil || hiddenFromVisitors(filepath.Base(target)) {
			http.NotFound(w, r)
			return
		}
	}
	f, err := os.Open(target)
	if err != nil {
		http.NotFound(w, r)
		return
	}
	defer f.Close()
	info, err := f.Stat()
	if err != nil || info.IsDir() {
		http.NotFound(w, r)
		return
	}
	// Count a download once, not for every range request a player makes.
	if r.Header.Get("Range") == "" || strings.HasPrefix(r.Header.Get("Range"), "bytes=0-") {
		s.links.count(l.ID, false, 1)
	}
	attachment(w, info.Name())
	http.ServeContent(w, r, info.Name(), info.ModTime(), f)
}

// Already-compressed files go into the zip as they are; squeezing them again costs time for nothing.
var storedKinds = map[string]bool{"image": true, "video": true, "audio": true, "archive": true}

func (s *server) handleLinkZip(w http.ResponseWriter, r *http.Request) {
	l := s.openLink(w, r)
	if l == nil {
		return
	}
	if l.Upload || !unlocked(r, l) {
		http.Redirect(w, r, "/s/"+l.ID, http.StatusSeeOther)
		return
	}
	dir, err := within(l.Path, r.URL.Query().Get("p"))
	if st, statErr := os.Stat(dir); err != nil || statErr != nil || !st.IsDir() {
		http.NotFound(w, r)
		return
	}
	s.links.count(l.ID, false, 1)
	w.Header().Set("Content-Type", "application/zip")
	attachment(w, filepath.Base(dir)+".zip")
	zw := zip.NewWriter(w)
	defer zw.Close()
	_ = filepath.WalkDir(dir, func(p string, d fs.DirEntry, err error) error {
		if err != nil || r.Context().Err() != nil {
			return r.Context().Err()
		}
		if p != dir && hiddenFromVisitors(d.Name()) {
			if d.IsDir() {
				return filepath.SkipDir
			}
			return nil
		}
		if d.IsDir() || !d.Type().IsRegular() {
			return nil
		}
		info, err := d.Info()
		if err != nil {
			return nil
		}
		rel, _ := filepath.Rel(dir, p)
		hdr, _ := zip.FileInfoHeader(info)
		hdr.Name = filepath.ToSlash(rel)
		hdr.Method = zip.Deflate
		if storedKinds[kindOf(d.Name(), false)] {
			hdr.Method = zip.Store
		}
		out, err := zw.CreateHeader(hdr)
		if err != nil {
			return err
		}
		f, err := os.Open(p)
		if err != nil {
			return nil
		}
		defer f.Close()
		_, err = io.Copy(out, f)
		return err
	})
}

func (s *server) handleLinkUpload(w http.ResponseWriter, r *http.Request) {
	l := s.openLink(w, r)
	if l == nil {
		return
	}
	if !l.Upload || !unlocked(r, l) {
		http.Redirect(w, r, "/s/"+l.ID, http.StatusSeeOther)
		return
	}
	r.Body = http.MaxBytesReader(w, r.Body, maxUploadBytes)
	reader, err := r.MultipartReader()
	if err != nil {
		http.Error(w, "expected a multipart upload", http.StatusBadRequest)
		return
	}
	sent := 0
	for {
		part, err := reader.NextPart()
		if errors.Is(err, io.EOF) {
			break
		}
		if err != nil {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}
		original := filepath.Base(part.FileName())
		if part.FormName() != "file" || !validName(original) || hiddenFromVisitors(original) {
			continue
		}
		ext := filepath.Ext(original)
		stem := strings.TrimSuffix(original, ext)
		name := uniqueName(l.Path, original, func(n int) string { return fmt.Sprintf("%s (%d)%s", stem, n-1, ext) })
		target := filepath.Join(l.Path, name)
		f, err := os.OpenFile(target, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0o644)
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		_, copyErr := io.Copy(f, part)
		if closeErr := f.Close(); copyErr != nil || closeErr != nil {
			os.Remove(target)
			http.Error(w, "upload failed", http.StatusBadRequest)
			return
		}
		s.chown(target)
		sent++
	}
	s.links.count(l.ID, true, sent)
	http.Redirect(w, r, fmt.Sprintf("/s/%s?sent=%d", l.ID, sent), http.StatusSeeOther)
}

func hostLabel() string {
	name, _ := os.Hostname()
	return name
}

func humanSize(n int64) string {
	const unit = 1000
	if n < unit {
		return fmt.Sprintf("%d B", n)
	}
	div, exp := int64(unit), 0
	for m := n / unit; m >= unit; m /= unit {
		div *= unit
		exp++
	}
	return fmt.Sprintf("%.1f %cB", float64(n)/float64(div), "kMGTPE"[exp])
}
