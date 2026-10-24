package main

import (
	"context"
	"hash/fnv"
	"net/http"
	"os"
	"os/exec"
	"slices"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"

	"gopkg.in/yaml.v3"
)

const (
	labelProject     = "com.docker.compose.project"
	labelConfigFiles = "com.docker.compose.project.config_files"
	labelService     = "com.docker.compose.service"
	labelTemanLabs   = "temanlabs.app"
	casaosAppsDir    = "/var/lib/casaos/apps/"
)

// app is one entry in the Dock/Launcher: a compose project (all its containers) or a lone
// container. The JSON shape matches InstalledApp in src/api/types.ts.
type app struct {
	ID           string    `json:"id"`
	Name         string    `json:"name"`
	Icon         string    `json:"icon"`
	IconURL      string    `json:"iconUrl,omitempty"`
	Color        [2]string `json:"color"`
	Category     string    `json:"category"`
	Description  string    `json:"description"`
	Port         *int      `json:"port"`
	Path         string    `json:"path"`
	Scheme       string    `json:"scheme"`
	Status       string    `json:"status"`
	Source       string    `json:"source"`
	Containers   int       `json:"containers"`
	CanUninstall bool      `json:"canUninstall"`
	Error        string    `json:"error,omitempty"`
	// Native apps: the systemd service running it, and whether it listens on localhost only.
	Unit      string `json:"unit,omitempty"`
	LocalOnly bool   `json:"localOnly,omitempty"`

	project    string
	containers []container
	// Address to reach a native app on from the server (default 127.0.0.1).
	host string
}

// casaosMeta is the x-casaos block CasaOS writes into each app's compose file.
type casaosMeta struct {
	Main    string            `yaml:"main"`
	Icon    string            `yaml:"icon"`
	PortMap string            `yaml:"port_map"`
	Scheme  string            `yaml:"scheme"`
	Index   string            `yaml:"index"`
	Title   map[string]string `yaml:"title"`
	Tagline map[string]string `yaml:"tagline"`
}

type casaosCache struct {
	mu      sync.Mutex
	entries map[string]casaosCacheEntry
}

type casaosCacheEntry struct {
	modified time.Time
	meta     *casaosMeta
}

var casaosMetaCache = &casaosCache{entries: map[string]casaosCacheEntry{}}

// readCasaOSMeta parses the x-casaos block of a CasaOS compose file, cached until it changes.
func readCasaOSMeta(path string) *casaosMeta {
	info, err := os.Stat(path)
	if err != nil {
		return nil
	}
	casaosMetaCache.mu.Lock()
	defer casaosMetaCache.mu.Unlock()
	if e, ok := casaosMetaCache.entries[path]; ok && e.modified.Equal(info.ModTime()) {
		return e.meta
	}
	data, err := os.ReadFile(path)
	if err != nil {
		return nil
	}
	var doc struct {
		XCasaOS *casaosMeta `yaml:"x-casaos"`
	}
	if yaml.Unmarshal(data, &doc) != nil {
		return nil
	}
	casaosMetaCache.entries[path] = casaosCacheEntry{modified: info.ModTime(), meta: doc.XCasaOS}
	return doc.XCasaOS
}

func english(m map[string]string) string {
	for _, key := range []string{"custom", "en_us", "en_US", "en"} {
		if v := strings.TrimSpace(m[key]); v != "" {
			return v
		}
	}
	for _, v := range m {
		if v != "" {
			return v
		}
	}
	return ""
}

var palette = [][2]string{
	{"#64d2ff", "#2f6bff"}, {"#ff8a6b", "#e6366b"}, {"#6ee7a0", "#14a05a"}, {"#b18cff", "#6e4bff"},
	{"#ffd36e", "#ff8a00"}, {"#4cc2ff", "#005fa3"}, {"#ff6fa8", "#b8306e"}, {"#9aa6bd", "#4b5568"},
}

func colorFor(name string) [2]string {
	h := fnv.New32a()
	h.Write([]byte(name))
	return palette[h.Sum32()%uint32(len(palette))]
}

