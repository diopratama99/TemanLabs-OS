package main

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"os/exec"
	"regexp"
	"strconv"
	"strings"
	"time"
)

// Log Viewer: the systemd journal, filtered by category (all, errors, kernel, sign-ins,
// one service), with live updates from a cursor.

type logEntry struct {
	Time     int64  `json:"time"` // unix ms
	Priority int    `json:"priority"`
	Source   string `json:"source"`
	Unit     string `json:"unit,omitempty"`
	PID      string `json:"pid,omitempty"`
	Message  string `json:"message"`
	Host     string `json:"host,omitempty"`
}

var (
	journalSince = regexp.MustCompile(`^(\d+ ?(second|minute|hour|day|week)s? ago|today|yesterday|boot)$`)
	unitFilter   = regexp.MustCompile(`^[a-zA-Z0-9@._:\\-]{1,200}$`)
)

// journal messages are strings, or byte arrays when they aren't valid UTF-8.
func journalText(raw json.RawMessage) string {
	var s string
	if json.Unmarshal(raw, &s) == nil {
		return s
	}
	var b []byte
	if json.Unmarshal(raw, &b) == nil {
		return strings.ToValidUTF8(string(b), "�")
	}
	return ""
}

func (s *server) handleLogs(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	lines, _ := strconv.Atoi(q.Get("lines"))
	if lines <= 0 || lines > 5000 {
		lines = 500
	}
	args := []string{"--no-pager", "-o", "json", "--output-fields=MESSAGE,PRIORITY,SYSLOG_IDENTIFIER,_COMM,_SYSTEMD_UNIT,_PID,__REALTIME_TIMESTAMP,__CURSOR,_HOSTNAME"}
	if cursor := q.Get("after"); cursor != "" {
		// Live mode: only what's new since the last entry the window has.
		args = append(args, "--after-cursor="+cursor, "-n", "1000")
	} else {
		args = append(args, "-n", strconv.Itoa(lines))
	}
	switch q.Get("view") {
	case "errors":
		args = append(args, "-p", "err")
	case "warnings":
		args = append(args, "-p", "warning")
	case "kernel":
		args = append(args, "-k")
	case "auth":
		args = append(args, "SYSLOG_FACILITY=4", "SYSLOG_FACILITY=10")
	}
	if unit := q.Get("unit"); unit != "" {
		if !unitFilter.MatchString(unit) {
			writeError(w, http.StatusBadRequest, "invalid service")
			return
		}
		args = append(args, "-u", unit)
	}
	if since := q.Get("since"); since != "" {
		if !journalSince.MatchString(since) {
			writeError(w, http.StatusBadRequest, "invalid time range")
			return
		}
		if since == "boot" {
			args = append(args, "-b")
		} else {
			args = append(args, "--since", since)
		}
	}
	if grep := q.Get("q"); grep != "" {
		if len(grep) > 200 {
			grep = grep[:200]
		}
		// Case-insensitive fixed text, not a regex the user has to escape.
		args = append(args, "--case-sensitive=false", "-g", regexp.QuoteMeta(grep))
	}
	ctx, cancel := context.WithTimeout(r.Context(), 20*time.Second)
	defer cancel()
	out, _ := exec.CommandContext(ctx, "journalctl", args...).Output()

	entries := []logEntry{}
	cursor := q.Get("after")
	scanner := bufio.NewScanner(bytes.NewReader(out))
	scanner.Buffer(make([]byte, 256<<10), 4<<20)
	for scanner.Scan() {
		var raw map[string]json.RawMessage
		if json.Unmarshal(scanner.Bytes(), &raw) != nil {
			continue
		}
		e := logEntry{Message: journalText(raw["MESSAGE"]), Unit: journalText(raw["_SYSTEMD_UNIT"]), PID: journalText(raw["_PID"]), Host: journalText(raw["_HOSTNAME"])}
		e.Priority, _ = strconv.Atoi(journalText(raw["PRIORITY"]))
		if us, err := strconv.ParseInt(journalText(raw["__REALTIME_TIMESTAMP"]), 10, 64); err == nil {
			e.Time = us / 1000
		}
		e.Source = journalText(raw["SYSLOG_IDENTIFIER"])
		if e.Source == "" {
			e.Source = journalText(raw["_COMM"])
		}
		if c := journalText(raw["__CURSOR"]); c != "" {
			cursor = c
		}
		entries = append(entries, e)
	}
	writeJSON(w, http.StatusOK, map[string]any{"entries": entries, "cursor": cursor})
}
