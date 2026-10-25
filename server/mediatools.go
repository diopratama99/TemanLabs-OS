package main

import (
	"context"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"time"
)

// Media tools: yt-dlp (videos from most sites), gallery-dl (photos and albums), streamlink (live
// streams) and deno (the JavaScript runtime yt-dlp needs for YouTube), in a Python venv of
// TemanLabsOS's own, so the system's Python stays as it is and one click updates them all.
// Sites change often; an out-of-date yt-dlp is the usual reason a download stops working.

const mediaToolsJob = "media-tools"

var mediaToolNames = []string{"yt-dlp", "gallery-dl", "streamlink", "deno"}

func (s *server) toolsDir() string { return filepath.Join(s.cfg.StateDir, "tools", "venv") }

func (s *server) toolPath(name string) string { return filepath.Join(s.toolsDir(), "bin", name) }

func (s *server) toolsInstalled() bool {
	for _, t := range []string{"yt-dlp", "gallery-dl", "streamlink"} {
		if _, err := os.Stat(s.toolPath(t)); err != nil {
			return false
		}
	}
	return true
}

// toolEnv puts the venv first on the PATH: yt-dlp finds deno there, and ffmpeg in the system.
func (s *server) toolEnv() []string {
	env := []string{}
	for _, e := range os.Environ() {
		if !strings.HasPrefix(e, "PATH=") {
			env = append(env, e)
		}
	}
	return append(env, "PATH="+filepath.Join(s.toolsDir(), "bin")+":/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin", "PYTHONUNBUFFERED=1")
}

var toolVersions struct {
	sync.Mutex
	at   time.Time
	list map[string]string
}

// mediaToolVersions asks each tool its version, at most once a minute.
func (s *server) mediaToolVersions(ctx context.Context) map[string]string {
	toolVersions.Lock()
	defer toolVersions.Unlock()
	if toolVersions.list != nil && time.Since(toolVersions.at) < time.Minute {
		return toolVersions.list
	}
	out := map[string]string{}
	for _, t := range mediaToolNames {
		if _, err := os.Stat(s.toolPath(t)); err != nil {
			continue
		}
		c, cancel := context.WithTimeout(ctx, 10*time.Second)
		b, err := exec.CommandContext(c, s.toolPath(t), "--version").Output()
		cancel()
		if err == nil {
			v := strings.TrimSpace(strings.SplitN(string(b), "\n", 2)[0])
			v = strings.TrimPrefix(strings.TrimPrefix(v, t+" "), "streamlink ")
			out[t] = strings.Fields(v + " ?")[0]
		}
	}
	toolVersions.list, toolVersions.at = out, time.Now()
	return out
}

// gallery-dl's development version: what its authors have fixed since the last release, from
// their repository. Sites like Instagram change often, and a fix can wait weeks for a release.
const galleryDevSource = "gallery-dl @ git+https://codeberg.org/mikf/gallery-dl"

func (s *server) galleryDevFlag() string {
	return filepath.Join(s.cfg.StateDir, "tools", "gallery-dl-dev")
}

// galleryDev says whether gallery-dl is to come from its development version.
func (s *server) galleryDev() bool {
	_, err := os.Stat(s.galleryDevFlag())
	return err == nil
}

func (s *server) handleMediaTools(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{
		"installed":  s.toolsInstalled(),
		"working":    jobRunning(mediaToolsJob),
		"versions":   s.mediaToolVersions(r.Context()),
		"galleryDev": s.galleryDev(),
	})
}

// handleInstallMediaTools installs the tools, or updates them to the newest versions; a body of
// {"galleryDev": true|false} switches gallery-dl to its development version or back first.
func (s *server) handleInstallMediaTools(w http.ResponseWriter, r *http.Request) {
	var body struct {
		GalleryDev *bool `json:"galleryDev"`
	}
	if r.ContentLength != 0 {
		if decodeJSON(r, &body) != nil {
			writeError(w, http.StatusBadRequest, "invalid request")
			return
		}
	}
	if body.GalleryDev != nil {
		if *body.GalleryDev {
			if _, err := exec.LookPath("git"); err != nil {
				writeError(w, http.StatusConflict, "the development version comes with git: install it first (sudo apt install git)")
				return
			}
			if err := os.MkdirAll(filepath.Dir(s.galleryDevFlag()), 0o700); err != nil || os.WriteFile(s.galleryDevFlag(), []byte(galleryDevSource+"\n"), 0o600) != nil {
				writeError(w, http.StatusInternalServerError, "couldn't save the choice")
				return
			}
		} else {
			_ = os.Remove(s.galleryDevFlag())
		}
	}
	dev := s.galleryDev()
	dir := s.toolsDir()
	_, err := startFuncJob(mediaToolsJob, "Installing the download tools", func(ctx context.Context, logf func(string, ...any)) error {
		defer func() {
			toolVersions.Lock()
			toolVersions.list = nil
			toolVersions.Unlock()
		}()
		if _, err := os.Stat(filepath.Join(dir, "bin", "pip")); err != nil {
			logf("Making a Python environment at %s…", dir)
			if err := os.MkdirAll(filepath.Dir(dir), 0o755); err != nil {
				return err
			}
			if out, err := exec.CommandContext(ctx, "python3", "-m", "venv", dir).CombinedOutput(); err != nil {
				msg := lastLines(string(out), 3)
				if strings.Contains(msg, "ensurepip") {
					msg += " (install it with: sudo apt install python3-venv)"
				}
				return &toolError{msg}
			}
		}
		logf("Downloading yt-dlp, gallery-dl, streamlink and deno…")
		cmd := exec.CommandContext(ctx, filepath.Join(dir, "bin", "pip"), "install", "--upgrade", "--disable-pip-version-check", "yt-dlp[default]", "gallery-dl", "streamlink", "deno")
		cmd.Env = s.toolEnv()
		out, err := cmd.CombinedOutput()
		for _, line := range strings.Split(strings.TrimSpace(string(out)), "\n") {
			if strings.HasPrefix(line, "Successfully installed") || strings.HasPrefix(line, "ERROR") {
				logf("%s", line)
			}
		}
		if err != nil {
			return &toolError{lastLines(string(out), 3)}
		}
		// The development version over the release, or the release back over a development one
		// (pip keeps a "1.33.0-dev" it thinks newer otherwise).
		var swap []string
		if dev {
			logf("Getting gallery-dl's development version…")
			swap = []string{galleryDevSource}
		} else if v, err := exec.CommandContext(ctx, s.toolPath("gallery-dl"), "--version").Output(); err == nil && strings.Contains(string(v), "dev") {
			logf("Putting gallery-dl's release back…")
			swap = []string{"gallery-dl"}
		}
		if swap != nil {
			cmd := exec.CommandContext(ctx, filepath.Join(dir, "bin", "pip"), append([]string{"install", "--upgrade", "--force-reinstall", "--no-deps", "--disable-pip-version-check"}, swap...)...)
			cmd.Env = s.toolEnv()
			if out, err := cmd.CombinedOutput(); err != nil {
				return &toolError{lastLines(string(out), 3)}
			}
		}
		logf("Done.")
		return nil
	})
	if err != nil {
		writeError(w, http.StatusConflict, err.Error())
		return
	}
	writeJSON(w, http.StatusAccepted, map[string]string{"job": mediaToolsJob})
}

type toolError struct{ msg string }

func (e *toolError) Error() string { return strings.TrimSpace(e.msg) }
