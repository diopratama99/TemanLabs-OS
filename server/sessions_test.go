package main

import (
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestSessionsReadTheFirstFormat(t *testing.T) {
	dir := t.TempDir()
	exp := time.Now().Add(time.Hour).UTC().Format(time.RFC3339Nano)
	_ = os.WriteFile(filepath.Join(dir, "sessions.json"), []byte(`{"`+hashToken("tok")+`":"`+exp+`"}`), 0o600)
	s := newSessions(dir)
	if !s.valid("tok") {
		t.Fatal("old session lost")
	}
}

func TestLockedSessionIsRefused(t *testing.T) {
	srv := &server{sessions: newSessions(t.TempDir())}
	req := httptest.NewRequest(http.MethodGet, "/api/system", nil)
	req.Header.Set("User-Agent", "test-browser")
	token := srv.sessions.create(req)
	req.AddCookie(&http.Cookie{Name: sessionCookie, Value: token})
	ok := srv.requireAuth(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(http.StatusTeapot) }))

	rec := httptest.NewRecorder()
	ok.ServeHTTP(rec, req)
	if rec.Code != http.StatusTeapot {
		t.Fatalf("unlocked: %d", rec.Code)
	}
	srv.sessions.setLocked(token, true)
	rec = httptest.NewRecorder()
	ok.ServeHTTP(rec, req)
	if rec.Code != http.StatusLocked {
		t.Fatalf("locked: %d", rec.Code)
	}
	if srv.sessions.valid(token) {
		t.Fatal("a locked session passed the frame proxies' check")
	}
	srv.sessions.setLocked(token, false)
	if !srv.sessions.valid(token) {
		t.Fatal("still locked")
	}
}

func TestSessionViewsAndEnding(t *testing.T) {
	s := newSessions(t.TempDir())
	req := httptest.NewRequest(http.MethodGet, "/", nil)
	req.Header.Set("User-Agent", "laptop")
	mine := s.create(req)
	req.Header.Set("User-Agent", "phone")
	other := s.create(req)
	views := s.views(mine)
	if len(views) != 2 || !views[0].Current || views[0].Agent != "laptop" {
		t.Fatalf("views: %+v", views)
	}
	if s.deleteID(views[0].ID, mine) {
		t.Fatal("ended the current session")
	}
	if !s.deleteID(views[1].ID, mine) || s.valid(other) {
		t.Fatal("other session not ended")
	}
	if !s.valid(mine) || strings.Contains(views[1].ID, mine) {
		t.Fatal("current session hurt, or the ID shows the token")
	}
}
