package main

import (
	"archive/zip"
	"bytes"
	"context"
	"crypto/sha1"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"net/http"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"runtime"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"

	"gopkg.in/yaml.v3"
)

// App stores in CasaOS's format: a zip of Apps/<Name>/docker-compose.yml files whose x-casaos
// block describes the app. TemanLabsOS downloads them itself, so the stores keep working
// without CasaOS, and installs an app the way CasaOS does: fill in $AppID, $PUID, $PGID and $TZ,
// let the user adjust ports, folders and variables, then `docker compose up`.

var defaultStores = []string{
	"https://casaos.app/store/main.zip",
	"https://github.com/bigbeartechworld/big-bear-casaos/archive/refs/heads/master.zip",
}

const (
	storeRefreshEvery = 24 * time.Hour
	maxStoreZip       = 200 << 20
)

var storeAppPath = regexp.MustCompile(`(?:^|/)Apps/([^/]+)/docker-compose\.ya?ml$`)

type storeSource struct {
	ID      string    `json:"id"`
	Name    string    `json:"name"`
	URL     string    `json:"url"`
	Apps    int       `json:"apps"`
	Updated time.Time `json:"updated,omitzero"`
	Error   string    `json:"error,omitempty"`
}

// storeApp is one app from a store. Compose is the file as the store ships it (variables unset).
type storeApp struct {
	ID          string   `json:"id"`
	Name        string   `json:"name"`
	Tagline     string   `json:"tagline"`
	Category    string   `json:"category"`
	IconURL     string   `json:"iconUrl"`
	Developer   string   `json:"developer,omitempty"`
	Source      string   `json:"source"`
	Port        int      `json:"port,omitempty"`
	InstalledAs string   `json:"installedAs,omitempty"`
	Image       string   `json:"-"`
	Description string   `json:"-"`
	Screenshots []string `json:"-"`
	Tips        string   `json:"-"`
	Author      string   `json:"-"`
	Archs       []string `json:"-"`
	Compose     []byte   `json:"-"`
}

type appStores struct {
	dir  string
	http *http.Client

	mu      sync.Mutex
	urls    []string
	sources []storeSource
	apps    map[string]*storeApp
	syncing bool
}

func newAppStores(stateDir string) *appStores {
	st := &appStores{dir: filepath.Join(stateDir, "appstore"), http: &http.Client{Timeout: 5 * time.Minute}, apps: map[string]*storeApp{}}
	st.urls = defaultStores
	if data, err := os.ReadFile(filepath.Join(st.dir, "sources.json")); err == nil {
		var urls []string
		if json.Unmarshal(data, &urls) == nil {
			st.urls = urls
		}
	}
	st.loadCached()
	go st.refresh(false)
	go func() {
		for range time.Tick(storeRefreshEvery) {
			st.refresh(false)
		}
	}()
	return st
}

func sourceKey(u string) string {
	sum := sha1.Sum([]byte(u))
	return hex.EncodeToString(sum[:5])
}

// sourceName is a short, readable name: "CasaOS" for the official store, the repository name
// for GitHub archives, else the host.
func sourceName(raw string) (id, name string) {
	u, err := url.Parse(raw)
	if err != nil {
		return sourceKey(raw), raw
	}
	if strings.HasSuffix(u.Host, "casaos.app") || strings.Contains(u.Path, "IceWhaleTech/CasaOS-AppStore") {
		return "casaos", "CasaOS"
	}
	parts := strings.Split(strings.Trim(u.Path, "/"), "/")
	if u.Host == "github.com" && len(parts) >= 2 {
		if strings.Contains(strings.ToLower(parts[1]), "big-bear") {
			return strings.ToLower(parts[1]), "BigBear"
		}
		return strings.ToLower(parts[1]), parts[1]
	}
	return sourceKey(raw), u.Host
}

func (st *appStores) zipPath(u string) string { return filepath.Join(st.dir, sourceKey(u)+".zip") }

// loadCached reads the stores downloaded before, so the catalog is there right after a restart.
func (st *appStores) loadCached() {
	st.mu.Lock()
	urls := append([]string(nil), st.urls...)
	st.mu.Unlock()
	var sources []storeSource
	apps := map[string]*storeApp{}
	for _, u := range urls {
		id, name := sourceName(u)
		src := storeSource{ID: id, Name: name, URL: u}
		if info, err := os.Stat(st.zipPath(u)); err == nil {
			src.Updated = info.ModTime()
			data, _ := os.ReadFile(st.zipPath(u))
			if found, err := parseStoreZip(data, id, name); err == nil {
				for _, a := range found {
					apps[a.ID] = a
				}
				src.Apps = len(found)
			} else {
				src.Error = err.Error()
			}
		}
		sources = append(sources, src)
	}
	st.mu.Lock()
	st.sources, st.apps = sources, apps
	st.mu.Unlock()
}

