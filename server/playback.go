package main

import (
	"encoding/json"
	"math"
	"net/http"
	"os"
	"path/filepath"
	"sort"
	"sync"
	"time"
)

// Resume points for the video player: where each video was left off. They're kept on the server,
// so a film started on the laptop continues on the phone. The most recent 500 are kept.

const maxResumePoints = 500

type resumePoint struct {
	Position float64   `json:"position"`
	Duration float64   `json:"duration"`
	Updated  time.Time `json:"updated"`
}

type playbackStore struct {
	mu     sync.Mutex
	path   string
	points map[string]resumePoint
}

func newPlaybackStore(stateDir string) *playbackStore {
	p := &playbackStore{path: filepath.Join(stateDir, "playback.json"), points: map[string]resumePoint{}}
	if data, err := os.ReadFile(p.path); err == nil {
		_ = json.Unmarshal(data, &p.points)
	}
	return p
}

// save writes the points out; callers hold p.mu.
func (p *playbackStore) save() {
	if len(p.points) > maxResumePoints {
		paths := make([]string, 0, len(p.points))
		for path := range p.points {
			paths = append(paths, path)
		}
		sort.Slice(paths, func(i, j int) bool { return p.points[paths[i]].Updated.After(p.points[paths[j]].Updated) })
		for _, path := range paths[maxResumePoints:] {
			delete(p.points, path)
		}
	}
	data, _ := json.Marshal(p.points)
	tmp := p.path + ".tmp"
	if os.WriteFile(tmp, data, 0o600) == nil {
		_ = os.Rename(tmp, p.path)
	}
}

func (s *server) handleGetPosition(w http.ResponseWriter, r *http.Request) {
	path, err := s.resolve(r.URL.Query().Get("path"))
	if err != nil {
		writeFSError(w, err)
		return
	}
	s.playback.mu.Lock()
	point := s.playback.points[path]
	s.playback.mu.Unlock()
	writeJSON(w, http.StatusOK, point)
}

// handleSetPosition records where a video was left; 0 (or a finished video) forgets it.
func (s *server) handleSetPosition(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Path     string  `json:"path"`
		Position float64 `json:"position"`
		Duration float64 `json:"duration"`
	}
	if err := decodeJSON(r, &body); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	path, err := s.resolve(body.Path)
	if err != nil {
		writeFSError(w, err)
		return
	}
	if math.IsNaN(body.Position) || math.IsInf(body.Position, 0) || math.IsNaN(body.Duration) || math.IsInf(body.Duration, 0) {
		writeError(w, http.StatusBadRequest, "bad position")
		return
	}
	p := s.playback
	p.mu.Lock()
	defer p.mu.Unlock()
	if body.Position <= 0 {
		if _, ok := p.points[path]; !ok {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		delete(p.points, path)
	} else {
		p.points[path] = resumePoint{Position: body.Position, Duration: max(0, body.Duration), Updated: time.Now()}
	}
	p.save()
	w.WriteHeader(http.StatusNoContent)
}
