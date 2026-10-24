package main

import (
	"crypto/rand"
	"encoding/hex"
	"errors"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
)

// Wallpapers are the user's own photos, kept on the server so every browser can use them.
const maxWallpaperBytes = 40 << 20

var (
	wallpaperName = regexp.MustCompile(`^[0-9a-f]{16}\.(jpg|png|webp|gif)$`)
	wallpaperExt  = map[string]string{"image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp", "image/gif": ".gif"}
)

type wallpaperEntry struct {
	Name string `json:"name"`
	URL  string `json:"url"`
}

func (s *server) wallpaperDir() string { return filepath.Join(s.cfg.StateDir, "wallpapers") }

// saveWallpaper stores an image under a random name, refusing anything that isn't one.
func (s *server) saveWallpaper(src io.Reader) (*wallpaperEntry, error) {
	head := make([]byte, 512)
	n, err := io.ReadFull(src, head)
	if err != nil && !errors.Is(err, io.ErrUnexpectedEOF) {
		return nil, errors.New("empty image")
	}
	head = head[:n]
	ext, ok := wallpaperExt[http.DetectContentType(head)]
	if !ok {
		return nil, errors.New("wallpapers must be JPEG, PNG, WebP or GIF images")
	}
	id := make([]byte, 8)
	_, _ = rand.Read(id)
	name := hex.EncodeToString(id) + ext
	if err := os.MkdirAll(s.wallpaperDir(), 0o755); err != nil {
		return nil, err
	}
	target := filepath.Join(s.wallpaperDir(), name)
	f, err := os.OpenFile(target, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0o644)
	if err != nil {
		return nil, err
	}
	_, copyErr := io.Copy(f, io.MultiReader(strings.NewReader(string(head)), io.LimitReader(src, maxWallpaperBytes)))
	if err := errors.Join(copyErr, f.Close()); err != nil {
		os.Remove(target)
		return nil, err
	}
	return &wallpaperEntry{Name: name, URL: "/api/wallpapers/" + name}, nil
}

func (s *server) handleListWallpapers(w http.ResponseWriter, r *http.Request) {
	entries, _ := os.ReadDir(s.wallpaperDir())
	type item struct {
		wallpaperEntry
		mod int64
	}
	var items []item
	for _, e := range entries {
		if !wallpaperName.MatchString(e.Name()) {
			continue
		}
		info, err := e.Info()
		if err != nil {
			continue
		}
		items = append(items, item{wallpaperEntry{e.Name(), "/api/wallpapers/" + e.Name()}, info.ModTime().UnixNano()})
	}
	sort.Slice(items, func(i, j int) bool { return items[i].mod > items[j].mod })
	list := make([]wallpaperEntry, len(items))
	for i, it := range items {
		list[i] = it.wallpaperEntry
	}
	writeJSON(w, http.StatusOK, list)
}

func (s *server) handleUploadWallpaper(w http.ResponseWriter, r *http.Request) {
	r.Body = http.MaxBytesReader(w, r.Body, maxWallpaperBytes+1<<20)
	file, _, err := r.FormFile("file")
	if err != nil {
		writeError(w, http.StatusBadRequest, "expected an image upload")
		return
	}
	defer file.Close()
	entry, err := s.saveWallpaper(file)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	writeJSON(w, http.StatusCreated, entry)
}

// handleWallpaperFromFile copies an image from the file manager, so it keeps working if the
// original is moved or deleted.
func (s *server) handleWallpaperFromFile(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Path string `json:"path"`
	}
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request")
		return
	}
	path, err := s.resolve(req.Path)
	if err != nil {
		writeFSError(w, err)
		return
	}
	f, err := os.Open(path)
	if err != nil {
		writeFSError(w, err)
		return
	}
	defer f.Close()
	entry, err := s.saveWallpaper(f)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	writeJSON(w, http.StatusCreated, entry)
}

func (s *server) handleGetWallpaper(w http.ResponseWriter, r *http.Request) {
	name := r.PathValue("name")
	if !wallpaperName.MatchString(name) {
		http.NotFound(w, r)
		return
	}
	// Names are random and never reused, so the file can be cached for good.
	w.Header().Set("Cache-Control", "private, max-age=31536000, immutable")
	http.ServeFile(w, r, filepath.Join(s.wallpaperDir(), name))
}

func (s *server) handleDeleteWallpaper(w http.ResponseWriter, r *http.Request) {
	name := r.PathValue("name")
	if !wallpaperName.MatchString(name) {
		writeError(w, http.StatusBadRequest, "invalid wallpaper")
		return
	}
	if err := os.Remove(filepath.Join(s.wallpaperDir(), name)); err != nil && !errors.Is(err, os.ErrNotExist) {
		writeFSError(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
