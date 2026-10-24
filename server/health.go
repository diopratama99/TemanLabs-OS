package main

import (
	"context"
	"crypto/tls"
	"encoding/json"
	"fmt"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"slices"
	"strconv"
	"strings"
	"sync"
	"time"
)

// App health: every minute each running app is checked (Docker's own health check when it has
// one, else whether its web page answers), crashes are noticed, and an app that stops
// responding is restarted (at most a few times an hour, so a broken app doesn't loop). Every
// outage is kept for 30 days, for the uptime figures.

const (
	healthEvery     = time.Minute
	healthKeep      = 30 * 24 * time.Hour
	failsBeforeDown = 3 // minutes of no answer before an app counts as down (it may be starting)
	maxRestarts     = 3 // an hour
	maxIncidents    = 100
)

type incident struct {
	Start     time.Time  `json:"start"`
	End       *time.Time `json:"end,omitempty"`
	Reason    string     `json:"reason"`
	Restarted bool       `json:"restarted,omitempty"`
}

type appHealth struct {
	// Restart it when it stops responding (on unless turned off).
	AutoRestart *bool       `json:"autoRestart,omitempty"`
	Watching    time.Time   `json:"watching"`
	Incidents   []incident  `json:"incidents"`
	Restarts    []time.Time `json:"restarts,omitempty"`

	status string // up, down, stopped, starting, unknown
	// Stopped from TemanLabsOS: however its containers exit, that's no crash.
	userStopped bool
	since       time.Time
	fails       int
	lastError   string
	checked     time.Time
}

func (h *appHealth) autoRestart() bool { return h.AutoRestart == nil || *h.AutoRestart }

func (h *appHealth) open() *incident {
	if n := len(h.Incidents); n > 0 && h.Incidents[n-1].End == nil {
		return &h.Incidents[n-1]
	}
	return nil
}

type healthStore struct {
	mu   sync.Mutex
	file string
	Apps map[string]*appHealth `json:"apps"`
}

func newHealthStore(stateDir string) *healthStore {
	h := &healthStore{file: filepath.Join(stateDir, "health.json"), Apps: map[string]*appHealth{}}
	if data, err := os.ReadFile(h.file); err == nil {
		_ = json.Unmarshal(data, h)
	}
	if h.Apps == nil {
		h.Apps = map[string]*appHealth{}
	}
	return h
}

// save writes the file; the caller holds mu.
func (h *healthStore) save() {
	data, err := json.MarshalIndent(h, "", "  ")
	if err != nil {
		return
	}
	tmp := h.file + ".tmp"
	if os.WriteFile(tmp, data, 0o600) == nil {
		_ = os.Rename(tmp, h.file)
	}
}

// stoppedByUser notes an app stopped from TemanLabsOS, so its exit isn't taken for a crash.
func (h *healthStore) stoppedByUser(id string) {
	h.mu.Lock()
	defer h.mu.Unlock()
	a := h.app(id)
	a.userStopped = true
	if inc := a.open(); inc != nil {
		end := time.Now()
		inc.End = &end
	}
}

func (h *healthStore) app(id string) *appHealth {
	a := h.Apps[id]
	if a == nil {
		a = &appHealth{Watching: time.Now(), status: "unknown"}
		h.Apps[id] = a
	}
	return a
}

var exitedCode = regexp.MustCompile(`^Exited \((-?\d+)\)`)

// Exit codes of a stop asked for (docker stop, a shutdown), not a crash.
func cleanExit(code int) bool { return code == 0 || code == 137 || code == 143 }

type probe struct {
	status string // up, down, stopped, starting
	reason string
	// The app's containers aren't running (it crashed, or was stopped).
	exited bool
}

