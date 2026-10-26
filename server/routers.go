package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"net"
	"net/http"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"slices"
	"strconv"
	"strings"
	"sync"
	"time"

	"golang.org/x/crypto/ssh"
)

// Routers: the network's modems, routers and access points. The server checks each one every 30
// seconds, and whether the internet answers through them, keeps 30 days of outages, and can
// restart a router: over SSH (MikroTik, OpenWrt and other Linux-based routers) or by switching its
// smart plug off and on (any router). Restarting by itself is off unless turned on per router; it
// waits a few minutes, never runs more than one restart at a time, and stops after two restarts
// that didn't help, leaving the router to be checked by hand.

const (
	routerEvery = 30 * time.Second
	// Failed checks in a row before a router counts as down (a lost ping isn't an outage).
	routerDownAfter = 2
	// Down (or without internet) this long before a router is restarted by itself.
	routerRestartAfter = 3 * time.Minute
	// After a restart, how long the router gets to come back before it's judged again.
	routerBootWait = 5 * time.Minute
	// Restarts by itself that didn't help before it's left to be checked by hand.
	routerMaxAuto    = 2
	routerKeep       = 30 * 24 * time.Hour
	routerMaxEvents  = 60
	routerInternetID = "internet"
)

var routerKinds = map[string]bool{"modem": true, "router": true, "ap": true, "other": true}

// routerRestart is how a router can be restarted, with the sign-in it needs.
type routerRestart struct {
	// "": not set up; mikrotik and ssh: a command over SSH; tasmota and shelly: its smart plug.
	Method   string `json:"method"`
	Username string `json:"username,omitempty"`
	Password string `json:"password,omitempty"`
	// SSH port (22 when 0).
	Port int `json:"port,omitempty"`
	// For ssh: the command that restarts it ("reboot" when empty).
	Command string `json:"command,omitempty"`
	// The smart plug's address, for tasmota and shelly.
	Plug string `json:"plug,omitempty"`
	// The router's SSH host key, remembered the first time, so another machine can't take its place.
	HostKey string `json:"hostKey,omitempty"`
}

type routerConf struct {
	ID   string `json:"id"`
	Name string `json:"name"`
	Host string `json:"host"`
	Kind string `json:"kind"`
	// The router this one connects through; empty for the one facing the internet.
	Parent string `json:"parent,omitempty"`
	// Its admin page (http://<host> when empty).
	AdminURL    string        `json:"adminUrl,omitempty"`
	Restart     routerRestart `json:"restart"`
	AutoRestart bool          `json:"autoRestart"`
	Added       time.Time     `json:"added"`
}

type routerEvent struct {
	Time time.Time `json:"time"`
	Text string    `json:"text"`
	// Something went wrong (a failed restart, giving up).
	Bad bool `json:"bad,omitempty"`
}

// routerLive is what the checks found; it isn't saved.
type routerLive struct {
	status  string // up, down, affected (behind a router that's down), unknown
	latency int
	since   time.Time
	checked time.Time
	fails   int
	// Restarts by itself since it last worked, and when the last restart was.
	autoTries   int
	lastRestart time.Time
	gaveUp      bool
	restarting  bool
}

type routerStore struct {
	mu   sync.Mutex
	path string
	// Saved: the routers, their outages (and the internet's, under "internet"), and what was done.
	Routers []routerConf             `json:"routers"`
	History map[string][]incident    `json:"history"`
	Events  map[string][]routerEvent `json:"events"`

	live     map[string]*routerLive
	internet struct {
		up      *bool
		since   time.Time
		latency int
		checked time.Time
	}
}

func newRouterStore(stateDir string) *routerStore {
	st := &routerStore{path: filepath.Join(stateDir, "routers.json"), live: map[string]*routerLive{}}
	if data, err := os.ReadFile(st.path); err == nil {
		_ = json.Unmarshal(data, st)
	}
	if st.History == nil {
		st.History = map[string][]incident{}
	}
	if st.Events == nil {
		st.Events = map[string][]routerEvent{}
	}
	return st
}

// save writes the file (root only: it holds router passwords); the caller holds mu.
func (st *routerStore) save() error {
	data, err := json.MarshalIndent(st, "", "  ")
	if err != nil {
		return err
	}
	tmp := st.path + ".tmp"
	if err := os.WriteFile(tmp, data, 0o600); err != nil {
		return err
	}
	return os.Rename(tmp, st.path)
}

