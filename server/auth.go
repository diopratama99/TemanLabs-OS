package main

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"
)

const (
	sessionCookie = "temanlabs_session"
	sessionTTL    = 30 * 24 * time.Hour
	// Failed logins allowed per client address within loginWindow before it is locked out.
	maxLoginFailures = 8
	loginWindow      = 10 * time.Minute
)

// sessions are kept in memory and in <stateDir>/sessions.json, so a restart (an update, a
// deploy) doesn't sign anyone out. The file holds SHA-256 hashes of the tokens, never the tokens,
// with when and from where each one signed in (Settings → Login & Password lists them).
type sessions struct {
	mu   sync.Mutex
	list map[string]*sessionInfo // by token hash
	path string
}

type sessionInfo struct {
	Expires time.Time `json:"expires"`
	Created time.Time `json:"created,omitzero"`
	Seen    time.Time `json:"seen,omitzero"`
	Addr    string    `json:"addr,omitempty"`
	Agent   string    `json:"agent,omitempty"`
	// Locked (the lock screen): nothing but unlocking works until the password is entered again.
	Locked bool `json:"locked,omitempty"`
}

// How often a session's "last used" time is written down.
const seenEvery = time.Minute

func newSessions(stateDir string) *sessions {
	s := &sessions{list: map[string]*sessionInfo{}}
	if stateDir != "" {
		s.path = filepath.Join(stateDir, "sessions.json")
		if data, err := os.ReadFile(s.path); err == nil {
			if json.Unmarshal(data, &s.list) != nil {
				// The first format: only each session's expiry.
				var old map[string]time.Time
				if json.Unmarshal(data, &old) == nil {
					s.list = map[string]*sessionInfo{}
					for h, exp := range old {
						s.list[h] = &sessionInfo{Expires: exp}
					}
				}
			}
		}
	}
	return s
}

func hashToken(token string) string {
	sum := sha256.Sum256([]byte(token))
	return hex.EncodeToString(sum[:])
}

// save writes the sessions out; callers hold s.mu.
func (s *sessions) save() {
	if s.path == "" {
		return
	}
	now := time.Now()
	for h, info := range s.list {
		if now.After(info.Expires) {
			delete(s.list, h)
		}
	}
	data, _ := json.Marshal(s.list)
	tmp := s.path + ".tmp"
	if os.WriteFile(tmp, data, 0o600) == nil {
		_ = os.Rename(tmp, s.path)
	}
}

