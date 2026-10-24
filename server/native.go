package main

import (
	"context"
	"crypto/tls"
	"encoding/json"
	"errors"
	"fmt"
	"html"
	"io"
	"net"
	"net/http"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"slices"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"
)

// Native apps are web UIs running on the server outside Docker: a systemd service (CasaOS,
// Cockpit, an apt-installed Jellyfin…) or any process listening on a port that answers with
// HTML. They're found by scanning listening sockets, so nothing has to be registered.

const (
	nativeScanEvery = 30 * time.Second
	probeTimeout    = 1500 * time.Millisecond
	maxProbeBody    = 64 << 10
	maxIconBytes    = 512 << 10
)

// Processes that are infrastructure, not apps.
var nativeSkipProcess = map[string]bool{
	"docker-proxy": true, "dockerd": true, "containerd": true, "containerd-shim": true, "systemd": true,
	"systemd-resolve": true, "sshd": true, "smbd": true, "nmbd": true, "cupsd": true, "rpcbind": true,
	// TemanLabsOS itself (another copy, e.g. the installed service seen from a test instance).
	"temanlabsos": true,
}

// Ports that never carry a web UI (on top of nonWebPorts in apps.go).
var nativeSkipPorts = map[int]bool{25: true, 111: true, 465: true, 587: true, 631: true, 993: true, 995: true, 2049: true, 5353: true}

var (
	titlePattern = regexp.MustCompile(`(?is)<title[^>]*>(.*?)</title>`)
	iconPattern  = regexp.MustCompile(`(?is)<link[^>]+rel=["'][^"']*icon[^"']*["'][^>]*>`)
	hrefPattern  = regexp.MustCompile(`(?is)href=["']([^"']+)["']`)
	spaces       = regexp.MustCompile(`\s+`)
)

// nativeRecord is a detected app. Ones run by systemd are remembered (state/native.json), so
// they stay in the Launcher while stopped and can be started again.
type nativeRecord struct {
	ID      string `json:"id"`
	Name    string `json:"name"`
	Unit    string `json:"unit,omitempty"`
	Process string `json:"process"`
	Port    int    `json:"port"`
	Scheme  string `json:"scheme"`
	Path    string `json:"path"`
	// Address the app listens on, used by the frame proxy and the icon fetch.
	Host string `json:"host"`
	// Bound to loopback only: other machines can only reach it through TemanLabsOS.
	LocalOnly bool   `json:"localOnly,omitempty"`
	Icon      string `json:"icon,omitempty"`
	running   bool
}

type nativeApps struct {
	file string
	self int

	mu      sync.Mutex
	records map[string]*nativeRecord
	scanned time.Time
	icons   map[string][]byte
	iconCT  map[string]string
	wake    chan struct{}
}

func newNativeApps(stateDir string) *nativeApps {
	n := &nativeApps{
		file:    filepath.Join(stateDir, "native.json"),
		self:    os.Getpid(),
		records: map[string]*nativeRecord{},
		icons:   map[string][]byte{},
		iconCT:  map[string]string{},
		wake:    make(chan struct{}, 1),
	}
	if data, err := os.ReadFile(n.file); err == nil {
		var saved []*nativeRecord
		if json.Unmarshal(data, &saved) == nil {
			for _, r := range saved {
				n.records[r.ID] = r
			}
		}
	}
	go n.run()
	return n
}

func (n *nativeApps) run() {
	for {
		n.scan()
		select {
		case <-time.After(nativeScanEvery):
		case <-n.wake:
		}
	}
}

// rescan asks for a scan soon, e.g. after a service was started or stopped.
func (n *nativeApps) rescan() {
	select {
	case n.wake <- struct{}{}:
	default:
	}
}

type candidate struct {
	key, unit, process string
	ports              map[int][]net.IP
}

