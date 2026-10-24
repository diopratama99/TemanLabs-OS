package main

import (
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
)

// A stand-in for an app behind Kong's Basic auth.
func basicAuthApp(user, pass string) *httptest.Server {
	return httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if u, p, ok := r.BasicAuth(); !ok || u != user || p != pass {
			w.Header().Set("WWW-Authenticate", `Basic realm="service"`)
			w.WriteHeader(http.StatusUnauthorized)
			return
		}
		w.Header().Set("X-Frame-Options", "DENY")
		w.Write([]byte("studio"))
	}))
}

func TestProbeFrameBasic(t *testing.T) {
	app := basicAuthApp("supabase", "secret")
	defer app.Close()
	p, err := probeFrame(app.URL+"/", "")
	if err != nil || !p.basic {
		t.Fatalf("no login: %+v %v", p, err)
	}
	p, _ = probeFrame(app.URL+"/", appLogin{"supabase", "wrong"}.header())
	if !p.basic {
		t.Fatal("wrong password accepted")
	}
	p, _ = probeFrame(app.URL+"/", appLogin{"supabase", "secret"}.header())
	if p.basic || !p.blocked {
		t.Fatalf("right password: %+v", p)
	}
}

func TestBearerIsNotABasicChallenge(t *testing.T) {
	res := &http.Response{StatusCode: http.StatusUnauthorized, Header: http.Header{"Www-Authenticate": {"Bearer"}}}
	if isBasicChallenge(res) {
		t.Fatal("bearer treated as basic")
	}
}

func TestAppLoginsSaved(t *testing.T) {
	dir := t.TempDir()
	l := newAppLogins(dir)
	if err := l.set("supabase", &appLogin{"supabase", "secret"}); err != nil {
		t.Fatal(err)
	}
	info, _ := os.Stat(filepath.Join(dir, "app-logins.json"))
	if info.Mode().Perm() != 0o600 {
		t.Fatalf("mode %v", info.Mode())
	}
	if got, ok := newAppLogins(dir).get("supabase"); !ok || got.Password != "secret" {
		t.Fatalf("not reloaded: %+v", got)
	}
	_ = l.set("supabase", nil)
	if _, ok := newAppLogins(dir).get("supabase"); ok {
		t.Fatal("not forgotten")
	}
}
