package main

import (
	"bytes"
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"slices"
	"strings"
	"sync"
	"time"

	"golang.org/x/crypto/bcrypt"
)

// Ad blocking for the whole home: AdGuard Home in a container (host network, so it answers DNS
// on the server's own addresses), set up and run by TemanLabsOS. Its web interface stays on
// localhost; Settings talks to its API with a login only the server knows. Devices use it once
// the router (or Tailscale) hands out the server as their DNS server.

const (
	adblockImage     = "adguard/adguardhome:v0.107.79"
	adblockContainer = "temanlabsos-adblock"
	adblockAPI       = "http://127.0.0.1:3053/control"
	adblockUser      = "temanlabs"
)

type adblockEngine struct {
	docker *dockerClient
	dir    string

	mu         sync.Mutex
	installing bool
	step       string
	err        string
}

func newAdblock(docker *dockerClient, stateDir string) *adblockEngine {
	return &adblockEngine{docker: docker, dir: filepath.Join(stateDir, "adblock")}
}

func (a *adblockEngine) password() string {
	data, _ := os.ReadFile(filepath.Join(a.dir, "password"))
	return strings.TrimSpace(string(data))
}

// call sends a request to AdGuard Home's API and decodes the JSON answer into out (if set).
func (a *adblockEngine) call(ctx context.Context, method, path string, body, out any) error {
	var r io.Reader
	if body != nil {
		data, _ := json.Marshal(body)
		r = bytes.NewReader(data)
	}
	// Adding a list downloads it first; the big ones take a while.
	timeout := 8 * time.Second
	if path == "/filtering/add_url" {
		timeout = 2 * time.Minute
	}
	ctx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, method, adblockAPI+path, r)
	if err != nil {
		return err
	}
	req.SetBasicAuth(adblockUser, a.password())
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		return err
	}
	defer res.Body.Close()
	if res.StatusCode >= 300 {
		msg, _ := io.ReadAll(io.LimitReader(res.Body, 500))
		return fmt.Errorf("AdGuard Home: %s %s", res.Status, strings.TrimSpace(string(msg)))
	}
	if out != nil {
		return json.NewDecoder(res.Body).Decode(out)
	}
	return nil
}

func (a *adblockEngine) find(ctx context.Context) (*container, error) {
	list, err := a.docker.containers(ctx)
	if err != nil {
		return nil, err
	}
	for _, c := range list {
		if c.name() == adblockContainer {
			return &c, nil
		}
	}
	return nil, nil
}

// writeConfig sets AdGuard Home up before its first start: the web interface on localhost only,
// DNS on every address, encrypted upstreams and the standard ad and tracker list.
func (a *adblockEngine) writeConfig() error {
	for _, d := range []string{"conf", "work"} {
		if err := os.MkdirAll(filepath.Join(a.dir, d), 0o700); err != nil {
			return err
		}
	}
	secret := make([]byte, 18)
	_, _ = rand.Read(secret)
	pass := hex.EncodeToString(secret)
	hash, err := bcrypt.GenerateFromPassword([]byte(pass), bcrypt.DefaultCost)
	if err != nil {
		return err
	}
	config := fmt.Sprintf(`http:
  address: 127.0.0.1:3053
users:
  - name: %s
    password: %s
dns:
  bind_hosts:
    - 0.0.0.0
  port: 53
  upstream_dns:
    - https://dns.cloudflare.com/dns-query
    - https://dns.google/dns-query
  bootstrap_dns:
    - 1.1.1.1
    - 8.8.8.8
filters:
  - enabled: true
    url: https://adguardteam.github.io/HostlistsRegistry/assets/filter_1.txt
    name: AdGuard DNS filter
    id: 1
schema_version: 29
`, adblockUser, hash)
	if err := os.WriteFile(filepath.Join(a.dir, "conf", "AdGuardHome.yaml"), []byte(config), 0o600); err != nil {
		return err
	}
	return os.WriteFile(filepath.Join(a.dir, "password"), []byte(pass), 0o600)
}