func (st *routerStore) liveOf(id string) *routerLive {
	l := st.live[id]
	if l == nil {
		l = &routerLive{status: "unknown"}
		st.live[id] = l
	}
	return l
}

func (st *routerStore) find(id string) (routerConf, bool) {
	for _, r := range st.Routers {
		if r.ID == id {
			return r, true
		}
	}
	return routerConf{}, false
}

// event notes something done to a router; the caller holds mu.
func (st *routerStore) event(id, text string, bad bool) {
	ev := append(st.Events[id], routerEvent{Time: time.Now(), Text: text, Bad: bad})
	if len(ev) > routerMaxEvents {
		ev = ev[len(ev)-routerMaxEvents:]
	}
	st.Events[id] = ev
}

// outage opens or closes the open incident of id; the caller holds mu.
func (st *routerStore) outage(id string, down bool, reason string, at time.Time) {
	list := st.History[id]
	open := len(list) > 0 && list[len(list)-1].End == nil
	switch {
	case down && !open:
		list = append(list, incident{Start: at, Reason: reason})
	case !down && open:
		end := at
		list[len(list)-1].End = &end
	}
	cut := time.Now().Add(-routerKeep)
	for len(list) > 0 && list[0].End != nil && list[0].End.Before(cut) {
		list = list[1:]
	}
	st.History[id] = list
}

// outageFree is the share of the last window (or since the router was added) it was up.
func outageFree(list []incident, window time.Duration, added time.Time) float64 {
	now := time.Now()
	from := now.Add(-window)
	if added.After(from) {
		from = added
	}
	total := now.Sub(from)
	if total <= 0 {
		return 1
	}
	var down time.Duration
	for _, in := range list {
		end := now
		if in.End != nil {
			end = *in.End
		}
		start := in.Start
		if start.Before(from) {
			start = from
		}
		if end.After(start) {
			down += end.Sub(start)
		}
	}
	return max(0, 1-float64(down)/float64(total))
}

// ----- Checking -----

// Ports routers answer on: web admin, SSH, DNS, MikroTik's Winbox, TR-069 on ISP modems.
var routerPorts = []int{80, 443, 22, 53, 8291, 7547}

// probeRouter: is it there, and how fast does it answer? A refused port proves it's there too.
func probeRouter(ctx context.Context, host string) (bool, int) {
	ctx, cancel := context.WithTimeout(ctx, 2*time.Second)
	defer cancel()
	type result struct {
		ok bool
		ms int
	}
	results := make(chan result, len(routerPorts)+1)
	for _, p := range routerPorts {
		go func() {
			start := time.Now()
			conn, err := (&net.Dialer{}).DialContext(ctx, "tcp", net.JoinHostPort(host, strconv.Itoa(p)))
			if err == nil {
				conn.Close()
			}
			results <- result{err == nil || isRefused(err), max(1, int(time.Since(start).Milliseconds()))}
		}()
	}
	go func() {
		start := time.Now()
		ok := exec.CommandContext(ctx, "ping", "-c", "1", "-W", "1", "--", host).Run() == nil
		results <- result{ok, max(1, int(time.Since(start).Milliseconds()))}
	}()
	best, up := 0, false
	for range len(routerPorts) + 1 {
		if r := <-results; r.ok && (!up || r.ms < best) {
			up, best = true, r.ms
		}
	}
	return up, best
}

// probeInternet: does the internet answer from this server (two big public resolvers)?
func probeInternet(ctx context.Context) (bool, int) {
	ctx, cancel := context.WithTimeout(ctx, 4*time.Second)
	defer cancel()
	done := make(chan int, 3)
	for _, addr := range []string{"1.1.1.1:443", "8.8.8.8:53", "9.9.9.9:443"} {
		go func() {
			start := time.Now()
			conn, err := (&net.Dialer{}).DialContext(ctx, "tcp", addr)
			if err != nil {
				done <- -1
				return
			}
			conn.Close()
			done <- max(1, int(time.Since(start).Milliseconds()))
		}()
	}
	for range 3 {
		if ms := <-done; ms > 0 {
			return true, ms
		}
	}
	return false, 0
}

// sameHost: does host name the address ip (directly, or as a name that resolves to it)?
func sameHost(host, ip string) bool {
	if host == ip || ip == "" {
		return host == ip
	}
	if net.ParseIP(host) != nil {
		return false
	}
	addrs, _ := net.DefaultResolver.LookupHost(context.Background(), host)
	return slices.Contains(addrs, ip)
}

