package main

import (
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
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"

	"gopkg.in/yaml.v3"
)

// ZFS pools, for servers that come from TrueNAS (or had ZFS before): find the pools on the
// drives, import them, watch their health, scrub them, and keep snapshots. Nothing here erases
// data: import only reads the drives until it's asked to use a pool normally, the only snapshots
// ever destroyed are the daily ones TemanLabsOS made itself, and a pool is never exported,
// upgraded or changed in its properties, so it can still go back to TrueNAS.

const (
	zfsJob = "zfs"
	// Snapshot names TemanLabsOS uses; only autoSnapPrefix ones are ever removed (when too old).
	autoSnapPrefix   = "temanlabs-auto-"
	importSnapPrefix = "temanlabs-imported-"
	manualSnapPrefix = "temanlabs-manual-"
)

var (
	poolName = regexp.MustCompile(`^[A-Za-z][A-Za-z0-9_.:-]{0,254}$`)
	poolID   = regexp.MustCompile(`^[0-9]{1,20}$`)
	// The keys of zpool status and zpool import reports.
	zpoolKey = regexp.MustCompile(`^\s*(pool|id|state|status|action|see|scan|config|errors|comment|remove|checkpoint):\s?(.*)$`)
	// TrueNAS's own system disk: its datasets would mount over this system's folders.
	bootPools = map[string]bool{"boot-pool": true, "freenas-boot": true}
)

type zfsVdev struct {
	Name     string     `json:"name"`
	State    string     `json:"state,omitempty"`
	Read     string     `json:"read,omitempty"`
	Write    string     `json:"write,omitempty"`
	Cksum    string     `json:"cksum,omitempty"`
	Note     string     `json:"note,omitempty"`
	Children []*zfsVdev `json:"children,omitempty"`
}

// zpoolReport is one pool's part of zpool status or zpool import.
type zpoolReport struct {
	fields map[string]string
	vdevs  []*zfsVdev
}

type zfsPool struct {
	Name   string `json:"name"`
	State  string `json:"state"`
	Status string `json:"status,omitempty"`
	Action string `json:"action,omitempty"`
	Scan   string `json:"scan,omitempty"`
	// zpool status' "errors:" line; "No known data errors" when there are none.
	Errors    string     `json:"errors,omitempty"`
	Scrubbing bool       `json:"scrubbing"`
	Used      uint64     `json:"used"`
	Free      uint64     `json:"free"`
	Mount     string     `json:"mount,omitempty"`
	ReadOnly  bool       `json:"readOnly"`
	Vdevs     []*zfsVdev `json:"vdevs"`
	// Encrypted datasets whose key isn't loaded: their files can't be read yet.
	Locked []string `json:"locked"`
	// Datasets left unmounted because they'd cover a system folder or a folder with files.
	Skipped []string `json:"skipped"`
	Auto    zfsAuto  `json:"auto"`
	// The pool has TrueNAS apps (ix-apps or the older ix-applications).
	TrueNASApps bool `json:"trueNasApps"`
}

type zfsImportable struct {
	Name   string     `json:"name"`
	ID     string     `json:"id"`
	State  string     `json:"state"`
	Status string     `json:"status,omitempty"`
	Action string     `json:"action,omitempty"`
	Vdevs  []*zfsVdev `json:"vdevs"`
	// Why it can't be imported here, if it can't.
	Blocked string `json:"blocked,omitempty"`
}

type zfsInfo struct {
	Installed  bool            `json:"installed"`
	Pools      []zfsPool       `json:"pools"`
	Importable []zfsImportable `json:"importable"`
	Error      string          `json:"error,omitempty"`
}

// ----- Reading zpool's reports -----

