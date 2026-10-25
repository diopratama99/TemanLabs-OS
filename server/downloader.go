package main

import (
	"bufio"
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"slices"
	"strconv"
	"strings"
	"sync"
	"syscall"
	"time"
)

// Downloader: links from YouTube, Instagram, X, TikTok, Facebook, Reddit and the hundreds of
// other sites yt-dlp knows, saved to a folder on the server. Videos (best or a chosen height),
// sound only, or photos and albums through gallery-dl, which also takes over when a link turns
// out to have no video (an Instagram photo post). Two at a time; the rest wait their turn.

const (
	downloadWorkers = 2
	maxDownloads    = 300
	defaultDLFolder = "/DATA/Downloads"
)

type dlItem struct {
	ID       string     `json:"id"`
	URL      string     `json:"url"`
	Mode     string     `json:"mode"`    // video, audio, photos, files (chosen from a list)
	Quality  string     `json:"quality"` // best, 2160, 1440, 1080, 720, 480
	Playlist bool       `json:"playlist"`
	Folder   string     `json:"folder"`
	Device   bool       `json:"device,omitempty"`  // for the browser's device, not the server's folders
	Expired  bool       `json:"expired,omitempty"` // its files for the device were removed
	Srcs     []dlSrc    `json:"srcs,omitempty"`    // a "files" download's files
	Status   string     `json:"status"`            // queued, running, done, failed, canceled
	Title    string     `json:"title,omitempty"`
	Site     string     `json:"site,omitempty"`
	Uploader string     `json:"uploader,omitempty"`
	Percent  float64    `json:"percent"`
	Size     string     `json:"size,omitempty"`
	Speed    string     `json:"speed,omitempty"`
	ETA      string     `json:"eta,omitempty"`
	Count    int        `json:"count,omitempty"` // items in a playlist or album
	Files    []string   `json:"files"`
	Error    string     `json:"error,omitempty"`
	Added    time.Time  `json:"added"`
	Finished *time.Time `json:"finished,omitempty"`

	cancel context.CancelFunc
}

type downloader struct {
	mu      sync.Mutex
	file    string
	cookies string
	Folder  string    `json:"folder"`
	Items   []*dlItem `json:"items"`
	wake    chan struct{}

	device  string                 // downloads for the device wait here
	thumbs  string                 // frames taken from videos for lists
	lists   map[string]*browseList // opened profiles and playlists
	avatars map[string]string      // profile pictures found, by site and user
	frames  chan struct{}          // ffmpeg runs for frames at a time
}

func newDownloader(stateDir string) *downloader {
	d := &downloader{
		file:    filepath.Join(stateDir, "downloads.json"),
		cookies: filepath.Join(stateDir, "tools", "cookies.txt"),
		device:  filepath.Join(stateDir, "tools", "device"),
		thumbs:  filepath.Join(stateDir, "tools", "thumbs"),
		wake:    make(chan struct{}, downloadWorkers),
		lists:   map[string]*browseList{},
		avatars: map[string]string{},
		frames:  make(chan struct{}, 2),
	}
	_ = os.RemoveAll(d.thumbs)
	if data, err := os.ReadFile(d.file); err == nil {
		_ = json.Unmarshal(data, d)
	}
	for _, it := range d.Items {
		// Interrupted by a restart: yt-dlp picks up its partial files where they were.
		if it.Status == "running" {
			it.Status = "queued"
		}
		if it.Files == nil {
			it.Files = []string{}
		}
	}
	return d
}

// save writes the list; the caller holds mu.
func (d *downloader) save() {
	data, err := json.MarshalIndent(d, "", "  ")
	if err != nil {
		return
	}
	tmp := d.file + ".tmp"
	if os.WriteFile(tmp, data, 0o600) == nil {
		_ = os.Rename(tmp, d.file)
	}
}

func (d *downloader) folder() string {
	if d.Folder != "" {
		return d.Folder
	}
	return defaultDLFolder
}

