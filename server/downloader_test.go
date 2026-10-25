package main

import (
	"context"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"slices"
	"strings"
	"testing"
	"time"
)

func TestPlatformAndStreams(t *testing.T) {
	for raw, want := range map[string][2]string{
		"https://www.twitch.tv/xqc":                {"twitch", "xqc"},
		"https://www.youtube.com/@LofiGirl/live":   {"youtube", "LofiGirl"},
		"https://kick.com/xqc":                     {"kick", "xqc"},
		"https://www.tiktok.com/@someone/live":     {"tiktok", "someone"},
		"https://m.youtube.com/channel/UC123/live": {"youtube", "UC123"},
		"https://example.com/watch/streamer?x=1":   {"example.com", "streamer"},
	} {
		p, n := platformOf(raw)
		if p != want[0] || n != want[1] {
			t.Errorf("%s → %s %s, want %v", raw, p, n, want)
		}
	}
	if streamsFor("720") != "720p60,720p,480p,best" || streamsFor("x") != "best" {
		t.Fatal("streams")
	}
	if ytdlpFormat("1080") != "bv*[height<=1080]+ba/b[height<=1080]/bv*+ba/b" || ytdlpFormat("best") != "bv*+ba/b" {
		t.Fatal("format")
	}
	if got := safeName(`a/b:c*?"d`+strings.Repeat("x", 200), 20); strings.ContainsAny(got, `/:*?"`) || len([]rune(got)) > 20 {
		t.Fatalf("safeName = %q", got)
	}
}

func TestChannelAddressesGetLive(t *testing.T) {
	s := &server{}
	for in, want := range map[string]string{
		"https://www.youtube.com/@LofiGirl":      "https://www.youtube.com/@LofiGirl/live",
		"https://www.tiktok.com/@someone/":       "https://www.tiktok.com/@someone/live",
		"https://www.youtube.com/@LofiGirl/live": "https://www.youtube.com/@LofiGirl/live",
		"https://www.twitch.tv/xqc":              "https://www.twitch.tv/xqc",
	} {
		c := &recChannel{}
		w := call(t, func(w http.ResponseWriter, r *http.Request) {
			if err := s.channelFromBody(r, c); err != nil {
				writeError(w, http.StatusBadRequest, err.Error())
			}
		}, "POST", "/", map[string]any{"url": in, "quality": "720", "auto": true})
		if w.Code != 200 || c.URL != want || c.Quality != "720" || !c.Auto {
			t.Errorf("%s → %d %+v", in, w.Code, c)
		}
	}
}

func siteNames(sites []cookieSiteInfo) []string {
	names := []string{}
	for _, c := range sites {
		names = append(names, c.Site)
	}
	return names
}

func TestCookiesAddUpBySite(t *testing.T) {
	state := t.TempDir()
	s := &server{cfg: &Config{StateDir: state}, dl: newDownloader(state)}
	put := func(text string) {
		t.Helper()
		if w := callBody(t, s.handleDownloadCookies, "PUT", strings.NewReader(text)); w.Code != http.StatusOK {
			t.Fatalf("put: %d %s", w.Code, w.Body)
		}
	}
	// Sign-in cookies are often HttpOnly ones, which aren't comments.
	put("# Netscape HTTP Cookie File\n#HttpOnly_.instagram.com\tTRUE\t/\tTRUE\t1999999999\tsessionid\told\n")
	put(".www.tiktok.com\tTRUE\t/\tTRUE\t1999999999\tsid_tt\tx\n.example.co.id\tTRUE\t/\tFALSE\t0\ta\tb\n")
	if got := siteNames(s.dl.cookieSites()); !slices.Equal(got, []string{"example.co.id", "instagram.com", "tiktok.com"}) || !s.dl.cookieSites()[1].SignedIn || s.dl.cookieSites()[0].SignedIn {
		t.Fatalf("sites: %v", got)
	}
	// A new file for a site replaces that site's cookies, and only those.
	put("#HttpOnly_.instagram.com\tTRUE\t/\tTRUE\t1999999999\tsessionid\tnew\n")
	data, _ := os.ReadFile(s.dl.cookies)
	if strings.Contains(string(data), "\told") || !strings.Contains(string(data), "\tnew") || !strings.Contains(string(data), "sid_tt") {
		t.Fatalf("merged:\n%s", data)
	}
	// Only the site asked for, from a file with others in it.
	w := httptest.NewRecorder()
	s.handleDownloadCookies(w, httptest.NewRequest("PUT", "/?site=x.com,twitter.com", strings.NewReader(".x.com\tTRUE\t/\tTRUE\t1999999999\tauth_token\tt\n.other.com\tTRUE\t/\tTRUE\t0\tq\tr\n")))
	if got := siteNames(s.dl.cookieSites()); w.Code != 200 || slices.Contains(got, "other.com") || !slices.Contains(got, "x.com") {
		t.Fatalf("only x.com: %d %v", w.Code, got)
	}
	w = httptest.NewRecorder()
	s.handleDownloadCookies(w, httptest.NewRequest("PUT", "/?site=tiktok.com", strings.NewReader(".x.com\tTRUE\t/\tTRUE\t0\ta\tb\n")))
	if w.Code != http.StatusBadRequest {
		t.Fatalf("no tiktok cookies in it: %d", w.Code)
	}
	w = httptest.NewRecorder()
	s.handleDownloadCookies(w, httptest.NewRequest("DELETE", "/?site=tiktok.com,x.com", nil))
	if got := siteNames(s.dl.cookieSites()); w.Code != http.StatusNoContent || !slices.Equal(got, []string{"example.co.id", "instagram.com"}) {
		t.Fatalf("after removing one: %d %v", w.Code, got)
	}
	w = httptest.NewRecorder()
	s.handleDownloadCookies(w, httptest.NewRequest("DELETE", "/", nil))
	if _, err := os.Stat(s.dl.cookies); !os.IsNotExist(err) {
		t.Fatalf("still there: %v", err)
	}
}