// parseZpoolReports reads zpool status or zpool import output: "key: value" lines (continued on
// lines that start with a tab) and the config tree, nested by two spaces a level.
func parseZpoolReports(out string) []zpoolReport {
	var reports []zpoolReport
	var cur *zpoolReport
	key, inConfig := "", false
	type frame struct {
		depth int
		v     *zfsVdev
	}
	var stack []frame
	for _, line := range strings.Split(out, "\n") {
		trimmed := strings.TrimSpace(line)
		if m := zpoolKey.FindStringSubmatch(line); m != nil && (!inConfig || !strings.HasPrefix(line, "\t")) {
			if m[1] == "pool" {
				reports = append(reports, zpoolReport{fields: map[string]string{}})
				cur = &reports[len(reports)-1]
			}
			if cur == nil {
				continue
			}
			key, inConfig = m[1], m[1] == "config"
			stack = nil
			cur.fields[key] = strings.TrimSpace(m[2])
			continue
		}
		if cur == nil || trimmed == "" {
			continue
		}
		if !inConfig {
			if strings.HasPrefix(line, "\t") || strings.HasPrefix(line, "  ") {
				cur.fields[key] = strings.TrimSpace(cur.fields[key] + " " + trimmed)
			}
			continue
		}
		f := strings.Fields(trimmed)
		if f[0] == "NAME" && len(f) > 1 && f[1] == "STATE" {
			continue
		}
		indent := len(strings.TrimLeft(line, "\t")) - len(strings.TrimLeft(strings.TrimLeft(line, "\t"), " "))
		depth := indent / 2
		v := &zfsVdev{Name: f[0]}
		if len(f) > 1 {
			v.State = f[1]
		}
		switch {
		case len(f) >= 5 && isCount(f[2]) && isCount(f[3]) && isCount(f[4]):
			v.Read, v.Write, v.Cksum = f[2], f[3], f[4]
			v.Note = strings.Join(f[5:], " ")
		case len(f) > 2:
			v.Note = strings.Join(f[2:], " ")
		}
		for len(stack) > 0 && stack[len(stack)-1].depth >= depth {
			stack = stack[:len(stack)-1]
		}
		if len(stack) == 0 {
			cur.vdevs = append(cur.vdevs, v)
		} else {
			parent := stack[len(stack)-1].v
			parent.Children = append(parent.Children, v)
		}
		stack = append(stack, frame{depth, v})
	}
	return reports
}

// isCount is an error count as zpool writes it: 0, 12, 1.2K.
func isCount(s string) bool {
	return s != "" && strings.Trim(s, "0123456789.KMGTPE") == ""
}

// ----- Pools -----

func zfsInstalled() bool {
	_, err := exec.LookPath("zpool")
	return err == nil
}

func zfsOut(ctx context.Context, name string, args ...string) (string, error) {
	out, err := exec.CommandContext(ctx, name, args...).CombinedOutput()
	if err != nil {
		msg := strings.TrimSpace(string(out))
		if msg == "" {
			msg = err.Error()
		}
		return string(out), errors.New(lastLines(msg, 3))
	}
	return string(out), nil
}

type zfsDataset struct {
	name, mount, mounted, encryption, keystatus, canmount string
}

func listDatasets(ctx context.Context, pool string) []zfsDataset {
	out, err := exec.CommandContext(ctx, "zfs", "list", "-H", "-o", "name,mountpoint,mounted,encryption,keystatus,canmount", "-r", "-t", "filesystem", pool).Output()
	if err != nil {
		return nil
	}
	var list []zfsDataset
	for _, line := range strings.Split(strings.TrimSpace(string(out)), "\n") {
		f := strings.Split(line, "\t")
		if len(f) == 6 {
			list = append(list, zfsDataset{f[0], f[1], f[2], f[3], f[4], f[5]})
		}
	}
	return list
}