func (n *nativeApps) scan() {
	sockets := readSockets()
	inodes := map[string]bool{}
	for _, sk := range sockets {
		if sk.proto == "tcp" {
			inodes[sk.inode] = true
		}
	}
	owners := socketOwners(inodes)
	socketUnits := systemdSockets()

	groups := map[string]*candidate{}
	for _, sk := range sockets {
		if sk.proto != "tcp" || nonWebPorts[sk.port] || nativeSkipPorts[sk.port] {
			continue
		}
		var unit, process string
		if o := owners[sk.inode]; o != nil {
			if o.pid == n.self || o.containerID != "" || nativeSkipProcess[o.name] || strings.HasPrefix(o.name, "containerd-shim") {
				continue
			}
			unit, process = o.unit, o.name
		} else {
			continue
		}
		if unit == "" && process == "systemd" {
			// Socket activation (e.g. Cockpit): systemd holds the socket for a service.
			unit = socketUnits[sk.port]
		}
		if unit == "temanlabsos.service" {
			continue
		}
		key := "proc:" + process
		if unit != "" {
			key = unit
		}
		g := groups[key]
		if g == nil {
			g = &candidate{key: key, unit: unit, process: process, ports: map[int][]net.IP{}}
			groups[key] = g
		}
		g.ports[sk.port] = append(g.ports[sk.port], sk.ip)
	}

	found := map[string]*nativeRecord{}
	for _, g := range groups {
		for _, rec := range n.probeGroup(g) {
			if other, taken := found[rec.ID]; taken && other.Port != rec.Port {
				rec.ID = fmt.Sprintf("%s-%d", rec.ID, rec.Port)
			}
			found[rec.ID] = rec
		}
	}

	n.mu.Lock()
	defer n.mu.Unlock()
	for id, r := range n.records {
		r.running = false
		if r.Unit == "" || r.Unit == "temanlabsos.service" {
			delete(n.records, id)
		}
	}
	for id, rec := range found {
		rec.running = true
		n.records[id] = rec
	}
	n.scanned = time.Now()
	n.save()
}

// save writes the systemd-managed records; the caller holds n.mu.
func (n *nativeApps) save() {
	var keep []*nativeRecord
	for _, r := range n.records {
		if r.Unit != "" {
			keep = append(keep, r)
		}
	}
	sort.Slice(keep, func(i, j int) bool { return keep[i].ID < keep[j].ID })
	if data, err := json.MarshalIndent(keep, "", "  "); err == nil {
		_ = os.MkdirAll(filepath.Dir(n.file), 0o755)
		_ = os.WriteFile(n.file, data, 0o644)
	}
}

// probeGroup finds the ports of a process or service that serve web pages. One service can
// run several apps (pm2, supervisord…); pages with the same title count as one app.
func (n *nativeApps) probeGroup(g *candidate) []*nativeRecord {
	ports := make([]int, 0, len(g.ports))
	for p := range g.ports {
		ports = append(ports, p)
	}
	// Likely web ports first, then the rest in order.
	sort.Slice(ports, func(i, j int) bool {
		wi, wj := slices.Index(webPorts, ports[i]), slices.Index(webPorts, ports[j])
		if (wi >= 0) != (wj >= 0) {
			return wi >= 0
		}
		return ports[i] < ports[j]
	})
	base := strings.TrimSuffix(g.unit, ".service")
	if base == "" {
		base = g.process
	}
	id := "native-" + strings.Trim(nonSlug.ReplaceAllString(strings.ToLower(base), "-"), "-")
	var found []*nativeRecord
	titles := map[string]bool{}
	for i, port := range ports {
		if i >= 8 {
			break
		}
		host, local := probeHost(g.ports[port])
		scheme, title, icon, finalPath, ok := probeWeb(host, port)
		if !ok || (title != "" && titles[title]) {
			continue
		}
		titles[title] = true
		name := cleanTitle(title)
		if name == "" {
			name = prettify(base)
		}
		rec := &nativeRecord{
			ID: id, Name: name, Unit: g.unit, Process: g.process, Port: port, Scheme: scheme, Path: finalPath,
			Host: host, LocalOnly: local, Icon: icon,
		}
		if len(found) > 0 {
			rec.ID = fmt.Sprintf("%s-%d", id, port)
		}
		found = append(found, rec)
	}
	return found
}