func (s *server) runRouters() {
	for {
		s.checkRouters(context.Background())
		time.Sleep(routerEvery)
	}
}

func (s *server) checkRouters(ctx context.Context) {
	st := s.routers
	st.mu.Lock()
	list := slices.Clone(st.Routers)
	st.mu.Unlock()
	if len(list) == 0 {
		return
	}
	type found struct {
		up bool
		ms int
	}
	results := make(map[string]found, len(list))
	var mu sync.Mutex
	var wg sync.WaitGroup
	for _, r := range list {
		wg.Add(1)
		go func() {
			defer wg.Done()
			up, ms := probeRouter(ctx, r.Host)
			mu.Lock()
			results[r.ID] = found{up, ms}
			mu.Unlock()
		}()
	}
	netUp, netMs := probeInternet(ctx)
	wg.Wait()
	gateway := defaultGateway()
	now := time.Now()

	st.mu.Lock()
	defer st.mu.Unlock()
	if st.internet.up == nil || *st.internet.up != netUp {
		st.internet.since = now
	}
	st.internet.up, st.internet.latency, st.internet.checked = &netUp, netMs, now
	st.outage(routerInternetID, !netUp, "No answer from the internet", now)

	byID := map[string]routerConf{}
	for _, r := range list {
		byID[r.ID] = r
	}
	// Own result first; then a down router's routers behind it are "affected", not down themselves.
	for _, r := range list {
		l := st.liveOf(r.ID)
		f := results[r.ID]
		l.checked = now
		if f.up {
			l.fails, l.latency = 0, f.ms
		} else {
			l.fails++
		}
		status := l.status
		switch {
		case f.up:
			status = "up"
		case l.fails >= routerDownAfter:
			status = "down"
		}
		if status != l.status {
			l.status, l.since = status, now
		}
	}
	for _, r := range list {
		l := st.liveOf(r.ID)
		if l.status != "down" {
			continue
		}
		for p, seen := r.Parent, 0; p != "" && seen < len(list); seen++ {
			if pl := st.live[p]; pl != nil && pl.status == "down" {
				l.status = "affected"
				break
			}
			p = byID[p].Parent
		}
	}
	for _, r := range list {
		l := st.liveOf(r.ID)
		st.outage(r.ID, l.status == "down", "Not answering", now)
		// Working again (and the internet with it): restarts by itself start counting afresh.
		if l.status == "up" && netUp {
			l.autoTries, l.gaveUp = 0, false
		}
	}
	_ = st.save()

	// What to restart by itself: a router that's down (only its smart plug can reach it then), or,
	// when the internet is down but the gateway answers, the first router up the gateway's chain
	// (the modem, usually) that is set to restart by itself.
	var gw *routerConf
	for i := range list {
		if sameHost(list[i].Host, gateway) {
			gw = &list[i]
		}
	}
	var targets []routerConf
	for _, r := range list {
		l := st.liveOf(r.ID)
		if l.status == "down" && now.Sub(l.since) >= routerRestartAfter {
			targets = append(targets, r)
		}
	}
	if gw != nil && !netUp && st.liveOf(gw.ID).status == "up" && now.Sub(st.internet.since) >= routerRestartAfter {
		chain := []routerConf{*gw}
		for p := gw.Parent; p != "" && len(chain) <= len(list); p = byID[p].Parent {
			if pr, ok := byID[p]; ok {
				chain = append([]routerConf{pr}, chain...)
			}
		}
		for _, r := range chain {
			if r.AutoRestart && r.Restart.Method != "" && st.liveOf(r.ID).status == "up" {
				targets = append(targets, r)
				break
			}
		}
	}
	for _, r := range targets {
		s.autoRestart(r)
	}
}

