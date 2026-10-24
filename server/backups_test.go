package main

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"slices"
	"strings"
	"testing"
	"time"
)

func TestScheduleDue(t *testing.T) {
	loc := time.Local
	now := time.Date(2026, 10, 25, 10, 0, 0, 0, loc) // a Sunday
	daily := &backupPlan{Schedule: "daily", Time: "03:00"}
	if got := lastDue(daily, now); !got.Equal(time.Date(2026, 10, 25, 3, 0, 0, 0, loc)) {
		t.Fatalf("daily last = %v", got)
	}
	if got := nextDue(daily, now); !got.Equal(time.Date(2026, 10, 26, 3, 0, 0, 0, loc)) {
		t.Fatalf("daily next = %v", got)
	}
	late := &backupPlan{Schedule: "daily", Time: "22:30"}
	if got := lastDue(late, now); !got.Equal(time.Date(2026, 10, 24, 22, 30, 0, 0, loc)) {
		t.Fatalf("later today counts from yesterday: %v", got)
	}
	weekly := &backupPlan{Schedule: "weekly", Time: "03:00", Weekday: 3} // Wednesday
	if got := lastDue(weekly, now); !got.Equal(time.Date(2026, 10, 21, 3, 0, 0, 0, loc)) {
		t.Fatalf("weekly last = %v", got)
	}
	if got := nextDue(weekly, now); !got.Equal(time.Date(2026, 10, 28, 3, 0, 0, 0, loc)) {
		t.Fatalf("weekly next = %v", got)
	}
	if !lastDue(&backupPlan{Schedule: "manual"}, now).IsZero() {
		t.Fatal("manual plans have no schedule")
	}
}

func TestAppBackupPaths(t *testing.T) {
	keep := []string{"/DATA/AppData/jellyfin", "/home/leykopin/supabase/docker", "/var/lib/docker/volumes/x/_data"}
	skip := []string{"/", "/DATA", "/DATA/Media", "/DATA/Downloads/tv", "/etc/localtime", "/var/run/docker.sock", "/mnt/HDD_DATA/movies", "/home", "/proc"}
	for _, p := range keep {
		if !appBackupPath(p) {
			t.Errorf("%s left out", p)
		}
	}
	for _, p := range skip {
		if appBackupPath(p) {
			t.Errorf("%s included", p)
		}
	}
	got := collapse([]string{"/a/b/c", "/a/b", "/a/bc", "/z", "/a/b/"})
	if strings.Join(got, ",") != "/a/b,/a/bc,/z" {
		t.Fatalf("collapse = %v", got)
	}
	if !overlaps([]string{"/DATA/AppData/n8n"}, []string{"/DATA/AppData"}) || overlaps([]string{"/DATA/AppData/n8n"}, []string{"/DATA/AppData/n8"}) {
		t.Fatal("overlaps")
	}
}

func TestPlanValidation(t *testing.T) {
	s := &server{cfg: &Config{Root: "/", StateDir: t.TempDir()}}
	cases := map[string]map[string]any{
		"no name":          {"name": " ", "apps": true, "dest": "/mnt/x"},
		"no dest":          {"name": "a", "apps": true, "dest": ""},
		"nothing":          {"name": "a", "dest": "/mnt/x"},
		"inside source":    {"name": "a", "paths": []string{"/DATA"}, "dest": "/DATA/Backups"},
		"bad cloud":        {"name": "a", "apps": true, "dest": "rclone:"},
		"relative folders": {"name": "a", "paths": []string{"DATA"}, "dest": "/mnt/x"},
	}
	for name, body := range cases {
		w := call(t, func(w http.ResponseWriter, r *http.Request) {
			if err := s.planFromBody(r, &backupPlan{}); err != nil {
				writeError(w, http.StatusBadRequest, err.Error())
			}
		}, "POST", "/", body)
		if w.Code != http.StatusBadRequest {
			t.Errorf("%s: accepted", name)
		}
	}
	p := &backupPlan{}
	w := call(t, func(w http.ResponseWriter, r *http.Request) {
		if err := s.planFromBody(r, p); err != nil {
			writeError(w, http.StatusBadRequest, err.Error())
		}
	}, "POST", "/", map[string]any{"name": "Apps", "apps": true, "dest": "rclone:GoogleDrive:Backups", "schedule": "hourly", "time": "25:00", "keep": -1, "weekday": 9})
	if w.Code != 200 || p.Schedule != "manual" || p.Time != "03:00" || p.Keep != defaultKeep || p.Weekday != 2 {
		t.Fatalf("defaults: %d %+v", w.Code, p)
	}
}

