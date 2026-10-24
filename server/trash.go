package main

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"time"
)

// Trash: deleting in Files moves things here first. Each filesystem keeps its own trash, at its
// mount point (or in the state folder, for the filesystem that holds it), so moving there is a
// rename: instant even for a big folder, and nothing is copied between disks. Items go for good
// after trashKeep.

const (
	trashDirName = ".Trash-temanlabs"
	trashKeep    = 30 * 24 * time.Hour
)

var trashID = regexp.MustCompile(`^[0-9a-f]{16}$`)

// trashInfo is kept beside each item: what it was called and where it came from.
type trashInfo struct {
	Name    string    `json:"name"`
	From    string    `json:"from"`
	Deleted time.Time `json:"deleted"`
}

type trashItem struct {
	ID      string `json:"id"`
	Name    string `json:"name"`
	From    string `json:"from"`
	Deleted string `json:"deleted"`
	Kind    string `json:"kind"`
	Size    int64  `json:"size,omitempty"`
}

// mountPoints lists where filesystems are mounted, longest first, so the first one that
// contains a path is its own (bind mounts count: a rename can't cross them either).
func mountPoints() []string {
	data, err := os.ReadFile("/proc/self/mountinfo")
	if err != nil {
		return []string{"/"}
	}
	unescape := strings.NewReplacer(`\040`, " ", `\011`, "\t", `\012`, "\n", `\134`, `\`)
	var out []string
	for _, line := range strings.Split(string(data), "\n") {
		if f := strings.Fields(line); len(f) > 4 {
			out = append(out, unescape.Replace(f[4]))
		}
	}
	sort.Slice(out, func(i, j int) bool { return len(out[i]) > len(out[j]) })
	return out
}

func mountOf(path string, mounts []string) string {
	for _, m := range mounts {
		if m == "/" || path == m || strings.HasPrefix(path, m+"/") {
			return m
		}
	}
	return "/"
}

// stateTrash is the trash in the state folder, used for the filesystem the state folder is on.
func (s *server) stateTrash() string {
	state, err := filepath.EvalSymlinks(s.cfg.StateDir)
	if err != nil {
		state = s.cfg.StateDir
	}
	return filepath.Join(state, "trash")
}

// trashFor is the trash for something at real (a path with symlinks resolved).
func (s *server) trashFor(real string, mounts []string) string {
	mp := mountOf(real, mounts)
	if st := s.stateTrash(); mountOf(st, mounts) == mp {
		return st
	}
	return filepath.Join(mp, trashDirName)
}

// trashDirs lists every trash that has been used.
func (s *server) trashDirs() []string {
	var out []string
	seen := map[string]bool{}
	add := func(d string) {
		if seen[d] {
			return
		}
		seen[d] = true
		if st, err := os.Stat(filepath.Join(d, "info")); err == nil && st.IsDir() {
			out = append(out, d)
		}
	}
	add(s.stateTrash())
	for _, m := range mountPoints() {
		add(filepath.Join(m, trashDirName))
	}
	return out
}

// moveToTrash moves full (a client path) to its filesystem's trash.
func (s *server) moveToTrash(full string) error {
	if err := s.checkModifiable(full); err != nil {
		return err
	}
	parent, err := filepath.EvalSymlinks(filepath.Dir(full))
	if err != nil {
		return err
	}
	real := filepath.Join(parent, filepath.Base(full))
	if _, err := os.Lstat(real); err != nil {
		return err
	}
	dir := s.trashFor(real, mountPoints())
	if real == dir || strings.HasPrefix(real, dir+"/") || strings.HasPrefix(dir, real+"/") {
		return errors.New("the Trash itself can't be moved to the Trash")
	}
	for _, sub := range []string{"files", "info"} {
		if err := os.MkdirAll(filepath.Join(dir, sub), 0o700); err != nil {
			return err
		}
	}
	b := make([]byte, 8)
	_, _ = rand.Read(b)
	id := hex.EncodeToString(b)
	data, _ := json.Marshal(trashInfo{Name: filepath.Base(full), From: filepath.Dir(full), Deleted: time.Now()})
	infoPath := filepath.Join(dir, "info", id+".json")
	if err := os.WriteFile(infoPath, data, 0o600); err != nil {
		return err
	}
	if err := os.Rename(real, filepath.Join(dir, "files", id)); err != nil {
		_ = os.Remove(infoPath)
		return fmt.Errorf("can't move it to the Trash: %w", err)
	}
	return nil
}

// trashItems lists what's in the Trash, newest first, and deletes what's been there too long.
func (s *server) trashItems() []trashItem {
	items := []trashItem{}
	for _, d := range s.trashDirs() {
		list, _ := os.ReadDir(filepath.Join(d, "info"))
		for _, e := range list {
			id := strings.TrimSuffix(e.Name(), ".json")
			if !trashID.MatchString(id) {
				continue
			}
			infoPath := filepath.Join(d, "info", e.Name())
			var info trashInfo
			data, err := os.ReadFile(infoPath)
			if err != nil || json.Unmarshal(data, &info) != nil {
				continue
			}
			item := filepath.Join(d, "files", id)
			st, err := os.Lstat(item)
			if err != nil {
				_ = os.Remove(infoPath)
				continue
			}
			if time.Since(info.Deleted) > trashKeep {
				if os.RemoveAll(item) == nil {
					_ = os.Remove(infoPath)
				}
				continue
			}
			t := trashItem{ID: id, Name: info.Name, From: info.From, Deleted: info.Deleted.Format(time.RFC3339), Kind: kindOf(info.Name, st.IsDir())}
			if !st.IsDir() {
				t.Size = st.Size()
			}
			items = append(items, t)
		}
	}
	sort.Slice(items, func(i, j int) bool { return items[i].Deleted > items[j].Deleted })
	return items
}

// findTrash returns the trash an item is in, and its info.
func (s *server) findTrash(id string) (string, trashInfo, error) {
	var info trashInfo
	if !trashID.MatchString(id) {
		return "", info, os.ErrNotExist
	}
	for _, d := range s.trashDirs() {
		data, err := os.ReadFile(filepath.Join(d, "info", id+".json"))
		if err == nil && json.Unmarshal(data, &info) == nil {
			return d, info, nil
		}
	}
	return "", info, os.ErrNotExist
}

func (s *server) removeFromTrash(dir, id string) error {
	if err := os.RemoveAll(filepath.Join(dir, "files", id)); err != nil {
		return err
	}
	return os.Remove(filepath.Join(dir, "info", id+".json"))
}

// pruneTrash empties out old items now and then, even when nobody opens the Trash.
func (s *server) pruneTrash() {
	for {
		s.trashItems()
		time.Sleep(6 * time.Hour)
	}
}

func (s *server) handleTrashList(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, s.trashItems())
}

func (s *server) handleMoveToTrash(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Paths []string `json:"paths"`
	}
	if decodeJSON(r, &body) != nil || len(body.Paths) == 0 {
		writeError(w, http.StatusBadRequest, "invalid request")
		return
	}
	for _, p := range body.Paths {
		full, err := s.resolve(p)
		if err == nil {
			err = s.moveToTrash(full)
		}
		if err != nil {
			writeFSError(w, err)
			return
		}
	}
	w.WriteHeader(http.StatusNoContent)
}

// handleTrashRestore puts items back where they came from (as "name 2" if the name was taken
// since), making the folder again if it's gone.
func (s *server) handleTrashRestore(w http.ResponseWriter, r *http.Request) {
	var body struct {
		IDs []string `json:"ids"`
	}
	if decodeJSON(r, &body) != nil || len(body.IDs) == 0 {
		writeError(w, http.StatusBadRequest, "invalid request")
		return
	}
	restored := []string{}
	for _, id := range body.IDs {
		dir, info, err := s.findTrash(id)
		if err != nil {
			writeFSError(w, err)
			return
		}
		to, err := s.resolve(info.From)
		if err != nil {
			writeFSError(w, err)
			return
		}
		if err := os.MkdirAll(to, 0o755); err != nil {
			writeFSError(w, err)
			return
		}
		ext := filepath.Ext(info.Name)
		stem := strings.TrimSuffix(info.Name, ext)
		name := uniqueName(to, info.Name, func(n int) string { return fmt.Sprintf("%s %d%s", stem, n, ext) })
		if err := os.Rename(filepath.Join(dir, "files", id), filepath.Join(to, name)); err != nil {
			writeFSError(w, fmt.Errorf("can't put it back: %w", err))
			return
		}
		_ = os.Remove(filepath.Join(dir, "info", id+".json"))
		restored = append(restored, filepath.Join(info.From, name))
	}
	writeJSON(w, http.StatusOK, restored)
}

func (s *server) handleTrashDelete(w http.ResponseWriter, r *http.Request) {
	dir, _, err := s.findTrash(r.PathValue("id"))
	if err == nil {
		err = s.removeFromTrash(dir, r.PathValue("id"))
	}
	if err != nil {
		writeFSError(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *server) handleEmptyTrash(w http.ResponseWriter, r *http.Request) {
	for _, d := range s.trashDirs() {
		list, _ := os.ReadDir(filepath.Join(d, "info"))
		for _, e := range list {
			if id := strings.TrimSuffix(e.Name(), ".json"); trashID.MatchString(id) {
				if err := s.removeFromTrash(d, id); err != nil {
					writeFSError(w, err)
					return
				}
			}
		}
	}
	w.WriteHeader(http.StatusNoContent)
}