// autoRestart restarts a router by itself, within the limits; the caller holds st.mu.
func (s *server) autoRestart(r routerConf) {
	st := s.routers
	l := st.liveOf(r.ID)
	if !r.AutoRestart || l.gaveUp || l.restarting || time.Since(l.lastRestart) < routerBootWait {
		return
	}
	why := "it stopped answering"
	if l.status == "up" {
		why = "the internet was down"
	}
	if r.Restart.Method == "" {
		return
	}
	if l.status != "up" && !isPlug(r.Restart.Method) {
		// SSH needs the router to answer; only a smart plug can restart one that doesn't.
		if l.autoTries == 0 {
			st.event(r.ID, "Can’t restart it by itself: it doesn’t answer, and only a smart plug can restart a router then. Check it by hand.", true)
			l.autoTries, l.gaveUp = routerMaxAuto, true
		}
		return
	}
	if l.autoTries >= routerMaxAuto {
		l.gaveUp = true
		st.event(r.ID, fmt.Sprintf("Restarted %d times without it helping; it won’t restart by itself again until it works. Check it by hand.", routerMaxAuto), true)
		_ = st.save()
		return
	}
	l.autoTries++
	l.lastRestart = time.Now()
	l.restarting = true
	go func() {
		ctx, cancel := context.WithTimeout(context.Background(), 45*time.Second)
		defer cancel()
		err := restartRouter(ctx, r)
		st.mu.Lock()
		defer st.mu.Unlock()
		l.restarting = false
		if err != nil {
			st.event(r.ID, "Restart by itself failed: "+err.Error(), true)
		} else {
			st.event(r.ID, "Restarted by itself, because "+why+".", false)
		}
		_ = st.save()
	}()
}

// ----- Restarting -----

func isPlug(method string) bool { return method == "tasmota" || method == "shelly" }

func restartRouter(ctx context.Context, r routerConf) error {
	switch r.Restart.Method {
	case "mikrotik":
		// RouterOS asks to confirm a reboot; the y on stdin answers it.
		_, err := sshRun(ctx, r, "/system reboot", "y\n", true)
		return err
	case "ssh":
		cmd := strings.TrimSpace(r.Restart.Command)
		if cmd == "" {
			cmd = "reboot"
		}
		_, err := sshRun(ctx, r, cmd, "", true)
		return err
	case "tasmota", "shelly":
		return plugCycle(ctx, r.Restart)
	}
	return errors.New("no way to restart it is set up")
}

// testRestart checks the sign-in without restarting: SSH logs in and runs nothing, a plug is asked
// whether it's on. For SSH it returns the host key to remember.
func testRestart(ctx context.Context, r routerConf) (hostKey, msg string, err error) {
	switch r.Restart.Method {
	case "mikrotik", "ssh":
		key, err := sshRun(ctx, r, "", "", false)
		if err != nil {
			return "", "", err
		}
		return key, "Signed in over SSH. The router can be restarted from here.", nil
	case "tasmota", "shelly":
		on, err := plugState(ctx, r.Restart)
		if err != nil {
			return "", "", err
		}
		if !on {
			return "", "The plug answers, but it’s switched off.", nil
		}
		return "", "The plug answers and is on. Restarting switches it off for 10 seconds; the plug switches itself back on.", nil
	}
	return "", "", errors.New("choose how to restart it first")
}

var errHostKeyChanged = errors.New("the router’s SSH key changed since it was set up: another device may be answering at this address. If the router was reset or replaced, save it again with its password")

// sshRun signs in to the router and runs cmd (nothing when cmd is ""). A reboot drops the
// connection before the command ends, which counts as success when ended is true. It returns
// the host key's fingerprint.
func sshRun(ctx context.Context, r routerConf, cmd, stdin string, reboot bool) (string, error) {
	port := r.Restart.Port
	if port == 0 {
		port = 22
	}
	seen := ""
	supported, insecure := ssh.SupportedAlgorithms(), ssh.InsecureAlgorithms()
	cfg := &ssh.ClientConfig{
		User: r.Restart.Username,
		Auth: []ssh.AuthMethod{
			ssh.Password(r.Restart.Password),
			ssh.KeyboardInteractive(func(_, _ string, questions []string, _ []bool) ([]string, error) {
				answers := make([]string, len(questions))
				for i := range answers {
					answers[i] = r.Restart.Password
				}
				return answers, nil
			}),
		},
		HostKeyCallback: func(_ string, _ net.Addr, key ssh.PublicKey) error {
			seen = ssh.FingerprintSHA256(key)
			if r.Restart.HostKey != "" && r.Restart.HostKey != seen {
				return errHostKeyChanged
			}
			return nil
		},
		// Routers often run old SSH servers; the newer algorithms are still tried first.
		HostKeyAlgorithms: append(supported.HostKeys, insecure.HostKeys...),
		Config: ssh.Config{
			KeyExchanges: append(supported.KeyExchanges, insecure.KeyExchanges...),
			Ciphers:      append(supported.Ciphers, insecure.Ciphers...),
			MACs:         append(supported.MACs, insecure.MACs...),
		},
		Timeout: 10 * time.Second,
	}
	addr := net.JoinHostPort(r.Host, strconv.Itoa(port))
	conn, err := (&net.Dialer{Timeout: 10 * time.Second}).DialContext(ctx, "tcp", addr)
	if err != nil {
		return "", fmt.Errorf("can’t reach SSH on %s: %s", addr, netReason(err))
	}
	defer conn.Close()
	if deadline, ok := ctx.Deadline(); ok {
		_ = conn.SetDeadline(deadline)
	}
	c, chans, reqs, err := ssh.NewClientConn(conn, addr, cfg)
	if err != nil {
		if errors.Is(err, errHostKeyChanged) {
			return "", errHostKeyChanged
		}
		if strings.Contains(err.Error(), "unable to authenticate") {
			return "", errors.New("the router didn’t accept that username and password")
		}
		return "", fmt.Errorf("SSH: %w", err)
	}
	client := ssh.NewClient(c, chans, reqs)
	defer client.Close()
	if cmd == "" {
		return seen, nil
	}
	session, err := client.NewSession()
	if err != nil {
		return "", err
	}
	defer session.Close()
	session.Stdin = strings.NewReader(stdin)
	out, err := session.CombinedOutput(cmd)
	if err != nil {
		var exitErr *ssh.ExitError
		if reboot && !errors.As(err, &exitErr) {
			// The router went down mid-command: that's the reboot.
			return seen, nil
		}
		msg := strings.TrimSpace(lastLines(string(out), 2))
		if msg == "" {
			msg = err.Error()
		}
		return "", errors.New(msg)
	}
	return seen, nil
}