func (s *server) zfsPools(ctx context.Context) ([]zfsPool, error) {
	out, err := zfsOut(ctx, "zpool", "status", "-P")
	if err != nil && !strings.Contains(err.Error(), "no pools available") {
		return nil, err
	}
	space := map[string][3]string{}
	if out, err := exec.CommandContext(ctx, "zfs", "list", "-Hp", "-d", "0", "-o", "name,used,avail,mountpoint").Output(); err == nil {
		for _, line := range strings.Split(strings.TrimSpace(string(out)), "\n") {
			if f := strings.Split(line, "\t"); len(f) == 4 {
				space[f[0]] = [3]string{f[1], f[2], f[3]}
			}
		}
	}
	readOnly := map[string]bool{}
	if out, err := exec.CommandContext(ctx, "zpool", "get", "-H", "-o", "name,value", "readonly").Output(); err == nil {
		for _, line := range strings.Split(strings.TrimSpace(string(out)), "\n") {
			if f := strings.Split(line, "\t"); len(f) == 2 {
				readOnly[f[0]] = f[1] == "on"
			}
		}
	}
	auto := s.zfsSettings()
	pools := []zfsPool{}
	for _, r := range parseZpoolReports(out) {
		name := r.fields["pool"]
		p := zfsPool{
			Name: name, State: r.fields["state"], Status: r.fields["status"], Action: r.fields["action"],
			Scan: r.fields["scan"], Errors: r.fields["errors"], Vdevs: r.vdevs, ReadOnly: readOnly[name],
			Locked: []string{}, Skipped: []string{}, Auto: auto[name],
		}
		if p.Vdevs == nil {
			p.Vdevs = []*zfsVdev{}
		}
		p.Scrubbing = strings.Contains(p.Scan, "scrub in progress")
		if sp, ok := space[name]; ok {
			p.Used, _ = strconv.ParseUint(sp[0], 10, 64)
			p.Free, _ = strconv.ParseUint(sp[1], 10, 64)
		}
		for _, d := range listDatasets(ctx, name) {
			if d.keystatus == "unavailable" {
				p.Locked = append(p.Locked, d.name)
			}
			if d.name == name && d.mounted == "yes" {
				p.Mount = d.mount
			}
			if d.name == name+"/ix-apps" || d.name == name+"/ix-applications" {
				p.TrueNASApps = true
			}
			if d.mounted == "no" && d.canmount == "on" && d.keystatus != "unavailable" && unsafeMount(d.mount) != "" {
				p.Skipped = append(p.Skipped, d.name+" ("+d.mount+")")
			}
		}
		pools = append(pools, p)
	}
	return pools, nil
}

// unsafeMount says why a dataset mustn't be mounted at path (over this system's folders, or over
// files that would disappear under it), or "".
func unsafeMount(path string) string {
	if path == "" || path == "none" || path == "legacy" || path == "-" {
		return ""
	}
	if path == "/" || isSystemPath(path) || path == "/home" || path == "/mnt" || path == "/media" {
		return "it would cover the system folder " + path
	}
	if mountedAt(path) {
		return ""
	}
	if entries, err := os.ReadDir(path); err == nil && len(entries) > 0 {
		return path + " already has files that it would hide"
	}
	return ""
}

func listImportable(ctx context.Context) ([]zfsImportable, error) {
	out, err := exec.CommandContext(ctx, "zpool", "import").CombinedOutput()
	if !strings.Contains(string(out), "pool:") {
		// Without udev (or with its cache behind) the usual places miss drives: look at all of /dev.
		if more, err2 := exec.CommandContext(ctx, "zpool", "import", "-d", "/dev").CombinedOutput(); strings.Contains(string(more), "pool:") {
			out, err = more, err2
		}
	}
	text := string(out)
	if err != nil && !strings.Contains(text, "pool:") {
		if strings.Contains(text, "no pools available") || strings.TrimSpace(text) == "" {
			return []zfsImportable{}, nil
		}
		return nil, errors.New(lastLines(strings.TrimSpace(text), 2))
	}
	list := []zfsImportable{}
	for _, r := range parseZpoolReports(text) {
		p := zfsImportable{Name: r.fields["pool"], ID: r.fields["id"], State: r.fields["state"], Status: r.fields["status"], Action: r.fields["action"], Vdevs: r.vdevs}
		if p.Vdevs == nil {
			p.Vdevs = []*zfsVdev{}
		}
		switch {
		case bootPools[p.Name]:
			p.Blocked = "This is TrueNAS’s own system disk, not data. Leave it unimported; erase it in Format if you want to reuse the drive."
		case p.State == "UNAVAIL" || p.State == "FAULTED":
			p.Blocked = "Too many of its drives are missing or failing to import it. Connect all of the pool’s drives and refresh."
		}
		list = append(list, p)
	}
	return list, nil
}

func (s *server) handleZFS(w http.ResponseWriter, r *http.Request) {
	info := zfsInfo{Installed: zfsInstalled(), Pools: []zfsPool{}, Importable: []zfsImportable{}}
	if info.Installed {
		ctx, cancel := context.WithTimeout(r.Context(), 45*time.Second)
		defer cancel()
		pools, err := s.zfsPools(ctx)
		if err != nil {
			info.Error = err.Error()
		} else {
			info.Pools = pools
		}
		imp, err := listImportable(ctx)
		if err != nil && info.Error == "" {
			info.Error = err.Error()
		} else if err == nil {
			info.Importable = imp
		}
	}
	writeJSON(w, http.StatusOK, info)
}

