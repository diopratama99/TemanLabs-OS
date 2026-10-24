package main

import (
	"encoding/base64"
	"encoding/json"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync"
)

// Sign-ins for apps behind HTTP Basic auth (Supabase Studio behind Kong, say). The browser would
// show its own login dialog, over and over inside a window; instead the window asks once, the
// server keeps the sign-in, and the app's proxy sends it with every request. The password never
// goes back to the browser.

type appLogin struct {
	Username string `json:"username"`
	Password string `json:"password"`
}

func (l appLogin) header() string {
	return "Basic " + base64.StdEncoding.EncodeToString([]byte(l.Username+":"+l.Password))
}

type appLogins struct {
	mu     sync.Mutex
	path   string
	logins map[string]appLogin // app ID → sign-in
}

func newAppLogins(stateDir string) *appLogins {
	l := &appLogins{path: filepath.Join(stateDir, "app-logins.json"), logins: map[string]appLogin{}}
	if data, err := os.ReadFile(l.path); err == nil {
		_ = json.Unmarshal(data, &l.logins)
	}
	return l
}

func (l *appLogins) get(id string) (appLogin, bool) {
	l.mu.Lock()
	defer l.mu.Unlock()
	login, ok := l.logins[id]
	return login, ok
}

// set saves a sign-in, or forgets it (nil). The file is readable by root only.
func (l *appLogins) set(id string, login *appLogin) error {
	l.mu.Lock()
	defer l.mu.Unlock()
	if login == nil {
		delete(l.logins, id)
	} else {
		l.logins[id] = *login
	}
	data, err := json.MarshalIndent(l.logins, "", "  ")
	if err != nil {
		return err
	}
	tmp := l.path + ".tmp"
	if err := os.WriteFile(tmp, data, 0o600); err != nil {
		return err
	}
	return os.Rename(tmp, l.path)
}

// isBasicChallenge reports whether a response asks the browser for a Basic (or Digest) login.
func isBasicChallenge(res *http.Response) bool {
	if res.StatusCode != http.StatusUnauthorized {
		return false
	}
	for _, v := range res.Header.Values("WWW-Authenticate") {
		v = strings.ToLower(strings.TrimSpace(v))
		if strings.HasPrefix(v, "basic") || strings.HasPrefix(v, "digest") {
			return true
		}
	}
	return false
}

// handleAppSignIn checks a sign-in against the app and saves it when the app accepts it.
func (s *server) handleAppSignIn(w http.ResponseWriter, r *http.Request) {
	var body appLogin
	if err := decodeJSON(r, &body); err != nil || body.Username == "" {
		writeError(w, http.StatusBadRequest, "enter the user name and password")
		return
	}
	a, err := s.findApp(r.Context(), r.PathValue("id"))
	if err != nil {
		writeError(w, http.StatusBadGateway, err.Error())
		return
	}
	if a == nil || a.Port == nil {
		writeError(w, http.StatusNotFound, "this app has no web interface")
		return
	}
	probe, err := probeFrame(appOrigin(a)+a.Path, body.header())
	if err != nil {
		writeError(w, http.StatusBadGateway, "couldn't reach the app: "+err.Error())
		return
	}
	if probe.basic {
		// Not 401: that would read as the TemanLabsOS session having ended.
		writeError(w, http.StatusUnprocessableEntity, "wrong user name or password")
		return
	}
	if err := s.logins.set(a.ID, &body); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *server) handleAppSignOut(w http.ResponseWriter, r *http.Request) {
	if err := s.logins.set(r.PathValue("id"), nil); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
