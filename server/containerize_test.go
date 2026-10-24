package main

import (
	"context"
	"encoding/json"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

// TestMoveToDockerAndBack moves a small Node app from a pm2 of its own into Docker and back.
// It needs root, Docker and Node: run with TL_MOVE_TEST=<path to node's bin dir>.
func TestMoveToDockerAndBack(t *testing.T) {
	nodeBin := os.Getenv("TL_MOVE_TEST")
	if nodeBin == "" {
		t.Skip("set TL_MOVE_TEST to Node's bin folder to run")
	}
	user := os.Getenv("TL_MOVE_USER")
	// Not t.TempDir: its parent is root's alone, and pm2 runs as the user.
	home, err := os.MkdirTemp("/tmp", "tl-move-")
	if err != nil {
		t.Fatal(err)
	}
	_ = os.Chmod(home, 0o755)
	t.Cleanup(func() { os.RemoveAll(home) })
	pm2Home := filepath.Join(home, "pm2")
	appDir := filepath.Join(home, "hello")
	_ = os.MkdirAll(appDir, 0o755)
	_ = os.WriteFile(filepath.Join(appDir, "server.js"), []byte(`require('http').createServer((q, s) => s.end('hello from ' + (process.env.WHERE || 'nowhere'))).listen(3999, '127.0.0.1')`), 0o644)
	exec.Command("chown", "-R", user, home).Run()
	env := []string{"PATH=" + nodeBin + ":/usr/bin:/bin", "PM2_HOME=" + pm2Home}
	pm2 := filepath.Join(nodeBin, "pm2")
	ctx := context.Background()
	pm2Of = func(context.Context, string) (string, []string, string, error) { return pm2, env, user, nil }
	t.Cleanup(func() {
		pm2Of = systemPM2
		runPM2(context.Background(), pm2, env, user, "kill")
		exec.Command("docker", "compose", "-p", "tl-move-test", "down").Run()
		os.RemoveAll(filepath.Join(appDataRoot, "AppData", "tl-move-test"))
	})
	cmd := exec.Command("runuser", "-u", user, "--", pm2, "start", filepath.Join(appDir, "server.js"), "--name", "tl-move-test", "--cwd", appDir)
	cmd.Env = append(os.Environ(), append(env, "WHERE=pm2-env")...)
	if out, err := cmd.CombinedOutput(); err != nil {
		t.Fatalf("pm2 start: %v %s", err, out)
	}
	get := func() string {
		res, err := http.Get("http://127.0.0.1:3999/")
		if err != nil {
			return "error: " + err.Error()
		}
		defer res.Body.Close()
		var b strings.Builder
		buf := make([]byte, 200)
		n, _ := res.Body.Read(buf)
		b.Write(buf[:n])
		return b.String()
	}
	if err := waitAnswer(ctx, "http", 3999, "/", 20*time.Second); err != nil {
		t.Fatal(err)
	}

	state := t.TempDir()
	s := &server{cfg: &Config{Root: "/", StateDir: state}, native: newNativeApps(state)}
	port := 3999
	a := &app{ID: "native-3999", Name: "Hello", Source: "native", Unit: "pm2-test.service", Port: &port, Scheme: "http", Path: "/"}
	plan, err := s.planMove(ctx, a)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(plan.compose), "WHERE: pm2-env") || !strings.Contains(string(plan.compose), "network_mode: host") {
		t.Fatalf("compose:\n%s", plan.compose)
	}
	if strings.Contains(string(plan.compose), "PM2_HOME") || strings.Contains(string(plan.compose), "PATH:") {
		t.Fatalf("shell environment leaked into the compose file:\n%s", plan.compose)
	}

	// The move, as the desktop starts it.
	run := func(h http.HandlerFunc, pathID, val, kind string) {
		t.Helper()
		r, _ := http.NewRequest("POST", "/", nil)
		r.SetPathValue(pathID, val)
		w := &recorder{header: http.Header{}}
		h(w, r)
		if w.code != http.StatusAccepted {
			t.Fatalf("%s: %d %s", kind, w.code, w.body.String())
		}
		for jobRunning(kind) {
			time.Sleep(300 * time.Millisecond)
		}
		jobs.Lock()
		j := jobs.byKind[kind].snapshot()
		jobs.Unlock()
		if j.Exit != 0 {
			t.Fatalf("%s failed:\n%s", kind, strings.Join(j.Log, "\n"))
		}
	}
	s.store = nil
	findAppHook = func(id string) *app { return a }
	t.Cleanup(func() { findAppHook = nil })
	run(s.handleMoveToDocker, "id", a.ID, "move-native-3999")
	if got := get(); got != "hello from pm2-env" {
		t.Fatalf("after the move: %q", got)
	}
	if out, _ := exec.Command("docker", "ps", "--filter", "name=tl-move-test", "--format", "{{.Names}}").Output(); strings.TrimSpace(string(out)) != "tl-move-test" {
		t.Fatalf("no container: %q", out)
	}
	if out, _ := runPM2(ctx, pm2, env, user, "jlist"); strings.Contains(string(out), "tl-move-test") {
		t.Fatal("still in pm2")
	}
	var list []moved
	data, _ := os.ReadFile(filepath.Join(state, containerizedFile))
	_ = json.Unmarshal(data, &list)
	if len(list) != 1 || list[0].Project != "tl-move-test" {
		t.Fatalf("moved list: %s", data)
	}

	run(s.handleMoveBack, "project", "tl-move-test", "move-tl-move-test")
	if err := waitAnswer(ctx, "http", 3999, "/", 20*time.Second); err != nil {
		t.Fatal(err)
	}
	if out, _ := runPM2(ctx, pm2, env, user, "jlist"); !strings.Contains(string(out), "tl-move-test") {
		t.Fatal("not back in pm2")
	}
	if out, _ := exec.Command("docker", "ps", "-q", "--filter", "name=tl-move-test").Output(); len(strings.TrimSpace(string(out))) > 0 {
		t.Fatal("container still running")
	}
	if got := get(); got != "hello from pm2-env" {
		t.Fatalf("back in pm2 without its environment: %q", got)
	}
}

type recorder struct {
	header http.Header
	code   int
	body   strings.Builder
}

func (r *recorder) Header() http.Header         { return r.header }
func (r *recorder) Write(b []byte) (int, error) { return r.body.Write(b) }
func (r *recorder) WriteHeader(c int)           { r.code = c }
