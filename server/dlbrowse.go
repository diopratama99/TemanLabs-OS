package main

import (
	"archive/zip"
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"os/exec"
	"path"
	"path/filepath"
	"regexp"
	"slices"
	"strconv"
	"strings"
	"syscall"
	"time"
)

// Choosing what to save from a profile, channel or playlist: the downloader lists what's there,
// a page at a time and with thumbnails, and the chosen ones are queued. Videos from yt-dlp's
// lists are queued as pages of their own; photos and clips from gallery-dl's are fetched as the
// files they are, all of them in one download.
//
// Also here: downloads for the device in front of the browser rather than for the server's
// folders, which wait in a folder of TemanLabsOS's own until they're fetched, a day at most.

const (
	browsePage  = 48
	maxBrowses  = 8
	deviceHours = 24
)

// browserUA passes for a current desktop Chrome: its version goes up one every four weeks,
// as Chrome's do (151 in mid 2026).
var browserUA = func() string {
	days := time.Now().Unix()/86400 + 719163 // days since year 1, as Python counts them
	return fmt.Sprintf("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/%d.0.0.0 Safari/537.36", (days-735597)/28)
}()

type browseEntry struct {
	Index    int     `json:"index"`
	Kind     string  `json:"kind"` // video, image
	Title    string  `json:"title,omitempty"`
	Thumb    bool    `json:"thumb"`
	Duration float64 `json:"duration,omitempty"`
	Date     string  `json:"date,omitempty"`
	Group    string  `json:"group,omitempty"` // the post a file belongs to
	Page     bool    `json:"page,omitempty"`  // a video saved in the quality chosen

	page  string // a page yt-dlp saves
	src   string // or a file fetched as it is
	name  string // under this name
	thumb string
}

type browseList struct {
	ID       string         `json:"id"`
	URL      string         `json:"url"`
	Title    string         `json:"title"`
	Uploader string         `json:"uploader,omitempty"`
	Site     string         `json:"site"`
	Shape    string         `json:"shape"` // of the thumbnails: square posts, wide videos, tall reels
	Entries  []*browseEntry `json:"entries"`
	More     bool           `json:"more"`

	// A profile's: its handle, whether there's a picture of it, and its tabs (posts, reels…).
	Handle    string   `json:"handle,omitempty"`
	Avatar    bool     `json:"avatar"`
	Followers int      `json:"followers,omitempty"`
	Tabs      []string `json:"tabs,omitempty"`
	Tab       string   `json:"tab,omitempty"`

	tool     string
	avatar   string
	cursor   string        // where gallery-dl stopped, for it to go on from there
	shown    int           // entries sent so far; the rest were fetched ahead
	fetching chan struct{} // closed when the page being fetched is in
	fetchErr error         // why the last fetch failed
	used     time.Time
}

// How many entries a page of the list has: Instagram's go slower (gallery-dl waits 6 to 12
// seconds between its requests there, to keep the account safe), so its pages are smaller.
func (l *browseList) pageSize() int {
	if l.Site == "instagram.com" {
		return 24
	}
	return browsePage
}

// view is what's sent: the entries shown so far, and whether there are more.
func (l *browseList) view() *browseList {
	v := *l
	v.Entries = l.Entries[:l.shown]
	v.More = l.More || len(l.Entries) > l.shown
	return &v
}

// key tells an entry from the others, when a page comes twice.
func (e *browseEntry) key() string {
	return orStr(e.name, orStr(e.page, e.src))
}

// A profile on a site with tabs of its own, as the site shows them.
type profile struct {
	key    string // site and user, for the picture kept
	handle string
	tabs   []string
	tab    string            // the one the link was for
	urls   map[string]string // each tab's address
	avatar string            // where gallery-dl finds the profile picture, if the list doesn't say
}

// Tabs whose thumbnails stand up, as reels and stories do.
var tallTabs = []string{"reels", "stories", "shorts", "video"}

var ytChannelTab = regexp.MustCompile(`^/(@[^/]+|channel/[^/]+|c/[^/]+|user/[^/]+)(?:/(videos|shorts|streams|featured|live))?/?$`)

