package main

import (
	"bufio"
	"bytes"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"net/http"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"
)

var (
	errOutsideRoot = errors.New("path is outside the files root")
	errBadName     = errors.New("invalid file name")
)

const (
	maxReadBytes   = 5 << 20
	maxWriteBytes  = 10 << 20
	maxUploadBytes = 64 << 30
	searchLimit    = 200
	treeLimit      = 5000
	walkBudget     = 3 * time.Second
	searchFileMax  = 1 << 20
)

// Directories skipped by search and Go to File: huge and rarely what anyone is looking for.
var skipDirs = map[string]bool{".git": true, "node_modules": true, ".cache": true, "__pycache__": true, ".venv": true}

// Kernel and runtime filesystems: walking them from "/" never ends and finds nothing useful.
var skipAbsolute = map[string]bool{"/proc": true, "/sys": true, "/dev": true, "/run": true, "/snap": true, "/var/lib/docker": true}

// Top-level system folders that may be browsed and edited inside, but not deleted or renamed
// themselves from the UI (CasaOS allows it; one misclick there breaks the server).
var protectedPaths = map[string]bool{
	"/": true, "/bin": true, "/boot": true, "/dev": true, "/etc": true, "/home": true, "/lib": true, "/lib32": true,
	"/lib64": true, "/libx32": true, "/opt": true, "/proc": true, "/root": true, "/run": true, "/sbin": true, "/srv": true,
	"/sys": true, "/tmp": true, "/usr": true, "/var": true, "/snap": true, "/mnt": true, "/media": true, "/DATA": true,
	"/var/lib": true, "/var/lib/docker": true, "/var/lib/casaos": true, "/usr/bin": true, "/usr/lib": true,
}

type fileEntry struct {
	Name     string `json:"name"`
	Kind     string `json:"kind"`
	Size     int64  `json:"size,omitempty"`
	Modified string `json:"modified"`
}

// resolve turns a client path such as "/DATA/Projects" into a cleaned filesystem path, refusing
// anything outside the root (which may be "/" for the whole filesystem, like CasaOS).
// Symlinks inside the root (e.g. /DATA/HDD_DATA) are followed.
func (s *server) resolve(p string) (string, error) {
	if !strings.HasPrefix(p, "/") {
		return "", errOutsideRoot
	}
	clean := filepath.Clean(p)
	root := s.cfg.Root
	if root != "/" && clean != root && !strings.HasPrefix(clean, root+"/") {
		return "", errOutsideRoot
	}
	return clean, nil
}

func validName(name string) bool {
	return name != "" && name != "." && name != ".." && !strings.ContainsAny(name, "/\x00")
}

var errProtected = errors.New("this is a system folder; it can be browsed and edited inside, but not deleted or renamed here")

func (s *server) checkModifiable(path string) error {
	if protectedPaths[path] || path == s.cfg.Root {
		return fmt.Errorf("%s: %w", path, errProtected)
	}
	return nil
}

// chown gives a file created through the UI the same owner as its folder, so a file added to
// /etc stays root's. Shared folders anyone can write to (like CasaOS's /DATA, mode 777) and
// folders the configured user owns get the configured user instead of root.
func (s *server) chown(path string) {
	if s.owner == nil || os.Geteuid() != 0 {
		return
	}
	parent, err := os.Stat(filepath.Dir(path))
	if err != nil {
		return
	}
	st, ok := statOwner(parent)
	if !ok {
		return
	}
	if parent.Mode().Perm()&0o002 != 0 || st.uid == s.owner.uid {
		_ = os.Lchown(path, s.owner.uid, s.owner.gid)
		return
	}
	_ = os.Lchown(path, st.uid, st.gid)
}

var extKinds = map[string]string{
	"jpg": "image", "jpeg": "image", "png": "image", "gif": "image", "webp": "image", "heic": "image", "svg": "image", "bmp": "image",
	"mp4": "video", "mkv": "video", "mov": "video", "avi": "video", "webm": "video", "m4v": "video", "m2ts": "video", "mts": "video",
	"mp3": "audio", "flac": "audio", "wav": "audio", "m4a": "audio", "ogg": "audio", "aac": "audio",
	"zip": "archive", "tar": "archive", "gz": "archive", "tgz": "archive", "7z": "archive", "rar": "archive", "iso": "archive", "xz": "archive",
	"pdf": "document", "doc": "document", "docx": "document", "xls": "document", "xlsx": "document", "md": "document", "txt": "document", "log": "document",
}

