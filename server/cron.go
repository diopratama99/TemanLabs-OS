package main

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"os/exec"
	"os/user"
	"regexp"
	"strings"
	"time"
)

// Scheduled Tasks: the crontabs of the server's user and root, and systemd timers. Disabled
// tasks stay in the crontab, commented out with a marker, so they keep their schedule.

const cronDisabled = "#temanlabs-disabled# "

type cronTask struct {
	Schedule string `json:"schedule"`
	Command  string `json:"command"`
	Enabled  bool   `json:"enabled"`
	// The comment line above the task, used as its name.
	Name string `json:"name,omitempty"`
}

type crontab struct {
	User  string     `json:"user"`
	Tasks []cronTask `json:"tasks"`
	// Variables (MAILTO=…, PATH=…) and other lines, kept as they are.
	Header []string `json:"header,omitempty"`
}

var (
	cronField    = `(\*|\d+|\d+-\d+|\*/\d+|\d+-\d+/\d+|[a-zA-Z]{3})(,(\*|\d+|\d+-\d+|\*/\d+|\d+-\d+/\d+|[a-zA-Z]{3}))*`
	cronSchedule = regexp.MustCompile(`^(@(reboot|yearly|annually|monthly|weekly|daily|midnight|hourly)|` + cronField + `(\s+` + cronField + `){4})$`)
	cronLine     = regexp.MustCompile(`^(@\S+|(?:\S+\s+){4}\S+)\s+(.+)$`)
	cronEnv      = regexp.MustCompile(`^[A-Za-z_][A-Za-z0-9_]*\s*=`)
	// Lines of Ubuntu's crontab template (and our own header), which aren't task names.
	cronTemplate = regexp.MustCompile(`(?i)^(m h\s+dom|edit this file|each task|indicating with|and what command|to define the time|notice that tasks|the tasks will|output of the crontab|email to the user|for example, you|at 5 a\.m|for more information|edited with temanlabsos)|crontab\(5\)`)
)

func (s *server) cronUsers() []string {
	users := []string{"root"}
	if s.owner != nil && s.owner.name != "root" {
		users = append([]string{s.owner.name}, users...)
	}
	return users
}

func readCrontab(ctx context.Context, name string) crontab {
	tab := crontab{User: name, Tasks: []cronTask{}}
	out, err := exec.CommandContext(ctx, "crontab", "-l", "-u", name).Output()
	if err != nil {
		return tab // "no crontab for user"
	}
	pending := ""
	for _, line := range strings.Split(string(out), "\n") {
		t := strings.TrimSpace(line)
		enabled := true
		if strings.HasPrefix(t, cronDisabled) {
			t, enabled = strings.TrimPrefix(t, cronDisabled), false
		}
		switch {
		case t == "":
			pending = ""
		case strings.HasPrefix(t, "#"):
			// Comments directly above a task name it; the rest is the file's own header.
			pending = strings.TrimSpace(strings.TrimLeft(t, "#"))
			if cronTemplate.MatchString(pending) {
				pending = ""
			}
		case cronEnv.MatchString(t):
			tab.Header = append(tab.Header, t)
		default:
			if m := cronLine.FindStringSubmatch(t); m != nil {
				tab.Tasks = append(tab.Tasks, cronTask{Schedule: m[1], Command: m[2], Enabled: enabled, Name: pending})
			}
			pending = ""
		}
	}
	return tab
}

func (s *server) handleCron(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := context.WithTimeout(r.Context(), 15*time.Second)
	defer cancel()
	var tabs []crontab
	for _, u := range s.cronUsers() {
		tabs = append(tabs, readCrontab(ctx, u))
	}
	var timers []struct {
		Next      int64  `json:"next"`
		Last      int64  `json:"last"`
		Unit      string `json:"unit"`
		Activates string `json:"activates"`
	}
	_ = systemctlJSON(ctx, &timers, "list-timers", "--all")
	type timer struct {
		Unit      string `json:"unit"`
		Activates string `json:"activates"`
		Next      int64  `json:"next,omitempty"`
		Last      int64  `json:"last,omitempty"`
	}
	list := []timer{}
	for _, t := range timers {
		// systemd reports microseconds since the epoch.
		list = append(list, timer{Unit: t.Unit, Activates: t.Activates, Next: t.Next / 1000, Last: t.Last / 1000})
	}
	writeJSON(w, http.StatusOK, map[string]any{"crontabs": tabs, "timers": list})
}

