package main

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"sync"
	"time"
)

// Self-update from GitHub Releases: the release workflow (.github/workflows/release.yml) uploads
// temanlabsos-linux-<arch> and SHA256SUMS for every tag; TemanLabsOS downloads the binary for its
// architecture, checks it against SHA256SUMS, swaps it in and restarts its service.

// version is set at build time: -ldflags "-X main.version=v1.2.3" (see scripts/build-server.mjs).
var version = "dev"

const defaultUpdateRepo = "diopratama99/TemanLabs-OS"

type releaseStatus struct {
	Current   string    `json:"current"`
	Latest    string    `json:"latest,omitempty"`
	Available bool      `json:"available"`
	Notes     string    `json:"notes,omitempty"`
	URL       string    `json:"url,omitempty"`
	Published time.Time `json:"published,omitzero"`
	Checked   time.Time `json:"checked,omitzero"`
	Error     string    `json:"error,omitempty"`
	Arch      string    `json:"arch"`

	binaryURL string
	sumsURL   string
}

var releases = struct {
	sync.Mutex
	last releaseStatus
}{}

func (s *server) releaseAPI() string {
	if u := os.Getenv("TEMANLABS_UPDATE_API"); u != "" {
		return u
	}
	repo := s.cfg.UpdateRepo
	if repo == "" {
		repo = defaultUpdateRepo
	}
	return "https://api.github.com/repos/" + repo + "/releases/latest"
}

// semver reads "v1.2.3" (or "1.2.3"); ok is false for anything else, e.g. a git hash build.
func semver(v string) (parts [3]int, ok bool) {
	v = strings.TrimPrefix(strings.TrimSpace(v), "v")
	if i := strings.IndexAny(v, "-+"); i >= 0 {
		v = v[:i]
	}
	fields := strings.Split(v, ".")
	if len(fields) != 3 {
		return parts, false
	}
	for i, f := range fields {
		n, err := strconv.Atoi(f)
		if err != nil {
			return parts, false
		}
		parts[i] = n
	}
	return parts, true
}

// newer: latest is a higher version than current; builds without a version always can update.
func newer(latest, current string) bool {
	l, okL := semver(latest)
	c, okC := semver(current)
	if !okL {
		return false
	}
	if !okC {
		return true
	}
	for i := range l {
		if l[i] != c[i] {
			return l[i] > c[i]
		}
	}
	return false
}

func (s *server) checkRelease(ctx context.Context) releaseStatus {
	st := releaseStatus{Current: version, Arch: runtime.GOARCH, Checked: time.Now()}
	req, _ := http.NewRequestWithContext(ctx, http.MethodGet, s.releaseAPI(), nil)
	req.Header.Set("Accept", "application/vnd.github+json")
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		st.Error = err.Error()
		return st
	}
	defer res.Body.Close()
	if res.StatusCode == http.StatusNotFound {
		st.Error = "no release published yet"
		return st
	}
	if res.StatusCode != http.StatusOK {
		st.Error = "GitHub: " + res.Status
		return st
	}
	var rel struct {
		Tag       string    `json:"tag_name"`
		Body      string    `json:"body"`
		HTMLURL   string    `json:"html_url"`
		Published time.Time `json:"published_at"`
		Assets    []struct {
			Name string `json:"name"`
			URL  string `json:"browser_download_url"`
		} `json:"assets"`
	}
	if err := json.NewDecoder(io.LimitReader(res.Body, 4<<20)).Decode(&rel); err != nil {
		st.Error = "unreadable release: " + err.Error()
		return st
	}
	st.Latest, st.Notes, st.URL, st.Published = rel.Tag, rel.Body, rel.HTMLURL, rel.Published
	for _, a := range rel.Assets {
		switch a.Name {
		case "temanlabsos-linux-" + runtime.GOARCH:
			st.binaryURL = a.URL
		case "SHA256SUMS":
			st.sumsURL = a.URL
		}
	}
	st.Available = newer(rel.Tag, version) && st.binaryURL != "" && st.sumsURL != ""
	return st
}

