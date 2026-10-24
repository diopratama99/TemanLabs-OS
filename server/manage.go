package main

import (
	"bytes"
	"context"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"fmt"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"slices"
	"strings"
	"time"
)

// Managing installed apps the way CasaOS does: edit their settings, update their images,
// uninstall them (optionally with their data) and open a shell in their containers. Any
// compose project works, whoever created it: TemanLabsOS, CasaOS or a compose file in a home
// folder. Containers started with `docker run` can be updated and removed.

const labelWorkingDir = "com.docker.compose.project.working_dir"

// composeRef is how to run `docker compose` against an app's own files.
type composeRef struct {
	project string
	files   []string
	dir     string
}

func (c *composeRef) args(extra ...string) []string {
	args := []string{"docker", "compose", "-p", c.project, "--project-directory", c.dir}
	for _, f := range c.files {
		args = append(args, "-f", f)
	}
	return append(args, extra...)
}

func (c *composeRef) run(ctx context.Context, extra ...string) ([]byte, error) {
	args := c.args(extra...)
	cmd := exec.CommandContext(ctx, args[0], args[1:]...)
	cmd.Dir = c.dir
	return cmd.CombinedOutput()
}

// composeOf finds an app's compose files. It returns nil and no reason for a lone container,
// and nil with a reason when the app is compose-managed but its files can't be used.
func composeOf(a *app) (*composeRef, string) {
	if len(a.containers) == 0 {
		return nil, "The app has no containers yet."
	}
	labels := a.containers[0].Labels
	if labels[labelProject] == "" {
		return nil, ""
	}
	var files []string
	for _, f := range strings.Split(labels[labelConfigFiles], ",") {
		if f = strings.TrimSpace(f); f == "" {
			continue
		}
		if _, err := os.Stat(f); err != nil {
			return nil, fmt.Sprintf("Its compose file %s no longer exists.", f)
		}
		files = append(files, f)
	}
	if len(files) == 0 {
		return nil, "Docker doesn't know which compose file started it."
	}
	dir := labels[labelWorkingDir]
	if dir == "" {
		dir = filepath.Dir(files[0])
	}
	return &composeRef{project: labels[labelProject], files: files, dir: dir}, ""
}

func ownPorts(a *app) map[int]bool {
	ports := map[int]bool{}
	for _, c := range a.containers {
		for _, p := range c.Ports {
			if p.PublicPort > 0 {
				ports[p.PublicPort] = true
			}
		}
	}
	return ports
}

// ----- Settings -----

type appContainer struct {
	ID      string `json:"id"`
	Name    string `json:"name"`
	Service string `json:"service,omitempty"`
	State   string `json:"state"`
	Image   string `json:"image"`
}

type appConfig struct {
	Source     string         `json:"source"`
	Editable   bool           `json:"editable"`
	Reason     string         `json:"reason,omitempty"`
	CanUpdate  bool           `json:"canUpdate"`
	File       string         `json:"file,omitempty"`
	ExtraFiles []string       `json:"extraFiles,omitempty"`
	YAML       string         `json:"yaml,omitempty"`
	Service    string         `json:"service,omitempty"`
	Services   []string       `json:"services,omitempty"`
	Spec       *customSpec    `json:"spec,omitempty"`
	Containers []appContainer `json:"containers"`
	// Folders "delete app data" would remove.
	DataDirs []string `json:"dataDirs"`
}

func (s *server) appOr404(w http.ResponseWriter, r *http.Request) *app {
	a, err := s.findApp(r.Context(), r.PathValue("id"))
	if err != nil {
		writeError(w, http.StatusBadGateway, err.Error())
		return nil
	}
	if a == nil {
		writeError(w, http.StatusNotFound, "app not found")
		return nil
	}
	return a
}