func (s *server) handleInstallZFS(w http.ResponseWriter, r *http.Request) {
	_, err := startFuncJob(zfsJob, "Installing the ZFS tools", func(ctx context.Context, logf func(string, ...any)) error {
		logf("Installing zfsutils-linux…")
		if err := aptInstall(ctx, "zfsutils-linux"); err != nil {
			return err
		}
		logf("Done.")
		return nil
	})
	if err != nil {
		writeError(w, http.StatusConflict, err.Error())
		return
	}
	writeJSON(w, http.StatusAccepted, map[string]string{"job": zfsJob})
}

// ----- Import -----

func (s *server) handleZFSImport(w http.ResponseWriter, r *http.Request) {
	var body struct {
		ID       string `json:"id"`
		Name     string `json:"name"`
		ReadOnly bool   `json:"readOnly"`
	}
	if decodeJSON(r, &body) != nil || !poolID.MatchString(body.ID) || !poolName.MatchString(body.Name) {
		writeError(w, http.StatusBadRequest, "invalid pool")
		return
	}
	if bootPools[body.Name] {
		writeError(w, http.StatusBadRequest, "that's TrueNAS's system disk, not a data pool")
		return
	}
	title := "Importing " + body.Name
	if body.ReadOnly {
		title += " (read-only)"
	}
	_, err := startFuncJob(zfsJob, title, func(ctx context.Context, logf func(string, ...any)) error {
		return s.importPool(ctx, body.ID, body.Name, body.ReadOnly, logf)
	})
	if err != nil {
		writeError(w, http.StatusConflict, err.Error())
		return
	}
	writeJSON(w, http.StatusAccepted, map[string]string{"job": zfsJob})
}

// importPool imports by ID (two pools can share a name), without mounting, then mounts the
// datasets that are safe to mount. A read-only import isn't remembered: after a restart the pool
// is back on the drives, untouched. A normal one is, and gets a snapshot to go back to.
func (s *server) importPool(ctx context.Context, id, name string, readOnly bool, logf func(string, ...any)) error {
	args := []string{"import", "-f", "-N"}
	if readOnly {
		args = append(args, "-o", "readonly=on", "-o", "cachefile=none")
		logf("Importing %s read-only: nothing on its drives is written.", name)
	} else {
		logf("Importing %s…", name)
	}
	// -f: a pool from TrueNAS was last used by that system; it's safe once its drives are here.
	_, err := zfsOut(ctx, "zpool", append(args, id)...)
	if err != nil && strings.Contains(err.Error(), "no such pool") {
		_, err = zfsOut(ctx, "zpool", append(append(args, "-d", "/dev"), id)...)
	}
	if err != nil {
		if strings.Contains(err.Error(), "unsupported feature") {
			return fmt.Errorf("%v\nThis pool uses ZFS features newer than this server's ZFS. Try a read-only import, or a newer Ubuntu (26.04 has a newer ZFS).", err)
		}
		return err
	}
	s.mountPool(ctx, name, !readOnly, logf)
	if !readOnly {
		snap := name + "@" + importSnapPrefix + time.Now().Format("20060102-1504")
		if _, err := zfsOut(ctx, "zfs", "snapshot", "-r", snap); err != nil {
			logf("Couldn't take the snapshot (%v).", err)
		} else {
			logf("Snapshot %s taken: the pool as it came from the old system, to go back to.", snap)
		}
		linkTrueNASPaths(ctx, name, logf)
	}
	logf("Done.")
	return nil
}

// mountPool mounts a pool's datasets, parents first, leaving out locked ones and those that
// would cover system folders or files. For a pool in normal use (kept), those are set to
// canmount=noauto too, or the system would mount them over its folders at the next start.
func (s *server) mountPool(ctx context.Context, pool string, kept bool, logf func(string, ...any)) {
	datasets := listDatasets(ctx, pool)
	sort.SliceStable(datasets, func(i, j int) bool { return len(datasets[i].mount) < len(datasets[j].mount) })
	mounted, locked := 0, 0
	for _, d := range datasets {
		if d.canmount != "on" || d.mounted == "yes" || d.mount == "none" || d.mount == "legacy" {
			continue
		}
		if d.keystatus == "unavailable" {
			locked++
			continue
		}
		if why := unsafeMount(d.mount); why != "" {
			logf("Left %s unmounted: %s.", d.name, why)
			if kept {
				if _, err := zfsOut(ctx, "zfs", "set", "canmount=noauto", d.name); err == nil {
					logf("Set %s to mount only when asked (canmount=noauto), so it stays off at startup too.", d.name)
				}
			}
			continue
		}
		if _, err := zfsOut(ctx, "zfs", "mount", d.name); err != nil {
			logf("Couldn't mount %s: %v", d.name, err)
			continue
		}
		mounted++
	}
	logf("Mounted %d datasets.", mounted)
	if locked > 0 {
		logf("%d encrypted datasets are locked: unlock them in Disk Manager with their key or passphrase.", locked)
	}
}