func (a *adblockEngine) install() {
	a.mu.Lock()
	if a.installing {
		a.mu.Unlock()
		return
	}
	a.installing, a.step, a.err = true, "Downloading", ""
	a.mu.Unlock()
	go func() {
		ctx, cancel := context.WithTimeout(context.Background(), 20*time.Minute)
		defer cancel()
		err := a.ensure(ctx)
		a.mu.Lock()
		a.installing, a.step = false, ""
		if err != nil {
			a.err = err.Error()
			log.Printf("ad blocking: %v", err)
		}
		a.mu.Unlock()
	}()
}

func (a *adblockEngine) progress(step string) {
	a.mu.Lock()
	a.step = step
	a.mu.Unlock()
}

func (a *adblockEngine) ensure(ctx context.Context) error {
	c, err := a.find(ctx)
	if err != nil {
		return err
	}
	if c != nil {
		if c.State != "running" {
			a.progress("Starting")
			return a.docker.startContainer(ctx, c.ID)
		}
		return nil
	}
	if conflict := dnsPortUser(); conflict != "" {
		return fmt.Errorf("port 53 is already used by %s; stop it first (only one DNS server can run)", conflict)
	}
	a.progress("Downloading")
	if err := a.docker.pull(ctx, adblockImage, func(string, ...any) {}); err != nil {
		return err
	}
	if _, err := os.Stat(filepath.Join(a.dir, "conf", "AdGuardHome.yaml")); err != nil || a.password() == "" {
		if err := a.writeConfig(); err != nil {
			return err
		}
	}
	a.progress("Starting")
	body := map[string]any{
		"Image":  adblockImage,
		"Labels": map[string]string{labelSystem: "adblock"},
		"HostConfig": map[string]any{
			"NetworkMode":   "host",
			"RestartPolicy": map[string]any{"Name": "unless-stopped"},
			"Binds": []string{
				filepath.Join(a.dir, "conf") + ":/opt/adguardhome/conf",
				filepath.Join(a.dir, "work") + ":/opt/adguardhome/work",
			},
		},
	}
	var created struct {
		ID string `json:"Id"`
	}
	if err := a.docker.send(ctx, http.MethodPost, "/containers/create?name="+adblockContainer, body, &created); err != nil {
		return err
	}
	return a.docker.startContainer(ctx, created.ID)
}

// dnsPortUser names what already answers DNS on port 53 (another DNS server or ad blocker), if
// anything. systemd-resolved's stub on 127.0.0.53 doesn't count: it doesn't get in the way.
func dnsPortUser() string {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	out, err := exec.CommandContext(ctx, "ss", "-Hulnp", "sport = :53").Output()
	if err != nil {
		return ""
	}
	for _, line := range strings.Split(string(out), "\n") {
		if strings.TrimSpace(line) == "" || strings.Contains(line, "127.0.0.53") || strings.Contains(line, "127.0.0.54") {
			continue
		}
		if m := ssProcess.FindStringSubmatch(line); m != nil {
			return m[1]
		}
		return "another program"
	}
	return ""
}

type adblockStats struct {
	Queries int     `json:"queries"`
	Blocked int     `json:"blocked"`
	AvgMs   float64 `json:"avgMs"`
	// Most blocked domains and busiest devices over the last day.
	TopBlocked []namedCount `json:"topBlocked"`
	TopClients []namedCount `json:"topClients"`
}

type namedCount struct {
	Name  string `json:"name"`
	Count int    `json:"count"`
	// A device's name, for top clients (Name is its address).
	Label string `json:"label,omitempty"`
}

type adblockStatus struct {
	Docker     bool   `json:"docker"`
	Installed  bool   `json:"installed"`
	Running    bool   `json:"running"`
	Installing bool   `json:"installing"`
	Step       string `json:"step,omitempty"`
	Error      string `json:"error,omitempty"`
	// Blocking is on; while paused, how many seconds are left.
	Protection bool          `json:"protection"`
	PausedFor  int           `json:"pausedFor,omitempty"`
	Rules      int           `json:"rules"`
	Allowed    []string      `json:"allowed"`
	Stats      *adblockStats `json:"stats,omitempty"`
	// The extra lists that are on (by ID, see adblockLists), and how many rules they add.
	Lists        map[string]int `json:"lists"`
	Version      string         `json:"version,omitempty"`
	Unresponsive bool           `json:"unresponsive,omitempty"`
}