// probeHost picks the address to reach a listener on: loopback when it listens everywhere.
func probeHost(ips []net.IP) (host string, localOnly bool) {
	localOnly = true
	host = "127.0.0.1"
	for _, ip := range ips {
		if ip.IsUnspecified() {
			return "127.0.0.1", false
		}
		if !ip.IsLoopback() {
			localOnly = false
			host = ip.String()
		}
	}
	if localOnly && len(ips) > 0 && ips[0].To4() == nil {
		host = "::1"
	}
	return host, localOnly
}

var probeClient = &http.Client{
	Timeout: probeTimeout,
	Transport: &http.Transport{
		TLSClientConfig:   &tls.Config{InsecureSkipVerify: true},
		DisableKeepAlives: true,
	},
	CheckRedirect: func(req *http.Request, via []*http.Request) error {
		// Follow redirects within the app (e.g. / → /login), not to other sites.
		if len(via) >= 4 || req.URL.Host != via[0].URL.Host {
			return http.ErrUseLastResponse
		}
		return nil
	},
}

// probeWeb reports whether host:port serves an HTML page, over HTTP or HTTPS.
func probeWeb(host string, port int) (scheme, title, icon, path string, ok bool) {
	addr := net.JoinHostPort(host, strconv.Itoa(port))
	for _, scheme := range []string{"http", "https"} {
		res, err := probeClient.Get(scheme + "://" + addr + "/")
		if err != nil {
			continue
		}
		body, _ := io.ReadAll(io.LimitReader(res.Body, maxProbeBody))
		res.Body.Close()
		ctype := res.Header.Get("Content-Type")
		// Basic-auth prompts are web UIs too; JSON APIs and the like are not.
		if res.StatusCode == http.StatusUnauthorized && res.Header.Get("WWW-Authenticate") != "" {
			return scheme, "", "", "/", true
		}
		if !strings.Contains(ctype, "text/html") || res.StatusCode >= 500 || res.StatusCode == http.StatusNotFound {
			return "", "", "", "", false
		}
		page := res.Request.URL
		if m := titlePattern.FindSubmatch(body); m != nil {
			title = string(m[1])
		}
		icon = "/favicon.ico"
		if link := iconPattern.Find(body); link != nil {
			if href := hrefPattern.FindSubmatch(link); href != nil {
				if u, err := page.Parse(html.UnescapeString(string(href[1]))); err == nil && u.Host == page.Host {
					icon = u.RequestURI()
				}
			}
		}
		// Keep the app's own landing page only when it's a plain path (not a login redirect with tokens).
		path = "/"
		if page.Path != "" && page.RawQuery == "" {
			path = page.Path
		}
		return scheme, title, icon, path, true
	}
	return "", "", "", "", false
}

func cleanTitle(t string) string {
	t = strings.TrimSpace(spaces.ReplaceAllString(html.UnescapeString(t), " "))
	// "Login - Grafana" / "Dashboard | Portainer": the app is usually the shortest part.
	for _, sep := range []string{" | ", " - ", " – ", " — ", " · ", " :: "} {
		if parts := strings.Split(t, sep); len(parts) > 1 {
			best := parts[len(parts)-1]
			for _, p := range parts {
				if p = strings.TrimSpace(p); p != "" && len(p) < len(best) && !strings.EqualFold(p, "login") && !strings.EqualFold(p, "sign in") {
					best = p
				}
			}
			t = strings.TrimSpace(best)
		}
	}
	if len(t) > 40 {
		t = strings.TrimSpace(t[:40]) + "…"
	}
	return t
}