// profileOf says whether a link is a profile, and what its tabs are.
func profileOf(u *url.URL) *profile {
	host := strings.TrimPrefix(strings.TrimPrefix(strings.ToLower(u.Hostname()), "www."), "m.")
	segs := strings.FieldsFunc(u.Path, func(r rune) bool { return r == '/' })
	seg := func(i int) string {
		if i < len(segs) {
			return segs[i]
		}
		return ""
	}
	mk := func(site, user, handle string, tabs []string, tab string, url func(tab string) string) *profile {
		if !slices.Contains(tabs, tab) {
			tab = tabs[0]
		}
		p := &profile{key: site + ":" + strings.ToLower(user), handle: handle, tabs: tabs, tab: tab, urls: map[string]string{}}
		for _, t := range tabs {
			p.urls[t] = url(t)
		}
		return p
	}
	switch {
	case host == "instagram.com":
		reserved := []string{"p", "reel", "tv", "explore", "accounts", "direct", "about", "legal", "developer", ""}
		user, tab := seg(0), seg(1)
		if user == "stories" {
			user, tab = seg(1), "stories"
		}
		if slices.Contains(reserved, user) || user == "reels" || (seg(0) == "stories" && seg(2) != "") {
			return nil
		}
		p := mk("instagram", user, "@"+user, []string{"posts", "reels", "stories", "highlights", "tagged"}, tab, func(t string) string {
			if t == "stories" {
				return "https://www.instagram.com/stories/" + user + "/"
			}
			return "https://www.instagram.com/" + user + "/" + t + "/"
		})
		p.avatar = "https://www.instagram.com/" + user + "/avatar/"
		return p
	case host == "x.com" || host == "twitter.com":
		reserved := []string{"i", "home", "search", "hashtag", "explore", "settings", "messages", "notifications", ""}
		user, tab := seg(0), seg(1)
		if slices.Contains(reserved, user) || (tab != "" && !slices.Contains([]string{"media", "tweets", "highlights", "with_replies"}, tab)) {
			return nil
		}
		p := mk("x", user, "@"+user, []string{"media", "tweets", "highlights"}, tab, func(t string) string { return "https://x.com/" + user + "/" + t })
		p.avatar = "https://x.com/" + user + "/photo"
		return p
	case host == "tiktok.com":
		user, tab := seg(0), seg(1)
		if !strings.HasPrefix(user, "@") || len(user) < 2 || (tab != "" && !slices.Contains([]string{"posts", "reposts", "stories"}, tab)) {
			return nil
		}
		p := mk("tiktok", user, user, []string{"posts", "reposts", "stories"}, tab, func(t string) string { return "https://www.tiktok.com/" + user + "/" + t })
		p.avatar = "https://www.tiktok.com/" + user + "/avatar"
		return p
	case host == "facebook.com" || host == "web.facebook.com":
		reserved := []string{"watch", "photo", "photo.php", "media", "groups", "events", "pages", "reel", "share", "story.php", "permalink.php", "marketplace", "gaming", "login", ""}
		user, tab := seg(0), seg(1)
		switch user {
		case "profile.php":
			user, tab = u.Query().Get("id"), u.Query().Get("sk")
		case "people":
			user, tab = seg(2), seg(3)
		}
		if slices.Contains(reserved, user) || (tab != "" && !slices.Contains([]string{"photos", "photos_albums", "photos_by"}, tab)) {
			return nil
		}
		if tab == "photos_by" {
			tab = "photos"
		}
		p := mk("facebook", user, "", []string{"photos", "photos_albums"}, tab, func(t string) string { return "https://www.facebook.com/" + user + "/" + t })
		p.avatar = "https://www.facebook.com/" + user + "/avatar"
		return p
	case host == "bsky.app":
		user, tab := seg(1), seg(2)
		if seg(0) != "profile" || user == "" || (tab != "" && !slices.Contains([]string{"media", "video", "posts"}, tab)) {
			return nil
		}
		return mk("bsky", user, "@"+user, []string{"media", "video", "posts"}, tab, func(t string) string { return "https://bsky.app/profile/" + user + "/" + t })
	case host == "youtube.com":
		m := ytChannelTab.FindStringSubmatch(u.Path)
		if m == nil {
			return nil
		}
		handle := m[1]
		if !strings.HasPrefix(handle, "@") {
			handle = ""
		}
		return mk("youtube", m[1], handle, []string{"videos", "shorts", "streams"}, m[2], func(t string) string { return "https://www.youtube.com/" + m[1] + "/" + t })
	}
	return nil
}

// One file fetched as it is, for a "files" download.
type dlSrc struct {
	URL  string `json:"url"`
	Name string `json:"name"`
}

// Sites whose profiles gallery-dl reads better than yt-dlp.
var galleryHosts = []string{"instagram.com", "x.com", "twitter.com", "bsky.app", "pinterest.", "reddit.com", "tumblr.com", "deviantart.com", "pixiv.net", "flickr.com", "imgur.com", "threads.net", "threads.com", "artstation.com", "weibo.", "vsco.co", "tiktok.com", "facebook.com"}

func usesGallery(host string) bool {
	host = strings.TrimPrefix(strings.ToLower(host), "www.")
	return slices.ContainsFunc(galleryHosts, func(h string) bool { return strings.HasPrefix(host, h) || strings.HasSuffix(host, "."+h) || host == h })
}

var (
	imageExts = []string{"jpg", "jpeg", "png", "webp", "gif", "heic", "avif", "bmp"}
	videoExts = []string{"mp4", "webm", "mov", "mkv", "m4v", "m3u8", "ts"}
)

// toolJSON runs a tool and returns what it printed.
func (s *server) toolJSON(ctx context.Context, name string, args []string) ([]byte, error) {
	out, _, err := s.toolRun(ctx, name, args)
	return out, err
}

// toolRun runs a tool and returns what it printed and what it logged.
func (s *server) toolRun(ctx context.Context, name string, args []string) ([]byte, string, error) {
	cmd := exec.CommandContext(ctx, s.toolPath(name), args...)
	cmd.Env = s.toolEnv()
	cmd.Cancel = func() error { return cmd.Process.Signal(syscall.SIGINT) }
	cmd.WaitDelay = 5 * time.Second
	var out, stderr bytes.Buffer
	cmd.Stdout, cmd.Stderr = &out, &stderr
	err := cmd.Run()
	if err != nil && out.Len() == 0 {
		lines := strings.Split(strings.TrimSpace(stderr.String()), "\n")
		return nil, stderr.String(), toolErr(lines, err)
	}
	return out.Bytes(), stderr.String(), nil
}

