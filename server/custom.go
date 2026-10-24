package main

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strconv"
	"strings"

	"gopkg.in/yaml.v3"
)

// Labels carrying a custom app's details, since it has no catalog entry. Every service of the
// project gets them, so whichever container is listed first describes the app.
const (
	labelName   = "temanlabs.name"
	labelIcon   = "temanlabs.icon"
	labelPort   = "temanlabs.port"
	labelScheme = "temanlabs.scheme"
	labelPath   = "temanlabs.path"
)

var (
	imageRef    = regexp.MustCompile(`^[a-z0-9][a-z0-9._/:@-]{0,254}$`)
	tagRef      = regexp.MustCompile(`^[A-Za-z0-9_][A-Za-z0-9_.-]{0,127}$`)
	envKey      = regexp.MustCompile(`^[A-Za-z_][A-Za-z0-9_.-]{0,127}$`)
	capability  = regexp.MustCompile(`^[A-Z_]{2,40}$`)
	networkName = regexp.MustCompile(`^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,127}$`)
	nonSlug     = regexp.MustCompile(`[^a-z0-9]+`)
)

// customSpec is the Manual Install form (see CustomInstall.tsx). With Compose set, the form
// fields other than Title and IconURL are ignored and that compose file is installed instead.
type customSpec struct {
	Compose string `json:"compose"`

	Image   string `json:"image"`
	Tag     string `json:"tag"`
	Title   string `json:"title"`
	IconURL string `json:"iconUrl"`
	WebUI   struct {
		Scheme string `json:"scheme"`
		Port   int    `json:"port"`
		Path   string `json:"path"`
	} `json:"webUi"`
	Network string `json:"network"`
	Ports   []struct {
		Host      int    `json:"host"`
		Container int    `json:"container"`
		Protocol  string `json:"protocol"`
	} `json:"ports"`
	Volumes []struct {
		Host      string `json:"host"`
		Container string `json:"container"`
		ReadOnly  bool   `json:"readOnly"`
	} `json:"volumes"`
	Env []struct {
		Key   string `json:"key"`
		Value string `json:"value"`
	} `json:"env"`
	Devices []struct {
		Host      string `json:"host"`
		Container string `json:"container"`
	} `json:"devices"`
	Command    string   `json:"command"`
	Restart    string   `json:"restart"`
	Privileged bool     `json:"privileged"`
	MemoryMB   int      `json:"memoryMb"`
	CPUShares  int      `json:"cpuShares"`
	CapAdd     []string `json:"capAdd"`
	Hostname   string   `json:"hostname"`
}

// composeService is the subset of a compose service the form can produce, in compose's order.
type composeService struct {
	Image         string            `yaml:"image"`
	ContainerName string            `yaml:"container_name"`
	Hostname      string            `yaml:"hostname,omitempty"`
	Restart       string            `yaml:"restart"`
	NetworkMode   string            `yaml:"network_mode,omitempty"`
	Networks      []string          `yaml:"networks,omitempty"`
	Ports         []string          `yaml:"ports,omitempty"`
	Volumes       []string          `yaml:"volumes,omitempty"`
	Environment   map[string]string `yaml:"environment,omitempty"`
	Devices       []string          `yaml:"devices,omitempty"`
	Command       string            `yaml:"command,omitempty"`
	Privileged    bool              `yaml:"privileged,omitempty"`
	MemLimit      string            `yaml:"mem_limit,omitempty"`
	CPUShares     int               `yaml:"cpu_shares,omitempty"`
	CapAdd        []string          `yaml:"cap_add,omitempty"`
	Labels        map[string]string `yaml:"labels"`
}

// absPath accepts clean absolute paths (a trailing slash is fine).
func absPath(p string) bool {
	if p == "/" {
		return true
	}
	p = strings.TrimSuffix(p, "/")
	return strings.HasPrefix(p, "/") && filepath.Clean(p) == p
}

// mkdirOwned creates a folder and any missing parents, all owned by the configured user.
func (s *appStore) mkdirOwned(dir string) error {
	var missing []string
	for p := filepath.Clean(dir); p != "/"; p = filepath.Dir(p) {
		if _, err := os.Stat(p); err == nil {
			break
		}
		missing = append(missing, p)
	}
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return err
	}
	if s.owner != nil {
		for _, p := range missing {
			_ = os.Chown(p, s.owner.uid, s.owner.gid)
		}
	}
	return nil
}