func (s *server) handleAppConfig(w http.ResponseWriter, r *http.Request) {
	a := s.appOr404(w, r)
	if a == nil {
		return
	}
	cfg := appConfig{Source: a.Source, Containers: []appContainer{}, DataDirs: []string{}}
	for _, c := range a.containers {
		cfg.Containers = append(cfg.Containers, appContainer{ID: c.ID, Name: c.name(), Service: c.Labels[labelService], State: c.State, Image: c.Image})
	}
	if a.Source == "native" {
		cfg.Reason = "This app runs outside Docker, so it has no container settings."
		writeJSON(w, http.StatusOK, cfg)
		return
	}
	cfg.CanUpdate = len(a.containers) > 0
	ref, reason := composeOf(a)
	switch {
	case ref == nil && reason == "":
		cfg.Reason = "Started with docker run: there is no compose file to edit. Update and Uninstall still work."
		cfg.DataDirs = s.containerDataDirs(r.Context(), a)
	case ref == nil:
		cfg.Reason, cfg.CanUpdate = reason, false
	default:
		data, err := os.ReadFile(ref.files[0])
		if err != nil {
			writeFSError(w, err)
			return
		}
		cfg.File, cfg.ExtraFiles, cfg.YAML = ref.files[0], ref.files[1:], string(data)
		doc, err := parseComposeDoc(data)
		if err != nil {
			cfg.Reason = err.Error() + " Fix it in the Compose tab."
			break
		}
		cfg.Services = doc.serviceNames()
		cfg.Service = r.URL.Query().Get("service")
		if doc.service(cfg.Service) == nil {
			cfg.Service = doc.mainService()
		}
		spec := readService(doc.service(cfg.Service)).spec
		spec.Title, spec.IconURL = a.Name, a.IconURL
		spec.WebUI.Scheme, spec.WebUI.Path = a.Scheme, a.Path
		if a.Port != nil {
			spec.WebUI.Port = *a.Port
		}
		cfg.Spec, cfg.Editable = &spec, true
		cfg.DataDirs = appDataDirs(doc.bindSources())
	}
	writeJSON(w, http.StatusOK, cfg)
}

// handleSaveAppConfig writes new settings (the form, or the whole compose file) and recreates
// the containers that changed, as a job.
func (s *server) handleSaveAppConfig(w http.ResponseWriter, r *http.Request) {
	var body struct {
		YAML    *string     `json:"yaml"`
		Service string      `json:"service"`
		Spec    *customSpec `json:"spec"`
	}
	if err := decodeJSON(r, &body); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request: "+err.Error())
		return
	}
	a := s.appOr404(w, r)
	if a == nil {
		return
	}
	ref, reason := composeOf(a)
	if ref == nil {
		if reason == "" {
			reason = "Apps started with docker run have no compose file to change."
		}
		writeError(w, http.StatusBadRequest, reason)
		return
	}
	file := ref.files[0]
	current, err := os.ReadFile(file)
	if err != nil {
		writeFSError(w, err)
		return
	}

	var next []byte
	switch {
	case body.YAML != nil:
		next = []byte(*body.YAML)
		if _, err := parseComposeDoc(next); err != nil {
			writeError(w, http.StatusBadRequest, err.Error())
			return
		}
	case body.Spec != nil:
		doc, err := parseComposeDoc(current)
		if err != nil {
			writeError(w, http.StatusBadRequest, err.Error())
			return
		}
		service := body.Service
		if doc.service(service) == nil {
			service = doc.mainService()
		}
		changed, err := s.store.applyForm(doc, service, body.Spec, ownPorts(a))
		if err != nil {
			writeError(w, http.StatusBadRequest, err.Error())
			return
		}
		m := body.Spec.meta()
		port := 0
		if a.Port != nil {
			port = *a.Port
		}
		if m.title != a.Name || m.icon != a.IconURL || m.port != port || (m.port > 0 && (m.scheme != a.Scheme || m.path != a.Path)) {
			if m.title == "" {
				m.title = a.Name
			}
			// The icon guessed from the image isn't worth pinning in the file.
			if m.icon == iconFor(a.containers[0].Image) {
				m.icon = ""
			}
			applyMeta(doc, m)
			changed = true
		}
		if !changed {
			writeJSON(w, http.StatusOK, map[string]string{"job": ""})
			return
		}
		if next, err = doc.bytes(); err != nil {
			writeError(w, http.StatusInternalServerError, err.Error())
			return
		}
	default:
		writeError(w, http.StatusBadRequest, "nothing to save")
		return
	}
	if bytes.Equal(next, current) {
		writeJSON(w, http.StatusOK, map[string]string{"job": ""})
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), time.Minute)
	defer cancel()
	if err := checkCompose(ctx, ref, next); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	info, err := os.Stat(file)
	if err != nil {
		writeFSError(w, err)
		return
	}
	// One step of undo, the way CasaOS keeps docker-compose.yml.bak.
	_ = os.WriteFile(file+".bak", current, info.Mode().Perm())
	if err := os.WriteFile(file, next, info.Mode().Perm()); err != nil {
		writeFSError(w, err)
		return
	}
	verb := []string{"up", "-d", "--remove-orphans"}
	if a.Status != "running" {
		verb = []string{"up", "--no-start", "--remove-orphans"}
	}
	kind := "app-" + a.ID
	if _, err := chainJob(kind, "Applying settings to "+a.Name, nil, ref.dir, ref.args(verb...)); err != nil {
		writeError(w, http.StatusConflict, err.Error())
		return
	}
	writeJSON(w, http.StatusAccepted, map[string]string{"job": kind})
}

