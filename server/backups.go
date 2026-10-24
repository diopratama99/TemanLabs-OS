package main

import (
	"bufio"
	"context"
	"crypto/rand"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
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
	"syscall"
	"time"
)

// Backups: plans that copy app settings and data, and chosen folders, to another disk or a
// cloud drive, by hand or on a schedule. restic does the work: each run stores only what
// changed, everything is encrypted with the server's recovery key, and older versions are
// thinned out to the number the plan keeps. Any version can be browsed and restored, to where
// it came from or into another folder.

const (
	backupLimit   = 24 * time.Hour
	resticCache   = "/var/cache/temanlabsos-restic"
	repoDirName   = "TemanLabsOS Backup"
	defaultKeep   = 14
	cloudDestPref = "rclone:"
)

type backupPlan struct {
	ID   string `json:"id"`
	Name string `json:"name"`
	// The settings and data of every Docker app (their compose folders and mounts).
	Apps bool `json:"apps"`
	// More folders to include.
	Paths []string `json:"paths"`
	// A folder ("/mnt/HDD_DATA/Backups") or a cloud drive ("rclone:GoogleDrive:Backups").
	Dest string `json:"dest"`
	// manual, daily or weekly, at Time (HH:MM, the server's time zone); weekly on Weekday (0 = Sunday).
	Schedule string `json:"schedule"`
	Time     string `json:"time"`
	Weekday  int    `json:"weekday"`
	// Versions to keep.
	Keep int `json:"keep"`
	// Pause the apps while their files are read, so databases are copied in one piece. Only
	// for disks: a cloud upload takes too long to keep apps waiting.
	PauseApps bool      `json:"pauseApps"`
	Created   time.Time `json:"created"`

	LastRun   *time.Time `json:"lastRun,omitempty"`
	LastOK    bool       `json:"lastOk"`
	LastError string     `json:"lastError,omitempty"`
	// Some files couldn't be read; the version has everything else.
	LastWarning string `json:"lastWarning,omitempty"`
	LastAdded   int64  `json:"lastAdded,omitempty"`
	LastTotal   int64  `json:"lastTotal,omitempty"`
	LastFiles   int    `json:"lastFiles,omitempty"`
}

type backupStore struct {
	mu    sync.Mutex
	file  string
	key   string
	rconf string
	Plans []*backupPlan `json:"plans"`
}

func newBackupStore(stateDir string) *backupStore {
	b := &backupStore{file: filepath.Join(stateDir, "backups.json"), key: filepath.Join(stateDir, "backup.key"), rconf: filepath.Join(stateDir, "rclone.conf")}
	if data, err := os.ReadFile(b.file); err == nil {
		_ = json.Unmarshal(data, b)
	}
	// Plans saved with no folders said null; the desktop wants a list.
	for _, p := range b.Plans {
		if p.Paths == nil {
			p.Paths = []string{}
		}
	}
	return b
}

// save writes the file; the caller holds mu.
func (b *backupStore) save() error {
	data, err := json.MarshalIndent(b, "", "  ")
	if err != nil {
		return err
	}
	tmp := b.file + ".tmp"
	if err := os.WriteFile(tmp, data, 0o600); err != nil {
		return err
	}
	return os.Rename(tmp, b.file)
}

func (b *backupStore) plan(id string) *backupPlan {
	b.mu.Lock()
	defer b.mu.Unlock()
	for _, p := range b.Plans {
		if p.ID == id {
			c := *p
			c.Paths = slices.Clone(p.Paths)
			return &c
		}
	}
	return nil
}

func (b *backupStore) update(id string, fn func(p *backupPlan)) {
	b.mu.Lock()
	defer b.mu.Unlock()
	for _, p := range b.Plans {
		if p.ID == id {
			fn(p)
			_ = b.save()
			return
		}
	}
}

// recoveryKey is the password every backup is encrypted with, made on first use. Without it
// the backups can't be read: it's shown in Backups to keep somewhere safe.
func (b *backupStore) recoveryKey() (string, error) {
	if data, err := os.ReadFile(b.key); err == nil && len(strings.TrimSpace(string(data))) > 0 {
		return strings.TrimSpace(string(data)), nil
	}
	raw := make([]byte, 24)
	_, _ = rand.Read(raw)
	key := base64.RawURLEncoding.EncodeToString(raw)
	return key, os.WriteFile(b.key, []byte(key+"\n"), 0o600)
}

func resticInstalled() bool {
	_, err := exec.LookPath("restic")
	return err == nil
}