// meta is what the Dock shows for the app; it's written as labels on every service.
type customMeta struct {
	title, icon, scheme, path string
	port                      int
}

func (m customMeta) labels(id string) map[string]string {
	l := map[string]string{labelTemanLabs: id, labelName: m.title}
	if m.icon != "" {
		l[labelIcon] = m.icon
	}
	if m.port > 0 {
		l[labelPort] = strconv.Itoa(m.port)
		l[labelScheme] = m.scheme
		l[labelPath] = m.path
	}
	return l
}

func (spec *customSpec) meta() customMeta {
	m := customMeta{
		title:  strings.TrimSpace(spec.Title),
		icon:   strings.TrimSpace(spec.IconURL),
		scheme: spec.WebUI.Scheme,
		path:   spec.WebUI.Path,
		port:   spec.WebUI.Port,
	}
	if m.scheme != "https" {
		m.scheme = "http"
	}
	if !strings.HasPrefix(m.path, "/") {
		m.path = "/" + m.path
	}
	return m
}

// buildCompose turns the form into a compose file. Everything goes through yaml.Marshal, so no
// field can inject extra YAML.
func (s *appStore) buildCompose(spec *customSpec, id string, m customMeta) ([]byte, error) {
	image := strings.TrimSpace(spec.Image)
	if !imageRef.MatchString(image) {
		return nil, errors.New("Docker image must look like name or registry/name:tag (lowercase)")
	}
	if tag := strings.TrimSpace(spec.Tag); tag != "" {
		if !tagRef.MatchString(tag) {
			return nil, fmt.Errorf("invalid tag %q", tag)
		}
		if strings.Contains(image[strings.LastIndex(image, "/")+1:], ":") {
			return nil, errors.New("give the tag either in the image or in the Tag field, not both")
		}
		image += ":" + tag
	}

	svc := composeService{Image: image, ContainerName: id, Restart: "unless-stopped", Labels: m.labels(id)}
	switch spec.Restart {
	case "", "unless-stopped":
	case "no", "always", "on-failure":
		svc.Restart = spec.Restart
	default:
		return nil, fmt.Errorf("unknown restart policy %q", spec.Restart)
	}

	var external string
	switch net := strings.TrimSpace(spec.Network); net {
	case "", "bridge":
		svc.NetworkMode = "bridge"
	case "host":
		svc.NetworkMode = "host"
	default:
		if !networkName.MatchString(net) {
			return nil, fmt.Errorf("invalid network %q", net)
		}
		svc.Networks, external = []string{net}, net
	}

	if svc.NetworkMode != "host" {
		for _, p := range spec.Ports {
			proto := p.Protocol
			if proto == "" {
				proto = "tcp"
			}
			if proto != "tcp" && proto != "udp" {
				return nil, fmt.Errorf("port protocol must be tcp or udp, not %q", proto)
			}
			if p.Container < 1 || p.Container > 65535 || p.Host < 0 || p.Host > 65535 {
				return nil, fmt.Errorf("port %d:%d is out of range", p.Host, p.Container)
			}
			host := p.Host
			if host == 0 {
				host = p.Container
			}
			if proto == "tcp" && !portFree(host) {
				return nil, fmt.Errorf("host port %d is already in use", host)
			}
			svc.Ports = append(svc.Ports, fmt.Sprintf("%d:%d/%s", host, p.Container, proto))
		}
	}

	for _, v := range spec.Volumes {
		host, ctr := strings.TrimSpace(v.Host), strings.TrimSpace(v.Container)
		if !absPath(host) || !absPath(ctr) || strings.ContainsAny(host+ctr, ":\n") {
			return nil, fmt.Errorf("volume paths must be absolute: %q → %q", host, ctr)
		}
		// Docker would create a missing host folder as root; create it as the owner, like CasaOS.
		if err := s.mkdirOwned(host); err != nil {
			return nil, err
		}
		entry := host + ":" + ctr
		if v.ReadOnly {
			entry += ":ro"
		}
		svc.Volumes = append(svc.Volumes, entry)
	}

	for _, e := range spec.Env {
		key := strings.TrimSpace(e.Key)
		if key == "" {
			continue
		}
		if !envKey.MatchString(key) {
			return nil, fmt.Errorf("invalid environment variable name %q", key)
		}
		if svc.Environment == nil {
			svc.Environment = map[string]string{}
		}
		svc.Environment[key] = e.Value
	}

	for _, d := range spec.Devices {
		host, ctr := strings.TrimSpace(d.Host), strings.TrimSpace(d.Container)
		if ctr == "" {
			ctr = host
		}
		if !strings.HasPrefix(host, "/dev/") || !absPath(ctr) || strings.ContainsAny(host+ctr, ":\n") {
			return nil, fmt.Errorf("devices must be under /dev: %q", host)
		}
		svc.Devices = append(svc.Devices, host+":"+ctr)
	}

	for _, c := range spec.CapAdd {
		c = strings.ToUpper(strings.TrimSpace(c))
		if c == "" {
			continue
		}
		if !capability.MatchString(c) {
			return nil, fmt.Errorf("invalid capability %q", c)
		}
		svc.CapAdd = append(svc.CapAdd, c)
	}

	svc.Command = strings.TrimSpace(spec.Command)
	svc.Privileged = spec.Privileged
	if spec.MemoryMB > 0 {
		svc.MemLimit = strconv.Itoa(spec.MemoryMB) + "m"
	}
	if spec.CPUShares > 0 {
		svc.CPUShares = spec.CPUShares
	}
	if h := strings.TrimSpace(spec.Hostname); h != "" {
		if !containerRef.MatchString(h) {
			return nil, fmt.Errorf("invalid hostname %q", h)
		}
		svc.Hostname = h
	}

	doc := map[string]any{"services": map[string]composeService{id: svc}}
	if external != "" {
		doc["networks"] = map[string]any{external: map[string]bool{"external": true}}
	}
	return yaml.Marshal(doc)
}