// systemdSockets maps TCP ports systemd listens on to the service each one starts.
func systemdSockets() map[int]string {
	var list []struct {
		Listen    string `json:"listen"`
		Activates string `json:"activates"`
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	out := map[int]string{}
	if systemctlJSON(ctx, &list, "list-sockets", "--all") != nil {
		return out
	}
	for _, s := range list {
		_, portText, err := net.SplitHostPort(s.Listen)
		if err != nil {
			continue
		}
		if port, err := strconv.Atoi(portText); err == nil && strings.HasSuffix(s.Activates, ".service") {
			out[port] = s.Activates
		}
	}
	return out
}

// apps returns the native apps for /api/apps. Remembered systemd apps that aren't listening
// show as stopped.
func (n *nativeApps) apps(taken map[string]bool) []*app {
	n.mu.Lock()
	defer n.mu.Unlock()
	list := make([]*app, 0, len(n.records))
	for _, r := range n.records {
		if taken[r.ID] {
			continue
		}
		port := r.Port
		a := &app{
			ID: r.ID, Name: r.Name, Icon: "boxes", IconURL: "/api/apps/" + url.PathEscape(r.ID) + "/icon",
			Color: colorFor(r.Name), Category: "Native", Port: &port, Path: r.Path, Scheme: r.Scheme,
			Status: "stopped", Source: "native", Unit: r.Unit, LocalOnly: r.LocalOnly, host: r.Host,
		}
		a.Description = "Runs on the server outside Docker"
		if r.Unit != "" {
			a.Description = "systemd service " + r.Unit
		} else {
			a.Description = "Process " + r.Process
		}
		if r.running {
			a.Status = "running"
		}
		list = append(list, a)
	}
	return list
}

func (n *nativeApps) record(id string) *nativeRecord {
	n.mu.Lock()
	defer n.mu.Unlock()
	if r, ok := n.records[id]; ok {
		copied := *r
		return &copied
	}
	return nil
}

// handleAppIcon serves a native app's favicon, fetched on the server: the app may only listen
// on localhost, and its icon is cross-origin for the browser anyway.
func (s *server) handleAppIcon(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	rec := s.native.record(id)
	if rec == nil || rec.Icon == "" {
		http.NotFound(w, r)
		return
	}
	s.native.mu.Lock()
	data, ctype := s.native.icons[id], s.native.iconCT[id]
	s.native.mu.Unlock()
	if data == nil {
		res, err := probeClient.Get(rec.Scheme + "://" + net.JoinHostPort(rec.Host, strconv.Itoa(rec.Port)) + rec.Icon)
		if err != nil {
			http.NotFound(w, r)
			return
		}
		data, _ = io.ReadAll(io.LimitReader(res.Body, maxIconBytes))
		res.Body.Close()
		ctype = http.DetectContentType(data)
		if res.StatusCode != http.StatusOK || !strings.HasPrefix(ctype, "image/") {
			// SVG icons sniff as text; trust the header for those only.
			if res.StatusCode == http.StatusOK && strings.Contains(res.Header.Get("Content-Type"), "image/svg") {
				ctype = "image/svg+xml"
			} else {
				http.NotFound(w, r)
				return
			}
		}
		s.native.mu.Lock()
		s.native.icons[id], s.native.iconCT[id] = data, ctype
		s.native.mu.Unlock()
	}
	w.Header().Set("Content-Type", ctype)
	w.Header().Set("Content-Security-Policy", "sandbox; default-src 'none'; style-src 'unsafe-inline'")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.Header().Set("Cache-Control", "private, max-age=3600")
	_, _ = w.Write(data)
}

// setNativeRunning starts or stops a native app through its systemd service.
func (s *server) setNativeRunning(ctx context.Context, a *app, running bool) error {
	if a.Unit == "" {
		return errors.New(a.Name + " isn’t run by a systemd service, so TemanLabsOS can’t start or stop it. Use End Process in System Monitor → Ports instead.")
	}
	if !running && protectedService(a.Unit) {
		return errors.New(a.Unit + " keeps the server running and can’t be stopped here.")
	}
	verb := "stop"
	if running {
		verb = "start"
	}
	if out, err := exec.CommandContext(ctx, "systemctl", verb, "--", a.Unit).CombinedOutput(); err != nil {
		return errors.New(strings.TrimSpace(lastLines(string(out), 3)))
	}
	// Give the app a moment to open (or close) its port before the next scan.
	time.AfterFunc(2*time.Second, s.native.rescan)
	return nil
}