func (s *server) handleReleaseStatus(w http.ResponseWriter, r *http.Request) {
	releases.Lock()
	last := releases.last
	releases.Unlock()
	if r.URL.Query().Get("refresh") == "1" || last.Checked.IsZero() || time.Since(last.Checked) > 6*time.Hour {
		ctx, cancel := context.WithTimeout(r.Context(), 20*time.Second)
		defer cancel()
		last = s.checkRelease(ctx)
		releases.Lock()
		releases.last = last
		releases.Unlock()
	}
	writeJSON(w, http.StatusOK, last)
}

func download(ctx context.Context, url string, limit int64) ([]byte, error) {
	req, _ := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	res, err := (&http.Client{Timeout: 10 * time.Minute}).Do(req)
	if err != nil {
		return nil, err
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("download %s: %s", filepath.Base(url), res.Status)
	}
	return io.ReadAll(io.LimitReader(res.Body, limit))
}

func (s *server) handleSelfUpdate(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := context.WithTimeout(r.Context(), 20*time.Second)
	st := s.checkRelease(ctx)
	cancel()
	if !st.Available {
		msg := "TemanLabsOS is up to date."
		if st.Error != "" {
			msg = st.Error
		}
		writeError(w, http.StatusBadRequest, msg)
		return
	}
	exe, err := os.Executable()
	if err == nil {
		exe, err = filepath.EvalSymlinks(exe)
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	_, err = startFuncJob("self-update", "Updating TemanLabsOS to "+st.Latest, func(ctx context.Context, logf func(string, ...any)) error {
		logf("Downloading %s…", filepath.Base(st.binaryURL))
		bin, err := download(ctx, st.binaryURL, 200<<20)
		if err != nil {
			return err
		}
		sums, err := download(ctx, st.sumsURL, 1<<20)
		if err != nil {
			return err
		}
		sum := sha256.Sum256(bin)
		want := ""
		for _, line := range strings.Split(string(sums), "\n") {
			if f := strings.Fields(line); len(f) == 2 && strings.TrimPrefix(f[1], "*") == "temanlabsos-linux-"+runtime.GOARCH {
				want = f[0]
			}
		}
		if want == "" || !strings.EqualFold(want, hex.EncodeToString(sum[:])) {
			return errors.New("the download doesn't match SHA256SUMS; nothing was changed")
		}
		logf("Checksum OK (%s…).", want[:16])
		tmp := exe + ".new"
		if err := os.WriteFile(tmp, bin, 0o755); err != nil {
			return err
		}
		// Renaming over a running binary is safe on Linux: the old one stays open until exit.
		if err := os.Rename(tmp, exe); err != nil {
			return err
		}
		logf("Installed %s. Restarting…", st.Latest)
		go restartSelf()
		return nil
	})
	if err != nil {
		writeError(w, http.StatusConflict, err.Error())
		return
	}
	writeJSON(w, http.StatusAccepted, map[string]string{"job": "self-update"})
}

// restartSelf restarts the systemd service TemanLabsOS runs as, or exits so whatever started it
// can start the new binary.
func restartSelf() {
	time.Sleep(1500 * time.Millisecond)
	unit := ""
	if data, err := os.ReadFile("/proc/self/cgroup"); err == nil {
		for _, part := range strings.Split(strings.TrimSpace(string(data)), "/") {
			if strings.HasSuffix(part, ".service") {
				unit = part
			}
		}
	}
	if unit != "" && unit != "user@.service" {
		log.Printf("self-update: restarting %s", unit)
		_ = exec.Command("systemctl", "restart", "--no-block", unit).Run()
		return
	}
	log.Printf("self-update: not a systemd service; exiting so the new version can start")
	os.Exit(0)
}
