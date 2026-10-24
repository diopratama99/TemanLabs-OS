package main

import (
	"bufio"
	"context"
	"errors"
	"io"
	"net/http"
	"os"
	"os/exec"
	"sync"
	"time"
)

// Long-running admin tasks (apt upgrades…) run in the background; the UI polls their log.
// One job per kind at a time.

const maxJobLines = 3000

type job struct {
	mu      sync.Mutex
	Kind    string    `json:"kind"`
	Title   string    `json:"title"`
	Running bool      `json:"running"`
	Started time.Time `json:"started"`
	Ended   time.Time `json:"ended,omitzero"`
	Exit    int       `json:"exit"`
	lines   []string
	dropped int
}

type jobSnapshot struct {
	Kind    string    `json:"kind"`
	Title   string    `json:"title"`
	Running bool      `json:"running"`
	Started time.Time `json:"started"`
	Ended   time.Time `json:"ended,omitzero"`
	Exit    int       `json:"exit"`
	Log     []string  `json:"log"`
	// Lines dropped from the start of a very long log.
	Dropped int `json:"dropped,omitempty"`
}

var jobs = struct {
	sync.Mutex
	byKind map[string]*job
}{byKind: map[string]*job{}}

var errJobRunning = errors.New("this task is already running")

func (j *job) add(line string) {
	j.mu.Lock()
	defer j.mu.Unlock()
	j.lines = append(j.lines, line)
	if len(j.lines) > maxJobLines {
		cut := len(j.lines) - maxJobLines
		j.lines = j.lines[cut:]
		j.dropped += cut
	}
}

func (j *job) snapshot() jobSnapshot {
	j.mu.Lock()
	defer j.mu.Unlock()
	return jobSnapshot{
		Kind: j.Kind, Title: j.Title, Running: j.Running, Started: j.Started, Ended: j.Ended, Exit: j.Exit,
		Log: append([]string(nil), j.lines...), Dropped: j.dropped,
	}
}

// startJob runs a command in the background, capturing its output line by line. after runs
// once it has finished (e.g. to refresh a cache).
func startJob(kind, title string, env []string, after func(), name string, args ...string) (*job, error) {
	jobs.Lock()
	defer jobs.Unlock()
	if j := jobs.byKind[kind]; j != nil && j.snapshot().Running {
		return nil, errJobRunning
	}
	j := &job{Kind: kind, Title: title, Running: true, Started: time.Now()}
	jobs.byKind[kind] = j
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Hour)
	cmd := exec.CommandContext(ctx, name, args...)
	cmd.Env = append(os.Environ(), env...)
	pr, pw := io.Pipe()
	cmd.Stdout, cmd.Stderr = pw, pw
	if err := cmd.Start(); err != nil {
		cancel()
		j.Running = false
		return nil, err
	}
	go func() {
		scanner := bufio.NewScanner(pr)
		scanner.Buffer(make([]byte, 64<<10), 1<<20)
		for scanner.Scan() {
			j.add(scanner.Text())
		}
	}()
	go func() {
		err := cmd.Wait()
		pw.Close()
		cancel()
		j.mu.Lock()
		j.Running = false
		j.Ended = time.Now()
		if cmd.ProcessState != nil {
			j.Exit = cmd.ProcessState.ExitCode()
		} else if err != nil {
			j.Exit = -1
		}
		j.mu.Unlock()
		if after != nil {
			after()
		}
	}()
	return j, nil
}

func (s *server) handleJob(w http.ResponseWriter, r *http.Request) {
	jobs.Lock()
	j := jobs.byKind[r.PathValue("kind")]
	jobs.Unlock()
	if j == nil {
		writeJSON(w, http.StatusOK, map[string]any{"kind": r.PathValue("kind"), "running": false, "log": []string{}})
		return
	}
	writeJSON(w, http.StatusOK, j.snapshot())
}
