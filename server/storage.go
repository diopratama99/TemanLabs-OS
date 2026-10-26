package main

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"slices"
	"strings"
	"sync"
	"syscall"
	"time"
)

// Storage the way CasaOS manages it: format a drive into new storage under /DATA, mount drives
// at startup (through /etc/fstab, so it works without TemanLabsOS too), merge several drives
// into one folder with mergerfs, and mount USB drives when they're plugged in.

const fstabPath = "/etc/fstab"

var (
	storageName = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9_.-]{0,31}$`)
	// Filesystems Format offers, with the label length each allows.
	formatTools = map[string]struct {
		cmd      string
		args     func(label string) []string
		maxLabel int
	}{
		"ext4":  {"mkfs.ext4", func(l string) []string { return []string{"-F", "-L", l} }, 16},
		"xfs":   {"mkfs.xfs", func(l string) []string { return []string{"-f", "-L", l} }, 12},
		"btrfs": {"mkfs.btrfs", func(l string) []string { return []string{"-f", "-L", l} }, 255},
		"exfat": {"mkfs.exfat", func(l string) []string { return []string{"-L", l} }, 15},
		"ntfs":  {"mkfs.ntfs", func(l string) []string { return []string{"-f", "-L", l} }, 32},
	}
)

// ----- Reading the block devices -----

func listBlock(ctx context.Context) ([]lsblkRaw, error) {
	out, err := exec.CommandContext(ctx, "lsblk", "-J", "-b", "-o",
		"NAME,PATH,SIZE,TYPE,FSTYPE,MOUNTPOINTS,LABEL,MODEL,SERIAL,TRAN,ROTA,RM,UUID,FSUSED,FSAVAIL").Output()
	if err != nil {
		return nil, fmt.Errorf("lsblk: %w", err)
	}
	var raw struct {
		Devices []lsblkRaw `json:"blockdevices"`
	}
	dec := json.NewDecoder(bytes.NewReader(out))
	dec.UseNumber()
	if err := dec.Decode(&raw); err != nil {
		return nil, fmt.Errorf("lsblk: %w", err)
	}
	return raw.Devices, nil
}

func findBlock(devs []lsblkRaw, path string) (dev *lsblkRaw, parent *lsblkRaw) {
	for i := range devs {
		if devs[i].Path == path {
			return &devs[i], nil
		}
		for j := range devs[i].Children {
			if devs[i].Children[j].Path == path {
				return &devs[i].Children[j], &devs[i]
			}
		}
	}
	return nil, nil
}

// inUse explains why a device (or anything on it) can't be erased, or returns "".
func inUse(d *lsblkRaw) string {
	var walk func(x *lsblkRaw) string
	walk = func(x *lsblkRaw) string {
		for _, m := range x.Mountpoints {
			if m := str(m); m != "" {
				if m == "/" || m == "/boot" || m == "/boot/efi" || m == "[SWAP]" {
					return fmt.Sprintf("%s holds the system (%s)", x.Name, m)
				}
				return fmt.Sprintf("%s is mounted at %s; unmount it first", x.Name, m)
			}
		}
		switch str(x.FSType) {
		case "LVM2_member":
			return x.Name + " is part of an LVM volume group"
		case "linux_raid_member":
			return x.Name + " is part of a RAID array"
		case "zfs_member":
			// A pool's drive, imported or not (a TrueNAS pool before it's imported looks unused).
			if pool := str(x.Label); pool != "" {
				return x.Name + " is part of the ZFS pool " + pool + "; formatting it would destroy the pool's data"
			}
			return x.Name + " is part of a ZFS pool; formatting it would destroy the pool's data"
		case "crypto_LUKS":
			return x.Name + " is an encrypted volume"
		case "swap":
			return x.Name + " is swap space"
		}
		if x.Type == "lvm" || x.Type == "raid1" || x.Type == "crypt" {
			return x.Name + " carries " + x.Type + " volumes"
		}
		for i := range x.Children {
			if why := walk(&x.Children[i]); why != "" {
				return why
			}
		}
		return ""
	}
	return walk(d)
}

// ----- /etc/fstab -----

type fstabLine struct {
	Source  string `json:"source"`
	Target  string `json:"target"`
	FSType  string `json:"fstype"`
	Options string `json:"options"`
	// Added by TemanLabsOS (tagged with "# temanlabs" on the line above).
	Managed bool `json:"managed"`
}

var fstabMu sync.Mutex

func readFstab() ([]string, []fstabLine) {
	data, _ := os.ReadFile(fstabPath)
	lines := strings.Split(strings.TrimRight(string(data), "\n"), "\n")
	var entries []fstabLine
	for i, l := range lines {
		f := strings.Fields(l)
		if len(f) < 3 || strings.HasPrefix(f[0], "#") {
			continue
		}
		e := fstabLine{Source: f[0], Target: f[1], FSType: f[2]}
		if len(f) > 3 {
			e.Options = f[3]
		}
		e.Managed = i > 0 && strings.TrimSpace(lines[i-1]) == "# temanlabs"
		entries = append(entries, e)
	}
	return lines, entries
}

// setFstab adds (or with line == "" removes) the TemanLabsOS entry for target, keeping a backup.
func setFstab(target, line string) error {
	fstabMu.Lock()
	defer fstabMu.Unlock()
	data, err := os.ReadFile(fstabPath)
	if err != nil {
		return err
	}
	lines := strings.Split(strings.TrimRight(string(data), "\n"), "\n")
	var out []string
	for i := 0; i < len(lines); i++ {
		l := lines[i]
		f := strings.Fields(l)
		if strings.TrimSpace(l) == "# temanlabs" && i+1 < len(lines) {
			if nf := strings.Fields(lines[i+1]); len(nf) > 1 && nf[1] == target {
				i++ // drop our old entry for this target
				continue
			}
		}
		if len(f) > 1 && !strings.HasPrefix(f[0], "#") && f[1] == target && line != "" {
			// Someone else's entry for the same folder: leave it and refuse to add a second.
			return fmt.Errorf("/etc/fstab already mounts something at %s", target)
		}
		out = append(out, l)
	}
	if line != "" {
		out = append(out, "# temanlabs", line)
	}
	if err := os.WriteFile(fstabPath+".temanlabs.bak", data, 0o644); err != nil {
		return err
	}
	tmp := fstabPath + ".temanlabs.tmp"
	if err := os.WriteFile(tmp, []byte(strings.Join(out, "\n")+"\n"), 0o644); err != nil {
		return err
	}
	return os.Rename(tmp, fstabPath)
}

func fstabOptions(fstype string, o *owner) string {
	opts := "defaults,nofail"
	if fstype == "vfat" || fstype == "exfat" || fstype == "ntfs" || fstype == "ntfs3" {
		// No Unix owners on these: show the files as the user's.
		uid, gid := 1000, 1000
		if o != nil {
			uid, gid = o.uid, o.gid
		}
		opts += fmt.Sprintf(",uid=%d,gid=%d,umask=002", uid, gid)
	}
	return opts
}

// ----- Mount at startup -----

// handleAutomount mounts a partition now and at every startup (or stops doing so).
func (s *server) handleAutomount(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Device string `json:"device"`
		Target string `json:"target"`
		Enable bool   `json:"enable"`
	}
	if decodeJSON(r, &body) != nil || !devicePath.MatchString(body.Device) || strings.Contains(body.Device, "..") {
		writeError(w, http.StatusBadRequest, "invalid device")
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), time.Minute)
	defer cancel()
	devs, err := listBlock(ctx)
	if err != nil {
		writeError(w, http.StatusBadGateway, err.Error())
		return
	}
	d, _ := findBlock(devs, body.Device)
	if d == nil || str(d.UUID) == "" || str(d.FSType) == "" {
		writeError(w, http.StatusBadRequest, "that partition has no filesystem to mount")
		return
	}
	target := body.Target
	for _, m := range d.Mountpoints {
		if m := str(m); m != "" && target == "" {
			target = m
		}
	}
	if target == "" {
		target = filepath.Join(appDataRoot, safeLabel(str(d.Label), d.Name))
	}
	if !absPath(target) || target == "/" || isSystemPath(target) {
		writeError(w, http.StatusBadRequest, "choose a folder like /DATA/Drive or /mnt/Drive")
		return
	}
	if !body.Enable {
		if err := setFstab(target, ""); err != nil {
			writeError(w, http.StatusBadRequest, err.Error())
			return
		}
		w.WriteHeader(http.StatusNoContent)
		return
	}
	line := fmt.Sprintf("UUID=%s %s %s %s 0 2", str(d.UUID), target, str(d.FSType), fstabOptions(str(d.FSType), s.owner))
	if err := setFstab(target, line); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	_ = os.MkdirAll(target, 0o755)
	if len(d.Mountpoints) == 0 || str(d.Mountpoints[0]) == "" {
		if out, err := exec.CommandContext(ctx, "mount", target).CombinedOutput(); err != nil {
			writeError(w, http.StatusBadRequest, "saved for startup, but mounting now failed: "+lastLines(string(out), 2))
			return
		}
	}
	w.WriteHeader(http.StatusNoContent)
}

func safeLabel(label, fallback string) string {
	l := strings.Trim(nonSlugKeepCase.ReplaceAllString(label, "-"), "-")
	if l == "" {
		l = fallback
	}
	return l
}

var nonSlugKeepCase = regexp.MustCompile(`[^A-Za-z0-9_.-]+`)

func isSystemPath(p string) bool {
	for _, sys := range []string{"/bin", "/boot", "/dev", "/etc", "/lib", "/lib64", "/proc", "/root", "/run", "/sbin", "/sys", "/usr", "/var", "/snap", "/opt", "/tmp"} {
		if p == sys || strings.HasPrefix(p, sys+"/") {
			return true
		}
	}
	return false
}

// ----- Format (create storage) -----

func (s *server) handleFormat(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Device  string `json:"device"`
		FSType  string `json:"fstype"`
		Label   string `json:"label"`
		Confirm string `json:"confirm"`
		// Mount under /DATA/<label> now and at startup.
		Mount bool `json:"mount"`
	}
	if decodeJSON(r, &body) != nil || !devicePath.MatchString(body.Device) || strings.Contains(body.Device, "..") {
		writeError(w, http.StatusBadRequest, "invalid device")
		return
	}
	tool, ok := formatTools[body.FSType]
	if !ok {
		writeError(w, http.StatusBadRequest, "choose ext4, xfs, btrfs, exfat or ntfs")
		return
	}
	if _, err := exec.LookPath(tool.cmd); err != nil {
		writeError(w, http.StatusBadRequest, tool.cmd+" isn't installed on the server")
		return
	}
	if !storageName.MatchString(body.Label) || len(body.Label) > tool.maxLabel {
		writeError(w, http.StatusBadRequest, fmt.Sprintf("the name must be letters, numbers, - or _ (up to %d for %s)", tool.maxLabel, body.FSType))
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), time.Minute)
	defer cancel()
	devs, err := listBlock(ctx)
	if err != nil {
		writeError(w, http.StatusBadGateway, err.Error())
		return
	}
	d, _ := findBlock(devs, body.Device)
	if d == nil {
		writeError(w, http.StatusBadRequest, "no such drive")
		return
	}
	loopOK := os.Getenv("TEMANLABS_ALLOW_LOOP") == "1"
	if d.Type != "disk" && d.Type != "part" && !(loopOK && d.Type == "loop") {
		writeError(w, http.StatusBadRequest, "only drives and partitions can be formatted")
		return
	}
	if why := inUse(d); why != "" {
		writeError(w, http.StatusConflict, why+".")
		return
	}
	if body.Confirm != d.Name {
		writeError(w, http.StatusBadRequest, fmt.Sprintf("type %s to confirm", d.Name))
		return
	}
	target := filepath.Join(appDataRoot, body.Label)
	if body.Mount {
		if entries, err := os.ReadDir(target); err == nil && len(entries) > 0 {
			writeError(w, http.StatusConflict, target+" already exists and isn't empty; pick another name")
			return
		}
	}

	whole := d.Type == "disk" || d.Type == "loop"
	dev := d.Path
	o := s.owner
	_, err = startFuncJob("disk-format", "Formatting "+d.Name+" as "+body.FSType, func(ctx context.Context, logf func(string, ...any)) error {
		run := func(name string, args ...string) error {
			logf("$ %s %s", name, strings.Join(args, " "))
			out, err := exec.CommandContext(ctx, name, args...).CombinedOutput()
			for _, l := range strings.Split(strings.TrimSpace(string(out)), "\n") {
				if l != "" {
					logf("%s", l)
				}
			}
			if err != nil {
				return fmt.Errorf("%s failed: %w", name, err)
			}
			return nil
		}
		part := dev
		if err := run("wipefs", "-a", dev); err != nil {
			return err
		}
		if whole {
			if err := run("parted", "-s", dev, "mklabel", "gpt", "mkpart", "primary", "0%", "100%"); err != nil {
				return err
			}
			_ = run("partprobe", dev)
			_ = run("udevadm", "settle")
			part = firstPartition(dev)
			if part == "" {
				return errors.New("the new partition didn't show up")
			}
		}
		if err := run(tool.cmd, append(tool.args(body.Label), part)...); err != nil {
			return err
		}
		if !body.Mount {
			logf("Done. %s is ready.", part)
			return nil
		}
		_ = run("udevadm", "settle")
		uuid := strings.TrimSpace(func() string {
			out, _ := exec.CommandContext(ctx, "blkid", "-s", "UUID", "-o", "value", part).Output()
			return string(out)
		}())
		if uuid == "" {
			return errors.New("couldn't read the new filesystem's UUID")
		}
		if err := os.MkdirAll(target, 0o755); err != nil {
			return err
		}
		if err := setFstab(target, fmt.Sprintf("UUID=%s %s %s %s 0 2", uuid, target, body.FSType, fstabOptions(body.FSType, o))); err != nil {
			return err
		}
		if err := run("mount", target); err != nil {
			return err
		}
		if o != nil && (body.FSType == "ext4" || body.FSType == "xfs" || body.FSType == "btrfs") {
			_ = os.Chown(target, o.uid, o.gid)
		}
		logf("Done. %s is mounted at %s and will be at every startup.", part, target)
		return nil
	})
	if err != nil {
		writeError(w, http.StatusConflict, err.Error())
		return
	}
	writeJSON(w, http.StatusAccepted, map[string]string{"job": "disk-format", "target": target})
}

// firstPartition finds the partition parted just made (sda → sda1, nvme0n1/loop0 → …p1).
func firstPartition(dev string) string {
	for _, c := range []string{dev + "1", dev + "p1"} {
		for i := 0; i < 20; i++ {
			if _, err := os.Stat(c); err == nil {
				return c
			}
			time.Sleep(250 * time.Millisecond)
		}
	}
	return ""
}

// ----- Merge storage (mergerfs) -----

type mergedStorage struct {
	Name     string   `json:"name"`
	Target   string   `json:"target"`
	Branches []string `json:"branches"`
	Mounted  bool     `json:"mounted"`
	Size     int64    `json:"size"`
	Free     int64    `json:"free"`
}

func mountedAt(target string) bool {
	data, _ := os.ReadFile("/proc/self/mounts")
	for _, l := range strings.Split(string(data), "\n") {
		if f := strings.Fields(l); len(f) > 1 && strings.ReplaceAll(f[1], `\040`, " ") == target {
			return true
		}
	}
	return false
}

func diskSpace(path string) (size, free int64) {
	var st syscall.Statfs_t
	if syscall.Statfs(path, &st) != nil {
		return 0, 0
	}
	return int64(st.Blocks) * int64(st.Bsize), int64(st.Bavail) * int64(st.Bsize)
}

func (s *server) handleStorage(w http.ResponseWriter, r *http.Request) {
	_, entries := readFstab()
	merged := []mergedStorage{}
	for _, e := range entries {
		if e.FSType != "fuse.mergerfs" {
			continue
		}
		m := mergedStorage{Name: filepath.Base(e.Target), Target: e.Target, Branches: strings.Split(e.Source, ":"), Mounted: mountedAt(e.Target)}
		if m.Mounted {
			m.Size, m.Free = diskSpace(e.Target)
		}
		merged = append(merged, m)
	}
	_, mergerErr := exec.LookPath("mergerfs")
	writeJSON(w, http.StatusOK, map[string]any{
		"fstab":        entries,
		"merged":       merged,
		"mergerfs":     mergerErr == nil,
		"usbAutomount": s.usb.enabled(),
		"filesystems":  availableFilesystems(),
	})
}

func availableFilesystems() []string {
	var out []string
	for _, fs := range []string{"ext4", "xfs", "btrfs", "exfat", "ntfs"} {
		if _, err := exec.LookPath(formatTools[fs].cmd); err == nil {
			out = append(out, fs)
		}
	}
	return out
}

func (s *server) handleMerge(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Name     string   `json:"name"`
		Branches []string `json:"branches"`
	}
	if decodeJSON(r, &body) != nil || !storageName.MatchString(body.Name) {
		writeError(w, http.StatusBadRequest, "the name must be letters, numbers, - or _")
		return
	}
	if _, err := exec.LookPath("mergerfs"); err != nil {
		writeError(w, http.StatusBadRequest, "mergerfs isn't installed; install it from the Merge panel")
		return
	}
	if len(body.Branches) < 2 {
		writeError(w, http.StatusBadRequest, "pick at least two drives to merge")
		return
	}
	target := filepath.Join(appDataRoot, body.Name)
	for _, b := range body.Branches {
		if !absPath(b) || b == "/" || strings.ContainsAny(b, ": ,") || isSystemPath(b) {
			writeError(w, http.StatusBadRequest, fmt.Sprintf("%q can't be merged", b))
			return
		}
		if info, err := os.Stat(b); err != nil || !info.IsDir() {
			writeError(w, http.StatusBadRequest, b+" isn't a folder")
			return
		}
		if b == target || strings.HasPrefix(target+"/", b+"/") || strings.HasPrefix(b+"/", target+"/") {
			writeError(w, http.StatusBadRequest, "the merged folder can't be inside one of its drives")
			return
		}
	}
	if entries, err := os.ReadDir(target); err == nil && len(entries) > 0 && !mountedAt(target) {
		writeError(w, http.StatusConflict, target+" already exists and isn't empty; pick another name")
		return
	}
	// New files go to the drive with the most free space; a drive is skipped once it's nearly
	// full: 2% of the smallest drive, between 100 MB and 4 GB.
	smallest := int64(0)
	for _, b := range body.Branches {
		if size, _ := diskSpace(b); size > 0 && (smallest == 0 || size < smallest) {
			smallest = size
		}
	}
	minFree := min(max(smallest/50, 100<<20), 4<<30) >> 20
	opts := fmt.Sprintf("defaults,allow_other,use_ino,cache.files=off,dropcacheonclose=true,category.create=mfs,minfreespace=%dM,nofail,fsname=temanlabs-%s", minFree, body.Name)
	if err := setFstab(target, fmt.Sprintf("%s %s fuse.mergerfs %s 0 0", strings.Join(body.Branches, ":"), target, opts)); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	_ = os.MkdirAll(target, 0o755)
	ctx, cancel := context.WithTimeout(r.Context(), 30*time.Second)
	defer cancel()
	if out, err := exec.CommandContext(ctx, "mount", target).CombinedOutput(); err != nil {
		_ = setFstab(target, "")
		writeError(w, http.StatusBadRequest, "mergerfs: "+lastLines(string(out), 2))
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *server) handleUnmerge(w http.ResponseWriter, r *http.Request) {
	name := r.PathValue("name")
	if !storageName.MatchString(name) {
		writeError(w, http.StatusBadRequest, "invalid name")
		return
	}
	target := filepath.Join(appDataRoot, name)
	_, entries := readFstab()
	found := false
	for _, e := range entries {
		found = found || (e.Target == target && e.FSType == "fuse.mergerfs")
	}
	if !found {
		writeError(w, http.StatusNotFound, "no merged storage called "+name)
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 30*time.Second)
	defer cancel()
	if mountedAt(target) {
		if out, err := exec.CommandContext(ctx, "umount", target).CombinedOutput(); err != nil {
			msg := lastLines(string(out), 2)
			if strings.Contains(msg, "busy") {
				msg = "Something still has files open there (an app or a share). Stop it first."
			}
			writeError(w, http.StatusConflict, msg)
			return
		}
	}
	if err := setFstab(target, ""); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	_ = os.Remove(target) // only if empty: the files stay on the drives
	w.WriteHeader(http.StatusNoContent)
}

func (s *server) handleInstallMergerfs(w http.ResponseWriter, r *http.Request) {
	_, err := startJob("apt", "Installing mergerfs", []string{"DEBIAN_FRONTEND=noninteractive"}, nil, "apt-get", "install", "-y", "mergerfs")
	if err != nil {
		writeError(w, http.StatusConflict, err.Error())
		return
	}
	writeJSON(w, http.StatusAccepted, map[string]string{"job": "apt"})
}

// ----- USB drives -----

type usbMounter struct {
	path  string
	owner *owner
	mu    sync.Mutex
	on    bool
	// Partitions mounted here, so a user's unmount isn't undone right away.
	seen map[string]bool
}

func newUSBMounter(stateDir string, o *owner) *usbMounter {
	u := &usbMounter{path: filepath.Join(stateDir, "storage.json"), owner: o, on: true, seen: map[string]bool{}}
	if data, err := os.ReadFile(u.path); err == nil {
		var cfg struct {
			USB *bool `json:"usbAutomount"`
		}
		if json.Unmarshal(data, &cfg) == nil && cfg.USB != nil {
			u.on = *cfg.USB
		}
	}
	go u.loop()
	return u
}

func (u *usbMounter) enabled() bool {
	u.mu.Lock()
	defer u.mu.Unlock()
	return u.on
}

func (u *usbMounter) set(on bool) error {
	u.mu.Lock()
	u.on = on
	u.mu.Unlock()
	data, _ := json.Marshal(map[string]bool{"usbAutomount": on})
	return os.WriteFile(u.path, data, 0o644)
}

// loop mounts USB partitions with a filesystem at /media/<label> soon after they appear.
func (u *usbMounter) loop() {
	for range time.Tick(5 * time.Second) {
		if !u.enabled() {
			continue
		}
		ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		devs, err := listBlock(ctx)
		if err != nil {
			cancel()
			continue
		}
		present := map[string]bool{}
		for _, d := range devs {
			if str(d.Tran) != "usb" && !d.RM {
				continue
			}
			parts := d.Children
			if len(parts) == 0 {
				parts = []lsblkRaw{d}
			}
			for _, p := range parts {
				uuid, fstype := str(p.UUID), str(p.FSType)
				if uuid == "" || fstype == "" || fstype == "swap" || strings.HasSuffix(fstype, "_member") {
					continue
				}
				present[uuid] = true
				mounted := false
				for _, m := range p.Mountpoints {
					mounted = mounted || str(m) != ""
				}
				u.mu.Lock()
				seen := u.seen[uuid]
				u.seen[uuid] = true
				u.mu.Unlock()
				if mounted || seen {
					continue
				}
				target := filepath.Join("/media", safeLabel(str(p.Label), p.Name))
				_ = os.MkdirAll(target, 0o755)
				args := []string{p.Path, target}
				if o := fstabOptions(fstype, u.owner); strings.Contains(o, "uid=") {
					args = append([]string{"-o", strings.TrimPrefix(o, "defaults,nofail,")}, args...)
				}
				if out, err := exec.CommandContext(ctx, "mount", args...).CombinedOutput(); err != nil {
					log.Printf("usb: mounting %s: %s", p.Path, strings.TrimSpace(string(out)))
					_ = os.Remove(target)
				} else {
					log.Printf("usb: mounted %s at %s", p.Path, target)
				}
			}
		}
		// Forget drives that were unplugged, so they mount again next time.
		u.mu.Lock()
		for uuid := range u.seen {
			if !present[uuid] {
				delete(u.seen, uuid)
			}
		}
		u.mu.Unlock()
		cancel()
	}
}

func (s *server) handleUSBSetting(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Enable bool `json:"enable"`
	}
	if decodeJSON(r, &body) != nil {
		writeError(w, http.StatusBadRequest, "invalid request")
		return
	}
	if err := s.usb.set(body.Enable); err != nil {
		writeFSError(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// handleEject unmounts every partition of a drive and powers it off, so it can be unplugged.
func (s *server) handleEject(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Device string `json:"device"`
	}
	if decodeJSON(r, &body) != nil || !devicePath.MatchString(body.Device) || strings.Contains(body.Device, "..") {
		writeError(w, http.StatusBadRequest, "invalid device")
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), time.Minute)
	defer cancel()
	devs, err := listBlock(ctx)
	if err != nil {
		writeError(w, http.StatusBadGateway, err.Error())
		return
	}
	d, _ := findBlock(devs, body.Device)
	if d == nil || (str(d.Tran) != "usb" && !d.RM) {
		writeError(w, http.StatusBadRequest, "only USB and removable drives can be ejected")
		return
	}
	var mounts []string
	for _, p := range append([]lsblkRaw{*d}, d.Children...) {
		for _, m := range p.Mountpoints {
			if m := str(m); m != "" {
				mounts = append(mounts, m)
			}
		}
	}
	slices.Sort(mounts)
	for i := len(mounts) - 1; i >= 0; i-- {
		if out, err := exec.CommandContext(ctx, "umount", mounts[i]).CombinedOutput(); err != nil {
			writeError(w, http.StatusConflict, "couldn't unmount "+mounts[i]+": "+lastLines(string(out), 1))
			return
		}
		if strings.HasPrefix(mounts[i], "/media/") {
			_ = os.Remove(mounts[i])
		}
	}
	_ = exec.CommandContext(ctx, "udisksctl", "power-off", "-b", d.Path, "--no-user-interaction").Run()
	w.WriteHeader(http.StatusNoContent)
}
