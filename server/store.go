package main

import (
	"bytes"
	"context"
	"fmt"
	"net"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"text/template"
	"time"
)

// catalogItem is an App Center entry. Its compose template is filled with a free host port, the
// app's data directory and the owner's IDs, then run with `docker compose up -d`.
type catalogItem struct {
	ID          string    `json:"id"`
	Name        string    `json:"name"`
	Icon        string    `json:"icon"`
	IconURL     string    `json:"iconUrl"`
	Color       [2]string `json:"color"`
	Category    string    `json:"category"`
	Description string    `json:"description"`
	Port        int       `json:"port"`
	// Image repository, used to spot copies already installed some other way (e.g. by CasaOS).
	Image   string `json:"-"`
	Compose string `json:"-"`
}

const selfhst = "https://cdn.jsdelivr.net/gh/selfhst/icons/png/"

// Apps keep data where CasaOS keeps its apps' data, whatever the file manager root is.
const appDataRoot = "/DATA"

// Every service gets the temanlabs.app label (how installed copies are recognised) and a
// restart policy. Data lives under <root>/AppData/temanlabs-<id>, next to CasaOS's own apps.
var catalog = []catalogItem{
	{
		ID: "jellyfin", Name: "Jellyfin", Icon: "film", IconURL: selfhst + "jellyfin.png", Color: [2]string{"#a95ce0", "#00a4dc"},
		Category: "Media", Description: "Stream your movies, shows and music from /DATA/Media to any device.", Port: 8096, Image: "jellyfin/jellyfin",
		Compose: `services:
  jellyfin:
    image: jellyfin/jellyfin:latest
    container_name: temanlabs-jellyfin
    restart: unless-stopped
    ports: ["{{.Port}}:8096"]
    volumes:
      - {{.Data}}/config:/config
      - {{.Data}}/cache:/cache
      - {{.Root}}/Media:/media
    environment: [TZ={{.TZ}}]
    labels: {temanlabs.app: jellyfin}
`,
	},
	{
		ID: "navidrome", Name: "Navidrome", Icon: "music", IconURL: selfhst + "navidrome.png", Color: [2]string{"#3ec7ff", "#3d5afe"},
		Category: "Media", Description: "Music server and streamer for the music in /DATA/Media/Music.", Port: 4533, Image: "deluan/navidrome",
		Compose: `services:
  navidrome:
    image: deluan/navidrome:latest
    container_name: temanlabs-navidrome
    restart: unless-stopped
    user: "{{.UID}}:{{.GID}}"
    ports: ["{{.Port}}:4533"]
    volumes:
      - {{.Data}}:/data
      - {{.Root}}/Media/Music:/music:ro
    environment: [ND_SCANSCHEDULE=1h]
    labels: {temanlabs.app: navidrome}
`,
	},
	{
		ID: "uptimekuma", Name: "Uptime Kuma", Icon: "activity", IconURL: selfhst + "uptime-kuma.png", Color: [2]string{"#6ee7a0", "#14a05a"},
		Category: "Network", Description: "Monitor your services and get alerts when they go down.", Port: 3001, Image: "louislam/uptime-kuma",
		Compose: `services:
  uptime-kuma:
    image: louislam/uptime-kuma:1
    container_name: temanlabs-uptimekuma
    restart: unless-stopped
    ports: ["{{.Port}}:3001"]
    volumes: ["{{.Data}}:/app/data"]
    labels: {temanlabs.app: uptimekuma}
`,
	},
	{
		ID: "vaultwarden", Name: "Vaultwarden", Icon: "key", IconURL: selfhst + "vaultwarden.png", Color: [2]string{"#4c8dff", "#123a99"},
		Category: "Productivity", Description: "Bitwarden-compatible password manager. The web vault needs HTTPS (e.g. via Tailscale Serve).", Port: 8222, Image: "vaultwarden/server",
		Compose: `services:
  vaultwarden:
    image: vaultwarden/server:latest
    container_name: temanlabs-vaultwarden
    restart: unless-stopped
    ports: ["{{.Port}}:80"]
    volumes: ["{{.Data}}:/data"]
    labels: {temanlabs.app: vaultwarden}
`,
	},
	{
		ID: "codeserver", Name: "Code Server", Icon: "code", IconURL: selfhst + "code-server.png", Color: [2]string{"#4cc2ff", "#005fa3"},
		Category: "Developer", Description: "Full VS Code in the browser, with /DATA mounted as the workspace.", Port: 8443, Image: "linuxserver/code-server",
		Compose: `services:
  code-server:
    image: lscr.io/linuxserver/code-server:latest
    container_name: temanlabs-codeserver
    restart: unless-stopped
    ports: ["{{.Port}}:8443"]
    environment: [PUID={{.UID}}, PGID={{.GID}}, TZ={{.TZ}}, DEFAULT_WORKSPACE=/data]
    volumes:
      - {{.Data}}:/config
      - {{.Root}}:/data
    labels: {temanlabs.app: codeserver}
`,
	},
	{
		ID: "portainer", Name: "Portainer", Icon: "boxes", IconURL: selfhst + "portainer.png", Color: [2]string{"#3dd0ff", "#0b6fa4"},
		Category: "Developer", Description: "Manage Docker containers, images, volumes and networks.", Port: 9000, Image: "portainer/portainer-ce",
		Compose: `services:
  portainer:
    image: portainer/portainer-ce:latest
    container_name: temanlabs-portainer
    restart: unless-stopped
    ports: ["{{.Port}}:9000"]
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock
      - {{.Data}}:/data
    labels: {temanlabs.app: portainer}
`,
	},
	{
		ID: "dozzle", Name: "Dozzle", Icon: "scroll", IconURL: selfhst + "dozzle.png", Color: [2]string{"#ffd36e", "#ff8a00"},
		Category: "Developer", Description: "Live logs of every Docker container, in the browser.", Port: 8888, Image: "amir20/dozzle",
		Compose: `services:
  dozzle:
    image: amir20/dozzle:latest
    container_name: temanlabs-dozzle
    restart: unless-stopped
    ports: ["{{.Port}}:8080"]
    volumes: ["/var/run/docker.sock:/var/run/docker.sock:ro"]
    labels: {temanlabs.app: dozzle}
`,
	},
	{
		ID: "homeassistant", Name: "Home Assistant", Icon: "house", IconURL: selfhst + "home-assistant.png", Color: [2]string{"#41d1ff", "#0389c4"},
		Category: "Smart Home", Description: "Open-source home automation that puts local control first.", Port: 8123, Image: "home-assistant/home-assistant",
		Compose: `services:
  homeassistant:
    image: ghcr.io/home-assistant/home-assistant:stable
    container_name: temanlabs-homeassistant
    restart: unless-stopped
    ports: ["{{.Port}}:8123"]
    volumes: ["{{.Data}}:/config"]
    environment: [TZ={{.TZ}}]
    labels: {temanlabs.app: homeassistant}
`,
	},
	{
		ID: "nextcloud", Name: "Nextcloud", Icon: "cloud", IconURL: selfhst + "nextcloud.png", Color: [2]string{"#1cafff", "#0068b8"},
		Category: "Productivity", Description: "Your own cloud for files, calendar and contacts (SQLite, good for a few users).", Port: 8089, Image: "nextcloud",
		Compose: `services:
  nextcloud:
    image: nextcloud:stable
    container_name: temanlabs-nextcloud
    restart: unless-stopped
    ports: ["{{.Port}}:80"]
    volumes: ["{{.Data}}:/var/www/html"]
    labels: {temanlabs.app: nextcloud}
`,
	},
	{
		ID: "n8n", Name: "n8n", Icon: "workflow", IconURL: selfhst + "n8n.png", Color: [2]string{"#ff8a6b", "#e6366b"},
		Category: "Productivity", Description: "Workflow automation with hundreds of integrations.", Port: 5678, Image: "n8nio/n8n",
		Compose: `services:
  n8n:
    image: n8nio/n8n:latest
    container_name: temanlabs-n8n
    restart: unless-stopped
    ports: ["{{.Port}}:5678"]
    environment: [TZ={{.TZ}}, GENERIC_TIMEZONE={{.TZ}}, N8N_SECURE_COOKIE=false]
    volumes: ["{{.Data}}:/home/node/.n8n"]
    labels: {temanlabs.app: n8n}
`,
	},
	{
		ID: "ittools", Name: "IT Tools", Icon: "wrench", IconURL: selfhst + "it-tools.png", Color: [2]string{"#6ee7a0", "#1aa260"},
		Category: "Developer", Description: "Handy tools for developers: converters, generators, formatters.", Port: 8380, Image: "corentinth/it-tools",
		Compose: `services:
  it-tools:
    image: corentinth/it-tools:latest
    container_name: temanlabs-ittools
    restart: unless-stopped
    ports: ["{{.Port}}:80"]
    labels: {temanlabs.app: ittools}
`,
	},
}