// refresh downloads every store (all of them when force, else only ones older than a day).
func (st *appStores) refresh(force bool) {
	st.mu.Lock()
	if st.syncing {
		st.mu.Unlock()
		return
	}
	st.syncing = true
	urls := append([]string(nil), st.urls...)
	st.mu.Unlock()
	defer func() {
		st.loadCached()
		st.mu.Lock()
		st.syncing = false
		st.mu.Unlock()
	}()

	_ = os.MkdirAll(st.dir, 0o755)
	for _, u := range urls {
		if info, err := os.Stat(st.zipPath(u)); err == nil && !force && time.Since(info.ModTime()) < storeRefreshEvery {
			continue
		}
		if err := st.download(u); err != nil {
			log.Printf("app store %s: %v", u, err)
			st.setError(u, err.Error())
		}
	}
}

func (st *appStores) setError(u, msg string) {
	st.mu.Lock()
	defer st.mu.Unlock()
	for i := range st.sources {
		if st.sources[i].URL == u {
			st.sources[i].Error = msg
		}
	}
}

func (st *appStores) download(u string) error {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Minute)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, u, nil)
	if err != nil {
		return err
	}
	res, err := st.http.Do(req)
	if err != nil {
		return err
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusOK {
		return fmt.Errorf("download: %s", res.Status)
	}
	data, err := io.ReadAll(io.LimitReader(res.Body, maxStoreZip+1))
	if err != nil {
		return err
	}
	if len(data) > maxStoreZip {
		return errors.New("store archive is too big")
	}
	id, name := sourceName(u)
	if _, err := parseStoreZip(data, id, name); err != nil {
		return err
	}
	tmp := st.zipPath(u) + ".tmp"
	if err := os.WriteFile(tmp, data, 0o644); err != nil {
		return err
	}
	return os.Rename(tmp, st.zipPath(u))
}

// storeMeta is the part of x-casaos the store shows.
type storeMeta struct {
	Main          string            `yaml:"main"`
	Category      string            `yaml:"category"`
	Icon          string            `yaml:"icon"`
	Developer     string            `yaml:"developer"`
	Author        string            `yaml:"author"`
	PortMap       string            `yaml:"port_map"`
	Title         map[string]string `yaml:"title"`
	Tagline       map[string]string `yaml:"tagline"`
	Description   map[string]string `yaml:"description"`
	Screenshots   []string          `yaml:"screenshot_link"`
	Architectures []string          `yaml:"architectures"`
	Tips          map[string]any    `yaml:"tips"`
}

func parseStoreZip(data []byte, sourceID, sourceName string) ([]*storeApp, error) {
	zr, err := zip.NewReader(bytes.NewReader(data), int64(len(data)))
	if err != nil {
		return nil, fmt.Errorf("not a zip archive: %w", err)
	}
	var apps []*storeApp
	for _, f := range zr.File {
		m := storeAppPath.FindStringSubmatch(f.Name)
		if m == nil || f.UncompressedSize64 > 1<<20 {
			continue
		}
		rc, err := f.Open()
		if err != nil {
			continue
		}
		compose, err := io.ReadAll(rc)
		rc.Close()
		if err != nil {
			continue
		}
		if a := parseStoreApp(compose, m[1], sourceID, sourceName); a != nil {
			apps = append(apps, a)
		}
	}
	if len(apps) == 0 {
		return nil, errors.New("no apps found (expected Apps/<name>/docker-compose.yml)")
	}
	return apps, nil
}

var categoryAliases = map[string]string{"network": "Networking", "home automation": "Home", "web": "Others", "file sync": "Cloud", "gallery": "Media", "notes": "Productivity", "chat": "Social", "database": "Developer"}