// Container ports that usually serve a web UI, and ones that never do.
var (
	webPorts    = []int{80, 443, 8080, 3000, 8000, 5000, 8096, 8443, 9000, 8123, 5678, 3001, 4533, 8384, 7000}
	nonWebPorts = map[int]bool{22: true, 53: true, 67: true, 139: true, 445: true, 1883: true, 3306: true, 5432: true, 5672: true, 6379: true, 6543: true, 27017: true}
)

// webPort picks the published port most likely to be the app's web UI. Ports bound only to
// 127.0.0.1 are skipped: the browser runs on another machine.
func webPort(containers []container) (port int, scheme string) {
	best, bestScore := 0, -1
	for _, c := range containers {
		for _, p := range c.Ports {
			if p.PublicPort == 0 || p.Type != "tcp" || nonWebPorts[p.PrivatePort] || strings.HasPrefix(p.IP, "127.") || p.IP == "::1" {
				continue
			}
			score := 1
			if i := slices.Index(webPorts, p.PrivatePort); i >= 0 {
				score = 100 - i
			}
			if score > bestScore {
				best, bestScore, scheme = p.PublicPort, score, "http"
				if p.PrivatePort == 443 || p.PrivatePort == 8443 {
					scheme = "https"
				}
			}
		}
	}
	return best, scheme
}

func prettify(name string) string {
	name = strings.NewReplacer("-", " ", "_", " ").Replace(name)
	if name == "" {
		return name
	}
	return strings.ToUpper(name[:1]) + name[1:]
}

// iconFor guesses a selfh.st icon (the set CasaOS app stores use) from the image name.
func iconFor(image string) string {
	repo := image
	if i := strings.LastIndex(repo, "/"); i >= 0 {
		repo = repo[i+1:]
	}
	repo, _, _ = strings.Cut(repo, ":")
	repo, _, _ = strings.Cut(repo, "@")
	if repo == "" || strings.HasPrefix(repo, "sha256") {
		return ""
	}
	return "https://cdn.jsdelivr.net/gh/selfhst/icons/png/" + repo + ".png"
}

// listApps groups containers into apps and fills in what CasaOS and the catalog know about them.
func (s *appStore) listApps(ctx context.Context) ([]*app, error) {
	containers, err := s.docker.containers(ctx)
	if err != nil {
		return nil, err
	}
	byKey := map[string]*app{}
	var order []string
	for _, c := range containers {
		key := c.Labels[labelProject]
		if key == "" {
			key = c.name()
		}
		a, ok := byKey[key]
		if !ok {
			a = &app{project: key}
			byKey[key] = a
			order = append(order, key)
		}
		a.containers = append(a.containers, c)
	}

	apps := make([]*app, 0, len(order))
	for _, key := range order {
		a := byKey[key]
		s.describe(a)
		apps = append(apps, a)
	}
	apps = append(apps, s.pendingApps(byKey)...)
	if s.native != nil {
		taken := map[string]bool{}
		for _, a := range apps {
			taken[a.ID] = true
		}
		apps = append(apps, s.native.apps(taken)...)
	}
	sort.Slice(apps, func(i, j int) bool { return strings.ToLower(apps[i].Name) < strings.ToLower(apps[j].Name) })
	return apps, nil
}