func findCatalog(id string) *catalogItem {
	for i := range catalog {
		if catalog[i].ID == id {
			return &catalog[i]
		}
	}
	return nil
}

type appStore struct {
	cfg    *Config
	docker *dockerClient
	owner  *owner

	mu         sync.Mutex
	installing map[string]bool
	errors     map[string]string
	// Manual installs still pulling (or failed), shown until their containers exist.
	custom map[string]*app
	// Web apps running outside Docker.
	native *nativeApps
}

func newAppCenter(cfg *Config, docker *dockerClient, o *owner) *appStore {
	return &appStore{cfg: cfg, docker: docker, owner: o, installing: map[string]bool{}, errors: map[string]string{}, custom: map[string]*app{}}
}

func (s *appStore) isInstalling(id string) bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.installing[id]
}

func (s *appStore) installError(id string) string {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.errors[id]
}

func (s *appStore) composeFile(id string) string {
	return filepath.Join(s.cfg.StateDir, "apps", id, "docker-compose.yml")
}

// pendingApps are catalog apps being installed (or that failed) with no containers yet.
func (s *appStore) pendingApps(existing map[string]*app) []*app {
	s.mu.Lock()
	ids := map[string]bool{}
	for id := range s.installing {
		ids[id] = true
	}
	for id := range s.errors {
		ids[id] = true
	}
	s.mu.Unlock()

	var pending []*app
	for id := range ids {
		if _, ok := existing["temanlabs-"+id]; ok {
			continue
		}
		var a *app
		if item := findCatalog(id); item != nil {
			port := item.Port
			a = &app{
				ID: id, Name: item.Name, Icon: item.Icon, Color: item.Color, Category: item.Category,
				Description: item.Description, Port: &port, Path: "/", Scheme: "http",
				Source: "temanlabs", CanUninstall: true,
			}
		} else {
			s.mu.Lock()
			placeholder := s.custom[id]
			s.mu.Unlock()
			if placeholder == nil {
				continue
			}
			copied := *placeholder
			a = &copied
		}
		a.Status = "stopped"
		if s.isInstalling(id) {
			a.Status = "installing"
		}
		a.Error = s.installError(id)
		pending = append(pending, a)
	}
	return pending
}