// checkCompose asks docker compose whether the new file is valid, next to the real one so
// relative paths and .env files resolve the same way.
func checkCompose(ctx context.Context, ref *composeRef, next []byte) error {
	id := make([]byte, 4)
	_, _ = rand.Read(id)
	tmp := filepath.Join(filepath.Dir(ref.files[0]), ".temanlabs-check-"+hex.EncodeToString(id)+".yml")
	if err := os.WriteFile(tmp, next, 0o600); err != nil {
		return err
	}
	defer os.Remove(tmp)
	check := *ref
	check.files = append([]string{tmp}, ref.files[1:]...)
	if out, err := check.run(ctx, "config", "-q"); err != nil {
		msg := strings.ReplaceAll(lastLines(string(out), 4), tmp, filepath.Base(ref.files[0]))
		if msg == "" {
			msg = err.Error()
		}
		return errors.New(msg)
	}
	return nil
}

// ----- Update -----

func (s *server) handleUpdateApp(w http.ResponseWriter, r *http.Request) {
	a := s.appOr404(w, r)
	if a == nil {
		return
	}
	if a.Source == "native" || len(a.containers) == 0 {
		writeError(w, http.StatusBadRequest, "Only Docker apps can be updated here.")
		return
	}
	kind := "app-" + a.ID
	images := appImages(a)
	after := func() { s.updates.forget(images) }
	ref, reason := composeOf(a)
	var err error
	switch {
	case ref != nil:
		up := []string{"up", "-d"}
		if a.Status != "running" {
			up = []string{"up", "--no-start"}
		}
		_, err = chainJob(kind, "Updating "+a.Name, after, ref.dir,
			ref.args("pull", "--ignore-buildable"),
			ref.args(up...))
	case reason != "":
		err = errors.New(reason)
	default:
		ids := make([]string, 0, len(a.containers))
		for _, c := range a.containers {
			ids = append(ids, c.ID)
		}
		_, err = startFuncJob(kind, "Updating "+a.Name, func(ctx context.Context, logf func(string, ...any)) error {
			defer after()
			for _, id := range ids {
				if err := s.recreateContainer(ctx, id, logf); err != nil {
					return err
				}
			}
			return nil
		})
	}
	if err != nil {
		writeError(w, http.StatusConflict, err.Error())
		return
	}
	writeJSON(w, http.StatusAccepted, map[string]string{"job": kind})
}