func isCloudDest(dest string) bool { return strings.HasPrefix(dest, cloudDestPref) }

// repoOf is where the encrypted backup lives inside a destination.
func repoOf(dest string) string {
	if isCloudDest(dest) {
		return strings.TrimRight(dest, "/") + "/" + repoDirName
	}
	return filepath.Join(dest, repoDirName)
}

func (b *backupStore) restic(ctx context.Context, dest string, args ...string) (*exec.Cmd, error) {
	if _, err := b.recoveryKey(); err != nil {
		return nil, err
	}
	cmd := exec.CommandContext(ctx, "restic", args...)
	cmd.Env = append(os.Environ(),
		"RESTIC_REPOSITORY="+repoOf(dest), "RESTIC_PASSWORD_FILE="+b.key, "RESTIC_CACHE_DIR="+resticCache,
		"RCLONE_CONFIG="+b.rconf, "RESTIC_PROGRESS_FPS=0.5")
	// Stopping a backup lets restic save what it has.
	cmd.Cancel = func() error { return cmd.Process.Signal(syscall.SIGINT) }
	cmd.WaitDelay = 30 * time.Second
	return cmd, nil
}

// resticOutput runs restic and returns its output, with its own error message on failure.
func (b *backupStore) resticOutput(ctx context.Context, dest string, args ...string) ([]byte, error) {
	cmd, err := b.restic(ctx, dest, args...)
	if err != nil {
		return nil, err
	}
	var stderr strings.Builder
	cmd.Stderr = &stderr
	out, err := cmd.Output()
	if err != nil {
		if msg := strings.TrimSpace(lastLines(stderr.String(), 3)); msg != "" {
			return out, errors.New(msg)
		}
	}
	return out, err
}

// ensureRepo creates the encrypted backup at the destination if it isn't there yet.
func (b *backupStore) ensureRepo(ctx context.Context, dest string, logf func(string, ...any)) error {
	if _, err := b.resticOutput(ctx, dest, "cat", "config"); err == nil {
		return nil
	}
	if !isCloudDest(dest) {
		if err := os.MkdirAll(dest, 0o755); err != nil {
			return err
		}
	}
	logf("Setting up the backup at %s…", dest)
	_, err := b.resticOutput(ctx, dest, "init")
	return err
}

// ----- What "app settings and data" covers -----

// Never part of an app's backup: the system, and shared libraries (media, downloads, other
// disks), which are big and belong in a plan of their own.
var backupSkipUnder = []string{"/proc", "/sys", "/dev", "/run", "/var/run", "/usr", "/lib", "/lib64", "/bin", "/sbin", "/boot", "/etc", "/tmp", "/snap", "/mnt", "/media"}
var backupSkipExact = map[string]bool{"/": true, "/home": true, "/root": true, "/DATA": true, "/var": true, "/var/lib": true, "/var/lib/docker": true, "/srv": true, "/opt": true}

func appBackupPath(p string) bool {
	p = filepath.Clean(p)
	if backupSkipExact[p] {
		return false
	}
	for _, s := range backupSkipUnder {
		if p == s || strings.HasPrefix(p, s+"/") {
			return false
		}
	}
	// Under /DATA only the apps' own folder.
	if strings.HasPrefix(p, "/DATA/") && !strings.HasPrefix(p, "/DATA/AppData/") {
		return false
	}
	return true
}

// collapse drops paths inside others in the list.
func collapse(paths []string) []string {
	clean := make([]string, 0, len(paths))
	for _, p := range paths {
		clean = append(clean, filepath.Clean(p))
	}
	sort.Strings(clean)
	out := []string{}
	for _, p := range clean {
		if n := len(out); n > 0 && (p == out[n-1] || strings.HasPrefix(p, strings.TrimSuffix(out[n-1], "/")+"/")) {
			continue
		}
		out = append(out, p)
	}
	return out
}

type appBackup struct {
	ID    string   `json:"id"`
	Name  string   `json:"name"`
	Paths []string `json:"paths"`
	// Its containers, for pausing and stopping.
	containers []string
	running    bool
}