func parseStoreApp(compose []byte, dirName, sourceID, sourceName string) *storeApp {
	var doc struct {
		Name     string         `yaml:"name"`
		Services map[string]any `yaml:"services"`
		XCasaOS  *storeMeta     `yaml:"x-casaos"`
	}
	if yaml.Unmarshal(compose, &doc) != nil || doc.XCasaOS == nil || len(doc.Services) == 0 {
		return nil
	}
	x := doc.XCasaOS
	if len(x.Architectures) > 0 && !containsString(x.Architectures, runtime.GOARCH) {
		return nil
	}
	slug := strings.ToLower(nonSlug.ReplaceAllString(dirName, "-"))
	a := &storeApp{
		ID:          sourceID + "." + strings.Trim(slug, "-"),
		Name:        english(x.Title),
		Tagline:     english(x.Tagline),
		Description: english(x.Description),
		Category:    strings.TrimSpace(strings.Trim(x.Category, `"`)),
		IconURL:     x.Icon,
		Developer:   x.Developer,
		Source:      sourceName,
		Screenshots: x.Screenshots,
		Author:      x.Author,
		Archs:       x.Architectures,
		Compose:     compose,
	}
	if a.Name == "" {
		a.Name = dirName
	}
	if alias, ok := categoryAliases[strings.ToLower(a.Category)]; ok {
		a.Category = alias
	}
	if a.Category == "" {
		a.Category = "Others"
	}
	a.Port, _ = strconv.Atoi(strings.Trim(x.PortMap, `"`))
	if tips, ok := x.Tips["before_install"].(map[string]any); ok {
		m := map[string]string{}
		for k, v := range tips {
			m[k] = fmt.Sprint(v)
		}
		a.Tips = english(m)
	}
	main := x.Main
	if _, ok := doc.Services[main]; !ok {
		for name := range doc.Services {
			main = name
			break
		}
	}
	if svc, ok := doc.Services[main].(map[string]any); ok {
		a.Image, _ = svc["image"].(string)
	}
	return a
}

// ----- HTTP -----

type storeListing struct {
	Syncing bool          `json:"syncing"`
	Sources []storeSource `json:"sources"`
	Apps    []storeApp    `json:"apps"`
}

func (s *server) handleAppStore(w http.ResponseWriter, r *http.Request) {
	installed, err := s.store.listApps(r.Context())
	if err != nil {
		writeError(w, http.StatusBadGateway, err.Error())
		return
	}
	st := s.stores
	st.mu.Lock()
	out := storeListing{Syncing: st.syncing, Sources: append([]storeSource(nil), st.sources...)}
	seen := map[string]bool{}
	for _, a := range st.apps {
		entry := *a
		for _, inst := range installed {
			if inst.Source == "native" {
				continue
			}
			if inst.containers != nil && len(inst.containers) > 0 && inst.containers[0].Labels[labelStoreApp] == a.ID {
				entry.InstalledAs = inst.ID
				break
			}
			if entry.Image != "" && usesImage(inst, imageRepo(entry.Image)) {
				entry.InstalledAs = inst.ID
			}
		}
		seen[strings.ToLower(a.Name)] = true
		out.Apps = append(out.Apps, entry)
	}
	st.mu.Unlock()
	// The built-in picks, unless a store already has the same app.
	for _, item := range catalog {
		if seen[strings.ToLower(item.Name)] {
			continue
		}
		entry := storeApp{ID: item.ID, Name: item.Name, Tagline: item.Description, Category: item.Category, IconURL: item.IconURL, Source: "TemanLabsOS", Port: item.Port}
		for _, inst := range installed {
			if inst.ID == item.ID || (inst.Source != "temanlabs" && usesImage(inst, item.Image)) {
				entry.InstalledAs = inst.ID
				break
			}
		}
		out.Apps = append(out.Apps, entry)
	}
	sort.Slice(out.Apps, func(i, j int) bool { return strings.ToLower(out.Apps[i].Name) < strings.ToLower(out.Apps[j].Name) })
	writeJSON(w, http.StatusOK, out)
}

func imageRepo(image string) string {
	repo, _ := splitImage(image)
	return repo
}

func (st *appStores) get(id string) *storeApp {
	st.mu.Lock()
	defer st.mu.Unlock()
	return st.apps[id]
}

type storeDetails struct {
	storeApp
	Description string   `json:"description"`
	Screenshots []string `json:"screenshots"`
	Tips        string   `json:"tips,omitempty"`
	// Who packaged it for the store, and the processors it runs on (empty: not stated).
	Author        string      `json:"author,omitempty"`
	Architectures []string    `json:"architectures,omitempty"`
	YAML          string      `json:"yaml"`
	Service       string      `json:"service"`
	Services      []string    `json:"services"`
	Spec          *customSpec `json:"spec"`
	AppID         string      `json:"appId"`
}

