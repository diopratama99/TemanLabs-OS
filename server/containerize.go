package main

import (
	"bufio"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"slices"
	"strconv"
	"strings"
	"sync"
	"time"

	"gopkg.in/yaml.v3"
)

// Moving a native app into Docker: a Node.js app that pm2 runs (a Next.js site, an API) gets a
// compose project of its own that runs the very same files with the same Node version, as the
// same user, on the host's network (so it listens where it did and still reaches localhost).
// Nothing is copied or rebuilt: the project folder is mounted at its own path. The switch is
// checked before it's kept, and undone if the container doesn't answer; Move Back undoes it
// later too.

const containerizedFile = "containerized.json"

// pm2Proc is what `pm2 jlist` says about one process.
type pm2Proc struct {
	Name string `json:"name"`
	PID  int    `json:"pid"`
	Env  struct {
		Status      string         `json:"status"`
		ExecPath    string         `json:"pm_exec_path"`
		Args        []string       `json:"args"`
		Interpreter string         `json:"exec_interpreter"`
		Cwd         string         `json:"pm_cwd"`
		NodeVersion string         `json:"node_version"`
		Env         map[string]any `json:"env"`
	} `json:"pm2_env"`
}

// moved remembers how an app ran before, to move it back.
type moved struct {
	App         string   `json:"app"`
	Name        string   `json:"name"`
	Project     string   `json:"project"`
	Compose     string   `json:"compose"`
	Unit        string   `json:"unit"`
	ExecPath    string   `json:"execPath"`
	Args        []string `json:"args"`
	Interpreter string   `json:"interpreter"`
	Cwd         string   `json:"cwd"`
	// The app's own environment, given back to pm2 on the way back.
	Env   map[string]string `json:"env,omitempty"`
	Moved time.Time         `json:"moved"`
}

var containerizeMu sync.Mutex

func (s *server) movedApps() []moved {
	var list []moved
	if data, err := os.ReadFile(filepath.Join(s.cfg.StateDir, containerizedFile)); err == nil {
		_ = json.Unmarshal(data, &list)
	}
	return list
}

func (s *server) saveMoved(list []moved) error {
	data, _ := json.MarshalIndent(list, "", "  ")
	return os.WriteFile(filepath.Join(s.cfg.StateDir, containerizedFile), data, 0o600)
}

// pm2Of finds the pm2 that runs a unit like pm2-leykopin.service: its program, and the
// environment the unit gives it.
// pm2Of is a variable so a test can point it at a pm2 of its own.
var pm2Of = systemPM2

func systemPM2(ctx context.Context, unit string) (bin string, env []string, user string, err error) {
	if !strings.HasPrefix(unit, "pm2-") {
		return "", nil, "", errors.New("only apps run by pm2 can be moved for now")
	}
	user = strings.TrimSuffix(strings.TrimPrefix(unit, "pm2-"), ".service")
	out, err := exec.CommandContext(ctx, "systemctl", "show", unit, "-p", "ExecStart", "-p", "Environment", "--value").Output()
	if err != nil {
		return "", nil, "", err
	}
	text := string(out)
	if m := regexp.MustCompile(`path=(\S+/pm2)\b`).FindStringSubmatch(text); m != nil {
		bin = m[1]
	} else if m := regexp.MustCompile(`(/\S+/bin/pm2)\b`).FindStringSubmatch(text); m != nil {
		bin = m[1]
	}
	if bin == "" {
		return "", nil, "", errors.New("couldn't find pm2 in " + unit)
	}
	for _, f := range strings.Fields(text) {
		if strings.HasPrefix(f, "PATH=") || strings.HasPrefix(f, "PM2_HOME=") {
			env = append(env, f)
		}
	}
	return bin, env, user, nil
}

func runPM2(ctx context.Context, bin string, env []string, user string, args ...string) ([]byte, error) {
	cmd := exec.CommandContext(ctx, "runuser", append([]string{"-u", user, "--", bin}, args...)...)
	cmd.Env = append(os.Environ(), env...)
	out, err := cmd.Output()
	if err != nil {
		var ee *exec.ExitError
		if errors.As(err, &ee) {
			return out, fmt.Errorf("pm2 %s: %s", args[0], strings.TrimSpace(lastLines(string(ee.Stderr), 3)))
		}
	}
	return out, err
}

// listenerPID is the process listening on a TCP port.
func listenerPID(ctx context.Context, port int) int {
	out, _ := exec.CommandContext(ctx, "ss", "-Htlnp", fmt.Sprintf("sport = :%d", port)).Output()
	if m := ssProcess.FindStringSubmatch(string(out)); m != nil {
		pid, _ := strconv.Atoi(m[2])
		return pid
	}
	return 0
}