// pairs turns AdGuard's [{"name": count}, …] lists into named counts.
func pairs(list []map[string]float64, n int) []namedCount {
	var out []namedCount
	for _, m := range list {
		for k, v := range m {
			out = append(out, namedCount{Name: k, Count: int(v)})
		}
	}
	if len(out) > n {
		out = out[:n]
	}
	return out
}

var allowRule = regexp.MustCompile(`^@@\|\|([^\^]+)\^$`)

func (a *adblockEngine) status(ctx context.Context) adblockStatus {
	a.mu.Lock()
	st := adblockStatus{Installing: a.installing, Step: a.step, Error: a.err, Allowed: []string{}, Lists: map[string]int{}}
	a.mu.Unlock()
	c, err := a.find(ctx)
	if err != nil {
		return st
	}
	st.Docker = true
	if c == nil {
		return st
	}
	st.Installed = true
	st.Running = c.State == "running"
	if !st.Running {
		return st
	}
	var s struct {
		Version    string `json:"version"`
		Protection bool   `json:"protection_enabled"`
		PausedMs   int    `json:"protection_disabled_duration"`
	}
	if err := a.call(ctx, http.MethodGet, "/status", nil, &s); err != nil {
		// Still starting up (or busy loading its lists).
		st.Unresponsive = true
		return st
	}
	st.Version, st.Protection, st.PausedFor = s.Version, s.Protection, s.PausedMs/1000
	var f struct {
		Filters []struct {
			Enabled bool   `json:"enabled"`
			Rules   int    `json:"rules_count"`
			URL     string `json:"url"`
		} `json:"filters"`
		UserRules []string `json:"user_rules"`
	}
	if a.call(ctx, http.MethodGet, "/filtering/status", nil, &f) == nil {
		on := map[string]int{}
		for _, x := range f.Filters {
			if x.Enabled {
				st.Rules += x.Rules
				on[x.URL] = x.Rules
			}
		}
		// A list counts as on when all its parts are.
	lists:
		for _, l := range adblockLists {
			total := 0
			for _, x := range l.Sources {
				n, ok := on[x.URL]
				if !ok {
					continue lists
				}
				total += n
			}
			st.Lists[l.ID] = total
		}
		for _, r := range f.UserRules {
			if m := allowRule.FindStringSubmatch(r); m != nil {
				st.Allowed = append(st.Allowed, m[1])
			}
		}
	}
	var stats struct {
		Queries    int                  `json:"num_dns_queries"`
		Blocked    int                  `json:"num_blocked_filtering"`
		Avg        float64              `json:"avg_processing_time"`
		TopBlocked []map[string]float64 `json:"top_blocked_domains"`
		TopClients []map[string]float64 `json:"top_clients"`
	}
	if a.call(ctx, http.MethodGet, "/stats", nil, &stats) == nil {
		st.Stats = &adblockStats{
			Queries: stats.Queries, Blocked: stats.Blocked, AvgMs: stats.Avg * 1000,
			TopBlocked: pairs(stats.TopBlocked, 8), TopClients: pairs(stats.TopClients, 12),
		}
	}
	return st
}

func (s *server) handleAdblock(w http.ResponseWriter, r *http.Request) {
	st := s.adblock.status(r.Context())
	if st.Stats != nil {
		s.devices.mu.Lock()
		known := map[string]string{}
		for _, d := range s.devices.devices {
			known[d.Host] = d.Name
		}
		s.devices.mu.Unlock()
		var wg sync.WaitGroup
		for i := range st.Stats.TopClients {
			c := &st.Stats.TopClients[i]
			if name, ok := known[c.Name]; ok {
				c.Label = name
				continue
			}
			wg.Add(1)
			go func() {
				defer wg.Done()
				c.Label = lookupName(r.Context(), c.Name)
			}()
		}
		wg.Wait()
	}
	writeJSON(w, http.StatusOK, st)
}

