package main

import (
	"archive/zip"
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"strconv"
	"strings"
	"testing"
)

func TestGalleryEntries(t *testing.T) {
	// An Instagram carousel's second photo.
	e := galleryEntry("https://scontent.cdninstagram.com/v/t51/abc_n.jpg?stp=1", map[string]any{
		"extension": "jpg", "filename": "abc_n", "post_shortcode": "DAbC12", "num": 2.0,
		"display_url": "https://scontent.cdninstagram.com/v/t51/abc_n.jpg?stp=1", "description": "Sunset", "date": "2026-10-01 10:00:00",
	})
	if e.Kind != "image" || e.name != "DAbC12_2.jpg" || e.Group != "DAbC12" || e.Title != "Sunset" || e.src == "" || e.thumb == "" {
		t.Fatalf("instagram photo: %+v", e)
	}
	// An X photo shows a small copy in the grid.
	e = galleryEntry("https://pbs.twimg.com/media/XyZ?format=jpg&name=orig", map[string]any{"extension": "jpg", "filename": "XyZ", "tweet_id": 123.0})
	if !strings.Contains(e.thumb, "name=small") || e.Group != "123" || e.name != "XyZ.jpg" {
		t.Fatalf("x photo: %+v", e)
	}
	// A video gallery-dl leaves to yt-dlp is queued as a page.
	e = galleryEntry("ytdl:https://v.redd.it/abc", map[string]any{"extension": "mp4"})
	if e.Kind != "video" || e.page != "https://v.redd.it/abc" || e.src != "" {
		t.Fatalf("ytdl video: %+v", e)
	}
	// A clip without a thumbnail still gets one, taken from the video.
	l := &browseList{}
	l.add(galleryEntry("https://video.example/clip.mp4", map[string]any{"extension": "mp4", "filename": "clip"}))
	if !l.Entries[0].Thumb || l.Entries[0].Kind != "video" || l.Entries[0].thumb != "" {
		t.Fatalf("clip: %+v", l.Entries[0])
	}
	if !usesGallery("www.instagram.com") || !usesGallery("x.com") || usesGallery("www.youtube.com") || usesGallery("fox.com") {
		t.Fatal("usesGallery")
	}
}

func TestProfileTabs(t *testing.T) {
	for raw, want := range map[string][3]string{
		"https://www.instagram.com/natgeo/":                          {"posts", "https://www.instagram.com/natgeo/posts/", "@natgeo"},
		"https://instagram.com/natgeo/reels/":                        {"reels", "https://www.instagram.com/natgeo/reels/", "@natgeo"},
		"https://www.instagram.com/stories/natgeo/":                  {"stories", "https://www.instagram.com/stories/natgeo/", "@natgeo"},
		"https://x.com/NASA":                                         {"media", "https://x.com/NASA/media", "@NASA"},
		"https://twitter.com/NASA/tweets":                            {"tweets", "https://x.com/NASA/tweets", "@NASA"},
		"https://www.tiktok.com/@nasa":                               {"posts", "https://www.tiktok.com/@nasa/posts", "@nasa"},
		"https://bsky.app/profile/bsky.app/video":                    {"video", "https://bsky.app/profile/bsky.app/video", "@bsky.app"},
		"https://www.youtube.com/@NASA/streams":                      {"streams", "https://www.youtube.com/@NASA/streams", "@NASA"},
		"https://www.facebook.com/zuck":                              {"photos", "https://www.facebook.com/zuck/photos", ""},
		"https://web.facebook.com/profile.php?id=4&sk=photos_albums": {"photos_albums", "https://www.facebook.com/4/photos_albums", ""},
		"https://m.youtube.com/channel/UC123":                        {"videos", "https://www.youtube.com/channel/UC123/videos", ""},
	} {
		u, _ := url.Parse(raw)
		p := profileOf(u)
		if p == nil || p.tab != want[0] || p.urls[p.tab] != want[1] || p.handle != want[2] {
			t.Errorf("%s → %+v, want %v", raw, p, want)
		}
	}
	// Posts, videos and other pages aren't profiles.
	for _, raw := range []string{"https://www.instagram.com/p/DAbC12/", "https://www.instagram.com/reel/DAbC12/", "https://x.com/NASA/status/1", "https://x.com/i/lists/1", "https://www.tiktok.com/@nasa/video/123", "https://www.youtube.com/watch?v=abc", "https://www.facebook.com/watch/?v=1", "https://www.facebook.com/groups/x", "https://www.youtube.com/playlist?list=PL1", "https://example.com/user"} {
		u, _ := url.Parse(raw)
		if p := profileOf(u); p != nil {
			t.Errorf("%s is a profile: %+v", raw, p)
		}
	}
}