func (s *server) handleCronSave(w http.ResponseWriter, r *http.Request) {
	name := r.PathValue("user")
	allowed := false
	for _, u := range s.cronUsers() {
		allowed = allowed || u == name
	}
	if !allowed {
		writeError(w, http.StatusForbidden, "unknown user")
		return
	}
	var tab crontab
	if decodeJSON(r, &tab) != nil {
		writeError(w, http.StatusBadRequest, "invalid request")
		return
	}
	var b strings.Builder
	b.WriteString("# Edited with TemanLabsOS (Scheduled Tasks)\n")
	for _, h := range tab.Header {
		if !cronEnv.MatchString(h) || strings.ContainsAny(h, "\n\r") {
			writeError(w, http.StatusBadRequest, "invalid variable line")
			return
		}
		b.WriteString(h + "\n")
	}
	for _, t := range tab.Tasks {
		sched := strings.Join(strings.Fields(t.Schedule), " ")
		cmd := strings.TrimSpace(t.Command)
		if !cronSchedule.MatchString(sched) {
			writeError(w, http.StatusBadRequest, fmt.Sprintf("“%s” isn’t a schedule cron understands", t.Schedule))
			return
		}
		if cmd == "" || strings.ContainsAny(cmd+t.Name, "\n\r") {
			writeError(w, http.StatusBadRequest, "each task needs a one-line command")
			return
		}
		b.WriteString("\n")
		if name := strings.TrimSpace(t.Name); name != "" {
			b.WriteString("# " + name + "\n")
		}
		if !t.Enabled {
			b.WriteString(cronDisabled)
		}
		b.WriteString(sched + " " + cmd + "\n")
	}
	ctx, cancel := context.WithTimeout(r.Context(), 15*time.Second)
	defer cancel()
	cmd := exec.CommandContext(ctx, "crontab", "-u", name, "-")
	cmd.Stdin = strings.NewReader(b.String())
	if out, err := cmd.CombinedOutput(); err != nil {
		writeError(w, http.StatusBadRequest, "crontab: "+strings.TrimSpace(string(out)))
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// handleCronRun runs a task's command once, now, as its user, and returns what it printed.
func (s *server) handleCronRun(w http.ResponseWriter, r *http.Request) {
	var body struct {
		User    string `json:"user"`
		Command string `json:"command"`
	}
	if decodeJSON(r, &body) != nil || strings.TrimSpace(body.Command) == "" {
		writeError(w, http.StatusBadRequest, "invalid request")
		return
	}
	allowed := false
	for _, u := range s.cronUsers() {
		allowed = allowed || u == body.User
	}
	if !allowed {
		writeError(w, http.StatusForbidden, "unknown user")
		return
	}
	u, err := user.Lookup(body.User)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Minute)
	defer cancel()
	// Like cron: the user's shell environment is minimal; run through sh in their home.
	cmd := exec.CommandContext(ctx, "runuser", "-u", body.User, "--", "sh", "-c", body.Command)
	cmd.Dir = u.HomeDir
	out, err := cmd.CombinedOutput()
	exit := 0
	var ee *exec.ExitError
	if errors.As(err, &ee) {
		exit = ee.ExitCode()
	} else if err != nil {
		exit = -1
	}
	if len(out) > 256<<10 {
		out = out[len(out)-256<<10:]
	}
	writeJSON(w, http.StatusOK, map[string]any{"output": string(out), "exit": exit})
}
