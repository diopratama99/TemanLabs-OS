package main

import (
	"context"
	"errors"
	"image"
	"io/fs"
	"mime"
	"net/http"
	"os"
	"os/exec"
	"os/user"
	"path/filepath"
	"strconv"
	"strings"
	"syscall"
	"time"
)

// Get Info (Files): everything about one file or folder, like a desktop's info window.

type infoVolume struct {
	Mount  string `json:"mount"`
	FSType string `json:"fstype"`
	Size   uint64 `json:"size"`
	Free   uint64 `json:"free"`
}

type infoMedia struct {
	Width    int     `json:"width,omitempty"`
	Height   int     `json:"height,omitempty"`
	Duration float64 `json:"duration,omitempty"`
	Video    string  `json:"video,omitempty"`
	Audio    string  `json:"audio,omitempty"`
	FPS      float64 `json:"fps,omitempty"`
	Bitrate  int64   `json:"bitrate,omitempty"`
	Channels int     `json:"channels,omitempty"`
}

type fileDetails struct {
	Name   string `json:"name"`
	Path   string `json:"path"`
	Kind   string `json:"kind"`
	Folder bool   `json:"folder"`
	Size   int64  `json:"size"`
	// Folders: what's directly inside, and everything inside counted up (Partial when it took
	// too long to finish).
	Items   int   `json:"items,omitempty"`
	Total   int64 `json:"total,omitempty"`
	Files   int   `json:"files,omitempty"`
	Partial bool  `json:"partial,omitempty"`

	Modified string `json:"modified"`
	Accessed string `json:"accessed,omitempty"`
	Changed  string `json:"changed,omitempty"`
	// Not every filesystem records when a file was made.
	Created string `json:"created,omitempty"`

	Mode   string `json:"mode"`  // -rw-r--r--
	Octal  string `json:"octal"` // 644
	Owner  string `json:"owner"`
	Group  string `json:"group"`
	UID    int    `json:"uid"`
	GID    int    `json:"gid"`
	Link   string `json:"link,omitempty"` // a symlink's target
	Mime   string `json:"mime,omitempty"`
	Hidden bool   `json:"hidden,omitempty"`

	Volume *infoVolume `json:"volume,omitempty"`
	Media  *infoMedia  `json:"media,omitempty"`
}

const folderSizeTime = 4 * time.Second

func (s *server) handleFileInfo(w http.ResponseWriter, r *http.Request) {
	path, err := s.resolve(r.URL.Query().Get("path"))
	if err != nil {
		writeFSError(w, err)
		return
	}
	linfo, err := os.Lstat(path)
	if err != nil {
		writeFSError(w, err)
		return
	}
	info := linfo
	d := fileDetails{Name: filepath.Base(path), Path: path, Hidden: strings.HasPrefix(filepath.Base(path), ".")}
	if linfo.Mode()&os.ModeSymlink != 0 {
		d.Link, _ = os.Readlink(path)
		if target, err := os.Stat(path); err == nil {
			info = target
		}
	}
	d.Folder = info.IsDir()
	d.Kind = kindOf(d.Name, d.Folder)
	if d.Kind == "code" && extOf(d.Name) == "ts" && isMPEGTS(path, info.Size()) {
		d.Kind = "video"
	}
	d.Size = info.Size()
	d.Modified = info.ModTime().Format(time.RFC3339)
	d.Mode = info.Mode().String()
	d.Octal = strconv.FormatUint(uint64(info.Mode().Perm()), 8)
	if st, ok := info.Sys().(*syscall.Stat_t); ok {
		d.UID, d.GID = int(st.Uid), int(st.Gid)
		d.Accessed = time.Unix(st.Atim.Sec, st.Atim.Nsec).Format(time.RFC3339)
		d.Changed = time.Unix(st.Ctim.Sec, st.Ctim.Nsec).Format(time.RFC3339)
		if u, err := user.LookupId(strconv.Itoa(d.UID)); err == nil {
			d.Owner = u.Username
		}
		if g, err := user.LookupGroupId(strconv.Itoa(d.GID)); err == nil {
			d.Group = g.Name
		}
	}
	d.Created = birthTime(r.Context(), path)
	if !d.Folder {
		d.Mime = mime.TypeByExtension(strings.ToLower(filepath.Ext(d.Name)))
		if d.Mime == "" {
			d.Mime = mediaTypes[strings.ToLower(filepath.Ext(d.Name))]
		}
	}
	d.Volume = mountedVolume(path)

	switch {
	case d.Folder:
		if entries, err := os.ReadDir(path); err == nil {
			d.Items = len(entries)
		}
		d.Total, d.Files, d.Partial = folderSize(r.Context(), path)
	case d.Kind == "image":
		if f, err := os.Open(path); err == nil {
			if cfg, _, err := image.DecodeConfig(f); err == nil {
				d.Media = &infoMedia{Width: cfg.Width, Height: cfg.Height}
			}
			f.Close()
		}
	case d.Kind == "video" || d.Kind == "audio":
		if toolInstalled("ffprobe") && !onCloudDrive(path) {
			if p, err := probeFile(r.Context(), path); err == nil {
				m := &infoMedia{Duration: p.Duration, Bitrate: p.Bitrate}
				for _, st := range p.Streams {
					switch {
					case st.Type == "video" && !st.Cover && m.Video == "":
						m.Video, m.Width, m.Height, m.FPS = codecName(st.Codec), st.Width, st.Height, st.FPS
					case st.Type == "audio" && m.Audio == "":
						m.Audio, m.Channels = codecName(st.Codec), st.Channels
					}
				}
				d.Media = m
			}
		}
	}
	writeJSON(w, http.StatusOK, d)
}