// appBackups lists each Docker app with the folders its settings and data are in.
func (s *server) appBackups(ctx context.Context) ([]appBackup, error) {
	apps, err := s.store.listApps(ctx)
	if err != nil {
		return nil, err
	}
	var out []appBackup
	for _, a := range apps {
		if a.Source == "native" || len(a.containers) == 0 {
			continue
		}
		ab := appBackup{ID: a.ID, Name: a.Name, running: a.Status == "running"}
		var paths []string
		if dir := a.containers[0].Labels[labelWorkingDir]; dir != "" {
			paths = append(paths, dir)
		}
		for _, c := range a.containers {
			ab.containers = append(ab.containers, c.ID)
			var info struct {
				Mounts []struct {
					Type   string `json:"Type"`
					Source string `json:"Source"`
				} `json:"Mounts"`
			}
			if s.docker.do(ctx, http.MethodGet, "/containers/"+c.ID+"/json", &info) != nil {
				continue
			}
			for _, m := range info.Mounts {
				if (m.Type == "bind" || m.Type == "volume") && m.Source != "" {
					paths = append(paths, m.Source)
				}
			}
		}
		for _, p := range collapse(paths) {
			if appBackupPath(p) {
				if _, err := os.Lstat(p); err == nil {
					ab.Paths = append(ab.Paths, p)
				}
			}
		}
		if len(ab.Paths) > 0 {
			out = append(out, ab)
		}
	}
	return out, nil
}

// ----- Running a backup -----

var restoreArg = regexp.MustCompile(`^[0-9a-f]{8,64}$|^latest$`)

func (s *server) startBackup(id string) error {
	p := s.backups.plan(id)
	if p == nil {
		return os.ErrNotExist
	}
	if !resticInstalled() {
		return errors.New("install the backup engine first")
	}
	_, err := startFuncJobFor("backup-"+id, "Backing up "+p.Name, backupLimit, func(ctx context.Context, logf func(string, ...any)) (err error) {
		started := time.Now()
		var warning string
		var summary resticSummary
		defer func() {
			s.backups.update(id, func(q *backupPlan) {
				q.LastRun, q.LastOK, q.LastError, q.LastWarning = &started, err == nil, "", warning
				if err != nil {
					q.LastError = err.Error()
					if errors.Is(ctx.Err(), context.Canceled) {
						q.LastError = "Stopped."
					}
					return
				}
				q.LastAdded, q.LastTotal, q.LastFiles = summary.DataAdded, summary.TotalBytes, summary.TotalFiles
			})
		}()
		if err := s.backups.ensureRepo(ctx, p.Dest, logf); err != nil {
			return err
		}
		paths, apps, err := s.backupSources(ctx, p)
		if err != nil {
			return err
		}
		if len(paths) == 0 {
			return errors.New("there's nothing to back up: choose apps or folders")
		}
		logf("Backing up %d folders to %s.", len(paths), p.Dest)
		if p.PauseApps && !isCloudDest(p.Dest) {
			resume := s.pauseApps(ctx, apps, logf)
			defer resume()
		}
		args := []string{"backup", "--json", "--tag", "plan:" + p.ID, "--host", hostLabel(), "--exclude-caches", "--exclude", trashDirName}
		if !isCloudDest(p.Dest) {
			args = append(args, "--exclude", repoOf(p.Dest))
		}
		summary, warning, err = s.runResticBackup(ctx, p.Dest, append(args, paths...), logf)
		if err != nil {
			return err
		}
		logf("Done: %s new of %s, %d files.", humanSize(summary.DataAdded), humanSize(summary.TotalBytes), summary.TotalFiles)
		keep := p.Keep
		if keep <= 0 {
			keep = defaultKeep
		}
		logf("Keeping the newest %d versions…", keep)
		if out, err := s.backups.resticOutput(ctx, p.Dest, "forget", "--tag", "plan:"+p.ID, "--group-by", "tags", "--keep-last", strconv.Itoa(keep), "--prune"); err != nil {
			// The backup itself is safe; tidying up can wait for the next run.
			logf("Couldn't remove old versions: %v", err)
		} else if n := strings.Count(string(out), "removed snapshot"); n > 0 {
			logf("Removed %d old versions.", n)
		}
		return nil
	})
	return err
}

// backupSources is every folder a plan covers, and the apps among them.
func (s *server) backupSources(ctx context.Context, p *backupPlan) ([]string, []appBackup, error) {
	var paths []string
	var apps []appBackup
	if p.Apps {
		var err error
		if apps, err = s.appBackups(ctx); err != nil {
			return nil, nil, err
		}
		for _, a := range apps {
			paths = append(paths, a.Paths...)
		}
	}
	for _, f := range p.Paths {
		if full, err := s.resolve(f); err == nil {
			if _, err := os.Stat(full); err == nil {
				paths = append(paths, full)
			}
		}
	}
	return collapse(paths), apps, nil
}

