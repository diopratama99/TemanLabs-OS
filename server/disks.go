package main

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"errors"
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

// Disk Manager: drives and their partitions, SMART health, mounting, and what takes space.

type blockDevice struct {
	Name        string        `json:"name"`
	Path        string        `json:"path"`
	Size        int64         `json:"size"`
	Type        string        `json:"type"`
	FSType      string        `json:"fstype,omitempty"`
	Mountpoints []string      `json:"mountpoints,omitempty"`
	Label       string        `json:"label,omitempty"`
	Model       string        `json:"model,omitempty"`
	Serial      string        `json:"serial,omitempty"`
	Transport   string        `json:"tran,omitempty"`
	Rotational  bool          `json:"rota"`
	Removable   bool          `json:"rm"`
	UUID        string        `json:"uuid,omitempty"`
	Used        int64         `json:"fsused,omitempty"`
	Available   int64         `json:"fsavail,omitempty"`
	Children    []blockDevice `json:"children,omitempty"`
	Smart       *smartInfo    `json:"smart,omitempty"`
}

type smartInfo struct {
	Passed       *bool  `json:"passed,omitempty"`
	Temperature  int    `json:"temperature,omitempty"`
	PowerOnHours int    `json:"powerOnHours,omitempty"`
	PowerCycles  int    `json:"powerCycles,omitempty"`
	Reallocated  int    `json:"reallocated,omitempty"`
	Pending      int    `json:"pending,omitempty"`
	WearPercent  *int   `json:"wearPercent,omitempty"`
	Error        string `json:"error,omitempty"`
}

// lsblk's JSON nulls and odd types, read loosely.
type lsblkRaw struct {
	Name        string       `json:"name"`
	Path        string       `json:"path"`
	Size        json.Number  `json:"size"`
	Type        string       `json:"type"`
	FSType      *string      `json:"fstype"`
	Mountpoints []*string    `json:"mountpoints"`
	Label       *string      `json:"label"`
	Model       *string      `json:"model"`
	Serial      *string      `json:"serial"`
	Tran        *string      `json:"tran"`
	Rota        bool         `json:"rota"`
	RM          bool         `json:"rm"`
	UUID        *string      `json:"uuid"`
	FSUsed      *json.Number `json:"fsused"`
	FSAvail     *json.Number `json:"fsavail"`
	Children    []lsblkRaw   `json:"children"`
}

func str(p *string) string {
	if p == nil {
		return ""
	}
	return strings.TrimSpace(*p)
}

func num(n *json.Number) int64 {
	if n == nil {
		return 0
	}
	v, _ := n.Int64()
	return v
}

func (raw lsblkRaw) device() blockDevice {
	size, _ := raw.Size.Int64()
	d := blockDevice{
		Name: raw.Name, Path: raw.Path, Size: size, Type: raw.Type, FSType: str(raw.FSType), Label: str(raw.Label),
		Model: str(raw.Model), Serial: str(raw.Serial), Transport: str(raw.Tran), Rotational: raw.Rota, Removable: raw.RM,
		UUID: str(raw.UUID), Used: num(raw.FSUsed), Available: num(raw.FSAvail),
	}
	for _, m := range raw.Mountpoints {
		if m := str(m); m != "" {
			d.Mountpoints = append(d.Mountpoints, m)
		}
	}
	for _, c := range raw.Children {
		d.Children = append(d.Children, c.device())
	}
	return d
}

func readSmart(ctx context.Context, dev string) *smartInfo {
	out, err := exec.CommandContext(ctx, "smartctl", "-j", "-H", "-A", "-n", "standby", dev).Output()
	if len(out) == 0 {
		if err != nil {
			return &smartInfo{Error: "SMART isn’t available for this drive"}
		}
		return nil
	}
	var v struct {
		Smartctl struct {
			Messages []struct {
				String string `json:"string"`
			} `json:"messages"`
		} `json:"smartctl"`
		Status *struct {
			Passed bool `json:"passed"`
		} `json:"smart_status"`
		Temperature struct {
			Current int `json:"current"`
		} `json:"temperature"`
		PowerOnTime struct {
			Hours int `json:"hours"`
		} `json:"power_on_time"`
		PowerCycles int `json:"power_cycle_count"`
		ATA         struct {
			Table []struct {
				ID  int `json:"id"`
				Raw struct {
					Value int `json:"value"`
				} `json:"raw"`
			} `json:"table"`
		} `json:"ata_smart_attributes"`
		NVMe *struct {
			PercentageUsed int `json:"percentage_used"`
		} `json:"nvme_smart_health_information_log"`
	}
	if json.Unmarshal(out, &v) != nil {
		return &smartInfo{Error: "unreadable SMART data"}
	}
	info := &smartInfo{Temperature: v.Temperature.Current, PowerOnHours: v.PowerOnTime.Hours, PowerCycles: v.PowerCycles}
	if v.Status != nil {
		passed := v.Status.Passed
		info.Passed = &passed
	} else if len(v.Smartctl.Messages) > 0 {
		info.Error = v.Smartctl.Messages[0].String
	}
	for _, a := range v.ATA.Table {
		switch a.ID {
		case 5:
			info.Reallocated = a.Raw.Value
		case 197:
			info.Pending = a.Raw.Value
		}
	}
	if v.NVMe != nil {
		used := v.NVMe.PercentageUsed
		info.WearPercent = &used
	}
	return info
}

