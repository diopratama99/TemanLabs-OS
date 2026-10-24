package main

import (
	"encoding/json"
	"net/http"
	"os"
	"path/filepath"
	"slices"
	"sort"
	"strings"
	"sync"
	"time"
)

// Color tags on files and folders, and the files opened recently, for Files' sidebar.

var tagColors = []string{"red", "orange", "yellow", "green", "blue", "purple", "gray"}

const maxRecents = 60

type recentFile struct {
	Path   string    `json:"path"`
	Opened time.Time `json:"opened"`
}

type fileMeta struct {
	mu      sync.Mutex
	file    string
	Tags    map[string][]string `json:"tags"`
	Recents []recentFile        `json:"recents"`
}

func newFileMeta(stateDir string) *fileMeta {
	m := &fileMeta{file: filepath.Join(stateDir, "files.json"), Tags: map[string][]string{}}
	if data, err := os.ReadFile(m.file); err == nil {
		_ = json.Unmarshal(data, m)
	}
	if m.Tags == nil {
		m.Tags = map[string][]string{}
	}
	return m
}

// save writes the file; the caller holds mu.
func (m *fileMeta) save() error {
	data, err := json.MarshalIndent(m, "", "  ")
	if err != nil {
		return err
	}
	tmp := m.file + ".tmp"
	if err := os.WriteFile(tmp, data, 0o600); err != nil {
		return err
	}
	return os.Rename(tmp, m.file)
}

// moved follows a rename or move, for the item and everything inside it.
func (m *fileMeta) moved(from, to string) {
	m.mu.Lock()
	defer m.mu.Unlock()
	re := func(p string) (string, bool) {
		if p == from {
			return to, true
		}
		if strings.HasPrefix(p, from+"/") {
			return to + strings.TrimPrefix(p, from), true
		}
		return p, false
	}
	changed := false
	for p, tags := range m.Tags {
		if np, ok := re(p); ok {
			delete(m.Tags, p)
			m.Tags[np] = tags
			changed = true
		}
	}
	for i := range m.Recents {
		if np, ok := re(m.Recents[i].Path); ok {
			m.Recents[i].Path = np
			changed = true
		}
	}
	if changed {
		_ = m.save()
	}
}

// placedEntry is a file listed away from its folder, so it carries its whole path.
type placedEntry struct {
	fileEntry
	Path string `json:"path"`
}

// placedOne stats a single path; listing a big folder to find one name would be slow.
func placedOne(p string) (placedEntry, bool) {
	info, err := os.Stat(p)
	if err != nil {
		return placedEntry{}, false
	}
	e := fileEntry{Name: filepath.Base(p), Kind: kindOf(filepath.Base(p), info.IsDir()), Modified: info.ModTime().Format(time.RFC3339)}
	if !info.IsDir() {
		e.Size = info.Size()
	}
	return placedEntry{e, p}, true
}

func (s *server) handleTags(w http.ResponseWriter, r *http.Request) {
	s.meta.mu.Lock()
	defer s.meta.mu.Unlock()
	writeJSON(w, http.StatusOK, s.meta.Tags)
}

func (s *server) handleSetTags(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Paths []string `json:"paths"`
		Tags  []string `json:"tags"`
	}
	if decodeJSON(r, &body) != nil || len(body.Paths) == 0 {
		writeError(w, http.StatusBadRequest, "invalid request")
		return
	}
	tags := []string{}
	for _, c := range tagColors {
		if slices.Contains(body.Tags, c) {
			tags = append(tags, c)
		}
	}
	s.meta.mu.Lock()
	defer s.meta.mu.Unlock()
	for _, p := range body.Paths {
		full, err := s.resolve(p)
		if err != nil {
			writeFSError(w, err)
			return
		}
		if len(tags) == 0 {
			delete(s.meta.Tags, full)
		} else {
			s.meta.Tags[full] = tags
		}
	}
	if err := s.meta.save(); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// handleTagged lists what has one tag, by name.
func (s *server) handleTagged(w http.ResponseWriter, r *http.Request) {
	tag := r.URL.Query().Get("tag")
	s.meta.mu.Lock()
	var paths []string
	for p, tags := range s.meta.Tags {
		if slices.Contains(tags, tag) {
			paths = append(paths, p)
		}
	}
	s.meta.mu.Unlock()
	out := []placedEntry{}
	for _, p := range paths {
		if e, ok := placedOne(p); ok {
			out = append(out, e)
		}
	}
	sort.Slice(out, func(i, j int) bool { return strings.ToLower(out[i].Name) < strings.ToLower(out[j].Name) })
	writeJSON(w, http.StatusOK, out)
}

func (s *server) handleRecents(w http.ResponseWriter, r *http.Request) {
	s.meta.mu.Lock()
	recents := slices.Clone(s.meta.Recents)
	s.meta.mu.Unlock()
	out := []placedEntry{}
	for _, f := range recents {
		if e, ok := placedOne(f.Path); ok {
			e.Modified = f.Opened.Format(time.RFC3339)
			out = append(out, e)
		}
	}
	writeJSON(w, http.StatusOK, out)
}

func (s *server) handleAddRecent(w http.ResponseWriter, r *http.Request) {
	var body pathBody
	if decodeJSON(r, &body) != nil {
		writeError(w, http.StatusBadRequest, "invalid request")
		return
	}
	full, err := s.resolve(body.Path)
	if err != nil {
		writeFSError(w, err)
		return
	}
	s.meta.mu.Lock()
	defer s.meta.mu.Unlock()
	list := []recentFile{{Path: full, Opened: time.Now()}}
	for _, f := range s.meta.Recents {
		if f.Path != full && len(list) < maxRecents {
			list = append(list, f)
		}
	}
	s.meta.Recents = list
	_ = s.meta.save()
	w.WriteHeader(http.StatusNoContent)
}