// pauseApps freezes the running apps' containers; the returned func thaws them.
func (s *server) pauseApps(ctx context.Context, apps []appBackup, logf func(string, ...any)) func() {
	var paused []string
	for _, a := range apps {
		if !a.running {
			continue
		}
		for _, id := range a.containers {
			if s.docker.send(ctx, http.MethodPost, "/containers/"+id+"/pause", nil, nil) == nil {
				paused = append(paused, id)
			}
		}
	}
	if len(paused) > 0 {
		logf("Paused %d containers while their files are copied.", len(paused))
	}
	return func() {
		// Thaw even if the backup was stopped.
		ctx, cancel := context.WithTimeout(context.Background(), time.Minute)
		defer cancel()
		for _, id := range paused {
			_ = s.docker.send(ctx, http.MethodPost, "/containers/"+id+"/unpause", nil, nil)
		}
		if len(paused) > 0 {
			logf("Apps resumed.")
		}
	}
}

type resticSummary struct {
	DataAdded  int64 `json:"data_added"`
	TotalBytes int64 `json:"total_bytes_processed"`
	TotalFiles int   `json:"total_files_processed"`
}

// runResticBackup runs `restic backup --json`, turning its progress into a few log lines.
func (s *server) runResticBackup(ctx context.Context, dest string, args []string, logf func(string, ...any)) (resticSummary, string, error) {
	var sum resticSummary
	cmd, err := s.backups.restic(ctx, dest, args...)
	if err != nil {
		return sum, "", err
	}
	stdout, _ := cmd.StdoutPipe()
	var stderr strings.Builder
	cmd.Stderr = &stderr
	if err := cmd.Start(); err != nil {
		return sum, "", err
	}
	unreadable := 0
	lastStep := -1
	var lastAt time.Time
	var lastDone int64
	sc := bufio.NewScanner(stdout)
	sc.Buffer(make([]byte, 64<<10), 4<<20)
	for sc.Scan() {
		var m struct {
			Type    string  `json:"message_type"`
			Percent float64 `json:"percent_done"`
			Total   int64   `json:"total_bytes"`
			Done    int64   `json:"bytes_done"`
			Item    string  `json:"item"`
			Error   struct {
				Message string `json:"message"`
			} `json:"error"`
		}
		line := sc.Bytes()
		if json.Unmarshal(line, &m) != nil {
			continue
		}
		switch m.Type {
		case "status":
			// Every percent, and every few seconds while bytes move (a cloud upload is slow).
			step := int(m.Percent * 100)
			if m.Total > 0 && (step > lastStep || (m.Done != lastDone && time.Since(lastAt) > 5*time.Second)) {
				lastStep, lastAt, lastDone = step, time.Now(), m.Done
				logf("%d%% · %s of %s", step, humanSize(m.Done), humanSize(m.Total))
			}
		case "error":
			unreadable++
			if unreadable <= 20 {
				logf("Couldn't read %s: %s", m.Item, m.Error.Message)
			}
		case "summary":
			_ = json.Unmarshal(line, &sum)
		}
	}
	err = cmd.Wait()
	// Exit 3: the version was saved without some files that couldn't be read.
	var exit *exec.ExitError
	if errors.As(err, &exit) && exit.ExitCode() == 3 {
		return sum, fmt.Sprintf("%d files couldn't be read and were left out.", unreadable), nil
	}
	if err != nil {
		if msg := strings.TrimSpace(lastLines(stderr.String(), 3)); msg != "" {
			return sum, "", errors.New(msg)
		}
		return sum, "", err
	}
	return sum, "", nil
}

// ----- Schedule -----

func clockOf(p *backupPlan) (int, int) {
	h, m := 3, 0
	if t, err := time.Parse("15:04", p.Time); err == nil {
		h, m = t.Hour(), t.Minute()
	}
	return h, m
}

// lastDue is the most recent time the schedule said to run, at or before now.
func lastDue(p *backupPlan, now time.Time) time.Time {
	if p.Schedule != "daily" && p.Schedule != "weekly" {
		return time.Time{}
	}
	h, m := clockOf(p)
	due := time.Date(now.Year(), now.Month(), now.Day(), h, m, 0, 0, now.Location())
	if due.After(now) {
		due = due.AddDate(0, 0, -1)
	}
	if p.Schedule == "weekly" {
		for int(due.Weekday()) != p.Weekday {
			due = due.AddDate(0, 0, -1)
		}
	}
	return due
}

