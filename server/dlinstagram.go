package main

import (
	"io"
	"net/http"
	"os"
	"regexp"
	"strings"
	"time"
)

// Instagram's cookies, checked the way a browser would see them: its home page names whoever
// they sign in as. (Its web API under /api/v1 now sends even a signed-in browser away, so it
// can't tell; Instagram's own pages read everything through GraphQL, as gallery-dl does.)

// igCookies reads the saved Instagram cookies as a Cookie header.
func (s *server) igCookies() string {
	data, err := os.ReadFile(s.dl.cookies)
	if err != nil {
		return ""
	}
	var parts []string
	for _, line := range strings.Split(strings.ReplaceAll(string(data), "\r\n", "\n"), "\n") {
		if site, ok := cookieLine(line); ok && site == "instagram.com" {
			f := strings.Split(strings.TrimPrefix(line, "#HttpOnly_"), "\t")
			parts = append(parts, f[5]+"="+f[6])
		}
	}
	return strings.Join(parts, "; ")
}

// What to say when Instagram has ended the session its cookies came from.
const igEnded = "Instagram ended the session these cookies came from (it does that when one session shows up on the server as well as in your browser): sign in again and add fresh cookies, ideally from a second Instagram account kept for downloading, so your own isn't signed out"

// igSignedOut says whether Instagram's answer clears the session cookie.
func igSignedOut(res *http.Response) bool {
	for _, c := range res.Cookies() {
		if c.Name == "sessionid" && (c.MaxAge < 0 || c.Value == "" || c.Value == "\"\"") {
			return true
		}
	}
	return false
}

var igViewer = regexp.MustCompile(`"username":"([A-Za-z0-9._]{1,30})"`)

// handleCheckCookies says who the saved Instagram cookies sign in as.
func (s *server) handleCheckCookies(w http.ResponseWriter, r *http.Request) {
	if r.URL.Query().Get("site") != "instagram.com" {
		writeError(w, http.StatusBadRequest, "only Instagram's cookies can be checked")
		return
	}
	cookie := s.igCookies()
	if cookie == "" {
		writeJSON(w, http.StatusOK, map[string]any{"ok": false, "message": "no Instagram cookies saved"})
		return
	}
	req, err := http.NewRequestWithContext(r.Context(), http.MethodGet, "https://www.instagram.com/", nil)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	req.Header.Set("User-Agent", browserUA)
	req.Header.Set("Cookie", cookie)
	req.Header.Set("Accept", "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8")
	req.Header.Set("Accept-Language", "en-US,en;q=0.9")
	req.Header.Set("Sec-Fetch-Site", "none")
	req.Header.Set("Sec-Fetch-Mode", "navigate")
	req.Header.Set("Sec-Fetch-Dest", "document")
	// Its own answer, not where it sends a visitor next: that's what tells.
	client := &http.Client{Timeout: 30 * time.Second, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}
	res, err := client.Do(req)
	if err != nil {
		writeJSON(w, http.StatusOK, map[string]any{"ok": false, "message": "couldn't reach Instagram: " + err.Error()})
		return
	}
	defer res.Body.Close()
	page, _ := io.ReadAll(io.LimitReader(res.Body, 8<<20))
	switch m := igViewer.FindSubmatch(page); {
	case res.StatusCode == http.StatusTooManyRequests:
		writeJSON(w, http.StatusOK, map[string]any{"ok": false, "message": "Instagram asks to slow down: try again in a few minutes"})
	case igSignedOut(res):
		writeJSON(w, http.StatusOK, map[string]any{"ok": false, "message": igEnded})
	case m != nil:
		writeJSON(w, http.StatusOK, map[string]any{"ok": true, "user": string(m[1])})
	default:
		writeJSON(w, http.StatusOK, map[string]any{"ok": false, "message": "Instagram doesn't see these cookies as signed in: sign in again in your browser and add fresh ones"})
	}
}