func (d *downloader) find(id string) *dlItem {
	for _, it := range d.Items {
		if it.ID == id {
			return it
		}
	}
	return nil
}

func (d *downloader) poke() {
	for range downloadWorkers {
		select {
		case d.wake <- struct{}{}:
		default:
		}
	}
}

func (s *server) runDownloads() {
	go s.expireDeviceFiles()
	for range downloadWorkers {
		go func() {
			for {
				s.dl.mu.Lock()
				var next *dlItem
				for _, it := range s.dl.Items {
					if it.Status == "queued" {
						next = it
						break
					}
				}
				if next != nil {
					next.Status = "running"
					next.Error = ""
					s.dl.save()
				}
				s.dl.mu.Unlock()
				if next == nil {
					<-s.dl.wake
					continue
				}
				s.download(next)
			}
		}()
	}
}

func dlID() string {
	b := make([]byte, 6)
	_, _ = rand.Read(b)
	return hex.EncodeToString(b)
}

// update changes an item under the lock.
func (s *server) dlUpdate(it *dlItem, fn func(it *dlItem), save bool) {
	s.dl.mu.Lock()
	defer s.dl.mu.Unlock()
	fn(it)
	if save {
		s.dl.save()
	}
}

// Messages that mean "this link has photos, not a video".
var noVideo = regexp.MustCompile(`(?i)no video|there is no video|unsupported url|no media found|not a video|requested format is not available|no formats`)

func (s *server) download(it *dlItem) {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	s.dlUpdate(it, func(it *dlItem) { it.cancel = cancel }, false)

	err := os.MkdirAll(it.Folder, 0o755)
	if err == nil {
		if !it.Device {
			s.chown(it.Folder)
		}
		switch it.Mode {
		case "files":
			err = s.runFiles(ctx, it)
		case "photos":
			err = s.runGalleryDL(ctx, it)
		default:
			err = s.runYTDLP(ctx, it)
			if err != nil && ctx.Err() == nil && it.Mode == "video" && noVideo.MatchString(err.Error()) {
				// Photos then: an Instagram or X post without a video.
				if gerr := s.runGalleryDL(ctx, it); gerr == nil {
					err = nil
				}
			}
		}
	}
	now := time.Now()
	s.dlUpdate(it, func(it *dlItem) {
		it.cancel = nil
		it.Finished = &now
		it.Speed, it.ETA = "", ""
		switch {
		case ctx.Err() != nil:
			it.Status = "canceled"
		case err != nil:
			it.Status, it.Error = "failed", err.Error()
		default:
			it.Status, it.Percent = "done", 100
		}
	}, true)
	if !it.Device {
		for _, f := range it.Files {
			s.chown(f)
		}
	}
}

func ytdlpFormat(q string) string {
	if n, err := strconv.Atoi(q); err == nil && n > 0 {
		return fmt.Sprintf("bv*[height<=%d]+ba/b[height<=%d]/bv*+ba/b", n, n)
	}
	return "bv*+ba/b"
}

// runTool runs a download tool, handing each line of its output to onLine and keeping its
// errors. Stopping sends it an interrupt, so it tidies up.
func (s *server) runTool(ctx context.Context, name string, args []string, onLine func(string)) error {
	cmd := exec.CommandContext(ctx, s.toolPath(name), args...)
	cmd.Env = s.toolEnv()
	cmd.Cancel = func() error { return cmd.Process.Signal(syscall.SIGINT) }
	cmd.WaitDelay = 10 * time.Second
	stdout, _ := cmd.StdoutPipe()
	stderr, _ := cmd.StderrPipe()
	if err := cmd.Start(); err != nil {
		return err
	}
	var errs []string
	var mu sync.Mutex
	done := make(chan struct{})
	go func() {
		sc := bufio.NewScanner(stderr)
		sc.Buffer(make([]byte, 64<<10), 1<<20)
		for sc.Scan() {
			line := strings.TrimSpace(sc.Text())
			if line == "" {
				continue
			}
			mu.Lock()
			errs = append(errs, line)
			if len(errs) > 20 {
				errs = errs[1:]
			}
			mu.Unlock()
		}
		close(done)
	}()
	sc := bufio.NewScanner(stdout)
	sc.Buffer(make([]byte, 64<<10), 1<<20)
	for sc.Scan() {
		onLine(sc.Text())
	}
	err := cmd.Wait()
	<-done
	if err == nil || ctx.Err() != nil {
		return err
	}
	mu.Lock()
	defer mu.Unlock()
	return toolErr(errs, err)
}