// Extensions the code editor can open (mirrors src/lib/fileTypes.ts); also limits text search.
var textExts = map[string]bool{
	"ts": true, "tsx": true, "js": true, "mjs": true, "cjs": true, "jsx": true, "json": true, "html": true, "htm": true,
	"css": true, "scss": true, "less": true, "md": true, "yml": true, "yaml": true, "sh": true, "bash": true, "zsh": true,
	"py": true, "go": true, "rs": true, "java": true, "c": true, "h": true, "cpp": true, "php": true, "rb": true, "lua": true,
	"sql": true, "xml": true, "ini": true, "conf": true, "cfg": true, "toml": true, "env": true, "txt": true, "log": true,
}

func extOf(name string) string {
	if i := strings.LastIndex(name, "."); i > 0 {
		return strings.ToLower(name[i+1:])
	}
	return ""
}

func isText(name string) bool {
	lower := strings.ToLower(name)
	return textExts[extOf(name)] || lower == "dockerfile" || lower == "makefile" || lower == ".env" || lower == ".gitignore"
}

func kindOf(name string, dir bool) string {
	if dir {
		return "folder"
	}
	if k, ok := extKinds[extOf(name)]; ok {
		return k
	}
	if isText(name) {
		return "code"
	}
	return "document"
}

func entryFor(dir string, d fs.DirEntry) fileEntry {
	full := filepath.Join(dir, d.Name())
	info, err := os.Stat(full) // follows symlinks, so a linked folder shows as a folder
	if err != nil {
		info, err = d.Info()
	}
	e := fileEntry{Name: d.Name(), Kind: "document"}
	if err == nil {
		e.Kind = kindOf(d.Name(), info.IsDir())
		if e.Kind == "code" && extOf(d.Name()) == "ts" && isMPEGTS(full, info.Size()) {
			e.Kind = "video"
		}
		e.Modified = info.ModTime().Format(time.RFC3339)
		if !info.IsDir() {
			e.Size = info.Size()
		}
	}
	return e
}

// isMPEGTS tells a .ts video (MPEG transport stream) from a TypeScript file: a transport stream
// is 188-byte packets that each start with the sync byte 0x47 (192 bytes, after a 4-byte
// timestamp, in Blu-ray style streams). Small files are code; nothing is read from them.
func isMPEGTS(path string, size int64) bool {
	if size < 64<<10 {
		return false
	}
	f, err := os.Open(path)
	if err != nil {
		return false
	}
	defer f.Close()
	head := make([]byte, 4+192*3)
	if _, err := io.ReadFull(f, head); err != nil {
		return false
	}
	for _, p := range []struct{ start, stride int }{{0, 188}, {4, 192}} {
		if head[p.start] == 0x47 && head[p.start+p.stride] == 0x47 && head[p.start+2*p.stride] == 0x47 {
			return true
		}
	}
	return false
}

func (s *server) handleListFiles(w http.ResponseWriter, r *http.Request) {
	dir, err := s.resolve(r.URL.Query().Get("path"))
	if err != nil {
		writeFSError(w, err)
		return
	}
	items, err := os.ReadDir(dir)
	if err != nil {
		writeFSError(w, err)
		return
	}
	entries := make([]fileEntry, 0, len(items))
	for _, d := range items {
		entries = append(entries, entryFor(dir, d))
	}
	sort.Slice(entries, func(i, j int) bool {
		if (entries[i].Kind == "folder") != (entries[j].Kind == "folder") {
			return entries[i].Kind == "folder"
		}
		return strings.ToLower(entries[i].Name) < strings.ToLower(entries[j].Name)
	})
	writeJSON(w, http.StatusOK, entries)
}

// uniqueName returns base (or "stem 2.ext", "stem 3.ext"…) that doesn't exist in dir yet.
func uniqueName(dir, base string, numbered func(n int) string) string {
	name := base
	for n := 2; ; n++ {
		if _, err := os.Lstat(filepath.Join(dir, name)); errors.Is(err, fs.ErrNotExist) {
			return name
		}
		name = numbered(n)
	}
}

type pathBody struct {
	Path string `json:"path"`
}

func (s *server) handleCreateFile(w http.ResponseWriter, r *http.Request) {
	var body pathBody
	if decodeJSON(r, &body) != nil {
		writeError(w, http.StatusBadRequest, "invalid request")
		return
	}
	dir, err := s.resolve(body.Path)
	if err != nil {
		writeFSError(w, err)
		return
	}
	name := uniqueName(dir, "untitled.txt", func(n int) string { return fmt.Sprintf("untitled-%d.txt", n) })
	f, err := os.OpenFile(filepath.Join(dir, name), os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0o644)
	if err != nil {
		writeFSError(w, err)
		return
	}
	f.Close()
	s.chown(filepath.Join(dir, name))
	writeJSON(w, http.StatusCreated, map[string]string{"name": name})
}