func browse(t *testing.T, s *server, body map[string]any) *browseList {
	t.Helper()
	w := call(t, s.handleBrowse, "POST", "/", body)
	if w.Code != http.StatusOK {
		t.Fatalf("browse %v: %d %s", body, w.Code, w.Body)
	}
	var l browseList
	_ = json.Unmarshal(w.Body.Bytes(), &l)
	return &l
}

func pathCall(t *testing.T, h http.HandlerFunc, method string, body any, values map[string]string) *httptest.ResponseRecorder {
	t.Helper()
	var buf bytes.Buffer
	if body != nil {
		_ = json.NewEncoder(&buf).Encode(body)
	}
	r := httptest.NewRequest(method, "/", &buf)
	for k, v := range values {
		r.SetPathValue(k, v)
	}
	w := httptest.NewRecorder()
	h(w, r)
	return w
}

func TestBrowseChannelAndProfile(t *testing.T) {
	s := liveTools(t)

	// A YouTube channel: its videos, a page at a time, with thumbnails.
	yt := browse(t, s, map[string]any{"url": "https://www.youtube.com/@NASA"})
	if !strings.HasSuffix(yt.URL, "/videos") || yt.Shape != "wide" || len(yt.Entries) != browsePage || !yt.More || yt.Entries[0].Title == "" || !yt.Entries[0].Page {
		t.Fatalf("channel: %s %s %d entries, more %v", yt.URL, yt.Shape, len(yt.Entries), yt.More)
	}
	// As a profile: named after the channel, with its picture and tabs.
	if yt.Title != "NASA" || yt.Handle != "@NASA" || !yt.Avatar || yt.Followers == 0 || yt.Tab != "videos" || len(yt.Tabs) != 3 {
		t.Fatalf("channel profile: %q %q avatar %v followers %d tab %q %v", yt.Title, yt.Handle, yt.Avatar, yt.Followers, yt.Tab, yt.Tabs)
	}
	if w := pathCall(t, s.handleBrowseThumb, "GET", nil, map[string]string{"list": yt.ID, "index": "avatar"}); w.Code != 200 || !strings.HasPrefix(w.Header().Get("Content-Type"), "image/") {
		t.Fatalf("avatar: %d", w.Code)
	}
	shorts := browse(t, s, map[string]any{"url": "https://www.youtube.com/@NASA", "tab": "shorts"})
	if shorts.Tab != "shorts" || shorts.Shape != "tall" || len(shorts.Entries) == 0 || !shorts.Avatar || !strings.HasSuffix(shorts.URL, "/shorts") {
		t.Fatalf("shorts: %s %s %d", shorts.URL, shorts.Shape, len(shorts.Entries))
	}
	more := browse(t, s, map[string]any{"list": yt.ID})
	if len(more.Entries) != 2*browsePage || more.Entries[browsePage].Index != browsePage {
		t.Fatalf("next page: %d entries", len(more.Entries))
	}
	w := pathCall(t, s.handleBrowseThumb, "GET", nil, map[string]string{"list": yt.ID, "index": "0"})
	if w.Code != 200 || !strings.HasPrefix(w.Header().Get("Content-Type"), "image/") || w.Body.Len() < 1000 {
		t.Fatalf("thumb: %d %s", w.Code, w.Header().Get("Content-Type"))
	}

	// A Bluesky profile (gallery-dl): files, fetched as they are, for this device.
	bs := browse(t, s, map[string]any{"url": "https://bsky.app/profile/bsky.app"})
	if bs.Shape != "square" || len(bs.Entries) == 0 || bs.Uploader == "" || !bs.Avatar || bs.Tab != "media" || bs.Handle != "@bsky.app" {
		t.Fatalf("profile: %+v", bs)
	}
	var picks []int
	for _, e := range s.dl.lists[bs.ID].Entries {
		if e.src != "" && len(picks) < 2 {
			picks = append(picks, e.Index)
		}
	}
	if len(picks) < 2 {
		t.Fatalf("not enough files: %d entries", len(bs.Entries))
	}
	if bs.Entries[picks[0]].Kind == "video" {
		w := pathCall(t, s.handleBrowseThumb, "GET", nil, map[string]string{"list": bs.ID, "index": strconv.Itoa(picks[0])})
		if w.Code != 200 {
			t.Errorf("video frame: %d %s", w.Code, w.Body)
		}
	}
	w = pathCall(t, s.handleBrowsePick, "POST", map[string]any{"picks": picks, "device": true}, map[string]string{"list": bs.ID})
	if w.Code != http.StatusCreated || len(s.dl.Items) != 1 {
		t.Fatalf("pick: %d %s", w.Code, w.Body)
	}
	it := s.dl.Items[0]
	if it.Mode != "files" || len(it.Srcs) != 2 || !it.Device || !strings.HasPrefix(it.Folder, s.dl.device) {
		t.Fatalf("item: %+v", it)
	}
	it.Status = "running"
	s.download(it)
	if it.Status != "done" || len(it.Files) != 2 {
		t.Fatalf("download: %+v", it)
	}
	w = pathCall(t, s.handleDownloadFile, "GET", nil, map[string]string{"id": it.ID})
	zr, err := zip.NewReader(bytes.NewReader(w.Body.Bytes()), int64(w.Body.Len()))
	if w.Code != 200 || err != nil || len(zr.File) != 2 || !strings.Contains(w.Header().Get("Content-Disposition"), ".zip") {
		t.Fatalf("zip: %d %v", w.Code, err)
	}
	t.Logf("%s: %s, %s (%d bytes zipped)", bs.Title, zr.File[0].Name, zr.File[1].Name, w.Body.Len())
	if w := pathCall(t, s.handleRemoveDownload, "DELETE", nil, map[string]string{"id": it.ID}); w.Code != http.StatusNoContent {
		t.Fatalf("remove: %d", w.Code)
	}
	if _, err := os.Stat(it.Folder); !os.IsNotExist(err) {
		t.Fatalf("the device's files are still there: %v", err)
	}
}

