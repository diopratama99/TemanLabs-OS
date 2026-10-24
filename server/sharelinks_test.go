package main

import (
	"archive/zip"
	"bytes"
	"encoding/json"
	"io"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func linkServer(t *testing.T) (*server, *httptest.Server, string) {
	t.Helper()
	state := t.TempDir()
	s := &server{cfg: &Config{Root: "/", StateDir: state}, links: newShareLinks(state)}
	mux := http.NewServeMux()
	mux.HandleFunc("GET /s/{id}", s.handleLinkPage)
	mux.HandleFunc("POST /s/{id}", s.handleLinkPassword)
	mux.HandleFunc("GET /s/{id}/file", s.handleLinkFile)
	mux.HandleFunc("GET /s/{id}/zip", s.handleLinkZip)
	mux.HandleFunc("POST /s/{id}/upload", s.handleLinkUpload)
	ts := httptest.NewServer(mux)
	t.Cleanup(ts.Close)
	return s, ts, t.TempDir()
}

func makeLink(t *testing.T, s *server, body map[string]any) shareLinkView {
	t.Helper()
	w := call(t, s.handleCreateLink, "POST", "/api/links", body)
	if w.Code != http.StatusCreated {
		t.Fatalf("create: %d %s", w.Code, w.Body)
	}
	var v shareLinkView
	_ = json.Unmarshal(w.Body.Bytes(), &v)
	return v
}

func get(t *testing.T, c *http.Client, u string) (int, string) {
	t.Helper()
	res, err := c.Get(u)
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	b, _ := io.ReadAll(res.Body)
	return res.StatusCode, string(b)
}

func TestShareFolderLink(t *testing.T) {
	s, ts, dir := linkServer(t)
	_ = os.MkdirAll(filepath.Join(dir, "sub"), 0o755)
	_ = os.WriteFile(filepath.Join(dir, "a.txt"), []byte("hello"), 0o644)
	_ = os.WriteFile(filepath.Join(dir, "sub", "b.txt"), []byte("deep"), 0o644)
	_ = os.WriteFile(filepath.Join(dir, ".secret"), []byte("no"), 0o644)
	outside := filepath.Join(t.TempDir(), "outside.txt")
	_ = os.WriteFile(outside, []byte("private"), 0o644)
	_ = os.Symlink(outside, filepath.Join(dir, "link.txt"))

	l := makeLink(t, s, map[string]any{"path": dir})
	base := ts.URL + "/s/" + l.ID
	c := ts.Client()

	code, page := get(t, c, base)
	if code != 200 || !strings.Contains(page, "a.txt") || !strings.Contains(page, "sub") || strings.Contains(page, ".secret") {
		t.Fatalf("listing %d:\n%s", code, page)
	}
	if code, body := get(t, c, base+"/file?p=a.txt"); code != 200 || body != "hello" {
		t.Fatalf("file: %d %q", code, body)
	}
	if code, body := get(t, c, base+"/file?p=sub/b.txt"); code != 200 || body != "deep" {
		t.Fatalf("nested file: %d %q", code, body)
	}
	for _, p := range []string{"../../etc/passwd", "/etc/passwd", "link.txt", ".secret", "sub/../../x"} {
		if code, body := get(t, c, base+"/file?p="+url.QueryEscape(p)); code == 200 {
			t.Fatalf("%s was served: %q", p, body)
		}
	}
	// The zip has the visible files, nothing hidden and nothing from outside.
	code, z := get(t, c, base+"/zip")
	if code != 200 {
		t.Fatalf("zip: %d", code)
	}
	zr, err := zip.NewReader(bytes.NewReader([]byte(z)), int64(len(z)))
	if err != nil {
		t.Fatal(err)
	}
	var names []string
	for _, f := range zr.File {
		names = append(names, f.Name)
	}
	if strings.Join(names, ",") != "a.txt,sub/b.txt" {
		t.Fatalf("zip has %v", names)
	}
}

func TestShareLinkPasswordAndExpiry(t *testing.T) {
	s, ts, dir := linkServer(t)
	file := filepath.Join(dir, "report.pdf")
	_ = os.WriteFile(file, []byte("pdf"), 0o644)
	l := makeLink(t, s, map[string]any{"path": file, "password": "kopi"})
	base := ts.URL + "/s/" + l.ID
	c := ts.Client()
	if _, body := get(t, c, base+"/file"); body == "pdf" {
		t.Fatal("served without the password")
	}
	if _, page := get(t, c, base); !strings.Contains(page, `type="password"`) {
		t.Fatal("no password form")
	}
	jar := &cookieJar{}
	c.Jar = jar
	res, err := c.PostForm(base, url.Values{"password": {"teh"}})
	if err != nil {
		t.Fatal(err)
	}
	res.Body.Close()
	if _, body := get(t, c, base+"/file"); body == "pdf" {
		t.Fatal("served after a wrong password")
	}
	res, _ = c.PostForm(base, url.Values{"password": {"kopi"}})
	res.Body.Close()
	if code, body := get(t, c, base+"/file"); code != 200 || body != "pdf" {
		t.Fatalf("after the password: %d %q", code, body)
	}

	// Expired: 410, and nothing served.
	s.links.mu.Lock()
	past := time.Now().Add(-time.Minute)
	s.links.Links[0].Expires = &past
	s.links.mu.Unlock()
	if code, _ := get(t, c, base); code != http.StatusGone {
		t.Fatalf("expired page: %d", code)
	}
	if _, body := get(t, c, base+"/file"); body == "pdf" {
		t.Fatal("expired link served the file")
	}
	if code, _ := get(t, c, ts.URL+"/s/nope"); code != 404 {
		t.Fatalf("unknown link: %d", code)
	}
}

func TestShareUploadLink(t *testing.T) {
	s, ts, dir := linkServer(t)
	_ = os.WriteFile(filepath.Join(dir, "mine.txt"), []byte("x"), 0o644)
	l := makeLink(t, s, map[string]any{"path": dir, "upload": true})
	base := ts.URL + "/s/" + l.ID
	c := ts.Client()
	if _, page := get(t, c, base); strings.Contains(page, "mine.txt") {
		t.Fatal("upload page shows the folder's contents")
	}
	if _, body := get(t, c, base+"/file?p=mine.txt"); body == "x" {
		t.Fatal("upload link downloads")
	}
	var buf bytes.Buffer
	mw := multipart.NewWriter(&buf)
	for _, name := range []string{"photo.jpg", "mine.txt", "../evil.sh"} {
		part, _ := mw.CreateFormFile("file", name)
		_, _ = part.Write([]byte("data " + name))
	}
	mw.Close()
	res, err := c.Post(base+"/upload", mw.FormDataContentType(), &buf)
	if err != nil {
		t.Fatal(err)
	}
	res.Body.Close()
	if !strings.Contains(res.Request.URL.RawQuery, "sent=3") {
		t.Fatalf("redirected to %s", res.Request.URL)
	}
	for _, name := range []string{"photo.jpg", "mine (1).txt", "evil.sh"} {
		if _, err := os.Stat(filepath.Join(dir, name)); err != nil {
			t.Fatalf("%s not saved: %v", name, err)
		}
	}
	if data, _ := os.ReadFile(filepath.Join(dir, "mine.txt")); string(data) != "x" {
		t.Fatal("an upload replaced an existing file")
	}
	if _, err := os.Stat(filepath.Join(filepath.Dir(dir), "evil.sh")); err == nil {
		t.Fatal("upload escaped the folder")
	}
	if got := s.links.get(l.ID).Uploads; got != 3 {
		t.Fatalf("uploads counted: %d", got)
	}
}

func TestUploadLinkNeedsFolder(t *testing.T) {
	s, _, dir := linkServer(t)
	file := filepath.Join(dir, "f.txt")
	_ = os.WriteFile(file, nil, 0o644)
	if w := call(t, s.handleCreateLink, "POST", "/", map[string]any{"path": file, "upload": true}); w.Code != http.StatusBadRequest {
		t.Fatalf("upload link to a file: %d", w.Code)
	}
}

// cookieJar keeps cookies per path prefix well enough for one test server.
type cookieJar struct{ cookies []*http.Cookie }

func (j *cookieJar) SetCookies(_ *url.URL, cs []*http.Cookie) { j.cookies = append(j.cookies, cs...) }
func (j *cookieJar) Cookies(u *url.URL) []*http.Cookie {
	var out []*http.Cookie
	for _, c := range j.cookies {
		if strings.HasPrefix(u.Path, c.Path) {
			out = append(out, c)
		}
	}
	return out
}
