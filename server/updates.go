package main

import (
	"context"
	"errors"
	"net/http"
	"os"
	"os/exec"
	"regexp"
	"sort"
	"strings"
	"time"
)

// System Updates: apt's pending upgrades, installing them, and whether a restart is needed.

var (
	// "openssl/noble-updates,noble-security 3.0.13-0ubuntu3.6 amd64 [upgradable from: 3.0.13-0ubuntu3.5]"
	aptUpgradable = regexp.MustCompile(`^([^/\s]+)/(\S+)\s+(\S+)\s+(\S+)\s+\[upgradable from: ([^\]]+)\]`)
	packageName   = regexp.MustCompile(`^[a-z0-9][a-z0-9+.-]{0,127}$`)
	aptEnv        = []string{"DEBIAN_FRONTEND=noninteractive", "NEEDRESTART_MODE=a", "LC_ALL=C"}
)

type aptUpdate struct {
	Name     string `json:"name"`
	Current  string `json:"current"`
	Version  string `json:"version"`
	Origin   string `json:"origin"`
	Security bool   `json:"security"`
	// Multiarch systems list i386 copies of a library separately.
	Arch string `json:"arch"`
}

func listUpgradable(ctx context.Context) ([]aptUpdate, error) {
	cmd := exec.CommandContext(ctx, "apt", "list", "--upgradable")
	cmd.Env = append(os.Environ(), "LC_ALL=C")
	out, err := cmd.Output()
	if err != nil && len(out) == 0 {
		return nil, err
	}
	var list []aptUpdate
	for _, line := range strings.Split(string(out), "\n") {
		m := aptUpgradable.FindStringSubmatch(line)
		if m == nil {
			continue
		}
		list = append(list, aptUpdate{Name: m[1], Origin: m[2], Version: m[3], Arch: m[4], Current: m[5], Security: strings.Contains(m[2], "-security")})
	}
	sort.Slice(list, func(i, j int) bool {
		if list[i].Security != list[j].Security {
			return list[i].Security
		}
		return list[i].Name < list[j].Name
	})
	return list, nil
}

func lastAptUpdate() time.Time {
	for _, p := range []string{"/var/lib/apt/periodic/update-success-stamp", "/var/lib/apt/lists/partial", "/var/cache/apt/pkgcache.bin"} {
		if info, err := os.Stat(p); err == nil {
			return info.ModTime()
		}
	}
	return time.Time{}
}

func (s *server) handleUpdates(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := context.WithTimeout(r.Context(), 30*time.Second)
	defer cancel()
	list, err := listUpgradable(ctx)
	if err != nil {
		writeError(w, http.StatusBadGateway, "apt: "+err.Error())
		return
	}
	var rebootFor []string
	_, rebootErr := os.Stat("/var/run/reboot-required")
	if data, err := os.ReadFile("/var/run/reboot-required.pkgs"); err == nil {
		seen := map[string]bool{}
		for _, p := range strings.Fields(string(data)) {
			if !seen[p] {
				seen[p] = true
				rebootFor = append(rebootFor, p)
			}
		}
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"updates": list, "lastChecked": lastAptUpdate(), "rebootRequired": rebootErr == nil, "rebootFor": rebootFor,
	})
}

func (s *server) handleUpdatesCheck(w http.ResponseWriter, r *http.Request) {
	if _, err := startJob("apt", "Checking for updates", aptEnv, nil, "apt-get", "update"); err != nil {
		writeJobError(w, err)
		return
	}
	w.WriteHeader(http.StatusAccepted)
}