// check looks at one app: its containers, Docker's health check, then its web page.
func (s *server) checkApp(ctx context.Context, a *app) probe {
	if a.Source == "native" {
		if a.Port == nil {
			return probe{status: "unknown"}
		}
		return s.probeWeb(ctx, a)
	}
	running, unhealthy, starting := 0, false, false
	crash := ""
	for _, c := range a.containers {
		switch {
		case c.State == "running":
			running++
			unhealthy = unhealthy || strings.Contains(c.Status, "(unhealthy)")
			starting = starting || strings.Contains(c.Status, "(health: starting)")
		case c.State == "restarting":
			crash = "Keeps restarting"
		case c.State == "exited" || c.State == "dead":
			if m := exitedCode.FindStringSubmatch(c.Status); m != nil {
				if code, _ := strconv.Atoi(m[1]); !cleanExit(code) {
					crash = fmt.Sprintf("Stopped with an error (exit code %d)", code)
				}
			}
		}
	}
	if running == 0 {
		if crash != "" {
			return probe{status: "down", reason: crash, exited: true}
		}
		return probe{status: "stopped", exited: true}
	}
	// One part of an app stopped while the rest runs (a helper that exited long ago, a one-off
	// setup job) says nothing for sure; whether the app answers does.
	if unhealthy {
		return probe{status: "down", reason: "Its own health check fails"}
	}
	if starting {
		return probe{status: "starting"}
	}
	if a.Port == nil {
		return probe{status: "up"}
	}
	return s.probeWeb(ctx, a)
}

// probeWeb asks the app's web page; any answer at all (even an error page) means it's alive.
func (s *server) probeWeb(ctx context.Context, a *app) probe {
	host := a.host
	if host == "" {
		host = "127.0.0.1"
	}
	scheme := a.Scheme
	if scheme != "https" {
		scheme = "http"
	}
	ctx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()
	url := fmt.Sprintf("%s://%s%s", scheme, net.JoinHostPort(host, strconv.Itoa(*a.Port)), a.Path)
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return probe{status: "unknown"}
	}
	res, err := healthClient.Do(req)
	if err != nil {
		reason := "Its web page doesn’t answer"
		if ctx.Err() != nil {
			reason = "Its web page takes too long to answer"
		}
		return probe{status: "down", reason: reason}
	}
	res.Body.Close()
	if res.StatusCode >= 500 && res.StatusCode != http.StatusServiceUnavailable {
		return probe{status: "down", reason: fmt.Sprintf("Its web page answers with an error (%d)", res.StatusCode)}
	}
	return probe{status: "up"}
}

var healthClient = &http.Client{
	// A sign-in redirect is an answer too.
	CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse },
	// Apps on their own ports often have self-signed certificates.
	Transport: &http.Transport{TLSClientConfig: &tls.Config{InsecureSkipVerify: true}, DisableKeepAlives: true},
}

func (s *server) runHealth() {
	time.Sleep(30 * time.Second) // let apps start after a reboot
	for {
		s.checkHealth()
		time.Sleep(healthEvery)
	}
}

func (s *server) checkHealth() {
	ctx, cancel := context.WithTimeout(context.Background(), 50*time.Second)
	defer cancel()
	apps, err := s.store.listApps(ctx)
	if err != nil {
		return
	}
	results := make([]probe, len(apps))
	var wg sync.WaitGroup
	for i, a := range apps {
		if a.Status == "installing" {
			continue
		}
		wg.Add(1)
		go func() {
			defer wg.Done()
			results[i] = s.checkApp(ctx, a)
		}()
	}
	wg.Wait()

	now := time.Now()
	var restart []*app
	s.health.mu.Lock()
	for i, a := range apps {
		p := results[i]
		if p.status == "" {
			continue
		}
		h := s.health.app(a.ID)
		h.checked = now
		// Only an app seen running can crash; one stopped on purpose, or already stopped when
		// watching began, is just stopped.
		if p.exited && p.status == "down" && (h.userStopped || (h.status != "up" && h.status != "starting" && h.status != "down")) {
			p = probe{status: "stopped", exited: true}
		}
		if !p.exited {
			h.userStopped = false
		}
		switch p.status {
		case "down":
			h.fails++
			h.lastError = p.reason
			// A crash counts at once; no answer only after a few minutes (it may be starting).
			if !p.exited && h.fails < failsBeforeDown {
				continue
			}
			if h.status != "down" {
				h.status, h.since = "down", now
				if h.open() == nil {
					h.Incidents = append(h.Incidents, incident{Start: now, Reason: p.reason})
				}
			}
			if a.Source != "native" && h.autoRestart() && h.open() != nil && !h.open().Restarted && len(recent(h.Restarts, now)) < maxRestarts {
				h.open().Restarted = true
				h.Restarts = append(recent(h.Restarts, now), now)
				restart = append(restart, a)
			}
		default:
			if p.status != h.status {
				h.since = now
			}
			h.status, h.fails, h.lastError = p.status, 0, ""
			// Back up, or stopped on purpose: the outage is over.
			if inc := h.open(); inc != nil && p.status != "starting" {
				end := now
				inc.End = &end
			}
		}
		trim(h, now)
	}
	s.health.save()
	s.health.mu.Unlock()

	for _, a := range restart {
		for _, c := range a.containers {
			_ = s.docker.send(ctx, http.MethodPost, "/containers/"+c.ID+"/restart?t=20", nil, nil)
		}
	}
}