func (s *server) runYTDLP(ctx context.Context, it *dlItem) error {
	args := []string{
		"--newline", "-q", "--progress", "--no-warnings", "--windows-filenames", "--no-mtime",
		"--progress-template", "download:PROG %(progress._percent_str)s\t%(progress._total_bytes_str)s\t%(progress._total_bytes_estimate_str)s\t%(progress._speed_str)s\t%(progress._eta_str)s",
		"--print", "before_dl:INFO %(title)s\t%(extractor_key)s\t%(uploader|)s",
		"--print", "after_move:FILE %(filepath)s",
		"-o", filepath.Join(it.Folder, "%(title).150B [%(id)s].%(ext)s"),
	}
	if it.Playlist {
		args = append(args, "--yes-playlist")
	} else {
		args = append(args, "--no-playlist")
	}
	args = append(args, s.cookieArgs()...)
	if it.Mode == "audio" {
		args = append(args, "-x", "--audio-format", "mp3", "--audio-quality", "0")
	} else {
		args = append(args, "-f", ytdlpFormat(it.Quality), "--merge-output-format", "mp4")
	}
	args = append(args, "--", it.URL)
	lastSave := time.Now()
	return s.runTool(ctx, "yt-dlp", args, func(line string) {
		switch {
		case strings.HasPrefix(line, "INFO "):
			f := strings.Split(strings.TrimPrefix(line, "INFO "), "\t")
			s.dlUpdate(it, func(it *dlItem) {
				it.Count++
				if it.Title == "" || !it.Playlist {
					it.Title = f[0]
				}
				if len(f) > 1 {
					it.Site = f[1]
				}
				if len(f) > 2 && f[2] != "NA" {
					it.Uploader = f[2]
				}
			}, true)
		case strings.HasPrefix(line, "PROG "):
			f := strings.Split(strings.TrimPrefix(line, "PROG "), "\t")
			s.dlUpdate(it, func(it *dlItem) {
				if p, err := strconv.ParseFloat(strings.TrimSuffix(strings.TrimSpace(f[0]), "%"), 64); err == nil {
					it.Percent = p
				}
				if len(f) > 4 {
					size := strings.TrimSpace(f[1])
					if size == "NA" {
						size = "~" + strings.TrimSpace(f[2])
					}
					it.Size, it.Speed, it.ETA = clean(size), clean(f[3]), clean(f[4])
				}
			}, time.Since(lastSave) > 5*time.Second)
			if time.Since(lastSave) > 5*time.Second {
				lastSave = time.Now()
			}
		case strings.HasPrefix(line, "FILE "):
			s.dlUpdate(it, func(it *dlItem) { it.Files = append(it.Files, strings.TrimPrefix(line, "FILE ")) }, true)
		}
	})
}

func clean(v string) string {
	v = strings.TrimSpace(v)
	if v == "NA" || v == "~NA" || v == "Unknown" {
		return ""
	}
	return v
}