// pastedCompose is a compose file from the Manual Install form, parsed but not yet labelled.
type pastedCompose struct {
	doc      map[string]any
	services map[string]any
}

// parseCompose reads a pasted compose file. CasaOS app files carry their title, icon and web UI
// in an x-casaos block, which fills in whatever the form left empty.
func parseCompose(text string, m customMeta) (*pastedCompose, customMeta, error) {
	var doc map[string]any
	if err := yaml.Unmarshal([]byte(text), &doc); err != nil {
		return nil, m, fmt.Errorf("compose file: %w", err)
	}
	services, ok := doc["services"].(map[string]any)
	if !ok || len(services) == 0 {
		return nil, m, errors.New("compose file has no services")
	}
	main := ""

	var casa struct {
		XCasaOS *casaosMeta `yaml:"x-casaos"`
	}
	if yaml.Unmarshal([]byte(text), &casa) == nil && casa.XCasaOS != nil {
		x := casa.XCasaOS
		main = x.Main
		if m.title == "" {
			m.title = english(x.Title)
		}
		if m.icon == "" {
			m.icon = x.Icon
		}
		if p, err := strconv.Atoi(x.PortMap); err == nil && m.port == 0 {
			m.port, m.scheme, m.path = p, "http", "/"
			if x.Scheme != "" {
				m.scheme = x.Scheme
			}
			if x.Index != "" {
				m.path = x.Index
			}
		}
	}
	if m.title == "" {
		if _, ok := services[main]; !ok {
			names := make([]string, 0, len(services))
			for name := range services {
				names = append(names, name)
			}
			sort.Strings(names)
			main = names[0]
		}
		m.title = prettify(main)
	}
	return &pastedCompose{doc, services}, m, nil
}

// labelled adds the app's labels to every service and returns the compose file to install.
func (c *pastedCompose) labelled(id string, m customMeta) ([]byte, error) {
	labels := m.labels(id)
	for name, raw := range c.services {
		svc, ok := raw.(map[string]any)
		if !ok {
			return nil, fmt.Errorf("service %q is not a mapping", name)
		}
		switch existing := svc["labels"].(type) {
		case nil:
			svc["labels"] = labels
		case map[string]any:
			for k, v := range labels {
				existing[k] = v
			}
		case []any:
			for k, v := range labels {
				existing = append(existing, k+"="+v)
			}
			svc["labels"] = existing
		default:
			return nil, fmt.Errorf("service %q has unreadable labels", name)
		}
	}
	return yaml.Marshal(c.doc)
}