// resolveStoreCompose fills in what CasaOS fills in, through `docker compose config` so the file
// comes out exactly as compose reads it, then moves published ports that are taken.
func (s *server) resolveStoreCompose(ctx context.Context, a *storeApp, appID string) ([]byte, error) {
	dir, err := os.MkdirTemp("", "temanlabs-store-")
	if err != nil {
		return nil, err
	}
	defer os.RemoveAll(dir)
	file := filepath.Join(dir, "docker-compose.yml")
	if err := os.WriteFile(file, a.Compose, 0o600); err != nil {
		return nil, err
	}
	uid, gid := 1000, 1000
	if s.owner != nil {
		uid, gid = s.owner.uid, s.owner.gid
	}
	tz := strings.TrimSpace(readTrim("/etc/timezone"))
	if tz == "" {
		tz = "UTC"
	}
	cmd := exec.CommandContext(ctx, "docker", "compose", "-p", appID, "-f", file, "config", "--no-path-resolution")
	cmd.Dir = dir
	cmd.Env = append(os.Environ(), "AppID="+appID, "PUID="+strconv.Itoa(uid), "PGID="+strconv.Itoa(gid), "TZ="+tz)
	var stderr bytes.Buffer
	cmd.Stderr = &stderr
	out, err := cmd.Output()
	if err != nil {
		return nil, fmt.Errorf("the store's compose file doesn't load: %s", lastLines(stderr.String(), 3))
	}
	doc, err := parseComposeDoc(out)
	if err != nil {
		return nil, err
	}
	// The project name is TemanLabsOS's to choose; container names that would clash get the app ID.
	mapDel(doc.top(), "name")
	taken, _ := s.docker.containers(ctx)
	names := map[string]bool{}
	for _, c := range taken {
		names[c.name()] = true
	}
	for _, name := range doc.serviceNames() {
		svc := doc.service(name)
		if cn, ok := scalar(mapGet(svc, "container_name")); ok && names[cn] {
			mapSet(svc, "container_name", strNode(appID+"-"+name))
		}
	}
	movePorts(doc, s.store.portTaken)
	return doc.bytes()
}

// movePorts gives published ports that something already listens on the next free number, and
// keeps x-casaos's web UI port in step.
func movePorts(d *composeDoc, taken func(int) bool) {
	x := mapGet(d.top(), "x-casaos")
	webPort, _ := scalar(mapGet(x, "port_map"))
	used := map[int]bool{}
	for _, name := range d.serviceNames() {
		ports := mapGet(d.service(name), "ports")
		if ports == nil {
			continue
		}
		for _, p := range ports.Content {
			pub := mapGet(p, "published")
			if pub == nil {
				continue
			}
			proto, _ := scalar(mapGet(p, "protocol"))
			host, err := strconv.Atoi(strings.Trim(pub.Value, `"`))
			if err != nil {
				continue
			}
			next := host
			for (used[next] || (proto != "udp" && taken(next))) && next < 65535 {
				next++
			}
			used[next] = true
			if next != host {
				pub.Value, pub.Tag, pub.Style = strconv.Itoa(next), "!!str", yaml.DoubleQuotedStyle
				if webPort == strconv.Itoa(host) && x != nil {
					mapSet(x, "port_map", strNode(strconv.Itoa(next)))
					webPort = ""
				}
			}
		}
	}
}