func (s *server) runGalleryDL(ctx context.Context, it *dlItem) error {
	args := append([]string{"--directory", it.Folder}, s.cookieArgs()...)
	if !it.Playlist {
		// One post, not everything on a profile page.
		args = append(args, "--range", "1-50")
	}
	args = append(args, "--", it.URL)
	err := s.runTool(ctx, "gallery-dl", args, func(line string) {
		// It prints each file it saves; "# path" for ones already there.
		p := strings.TrimSpace(strings.TrimPrefix(line, "# "))
		if !strings.HasPrefix(p, "/") {
			return
		}
		s.dlUpdate(it, func(it *dlItem) {
			if !slices.Contains(it.Files, p) {
				it.Files = append(it.Files, p)
			}
			it.Count = len(it.Files)
			if it.Title == "" {
				it.Title = filepath.Base(p)
			}
		}, true)
	})
	if err == nil && len(it.Files) == 0 {
		return errors.New("nothing to download on this page")
	}
	return err
}

// ----- HTTP -----

func (s *server) handleDownloads(w http.ResponseWriter, r *http.Request) {
	s.dl.mu.Lock()
	defer s.dl.mu.Unlock()
	items := []*dlItem{}
	for i := len(s.dl.Items) - 1; i >= 0; i-- {
		items = append(items, s.dl.Items[i])
	}
	res := map[string]any{"folder": s.dl.folder(), "cookies": false, "cookieSites": []cookieSiteInfo{}, "items": items}
	if info, err := os.Stat(s.dl.cookies); err == nil {
		res["cookies"], res["cookieSites"], res["cookiesAt"] = true, s.dl.cookieSites(), info.ModTime()
	}
	writeJSON(w, http.StatusOK, res)
}

func (s *server) handleAddDownloads(w http.ResponseWriter, r *http.Request) {
	var body struct {
		URLs     []string `json:"urls"`
		Mode     string   `json:"mode"`
		Quality  string   `json:"quality"`
		Playlist bool     `json:"playlist"`
		Folder   string   `json:"folder"`
		Device   bool     `json:"device"`
	}
	if decodeJSON(r, &body) != nil {
		writeError(w, http.StatusBadRequest, "invalid request")
		return
	}
	if !s.toolsInstalled() {
		writeError(w, http.StatusConflict, "install the download tools first")
		return
	}
	if body.Mode != "audio" && body.Mode != "photos" {
		body.Mode = "video"
	}
	folder := body.Folder
	if folder == "" {
		s.dl.mu.Lock()
		folder = s.dl.folder()
		s.dl.mu.Unlock()
	}
	full, err := s.resolve(folder)
	if err != nil {
		writeFSError(w, err)
		return
	}
	var add []*dlItem
	for _, raw := range body.URLs {
		raw = strings.TrimSpace(raw)
		if raw == "" {
			continue
		}
		u, err := url.Parse(raw)
		if err != nil || (u.Scheme != "http" && u.Scheme != "https") || u.Host == "" {
			writeError(w, http.StatusBadRequest, "not a link: "+raw)
			return
		}
		it := s.dl.newItem(raw, body.Mode, body.Quality, body.Device, full)
		it.Playlist = body.Playlist
		add = append(add, it)
	}
	if len(add) == 0 {
		writeError(w, http.StatusBadRequest, "paste one or more links")
		return
	}
	s.dl.mu.Lock()
	s.dl.Items = append(s.dl.Items, add...)
	s.dl.trim()
	s.dl.save()
	s.dl.mu.Unlock()
	s.dl.poke()
	writeJSON(w, http.StatusCreated, add)
}

func (s *server) handleDownloadAction(w http.ResponseWriter, r *http.Request) {
	id, action := r.PathValue("id"), r.PathValue("action")
	s.dl.mu.Lock()
	it := s.dl.find(id)
	if it == nil {
		s.dl.mu.Unlock()
		writeError(w, http.StatusNotFound, "no such download")
		return
	}
	switch action {
	case "cancel":
		if it.cancel != nil {
			it.cancel()
		} else if it.Status == "queued" {
			it.Status = "canceled"
		}
	case "retry":
		if it.Status == "failed" || it.Status == "canceled" {
			it.Status, it.Error, it.Percent, it.Finished = "queued", "", 0, nil
		}
	default:
		s.dl.mu.Unlock()
		writeError(w, http.StatusBadRequest, "unknown action")
		return
	}
	s.dl.save()
	s.dl.mu.Unlock()
	s.dl.poke()
	w.WriteHeader(http.StatusNoContent)
}

