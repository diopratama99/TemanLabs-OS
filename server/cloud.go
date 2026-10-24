package main

import (
	"bufio"
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"
)

// Cloud drives with rclone, mounted under /DATA/Cloud/<name> by a systemd service each, so they
// come back after a restart. Google Drive, Dropbox and OneDrive sign in through rclone's own
// OAuth apps: rclone listens on the server's 127.0.0.1:53682, which the user's browser can't
// reach, so the user pastes the address the provider sent them to and TemanLabsOS hands it on.

const (
	cloudRoot      = appDataRoot + "/Cloud"
	authListen     = "127.0.0.1:53682"
	authSessionTTL = 10 * time.Minute
)

var (
	remoteName  = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9_-]{0,31}$`)
	paramKey    = regexp.MustCompile(`^[a-z][a-z0-9_]{0,40}$`)
	authURLLine = regexp.MustCompile(`http://127\.0\.0\.1:53682/auth\?state=[A-Za-z0-9_-]+`)
)

// cloudProvider is what the Connect form shows for a provider: its rclone type, and the fields
// to ask for when it doesn't sign in through OAuth.
type cloudProvider struct {
	Type   string       `json:"type"`
	Name   string       `json:"name"`
	OAuth  bool         `json:"oauth,omitempty"`
	Fields []cloudField `json:"fields,omitempty"`
	// Fixed parameters rclone needs for this provider.
	fixed map[string]string
}

type cloudField struct {
	Key         string `json:"key"`
	Label       string `json:"label"`
	Placeholder string `json:"placeholder,omitempty"`
	Secret      bool   `json:"secret,omitempty"`
	Optional    bool   `json:"optional,omitempty"`
}

var cloudProviders = []cloudProvider{
	{Type: "drive", Name: "Google Drive", OAuth: true, fixed: map[string]string{"scope": "drive"}},
	{Type: "dropbox", Name: "Dropbox", OAuth: true},
	{Type: "onedrive", Name: "OneDrive", OAuth: true},
	{Type: "webdav", Name: "WebDAV (Nextcloud, ownCloud…)", Fields: []cloudField{
		{Key: "url", Label: "Address", Placeholder: "https://cloud.example.com/remote.php/dav/files/me"},
		{Key: "user", Label: "User"},
		{Key: "pass", Label: "Password", Secret: true},
		{Key: "vendor", Label: "Server type", Placeholder: "nextcloud, owncloud or other", Optional: true},
	}},
	{Type: "sftp", Name: "SFTP (another server)", Fields: []cloudField{
		{Key: "host", Label: "Host", Placeholder: "server.example.com"},
		{Key: "port", Label: "Port", Placeholder: "22", Optional: true},
		{Key: "user", Label: "User"},
		{Key: "pass", Label: "Password", Secret: true},
	}},
	{Type: "ftp", Name: "FTP", Fields: []cloudField{
		{Key: "host", Label: "Host"},
		{Key: "port", Label: "Port", Placeholder: "21", Optional: true},
		{Key: "user", Label: "User"},
		{Key: "pass", Label: "Password", Secret: true},
	}},
	{Type: "s3", Name: "S3 (AWS, Cloudflare R2, MinIO, Wasabi…)", Fields: []cloudField{
		{Key: "provider", Label: "Provider", Placeholder: "AWS, Cloudflare, Minio, Wasabi or Other"},
		{Key: "access_key_id", Label: "Access key ID"},
		{Key: "secret_access_key", Label: "Secret access key", Secret: true},
		{Key: "endpoint", Label: "Endpoint", Placeholder: "Leave empty for AWS", Optional: true},
		{Key: "region", Label: "Region", Placeholder: "us-east-1", Optional: true},
	}},
	{Type: "smb", Name: "SMB (Windows share, NAS)", Fields: []cloudField{
		{Key: "host", Label: "Host"},
		{Key: "user", Label: "User", Optional: true},
		{Key: "pass", Label: "Password", Secret: true, Optional: true},
	}},
}

