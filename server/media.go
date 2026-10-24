package main

import (
	"mime"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strings"
)

// handleRawFile streams a file for the photo viewer, video player and music player, with Range
// support so media can seek. Files are served from the TemanLabsOS origin, so only images,
// video and audio render inline, and everything is sandboxed: an HTML or SVG file in /DATA
// must not be able to run script with the user's session.
func (s *server) handleRawFile(w http.ResponseWriter, r *http.Request) {
	path, err := s.resolve(r.URL.Query().Get("path"))
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
	info, err := f.Stat()
	if err != nil {
		writeFSError(w, err)
		return
	}
	if info.IsDir() {
		writeError(w, http.StatusBadRequest, "that is a folder")
		return
	}

	name := filepath.Base(path)
	ctype := mime.TypeByExtension(strings.ToLower(filepath.Ext(name)))
	if ctype == "" {
		ctype = mediaTypes[strings.ToLower(filepath.Ext(name))]
	}
	inline := strings.HasPrefix(ctype, "image/") || strings.HasPrefix(ctype, "video/") || strings.HasPrefix(ctype, "audio/")
	if !inline || r.URL.Query().Get("download") == "1" {
		w.Header().Set("Content-Disposition", "attachment; filename*=UTF-8''"+url.PathEscape(name))
		if !inline {
			ctype = "application/octet-stream"
		}
	}
	w.Header().Set("Content-Type", ctype)
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.Header().Set("Content-Security-Policy", "sandbox; default-src 'none'; img-src 'self' data:; media-src 'self'; style-src 'unsafe-inline'")
	w.Header().Set("Cache-Control", "private, no-cache")
	http.ServeContent(w, r, name, info.ModTime(), f)
}

// Formats the system MIME database often lacks.
var mediaTypes = map[string]string{
	".mkv":  "video/x-matroska",
	".m2ts": "video/mp2t",
	".mts":  "video/mp2t",
	".mov":  "video/quicktime",
	".m4v":  "video/mp4",
	".flac": "audio/flac",
	".m4a":  "audio/mp4",
	".opus": "audio/ogg",
	".heic": "image/heic",
	".avif": "image/avif",
	".webp": "image/webp",
}
