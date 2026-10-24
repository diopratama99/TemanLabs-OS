package main

import (
	"context"
	"errors"
	"net/http"
	"os"
	"os/exec"
	"strings"
	"sync"
	"time"
)

// Startup apps: which apps start by themselves when the server boots. For a Docker app that's
// its containers' restart policy, written into its compose file too so an update or a settings
// change doesn't bring the old one back; for a native app, whether its systemd unit is enabled.

type startupApp struct {
	ID      string    `json:"id"`
	Name    string    `json:"name"`
	Icon    string    `json:"icon"`
	IconURL string    `json:"iconUrl,omitempty"`
	Color   [2]string `json:"color"`
	Enabled bool      `json:"enabled"`
	// Can't be switched off here (ssh, TemanLabsOS itself).
	Locked bool `json:"locked,omitempty"`
}

func (d *dockerClient) restartPolicy(ctx context.Context, id string) (string, error) {
	var out struct {
		HostConfig struct {
			RestartPolicy struct{ Name string }
		}
	}
	err := d.do(ctx, http.MethodGet, "/containers/"+id+"/json", &out)
	return out.HostConfig.RestartPolicy.Name, err
}

func (d *dockerClient) setRestartPolicy(ctx context.Context, id, name string) error {
	return d.send(ctx, http.MethodPost, "/containers/"+id+"/update", map[string]any{"RestartPolicy": map[string]any{"Name": name}}, nil)
}

// startsAtBoot: Docker starts "always" and "unless-stopped" containers when it starts.
func startsAtBoot(policy string) bool { return policy == "always" || policy == "unless-stopped" }

// alwaysAtBoot: services the server can't do without, and Tailscale, without which it can't be
// reached from away to switch anything back on.
func alwaysAtBoot(unit string) bool {
	return protectedService(unit) || unit == "tailscaled.service"
}

func unitEnabled(ctx context.Context, unit string) bool {
	out, _ := exec.CommandContext(ctx, "systemctl", "is-enabled", "--", unit).Output()
	return strings.TrimSpace(string(out)) == "enabled"
}

func (s *server) handleStartupApps(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := context.WithTimeout(r.Context(), 20*time.Second)
	defer cancel()
	apps, err := s.store.listApps(ctx)
	if err != nil {
		writeError(w, http.StatusBadGateway, err.Error())
		return
	}
	out := make([]startupApp, len(apps))
	keep := make([]bool, len(apps))
	var wg sync.WaitGroup
	for i, a := range apps {
		if (a.Source == "native" && a.Unit == "") || (a.Source != "native" && len(a.containers) == 0) {
			continue
		}
		keep[i] = true
		out[i] = startupApp{ID: a.ID, Name: a.Name, Icon: a.Icon, IconURL: a.IconURL, Color: a.Color}
		wg.Add(1)
		go func() {
			defer wg.Done()
			if a.Source == "native" {
				out[i].Enabled = unitEnabled(ctx, a.Unit)
				out[i].Locked = alwaysAtBoot(a.Unit)
				return
			}
			for _, c := range a.containers {
				if p, err := s.docker.restartPolicy(ctx, c.ID); err == nil && startsAtBoot(p) {
					out[i].Enabled = true
				}
			}
		}()
	}
	wg.Wait()
	list := []startupApp{}
	for i := range out {
		if keep[i] {
			list = append(list, out[i])
		}
	}
	writeJSON(w, http.StatusOK, list)
}

func (s *server) handleSetStartupApp(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Enabled bool `json:"enabled"`
	}
	if decodeJSON(r, &body) != nil {
		writeError(w, http.StatusBadRequest, "invalid request")
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), time.Minute)
	defer cancel()
	a, err := s.findApp(ctx, r.PathValue("id"))
	if err != nil {
		writeError(w, http.StatusBadGateway, err.Error())
		return
	}
	if a == nil {
		writeError(w, http.StatusNotFound, "app not found")
		return
	}
	if a.Source == "native" {
		err = setUnitEnabled(ctx, a.Unit, body.Enabled)
	} else {
		err = s.setDockerStartup(ctx, a, body.Enabled)
	}
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func setUnitEnabled(ctx context.Context, unit string, enabled bool) error {
	if unit == "" {
		return errors.New("it isn’t run by a systemd service")
	}
	if !enabled && alwaysAtBoot(unit) {
		return errors.New(unit + " keeps the server running and always starts with it")
	}
	verb := "disable"
	if enabled {
		verb = "enable"
	}
	if out, err := exec.CommandContext(ctx, "systemctl", verb, "--", unit).CombinedOutput(); err != nil {
		return errors.New(strings.TrimSpace(lastLines(string(out), 3)))
	}
	return nil
}

func (s *server) setDockerStartup(ctx context.Context, a *app, enabled bool) error {
	policy := "no"
	if enabled {
		policy = "unless-stopped"
	}
	for _, c := range a.containers {
		if err := s.docker.setRestartPolicy(ctx, c.ID, policy); err != nil {
			return err
		}
	}
	// Into the compose file as well, for the next time compose recreates the containers.
	ref, _ := composeOf(a)
	if ref == nil {
		return nil
	}
	for _, file := range ref.files {
		current, err := os.ReadFile(file)
		if err != nil {
			return err
		}
		next, err := composeWithRestart(current, policy)
		if err != nil {
			return err
		}
		info, err := os.Stat(file)
		if err != nil {
			return err
		}
		if err := os.WriteFile(file, next, info.Mode().Perm()); err != nil {
			return err
		}
	}
	return nil
}

// composeWithRestart sets every service's restart policy, keeping the rest of the file as it is.
func composeWithRestart(text []byte, policy string) ([]byte, error) {
	doc, err := parseComposeDoc(text)
	if err != nil {
		return nil, err
	}
	for _, name := range doc.serviceNames() {
		if svc := doc.service(name); svc != nil {
			mapSet(svc, "restart", strNode(policy))
		}
	}
	return doc.bytes()
}