// recreateContainer updates a container started with `docker run`: pull its image again and,
// if that brought a new version, replace the container with one configured the same way. Values
// the old image supplied (its env, command, labels) are dropped so the new image's apply.
func (s *server) recreateContainer(ctx context.Context, id string, logf func(string, ...any)) error {
	var info struct {
		Name            string         `json:"Name"`
		Image           string         `json:"Image"`
		Config          map[string]any `json:"Config"`
		HostConfig      map[string]any `json:"HostConfig"`
		State           struct{ Running bool }
		NetworkSettings struct {
			Networks map[string]map[string]any `json:"Networks"`
		} `json:"NetworkSettings"`
	}
	if err := s.docker.do(ctx, http.MethodGet, "/containers/"+id+"/json", &info); err != nil {
		return err
	}
	name := strings.TrimPrefix(info.Name, "/")
	ref, _ := info.Config["Image"].(string)
	if ref == "" || strings.HasPrefix(ref, "sha256:") {
		return fmt.Errorf("%s was created from an image ID, so there is no name to pull a newer version of", name)
	}
	logf("Pulling %s…", ref)
	if err := s.docker.pull(ctx, ref, logf); err != nil {
		return err
	}
	type imageInfo struct {
		ID     string `json:"Id"`
		Config struct {
			Env        []string          `json:"Env"`
			Cmd        []string          `json:"Cmd"`
			Entrypoint []string          `json:"Entrypoint"`
			Labels     map[string]string `json:"Labels"`
		} `json:"Config"`
	}
	var fresh, old imageInfo
	if err := s.docker.do(ctx, http.MethodGet, "/images/"+ref+"/json", &fresh); err != nil {
		return err
	}
	if fresh.ID == info.Image {
		logf("%s is already up to date.", name)
		return nil
	}
	oldKnown := s.docker.do(ctx, http.MethodGet, "/images/"+info.Image+"/json", &old) == nil

	config := info.Config
	if oldKnown {
		if env, ok := config["Env"].([]any); ok {
			kept := []any{}
			for _, e := range env {
				if s, _ := e.(string); !slices.Contains(old.Config.Env, s) {
					kept = append(kept, e)
				}
			}
			config["Env"] = kept
		}
		if sameStrings(config["Cmd"], old.Config.Cmd) {
			delete(config, "Cmd")
		}
		if sameStrings(config["Entrypoint"], old.Config.Entrypoint) {
			delete(config, "Entrypoint")
		}
		if labels, ok := config["Labels"].(map[string]any); ok {
			for k, v := range labels {
				if old.Config.Labels[k] == fmt.Sprint(v) {
					delete(labels, k)
				}
			}
		}
	}
	if h, _ := config["Hostname"].(string); len(id) >= 12 && h == id[:12] {
		delete(config, "Hostname")
	}
	config["Image"] = ref

	body := map[string]any{}
	for k, v := range config {
		body[k] = v
	}
	body["HostConfig"] = info.HostConfig
	mode, _ := info.HostConfig["NetworkMode"].(string)
	if mode != "host" && mode != "none" && !strings.HasPrefix(mode, "container:") {
		endpoints := map[string]any{}
		for net, ep := range info.NetworkSettings.Networks {
			keep := map[string]any{}
			for _, k := range []string{"IPAMConfig", "Links", "DriverOpts"} {
				if ep[k] != nil {
					keep[k] = ep[k]
				}
			}
			if aliases, ok := ep["Aliases"].([]any); ok {
				var kept []any
				for _, al := range aliases {
					if s, _ := al.(string); len(id) >= 12 && s != id[:12] {
						kept = append(kept, al)
					}
				}
				keep["Aliases"] = kept
			}
			endpoints[net] = keep
		}
		body["NetworkingConfig"] = map[string]any{"EndpointsConfig": endpoints}
	}

	backup := name + "-temanlabs-old"
	if info.State.Running {
		logf("Stopping %s…", name)
		if err := s.docker.stopContainer(ctx, id); err != nil {
			return err
		}
	}
	if err := s.docker.do(ctx, http.MethodPost, "/containers/"+id+"/rename?name="+backup, nil); err != nil {
		return err
	}
	restore := func() {
		_ = s.docker.do(context.Background(), http.MethodPost, "/containers/"+id+"/rename?name="+name, nil)
		if info.State.Running {
			_ = s.docker.startContainer(context.Background(), id)
		}
	}
	var created struct {
		ID string `json:"Id"`
	}
	logf("Creating %s with the new image…", name)
	if err := s.docker.send(ctx, http.MethodPost, "/containers/create?name="+name, body, &created); err != nil {
		restore()
		return fmt.Errorf("couldn't create the new container (the old one is back): %w", err)
	}
	if info.State.Running {
		if err := s.docker.startContainer(ctx, created.ID); err != nil {
			_ = s.docker.do(context.Background(), http.MethodDelete, "/containers/"+created.ID+"?force=true", nil)
			restore()
			return fmt.Errorf("the new container wouldn't start (the old one is back): %w", err)
		}
	}
	if err := s.docker.do(ctx, http.MethodDelete, "/containers/"+id, nil); err != nil {
		logf("The old container %s is still there: %v", backup, err)
	}
	logf("%s updated.", name)
	return nil
}

func sameStrings(v any, list []string) bool {
	items, ok := v.([]any)
	if !ok {
		return v == nil && len(list) == 0
	}
	if len(items) != len(list) {
		return false
	}
	for i, it := range items {
		if s, _ := it.(string); s != list[i] {
			return false
		}
	}
	return true
}

// ----- Uninstall -----

// appDataDirs turns bind mounts into the per-app folders under /DATA/AppData they live in;
// shared folders like /DATA/Media are never included.
func appDataDirs(sources []string) []string {
	root := filepath.Join(appDataRoot, "AppData") + "/"
	var dirs []string
	for _, src := range sources {
		rest, ok := strings.CutPrefix(filepath.Clean(src)+"/", root)
		if !ok || rest == "" {
			continue
		}
		first, _, _ := strings.Cut(rest, "/")
		if first != "" && first != "." && first != ".." {
			dirs = append(dirs, root+first)
		}
	}
	slices.Sort(dirs)
	return slices.Compact(dirs)
}

func (s *server) containerDataDirs(ctx context.Context, a *app) []string {
	var sources []string
	for _, c := range a.containers {
		var info struct {
			Mounts []struct {
				Type   string `json:"Type"`
				Source string `json:"Source"`
			} `json:"Mounts"`
		}
		if s.docker.do(ctx, http.MethodGet, "/containers/"+c.ID+"/json", &info) == nil {
			for _, m := range info.Mounts {
				if m.Type == "bind" {
					sources = append(sources, m.Source)
				}
			}
		}
	}
	return appDataDirs(sources)
}