func nextDue(p *backupPlan, now time.Time) time.Time {
	last := lastDue(p, now)
	if last.IsZero() {
		return last
	}
	if p.Schedule == "weekly" {
		return last.AddDate(0, 0, 7)
	}
	return last.AddDate(0, 0, 1)
}

// runSchedule starts plans when they're due, and catches up on a run missed while the server
// was off (within a day of it).
func (s *server) runSchedule() {
	for {
		time.Sleep(30 * time.Second)
		if !resticInstalled() {
			continue
		}
		now := time.Now()
		s.backups.mu.Lock()
		var due []string
		for _, p := range s.backups.Plans {
			d := lastDue(p, now)
			if d.IsZero() || p.Created.After(d) || now.Sub(d) > 20*time.Hour {
				continue
			}
			if p.LastRun == nil || p.LastRun.Before(d) {
				due = append(due, p.ID)
			}
		}
		s.backups.mu.Unlock()
		for _, id := range due {
			if !jobRunning("backup-"+id) && !jobRunning("restore-"+id) {
				_ = s.startBackup(id)
			}
		}
	}
}

// ----- HTTP -----

type backupPlanView struct {
	backupPlan
	Running  bool       `json:"running"`
	NextRun  *time.Time `json:"nextRun,omitempty"`
	DestFree uint64     `json:"destFree,omitempty"`
	// The destination is on the same disk as the apps' data: no help if that disk fails.
	SameDisk bool `json:"sameDisk,omitempty"`
}

func (s *server) planView(p *backupPlan) backupPlanView {
	v := backupPlanView{backupPlan: *p, Running: jobRunning("backup-"+p.ID) || jobRunning("restore-"+p.ID)}
	if n := nextDue(p, time.Now()); !n.IsZero() {
		v.NextRun = &n
	}
	if !isCloudDest(p.Dest) {
		dir := p.Dest
		for dir != "/" {
			if _, err := os.Stat(dir); err == nil {
				break
			}
			dir = filepath.Dir(dir)
		}
		var st syscall.Statfs_t
		if syscall.Statfs(dir, &st) == nil {
			v.DestFree = st.Bavail * uint64(st.Bsize)
		}
		mounts := mountPoints()
		real, err := filepath.EvalSymlinks(dir)
		if err != nil {
			real = dir
		}
		data, err := filepath.EvalSymlinks(filepath.Join(appDataRoot, "AppData"))
		if err != nil {
			data = "/"
		}
		v.SameDisk = mountOf(real, mounts) == mountOf(data, mounts)
	}
	return v
}

func (s *server) handleBackups(w http.ResponseWriter, r *http.Request) {
	s.backups.mu.Lock()
	plans := make([]*backupPlan, len(s.backups.Plans))
	copy(plans, s.backups.Plans)
	s.backups.mu.Unlock()
	views := []backupPlanView{}
	for _, p := range plans {
		views = append(views, s.planView(p))
	}
	writeJSON(w, http.StatusOK, map[string]any{"installed": resticInstalled(), "installing": jobRunning("apt"), "plans": views})
}

func (s *server) handleInstallRestic(w http.ResponseWriter, r *http.Request) {
	if _, err := startJob("apt", "Installing the backup engine (restic)", []string{"DEBIAN_FRONTEND=noninteractive"}, nil, "apt-get", "install", "-y", "restic"); err != nil {
		writeError(w, http.StatusConflict, err.Error())
		return
	}
	writeJSON(w, http.StatusAccepted, map[string]string{"job": "apt"})
}

func (s *server) handleRecoveryKey(w http.ResponseWriter, r *http.Request) {
	key, err := s.backups.recoveryKey()
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"key": key})
}

// handleSetRecoveryKey puts back the key of backups made before (a reinstalled server), so they
// can be read again.
func (s *server) handleSetRecoveryKey(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Key string `json:"key"`
	}
	if decodeJSON(r, &body) != nil || len(strings.TrimSpace(body.Key)) < 8 {
		writeError(w, http.StatusBadRequest, "enter the recovery key")
		return
	}
	if err := os.WriteFile(s.backups.key, []byte(strings.TrimSpace(body.Key)+"\n"), 0o600); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// handleBackupDestinations suggests where backups can go: other disks, and cloud drives.