func (s *server) handleCreateFolder(w http.ResponseWriter, r *http.Request) {
	var body pathBody
	if decodeJSON(r, &body) != nil {
		writeError(w, http.StatusBadRequest, "invalid request")
		return
	}
	dir, err := s.resolve(body.Path)
	if err != nil {
		writeFSError(w, err)
		return
	}
	name := uniqueName(dir, "untitled folder", func(n int) string { return fmt.Sprintf("untitled folder %d", n) })
	if err := os.Mkdir(filepath.Join(dir, name), 0o755); err != nil {
		writeFSError(w, err)
		return
	}
	s.chown(filepath.Join(dir, name))
	writeJSON(w, http.StatusCreated, map[string]string{"name": name})
}

func (s *server) handleRename(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Path, From, To string
	}
	if decodeJSON(r, &body) != nil {
		writeError(w, http.StatusBadRequest, "invalid request")
		return
	}
	dir, err := s.resolve(body.Path)
	if err != nil {
		writeFSError(w, err)
		return
	}
	if !validName(body.From) || !validName(body.To) {
		writeFSError(w, errBadName)
		return
	}
	if err := s.checkModifiable(filepath.Join(dir, body.From)); err != nil {
		writeFSError(w, err)
		return
	}
	to := filepath.Join(dir, body.To)
	// os.Rename silently replaces an existing file; refuse instead.
	if _, err := os.Lstat(to); err == nil {
		writeFSError(w, fmt.Errorf("%s: %w", body.To, fs.ErrExist))
		return
	}
	if err := os.Rename(filepath.Join(dir, body.From), to); err != nil {
		writeFSError(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *server) handleDelete(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	dir, err := s.resolve(q.Get("path"))
	if err != nil {
		writeFSError(w, err)
		return
	}
	name := q.Get("name")
	if !validName(name) {
		writeFSError(w, errBadName)
		return
	}
	if err := s.checkModifiable(filepath.Join(dir, name)); err != nil {
		writeFSError(w, err)
		return
	}
	if err := os.RemoveAll(filepath.Join(dir, name)); err != nil {
		writeFSError(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *server) handleReadFile(w http.ResponseWriter, r *http.Request) {
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
	data, err := io.ReadAll(io.LimitReader(f, maxReadBytes+1))
	if err != nil {
		writeFSError(w, err)
		return
	}
	if len(data) > maxReadBytes {
		writeError(w, http.StatusRequestEntityTooLarge, "File is too large to open in the editor (over 5 MB).")
		return
	}
	if bytes.IndexByte(data[:min(len(data), 8000)], 0) >= 0 {
		writeError(w, http.StatusUnsupportedMediaType, "This looks like a binary file.")
		return
	}
	w.Header().Set("Content-Type", "text/plain; charset=utf-8")
	_, _ = w.Write(data)
}

// handleWriteFile replaces a file's contents atomically, keeping its permissions.
func (s *server) handleWriteFile(w http.ResponseWriter, r *http.Request) {
	path, err := s.resolve(r.URL.Query().Get("path"))
	if err != nil {
		writeFSError(w, err)
		return
	}
	data, err := io.ReadAll(http.MaxBytesReader(w, r.Body, maxWriteBytes))
	if err != nil {
		writeError(w, http.StatusRequestEntityTooLarge, "File is too large to save (over 10 MB).")
		return
	}
	mode := fs.FileMode(0o644)
	info, statErr := os.Stat(path)
	if statErr == nil {
		mode = info.Mode().Perm()
	}
	tmp, err := os.CreateTemp(filepath.Dir(path), ".temanlabs-save-*")
	if err != nil {
		writeFSError(w, err)
		return
	}
	_, werr := tmp.Write(data)
	cerr := tmp.Close()
	if werr != nil || cerr != nil {
		os.Remove(tmp.Name())
		writeFSError(w, errors.Join(werr, cerr))
		return
	}
	_ = os.Chmod(tmp.Name(), mode)
	if statErr == nil {
		if st, ok := statOwner(info); ok {
			_ = os.Lchown(tmp.Name(), st.uid, st.gid)
		}
	} else {
		s.chown(tmp.Name())
	}
	if err := os.Rename(tmp.Name(), path); err != nil {
		os.Remove(tmp.Name())
		writeFSError(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

type searchMatch struct {
	Path    string `json:"path"`
	Line    int    `json:"line"`
	Column  int    `json:"column"`
	Preview string `json:"preview"`
}

var errStopWalk = errors.New("stop")

// walkFiles visits regular files below root, skipping heavy folders, within a time budget.
// A symlinked root (like /DATA/HDD_DATA) is followed; paths are reported under the link.
func walkFiles(root string, visit func(path string, d fs.DirEntry) error) {
	deadline := time.Now().Add(walkBudget)
	real, err := filepath.EvalSymlinks(root)
	if err != nil {
		return
	}
	_ = filepath.WalkDir(real, func(path string, d fs.DirEntry, err error) error {
		path = filepath.Join(root, strings.TrimPrefix(path, real))
		if err != nil {
			return nil
		}
		if time.Now().After(deadline) {
			return errStopWalk
		}
		if d.IsDir() {
			if path != root && (skipDirs[d.Name()] || skipAbsolute[path]) {
				return filepath.SkipDir
			}
			return nil
		}
		return visit(path, d)
	})
}

func (s *server) handleSearch(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	root := q.Get("path")
	if root == "" {
		root = s.cfg.Root
	}
	dir, err := s.resolve(root)
	if err != nil {
		writeFSError(w, err)
		return
	}
	needle := strings.ToLower(q.Get("q"))
	matches := []searchMatch{}
	if needle == "" {
		writeJSON(w, http.StatusOK, matches)
		return
	}
	walkFiles(dir, func(path string, d fs.DirEntry) error {
		if !isText(d.Name()) {
			return nil
		}
		if info, err := d.Info(); err != nil || info.Size() > searchFileMax {
			return nil
		}
		f, err := os.Open(path)
		if err != nil {
			return nil
		}
		defer f.Close()
		sc := bufio.NewScanner(f)
		sc.Buffer(make([]byte, 64*1024), searchFileMax)
		for line := 1; sc.Scan(); line++ {
			text := sc.Text()
			if col := strings.Index(strings.ToLower(text), needle); col >= 0 {
				preview := text
				if len(preview) > 300 {
					preview = preview[:300]
				}
				matches = append(matches, searchMatch{Path: path, Line: line, Column: col + 1, Preview: preview})
				if len(matches) >= searchLimit {
					return errStopWalk
				}
			}
		}
		return nil
	})
	writeJSON(w, http.StatusOK, matches)
}

func (s *server) handleTree(w http.ResponseWriter, r *http.Request) {
	dir, err := s.resolve(r.URL.Query().Get("path"))
	if err != nil {
		writeFSError(w, err)
		return
	}
	paths := []string{}
	walkFiles(dir, func(path string, d fs.DirEntry) error {
		paths = append(paths, path)
		if len(paths) >= treeLimit {
			return errStopWalk
		}
		return nil
	})
	sort.Strings(paths)
	writeJSON(w, http.StatusOK, paths)
}

// handleUpload streams one multipart file ("file") into the folder, renaming on conflict.
// subdirs creates rel ("a/b", from an uploaded folder) inside dir, each folder owned like any
// other created through the UI, and returns the innermost one. Existing folders are reused.
func (s *server) subdirs(dir, rel string) (string, error) {
	for _, name := range strings.Split(strings.Trim(rel, "/"), "/") {
		if name == "" {
			continue
		}
		if !validName(name) {
			return "", errBadName
		}
		dir = filepath.Join(dir, name)
		if err := os.Mkdir(dir, 0o755); err == nil {
			s.chown(dir)
		} else if !errors.Is(err, fs.ErrExist) {
			return "", err
		}
	}
	return dir, nil
}

// handleUpload stores one file in path (inside rel, for folder uploads). With mkdir=1 and no
// file it only creates rel, for empty folders.
func (s *server) handleUpload(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	dir, err := s.resolve(q.Get("path"))
	if err != nil {
		writeFSError(w, err)
		return
	}
	if rel := q.Get("rel"); rel != "" {
		if dir, err = s.subdirs(dir, rel); err != nil {
			writeFSError(w, err)
			return
		}
	}
	if q.Get("mkdir") == "1" {
		w.WriteHeader(http.StatusNoContent)
		return
	}
	r.Body = http.MaxBytesReader(w, r.Body, maxUploadBytes)
	reader, err := r.MultipartReader()
	if err != nil {
		writeError(w, http.StatusBadRequest, "expected a multipart upload")
		return
	}
	for {
		part, err := reader.NextPart()
		if err == io.EOF {
			writeError(w, http.StatusBadRequest, "no file in upload")
			return
		}
		if err != nil {
			writeError(w, http.StatusBadRequest, err.Error())
			return
		}
		if part.FormName() != "file" {
			continue
		}
		original := filepath.Base(part.FileName())
		if !validName(original) {
			writeFSError(w, errBadName)
			return
		}
		ext := filepath.Ext(original)
		stem := strings.TrimSuffix(original, ext)
		name := uniqueName(dir, original, func(n int) string { return fmt.Sprintf("%s (%d)%s", stem, n-1, ext) })
		target := filepath.Join(dir, name)
		f, err := os.OpenFile(target, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0o644)
		if err != nil {
			writeFSError(w, err)
			return
		}
		_, copyErr := io.Copy(f, part)
		closeErr := f.Close()
		if copyErr != nil || closeErr != nil {
			os.Remove(target)
			writeError(w, http.StatusBadRequest, "upload failed: "+errors.Join(copyErr, closeErr).Error())
			return
		}
		s.chown(target)
		writeJSON(w, http.StatusCreated, map[string]string{"name": name})
		return
	}
}