var plugClient = &http.Client{Timeout: 8 * time.Second}

// netReason says why a connection failed, in a few words.
func netReason(err error) string {
	var ne net.Error
	msg := err.Error()
	switch {
	case errors.As(err, &ne) && ne.Timeout(), strings.Contains(msg, "deadline exceeded"):
		return "it doesn’t answer"
	case strings.Contains(msg, "connection refused"):
		return "it refuses the connection (is the service turned on?)"
	case strings.Contains(msg, "no route to host"), strings.Contains(msg, "network is unreachable"):
		return "there’s no route to it from this server"
	case strings.Contains(msg, "no such host"):
		return "that name isn’t known"
	}
	return msg
}

func plugGet(ctx context.Context, rr routerRestart, path string) ([]byte, int, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, "http://"+rr.Plug+path, nil)
	if err != nil {
		return nil, 0, err
	}
	if rr.Method == "shelly" && rr.Username != "" {
		req.SetBasicAuth(rr.Username, rr.Password)
	}
	res, err := plugClient.Do(req)
	if err != nil {
		return nil, 0, fmt.Errorf("can’t reach the plug at %s: %s", rr.Plug, netReason(err))
	}
	defer res.Body.Close()
	body, _ := io.ReadAll(io.LimitReader(res.Body, 64<<10))
	if res.StatusCode == http.StatusUnauthorized {
		return nil, res.StatusCode, errors.New("the plug asks for a password: enter it, or turn its password off in the plug’s settings")
	}
	return body, res.StatusCode, nil
}

// tasmotaPath is a Tasmota command URL, with the web password when there is one.
func tasmotaPath(rr routerRestart, cmnd string) string {
	q := url.Values{"cmnd": {cmnd}}
	if rr.Password != "" {
		q.Set("user", orDefault(rr.Username, "admin"))
		q.Set("password", rr.Password)
	}
	return "/cm?" + q.Encode()
}

func orDefault(s, fallback string) string {
	if s == "" {
		return fallback
	}
	return s
}

// plugState asks the plug whether it's on.
func plugState(ctx context.Context, rr routerRestart) (bool, error) {
	if rr.Method == "tasmota" {
		body, _, err := plugGet(ctx, rr, tasmotaPath(rr, "Power1"))
		if err != nil {
			return false, err
		}
		var res map[string]any
		if json.Unmarshal(body, &res) != nil {
			return false, errors.New("that address doesn’t answer like a Tasmota plug")
		}
		if w, ok := res["WARNING"].(string); ok {
			return false, errors.New("Tasmota: " + w)
		}
		for _, k := range []string{"POWER1", "POWER"} {
			if v, ok := res[k].(string); ok {
				return v == "ON", nil
			}
		}
		return false, errors.New("that address doesn’t answer like a Tasmota plug")
	}
	// Shelly: Gen2 and later answer RPC; Gen1 its relay page.
	if body, code, err := plugGet(ctx, rr, "/rpc/Switch.GetStatus?id=0"); err == nil && code == http.StatusOK {
		var res struct {
			Output *bool `json:"output"`
		}
		if json.Unmarshal(body, &res) == nil && res.Output != nil {
			return *res.Output, nil
		}
	} else if err != nil {
		return false, err
	}
	body, code, err := plugGet(ctx, rr, "/relay/0")
	if err != nil {
		return false, err
	}
	var res struct {
		IsOn *bool `json:"ison"`
	}
	if code != http.StatusOK || json.Unmarshal(body, &res) != nil || res.IsOn == nil {
		return false, errors.New("that address doesn’t answer like a Shelly plug")
	}
	return *res.IsOn, nil
}