// parentOf reads a process's parent.
func parentOf(pid int) int {
	data, err := os.ReadFile(fmt.Sprintf("/proc/%d/stat", pid))
	if err != nil {
		return 0
	}
	// pid (comm) state ppid …; comm may hold spaces and parentheses.
	f := strings.Fields(string(data[strings.LastIndexByte(string(data), ')')+1:]))
	if len(f) < 2 {
		return 0
	}
	ppid, _ := strconv.Atoi(f[1])
	return ppid
}

func procIDs(pid int) (uid, gid string) {
	f, err := os.Open(fmt.Sprintf("/proc/%d/status", pid))
	if err != nil {
		return "", ""
	}
	defer f.Close()
	sc := bufio.NewScanner(f)
	for sc.Scan() {
		if v, ok := strings.CutPrefix(sc.Text(), "Uid:"); ok {
			uid = strings.Fields(v)[0]
		}
		if v, ok := strings.CutPrefix(sc.Text(), "Gid:"); ok {
			gid = strings.Fields(v)[0]
		}
	}
	return uid, gid
}

// Environment a login shell or pm2 puts there; the app's own settings are what's left.
var shellEnv = regexp.MustCompile(`^(PATH|HOME|PWD|OLDPWD|SHELL|USER|LOGNAME|LANG|LANGUAGE|TERM|SHLVL|MAIL|MOTD_SHOWN|_|HOSTNAME|INVOCATION_ID|JOURNAL_STREAM|SYSTEMD_EXEC_PID|MANAGERPID|NOTIFY_SOCKET|COLORTERM|EDITOR|LS_COLORS|LESSOPEN|LESSCLOSE|name|pm_.*|PM2_.*|NVM_.*|NODE_APP_INSTANCE|unique_id|status|exit_code|version|namespace|instances|exec_mode|autorestart|watch|.*_INCLUDE_PATH|npm_.*|XDG_.*|DBUS_.*|SSH_.*|LC_.*|DISPLAY|WAYLAND_DISPLAY)$`)

type movePlan struct {
	proc    pm2Proc
	bin     string
	env     []string
	user    string
	uid     string
	gid     string
	project string
	dir     string
	compose []byte
	// The app's own environment (without the shell's).
	appEnv map[string]string
}

var projectName = regexp.MustCompile(`[^a-z0-9_-]+`)

// planMove works out how an app runs now and writes nothing.
func (s *server) planMove(ctx context.Context, a *app) (*movePlan, error) {
	if a.Source != "native" {
		return nil, errors.New("it already runs in Docker")
	}
	if a.Port == nil {
		return nil, errors.New("it has no port to find its process by")
	}
	bin, env, user, err := pm2Of(ctx, a.Unit)
	if err != nil {
		return nil, err
	}
	out, err := runPM2(ctx, bin, env, user, "jlist")
	if err != nil {
		return nil, err
	}
	var procs []pm2Proc
	if err := json.Unmarshal(out, &procs); err != nil {
		return nil, fmt.Errorf("pm2 jlist: %w", err)
	}
	// The listener, or one of its parents, is the pm2 process.
	pid := listenerPID(ctx, *a.Port)
	var proc *pm2Proc
	for p := pid; p > 1 && proc == nil; p = parentOf(p) {
		for i := range procs {
			if procs[i].PID == p {
				proc = &procs[i]
			}
		}
	}
	if proc == nil {
		return nil, fmt.Errorf("no pm2 process listens on port %d", *a.Port)
	}
	if filepath.Base(proc.Env.Interpreter) != "node" {
		return nil, fmt.Errorf("%s isn't a Node.js app (it runs with %s)", proc.Name, proc.Env.Interpreter)
	}
	major, _, _ := strings.Cut(strings.TrimPrefix(proc.Env.NodeVersion, "v"), ".")
	if _, err := strconv.Atoi(major); err != nil {
		return nil, errors.New("couldn't tell its Node.js version")
	}
	uid, gid := procIDs(pid)
	plan := &movePlan{proc: *proc, bin: bin, env: env, user: user, uid: uid, gid: gid}
	plan.project = strings.Trim(projectName.ReplaceAllString(strings.ToLower(proc.Name), "-"), "-")
	if plan.project == "" {
		plan.project = "app"
	}
	plan.dir = filepath.Join(appDataRoot, "AppData", plan.project)

	appEnv := map[string]string{}
	for k, v := range proc.Env.Env {
		if str, ok := v.(string); ok && !shellEnv.MatchString(k) {
			appEnv[k] = str
		}
	}
	plan.appEnv = appEnv
	containerEnv := map[string]string{"HOME": "/tmp"}
	for k, v := range appEnv {
		containerEnv[k] = v
	}
	cwd := proc.Env.Cwd
	svc := map[string]any{
		"image":          fmt.Sprintf("node:%s-bookworm-slim", major),
		"container_name": plan.project,
		"user":           uid + ":" + gid,
		"working_dir":    cwd,
		"command":        append([]string{"node", proc.Env.ExecPath}, proc.Env.Args...),
		"environment":    containerEnv,
		"volumes":        []string{cwd + ":" + cwd},
		"network_mode":   "host",
		"restart":        "unless-stopped",
		"labels": map[string]string{
			labelName: a.Name, labelPort: strconv.Itoa(*a.Port), labelScheme: a.Scheme, labelPath: a.Path,
		},
	}
	// A native app's icon is served from its native record, which goes with the move.
	if a.IconURL != "" && !strings.HasPrefix(a.IconURL, "/api/") {
		svc["labels"].(map[string]string)[labelIcon] = a.IconURL
	}
	// The app's own folder outside the project (a ../shared, an upload dir) isn't seen;
	// the files it reads inside the project are.
	doc := map[string]any{"name": plan.project, "services": map[string]any{plan.project: svc}}
	plan.compose, err = yaml.Marshal(doc)
	if err != nil {
		return nil, err
	}
	plan.compose = append([]byte("# Moved from pm2 by TemanLabsOS. The app runs from "+cwd+" as before.\n"), plan.compose...)
	return plan, nil
}