func (s *server) handleDisks(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := context.WithTimeout(r.Context(), 20*time.Second)
	defer cancel()
	out, err := exec.CommandContext(ctx, "lsblk", "-J", "-b", "-o",
		"NAME,PATH,SIZE,TYPE,FSTYPE,MOUNTPOINTS,LABEL,MODEL,SERIAL,TRAN,ROTA,RM,UUID,FSUSED,FSAVAIL").Output()
	if err != nil {
		writeError(w, http.StatusBadGateway, "lsblk: "+err.Error())
		return
	}
	var raw struct {
		Devices []lsblkRaw `json:"blockdevices"`
	}
	dec := json.NewDecoder(bytes.NewReader(out))
	dec.UseNumber()
	if err := dec.Decode(&raw); err != nil {
		writeError(w, http.StatusBadGateway, "lsblk: "+err.Error())
		return
	}
	var disks []blockDevice
	var wg sync.WaitGroup
	for _, d := range raw.Devices {
		// Snap squashfs images and RAM disks aren't drives anyone manages.
		if d.Type != "disk" && d.Type != "rom" {
			continue
		}
		disks = append(disks, d.device())
	}
	for i := range disks {
		if disks[i].Type != "disk" {
			continue
		}
		wg.Add(1)
		go func(d *blockDevice) {
			defer wg.Done()
			d.Smart = readSmart(ctx, d.Path)
		}(&disks[i])
	}
	wg.Wait()
	writeJSON(w, http.StatusOK, disks)
}

var devicePath = regexp.MustCompile(`^/dev/[a-zA-Z0-9/_-]{1,64}$`)

// handleMount mounts or unmounts a partition through udisks, which picks a mount point under
// /media and handles each filesystem's options, like Disk Manager does.
func (s *server) handleMount(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Device string `json:"device"`
		Mount  bool   `json:"mount"`
	}
	if decodeJSON(r, &body) != nil || !devicePath.MatchString(body.Device) || strings.Contains(body.Device, "..") {
		writeError(w, http.StatusBadRequest, "invalid device")
		return
	}
	verb := "unmount"
	if body.Mount {
		verb = "mount"
	}
	ctx, cancel := context.WithTimeout(r.Context(), 60*time.Second)
	defer cancel()
	out, err := exec.CommandContext(ctx, "udisksctl", verb, "-b", body.Device, "--no-user-interaction").CombinedOutput()
	if err != nil {
		msg := strings.TrimSpace(lastLines(string(out), 2))
		if strings.Contains(msg, "target is busy") || strings.Contains(msg, "busy") {
			msg = "The disk is in use (an app or a share has files open on it)."
		}
		writeError(w, http.StatusBadRequest, msg)
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"message": strings.TrimSpace(string(out))})
}

// ----- Usage: what takes the space (like ncdu) -----

type usageEntry struct {
	Name  string `json:"name"`
	Size  int64  `json:"size"`
	IsDir bool   `json:"isDir"`
}

type usageResult struct {
	Path    string       `json:"path"`
	Total   int64        `json:"total"`
	Entries []usageEntry `json:"entries"`
	Partial bool         `json:"partial,omitempty"`
	at      time.Time
}

var usageCache = struct {
	sync.Mutex
	m map[string]*usageResult
}{m: map[string]*usageResult{}}

func (s *server) handleUsage(w http.ResponseWriter, r *http.Request) {
	path, err := s.resolve(r.URL.Query().Get("path"))
	if err != nil {
		writeFSError(w, err)
		return
	}
	if info, err := os.Stat(path); err != nil || !info.IsDir() {
		writeError(w, http.StatusBadRequest, "not a folder")
		return
	}
	fresh := r.URL.Query().Get("fresh") == "1"
	usageCache.Lock()
	if hit := usageCache.m[path]; hit != nil && !fresh && time.Since(hit.at) < 10*time.Minute {
		usageCache.Unlock()
		writeJSON(w, http.StatusOK, hit)
		return
	}
	usageCache.Unlock()

	// Big trees take a while; past the limit, show what du managed to add up.
	ctx, cancel := context.WithTimeout(r.Context(), 90*time.Second)
	defer cancel()
	// -x: stay on this filesystem, so / doesn't count every mounted disk; -b: bytes.
	cmd := exec.CommandContext(ctx, "du", "-x", "-b", "-d", "1", path)
	out, runErr := cmd.Output()
	res := &usageResult{Path: path, at: time.Now(), Partial: runErr != nil && errors.Is(ctx.Err(), context.DeadlineExceeded)}
	var files int64
	scanner := bufio.NewScanner(bytes.NewReader(out))
	for scanner.Scan() {
		size, p, ok := strings.Cut(scanner.Text(), "\t")
		if !ok {
			continue
		}
		n, _ := strconv.ParseInt(size, 10, 64)
		if filepath.Clean(p) == filepath.Clean(path) {
			res.Total = n
			continue
		}
		res.Entries = append(res.Entries, usageEntry{Name: filepath.Base(p), Size: n, IsDir: true})
	}
	// du -d 1 lists folders only; the files directly inside are the remainder.
	var subtotal int64
	for _, e := range res.Entries {
		subtotal += e.Size
	}
	if files = res.Total - subtotal; files > 0 {
		res.Entries = append(res.Entries, usageEntry{Name: "Files in this folder", Size: files})
	}
	sort.Slice(res.Entries, func(i, j int) bool { return res.Entries[i].Size > res.Entries[j].Size })
	usageCache.Lock()
	usageCache.m[path] = res
	usageCache.Unlock()
	writeJSON(w, http.StatusOK, res)
}