// toolErr picks what went wrong from a tool's last lines: the ERROR line, else the last few.
func toolErr(lines []string, err error) error {
	for i := len(lines) - 1; i >= 0; i-- {
		l := strings.TrimSpace(lines[i])
		if m := strings.TrimPrefix(l, "ERROR: "); m != l || strings.HasPrefix(l, "[error]") {
			return errors.New(strings.TrimSpace(strings.TrimPrefix(m, "[error] ")))
		}
	}
	var keep []string
	for _, l := range lines {
		if l = strings.TrimSpace(l); l != "" {
			keep = append(keep, l)
		}
	}
	if len(keep) > 0 {
		return errors.New(strings.Join(keep[max(0, len(keep)-3):], " · "))
	}
	return err
}

func (s *server) cookieArgs() []string {
	if _, err := os.Stat(s.dl.cookies); err == nil {
		return []string{"--cookies", s.dl.cookies}
	}
	return nil
}

// browseYTDLP lists a channel or playlist with yt-dlp, without opening each video.
func (s *server) browseYTDLP(ctx context.Context, l *browseList, start int) (int, error) {
	args := append([]string{"--flat-playlist", "-J", "--no-warnings", "--playlist-items", fmt.Sprintf("%d:%d", start, start+browsePage-1)}, s.cookieArgs()...)
	data, err := s.toolJSON(ctx, "yt-dlp", append(args, "--", l.URL))
	if err != nil {
		return 0, err
	}
	type thumb struct {
		ID    string `json:"id"`
		URL   string `json:"url"`
		Width int    `json:"width"`
	}
	type video struct {
		Type       string  `json:"_type"`
		IEKey      string  `json:"ie_key"`
		Title      string  `json:"title"`
		URL        string  `json:"url"`
		WebpageURL string  `json:"webpage_url"`
		Duration   float64 `json:"duration"`
		Thumbnail  string  `json:"thumbnail"`
		Thumbnails []thumb `json:"thumbnails"`
		UploadDate string  `json:"upload_date"`
		Uploader   string  `json:"uploader"`
		Channel    string  `json:"channel"`
		Followers  int     `json:"channel_follower_count"`
	}
	var res struct {
		video
		Entries []video `json:"entries"`
	}
	if err := json.Unmarshal(data, &res); err != nil {
		return 0, errors.New("couldn't read the list")
	}
	if l.Shape == "" {
		l.Shape = "wide"
	}
	if l.Title == "" {
		l.Title, l.Uploader = res.Title, orStr(res.Channel, res.Uploader)
	}
	if res.Followers > 0 {
		l.Followers = res.Followers
	}
	for _, t := range res.Thumbnails {
		if strings.HasPrefix(t.ID, "avatar") {
			l.avatar = t.URL
		}
	}
	entries := res.Entries
	if res.Type != "playlist" {
		// Just one video.
		entries = []video{res.video}
	}
	for _, v := range entries {
		page := orStr(v.WebpageURL, v.URL)
		if page == "" || v.Type == "playlist" || strings.HasSuffix(v.IEKey, "Tab") {
			continue
		}
		e := &browseEntry{Kind: "video", Title: v.Title, Duration: v.Duration, page: page, thumb: v.Thumbnail}
		// The smallest thumbnail that still looks sharp in the grid.
		for _, t := range v.Thumbnails {
			if e.thumb == "" || (t.Width >= 320 && t.Width < 1000) {
				e.thumb = t.URL
				if t.Width >= 320 {
					break
				}
			}
		}
		if d := v.UploadDate; len(d) == 8 {
			e.Date = d[:4] + "-" + d[4:6] + "-" + d[6:]
		}
		l.add(e)
	}
	if res.Type != "playlist" {
		return len(entries), nil
	}
	return len(res.Entries), nil
}

// browseGallery lists a profile with gallery-dl: every file, with what it knows of the post.
func (s *server) browseGallery(ctx context.Context, l *browseList) (int, error) {
	size := l.pageSize()
	want := size
	args := []string{"-J", "-v"}
	if l.cursor != "" {
		// From where the last page stopped: that page comes again, so a page more is asked for.
		want = 2 * size
		args = append(args, "-o", "cursor="+l.cursor, "--range", fmt.Sprintf("1-%d", want))
	} else {
		from := len(l.Entries) + 1
		args = append(args, "--range", fmt.Sprintf("%d-%d", from, from+size-1))
	}
	data, logs, err := s.toolRun(ctx, "gallery-dl", append(append(args, s.cookieArgs()...), "--", l.URL))
	if err != nil {
		return 0, err
	}
	if m := galleryCursor.FindAllStringSubmatch(logs, -1); len(m) > 0 {
		l.cursor = m[len(m)-1][1]
	}
	seen := map[string]bool{}
	for _, e := range l.Entries {
		seen[e.key()] = true
	}
	added := 0
	var msgs []json.RawMessage
	if err := json.Unmarshal(data, &msgs); err != nil {
		return 0, errors.New("couldn't read the list")
	}
	files := 0
	var failure string
	for _, raw := range msgs {
		var msg []json.RawMessage
		if json.Unmarshal(raw, &msg) != nil || len(msg) < 2 {
			continue
		}
		kind, _ := strconv.Atoi(string(msg[0]))
		switch kind {
		case -1:
			var e struct{ Error, Message string }
			_ = json.Unmarshal(msg[1], &e)
			failure = orStr(e.Message, e.Error)
		case 2:
			var kw map[string]any
			if json.Unmarshal(msg[1], &kw) == nil {
				l.noteProfile(kw)
			}
		case 3:
			if len(msg) < 3 {
				continue
			}
			var u string
			var kw map[string]any
			if json.Unmarshal(msg[1], &u) != nil || json.Unmarshal(msg[2], &kw) != nil {
				continue
			}
			files++
			l.noteProfile(kw)
			if e := galleryEntry(u, kw); !seen[e.key()] {
				seen[e.key()] = true
				l.add(e)
				added++
			}
		}
	}
	if files == 0 && failure != "" {
		return 0, errors.New(failure)
	}
	l.More = files >= want && added > 0
	return added, nil
}