// plugCycle switches the plug off and has the plug itself switch back on 10 seconds later, so
// the router comes back even if the plug can't be reached while the router is off.
func plugCycle(ctx context.Context, rr routerRestart) error {
	if rr.Method == "tasmota" {
		body, _, err := plugGet(ctx, rr, tasmotaPath(rr, "Backlog Power1 Off; Delay 100; Power1 On"))
		if err != nil {
			return err
		}
		if strings.Contains(string(body), "WARNING") {
			return errors.New("Tasmota: " + strings.TrimSpace(string(body)))
		}
		return nil
	}
	body, code, err := plugGet(ctx, rr, "/rpc/Switch.Set?id=0&on=false&toggle_after=10")
	if err != nil {
		return err
	}
	if code == http.StatusOK && !strings.Contains(string(body), `"code"`) {
		return nil
	}
	_, code, err = plugGet(ctx, rr, "/relay/0?turn=off&timer=10")
	if err != nil {
		return err
	}
	if code != http.StatusOK {
		return fmt.Errorf("the plug answered %d", code)
	}
	return nil
}

// ----- API -----

type routerView struct {
	routerConf
	// The password stays on the server.
	HasPassword bool          `json:"hasPassword"`
	Status      string        `json:"status"`
	Latency     int           `json:"latency,omitempty"`
	Since       time.Time     `json:"since,omitzero"`
	Checked     time.Time     `json:"checked,omitzero"`
	Gateway     bool          `json:"gateway"`
	Uptime24h   float64       `json:"uptime24h"`
	Uptime7d    float64       `json:"uptime7d"`
	Incidents   []incident    `json:"incidents"`
	Events      []routerEvent `json:"events"`
	Restarting  bool          `json:"restarting"`
	GaveUp      bool          `json:"gaveUp"`
}

type routersInfo struct {
	Routers  []routerView `json:"routers"`
	Gateway  string       `json:"gateway"`
	Internet struct {
		Up        *bool      `json:"up"`
		Since     time.Time  `json:"since,omitzero"`
		Latency   int        `json:"latency,omitempty"`
		Uptime24h float64    `json:"uptime24h"`
		Incidents []incident `json:"incidents"`
	} `json:"internet"`
}

// newestFirst returns up to n of the list, newest first.
func newestFirst[T any](list []T, n int) []T {
	out := make([]T, 0, min(n, len(list)))
	for i := len(list) - 1; i >= 0 && len(out) < n; i-- {
		out = append(out, list[i])
	}
	return out
}

func (s *server) handleRouters(w http.ResponseWriter, r *http.Request) {
	st := s.routers
	gateway := defaultGateway()
	st.mu.Lock()
	defer st.mu.Unlock()
	info := routersInfo{Routers: []routerView{}, Gateway: gateway}
	for _, rc := range st.Routers {
		l := st.liveOf(rc.ID)
		v := routerView{
			routerConf: rc, HasPassword: rc.Restart.Password != "", Status: l.status, Latency: l.latency,
			Since: l.since, Checked: l.checked, Gateway: sameHost(rc.Host, gateway),
			Uptime24h: outageFree(st.History[rc.ID], 24*time.Hour, rc.Added), Uptime7d: outageFree(st.History[rc.ID], 7*24*time.Hour, rc.Added),
			Incidents: newestFirst(st.History[rc.ID], 20), Events: newestFirst(st.Events[rc.ID], 20),
			Restarting: l.restarting, GaveUp: l.gaveUp,
		}
		v.Restart.Password, v.Restart.HostKey = "", ""
		info.Routers = append(info.Routers, v)
	}
	info.Internet.Up, info.Internet.Since, info.Internet.Latency = st.internet.up, st.internet.since, st.internet.latency
	first := time.Now()
	for _, rc := range st.Routers {
		if rc.Added.Before(first) {
			first = rc.Added
		}
	}
	info.Internet.Uptime24h = outageFree(st.History[routerInternetID], 24*time.Hour, first)
	info.Internet.Incidents = newestFirst(st.History[routerInternetID], 20)
	writeJSON(w, http.StatusOK, info)
}