func providerFor(t string) *cloudProvider {
	for i := range cloudProviders {
		if cloudProviders[i].Type == t {
			return &cloudProviders[i]
		}
	}
	return nil
}

type cloudDrives struct {
	config string
	cache  string
	owner  *owner

	mu   sync.Mutex
	auth *authSession
}

type authSession struct {
	id      string
	kind    string
	cmd     *exec.Cmd
	mu      sync.Mutex
	output  []string
	done    chan struct{}
	started time.Time
}

func newCloudDrives(stateDir string, o *owner) *cloudDrives {
	return &cloudDrives{config: filepath.Join(stateDir, "rclone.conf"), cache: "/var/cache/temanlabsos-rclone", owner: o}
}

// rclone runs one rclone command; none may take longer than a minute, so a question rclone
// waits on (it shouldn't, with --non-interactive) can't hang a request.
func (c *cloudDrives) rclone(ctx context.Context, args ...string) ([]byte, error) {
	ctx, cancel := context.WithTimeout(ctx, time.Minute)
	defer cancel()
	return exec.CommandContext(ctx, "rclone", append(args, "--config", c.config)...).CombinedOutput()
}

func unitName(remote string) string { return "temanlabs-cloud-" + remote + ".service" }

type cloudRemote struct {
	Name    string `json:"name"`
	Type    string `json:"type"`
	Mount   string `json:"mount"`
	Mounted bool   `json:"mounted"`
	// The mount service's state: active, failed, inactive…
	Service string `json:"service"`
	Error   string `json:"error,omitempty"`
}

func (s *server) handleCloud(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := context.WithTimeout(r.Context(), 20*time.Second)
	defer cancel()
	out := map[string]any{"providers": cloudProviders, "remotes": []cloudRemote{}}
	if _, err := exec.LookPath("rclone"); err != nil {
		out["rclone"] = false
		writeJSON(w, http.StatusOK, out)
		return
	}
	out["rclone"] = true
	data, err := s.cloud.rclone(ctx, "config", "dump")
	if err != nil {
		writeJSON(w, http.StatusOK, out)
		return
	}
	var dump map[string]map[string]string
	_ = json.Unmarshal(data, &dump)
	remotes := []cloudRemote{}
	for name, cfg := range dump {
		mount := filepath.Join(cloudRoot, name)
		rem := cloudRemote{Name: name, Type: cfg["type"], Mount: mount, Mounted: mountedAt(mount)}
		state, _ := exec.CommandContext(ctx, "systemctl", "is-active", unitName(name)).Output()
		rem.Service = strings.TrimSpace(string(state))
		if rem.Service == "failed" {
			logs, _ := exec.CommandContext(ctx, "journalctl", "-u", unitName(name), "-n", "3", "--no-pager", "-o", "cat").Output()
			rem.Error = lastLines(string(logs), 2)
		}
		remotes = append(remotes, rem)
	}
	sort.Slice(remotes, func(i, j int) bool { return remotes[i].Name < remotes[j].Name })
	out["remotes"] = remotes
	writeJSON(w, http.StatusOK, out)
}

// ----- OAuth sign-in -----