// Where gallery-dl's debug log says it is in a feed.
var galleryCursor = regexp.MustCompile(`\]\[debug\] Cursor: (\S+)`)

// noteProfile takes who posted from a post's metadata.
func (l *browseList) noteProfile(kw map[string]any) {
	if l.Uploader == "" {
		l.Uploader = firstStr(kw, "fullname", "author.displayName", "user.name", "author.name", "author.nickname", "blog.title", "username", "author.handle", "user.nick")
	}
	if l.avatar == "" {
		l.avatar = firstStr(kw, "author.avatar", "user.profile_image", "author.profile_image", "author.avatarLarger", "author.avatarMedium", "user.avatar", "owner.profile_pic_url", "profile_pic_url")
	}
	if l.Followers == 0 {
		if n, err := strconv.Atoi(firstStr(kw, "author.followersCount", "user.followers_count", "author.followers_count", "authorStats.followerCount")); err == nil {
			l.Followers = n
		}
	}
}

func galleryEntry(u string, kw map[string]any) *browseEntry {
	ext := strings.ToLower(firstStr(kw, "extension"))
	e := &browseEntry{
		Kind:  "image",
		Title: firstStr(kw, "description", "content", "title", "text", "caption"),
		Group: firstStr(kw, "post_shortcode", "shortcode", "post_id", "tweet_id", "id"),
		Date:  firstStr(kw, "date"),
	}
	if r := []rune(e.Title); len(r) > 160 {
		e.Title = string(r[:160]) + "…"
	}
	if f, ok := kw["duration"].(float64); ok {
		e.Duration = f
	}
	if strings.HasPrefix(u, "ytdl:") {
		// A video gallery-dl hands to yt-dlp.
		e.Kind, e.page = "video", strings.TrimPrefix(u, "ytdl:")
		e.thumb = firstStr(kw, "display_url", "thumbnail", "thumbnail_url", "embed.thumbnail")
		return e
	}
	e.src = u
	if slices.Contains(videoExts, ext) {
		e.Kind = "video"
		e.thumb = firstStr(kw, "display_url", "thumbnail", "thumbnail_url", "embed.thumbnail", "embed.media.thumbnail", "preview")
	} else {
		e.thumb = orStr(firstStr(kw, "display_url"), u)
		if pu, err := url.Parse(e.thumb); err == nil && pu.Host == "pbs.twimg.com" {
			// X makes small copies for the asking.
			q := pu.Query()
			q.Set("name", "small")
			pu.RawQuery = q.Encode()
			e.thumb = pu.String()
		}
	}
	name := firstStr(kw, "filename")
	if sc := firstStr(kw, "post_shortcode"); sc != "" {
		name = sc + "_" + firstStr(kw, "num")
	} else if e.Group != "" && len(name) > 32 {
		// The post and its number read better than a long hash.
		name = e.Group + "_" + orStr(firstStr(kw, "num"), "1")
	}
	if name == "" {
		name = "file"
	}
	if ext == "" {
		ext = map[string]string{"video": "mp4", "image": "jpg"}[e.Kind]
	}
	e.name = safeName(name, 120) + "." + ext
	return e
}

// firstStr returns the first of these metadata fields (a.b for one inside another) that has a value.
func firstStr(kw map[string]any, keys ...string) string {
	for _, k := range keys {
		var v any = kw
		for _, part := range strings.Split(k, ".") {
			m, ok := v.(map[string]any)
			if !ok {
				v = nil
				break
			}
			v = m[part]
		}
		switch t := v.(type) {
		case string:
			if t = strings.TrimSpace(t); t != "" {
				return t
			}
		case float64:
			return strconv.FormatFloat(t, 'f', -1, 64)
		}
	}
	return ""
}

func orStr(a, b string) string {
	if a != "" {
		return a
	}
	return b
}

func (l *browseList) add(e *browseEntry) {
	e.Index = len(l.Entries)
	e.Page = e.page != ""
	e.Thumb = e.thumb != "" || (e.Kind == "video" && e.src != "")
	l.Entries = append(l.Entries, e)
}

// How gallery-dl fails when Instagram has changed under it.
var igBroken = regexp.MustCompile(`(?i)could not be found|KeyError|Failed to load API data`)

// Words in a failure that mean the site wants an account.
var needsLogin = regexp.MustCompile(`(?i)login|log in|sign in|cookie|auth|could not be found|not found|401|403|private`)