func TestInstagramSignedOut(t *testing.T) {
	res := func(cookie string) *http.Response {
		h := http.Header{}
		h.Add("Set-Cookie", cookie)
		return &http.Response{Header: h}
	}
	if !igSignedOut(res(`sessionid=""; expires=Thu, 01-Jan-1970 00:00:01 GMT; Max-Age=-1792895690; path=/; domain=.instagram.com; httponly`)) {
		t.Fatal("a cleared session wasn't noticed")
	}
	if igSignedOut(res(`sessionid=123%3Aabc%3A1; Max-Age=31536000; path=/; domain=.instagram.com`)) || igSignedOut(res(`csrftoken=""; Max-Age=-1`)) {
		t.Fatal("a renewed session, or another cookie, counted as signed out")
	}
}

func TestGalleryCursorAndRepeats(t *testing.T) {
	logs := "[instagram][debug] PolarisProfilePostsTabContentQuery (123)\n[instagram][debug] Cursor: QVFDa2x==\n[instagram][debug] Cursor: QVFEb3==\n"
	if m := galleryCursor.FindAllStringSubmatch(logs, -1); len(m) != 2 || m[1][1] != "QVFEb3==" {
		t.Fatalf("cursor: %v", m)
	}
	// A page met again: its files are known by name, though their addresses are signed anew.
	a := galleryEntry("https://cdn/x.jpg?sig=1", map[string]any{"extension": "jpg", "post_shortcode": "DAbC12", "num": 1.0})
	b := galleryEntry("https://cdn/x.jpg?sig=2", map[string]any{"extension": "jpg", "post_shortcode": "DAbC12", "num": 1.0})
	if a.key() != b.key() || a.key() == "" {
		t.Fatalf("keys %q %q", a.key(), b.key())
	}
	l := &browseList{Site: "instagram.com", More: true}
	l.add(a)
	l.shown = 1
	l.add(b)
	if v := l.view(); len(v.Entries) != 1 || !v.More || l.pageSize() != 24 {
		t.Fatalf("view: %d %v %d", len(v.Entries), v.More, l.pageSize())
	}
}