// birthTime asks coreutils' stat for when the file was made ("" when the filesystem doesn't say).
func birthTime(ctx context.Context, path string) string {
	ctx, cancel := context.WithTimeout(ctx, 2*time.Second)
	defer cancel()
	out, err := exec.CommandContext(ctx, "stat", "-c", "%W", "--", path).Output()
	if err != nil {
		return ""
	}
	sec, err := strconv.ParseInt(strings.TrimSpace(string(out)), 10, 64)
	if err != nil || sec <= 0 {
		return ""
	}
	return time.Unix(sec, 0).Format(time.RFC3339)
}

var errSizeTimeout = errors.New("took too long")

// folderSize adds up everything in a folder (not following links), for at most a few seconds.
func folderSize(ctx context.Context, root string) (total int64, files int, partial bool) {
	deadline := time.Now().Add(folderSizeTime)
	n := 0
	err := filepath.WalkDir(root, func(_ string, d fs.DirEntry, err error) error {
		if err != nil {
			return nil // unreadable folders are skipped
		}
		if n++; n%256 == 0 && (time.Now().After(deadline) || ctx.Err() != nil) {
			return errSizeTimeout
		}
		if d.Type().IsRegular() {
			if info, err := d.Info(); err == nil {
				total += info.Size()
				files++
			}
		}
		return nil
	})
	return total, files, errors.Is(err, errSizeTimeout)
}

// mountedVolume finds the mounted filesystem a path is on, and its space.
func mountedVolume(path string) *infoVolume {
	data, err := os.ReadFile("/proc/self/mounts")
	if err != nil {
		return nil
	}
	var v *infoVolume
	for _, line := range strings.Split(string(data), "\n") {
		f := strings.Fields(line)
		if len(f) < 3 {
			continue
		}
		mount := unescapeMount(f[1])
		inside := path == mount || strings.HasPrefix(path, strings.TrimSuffix(mount, "/")+"/")
		if inside && (v == nil || len(mount) >= len(v.Mount)) {
			v = &infoVolume{Mount: mount, FSType: f[2]}
		}
	}
	if v == nil {
		return nil
	}
	var st syscall.Statfs_t
	if syscall.Statfs(v.Mount, &st) == nil {
		v.Size = st.Blocks * uint64(st.Bsize)
		v.Free = st.Bavail * uint64(st.Bsize)
	}
	return v
}