// recent keeps the restarts of the last hour.
func recent(times []time.Time, now time.Time) []time.Time {
	return slices.DeleteFunc(slices.Clone(times), func(t time.Time) bool { return now.Sub(t) > time.Hour })
}

// trim forgets outages over a month old.
func trim(h *appHealth, now time.Time) {
	h.Incidents = slices.DeleteFunc(h.Incidents, func(i incident) bool { return i.End != nil && now.Sub(*i.End) > healthKeep })
	if len(h.Incidents) > maxIncidents {
		h.Incidents = h.Incidents[len(h.Incidents)-maxIncidents:]
	}
}

// uptime is the share of the window an app was up, counted from when it was first watched.
func uptime(h *appHealth, window time.Duration, now time.Time) float64 {
	from := now.Add(-window)
	if h.Watching.After(from) {
		from = h.Watching
	}
	total := now.Sub(from)
	if total <= 0 {
		return 1
	}
	var down time.Duration
	for _, inc := range h.Incidents {
		end := now
		if inc.End != nil {
			end = *inc.End
		}
		start := inc.Start
		if start.Before(from) {
			start = from
		}
		if end.After(start) {
			down += end.Sub(start)
		}
	}
	return max(0, 1-down.Seconds()/total.Seconds())
}

type healthView struct {
	ID          string     `json:"id"`
	Status      string     `json:"status"`
	Since       *time.Time `json:"since,omitempty"`
	Checked     *time.Time `json:"checked,omitempty"`
	Error       string     `json:"error,omitempty"`
	AutoRestart bool       `json:"autoRestart"`
	Uptime24h   float64    `json:"uptime24h"`
	Uptime7d    float64    `json:"uptime7d"`
	Uptime30d   float64    `json:"uptime30d"`
	Watching    time.Time  `json:"watching"`
	Incidents   []incident `json:"incidents"`
}

func (s *server) handleHealth(w http.ResponseWriter, r *http.Request) {
	now := time.Now()
	s.health.mu.Lock()
	defer s.health.mu.Unlock()
	out := []healthView{}
	for id, h := range s.health.Apps {
		v := healthView{ID: id, Status: h.status, AutoRestart: h.autoRestart(), Error: h.lastError, Watching: h.Watching,
			Uptime24h: uptime(h, 24*time.Hour, now), Uptime7d: uptime(h, 7*24*time.Hour, now), Uptime30d: uptime(h, healthKeep, now)}
		if v.Status == "" {
			v.Status = "unknown"
		}
		if !h.since.IsZero() {
			since := h.since
			v.Since = &since
		}
		if !h.checked.IsZero() {
			checked := h.checked
			v.Checked = &checked
		}
		// Newest first, the last 20.
		for i := len(h.Incidents) - 1; i >= 0 && len(v.Incidents) < 20; i-- {
			v.Incidents = append(v.Incidents, h.Incidents[i])
		}
		if v.Incidents == nil {
			v.Incidents = []incident{}
		}
		out = append(out, v)
	}
	writeJSON(w, http.StatusOK, out)
}

func (s *server) handleSetHealth(w http.ResponseWriter, r *http.Request) {
	var body struct {
		AutoRestart bool `json:"autoRestart"`
	}
	if decodeJSON(r, &body) != nil {
		writeError(w, http.StatusBadRequest, "invalid request")
		return
	}
	s.health.mu.Lock()
	defer s.health.mu.Unlock()
	h := s.health.app(r.PathValue("id"))
	v := body.AutoRestart
	h.AutoRestart = &v
	s.health.save()
	w.WriteHeader(http.StatusNoContent)
}