func (s *server) handleBrowse(w http.ResponseWriter, r *http.Request) {
	var body struct {
		URL  string `json:"url"`
		Tab  string `json:"tab"`  // of a profile: posts, reels…
		List string `json:"list"` // the next page of this one
	}
	if decodeJSON(r, &body) != nil {
		writeError(w, http.StatusBadRequest, "invalid request")
		return
	}
	if !s.toolsInstalled() {
		writeError(w, http.StatusConflict, "install the download tools first")
		return
	}
	if body.List != "" {
		s.dl.mu.Lock()
		l := s.dl.lists[body.List]
		s.dl.mu.Unlock()
		if l == nil {
			writeError(w, http.StatusNotFound, "this list is gone; open the link again")
			return
		}
		v, err := s.nextPage(r.Context(), l)
		if err != nil {
			writeError(w, http.StatusBadGateway, err.Error())
			return
		}
		writeJSON(w, http.StatusOK, v)
		return
	}
	var next *browseList
	var prof *profile
	{
		u, err := url.Parse(strings.TrimSpace(body.URL))
		if err != nil || (u.Scheme != "http" && u.Scheme != "https") || u.Host == "" {
			writeError(w, http.StatusBadRequest, "paste the link of a profile, channel or playlist")
			return
		}
		next = &browseList{ID: dlID(), URL: u.String(), Site: strings.TrimPrefix(u.Hostname(), "www.")}
		if p := profileOf(u); p != nil {
			tab := p.tab
			if slices.Contains(p.tabs, body.Tab) {
				tab = body.Tab
			}
			next.URL, next.Handle, next.Tabs, next.Tab = p.urls[tab], p.handle, p.tabs, tab
			prof = p
		}
		if slices.Contains(tallTabs, next.Tab) || next.Site == "tiktok.com" {
			next.Shape = "tall"
		}
	}

	ctx, cancel := context.WithTimeout(r.Context(), 3*time.Minute)
	defer cancel()
	tools := []string{"yt-dlp", "gallery-dl"}
	if u, _ := url.Parse(next.URL); usesGallery(u.Hostname()) {
		tools = []string{"gallery-dl", "yt-dlp"}
		if prof != nil {
			// yt-dlp doesn't read these sites' profiles; its empty list would hide gallery-dl's reason.
			tools = []string{"gallery-dl"}
		}
	}
	// The profile's picture, looked for while the first page is.
	avatar := make(chan string, 1)
	if prof != nil {
		s.dl.mu.Lock()
		known, ok := s.dl.avatars[prof.key]
		s.dl.mu.Unlock()
		switch {
		case ok:
			avatar <- known
		case prof.avatar != "":
			go func() { avatar <- s.galleryFirstURL(ctx, prof.avatar) }()
		default:
			avatar <- ""
		}
	}
	var firstErr error
	empty := "" // a way that found nothing, without failing
	for _, tool := range tools {
		var n int
		var err error
		switch tool {
		case "yt-dlp":
			n, err = s.browseYTDLP(ctx, next, 1)
			next.More = n >= next.pageSize()
		default:
			n, err = s.browseGallery(ctx, next)
		}
		if err == nil && n == 0 && len(next.Entries) == 0 && (firstErr != nil || tool != tools[len(tools)-1]) {
			// Nothing here: the other way may find something, or a failure before says why.
			empty = tool
			continue
		}
		if err == nil {
			next.tool = tool
			break
		}
		if firstErr == nil {
			firstErr = err
		}
		if ctx.Err() != nil {
			break
		}
	}
	if next.tool == "" && firstErr == nil {
		// Every way looked and found nothing: an empty list, then.
		next.tool = empty
	}
	if next.tool == "" {
		msg := firstErr.Error()
		_, noCookies := os.Stat(s.dl.cookies)
		switch {
		case noCookies != nil && needsLogin.MatchString(msg):
			msg += " — this site may need you signed in: add a cookies.txt in the Downloader's settings"
		case next.Site == "instagram.com" && strings.Contains(msg, "redirect to home page"):
			msg = igEnded
		case next.Site == "instagram.com" && !s.galleryDev() && igBroken.MatchString(msg):
			// The window offers the fix itself.
			writeJSON(w, http.StatusBadGateway, map[string]string{
				"error": "Instagram changed how profiles load, and this version of gallery-dl hasn't caught up yet (" + msg + "). Its development version has the fix.",
				"fix":   "galleryDev",
			})
			return
		}
		writeError(w, http.StatusBadGateway, msg)
		return
	}
	if prof != nil {
		// Named after who it is rather than the tab ("NASA - Shorts").
		next.Title = orStr(next.Uploader, strings.TrimPrefix(next.Handle, "@"))
		if found := <-avatar; next.avatar == "" {
			next.avatar = found
		}
		s.dl.mu.Lock()
		s.dl.avatars[prof.key] = next.avatar
		s.dl.mu.Unlock()
	}
	if next.Title == "" {
		next.Title = orStr(next.Uploader, next.Site)
	}
	if next.Shape == "" {
		next.Shape = "square"
	}
	next.Avatar = next.avatar != ""
	next.shown = len(next.Entries)
	next.used = time.Now()

	s.dl.mu.Lock()
	s.dl.lists[next.ID] = next
	for len(s.dl.lists) > maxBrowses {
		var oldest *browseList
		for _, l := range s.dl.lists {
			if oldest == nil || l.used.Before(oldest.used) {
				oldest = l
			}
		}
		delete(s.dl.lists, oldest.ID)
		s.dl.dropThumbs(oldest.ID)
	}
	v := next.view()
	s.dl.mu.Unlock()
	writeJSON(w, http.StatusOK, v)
	s.fetchAhead(next)
}