// linkTrueNASPaths makes TrueNAS's paths work here: TrueNAS mounts pools under /mnt (/mnt/tank),
// Ubuntu at the pool's own mountpoint (/tank), and apps' data under /mnt/.ix-apps. Links are only
// added where nothing is, so paths in scripts and apps' compose files keep working.
func linkTrueNASPaths(ctx context.Context, pool string, logf func(string, ...any)) {
	link := func(from, to string) {
		if to == "" || to == from || !strings.HasPrefix(to, "/") {
			return
		}
		if _, err := os.Lstat(from); err == nil {
			return
		}
		if err := os.Symlink(to, from); err == nil {
			logf("Linked %s to %s, where TrueNAS had it.", from, to)
		}
	}
	for _, d := range listDatasets(ctx, pool) {
		if d.mounted != "yes" {
			continue
		}
		switch d.name {
		case pool:
			link("/mnt/"+pool, d.mount)
		case pool + "/ix-apps":
			link("/mnt/.ix-apps", d.mount)
		}
	}
}

// handleZFSReadWrite turns a read-only import into a normal one: export, then import again.
func (s *server) handleZFSReadWrite(w http.ResponseWriter, r *http.Request) {
	pool, ok := s.knownPool(w, r)
	if !ok {
		return
	}
	_, err := startFuncJob(zfsJob, "Using "+pool+" normally", func(ctx context.Context, logf func(string, ...any)) error {
		ro, _ := zfsOut(ctx, "zpool", "get", "-H", "-o", "value", "readonly", pool)
		if strings.TrimSpace(ro) != "on" {
			return errors.New(pool + " is already in normal use")
		}
		id, err := zfsOut(ctx, "zpool", "get", "-H", "-o", "value", "guid", pool)
		if err != nil {
			return err
		}
		logf("Setting %s aside, to import it again for normal use…", pool)
		if _, err := zfsOut(ctx, "zpool", "export", pool); err != nil {
			return fmt.Errorf("%v\nClose files and apps that use it, then try again.", err)
		}
		return s.importPool(ctx, strings.TrimSpace(id), pool, false, logf)
	})
	if err != nil {
		writeError(w, http.StatusConflict, err.Error())
		return
	}
	writeJSON(w, http.StatusAccepted, map[string]string{"job": zfsJob})
}

// knownPool reads {pool} from the URL; it must be an imported pool.
func (s *server) knownPool(w http.ResponseWriter, r *http.Request) (string, bool) {
	pool := r.PathValue("pool")
	if !poolName.MatchString(pool) {
		writeError(w, http.StatusBadRequest, "invalid pool")
		return "", false
	}
	if err := exec.CommandContext(r.Context(), "zpool", "list", "-H", "-o", "name", pool).Run(); err != nil {
		writeError(w, http.StatusNotFound, "no imported pool named "+pool)
		return "", false
	}
	return pool, true
}

// ----- Scrub, unlock -----