// handleRemoveDownload takes a download off the list, with its files if asked.
func (s *server) handleRemoveDownload(w http.ResponseWriter, r *http.Request) {
	s.dl.mu.Lock()
	defer s.dl.mu.Unlock()
	i := slices.IndexFunc(s.dl.Items, func(it *dlItem) bool { return it.ID == r.PathValue("id") })
	if i < 0 {
		writeError(w, http.StatusNotFound, "no such download")
		return
	}
	it := s.dl.Items[i]
	if it.cancel != nil {
		it.cancel()
	}
	s.dl.forget(it)
	if r.URL.Query().Get("files") == "1" && !it.Device {
		for _, f := range it.Files {
			if full, err := s.resolve(f); err == nil {
				_ = os.Remove(full)
			}
		}
	}
	s.dl.Items = slices.Delete(s.dl.Items, i, i+1)
	s.dl.save()
	w.WriteHeader(http.StatusNoContent)
}

func (s *server) handleClearDownloads(w http.ResponseWriter, r *http.Request) {
	s.dl.mu.Lock()
	defer s.dl.mu.Unlock()
	s.dl.Items = slices.DeleteFunc(s.dl.Items, func(it *dlItem) bool {
		if it.Status == "queued" || it.Status == "running" {
			return false
		}
		s.dl.forget(it)
		return true
	})
	s.dl.save()
	w.WriteHeader(http.StatusNoContent)
}

func (s *server) handleDownloadSettings(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Folder string `json:"folder"`
	}
	if decodeJSON(r, &body) != nil {
		writeError(w, http.StatusBadRequest, "invalid request")
		return
	}
	full, err := s.resolve(body.Folder)
	if err != nil {
		writeFSError(w, err)
		return
	}
	s.dl.mu.Lock()
	defer s.dl.mu.Unlock()
	s.dl.Folder = full
	s.dl.save()
	w.WriteHeader(http.StatusNoContent)
}

// Cookies, in the cookies.txt (Netscape) format browser extensions export: one per line,
// seven fields apart by tabs; "#HttpOnly_" in front marks one scripts can't read, not a comment.

func cookieLine(line string) (domain string, ok bool) {
	if strings.HasPrefix(line, "#HttpOnly_") {
		line = strings.TrimPrefix(line, "#HttpOnly_")
	} else if strings.HasPrefix(line, "#") {
		return "", false
	}
	fields := strings.Split(line, "\t")
	if len(fields) < 7 || fields[0] == "" {
		return "", false
	}
	return cookieSite(fields[0]), true
}

// cookieSite is the site a cookie's domain belongs to: www.instagram.com → instagram.com.
func cookieSite(domain string) string {
	labels := strings.Split(strings.Trim(strings.ToLower(domain), "."), ".")
	n := 2
	// A country's second level, as in example.co.id or example.com.au.
	if len(labels) >= 3 && len(labels[len(labels)-1]) == 2 && len(labels[len(labels)-2]) <= 3 {
		n = 3
	}
	if len(labels) > n {
		labels = labels[len(labels)-n:]
	}
	return strings.Join(labels, ".")
}

// The cookies that mean someone is signed in, on the sites people most often save from.
var loginCookies = []string{"sessionid", "auth_token", "c_user", "sid_tt", "LOGIN_INFO", "__Secure-3PSID", "SAPISID", "reddit_session", "token_v2"}

type cookieSiteInfo struct {
	Site     string `json:"site"`
	Count    int    `json:"count"`
	SignedIn bool   `json:"signedIn"` // has a sign-in cookie, not just a visitor's
}