// portFree reports whether nothing (including Docker's proxies) is listening on the port.
func portFree(port int) bool {
	l, err := net.Listen("tcp", ":"+strconv.Itoa(port))
	if err != nil {
		return false
	}
	l.Close()
	return true
}

func freePortFrom(port int) (int, error) {
	for p := port; p < port+200 && p < 65536; p++ {
		if portFree(p) {
			return p, nil
		}
	}
	return 0, fmt.Errorf("no free port near %d", port)
}

func (s *appStore) install(id string) error {
	item := findCatalog(id)
	if item == nil {
		return fmt.Errorf("unknown app %q", id)
	}
	s.mu.Lock()
	if s.installing[id] {
		s.mu.Unlock()
		return fmt.Errorf("%s is already being installed", item.Name)
	}
	s.installing[id] = true
	delete(s.errors, id)
	s.mu.Unlock()

	fail := func(err error) error {
		s.mu.Lock()
		delete(s.installing, id)
		s.errors[id] = err.Error()
		s.mu.Unlock()
		return err
	}

	port, err := freePortFrom(item.Port)
	if err != nil {
		return fail(err)
	}
	data := filepath.Join(appDataRoot, "AppData", "temanlabs-"+id)
	if err := os.MkdirAll(data, 0o755); err != nil {
		return fail(err)
	}
	uid, gid := 0, 0
	if s.owner != nil {
		uid, gid = s.owner.uid, s.owner.gid
		_ = os.Chown(data, uid, gid)
	}
	tz := strings.TrimSpace(readTrim("/etc/timezone"))
	if tz == "" {
		tz = "UTC"
	}
	var compose bytes.Buffer
	err = template.Must(template.New(id).Parse(item.Compose)).Execute(&compose, map[string]any{
		"Port": port, "Data": data, "Root": appDataRoot, "TZ": tz, "UID": uid, "GID": gid,
	})
	if err != nil {
		return fail(err)
	}
	file := s.composeFile(id)
	if err := os.MkdirAll(filepath.Dir(file), 0o755); err != nil {
		return fail(err)
	}
	if err := os.WriteFile(file, compose.Bytes(), 0o644); err != nil {
		return fail(err)
	}

	s.composeUp(id, file)
	return nil
}