// normalize checks a router from the browser; old is the saved one, whose password and host key
// are kept when the form leaves the password empty.
func (rc *routerConf) normalize(old *routerConf, others []routerConf) error {
	rc.Name, rc.Host = strings.TrimSpace(rc.Name), strings.TrimSpace(rc.Host)
	rc.AdminURL = strings.TrimSpace(rc.AdminURL)
	rr := &rc.Restart
	rr.Username, rr.Plug, rr.Command = strings.TrimSpace(rr.Username), strings.TrimSpace(rr.Plug), strings.TrimSpace(rr.Command)
	if rc.Name == "" {
		return errors.New("give the router a name")
	}
	if rc.Host == "" || !hostPattern.MatchString(rc.Host) {
		return errors.New("enter the router’s IP address, like 192.168.1.1")
	}
	if !routerKinds[rc.Kind] {
		rc.Kind = "router"
	}
	if rc.AdminURL != "" && !strings.HasPrefix(rc.AdminURL, "http://") && !strings.HasPrefix(rc.AdminURL, "https://") {
		return errors.New("the admin page should start with http:// or https://")
	}
	if rc.Parent != "" {
		if rc.Parent == rc.ID {
			return errors.New("a router can’t connect through itself")
		}
		parents := map[string]string{}
		for _, o := range others {
			parents[o.ID] = o.Parent
		}
		if _, ok := parents[rc.Parent]; !ok {
			return errors.New("the router it connects through isn’t in the list")
		}
		for p, n := rc.Parent, 0; p != "" && n <= len(others); p, n = parents[p], n+1 {
			if p == rc.ID {
				return errors.New("that would make the routers connect through each other in a circle")
			}
		}
	}
	switch rr.Method {
	case "":
		*rr = routerRestart{}
	case "mikrotik", "ssh":
		rr.Plug = ""
		if rr.Port < 0 || rr.Port > 65535 {
			return errors.New("the SSH port should be between 1 and 65535")
		}
		if rr.Username == "" {
			return errors.New("enter the username to sign in to the router with")
		}
		if rr.Method == "mikrotik" {
			rr.Command = ""
		}
	case "tasmota", "shelly":
		rr.Port, rr.Command = 0, ""
		if rr.Plug == "" || !hostPattern.MatchString(rr.Plug) {
			return errors.New("enter the smart plug’s IP address")
		}
	default:
		return errors.New("unknown way to restart")
	}
	if old != nil {
		rc.Added = old.Added
		sameTarget := old.Host == rc.Host && old.Restart.Method == rr.Method && old.Restart.Port == rr.Port
		if rr.Password == "" && old.Restart.Method == rr.Method {
			rr.Password = old.Restart.Password
		}
		if sameTarget && rr.HostKey == "" {
			rr.HostKey = old.Restart.HostKey
		}
	}
	if rc.Added.IsZero() {
		rc.Added = time.Now()
	}
	if rr.Method == "" {
		rc.AutoRestart = false
	}
	return nil
}

func (s *server) handleSaveRouter(w http.ResponseWriter, r *http.Request) {
	var rc routerConf
	if err := decodeJSON(r, &rc); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request")
		return
	}
	id := r.PathValue("id")
	st := s.routers
	st.mu.Lock()
	defer st.mu.Unlock()
	var old *routerConf
	if id != "" {
		i := slices.IndexFunc(st.Routers, func(x routerConf) bool { return x.ID == id })
		if i < 0 {
			writeError(w, http.StatusNotFound, "no such router")
			return
		}
		o := st.Routers[i]
		old = &o
		rc.ID = id
	} else {
		rc.ID = newDeviceID()
	}
	rc.Restart.HostKey = ""
	if err := rc.normalize(old, st.Routers); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	if old != nil {
		i := slices.IndexFunc(st.Routers, func(x routerConf) bool { return x.ID == id })
		st.Routers[i] = rc
		if old.AutoRestart != rc.AutoRestart || old.Restart.Method != rc.Restart.Method {
			l := st.liveOf(id)
			l.autoTries, l.gaveUp = 0, false
		}
	} else {
		st.Routers = append(st.Routers, rc)
	}
	if err := st.save(); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	go s.checkRouters(context.Background())
	writeJSON(w, http.StatusOK, map[string]string{"id": rc.ID})
}