func (s *server) handleCloudAuth(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Type string `json:"type"`
	}
	if decodeJSON(r, &body) != nil {
		writeError(w, http.StatusBadRequest, "invalid request")
		return
	}
	p := providerFor(body.Type)
	if p == nil || !p.OAuth {
		writeError(w, http.StatusBadRequest, "that provider doesn't sign in through a browser")
		return
	}
	c := s.cloud
	c.mu.Lock()
	if old := c.auth; old != nil && old.cmd.Process != nil {
		_ = old.cmd.Process.Kill()
	}
	c.mu.Unlock()

	cmd := exec.Command("rclone", "authorize", p.Type, "--auth-no-open-browser")
	stdout, _ := cmd.StdoutPipe()
	cmd.Stderr = cmd.Stdout
	if err := cmd.Start(); err != nil {
		writeError(w, http.StatusBadGateway, "rclone: "+err.Error())
		return
	}
	id := make([]byte, 8)
	_, _ = rand.Read(id)
	sess := &authSession{id: hex.EncodeToString(id), kind: p.Type, cmd: cmd, done: make(chan struct{}), started: time.Now()}
	found := make(chan string, 1)
	go func() {
		scanner := bufio.NewScanner(stdout)
		scanner.Buffer(make([]byte, 64<<10), 1<<20)
		for scanner.Scan() {
			line := scanner.Text()
			sess.mu.Lock()
			sess.output = append(sess.output, line)
			sess.mu.Unlock()
			if m := authURLLine.FindString(line); m != "" {
				select {
				case found <- m:
				default:
				}
			}
		}
		_ = cmd.Wait()
		close(sess.done)
	}()
	go func() {
		select {
		case <-sess.done:
		case <-time.After(authSessionTTL):
			_ = cmd.Process.Kill()
		}
	}()

	var local string
	select {
	case local = <-found:
	case <-sess.done:
		writeError(w, http.StatusBadGateway, "rclone stopped: "+strings.Join(sess.output, " "))
		return
	case <-time.After(15 * time.Second):
		_ = cmd.Process.Kill()
		writeError(w, http.StatusGatewayTimeout, "rclone didn't start its sign-in (is port 53682 in use?)")
		return
	}
	// rclone's /auth page only redirects to the provider; follow it here and give the user the
	// provider's address directly.
	client := &http.Client{Timeout: 10 * time.Second, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}
	res, err := client.Get(local)
	if err != nil {
		_ = cmd.Process.Kill()
		writeError(w, http.StatusBadGateway, err.Error())
		return
	}
	res.Body.Close()
	provider := res.Header.Get("Location")
	if !strings.HasPrefix(provider, "https://") {
		_ = cmd.Process.Kill()
		writeError(w, http.StatusBadGateway, "rclone didn't redirect to the provider")
		return
	}
	c.mu.Lock()
	c.auth = sess
	c.mu.Unlock()
	writeJSON(w, http.StatusOK, map[string]string{"session": sess.id, "url": provider})
}

// finishAuth passes the provider's redirect (pasted by the user) to rclone and returns the token.
func (c *cloudDrives) finishAuth(sessionID, pasted string) (string, string, error) {
	c.mu.Lock()
	sess := c.auth
	c.mu.Unlock()
	if sess == nil || sess.id != sessionID {
		return "", "", errors.New("the sign-in expired; start it again")
	}
	u, err := url.Parse(strings.TrimSpace(pasted))
	if err != nil || (u.Host != authListen && u.Host != "localhost:53682") || u.Query().Get("state") == "" {
		return "", "", errors.New("paste the whole address from the page that didn't open (it starts with http://127.0.0.1:53682/ or http://localhost:53682/)")
	}
	if e := u.Query().Get("error"); e != "" {
		return "", "", fmt.Errorf("the provider said: %s", e)
	}
	client := &http.Client{Timeout: 30 * time.Second}
	res, err := client.Get("http://" + authListen + "/?" + u.RawQuery)
	if err != nil {
		return "", "", fmt.Errorf("rclone isn't waiting any more (start the sign-in again): %w", err)
	}
	res.Body.Close()
	select {
	case <-sess.done:
	case <-time.After(30 * time.Second):
		return "", "", errors.New("rclone didn't finish signing in")
	}
	sess.mu.Lock()
	text := strings.Join(sess.output, "\n")
	sess.mu.Unlock()
	start := strings.Index(text, "--->")
	end := strings.Index(text, "<---End paste")
	if start < 0 || end < start {
		return "", "", errors.New("sign-in failed: " + lastLines(text, 2))
	}
	token := strings.TrimSpace(text[start+4 : end])
	c.mu.Lock()
	c.auth = nil
	c.mu.Unlock()
	return sess.kind, token, nil
}

// ----- Connect, mount, remove -----