// nextPage shows what was fetched ahead, or fetches the next page now (waiting for one being
// fetched already), and starts on the page after.
func (s *server) nextPage(ctx context.Context, l *browseList) (*browseList, error) {
	for {
		s.dl.mu.Lock()
		l.used = time.Now()
		if len(l.Entries) > l.shown || !l.More {
			l.shown = len(l.Entries)
			v := l.view()
			s.dl.mu.Unlock()
			s.fetchAhead(l)
			return v, nil
		}
		if l.fetching == nil {
			l.fetching = make(chan struct{})
			go s.fetchPage(l)
		}
		done := l.fetching
		s.dl.mu.Unlock()
		select {
		case <-done:
		case <-ctx.Done():
			return nil, ctx.Err()
		}
		s.dl.mu.Lock()
		err := l.fetchErr
		l.fetchErr = nil
		s.dl.mu.Unlock()
		if err != nil {
			return nil, err
		}
	}
}

// fetchAhead starts on the next page while the person looks at this one.
func (s *server) fetchAhead(l *browseList) {
	s.dl.mu.Lock()
	defer s.dl.mu.Unlock()
	if l.More && l.fetching == nil && len(l.Entries) <= l.shown && s.dl.lists[l.ID] == l {
		l.fetching = make(chan struct{})
		go s.fetchPage(l)
	}
}

// fetchPage fetches a list's next page into it; the caller has set l.fetching.
func (s *server) fetchPage(l *browseList) {
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Minute)
	defer cancel()
	s.dl.mu.Lock()
	page := *l
	page.Entries = slices.Clone(l.Entries)
	s.dl.mu.Unlock()
	var n int
	var err error
	if page.tool == "yt-dlp" {
		n, err = s.browseYTDLP(ctx, &page, len(page.Entries)+1)
		page.More = n >= page.pageSize()
	} else {
		n, err = s.browseGallery(ctx, &page)
	}
	s.dl.mu.Lock()
	defer s.dl.mu.Unlock()
	if err == nil {
		l.Entries, l.cursor, l.More = page.Entries, page.cursor, page.More && n > 0
	}
	l.fetchErr = err
	close(l.fetching)
	l.fetching = nil
}

// galleryFirstURL asks gallery-dl for the first file at an address (a profile picture), or "".
func (s *server) galleryFirstURL(ctx context.Context, addr string) string {
	ctx, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()
	data, err := s.toolJSON(ctx, "gallery-dl", append(append([]string{"-J", "--range", "1"}, s.cookieArgs()...), "--", addr))
	if err != nil {
		return ""
	}
	var msgs [][]json.RawMessage
	_ = json.Unmarshal(data, &msgs)
	for _, m := range msgs {
		var u string
		if len(m) >= 2 && string(m[0]) == "3" && json.Unmarshal(m[1], &u) == nil && strings.HasPrefix(u, "http") {
			return u
		}
	}
	return ""
}

func (s *server) browseEntryOf(r *http.Request) (*browseList, *browseEntry) {
	s.dl.mu.Lock()
	defer s.dl.mu.Unlock()
	l := s.dl.lists[r.PathValue("list")]
	if l != nil && r.PathValue("index") == "avatar" {
		// The profile picture, as an entry of its own.
		l.used = time.Now()
		if l.avatar == "" {
			return nil, nil
		}
		return l, &browseEntry{Index: -1, Kind: "image", thumb: l.avatar}
	}
	i, err := strconv.Atoi(r.PathValue("index"))
	if l == nil || err != nil || i < 0 || i >= len(l.Entries) {
		return nil, nil
	}
	l.used = time.Now()
	return l, l.Entries[i]
}

var thumbClient = &http.Client{Timeout: 30 * time.Second}