// customID turns a title into an app ID that no app, catalog entry or container uses yet.
func (s *appStore) customID(ctx context.Context, title string) (string, error) {
	base := strings.Trim(nonSlug.ReplaceAllString(strings.ToLower(title), "-"), "-")
	if len(base) > 40 {
		base = strings.Trim(base[:40], "-")
	}
	if base == "" {
		base = "app"
	}
	taken := map[string]bool{}
	containers, err := s.docker.containers(ctx)
	if err != nil {
		return "", err
	}
	for _, c := range containers {
		taken[c.name()] = true
		taken[c.Labels[labelProject]] = true
		taken[c.Labels[labelTemanLabs]] = true
	}
	s.mu.Lock()
	for id := range s.installing {
		taken[id] = true
	}
	s.mu.Unlock()
	for n := 1; ; n++ {
		id := base
		if n > 1 {
			id = fmt.Sprintf("%s-%d", base, n)
		}
		if !taken[id] && !taken["temanlabs-"+id] && findCatalog(id) == nil {
			if _, err := os.Stat(s.composeFile(id)); errors.Is(err, os.ErrNotExist) {
				return id, nil
			}
		}
	}
}

func (s *appStore) installCustom(ctx context.Context, spec *customSpec) (string, error) {
	m := spec.meta()
	if spec.Compose == "" && m.title == "" {
		return "", errors.New("title is required")
	}
	if m.port < 0 || m.port > 65535 {
		return "", errors.New("web UI port is out of range")
	}
	if m.icon != "" && !strings.HasPrefix(m.icon, "http://") && !strings.HasPrefix(m.icon, "https://") {
		return "", errors.New("icon URL must start with http:// or https://")
	}

	// A pasted file may name the app itself (x-casaos), so read it before choosing the ID.
	var pasted *pastedCompose
	if spec.Compose != "" {
		var err error
		if pasted, m, err = parseCompose(spec.Compose, m); err != nil {
			return "", err
		}
	}
	id, err := s.customID(ctx, m.title)
	if err != nil {
		return "", err
	}

	var compose []byte
	if pasted != nil {
		compose, err = pasted.labelled(id, m)
	} else {
		compose, err = s.buildCompose(spec, id, m)
	}
	if err != nil {
		return "", err
	}

	file := s.composeFile(id)
	if err := os.MkdirAll(filepath.Dir(file), 0o755); err != nil {
		return "", err
	}
	if err := os.WriteFile(file, compose, 0o644); err != nil {
		return "", err
	}

	port := m.port
	placeholder := &app{
		ID: id, Name: m.title, Icon: "boxes", IconURL: m.icon, Color: colorFor(m.title), Category: "Apps",
		Description: "Custom app", Path: m.path, Scheme: m.scheme, Source: "temanlabs", CanUninstall: true,
	}
	if port > 0 {
		placeholder.Port = &port
	}
	s.mu.Lock()
	if s.installing[id] {
		s.mu.Unlock()
		return "", fmt.Errorf("%s is already being installed", m.title)
	}
	s.installing[id] = true
	s.custom[id] = placeholder
	delete(s.errors, id)
	s.mu.Unlock()
	s.composeUp(id, file)
	return id, nil
}

func (s *server) handleInstallCustom(w http.ResponseWriter, r *http.Request) {
	var spec customSpec
	if err := decodeJSON(r, &spec); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request: "+err.Error())
		return
	}
	id, err := s.store.installCustom(r.Context(), &spec)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	writeJSON(w, http.StatusAccepted, map[string]string{"id": id})
}

// handleNetworks lists Docker networks for the Manual Install form.
func (s *server) handleNetworks(w http.ResponseWriter, r *http.Request) {
	var list []struct {
		Name   string `json:"Name"`
		Driver string `json:"Driver"`
	}
	if err := s.docker.do(r.Context(), http.MethodGet, "/networks", &list); err != nil {
		writeError(w, http.StatusBadGateway, err.Error())
		return
	}
	names := []string{"bridge", "host"}
	for _, n := range list {
		if n.Name != "bridge" && n.Name != "host" && n.Name != "none" && n.Driver != "null" {
			names = append(names, n.Name)
		}
	}
	writeJSON(w, http.StatusOK, names)
}

// describeCustom fills in a TemanLabsOS-installed app that isn't in the catalog from its labels.
func describeCustom(a *app, labels map[string]string) {
	if name := labels[labelName]; name != "" {
		a.Name = name
	}
	a.IconURL = labels[labelIcon]
	if a.IconURL == "" && len(a.containers) > 0 {
		a.IconURL = iconFor(a.containers[0].Image)
	}
	if p, err := strconv.Atoi(labels[labelPort]); err == nil && p > 0 {
		a.Port = &p
		a.Scheme = labels[labelScheme]
		if a.Scheme == "" {
			a.Scheme = "http"
		}
		if a.Path = labels[labelPath]; a.Path == "" {
			a.Path = "/"
		}
	}
}