func (s *server) handleAddCloud(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Name     string            `json:"name"`
		Type     string            `json:"type"`
		Params   map[string]string `json:"params"`
		Session  string            `json:"session"`
		Redirect string            `json:"redirect"`
	}
	if decodeJSON(r, &body) != nil || !remoteName.MatchString(body.Name) {
		writeError(w, http.StatusBadRequest, "the name must be letters, numbers, - or _")
		return
	}
	p := providerFor(body.Type)
	if p == nil {
		writeError(w, http.StatusBadRequest, "unknown provider")
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 2*time.Minute)
	defer cancel()
	c := s.cloud
	if data, err := c.rclone(ctx, "config", "dump"); err == nil {
		var dump map[string]map[string]string
		if json.Unmarshal(data, &dump) == nil && dump[body.Name] != nil {
			// Set up earlier but never mounted (e.g. the server restarted mid-way): just mount it.
			if _, err := os.Stat(filepath.Join("/etc/systemd/system", unitName(body.Name))); errors.Is(err, os.ErrNotExist) && dump[body.Name]["type"] == p.Type {
				if err := c.mount(ctx, body.Name); err != nil {
					writeError(w, http.StatusBadGateway, err.Error())
					return
				}
				w.WriteHeader(http.StatusNoContent)
				return
			}
			writeError(w, http.StatusConflict, "a cloud drive called "+body.Name+" already exists")
			return
		}
	}

	params := map[string]string{}
	for k, v := range p.fixed {
		params[k] = v
	}
	if p.OAuth {
		kind, token, err := c.finishAuth(body.Session, body.Redirect)
		if err != nil {
			writeError(w, http.StatusBadRequest, err.Error())
			return
		}
		if kind != p.Type {
			writeError(w, http.StatusBadRequest, "that sign-in was for another provider")
			return
		}
		params["token"] = token
	} else {
		for _, f := range p.Fields {
			v := strings.TrimSpace(body.Params[f.Key])
			if v == "" && !f.Optional {
				writeError(w, http.StatusBadRequest, f.Label+" is required")
				return
			}
			if strings.ContainsAny(v, "\n\r") || !paramKey.MatchString(f.Key) {
				writeError(w, http.StatusBadRequest, "invalid "+f.Label)
				return
			}
			if f.Key == "port" && v != "" {
				if n, err := strconv.Atoi(v); err != nil || n < 1 || n > 65535 {
					writeError(w, http.StatusBadRequest, "invalid port")
					return
				}
			}
			if v != "" {
				params[f.Key] = v
			}
		}
	}

	if err := c.create(ctx, body.Name, p.Type, params); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	// A quick look proves the credentials before anything is mounted.
	if out, err := c.rclone(ctx, "lsd", body.Name+":", "--max-depth", "1"); err != nil {
		_, _ = c.rclone(context.Background(), "config", "delete", body.Name)
		writeError(w, http.StatusBadRequest, "couldn't connect: "+lastLines(string(out), 2))
		return
	}
	if err := c.mount(ctx, body.Name); err != nil {
		writeError(w, http.StatusBadGateway, err.Error())
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// create runs `rclone config create`, answering any follow-up question (OneDrive's "which
// drive?") with rclone's default.
func (c *cloudDrives) create(ctx context.Context, name, kind string, params map[string]string) error {
	args := []string{"config", "create", name, kind}
	for k, v := range params {
		args = append(args, k+"="+v)
	}
	args = append(args, "--non-interactive")
	out, err := c.rclone(ctx, args...)
	for i := 0; i < 8; i++ {
		if err != nil {
			return fmt.Errorf("rclone: %s", lastLines(string(out), 2))
		}
		var q struct {
			State  string `json:"State"`
			Option *struct {
				Default  any `json:"Default"`
				Examples []struct {
					Value string `json:"Value"`
				} `json:"Examples"`
			} `json:"Option"`
			Error string `json:"Error"`
		}
		if json.Unmarshal(out, &q) != nil || q.State == "" {
			return nil
		}
		if q.Error != "" {
			return errors.New(q.Error)
		}
		answer := ""
		if q.Option != nil {
			answer = fmt.Sprint(q.Option.Default)
			if (answer == "" || answer == "<nil>") && len(q.Option.Examples) > 0 {
				answer = q.Option.Examples[0].Value
			}
		}
		out, err = c.rclone(ctx, "config", "update", name, "--continue", "--state", q.State, "--result", answer, "--non-interactive")
	}
	return nil
}

func (c *cloudDrives) mount(ctx context.Context, name string) error {
	target := filepath.Join(cloudRoot, name)
	if err := os.MkdirAll(target, 0o755); err != nil {
		return err
	}
	uid, gid := 1000, 1000
	if c.owner != nil {
		uid, gid = c.owner.uid, c.owner.gid
	}
	unit := fmt.Sprintf(`[Unit]
Description=TemanLabsOS cloud drive %[1]s
After=network-online.target
Wants=network-online.target

[Service]
Type=notify
ExecStartPre=/bin/mkdir -p %[2]s
ExecStart=/usr/bin/rclone mount %[1]s: %[2]s --config %[3]s --allow-other --uid %[4]d --gid %[5]d --umask 002 --vfs-cache-mode writes --vfs-cache-max-size 2G --cache-dir %[6]s --dir-cache-time 5m
ExecStop=/bin/fusermount -uz %[2]s
Restart=on-failure
RestartSec=10

[Install]
WantedBy=multi-user.target
`, name, target, c.config, uid, gid, c.cache)
	if err := os.WriteFile(filepath.Join("/etc/systemd/system", unitName(name)), []byte(unit), 0o644); err != nil {
		return err
	}
	_ = exec.CommandContext(ctx, "systemctl", "daemon-reload").Run()
	if out, err := exec.CommandContext(ctx, "systemctl", "enable", "--now", unitName(name)).CombinedOutput(); err != nil {
		return fmt.Errorf("mount service: %s", lastLines(string(out), 2))
	}
	return nil
}

func (s *server) handleCloudAction(w http.ResponseWriter, r *http.Request) {
	name, action := r.PathValue("name"), r.PathValue("action")
	if !remoteName.MatchString(name) {
		writeError(w, http.StatusBadRequest, "invalid name")
		return
	}
	verb := map[string]string{"mount": "start", "unmount": "stop", "restart": "restart"}[action]
	if verb == "" {
		writeError(w, http.StatusNotFound, "unknown action")
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), time.Minute)
	defer cancel()
	// A remote without its mount service yet gets one.
	if _, err := os.Stat(filepath.Join("/etc/systemd/system", unitName(name))); errors.Is(err, os.ErrNotExist) && action == "mount" {
		if err := s.cloud.mount(ctx, name); err != nil {
			writeError(w, http.StatusBadGateway, err.Error())
			return
		}
		w.WriteHeader(http.StatusNoContent)
		return
	}
	if out, err := exec.CommandContext(ctx, "systemctl", verb, unitName(name)).CombinedOutput(); err != nil {
		writeError(w, http.StatusBadGateway, lastLines(string(out), 2))
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *server) handleRemoveCloud(w http.ResponseWriter, r *http.Request) {
	name := r.PathValue("name")
	if !remoteName.MatchString(name) {
		writeError(w, http.StatusBadRequest, "invalid name")
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), time.Minute)
	defer cancel()
	unit := unitName(name)
	_ = exec.CommandContext(ctx, "systemctl", "disable", "--now", unit).Run()
	_ = os.Remove(filepath.Join("/etc/systemd/system", unit))
	_ = exec.CommandContext(ctx, "systemctl", "daemon-reload").Run()
	target := filepath.Join(cloudRoot, name)
	if mountedAt(target) {
		_ = exec.CommandContext(ctx, "fusermount", "-uz", target).Run()
	}
	// The files are in the cloud; the local folder is only the mount point.
	_ = os.Remove(target)
	if out, err := s.cloud.rclone(ctx, "config", "delete", name); err != nil {
		writeError(w, http.StatusBadGateway, lastLines(string(out), 2))
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