// handleBrowseThumb passes a thumbnail on through the server: some sites don't let other pages
// show their pictures, and a video without one gets a frame of its own, taken by ffmpeg.
func (s *server) handleBrowseThumb(w http.ResponseWriter, r *http.Request) {
	l, e := s.browseEntryOf(r)
	if e == nil {
		http.NotFound(w, r)
		return
	}
	w.Header().Set("Cache-Control", "private, max-age=3600")
	if e.thumb != "" {
		req, err := http.NewRequestWithContext(r.Context(), http.MethodGet, e.thumb, nil)
		if err != nil {
			http.NotFound(w, r)
			return
		}
		req.Header.Set("User-Agent", browserUA)
		req.Header.Set("Referer", l.URL)
		res, err := thumbClient.Do(req)
		if err != nil {
			http.Error(w, err.Error(), http.StatusBadGateway)
			return
		}
		defer res.Body.Close()
		ct := res.Header.Get("Content-Type")
		if res.StatusCode != http.StatusOK || !strings.HasPrefix(ct, "image/") {
			http.Error(w, "no thumbnail", http.StatusBadGateway)
			return
		}
		w.Header().Set("Content-Type", ct)
		_, _ = io.Copy(w, io.LimitReader(res.Body, 20<<20))
		return
	}
	if e.Kind != "video" || e.src == "" {
		http.NotFound(w, r)
		return
	}
	file := filepath.Join(s.dl.thumbs, fmt.Sprintf("%s-%d.jpg", l.ID, e.Index))
	if _, err := os.Stat(file); err != nil {
		select {
		case s.dl.frames <- struct{}{}:
		case <-r.Context().Done():
			return
		}
		ctx, cancel := context.WithTimeout(r.Context(), 30*time.Second)
		_ = os.MkdirAll(s.dl.thumbs, 0o700)
		var err error
		// A second in, past a fade from black; the very first frame for a clip shorter than that;
		// and read straight through, for a site that won't send a part of the file.
		for _, at := range [][]string{{"-ss", "1"}, {"-ss", "0"}, {"-seekable", "0"}} {
			args := append([]string{"-nostdin", "-y", "-loglevel", "error", "-user_agent", browserUA, "-headers", "Referer: " + l.URL + "\r\n"}, at...)
			err = exec.CommandContext(ctx, "ffmpeg", append(args, "-i", e.src, "-frames:v", "1", "-vf", "scale=360:-2", "-q:v", "5", file)...).Run()
			if info, serr := os.Stat(file); err == nil && serr == nil && info.Size() > 0 {
				break
			} else if err == nil {
				err = errors.New("no frame")
			}
		}
		cancel()
		<-s.dl.frames
		if err != nil {
			_ = os.Remove(file)
			http.Error(w, "no thumbnail", http.StatusBadGateway)
			return
		}
	}
	w.Header().Set("Content-Type", "image/jpeg")
	http.ServeFile(w, r, file)
}

// dropThumbs removes a list's frames; the caller holds mu.
func (d *downloader) dropThumbs(id string) {
	files, _ := filepath.Glob(filepath.Join(d.thumbs, id+"-*.jpg"))
	for _, f := range files {
		_ = os.Remove(f)
	}
}

// The pick that stands for the profile's picture.
const avatarPick = -1

// handleBrowsePick queues what was chosen from a list.
func (s *server) handleBrowsePick(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Picks   []int  `json:"picks"`
		Mode    string `json:"mode"`
		Quality string `json:"quality"`
		Device  bool   `json:"device"`
	}
	if decodeJSON(r, &body) != nil || len(body.Picks) == 0 {
		writeError(w, http.StatusBadRequest, "choose one or more")
		return
	}
	if body.Mode != "audio" {
		body.Mode = "video"
	}
	s.dl.mu.Lock()
	defer s.dl.mu.Unlock()
	l := s.dl.lists[r.PathValue("list")]
	if l == nil {
		writeError(w, http.StatusNotFound, "this list is gone; open the link again")
		return
	}
	var add []*dlItem
	var files *dlItem
	names := map[string]bool{}
	for _, i := range body.Picks {
		var e *browseEntry
		switch {
		case i == avatarPick && l.avatar != "":
			// The profile's own picture, as a file with the rest.
			ext := strings.ToLower(path.Ext(strings.SplitN(l.avatar, "?", 2)[0]))
			if !slices.Contains(imageExts, strings.TrimPrefix(ext, ".")) {
				ext = ".jpg"
			}
			e = &browseEntry{Kind: "image", src: l.avatar, name: safeName(orStr(strings.TrimPrefix(l.Handle, "@"), l.Title), 80) + "_profile_picture" + ext}
		case i >= 0 && i < len(l.Entries):
			e = l.Entries[i]
		default:
			continue
		}
		if e.page != "" {
			it := s.dl.newItem(e.page, body.Mode, body.Quality, body.Device, s.dl.folder())
			it.Title, it.Site, it.Uploader = e.Title, l.Site, l.Uploader
			add = append(add, it)
			continue
		}
		if files == nil {
			folder := filepath.Join(s.dl.folder(), safeName(orStr(l.Uploader, l.Title), 80))
			files = s.dl.newItem(l.URL, "files", "", body.Device, folder)
			files.Title, files.Site, files.Uploader = l.Title, l.Site, l.Uploader
			add = append(add, files)
		}
		name := e.name
		for n := 2; names[name]; n++ {
			name = strings.TrimSuffix(e.name, filepath.Ext(e.name)) + "-" + strconv.Itoa(n) + filepath.Ext(e.name)
		}
		names[name] = true
		files.Srcs = append(files.Srcs, dlSrc{URL: e.src, Name: name})
	}
	if len(add) == 0 {
		writeError(w, http.StatusBadRequest, "choose one or more")
		return
	}
	if files != nil {
		files.Count = len(files.Srcs)
	}
	s.dl.Items = append(s.dl.Items, add...)
	s.dl.trim()
	s.dl.save()
	s.dl.poke()
	writeJSON(w, http.StatusCreated, add)
}

// newItem makes a queued download; one for the device goes to a folder of its own.
func (d *downloader) newItem(link, mode, quality string, device bool, folder string) *dlItem {
	it := &dlItem{ID: dlID(), URL: link, Mode: mode, Quality: quality, Device: device, Folder: folder, Status: "queued", Files: []string{}, Added: time.Now()}
	if u, err := url.Parse(link); err == nil {
		it.Site = strings.TrimPrefix(u.Hostname(), "www.")
	}
	if device {
		it.Folder = filepath.Join(d.device, it.ID)
	}
	return it
}