func (s *server) handleBackupDestinations(w http.ResponseWriter, r *http.Request) {
	type dest struct {
		Label string `json:"label"`
		Dest  string `json:"dest"`
		Cloud bool   `json:"cloud,omitempty"`
		Free  uint64 `json:"free,omitempty"`
	}
	out := []dest{}
	seen := map[string]bool{}
	for _, m := range mountPoints() {
		if !(strings.HasPrefix(m, "/mnt/") || strings.HasPrefix(m, "/media/")) || seen[m] {
			continue
		}
		seen[m] = true
		var st syscall.Statfs_t
		if syscall.Statfs(m, &st) != nil || st.Blocks == 0 {
			continue
		}
		out = append(out, dest{Label: filepath.Base(m), Dest: filepath.Join(m, "Backups"), Free: st.Bavail * uint64(st.Bsize)})
	}
	if outB, err := exec.CommandContext(r.Context(), "rclone", "listremotes", "--config", s.backups.rconf).Output(); err == nil {
		for _, name := range strings.Fields(string(outB)) {
			name = strings.TrimSuffix(name, ":")
			out = append(out, dest{Label: name, Dest: cloudDestPref + name + ":Backups", Cloud: true})
		}
	}
	writeJSON(w, http.StatusOK, out)
}

func (s *server) handleBackupApps(w http.ResponseWriter, r *http.Request) {
	apps, err := s.appBackups(r.Context())
	if err != nil {
		writeError(w, http.StatusBadGateway, err.Error())
		return
	}
	if apps == nil {
		apps = []appBackup{}
	}
	writeJSON(w, http.StatusOK, apps)
}

var destCloud = regexp.MustCompile(`^rclone:[A-Za-z0-9_. -]+:[^\x00]*$`)

func (s *server) planFromBody(r *http.Request, p *backupPlan) error {
	var body backupPlan
	if decodeJSON(r, &body) != nil {
		return errors.New("invalid request")
	}
	body.Name = strings.TrimSpace(body.Name)
	if body.Name == "" {
		return errors.New("give the backup a name")
	}
	body.Dest = strings.TrimSpace(body.Dest)
	switch {
	case isCloudDest(body.Dest):
		if !destCloud.MatchString(body.Dest) {
			return errors.New("choose a cloud drive and a folder on it")
		}
	case strings.HasPrefix(body.Dest, "/"):
		body.Dest = filepath.Clean(body.Dest)
		if body.Dest == "/" {
			return errors.New("choose a folder for the backups")
		}
	default:
		return errors.New("choose where the backups go")
	}
	if !body.Apps && len(body.Paths) == 0 {
		return errors.New("choose apps or folders to back up")
	}
	for i, f := range body.Paths {
		full, err := s.resolve(f)
		if err != nil {
			return err
		}
		if !isCloudDest(body.Dest) && (full == body.Dest || strings.HasPrefix(body.Dest, full+"/")) {
			return fmt.Errorf("the backups can't go inside %s, which they back up", full)
		}
		body.Paths[i] = full
	}
	if body.Schedule != "daily" && body.Schedule != "weekly" {
		body.Schedule = "manual"
	}
	if _, err := time.Parse("15:04", body.Time); err != nil {
		body.Time = "03:00"
	}
	body.Weekday = ((body.Weekday % 7) + 7) % 7
	if body.Keep <= 0 || body.Keep > 1000 {
		body.Keep = defaultKeep
	}
	p.Name, p.Apps, p.Paths, p.Dest, p.Schedule, p.Time, p.Weekday, p.Keep, p.PauseApps =
		body.Name, body.Apps, collapse(body.Paths), body.Dest, body.Schedule, body.Time, body.Weekday, body.Keep, body.PauseApps
	return nil
}

func (s *server) handleCreateBackup(w http.ResponseWriter, r *http.Request) {
	b := make([]byte, 6)
	_, _ = rand.Read(b)
	p := &backupPlan{ID: hex.EncodeToString(b), Created: time.Now()}
	if err := s.planFromBody(r, p); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	s.backups.mu.Lock()
	s.backups.Plans = append(s.backups.Plans, p)
	err := s.backups.save()
	s.backups.mu.Unlock()
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusCreated, s.planView(p))
}

func (s *server) handleUpdateBackup(w http.ResponseWriter, r *http.Request) {
	p := s.backups.plan(r.PathValue("id"))
	if p == nil {
		writeError(w, http.StatusNotFound, "no such backup")
		return
	}
	if err := s.planFromBody(r, p); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	s.backups.update(p.ID, func(q *backupPlan) { *q = *p })
	writeJSON(w, http.StatusOK, s.planView(p))
}