// TestBackupRoundTrip backs a folder up with restic, changes it, backs up again, thins to one
// version and restores into another folder. Needs restic on the PATH.
func TestBackupRoundTrip(t *testing.T) {
	if _, err := exec.LookPath("restic"); err != nil {
		t.Skip("restic not installed")
	}
	state := t.TempDir()
	s := &server{cfg: &Config{Root: "/", StateDir: state}, backups: newBackupStore(state)}
	src := t.TempDir()
	dest := filepath.Join(t.TempDir(), "Backups")
	_ = os.MkdirAll(filepath.Join(src, "db"), 0o755)
	_ = os.WriteFile(filepath.Join(src, "db", "data.sql"), []byte("version one"), 0o644)
	_ = os.WriteFile(filepath.Join(src, "notes.txt"), []byte("keep me"), 0o644)
	p := &backupPlan{ID: "plan1", Name: "Test", Paths: []string{src}, Dest: dest, Keep: 1, Created: time.Now()}
	s.backups.Plans = []*backupPlan{p}

	run := func() {
		t.Helper()
		if err := s.startBackup("plan1"); err != nil {
			t.Fatal(err)
		}
		for deadline := time.Now().Add(2 * time.Minute); jobRunning("backup-plan1"); {
			if time.Now().After(deadline) {
				t.Fatal("backup took too long")
			}
			time.Sleep(200 * time.Millisecond)
		}
		if q := s.backups.plan("plan1"); !q.LastOK {
			jobs.Lock()
			log := jobs.byKind["backup-plan1"].snapshot().Log
			jobs.Unlock()
			t.Fatalf("backup failed: %s\n%s", q.LastError, strings.Join(log, "\n"))
		}
	}
	run()
	_ = os.WriteFile(filepath.Join(src, "db", "data.sql"), []byte("version two"), 0o644)
	run()

	versions := func() []backupVersion {
		t.Helper()
		r := httptest.NewRequest("GET", "/", nil)
		r.SetPathValue("id", "plan1")
		w := httptest.NewRecorder()
		s.handleBackupVersions(w, r)
		var v []backupVersion
		_ = json.Unmarshal(w.Body.Bytes(), &v)
		return v
	}
	v := versions()
	if len(v) != 1 || !v[0].Mine || !slices.Contains(v[0].Paths, src) {
		t.Fatalf("versions after keeping one: %+v", v)
	}

	// Browse: the top level is the backed-up folder, then its contents.
	r := httptest.NewRequest("GET", "/?path="+src, nil)
	r.SetPathValue("id", "plan1")
	r.SetPathValue("version", v[0].ID)
	w := httptest.NewRecorder()
	s.handleVersionFiles(w, r)
	var files []versionEntry
	_ = json.Unmarshal(w.Body.Bytes(), &files)
	if len(files) != 2 || files[0].Name != "db" || !files[0].Folder || files[1].Name != "notes.txt" {
		t.Fatalf("files: %s", w.Body)
	}

	// Restore one file into another folder.
	to := t.TempDir()
	rr := httptest.NewRequest("POST", "/", strings.NewReader(`{"version":"`+v[0].ID+`","paths":["`+filepath.Join(src, "db")+`"],"to":"`+to+`"}`))
	rr.SetPathValue("id", "plan1")
	w = httptest.NewRecorder()
	s.handleRestore(w, rr)
	if w.Code != http.StatusAccepted {
		t.Fatalf("restore: %d %s", w.Code, w.Body)
	}
	for jobRunning("restore-plan1") {
		time.Sleep(100 * time.Millisecond)
	}
	got, err := os.ReadFile(filepath.Join(to, src, "db", "data.sql"))
	if err != nil || string(got) != "version two" {
		jobs.Lock()
		log := jobs.byKind["restore-plan1"].snapshot().Log
		jobs.Unlock()
		t.Fatalf("restored %q, %v\n%s", got, err, strings.Join(log, "\n"))
	}
	if _, err := os.Stat(filepath.Join(to, src, "notes.txt")); err == nil {
		t.Fatal("restored more than asked")
	}
	// The data is encrypted: the source text isn't in the repository.
	_ = filepath.Walk(repoOf(dest), func(path string, info os.FileInfo, err error) error {
		if err == nil && !info.IsDir() {
			if data, _ := os.ReadFile(path); strings.Contains(string(data), "version two") {
				t.Fatalf("plain text in %s", path)
			}
		}
		return nil
	})
}

// A plan saved with no extra folders said "paths": null, which crashed the page; it's read
// back as an empty list.
func TestPlanNullPaths(t *testing.T) {
	dir := t.TempDir()
	_ = os.WriteFile(filepath.Join(dir, "backups.json"), []byte(`{"plans":[{"id":"x","name":"App","apps":true,"paths":null,"dest":"/mnt/x"}]}`), 0o600)
	b := newBackupStore(dir)
	data, _ := json.Marshal(b.Plans[0])
	if !strings.Contains(string(data), `"paths":[]`) {
		t.Fatalf("paths: %s", data)
	}
	if got, _ := json.Marshal(collapse(nil)); string(got) != "[]" {
		t.Fatalf("collapse(nil) = %s", got)
	}
}

// A job that has just started has written nothing; its log is an empty list, not null (the
// page reads the last line).
func TestEmptyJobLogIsList(t *testing.T) {
	j := &job{Kind: "x", Running: true}
	data, _ := json.Marshal(j.snapshot())
	if !strings.Contains(string(data), `"log":[]`) {
		t.Fatalf("%s", data)
	}
}