func (s *appStore) describe(a *app) {
	first := a.containers[0]
	a.ID = a.project
	a.Name = prettify(a.project)
	a.Icon = "boxes"
	a.Category = "Apps"
	a.Description = first.Image
	a.Scheme = "http"
	a.Path = "/"
	a.Containers = len(a.containers)
	a.Source = "container"
	if first.Labels[labelProject] != "" {
		a.Source = "compose"
	}

	running := false
	for _, c := range a.containers {
		running = running || c.State == "running"
	}
	a.Status = "stopped"
	if running {
		a.Status = "running"
	}

	port, scheme := webPort(a.containers)
	if port > 0 {
		a.Port, a.Scheme = &port, scheme
	}

	switch {
	case first.Labels[labelTemanLabs] != "":
		id := first.Labels[labelTemanLabs]
		a.Source = "temanlabs"
		a.ID = id
		a.CanUninstall = true
		if item := findCatalog(id); item != nil {
			a.Name, a.Icon, a.Color, a.Category, a.Description = item.Name, item.Icon, item.Color, item.Category, item.Description
		} else {
			describeCustom(a, first.Labels)
		}
	case strings.HasPrefix(first.Labels[labelConfigFiles], casaosAppsDir):
		a.Source = "casaos"
		a.Category = "CasaOS"
		a.IconURL = first.Labels["icon"]
		if meta := readCasaOSMeta(first.Labels[labelConfigFiles]); meta != nil {
			if t := english(meta.Title); t != "" {
				a.Name = t
			}
			if t := english(meta.Tagline); t != "" {
				a.Description = t
			}
			if meta.Icon != "" {
				a.IconURL = meta.Icon
			}
			if p, err := strconv.Atoi(meta.PortMap); err == nil && p > 0 {
				a.Port = &p
			}
			if meta.Scheme != "" {
				a.Scheme = meta.Scheme
			}
			if meta.Index != "" {
				a.Path = meta.Index
			}
		}
	}
	if a.IconURL == "" && a.Source != "temanlabs" {
		a.IconURL = iconFor(first.Image)
	}
	if a.Color == [2]string{} {
		a.Color = colorFor(a.Name)
	}
	if s.isInstalling(a.ID) {
		a.Status = "installing"
	}
	a.Error = s.installError(a.ID)
}

func (s *server) handleApps(w http.ResponseWriter, r *http.Request) {
	apps, err := s.store.listApps(r.Context())
	if err != nil {
		writeError(w, http.StatusBadGateway, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, apps)
}

func (s *server) findApp(ctx context.Context, id string) (*app, error) {
	apps, err := s.store.listApps(ctx)
	if err != nil {
		return nil, err
	}
	for _, a := range apps {
		if a.ID == id {
			return a, nil
		}
	}
	return nil, nil
}

// setRunning starts or stops every container of an app. Compose projects go through
// `docker compose` so dependencies start in order.
func (s *server) setRunning(w http.ResponseWriter, r *http.Request, running bool) {
	a, err := s.findApp(r.Context(), r.PathValue("id"))
	if err != nil {
		writeError(w, http.StatusBadGateway, err.Error())
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 3*time.Minute)
	defer cancel()
	if a != nil && a.Source == "native" {
		if err := s.setNativeRunning(ctx, a, running); err != nil {
			writeError(w, http.StatusBadRequest, err.Error())
			return
		}
		w.WriteHeader(http.StatusNoContent)
		return
	}
	if a == nil || len(a.containers) == 0 {
		writeError(w, http.StatusNotFound, "app not found")
		return
	}
	if a.containers[0].Labels[labelProject] != "" {
		verb := "stop"
		if running {
			verb = "start"
		}
		if out, err := exec.CommandContext(ctx, "docker", "compose", "-p", a.project, verb).CombinedOutput(); err != nil {
			writeError(w, http.StatusBadGateway, lastLines(string(out), 3))
			return
		}
	} else {
		for _, c := range a.containers {
			op := s.docker.stopContainer
			if running {
				op = s.docker.startContainer
			}
			if err := op(ctx, c.ID); err != nil {
				writeError(w, http.StatusBadGateway, err.Error())
				return
			}
		}
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *server) handleStart(w http.ResponseWriter, r *http.Request) { s.setRunning(w, r, true) }
func (s *server) handleStop(w http.ResponseWriter, r *http.Request)  { s.setRunning(w, r, false) }

func lastLines(s string, n int) string {
	lines := strings.Split(strings.TrimSpace(s), "\n")
	if len(lines) > n {
		lines = lines[len(lines)-n:]
	}
	return strings.Join(lines, "\n")
}