func (s *sessions) create(r *http.Request) string {
	b := make([]byte, 32)
	_, _ = rand.Read(b)
	token := hex.EncodeToString(b)
	now := time.Now()
	agent := r.UserAgent()
	if len(agent) > 300 {
		agent = agent[:300]
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	s.list[hashToken(token)] = &sessionInfo{Expires: now.Add(sessionTTL), Created: now, Seen: now, Addr: clientAddr(r), Agent: agent}
	s.save()
	return token
}

// check finds a session (locked or not) and notes that it was used.
func (s *sessions) check(token string) (sessionInfo, bool) {
	if token == "" {
		return sessionInfo{}, false
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	h := hashToken(token)
	info, ok := s.list[h]
	if !ok {
		return sessionInfo{}, false
	}
	now := time.Now()
	if now.After(info.Expires) {
		delete(s.list, h)
		s.save()
		return sessionInfo{}, false
	}
	if now.Sub(info.Seen) > seenEvery {
		info.Seen = now
		s.save()
	}
	return *info, true
}

// valid: a session that may use the desktop (signed in and not locked).
func (s *sessions) valid(token string) bool {
	info, ok := s.check(token)
	return ok && !info.Locked
}

func (s *sessions) setLocked(token string, locked bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if info, ok := s.list[hashToken(token)]; ok {
		info.Locked = locked
		s.save()
	}
}

func (s *sessions) delete(token string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	delete(s.list, hashToken(token))
	s.save()
}

// deleteOthers signs out every session except keep (after a password change, or on request).
func (s *sessions) deleteOthers(keep string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	k := hashToken(keep)
	for h := range s.list {
		if h != k {
			delete(s.list, h)
		}
	}
	s.save()
}

// sessionView is a session as Settings shows it; its ID is the start of the token's hash.
type sessionView struct {
	ID      string    `json:"id"`
	Current bool      `json:"current"`
	Created time.Time `json:"created,omitzero"`
	Seen    time.Time `json:"seen,omitzero"`
	Addr    string    `json:"addr,omitempty"`
	Agent   string    `json:"agent,omitempty"`
	Locked  bool      `json:"locked,omitempty"`
}

const sessionIDLen = 16

func (s *sessions) views(current string) []sessionView {
	s.mu.Lock()
	defer s.mu.Unlock()
	cur := hashToken(current)
	now := time.Now()
	out := []sessionView{}
	for h, info := range s.list {
		if now.After(info.Expires) {
			continue
		}
		out = append(out, sessionView{ID: h[:sessionIDLen], Current: h == cur, Created: info.Created, Seen: info.Seen, Addr: info.Addr, Agent: info.Agent, Locked: info.Locked})
	}
	sort.Slice(out, func(i, j int) bool {
		if out[i].Current != out[j].Current {
			return out[i].Current
		}
		return out[i].Seen.After(out[j].Seen)
	})
	return out
}

// deleteID signs out the session whose hash starts with id; not the current one.
func (s *sessions) deleteID(id, current string) bool {
	if len(id) != sessionIDLen {
		return false
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	cur := hashToken(current)
	for h := range s.list {
		if strings.HasPrefix(h, id) && h != cur {
			delete(s.list, h)
			s.save()
			return true
		}
	}
	return false
}

type loginLimiter struct {
	mu       sync.Mutex
	failures map[string][]time.Time
}

func newLoginLimiter() *loginLimiter { return &loginLimiter{failures: map[string][]time.Time{}} }

func clientAddr(r *http.Request) string {
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		return r.RemoteAddr
	}
	return host
}

func (l *loginLimiter) recent(addr string) []time.Time {
	cutoff := time.Now().Add(-loginWindow)
	kept := l.failures[addr][:0]
	for _, t := range l.failures[addr] {
		if t.After(cutoff) {
			kept = append(kept, t)
		}
	}
	l.failures[addr] = kept
	return kept
}

func (l *loginLimiter) blocked(addr string) bool {
	l.mu.Lock()
	defer l.mu.Unlock()
	return len(l.recent(addr)) >= maxLoginFailures
}

func (l *loginLimiter) fail(addr string) {
	l.mu.Lock()
	defer l.mu.Unlock()
	l.failures[addr] = append(l.recent(addr), time.Now())
}

func (l *loginLimiter) reset(addr string) {
	l.mu.Lock()
	defer l.mu.Unlock()
	delete(l.failures, addr)
}

func (s *server) sessionToken(r *http.Request) string {
	c, err := r.Cookie(sessionCookie)
	if err != nil {
		return ""
	}
	return c.Value
}

func (s *server) requireAuth(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		info, ok := s.sessions.check(s.sessionToken(r))
		if !ok {
			writeError(w, http.StatusUnauthorized, "not signed in")
			return
		}
		// A locked screen: only unlocking (outside this handler) gets through.
		if info.Locked {
			writeError(w, http.StatusLocked, "locked")
			return
		}
		next.ServeHTTP(w, r)
	})
}

func (s *server) setSessionCookie(w http.ResponseWriter, r *http.Request, token string, maxAge int) {
	http.SetCookie(w, &http.Cookie{
		Name:     sessionCookie,
		Value:    token,
		Path:     "/",
		MaxAge:   maxAge,
		HttpOnly: true,
		Secure:   r.TLS != nil,
		SameSite: http.SameSiteLaxMode,
	})
}