func (s *server) handleAdblockInstall(w http.ResponseWriter, r *http.Request) {
	if !s.adblock.status(r.Context()).Docker {
		writeError(w, http.StatusBadRequest, "ad blocking needs Docker on the server")
		return
	}
	s.adblock.install()
	w.WriteHeader(http.StatusAccepted)
}

// handleAdblockProtection turns blocking on, off, or off for a while (minutes > 0).
func (s *server) handleAdblockProtection(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Enabled bool `json:"enabled"`
		Minutes int  `json:"minutes"`
	}
	if err := decodeJSON(r, &body); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request")
		return
	}
	req := map[string]any{"enabled": body.Enabled}
	if !body.Enabled && body.Minutes > 0 {
		req["duration"] = min(body.Minutes, 24*60) * 60 * 1000
	}
	if err := s.adblock.call(r.Context(), http.MethodPost, "/protection", req, nil); err != nil {
		writeError(w, http.StatusBadGateway, err.Error())
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

var domainPattern = regexp.MustCompile(`^(?i)[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$`)

// handleAdblockAllow lets a domain through (POST) or blocks it again (DELETE ?domain=).
func (s *server) handleAdblockAllow(w http.ResponseWriter, r *http.Request) {
	domain := strings.ToLower(strings.TrimSpace(r.URL.Query().Get("domain")))
	if r.Method == http.MethodPost {
		var body struct {
			Domain string `json:"domain"`
		}
		if err := decodeJSON(r, &body); err != nil {
			writeError(w, http.StatusBadRequest, "invalid request")
			return
		}
		domain = strings.ToLower(strings.TrimSpace(body.Domain))
		domain = strings.TrimPrefix(strings.TrimPrefix(domain, "https://"), "http://")
		domain = strings.Split(domain, "/")[0]
	}
	if !domainPattern.MatchString(domain) {
		writeError(w, http.StatusBadRequest, "enter a domain, like example.com")
		return
	}
	var f struct {
		UserRules []string `json:"user_rules"`
	}
	if err := s.adblock.call(r.Context(), http.MethodGet, "/filtering/status", nil, &f); err != nil {
		writeError(w, http.StatusBadGateway, err.Error())
		return
	}
	rule := "@@||" + domain + "^"
	rules := slices.DeleteFunc(slices.Clone(f.UserRules), func(x string) bool { return x == rule || x == "" })
	if r.Method == http.MethodPost {
		rules = append(rules, rule)
	}
	if err := s.adblock.call(r.Context(), http.MethodPost, "/filtering/set_rules", map[string]any{"rules": rules}, nil); err != nil {
		writeError(w, http.StatusBadGateway, err.Error())
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// handleAdblockTest asks the server's DNS for an ad domain the list always blocks.
func (s *server) handleAdblockTest(w http.ResponseWriter, r *http.Request) {
	res := &net.Resolver{PreferGo: true, Dial: func(ctx context.Context, network, _ string) (net.Conn, error) {
		return (&net.Dialer{Timeout: 3 * time.Second}).DialContext(ctx, network, "127.0.0.1:53")
	}}
	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()
	addrs, err := res.LookupHost(ctx, "doubleclick.net")
	if err != nil {
		writeJSON(w, http.StatusOK, map[string]any{"answered": false, "blocked": false, "error": err.Error()})
		return
	}
	blocked := len(addrs) > 0 && !slices.ContainsFunc(addrs, func(a string) bool { return a != "0.0.0.0" && a != "::" })
	writeJSON(w, http.StatusOK, map[string]any{"answered": true, "blocked": blocked})
}

// handleAdblockRemove stops ad blocking for good: the container goes, its lists and settings
// stay for a later Turn On.
func (s *server) handleAdblockRemove(w http.ResponseWriter, r *http.Request) {
	c, err := s.adblock.find(r.Context())
	if err != nil {
		writeError(w, http.StatusBadGateway, err.Error())
		return
	}
	if c == nil {
		w.WriteHeader(http.StatusNoContent)
		return
	}
	if err := s.docker.do(r.Context(), http.MethodDelete, "/containers/"+c.ID+"?force=true", nil); err != nil {
		writeError(w, http.StatusBadGateway, err.Error())
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// ----- Extra block lists -----

// adblockSource is one downloadable list, as AdGuard Home knows it.
type adblockSource struct {
	Name string
	URL  string
}

// adblockList is an optional block list the user can switch on in Settings. Some are several
// lists at once.
type adblockList struct {
	ID string
	// Lists in the same group replace each other: the strength levels.
	Group   string
	Sources []adblockSource
}

const hagezi = "https://raw.githubusercontent.com/hagezi/dns-blocklists/main/adblock/"

// Lists that answer what the standard one misses: two stronger levels of ad and tracker
// blocking, gambling sites (judi online), pop-up and redirect ads, the ads and tracking phone
// makers build into their phones, Indonesian ad servers, and the encrypted DNS, VPN and proxy
// services that let a device go around the blocker.
var adblockLists = []adblockList{
	{ID: "strong", Group: "level", Sources: []adblockSource{{"HaGeZi Multi PRO", hagezi + "pro.txt"}}},
	{ID: "strongest", Group: "level", Sources: []adblockSource{{"HaGeZi Multi PRO++", hagezi + "pro.plus.txt"}}},
	{ID: "gambling", Sources: []adblockSource{{"HaGeZi Gambling", hagezi + "gambling.txt"}}},
	{ID: "popups", Sources: []adblockSource{{"HaGeZi Pop-Up Ads", hagezi + "popupads.txt"}}},
	{ID: "phones", Sources: []adblockSource{
		{"HaGeZi Native Xiaomi", hagezi + "native.xiaomi.txt"},
		{"HaGeZi Native OPPO/Realme", hagezi + "native.oppo-realme.txt"},
		{"HaGeZi Native Vivo", hagezi + "native.vivo.txt"},
		{"HaGeZi Native Samsung", hagezi + "native.samsung.txt"},
		{"HaGeZi Native Huawei", hagezi + "native.huawei.txt"},
	}},
	{ID: "indonesia", Sources: []adblockSource{{"ABPindo", "https://raw.githubusercontent.com/ABPindo/indonesianadblockrules/master/subscriptions/abpindo.txt"}}},
	{ID: "bypass", Sources: []adblockSource{{"HaGeZi DoH/VPN/Proxy Bypass", hagezi + "doh-vpn-proxy-bypass.txt"}}},
}

// handleAdblockList switches an extra list on (it downloads then) or off.
func (s *server) handleAdblockList(w http.ResponseWriter, r *http.Request) {
	var body struct {
		ID      string `json:"id"`
		Enabled bool   `json:"enabled"`
	}
	if err := decodeJSON(r, &body); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request")
		return
	}
	i := slices.IndexFunc(adblockLists, func(l adblockList) bool { return l.ID == body.ID })
	if i < 0 {
		writeError(w, http.StatusBadRequest, "no such list")
		return
	}
	l := adblockLists[i]
	remove := func(src []adblockSource) error {
		for _, x := range src {
			if err := s.adblock.call(r.Context(), http.MethodPost, "/filtering/remove_url", map[string]any{"url": x.URL, "whitelist": false}, nil); err != nil {
				return err
			}
		}
		return nil
	}
	var err error
	if body.Enabled {
		// Another level goes first, so the two don't stack.
		for _, o := range adblockLists {
			if err == nil && o.Group != "" && o.Group == l.Group && o.ID != l.ID {
				err = remove(o.Sources)
			}
		}
		for _, x := range l.Sources {
			if err != nil {
				break
			}
			err = s.adblock.call(r.Context(), http.MethodPost, "/filtering/add_url", map[string]any{"name": x.Name, "url": x.URL, "whitelist": false}, nil)
			if err != nil && strings.Contains(err.Error(), "already") {
				err = nil
			}
		}
	} else {
		err = remove(l.Sources)
	}
	if err != nil {
		writeError(w, http.StatusBadGateway, err.Error())
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