// trim lets the oldest finished downloads make room; the caller holds mu.
func (d *downloader) trim() {
	for len(d.Items) > maxDownloads {
		i := slices.IndexFunc(d.Items, func(it *dlItem) bool { return it.Status != "queued" && it.Status != "running" })
		if i < 0 {
			break
		}
		d.forget(d.Items[i])
		d.Items = slices.Delete(d.Items, i, i+1)
	}
}

// forget removes what a download for the device left waiting; the caller holds mu.
func (d *downloader) forget(it *dlItem) {
	if it.Device && strings.HasPrefix(it.Folder, d.device+string(filepath.Separator)) {
		_ = os.RemoveAll(it.Folder)
	}
}

// runFiles fetches the files of a "files" download one after another.
func (s *server) runFiles(ctx context.Context, it *dlItem) error {
	failed := 0
	var lastErr error
	for i, src := range it.Srcs {
		if ctx.Err() != nil {
			return ctx.Err()
		}
		path := filepath.Join(it.Folder, src.Name)
		if !slices.Contains(it.Files, path) {
			var got []string
			var err error
			if strings.HasPrefix(src.URL, "ytdl:") {
				sub := &dlItem{URL: strings.TrimPrefix(src.URL, "ytdl:"), Mode: "video", Quality: "best", Folder: it.Folder, Files: []string{}}
				err = s.runYTDLP(ctx, sub)
				got = sub.Files
			} else {
				err = fetchFile(ctx, src.URL, it.URL, path)
				got = []string{path}
			}
			if err != nil {
				failed++
				lastErr = err
			} else {
				s.dlUpdate(it, func(it *dlItem) { it.Files = append(it.Files, got...) }, false)
			}
		}
		s.dlUpdate(it, func(it *dlItem) { it.Percent = float64(i+1) * 100 / float64(len(it.Srcs)) }, true)
	}
	switch {
	case ctx.Err() != nil:
		return ctx.Err()
	case failed == len(it.Srcs):
		return lastErr
	case failed > 0:
		return fmt.Errorf("%d of %d couldn't be saved (%v); try again for the rest", failed, len(it.Srcs), lastErr)
	}
	return nil
}

func fetchFile(ctx context.Context, src, referer, path string) error {
	if info, err := os.Stat(path); err == nil && info.Size() > 0 {
		return nil
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, src, nil)
	if err != nil {
		return err
	}
	req.Header.Set("User-Agent", browserUA)
	req.Header.Set("Referer", referer)
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		return err
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusOK {
		return fmt.Errorf("the site answered %s", res.Status)
	}
	part := path + ".part"
	f, err := os.Create(part)
	if err != nil {
		return err
	}
	_, err = io.Copy(f, res.Body)
	if cerr := f.Close(); err == nil {
		err = cerr
	}
	if err != nil {
		_ = os.Remove(part)
		return err
	}
	return os.Rename(part, path)
}

// handleDownloadFile hands a finished download to the browser: the file, or a zip of them all.
func (s *server) handleDownloadFile(w http.ResponseWriter, r *http.Request) {
	s.dl.mu.Lock()
	it := s.dl.find(r.PathValue("id"))
	var files []string
	title := ""
	if it != nil {
		files, title = slices.Clone(it.Files), orStr(it.Title, it.Site)
	}
	s.dl.mu.Unlock()
	var present []string
	for _, f := range files {
		if info, err := os.Stat(f); err == nil && info.Mode().IsRegular() {
			present = append(present, f)
		}
	}
	if len(present) == 0 {
		writeError(w, http.StatusNotFound, "the files aren't there any more")
		return
	}
	if len(present) == 1 {
		f, err := os.Open(present[0])
		if err != nil {
			writeFSError(w, err)
			return
		}
		defer f.Close()
		info, _ := f.Stat()
		attachment(w, info.Name())
		http.ServeContent(w, r, info.Name(), info.ModTime(), f)
		return
	}
	w.Header().Set("Content-Type", "application/zip")
	attachment(w, orStr(safeName(title, 80), "download")+".zip")
	zw := zip.NewWriter(w)
	defer zw.Close()
	for _, p := range present {
		if r.Context().Err() != nil {
			return
		}
		info, err := os.Stat(p)
		if err != nil {
			continue
		}
		hdr, _ := zip.FileInfoHeader(info)
		hdr.Name = filepath.Base(p)
		hdr.Method = zip.Store
		if !storedKinds[kindOf(p, false)] {
			hdr.Method = zip.Deflate
		}
		zf, err := zw.CreateHeader(hdr)
		if err != nil {
			return
		}
		f, err := os.Open(p)
		if err != nil {
			continue
		}
		_, err = io.Copy(zf, f)
		f.Close()
		if err != nil {
			return
		}
	}
}

// expireDeviceFiles removes downloads for the device a day after they finished.
func (s *server) expireDeviceFiles() {
	for {
		time.Sleep(10 * time.Minute)
		s.dl.mu.Lock()
		changed := false
		for _, it := range s.dl.Items {
			if it.Device && it.Finished != nil && len(it.Files) > 0 && time.Since(*it.Finished) > deviceHours*time.Hour {
				s.dl.forget(it)
				it.Files, it.Expired, changed = []string{}, true, true
			}
		}
		if changed {
			s.dl.save()
		}
		s.dl.mu.Unlock()
	}
}