// composeUp starts an install in the background: pulling an image can take minutes, so the
// request returns now and the UI polls /api/apps.
func (s *appStore) composeUp(id, file string) {
	go func() {
		ctx, cancel := context.WithTimeout(context.Background(), 30*time.Minute)
		defer cancel()
		out, err := exec.CommandContext(ctx, "docker", "compose", "-p", "temanlabs-"+id, "-f", file, "up", "-d").CombinedOutput()
		s.mu.Lock()
		defer s.mu.Unlock()
		delete(s.installing, id)
		if err != nil {
			s.errors[id] = lastLines(string(out), 4)
		}
	}()
}

// uninstall removes the containers TemanLabsOS created. Data under AppData is kept.
func (s *appStore) uninstall(ctx context.Context, id string) error {
	file := s.composeFile(id)
	if _, err := os.Stat(file); err == nil {
		out, err := exec.CommandContext(ctx, "docker", "compose", "-p", "temanlabs-"+id, "-f", file, "down").CombinedOutput()
		if err != nil {
			return fmt.Errorf("%s", lastLines(string(out), 3))
		}
		_ = os.RemoveAll(filepath.Dir(file))
	}
	s.mu.Lock()
	delete(s.errors, id)
	delete(s.custom, id)
	s.mu.Unlock()
	return nil
}

type storeEntry struct {
	catalogItem
	// ID of an app already running this image (e.g. installed through CasaOS), if any.
	InstalledAs string `json:"installedAs,omitempty"`
}

func (s *server) handleStore(w http.ResponseWriter, r *http.Request) {
	apps, err := s.store.listApps(r.Context())
	if err != nil {
		writeError(w, http.StatusBadGateway, err.Error())
		return
	}
	entries := make([]storeEntry, 0, len(catalog))
	for _, item := range catalog {
		entry := storeEntry{catalogItem: item}
		for _, a := range apps {
			if a.ID == item.ID {
				break
			}
			if a.Source != "temanlabs" && usesImage(a, item.Image) {
				entry.InstalledAs = a.ID
				break
			}
		}
		entries = append(entries, entry)
	}
	writeJSON(w, http.StatusOK, entries)
}

func usesImage(a *app, repo string) bool {
	for _, c := range a.containers {
		image, _, _ := strings.Cut(c.Image, ":")
		if image == repo || strings.HasSuffix(image, "/"+repo) {
			return true
		}
	}
	return false
}

func (s *server) handleInstall(w http.ResponseWriter, r *http.Request) {
	if err := s.store.install(r.PathValue("id")); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	w.WriteHeader(http.StatusAccepted)
}

func (s *server) handleUninstall(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	a, err := s.findApp(r.Context(), id)
	if err != nil {
		writeError(w, http.StatusBadGateway, err.Error())
		return
	}
	if a != nil && !a.CanUninstall {
		msg := "Only apps installed from the TemanLabsOS App Center can be uninstalled here."
		if a.Source == "casaos" {
			msg = "This app is managed by CasaOS. Uninstall it from CasaOS."
		}
		writeError(w, http.StatusForbidden, msg)
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Minute)
	defer cancel()
	if err := s.store.uninstall(ctx, id); err != nil {
		writeError(w, http.StatusBadGateway, err.Error())
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
