package main

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"
)

// serviceInfo is one systemd service, for the Services tab of System Monitor.
type serviceInfo struct {
	Unit        string `json:"unit"`
	Description string `json:"description"`
	Load        string `json:"load"`
	Active      string `json:"active"`
	Sub         string `json:"sub"`
	// Unit file state: enabled, disabled, static, masked…
	Enabled string  `json:"enabled"`
	MainPID int     `json:"mainPid,omitempty"`
	Memory  uint64  `json:"memory,omitempty"`
	CPU     float64 `json:"cpu"`
	// Unix seconds when it last became active.
	Since int64 `json:"since,omitempty"`
	// Stopping it would cut off the server or TemanLabsOS itself.
	Protected bool `json:"protected,omitempty"`
}

var serviceName = regexp.MustCompile(`^[a-zA-Z0-9@._:\\-]{1,200}\.service$`)

// Services that keep the machine reachable and running. They can be inspected and restarted
// (except TemanLabsOS itself), but not stopped or disabled from the UI.
func protectedService(unit string) bool {
	switch unit {
	case "ssh.service", "sshd.service", "docker.service", "containerd.service", "dbus.service",
		"dbus-broker.service", "temanlabsos.service", "systemd-networkd.service", "NetworkManager.service",
		"networking.service", "systemd-resolved.service", "systemd-logind.service", "systemd-journald.service",
		"systemd-udevd.service", "polkit.service", "cron.service":
		return true
	}
	return strings.HasPrefix(unit, "systemd-") || strings.HasPrefix(unit, "getty@") || strings.HasPrefix(unit, "user@")
}

func systemctlJSON(ctx context.Context, out any, args ...string) error {
	cmd := exec.CommandContext(ctx, "systemctl", append(args, "--output=json", "--no-pager")...)
	data, err := cmd.Output()
	if err != nil {
		return fmt.Errorf("systemctl %s: %w", strings.Join(args, " "), err)
	}
	return json.Unmarshal(data, out)
}

type cpuReading struct {
	usec uint64
	at   time.Time
}

type serviceLister struct {
	mu   sync.Mutex
	prev map[string]cpuReading
	at   time.Time
	list []*serviceInfo
}

var services = &serviceLister{prev: map[string]cpuReading{}}

func cgroupDir(unit string) string { return filepath.Join("/sys/fs/cgroup/system.slice", unit) }

func readCPUUsec(unit string) (uint64, bool) {
	f, err := os.Open(filepath.Join(cgroupDir(unit), "cpu.stat"))
	if err != nil {
		return 0, false
	}
	defer f.Close()
	scanner := bufio.NewScanner(f)
	for scanner.Scan() {
		if v, ok := strings.CutPrefix(scanner.Text(), "usage_usec "); ok {
			n, err := strconv.ParseUint(v, 10, 64)
			return n, err == nil
		}
	}
	return 0, false
}