func (s *server) handleLogin(w http.ResponseWriter, r *http.Request) {
	addr := clientAddr(r)
	if s.limiter.blocked(addr) {
		writeError(w, http.StatusTooManyRequests, "Too many failed attempts. Try again in a few minutes.")
		return
	}
	var body struct {
		Password string `json:"password"`
	}
	if err := decodeJSON(r, &body); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request")
		return
	}
	if !verifyPassword(s.cfg.PasswordHash, body.Password) {
		s.limiter.fail(addr)
		time.Sleep(700 * time.Millisecond)
		writeError(w, http.StatusUnauthorized, "Incorrect password.")
		return
	}
	s.limiter.reset(addr)
	s.setSessionCookie(w, r, s.sessions.create(r), int(sessionTTL.Seconds()))
	writeJSON(w, http.StatusOK, s.meResponse(true))
}

func (s *server) handleLogout(w http.ResponseWriter, r *http.Request) {
	s.sessions.delete(s.sessionToken(r))
	s.setSessionCookie(w, r, "", -1)
	w.WriteHeader(http.StatusNoContent)
}

func (s *server) meResponse(authenticated bool) map[string]any {
	host, _ := os.Hostname()
	me := map[string]any{"authenticated": authenticated, "hostname": host}
	// Where the file manager may go; only revealed to a signed-in user.
	if authenticated {
		me["root"] = s.cfg.Root
		if s.owner != nil {
			me["home"] = s.owner.home
		}
	}
	return me
}

func (s *server) handleMe(w http.ResponseWriter, r *http.Request) {
	info, ok := s.sessions.check(s.sessionToken(r))
	me := s.meResponse(ok)
	if ok && info.Locked {
		me["locked"] = true
	}
	writeJSON(w, http.StatusOK, me)
}

// handleLock locks this browser's session: the desktop stays as it is, behind the lock screen.
func (s *server) handleLock(w http.ResponseWriter, r *http.Request) {
	s.sessions.setLocked(s.sessionToken(r), true)
	w.WriteHeader(http.StatusNoContent)
}

// handleUnlock takes the password again for a locked session. Not 401 for a wrong password:
// that would read as the session having ended.
func (s *server) handleUnlock(w http.ResponseWriter, r *http.Request) {
	token := s.sessionToken(r)
	if _, ok := s.sessions.check(token); !ok {
		writeError(w, http.StatusUnauthorized, "not signed in")
		return
	}
	addr := clientAddr(r)
	if s.limiter.blocked(addr) {
		writeError(w, http.StatusTooManyRequests, "Too many failed attempts. Try again in a few minutes.")
		return
	}
	var body struct {
		Password string `json:"password"`
	}
	if err := decodeJSON(r, &body); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request")
		return
	}
	if !verifyPassword(s.cfg.PasswordHash, body.Password) {
		s.limiter.fail(addr)
		time.Sleep(700 * time.Millisecond)
		writeError(w, http.StatusForbidden, "Incorrect password.")
		return
	}
	s.limiter.reset(addr)
	s.sessions.setLocked(token, false)
	w.WriteHeader(http.StatusNoContent)
}

func (s *server) handleSessions(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, s.sessions.views(s.sessionToken(r)))
}

func (s *server) handleEndSession(w http.ResponseWriter, r *http.Request) {
	if !s.sessions.deleteID(r.PathValue("id"), s.sessionToken(r)) {
		writeError(w, http.StatusNotFound, "no such session")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *server) handleEndOtherSessions(w http.ResponseWriter, r *http.Request) {
	s.sessions.deleteOthers(s.sessionToken(r))
	w.WriteHeader(http.StatusNoContent)
}

func (s *server) handleChangePassword(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Current string `json:"current"`
		Next    string `json:"next"`
	}
	if err := decodeJSON(r, &body); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request")
		return
	}
	if !verifyPassword(s.cfg.PasswordHash, body.Current) {
		writeError(w, http.StatusForbidden, "Current password is incorrect.")
		return
	}
	if len(body.Next) < 8 {
		writeError(w, http.StatusBadRequest, "New password must be at least 8 characters.")
		return
	}
	hash, err := hashPassword(body.Next)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	s.cfg.PasswordHash = hash
	if err := s.cfg.save(); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	s.sessions.deleteOthers(s.sessionToken(r))
	w.WriteHeader(http.StatusNoContent)
}
