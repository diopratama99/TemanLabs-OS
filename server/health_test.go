package main

import (
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"strconv"
	"testing"
	"time"
)

func TestHistoryMinutesAndBuckets(t *testing.T) {
	h := newHistory(t.TempDir())
	base := time.Date(2026, 10, 25, 10, 0, 0, 0, time.Local)
	st := systemStats{}
	st.Memory.Total, st.Memory.Used = 100, 25
	for i := 0; i < 6; i++ { // one minute: CPU 10, 20, … 60
		st.CPU.Usage = float64(10 * (i + 1))
		h.record(st, base.Add(time.Duration(i)*10*time.Second))
	}
	st.CPU.Usage = 5
	h.record(st, base.Add(time.Minute)) // closes the first minute
	if len(h.points) != 1 {
		t.Fatalf("points = %d", len(h.points))
	}
	p := h.points[0]
	if p.CPU != 35 || p.CPUMax != 60 || p.Mem != 25 || p.T != base.Unix() {
		t.Fatalf("minute = %+v", p)
	}

	// A gap (server off) stays empty; buckets average what's there.
	h.points = append(h.points, histPoint{T: base.Add(3 * time.Minute).Unix(), CPU: 15, CPUMax: 20})
	step, b := h.buckets(time.Hour, base.Add(4*time.Minute))
	if step != 60 || len(b) != 60 {
		t.Fatalf("step %d, %d buckets", step, len(b))
	}
	var filled int
	for _, x := range b {
		if x != nil {
			filled++
		}
	}
	if filled != 2 {
		t.Fatalf("%d filled buckets, want 2", filled)
	}

	// Saved and read back.
	if err := h.save(); err != nil {
		t.Fatal(err)
	}
	again := newHistory(filepath.Dir(h.file))
	if len(again.points) != 0 {
		// Points from "2026-10-25" are older than 30 days only if the clock says so; compare to the saved ones.
		if again.points[0] != h.points[0] {
			t.Fatalf("read back %+v", again.points[0])
		}
	}
}

func TestUptime(t *testing.T) {
	now := time.Now()
	end := now.Add(-2 * time.Hour)
	h := &appHealth{Watching: now.Add(-48 * time.Hour), Incidents: []incident{{Start: now.Add(-3 * time.Hour), End: &end}}}
	if got := uptime(h, 24*time.Hour, now); got < 0.958 || got > 0.959 { // 1 hour of 24
		t.Fatalf("24h uptime = %v", got)
	}
	// Watched for 2 hours only, down the last 30 minutes (still down).
	h2 := &appHealth{Watching: now.Add(-2 * time.Hour), Incidents: []incident{{Start: now.Add(-30 * time.Minute)}}}
	if got := uptime(h2, 7*24*time.Hour, now); got < 0.749 || got > 0.751 {
		t.Fatalf("partial uptime = %v", got)
	}
}

func TestProbeWebAndCrashRules(t *testing.T) {
	up := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Redirect(w, r, "/login", http.StatusFound) // a sign-in page counts as an answer
	}))
	defer up.Close()
	u, _ := url.Parse(up.URL)
	port, _ := strconv.Atoi(u.Port())
	s := &server{}
	a := &app{Port: &port, Scheme: "http", Path: "/", containers: []container{{State: "running", Status: "Up 3 hours"}}}
	if p := s.checkApp(t.Context(), a); p.status != "up" {
		t.Fatalf("redirecting app: %+v", p)
	}
	up.Close()
	if p := s.checkApp(t.Context(), a); p.status != "down" {
		t.Fatalf("closed port: %+v", p)
	}
	unhealthy := &app{containers: []container{{State: "running", Status: "Up 3 hours (unhealthy)"}}}
	if p := s.checkApp(t.Context(), unhealthy); p.status != "down" {
		t.Fatalf("unhealthy: %+v", p)
	}
	crashed := &app{containers: []container{{State: "exited", Status: "Exited (1) 2 minutes ago"}}}
	if p := s.checkApp(t.Context(), crashed); p.status != "down" || !p.exited {
		t.Fatalf("crashed: %+v", p)
	}
	// A helper that exited long ago while the rest runs (supabase-meta) isn't a crash.
	partial := &app{containers: []container{{State: "running", Status: "Up 2 weeks"}, {State: "exited", Status: "Exited (1) About an hour ago"}}}
	if p := s.checkApp(t.Context(), partial); p.status != "up" {
		t.Fatalf("partial: %+v", p)
	}
	stopped := &app{containers: []container{{State: "exited", Status: "Exited (143) 2 minutes ago"}}}
	if p := s.checkApp(t.Context(), stopped); p.status != "stopped" {
		t.Fatalf("stopped: %+v", p)
	}
}

func TestHealthStoreKeepsSettings(t *testing.T) {
	dir := t.TempDir()
	h := newHealthStore(dir)
	off := false
	h.app("jellyfin").AutoRestart = &off
	h.app("n8n")
	h.mu.Lock()
	h.save()
	h.mu.Unlock()
	again := newHealthStore(dir)
	if again.Apps["jellyfin"].autoRestart() || !again.Apps["n8n"].autoRestart() {
		t.Fatal("auto restart setting lost")
	}
	if _, err := os.Stat(filepath.Join(dir, "health.json")); err != nil {
		t.Fatal(err)
	}
}