// handleUpdatesInstall upgrades everything, or only the named packages. Config files changed
// locally are kept (confold), so an upgrade never stops to ask.
func (s *server) handleUpdatesInstall(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Packages []string `json:"packages"`
	}
	if err := decodeJSON(r, &body); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request")
		return
	}
	args := []string{"-y", "-o", "Dpkg::Options::=--force-confdef", "-o", "Dpkg::Options::=--force-confold"}
	title := "Installing all updates"
	if len(body.Packages) > 0 {
		for _, p := range body.Packages {
			if !packageName.MatchString(p) {
				writeError(w, http.StatusBadRequest, "invalid package name "+p)
				return
			}
		}
		args = append(args, "install", "--only-upgrade")
		args = append(args, body.Packages...)
		title = "Installing " + strings.Join(body.Packages, ", ")
	} else {
		args = append(args, "full-upgrade")
	}
	if _, err := startJob("apt", title, aptEnv, nil, "apt-get", args...); err != nil {
		writeJobError(w, err)
		return
	}
	w.WriteHeader(http.StatusAccepted)
}

func writeJobError(w http.ResponseWriter, err error) {
	if errors.Is(err, errJobRunning) {
		writeError(w, http.StatusConflict, "Another apt task is still running; wait for it to finish.")
		return
	}
	writeError(w, http.StatusBadGateway, err.Error())
}

// ----- Power, name and time -----

func (s *server) handlePower(w http.ResponseWriter, r *http.Request) {
	action := r.PathValue("action")
	verb := map[string]string{"restart": "reboot", "shutdown": "poweroff"}[action]
	if verb == "" {
		writeError(w, http.StatusBadRequest, "unknown action")
		return
	}
	w.WriteHeader(http.StatusAccepted)
	// Give the reply time to reach the browser before the machine goes down.
	go func() {
		time.Sleep(time.Second)
		_ = exec.Command("systemctl", verb).Run()
	}()
}

func (s *server) handleTime(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := context.WithTimeout(r.Context(), 10*time.Second)
	defer cancel()
	props := map[string]string{}
	if out, err := exec.CommandContext(ctx, "timedatectl", "show").Output(); err == nil {
		for _, line := range strings.Split(string(out), "\n") {
			if k, v, ok := strings.Cut(line, "="); ok {
				props[k] = v
			}
		}
	}
	var zones []string
	if out, err := exec.CommandContext(ctx, "timedatectl", "list-timezones").Output(); err == nil {
		zones = strings.Fields(string(out))
	}
	host, _ := os.Hostname()
	writeJSON(w, http.StatusOK, map[string]any{
		"timezone": props["Timezone"], "ntp": props["NTP"] == "yes", "synced": props["NTPSynchronized"] == "yes",
		"now": time.Now(), "zones": zones, "hostname": host,
	})
}

var hostnamePattern = regexp.MustCompile(`^[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?$`)

func (s *server) handleTimeSet(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Timezone string `json:"timezone"`
		NTP      *bool  `json:"ntp"`
		Hostname string `json:"hostname"`
	}
	if decodeJSON(r, &body) != nil {
		writeError(w, http.StatusBadRequest, "invalid request")
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 20*time.Second)
	defer cancel()
	run := func(args ...string) error {
		if out, err := exec.CommandContext(ctx, args[0], args[1:]...).CombinedOutput(); err != nil {
			return errors.New(strings.TrimSpace(lastLines(string(out), 2)))
		}
		return nil
	}
	if body.Timezone != "" {
		if strings.ContainsAny(body.Timezone, " \n") || strings.Contains(body.Timezone, "..") {
			writeError(w, http.StatusBadRequest, "invalid time zone")
			return
		}
		if err := run("timedatectl", "set-timezone", body.Timezone); err != nil {
			writeError(w, http.StatusBadRequest, err.Error())
			return
		}
	}
	if body.NTP != nil {
		if err := run("timedatectl", "set-ntp", yesNo(*body.NTP)); err != nil {
			writeError(w, http.StatusBadRequest, err.Error())
			return
		}
	}
	if body.Hostname != "" {
		if !hostnamePattern.MatchString(body.Hostname) {
			writeError(w, http.StatusBadRequest, "a hostname uses letters, numbers and dashes")
			return
		}
		if err := run("hostnamectl", "set-hostname", body.Hostname); err != nil {
			writeError(w, http.StatusBadRequest, err.Error())
			return
		}
	}
	w.WriteHeader(http.StatusNoContent)
}