func TestCookiesMustBeNetscape(t *testing.T) {
	state := t.TempDir()
	s := &server{cfg: &Config{StateDir: state}, dl: newDownloader(state)}
	if w := call(t, s.handleDownloadCookies, "PUT", "/", nil); w.Code != http.StatusBadRequest {
		t.Fatalf("empty cookies: %d", w.Code)
	}
	r := strings.NewReader(".instagram.com\tTRUE\t/\tTRUE\t1999999999\tsessionid\tabc\n")
	w := callBody(t, s.handleDownloadCookies, "PUT", r)
	if w.Code != http.StatusOK || !strings.Contains(w.Body.String(), "instagram.com") {
		t.Fatalf("cookies: %d %s", w.Code, w.Body)
	}
	data, _ := os.ReadFile(s.dl.cookies)
	if !strings.HasPrefix(string(data), "# Netscape HTTP Cookie File\n") {
		t.Fatalf("saved %q", data)
	}
	if st, _ := os.Stat(s.dl.cookies); st.Mode().Perm() != 0o600 {
		t.Fatalf("mode %v", st.Mode())
	}
}

// liveTools points a test server at tools installed elsewhere (TL_TOOLS = a venv).
func liveTools(t *testing.T) *server {
	t.Helper()
	venv := os.Getenv("TL_TOOLS")
	if venv == "" {
		t.Skip("set TL_TOOLS to a venv with yt-dlp, gallery-dl and streamlink")
	}
	state := t.TempDir()
	_ = os.MkdirAll(filepath.Join(state, "tools"), 0o755)
	if err := os.Symlink(venv, filepath.Join(state, "tools", "venv")); err != nil {
		t.Fatal(err)
	}
	return &server{cfg: &Config{Root: "/", StateDir: state}, dl: newDownloader(state), recorder: newRecorder(state)}
}

func TestDownloadVideo(t *testing.T) {
	s := liveTools(t)
	folder := t.TempDir()
	it := &dlItem{ID: "t1", URL: "https://www.youtube.com/watch?v=jNQXAC9IVRw", Mode: "video", Quality: "480", Folder: folder, Status: "running", Files: []string{}}
	s.dl.Items = []*dlItem{it}
	s.download(it)
	if it.Status != "done" || len(it.Files) != 1 || it.Title != "Me at the zoo" || it.Site != "Youtube" {
		t.Fatalf("item: %+v", it)
	}
	if st, err := os.Stat(it.Files[0]); err != nil || st.Size() < 100_000 || !strings.HasSuffix(it.Files[0], ".mp4") {
		t.Fatalf("file %s: %v", it.Files[0], err)
	}
	// A link with nothing to download fails with the tool's own message.
	bad := &dlItem{ID: "t2", URL: "https://www.youtube.com/watch?v=00000000000", Mode: "video", Folder: folder, Status: "running", Files: []string{}}
	s.download(bad)
	if bad.Status != "failed" || bad.Error == "" {
		t.Fatalf("bad link: %+v", bad)
	}
}

func TestRecordLiveStream(t *testing.T) {
	s := liveTools(t)
	if os.Geteuid() != 0 {
		t.Skip("recording runs systemd-run: needs root")
	}
	url := "https://www.youtube.com/@LofiGirl/live"
	live, title, err := s.liveInfo(context.Background(), url)
	if err != nil || !live || title == "" {
		t.Fatalf("live %v %q %v", live, title, err)
	}
	if live, _, err := s.liveInfo(context.Background(), "https://www.twitch.tv/this_channel_does_not_exist_tl"); live || err != nil {
		t.Fatalf("offline channel: %v %v", live, err)
	}
	s.recorder.Folder = t.TempDir()
	c := &recChannel{ID: "c1", URL: url, Name: "Lofi Girl", Quality: "480"}
	s.recorder.Channels = []*recChannel{c}
	rec, err := s.startRecording(c, title)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { exec.Command("systemctl", "stop", rec.Unit).Run() })
	time.Sleep(25 * time.Second)
	if !unitActive(rec.Unit) {
		out, _ := exec.Command("journalctl", "-u", rec.Unit, "-n", "20", "--no-pager").Output()
		t.Fatalf("not recording:\n%s", out)
	}
	if st, err := os.Stat(rec.File); err != nil || st.Size() == 0 {
		t.Fatalf("nothing written yet: %v", err)
	}
	if err := exec.Command("systemctl", "stop", rec.Unit).Run(); err != nil {
		t.Fatal(err)
	}
	s.finishRecording(rec)
	if rec.Status != "done" || !strings.HasSuffix(rec.File, ".mp4") || rec.Bytes == 0 {
		t.Fatalf("recording: %+v", rec)
	}
	out, err := exec.Command("ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", rec.File).Output()
	if err != nil {
		t.Fatal(err)
	}
	t.Logf("recorded %s: %d bytes, %s s", filepath.Base(rec.File), rec.Bytes, strings.TrimSpace(string(out)))
}

func callBody(t *testing.T, h http.HandlerFunc, method string, body *strings.Reader) *httptest.ResponseRecorder {
	t.Helper()
	w := httptest.NewRecorder()
	h(w, httptest.NewRequest(method, "/", body))
	return w
}