func (l *serviceLister) collect(ctx context.Context) ([]*serviceInfo, error) {
	var units []struct {
		Unit        string `json:"unit"`
		Load        string `json:"load"`
		Active      string `json:"active"`
		Sub         string `json:"sub"`
		Description string `json:"description"`
	}
	if err := systemctlJSON(ctx, &units, "list-units", "--type=service", "--all"); err != nil {
		return nil, err
	}
	var files []struct {
		UnitFile string `json:"unit_file"`
		State    string `json:"state"`
	}
	_ = systemctlJSON(ctx, &files, "list-unit-files", "--type=service")

	byUnit := map[string]*serviceInfo{}
	for _, u := range units {
		if u.Load == "not-found" {
			continue
		}
		byUnit[u.Unit] = &serviceInfo{Unit: u.Unit, Description: u.Description, Load: u.Load, Active: u.Active, Sub: u.Sub}
	}
	for _, f := range files {
		// Templates (foo@.service) aren't services by themselves.
		if strings.Contains(f.UnitFile, "@.") {
			continue
		}
		svc, ok := byUnit[f.UnitFile]
		if !ok {
			// Installed but never loaded (e.g. disabled): still worth listing.
			svc = &serviceInfo{Unit: f.UnitFile, Load: "loaded", Active: "inactive", Sub: "dead"}
			byUnit[f.UnitFile] = svc
		}
		svc.Enabled = f.State
	}

	// Main PID, start time and descriptions of what's missing, in one systemctl call.
	var names []string
	for name, svc := range byUnit {
		if svc.Active == "active" || svc.Active == "activating" || svc.Description == "" {
			names = append(names, name)
		}
	}
	if len(names) > 0 {
		args := append([]string{"show", "--property=Id,MainPID,ActiveEnterTimestamp,Description", "--timestamp=unix"}, names...)
		if out, err := exec.CommandContext(ctx, "systemctl", args...).Output(); err == nil {
			for _, block := range bytes.Split(out, []byte("\n\n")) {
				props := map[string]string{}
				for _, line := range strings.Split(string(block), "\n") {
					if k, v, ok := strings.Cut(line, "="); ok {
						props[k] = v
					}
				}
				svc := byUnit[props["Id"]]
				if svc == nil {
					continue
				}
				svc.MainPID, _ = strconv.Atoi(props["MainPID"])
				if ts, ok := strings.CutPrefix(props["ActiveEnterTimestamp"], "@"); ok && svc.Active == "active" {
					svc.Since, _ = strconv.ParseInt(ts, 10, 64)
				}
				if svc.Description == "" {
					svc.Description = props["Description"]
				}
			}
		}
	}

	now := time.Now()
	l.mu.Lock()
	next := map[string]cpuReading{}
	list := make([]*serviceInfo, 0, len(byUnit))
	for _, svc := range byUnit {
		svc.Protected = protectedService(svc.Unit)
		if svc.Active == "active" {
			if mem, err := strconv.ParseUint(readTrim(filepath.Join(cgroupDir(svc.Unit), "memory.current")), 10, 64); err == nil {
				svc.Memory = mem
			}
			if usec, ok := readCPUUsec(svc.Unit); ok {
				if p, ok := l.prev[svc.Unit]; ok && usec >= p.usec {
					if secs := now.Sub(p.at).Seconds(); secs > 0 {
						svc.CPU = float64(usec-p.usec) / 1e6 / secs * 100
					}
				}
				next[svc.Unit] = cpuReading{usec, now}
			}
		}
		list = append(list, svc)
	}
	l.prev = next
	l.mu.Unlock()
	sort.Slice(list, func(i, j int) bool { return list[i].Unit < list[j].Unit })
	return list, nil
}

func (s *server) handleServices(w http.ResponseWriter, r *http.Request) {
	services.mu.Lock()
	fresh := time.Since(services.at) < 1500*time.Millisecond
	list := services.list
	services.mu.Unlock()
	if !fresh {
		var err error
		if list, err = services.collect(r.Context()); err != nil {
			writeError(w, http.StatusInternalServerError, err.Error())
			return
		}
		services.mu.Lock()
		services.list, services.at = list, time.Now()
		services.mu.Unlock()
	}
	writeJSON(w, http.StatusOK, list)
}

func (s *server) handleServiceAction(w http.ResponseWriter, r *http.Request) {
	unit, action := r.PathValue("unit"), r.PathValue("action")
	if !serviceName.MatchString(unit) {
		writeError(w, http.StatusBadRequest, "invalid service name")
		return
	}
	switch action {
	case "start", "restart", "enable":
	case "stop", "disable":
		if protectedService(unit) {
			writeError(w, http.StatusForbidden, unit+" keeps the server running and can’t be stopped or disabled here.")
			return
		}
	default:
		writeError(w, http.StatusBadRequest, "unknown action")
		return
	}
	if unit == "temanlabsos.service" && action == "restart" {
		writeError(w, http.StatusForbidden, "TemanLabsOS can’t restart itself from its own window.")
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 90*time.Second)
	defer cancel()
	if out, err := exec.CommandContext(ctx, "systemctl", action, "--", unit).CombinedOutput(); err != nil {
		writeError(w, http.StatusBadGateway, strings.TrimSpace(lastLines(string(out), 4)))
		return
	}
	services.mu.Lock()
	services.at = time.Time{}
	services.mu.Unlock()
	w.WriteHeader(http.StatusNoContent)
}

func (s *server) handleServiceLogs(w http.ResponseWriter, r *http.Request) {
	unit := r.PathValue("unit")
	if !serviceName.MatchString(unit) {
		writeError(w, http.StatusBadRequest, "invalid service name")
		return
	}
	lines, err := strconv.Atoi(r.URL.Query().Get("lines"))
	if err != nil || lines <= 0 {
		lines = 300
	}
	lines = min(lines, 5000)
	ctx, cancel := context.WithTimeout(r.Context(), 20*time.Second)
	defer cancel()
	out, err := exec.CommandContext(ctx, "journalctl", "-u", unit, "-n", strconv.Itoa(lines), "--no-pager", "-o", "short-iso").Output()
	if err != nil && len(out) == 0 {
		writeError(w, http.StatusBadGateway, "journalctl: "+err.Error())
		return
	}
	w.Header().Set("Content-Type", "text/plain; charset=utf-8")
	_, _ = w.Write(out)
}
