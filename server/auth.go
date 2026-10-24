package main

import (
	"crypto/rand"
	"encoding/hex"
	"net"
	"net/http"
	"os"
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

type sessions struct {
	mu     sync.Mutex
	expiry map[string]time.Time
}

func newSessions() *sessions { return &sessions{expiry: map[string]time.Time{}} }

func (s *sessions) create() string {
	b := make([]byte, 32)
	_, _ = rand.Read(b)
	token := hex.EncodeToString(b)
	s.mu.Lock()
	defer s.mu.Unlock()
	s.expiry[token] = time.Now().Add(sessionTTL)
	return token
}

func (s *sessions) valid(token string) bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	exp, ok := s.expiry[token]
	if ok && time.Now().After(exp) {
		delete(s.expiry, token)
		return false
	}
	return ok
}

func (s *sessions) delete(token string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	delete(s.expiry, token)
}

// deleteOthers signs out every session except keep (after a password change).
func (s *sessions) deleteOthers(keep string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	for token := range s.expiry {
		if token != keep {
			delete(s.expiry, token)
		}
	}
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
		if !s.sessions.valid(s.sessionToken(r)) {
			writeError(w, http.StatusUnauthorized, "not signed in")
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
	s.setSessionCookie(w, r, s.sessions.create(), int(sessionTTL.Seconds()))
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
	writeJSON(w, http.StatusOK, s.meResponse(s.sessions.valid(s.sessionToken(r))))
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