// handleDeleteBackup forgets a plan; what it stored stays at the destination.
func (s *server) handleDeleteBackup(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	if jobRunning("backup-"+id) || jobRunning("restore-"+id) {
		writeError(w, http.StatusConflict, "wait for it to finish, or stop it")
		return
	}
	s.backups.mu.Lock()
	s.backups.Plans = slices.DeleteFunc(s.backups.Plans, func(p *backupPlan) bool { return p.ID == id })
	err := s.backups.save()
	s.backups.mu.Unlock()
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *server) handleRunBackup(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	if jobRunning("restore-" + id) {
		writeError(w, http.StatusConflict, "a restore from it is running")
		return
	}
	if err := s.startBackup(id); err != nil {
		writeError(w, http.StatusConflict, err.Error())
		return
	}
	writeJSON(w, http.StatusAccepted, map[string]string{"job": "backup-" + id})
}

func (s *server) handleStopBackup(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	if !cancelJob("backup-"+id) && !cancelJob("restore-"+id) {
		writeError(w, http.StatusConflict, "it isn't running")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

type backupVersion struct {
	ID    string    `json:"id"`
	Time  time.Time `json:"time"`
	Paths []string  `json:"paths"`
	Host  string    `json:"host"`
	// Made by this plan (others in the same place: other plans, another server).
	Mine bool `json:"mine"`
}

// handleBackupVersions lists the versions stored at a plan's destination, newest first.
func (s *server) handleBackupVersions(w http.ResponseWriter, r *http.Request) {
	p := s.backups.plan(r.PathValue("id"))
	if p == nil {
		writeError(w, http.StatusNotFound, "no such backup")
		return
	}
	if !resticInstalled() {
		writeJSON(w, http.StatusOK, []backupVersion{})
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 2*time.Minute)
	defer cancel()
	out, err := s.backups.resticOutput(ctx, p.Dest, "snapshots", "--json", "--no-lock")
	if err != nil {
		if strings.Contains(err.Error(), "does not exist") || strings.Contains(err.Error(), "no such file") {
			writeJSON(w, http.StatusOK, []backupVersion{})
			return
		}
		writeError(w, http.StatusBadGateway, err.Error())
		return
	}
	var snaps []struct {
		ID       string    `json:"id"`
		Time     time.Time `json:"time"`
		Paths    []string  `json:"paths"`
		Hostname string    `json:"hostname"`
		Tags     []string  `json:"tags"`
	}
	_ = json.Unmarshal(out, &snaps)
	versions := []backupVersion{}
	for _, sn := range snaps {
		if sn.Paths == nil {
			sn.Paths = []string{}
		}
		versions = append(versions, backupVersion{ID: sn.ID, Time: sn.Time, Paths: sn.Paths, Host: sn.Hostname, Mine: slices.Contains(sn.Tags, "plan:"+p.ID)})
	}
	sort.Slice(versions, func(i, j int) bool { return versions[i].Time.After(versions[j].Time) })
	writeJSON(w, http.StatusOK, versions)
}

type versionEntry struct {
	Name     string    `json:"name"`
	Path     string    `json:"path"`
	Folder   bool      `json:"folder"`
	Size     int64     `json:"size,omitempty"`
	Modified time.Time `json:"modified"`
}

// handleVersionFiles lists one folder of a version (its top level: the folders it backed up).
func (s *server) handleVersionFiles(w http.ResponseWriter, r *http.Request) {
	p := s.backups.plan(r.PathValue("id"))
	version := r.PathValue("version")
	if p == nil || !restoreArg.MatchString(version) {
		writeError(w, http.StatusNotFound, "no such version")
		return
	}
	dir := r.URL.Query().Get("path")
	ctx, cancel := context.WithTimeout(r.Context(), 2*time.Minute)
	defer cancel()
	args := []string{"ls", "--json", "--no-lock", version}
	if dir != "" {
		args = append(args, filepath.Clean("/"+dir))
	}
	cmd, err := s.backups.restic(ctx, p.Dest, args...)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	stdout, _ := cmd.StdoutPipe()
	if err := cmd.Start(); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	entries := []versionEntry{}
	var roots []string
	sc := bufio.NewScanner(stdout)
	sc.Buffer(make([]byte, 64<<10), 4<<20)
	for sc.Scan() {
		var n struct {
			Struct string    `json:"struct_type"`
			Name   string    `json:"name"`
			Type   string    `json:"type"`
			Path   string    `json:"path"`
			Size   int64     `json:"size"`
			Mtime  time.Time `json:"mtime"`
			Paths  []string  `json:"paths"`
		}
		if json.Unmarshal(sc.Bytes(), &n) != nil {
			continue
		}
		if n.Struct == "snapshot" {
			roots = n.Paths
			if dir == "" {
				break
			}
			continue
		}
		if n.Struct != "node" || dir == "" {
			continue
		}
		if filepath.Dir(n.Path) != filepath.Clean("/"+dir) {
			continue
		}
		entries = append(entries, versionEntry{Name: n.Name, Path: n.Path, Folder: n.Type == "dir", Size: n.Size, Modified: n.Mtime})
	}
	// Listing the whole version only to show its top folders would read everything; restic
	// is stopped once the snapshot line (with its paths) has arrived.
	if dir == "" {
		_ = cmd.Process.Kill()
	}
	_, _ = io.Copy(io.Discard, stdout)
	_ = cmd.Wait()
	if dir == "" {
		for _, p := range roots {
			entries = append(entries, versionEntry{Name: p, Path: p, Folder: true})
		}
	}
	sort.Slice(entries, func(i, j int) bool {
		if entries[i].Folder != entries[j].Folder {
			return entries[i].Folder
		}
		return strings.ToLower(entries[i].Name) < strings.ToLower(entries[j].Name)
	})
	writeJSON(w, http.StatusOK, entries)
}

// handleRestore puts files back from a version: to where they came from (stopping the apps they
// belong to meanwhile), or into another folder.
func (s *server) handleRestore(w http.ResponseWriter, r *http.Request) {
	p := s.backups.plan(r.PathValue("id"))
	var body struct {
		Version string   `json:"version"`
		Paths   []string `json:"paths"`
		To      string   `json:"to"`
	}
	if p == nil || decodeJSON(r, &body) != nil || !restoreArg.MatchString(body.Version) || len(body.Paths) == 0 {
		writeError(w, http.StatusBadRequest, "choose a version and what to restore")
		return
	}
	for i, x := range body.Paths {
		if !strings.HasPrefix(x, "/") {
			writeError(w, http.StatusBadRequest, "invalid path")
			return
		}
		body.Paths[i] = filepath.Clean(x)
	}
	target := "/"
	if body.To != "" {
		var err error
		if target, err = s.resolve(body.To); err != nil {
			writeFSError(w, err)
			return
		}
	}
	if jobRunning("backup-" + p.ID) {
		writeError(w, http.StatusConflict, "a backup is running; wait for it or stop it")
		return
	}
	kind := "restore-" + p.ID
	_, err := startFuncJobFor(kind, "Restoring from "+p.Name, backupLimit, func(ctx context.Context, logf func(string, ...any)) error {
		var stopped []appBackup
		if target == "/" {
			// Apps whose files come back are stopped meanwhile, and started again after.
			apps, _ := s.appBackups(ctx)
			for _, a := range apps {
				if a.running && overlaps(a.Paths, body.Paths) {
					logf("Stopping %s…", a.Name)
					for _, id := range a.containers {
						_ = s.docker.stopContainer(ctx, id)
					}
					stopped = append(stopped, a)
				}
			}
			defer func() {
				bg, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
				defer cancel()
				for _, a := range stopped {
					logf("Starting %s…", a.Name)
					for _, id := range a.containers {
						_ = s.docker.startContainer(bg, id)
					}
				}
			}()
		} else if err := os.MkdirAll(target, 0o755); err != nil {
			return err
		}
		args := []string{"restore", body.Version, "--target", target}
		for _, x := range body.Paths {
			args = append(args, "--include", x)
		}
		logf("Restoring %d item(s) to %s…", len(body.Paths), map[bool]string{true: "where they came from", false: target}[target == "/"])
		out, err := s.backups.resticOutput(ctx, p.Dest, args...)
		for _, line := range strings.Split(strings.TrimSpace(string(out)), "\n") {
			if line != "" {
				logf("%s", line)
			}
		}
		if err != nil {
			return err
		}
		logf("Restored.")
		return nil
	})
	if err != nil {
		writeError(w, http.StatusConflict, err.Error())
		return
	}
	writeJSON(w, http.StatusAccepted, map[string]string{"job": kind})
}

// overlaps: some path in a is inside one in b, or the other way round.
func overlaps(a, b []string) bool {
	for _, x := range a {
		for _, y := range b {
			if x == y || strings.HasPrefix(x, y+"/") || strings.HasPrefix(y, x+"/") {
				return true
			}
		}
	}
	return false
}