// dataDirsInUse reports folders other containers still mount, which must survive.
func (s *server) dataDirsInUse(ctx context.Context, skip map[string]bool) map[string]bool {
	inUse := map[string]bool{}
	var list []struct {
		ID     string `json:"Id"`
		Mounts []struct {
			Source string `json:"Source"`
		} `json:"Mounts"`
	}
	if s.docker.do(ctx, http.MethodGet, "/containers/json?all=1", &list) != nil {
		return nil
	}
	for _, c := range list {
		if skip[c.ID] {
			continue
		}
		var sources []string
		for _, m := range c.Mounts {
			sources = append(sources, m.Source)
		}
		for _, d := range appDataDirs(sources) {
			inUse[d] = true
		}
	}
	return inUse
}

func (s *server) uninstallApp(ctx context.Context, a *app, deleteData bool) error {
	if a.Source == "native" {
		return errors.New("This app runs outside Docker; remove it with the tool that installed it.")
	}
	if len(a.containers) == 0 {
		return s.store.uninstall(ctx, a.ID)
	}
	ids := map[string]bool{}
	for _, c := range a.containers {
		ids[c.ID] = true
	}
	var dataDirs []string
	ref, reason := composeOf(a)
	switch {
	case ref != nil:
		if data, err := os.ReadFile(ref.files[0]); err == nil {
			if doc, err := parseComposeDoc(data); err == nil {
				dataDirs = appDataDirs(doc.bindSources())
			}
		}
		args := []string{"down", "--remove-orphans"}
		if deleteData {
			args = append(args, "--volumes")
		}
		if out, err := ref.run(ctx, args...); err != nil {
			return errors.New(lastLines(string(out), 3))
		}
		// The app's own folder: TemanLabsOS's or CasaOS's. Compose files elsewhere are the user's.
		dir := filepath.Dir(ref.files[0])
		if filepath.Dir(dir) == filepath.Join(s.cfg.StateDir, "apps") || strings.HasPrefix(dir+"/", casaosAppsDir) && dir+"/" != casaosAppsDir {
			_ = os.RemoveAll(dir)
		}
	case reason != "":
		// Compose files gone: remove the containers directly.
		fallthrough
	default:
		dataDirs = s.containerDataDirs(ctx, a)
		for id := range ids {
			q := "?force=true"
			if deleteData {
				q += "&v=true"
			}
			if err := s.docker.do(ctx, http.MethodDelete, "/containers/"+id+q, nil); err != nil {
				return err
			}
		}
	}
	_ = s.store.uninstall(ctx, a.ID)

	if deleteData && len(dataDirs) > 0 {
		inUse := s.dataDirsInUse(ctx, ids)
		for _, dir := range dataDirs {
			if inUse == nil || inUse[dir] {
				continue
			}
			_ = os.RemoveAll(dir)
		}
	}
	return nil
}

func (s *server) handleUninstallApp(w http.ResponseWriter, r *http.Request) {
	a, err := s.findApp(r.Context(), r.PathValue("id"))
	if err != nil {
		writeError(w, http.StatusBadGateway, err.Error())
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Minute)
	defer cancel()
	if a == nil {
		// A failed install with nothing left but its record.
		if err := s.store.uninstall(ctx, r.PathValue("id")); err != nil {
			writeError(w, http.StatusBadGateway, err.Error())
			return
		}
		w.WriteHeader(http.StatusNoContent)
		return
	}
	if err := s.uninstallApp(ctx, a, r.URL.Query().Get("data") == "1"); err != nil {
		writeError(w, http.StatusBadGateway, err.Error())
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// ----- Shell in a container -----

func (s *server) handleAppTerminal(w http.ResponseWriter, r *http.Request) {
	a, err := s.findApp(r.Context(), r.PathValue("id"))
	if err != nil || a == nil {
		http.NotFound(w, r)
		return
	}
	want := r.URL.Query().Get("container")
	var target string
	for _, c := range a.containers {
		if c.ID == want || c.name() == want || (want == "" && target == "") {
			target = c.ID
		}
	}
	if target == "" {
		http.Error(w, "container not part of this app", http.StatusBadRequest)
		return
	}
	cmd := exec.Command("docker", "exec", "-it", "-e", "TERM=xterm-256color", target,
		"sh", "-c", "if command -v bash >/dev/null 2>&1; then exec bash; else exec sh; fi")
	cmd.Env = append(os.Environ(), "TERM=xterm-256color")
	s.servePTY(w, r, cmd, nil)
}