func (s *server) handleZFSScrub(w http.ResponseWriter, r *http.Request) {
	pool, ok := s.knownPool(w, r)
	if !ok {
		return
	}
	var body struct {
		Stop bool `json:"stop"`
	}
	_ = decodeJSON(r, &body)
	args := []string{"scrub", pool}
	if body.Stop {
		args = []string{"scrub", "-s", pool}
	}
	if _, err := zfsOut(r.Context(), "zpool", args...); err != nil {
		writeError(w, http.StatusConflict, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

func (s *server) handleZFSUnlock(w http.ResponseWriter, r *http.Request) {
	pool, ok := s.knownPool(w, r)
	if !ok {
		return
	}
	var body struct {
		Dataset string `json:"dataset"`
		Key     string `json:"key"`
	}
	if decodeJSON(r, &body) != nil || body.Key == "" || (body.Dataset != pool && !strings.HasPrefix(body.Dataset, pool+"/")) || strings.ContainsAny(body.Dataset, " \t\n@") {
		writeError(w, http.StatusBadRequest, "choose a dataset and enter its key")
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), time.Minute)
	defer cancel()
	cmd := exec.CommandContext(ctx, "zfs", "load-key", body.Dataset)
	cmd.Stdin = strings.NewReader(body.Key + "\n")
	if out, err := cmd.CombinedOutput(); err != nil {
		msg := lastLines(strings.TrimSpace(string(out)), 2)
		if strings.Contains(msg, "Incorrect key") || strings.Contains(msg, "incorrect") {
			msg = "That key or passphrase isn't right."
		}
		writeError(w, http.StatusBadRequest, msg)
		return
	}
	var log []string
	s.mountPool(ctx, pool, false, func(f string, a ...any) { log = append(log, fmt.Sprintf(f, a...)) })
	writeJSON(w, http.StatusOK, map[string]any{"log": log})
}

// ----- Snapshots -----

type zfsSnapshot struct {
	Name     string    `json:"name"`
	Created  time.Time `json:"created"`
	Used     uint64    `json:"used"`
	Datasets int       `json:"datasets"`
	// Its files, read-only, in the pool's top folder (each dataset has its own .zfs folder).
	Browse string `json:"browse,omitempty"`
	Auto   bool   `json:"auto,omitempty"`
}

func (s *server) handleZFSSnapshots(w http.ResponseWriter, r *http.Request) {
	pool, ok := s.knownPool(w, r)
	if !ok {
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 45*time.Second)
	defer cancel()
	snaps, err := poolSnapshots(ctx, pool)
	if err != nil {
		writeError(w, http.StatusBadGateway, err.Error())
		return
	}
	root := ""
	for _, d := range listDatasets(ctx, pool) {
		if d.name == pool && d.mounted == "yes" {
			root = d.mount
		}
	}
	total := len(snaps)
	if len(snaps) > 30 {
		snaps = snaps[:30]
	}
	for i := range snaps {
		if root != "" {
			snaps[i].Browse = filepath.Join(root, ".zfs", "snapshot", snaps[i].Name)
		}
	}
	writeJSON(w, http.StatusOK, map[string]any{"snapshots": snaps, "total": total})
}

// poolSnapshots groups a pool's snapshots by name (a recursive snapshot has one per dataset),
// newest first.
func poolSnapshots(ctx context.Context, pool string) ([]zfsSnapshot, error) {
	out, err := zfsOut(ctx, "zfs", "list", "-H", "-p", "-t", "snapshot", "-o", "name,creation,used", "-r", pool)
	if err != nil {
		if strings.Contains(err.Error(), "no datasets available") {
			return []zfsSnapshot{}, nil
		}
		return nil, err
	}
	byName := map[string]*zfsSnapshot{}
	var order []*zfsSnapshot
	for _, line := range strings.Split(strings.TrimSpace(out), "\n") {
		f := strings.Split(line, "\t")
		if len(f) != 3 {
			continue
		}
		_, snap, ok := strings.Cut(f[0], "@")
		if !ok {
			continue
		}
		created, _ := strconv.ParseInt(f[1], 10, 64)
		used, _ := strconv.ParseUint(f[2], 10, 64)
		g := byName[snap]
		if g == nil {
			g = &zfsSnapshot{Name: snap, Created: time.Unix(created, 0), Auto: strings.HasPrefix(snap, autoSnapPrefix)}
			byName[snap] = g
			order = append(order, g)
		}
		g.Used += used
		g.Datasets++
	}
	list := make([]zfsSnapshot, 0, len(order))
	for _, g := range order {
		list = append(list, *g)
	}
	sort.SliceStable(list, func(i, j int) bool { return list[i].Created.After(list[j].Created) })
	return list, nil
}

func (s *server) handleZFSSnapshot(w http.ResponseWriter, r *http.Request) {
	pool, ok := s.knownPool(w, r)
	if !ok {
		return
	}
	snap := pool + "@" + manualSnapPrefix + time.Now().Format("20060102-150405")
	if _, err := zfsOut(r.Context(), "zfs", "snapshot", "-r", snap); err != nil {
		writeError(w, http.StatusConflict, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"snapshot": snap})
}

// ----- Daily snapshots -----

type zfsAuto struct {
	Daily bool `json:"daily"`
	Keep  int  `json:"keep"`
}

var zfsSettingsMu sync.Mutex

func (s *server) zfsSettingsFile() string { return filepath.Join(s.cfg.StateDir, "zfs.json") }

func (s *server) zfsSettings() map[string]zfsAuto {
	zfsSettingsMu.Lock()
	defer zfsSettingsMu.Unlock()
	m := map[string]zfsAuto{}
	if data, err := os.ReadFile(s.zfsSettingsFile()); err == nil {
		_ = json.Unmarshal(data, &m)
	}
	return m
}

func (s *server) handleZFSAuto(w http.ResponseWriter, r *http.Request) {
	pool, ok := s.knownPool(w, r)
	if !ok {
		return
	}
	var body zfsAuto
	if decodeJSON(r, &body) != nil || body.Keep < 1 || body.Keep > 365 {
		writeError(w, http.StatusBadRequest, "keep between 1 and 365 snapshots")
		return
	}
	m := s.zfsSettings()
	m[pool] = body
	zfsSettingsMu.Lock()
	data, _ := json.MarshalIndent(m, "", "  ")
	err := os.WriteFile(s.zfsSettingsFile(), data, 0o600)
	zfsSettingsMu.Unlock()
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	if body.Daily {
		go s.autoSnapshot(pool, body.Keep)
	}
	writeJSON(w, http.StatusOK, body)
}

// runZFSSnapshots takes each pool's daily snapshot when the last is a day old.
func (s *server) runZFSSnapshots() {
	for {
		time.Sleep(30 * time.Minute)
		if !zfsInstalled() {
			continue
		}
		for pool, a := range s.zfsSettings() {
			if a.Daily {
				s.autoSnapshot(pool, a.Keep)
			}
		}
	}
}

var autoSnapMu sync.Mutex

// autoSnapshot takes a daily snapshot if the newest is older than a day, then removes the
// oldest daily ones past keep. Only temanlabs-auto- snapshots are ever removed.
func (s *server) autoSnapshot(pool string, keep int) {
	autoSnapMu.Lock()
	defer autoSnapMu.Unlock()
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Minute)
	defer cancel()
	if ro, err := zfsOut(ctx, "zpool", "get", "-H", "-o", "value", "readonly", pool); err != nil || strings.TrimSpace(ro) != "off" {
		return
	}
	snaps, err := poolSnapshots(ctx, pool)
	if err != nil {
		return
	}
	var auto []zfsSnapshot
	for _, sn := range snaps {
		if sn.Auto {
			auto = append(auto, sn)
		}
	}
	if len(auto) == 0 || time.Since(auto[0].Created) > 23*time.Hour+30*time.Minute {
		name := autoSnapPrefix + time.Now().Format("20060102-1504")
		if _, err := zfsOut(ctx, "zfs", "snapshot", "-r", pool+"@"+name); err != nil {
			log.Printf("zfs: daily snapshot of %s: %v", pool, err)
			return
		}
		auto = append([]zfsSnapshot{{Name: name, Created: time.Now()}}, auto...)
	}
	for _, old := range auto[min(keep, len(auto)):] {
		if !autoSnapName.MatchString(old.Name) {
			continue
		}
		if _, err := zfsOut(ctx, "zfs", "destroy", "-r", pool+"@"+old.Name); err != nil {
			log.Printf("zfs: removing old snapshot %s@%s: %v", pool, old.Name, err)
		}
	}
}

var autoSnapName = regexp.MustCompile(`^` + autoSnapPrefix + `[0-9]{8}-[0-9]{4}$`)

// zfsPoolHealth is each imported pool's state (ONLINE, DEGRADED…), for the storage figures.
func zfsPoolHealth() map[string]string {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	out, err := exec.CommandContext(ctx, "zpool", "list", "-H", "-o", "name,health").Output()
	if err != nil {
		return nil
	}
	m := map[string]string{}
	for _, line := range strings.Split(strings.TrimSpace(string(out)), "\n") {
		if f := strings.Split(line, "\t"); len(f) == 2 {
			m[f[0]] = f[1]
		}
	}
	return m
}

// ----- TrueNAS apps -----

type trueNASApp struct {
	Name    string `json:"name"`
	Title   string `json:"title"`
	Icon    string `json:"icon,omitempty"`
	Version string `json:"version,omitempty"`
	// "compose": TrueNAS 24.10 and later (Docker), installable from its compose file;
	// "kubernetes": earlier TrueNAS SCALE, reinstalled from the App Center instead.
	Kind    string `json:"kind"`
	Compose string `json:"compose,omitempty"`
	Port    int    `json:"port,omitempty"`
	Scheme  string `json:"scheme,omitempty"`
	Path    string `json:"path,omitempty"`
	// Where its data is kept on the pool.
	Data string `json:"data,omitempty"`
	// Folders its compose file uses that aren't on this server.
	Missing []string `json:"missing"`
}

func (s *server) handleTrueNASApps(w http.ResponseWriter, r *http.Request) {
	pool, ok := s.knownPool(w, r)
	if !ok {
		return
	}
	apps := []trueNASApp{}
	for _, d := range listDatasets(r.Context(), pool) {
		if d.mounted != "yes" {
			continue
		}
		switch d.name {
		case pool + "/ix-apps":
			apps = append(apps, readIXApps(d.mount)...)
		case pool + "/ix-applications":
			entries, _ := os.ReadDir(filepath.Join(d.mount, "releases"))
			for _, e := range entries {
				if e.IsDir() {
					apps = append(apps, trueNASApp{
						Name: e.Name(), Title: prettify(e.Name()), Kind: "kubernetes",
						Data: filepath.Join(d.mount, "releases", e.Name(), "volumes"), Missing: []string{},
					})
				}
			}
		}
	}
	writeJSON(w, http.StatusOK, apps)
}

// readIXApps reads TrueNAS 24.10+ apps: app_configs/<app>/versions/<version>/templates/rendered/
// docker-compose.yaml is the compose file TrueNAS ran, with the app's details in metadata.yaml.
func readIXApps(root string) []trueNASApp {
	var apps []trueNASApp
	dirs, _ := os.ReadDir(filepath.Join(root, "app_configs"))
	for _, dir := range dirs {
		if !dir.IsDir() {
			continue
		}
		base := filepath.Join(root, "app_configs", dir.Name())
		composeFile, version := "", ""
		var newest time.Time
		versions, _ := os.ReadDir(filepath.Join(base, "versions"))
		for _, v := range versions {
			f := filepath.Join(base, "versions", v.Name(), "templates", "rendered", "docker-compose.yaml")
			if st, err := os.Stat(f); err == nil && st.ModTime().After(newest) {
				composeFile, version, newest = f, v.Name(), st.ModTime()
			}
		}
		if composeFile == "" {
			continue
		}
		data, err := os.ReadFile(composeFile)
		if err != nil || len(data) > 1<<20 {
			continue
		}
		app := trueNASApp{Name: dir.Name(), Title: prettify(dir.Name()), Version: version, Kind: "compose", Compose: string(data),
			Data: filepath.Join(root, "app_mounts", dir.Name()), Missing: []string{}}
		var meta struct {
			Metadata struct {
				Title string `yaml:"title"`
				Icon  string `yaml:"icon"`
			} `yaml:"metadata"`
		}
		if raw, err := os.ReadFile(filepath.Join(base, "metadata.yaml")); err == nil && yaml.Unmarshal(raw, &meta) == nil {
			if meta.Metadata.Title != "" {
				app.Title = meta.Metadata.Title
			}
			if strings.HasPrefix(meta.Metadata.Icon, "https://") {
				app.Icon = meta.Metadata.Icon
			}
		}
		var doc struct {
			Portals []struct {
				Scheme string `yaml:"scheme"`
				Port   any    `yaml:"port"`
				Path   string `yaml:"path"`
			} `yaml:"x-portals"`
		}
		if yaml.Unmarshal(data, &doc) == nil && len(doc.Portals) > 0 {
			p := doc.Portals[0]
			app.Port, _ = strconv.Atoi(fmt.Sprint(p.Port))
			app.Scheme, app.Path = p.Scheme, p.Path
		}
		if cd, err := parseComposeDoc(data); err == nil {
			for _, src := range cd.bindSources() {
				if _, err := os.Stat(src); err != nil && !slices.Contains(app.Missing, src) {
					app.Missing = append(app.Missing, src)
				}
			}
		}
		apps = append(apps, app)
	}
	return apps
}