func (s *server) handleStoreApp(w http.ResponseWriter, r *http.Request) {
	a := s.stores.get(r.PathValue("id"))
	if a == nil {
		writeError(w, http.StatusNotFound, "app not in any store")
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), time.Minute)
	defer cancel()
	appID, err := s.store.customID(ctx, a.Name)
	if err != nil {
		writeError(w, http.StatusBadGateway, err.Error())
		return
	}
	resolved, err := s.resolveStoreCompose(ctx, a, appID)
	if err != nil {
		writeError(w, http.StatusBadGateway, err.Error())
		return
	}
	doc, err := parseComposeDoc(resolved)
	if err != nil {
		writeError(w, http.StatusBadGateway, err.Error())
		return
	}
	service := doc.mainService()
	spec := readService(doc.service(service)).spec
	spec.Title, spec.IconURL = a.Name, a.IconURL
	x := mapGet(doc.top(), "x-casaos")
	if p, ok := scalar(mapGet(x, "port_map")); ok {
		spec.WebUI.Port, _ = strconv.Atoi(p)
	}
	spec.WebUI.Scheme, spec.WebUI.Path = "http", "/"
	if v, ok := scalar(mapGet(x, "scheme")); ok && v != "" {
		spec.WebUI.Scheme = v
	}
	if v, ok := scalar(mapGet(x, "index")); ok && v != "" {
		spec.WebUI.Path = v
	}
	writeJSON(w, http.StatusOK, storeDetails{
		storeApp: *a, Description: a.Description, Screenshots: a.Screenshots, Tips: a.Tips, Author: a.Author, Architectures: a.Archs,
		YAML: string(resolved), Service: service, Services: doc.serviceNames(), Spec: &spec, AppID: appID,
	})
}

// handleInstallStoreApp installs a store app with the settings the user reviewed: the form for
// the main service, or the whole (already resolved) compose file.
func (s *server) handleInstallStoreApp(w http.ResponseWriter, r *http.Request) {
	var body struct {
		AppID   string      `json:"appId"`
		YAML    *string     `json:"yaml"`
		Service string      `json:"service"`
		Spec    *customSpec `json:"spec"`
	}
	if err := decodeJSON(r, &body); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request: "+err.Error())
		return
	}
	a := s.stores.get(r.PathValue("id"))
	if a == nil {
		writeError(w, http.StatusNotFound, "app not in any store")
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), time.Minute)
	defer cancel()
	appID := body.AppID
	if appID == "" || !containerRef.MatchString(appID) {
		var err error
		if appID, err = s.store.customID(ctx, a.Name); err != nil {
			writeError(w, http.StatusBadGateway, err.Error())
			return
		}
	}
	var compose []byte
	if body.YAML != nil {
		compose = []byte(*body.YAML)
	} else {
		resolved, err := s.resolveStoreCompose(ctx, a, appID)
		if err != nil {
			writeError(w, http.StatusBadGateway, err.Error())
			return
		}
		compose = resolved
		if body.Spec != nil {
			doc, err := parseComposeDoc(resolved)
			if err != nil {
				writeError(w, http.StatusBadGateway, err.Error())
				return
			}
			service := body.Service
			if doc.service(service) == nil {
				service = doc.mainService()
			}
			if _, err := s.store.applyForm(doc, service, body.Spec, map[int]bool{}); err != nil {
				writeError(w, http.StatusBadRequest, err.Error())
				return
			}
			if compose, err = doc.bytes(); err != nil {
				writeError(w, http.StatusInternalServerError, err.Error())
				return
			}
		}
	}
	m := customMeta{title: a.Name, icon: a.IconURL}
	if body.Spec != nil {
		m = body.Spec.meta()
	}
	id, err := s.store.installCompose(ctx, appID, string(compose), m, map[string]string{labelStoreApp: a.ID})
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	writeJSON(w, http.StatusAccepted, map[string]string{"id": id})
}

func (s *server) handleRefreshStores(w http.ResponseWriter, r *http.Request) {
	go s.stores.refresh(true)
	w.WriteHeader(http.StatusAccepted)
}

func (s *server) handleSetStores(w http.ResponseWriter, r *http.Request) {
	var body struct {
		URLs []string `json:"urls"`
	}
	if err := decodeJSON(r, &body); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request: "+err.Error())
		return
	}
	var urls []string
	for _, u := range body.URLs {
		u = strings.TrimSpace(u)
		if u == "" {
			continue
		}
		parsed, err := url.Parse(u)
		if err != nil || (parsed.Scheme != "https" && parsed.Scheme != "http") || parsed.Host == "" {
			writeError(w, http.StatusBadRequest, fmt.Sprintf("%q is not a web address", u))
			return
		}
		if !containsString(urls, u) {
			urls = append(urls, u)
		}
	}
	st := s.stores
	_ = os.MkdirAll(st.dir, 0o755)
	data, _ := json.Marshal(urls)
	if err := os.WriteFile(filepath.Join(st.dir, "sources.json"), data, 0o644); err != nil {
		writeFSError(w, err)
		return
	}
	st.mu.Lock()
	st.urls = urls
	st.mu.Unlock()
	st.loadCached()
	go st.refresh(false)
	w.WriteHeader(http.StatusNoContent)
}