func (s *server) handleDeleteRouter(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	st := s.routers
	st.mu.Lock()
	defer st.mu.Unlock()
	i := slices.IndexFunc(st.Routers, func(x routerConf) bool { return x.ID == id })
	if i < 0 {
		writeError(w, http.StatusNotFound, "no such router")
		return
	}
	st.Routers = slices.Delete(st.Routers, i, i+1)
	// The ones behind it now connect through what it connected through.
	for j := range st.Routers {
		if st.Routers[j].Parent == id {
			st.Routers[j].Parent = ""
		}
	}
	delete(st.History, id)
	delete(st.Events, id)
	delete(st.live, id)
	_ = st.save()
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

// routerForRequest is the saved router, or (when the body has one) the form's, for testing a
// sign-in before saving it.
func (s *server) routerForRequest(r *http.Request) (routerConf, int, error) {
	id := r.PathValue("id")
	st := s.routers
	st.mu.Lock()
	saved, ok := st.find(id)
	others := slices.Clone(st.Routers)
	st.mu.Unlock()
	if id != "new" && !ok {
		return routerConf{}, http.StatusNotFound, errors.New("no such router")
	}
	if r.ContentLength == 0 {
		return saved, 0, nil
	}
	var form routerConf
	if err := decodeJSON(r, &form); err != nil {
		return routerConf{}, http.StatusBadRequest, errors.New("invalid request")
	}
	form.ID = id
	var old *routerConf
	if ok {
		old = &saved
	}
	form.Restart.HostKey = ""
	if err := form.normalize(old, others); err != nil {
		return routerConf{}, http.StatusBadRequest, err
	}
	return form, 0, nil
}

func (s *server) handleTestRouter(w http.ResponseWriter, r *http.Request) {
	rc, code, err := s.routerForRequest(r)
	if err != nil {
		writeError(w, code, err.Error())
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 25*time.Second)
	defer cancel()
	key, msg, err := testRestart(ctx, rc)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	// Remember the SSH key of a saved router the first time it's seen.
	if key != "" && rc.ID != "new" {
		st := s.routers
		st.mu.Lock()
		if i := slices.IndexFunc(st.Routers, func(x routerConf) bool { return x.ID == rc.ID }); i >= 0 && st.Routers[i].Restart.HostKey == "" && st.Routers[i].Host == rc.Host {
			st.Routers[i].Restart.HostKey = key
			_ = st.save()
		}
		st.mu.Unlock()
	}
	writeJSON(w, http.StatusOK, map[string]string{"message": msg})
}

func (s *server) handleRestartRouter(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	st := s.routers
	st.mu.Lock()
	rc, ok := st.find(id)
	l := st.liveOf(id)
	busy := l.restarting
	if ok && !busy {
		l.restarting = true
	}
	st.mu.Unlock()
	if !ok {
		writeError(w, http.StatusNotFound, "no such router")
		return
	}
	if busy {
		writeError(w, http.StatusConflict, "it’s already restarting")
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 45*time.Second)
	defer cancel()
	key := ""
	var err error
	if rc.Restart.Method == "mikrotik" || rc.Restart.Method == "ssh" {
		// Remember the key on the first restart too, if it wasn't tested first.
		if rc.Restart.HostKey == "" {
			key, _, err = testRestart(ctx, rc)
		}
	}
	if err == nil {
		err = restartRouter(ctx, rc)
	}
	st.mu.Lock()
	defer st.mu.Unlock()
	l.restarting = false
	if key != "" {
		if i := slices.IndexFunc(st.Routers, func(x routerConf) bool { return x.ID == id }); i >= 0 && st.Routers[i].Restart.HostKey == "" {
			st.Routers[i].Restart.HostKey = key
		}
	}
	if err != nil {
		st.event(id, "Restart failed: "+err.Error(), true)
		_ = st.save()
		writeError(w, http.StatusBadGateway, err.Error())
		return
	}
	l.lastRestart = time.Now()
	l.autoTries, l.gaveUp = 0, false
	st.event(id, "Restarted by hand.", false)
	_ = st.save()
	log.Printf("routers: restarted %s (%s)", rc.Name, rc.Host)
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}