// waitAnswer asks the port until something answers, as the health check does.
func waitAnswer(ctx context.Context, scheme string, port int, path string, limit time.Duration) error {
	deadline := time.Now().Add(limit)
	if scheme != "https" {
		scheme = "http"
	}
	url := fmt.Sprintf("%s://127.0.0.1:%d%s", scheme, port, path)
	for time.Now().Before(deadline) {
		req, _ := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
		if res, err := healthClient.Do(req); err == nil {
			res.Body.Close()
			if res.StatusCode < 500 {
				return nil
			}
		}
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-time.After(2 * time.Second):
		}
	}
	return fmt.Errorf("nothing answered on port %d within %s", port, limit)
}

func waitPortFree(ctx context.Context, port int, limit time.Duration) {
	for deadline := time.Now().Add(limit); time.Now().Before(deadline) && listenerPID(ctx, port) != 0; {
		time.Sleep(500 * time.Millisecond)
	}
}

func (s *server) handleMovePreview(w http.ResponseWriter, r *http.Request) {
	a := s.appOr404(w, r)
	if a == nil {
		return
	}
	plan, err := s.planMove(r.Context(), a)
	if err != nil {
		writeJSON(w, http.StatusOK, map[string]any{"possible": false, "reason": err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"possible": true, "name": plan.proc.Name, "project": plan.project, "folder": plan.proc.Env.Cwd, "node": plan.proc.Env.NodeVersion, "compose": string(plan.compose)})
}

// handleMoveToDocker switches an app over: pull the Node image (while the app still runs), stop
// it in pm2, start the container, and keep that only once it answers.
func (s *server) handleMoveToDocker(w http.ResponseWriter, r *http.Request) {
	a := s.appOr404(w, r)
	if a == nil {
		return
	}
	plan, err := s.planMove(r.Context(), a)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	kind := "move-" + a.ID
	_, err = startFuncJob(kind, "Moving "+a.Name+" to Docker", func(ctx context.Context, logf func(string, ...any)) error {
		containerizeMu.Lock()
		defer containerizeMu.Unlock()
		if err := os.MkdirAll(plan.dir, 0o755); err != nil {
			return err
		}
		composePath := filepath.Join(plan.dir, "docker-compose.yml")
		// The app's settings may hold secrets.
		if err := os.WriteFile(composePath, plan.compose, 0o600); err != nil {
			return err
		}
		ref := &composeRef{project: plan.project, files: []string{composePath}, dir: plan.dir}
		logf("Wrote %s.", composePath)
		logf("Downloading Node.js %s…", plan.proc.Env.NodeVersion)
		if out, err := ref.run(ctx, "pull"); err != nil {
			return fmt.Errorf("couldn't download the image: %s", lastLines(string(out), 3))
		}
		name := plan.proc.Name
		logf("Stopping %s in pm2…", name)
		if _, err := runPM2(ctx, plan.bin, plan.env, plan.user, "stop", name); err != nil {
			return err
		}
		waitPortFree(ctx, *a.Port, 20*time.Second)
		rollback := func(why error) error {
			logf("It didn't work (%v); going back to pm2…", why)
			_, _ = ref.run(context.Background(), "down")
			if _, err := runPM2(context.Background(), plan.bin, plan.env, plan.user, "start", name); err != nil {
				return fmt.Errorf("%v, and starting it in pm2 again failed too: %v", why, err)
			}
			logf("%s runs in pm2 again, as before.", name)
			return why
		}
		logf("Starting it in Docker…")
		if out, err := ref.run(ctx, "up", "-d"); err != nil {
			return rollback(errors.New(lastLines(string(out), 3)))
		}
		logf("Waiting for it to answer on port %d…", *a.Port)
		if err := waitAnswer(ctx, a.Scheme, *a.Port, a.Path, 90*time.Second); err != nil {
			if out, lerr := ref.run(context.Background(), "logs", "--tail", "15"); lerr == nil {
				for _, l := range strings.Split(strings.TrimSpace(string(out)), "\n") {
					logf("  %s", l)
				}
			}
			return rollback(err)
		}
		// It answers: take it out of pm2, so pm2 doesn't start it again at the next boot.
		if _, err := runPM2(ctx, plan.bin, plan.env, plan.user, "delete", name); err != nil {
			logf("Couldn't remove it from pm2: %v", err)
		}
		if _, err := runPM2(ctx, plan.bin, plan.env, plan.user, "save"); err != nil {
			logf("Couldn't save pm2's list: %v", err)
		}
		list := slices.DeleteFunc(s.movedApps(), func(m moved) bool { return m.Project == plan.project })
		list = append(list, moved{App: a.ID, Name: name, Project: plan.project, Compose: composePath, Unit: a.Unit,
			ExecPath: plan.proc.Env.ExecPath, Args: plan.proc.Env.Args, Interpreter: plan.proc.Env.Interpreter, Cwd: plan.proc.Env.Cwd, Env: plan.appEnv, Moved: time.Now()})
		if err := s.saveMoved(list); err != nil {
			logf("Couldn't note how to move it back: %v", err)
		}
		s.native.rescan()
		logf("%s runs in Docker now.", a.Name)
		return nil
	})
	if err != nil {
		writeError(w, http.StatusConflict, err.Error())
		return
	}
	writeJSON(w, http.StatusAccepted, map[string]string{"job": kind})
}

// handleMovedApps says which Docker apps came from pm2 (they can move back).
func (s *server) handleMovedApps(w http.ResponseWriter, r *http.Request) {
	list := s.movedApps()
	if list == nil {
		list = []moved{}
	}
	writeJSON(w, http.StatusOK, list)
}

// handleMoveBack runs an app in pm2 again, as it did before the move.
func (s *server) handleMoveBack(w http.ResponseWriter, r *http.Request) {
	project := r.PathValue("project")
	var m *moved
	for _, x := range s.movedApps() {
		if x.Project == project {
			m = &x
		}
	}
	if m == nil {
		writeError(w, http.StatusNotFound, "this app wasn't moved from pm2")
		return
	}
	kind := "move-" + project
	_, err := startFuncJob(kind, "Moving "+m.Name+" back to pm2", func(ctx context.Context, logf func(string, ...any)) error {
		containerizeMu.Lock()
		defer containerizeMu.Unlock()
		bin, env, user, err := pm2Of(ctx, m.Unit)
		if err != nil {
			return err
		}
		ref := &composeRef{project: m.Project, files: []string{m.Compose}, dir: filepath.Dir(m.Compose)}
		logf("Stopping the container…")
		if out, err := ref.run(ctx, "down"); err != nil {
			return errors.New(lastLines(string(out), 3))
		}
		logf("Starting %s in pm2…", m.Name)
		args := []string{"start", m.ExecPath, "--name", m.Name, "--cwd", m.Cwd, "--interpreter", m.Interpreter}
		if len(m.Args) > 0 {
			args = append(append(args, "--"), m.Args...)
		}
		startEnv := slices.Clone(env)
		for k, v := range m.Env {
			startEnv = append(startEnv, k+"="+v)
		}
		if _, err := runPM2(ctx, bin, startEnv, user, args...); err != nil {
			return err
		}
		if _, err := runPM2(ctx, bin, env, user, "save"); err != nil {
			logf("Couldn't save pm2's list: %v", err)
		}
		_ = s.saveMoved(slices.DeleteFunc(s.movedApps(), func(x moved) bool { return x.Project == m.Project }))
		s.native.rescan()
		logf("%s runs in pm2 again. Its compose file stays at %s.", m.Name, m.Compose)
		return nil
	})
	if err != nil {
		writeError(w, http.StatusConflict, err.Error())
		return
	}
	writeJSON(w, http.StatusAccepted, map[string]string{"job": kind})
}