// cookieSites lists the sites the saved cookies are for.
func (d *downloader) cookieSites() []cookieSiteInfo {
	data, err := os.ReadFile(d.cookies)
	if err != nil {
		return nil
	}
	sites := []cookieSiteInfo{}
	for _, line := range strings.Split(strings.ReplaceAll(string(data), "\r\n", "\n"), "\n") {
		site, ok := cookieLine(line)
		if !ok {
			continue
		}
		i := slices.IndexFunc(sites, func(c cookieSiteInfo) bool { return c.Site == site })
		if i < 0 {
			sites = append(sites, cookieSiteInfo{Site: site})
			i = len(sites) - 1
		}
		sites[i].Count++
		if fields := strings.Split(line, "\t"); slices.Contains(loginCookies, fields[5]) && fields[6] != "" {
			sites[i].SignedIn = true
		}
	}
	slices.SortFunc(sites, func(a, b cookieSiteInfo) int { return strings.Compare(a.Site, b.Site) })
	return sites
}

// writeCookies keeps these cookie lines, or removes the file when there are none.
func (d *downloader) writeCookies(lines []string) error {
	if len(lines) == 0 {
		err := os.Remove(d.cookies)
		if errors.Is(err, os.ErrNotExist) {
			return nil
		}
		return err
	}
	if err := os.MkdirAll(filepath.Dir(d.cookies), 0o700); err != nil {
		return err
	}
	text := "# Netscape HTTP Cookie File\n" + strings.Join(lines, "\n") + "\n"
	return os.WriteFile(d.cookies, []byte(text), 0o600)
}

// handleDownloadCookies adds the sites in a cookies.txt to the ones saved (a site in both is
// replaced by the new file's), for posts that need a signed-in account; ?site= (one or more,
// apart by commas) takes only those sites' from the file. DELETE removes those sites, or all.
func (s *server) handleDownloadCookies(w http.ResponseWriter, r *http.Request) {
	var kept []string
	if old, err := os.ReadFile(s.dl.cookies); err == nil {
		for _, line := range strings.Split(strings.ReplaceAll(string(old), "\r\n", "\n"), "\n") {
			if _, ok := cookieLine(line); ok {
				kept = append(kept, line)
			}
		}
	}
	drop := func(sites []string) {
		kept = slices.DeleteFunc(kept, func(line string) bool {
			site, _ := cookieLine(line)
			return slices.Contains(sites, site)
		})
	}
	if r.Method == http.MethodDelete {
		if only := r.URL.Query().Get("site"); only != "" {
			drop(strings.Split(only, ","))
		} else {
			kept = nil
		}
		if err := s.dl.writeCookies(kept); err != nil {
			writeError(w, http.StatusInternalServerError, err.Error())
			return
		}
		w.WriteHeader(http.StatusNoContent)
		return
	}
	data, err := io.ReadAll(io.LimitReader(r.Body, 4<<20))
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	var lines, sites []string
	var only []string
	if q := r.URL.Query().Get("site"); q != "" {
		only = strings.Split(q, ",")
	}
	for _, line := range strings.Split(strings.ReplaceAll(string(data), "\r\n", "\n"), "\n") {
		if site, ok := cookieLine(line); ok && (only == nil || slices.Contains(only, site)) {
			lines = append(lines, line)
			if !slices.Contains(sites, site) {
				sites = append(sites, site)
			}
		}
	}
	if len(lines) == 0 && only != nil {
		writeError(w, http.StatusBadRequest, "this file has no cookies for "+strings.Join(only, " or ")+": export them while that site is open")
		return
	}
	if len(lines) == 0 {
		writeError(w, http.StatusBadRequest, "that isn't a cookies.txt file: export it in Netscape format (e.g. with the “Get cookies.txt LOCALLY” extension)")
		return
	}
	drop(sites)
	if err := s.dl.writeCookies(append(kept, lines...)); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	slices.Sort(sites)
	writeJSON(w, http.StatusOK, map[string]any{"sites": sites})
}
