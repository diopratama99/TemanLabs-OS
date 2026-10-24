package main

import (
	"context"
	"net/http"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"
)

// processInfo is one process, for the Processes tab of System Monitor.
type processInfo struct {
	PID     int     `json:"pid"`
	PPID    int     `json:"ppid"`
	Name    string  `json:"name"`
	User    string  `json:"user"`
	State   string  `json:"state"`
	CPU     float64 `json:"cpu"`
	Memory  uint64  `json:"memory"`
	Threads int     `json:"threads"`
	// Unix seconds.
	Started   int64  `json:"started"`
	Command   string `json:"command,omitempty"`
	Unit      string `json:"unit,omitempty"`
	Container string `json:"container,omitempty"`
	// Kernel threads have no command line and belong to kthreadd.
	Kernel bool `json:"kernel,omitempty"`
}

const clockTicks = 100 // USER_HZ on Linux

type processLister struct {
	mu    sync.Mutex
	prev  map[int]uint64
	prevT time.Time
	at    time.Time
	list  []*processInfo
}

var processes = &processLister{prev: map[int]uint64{}}

func bootTime() int64 {
	data, _ := os.ReadFile("/proc/stat")
	for _, line := range strings.Split(string(data), "\n") {
		if v, ok := strings.CutPrefix(line, "btime "); ok {
			n, _ := strconv.ParseInt(strings.TrimSpace(v), 10, 64)
			return n
		}
	}
	return 0
}

func (l *processLister) collect(ctx context.Context, d *dockerClient) []*processInfo {
	containers, _ := d.containers(ctx)
	names := map[string]string{}
	for _, c := range containers {
		names[c.ID] = c.name()
	}
	boot := bootTime()
	page := uint64(os.Getpagesize())
	users := map[string]string{}
	now := time.Now()

	dirs, _ := os.ReadDir("/proc")
	ticks := map[int]uint64{}
	var list []*processInfo
	for _, dir := range dirs {
		pid, err := strconv.Atoi(dir.Name())
		if err != nil {
			continue
		}
		base := filepath.Join("/proc", dir.Name())
		stat, err := os.ReadFile(filepath.Join(base, "stat"))
		if err != nil {
			continue
		}
		// The name is in parentheses and may itself contain spaces or parentheses.
		text := string(stat)
		open, close := strings.IndexByte(text, '('), strings.LastIndexByte(text, ')')
		if open < 0 || close < open {
			continue
		}
		fields := strings.Fields(text[close+1:])
		if len(fields) < 22 {
			continue
		}
		p := describeProcess(pid, base, users)
		info := &processInfo{PID: pid, Name: text[open+1 : close], User: p.user, State: fields[0], Command: p.cmd, Unit: p.unit}
		// The kernel cuts names at 15 characters; the command line has the full one.
		if len(info.Name) == 15 && p.cmd != "" {
			if arg0 := filepath.Base(strings.Fields(p.cmd)[0]); strings.HasPrefix(arg0, info.Name) {
				info.Name = arg0
			}
		}
		info.PPID, _ = strconv.Atoi(fields[1])
		utime, _ := strconv.ParseUint(fields[11], 10, 64)
		stime, _ := strconv.ParseUint(fields[12], 10, 64)
		info.Threads, _ = strconv.Atoi(fields[17])
		start, _ := strconv.ParseInt(fields[19], 10, 64)
		info.Started = boot + start/clockTicks
		if statm := strings.Fields(readTrim(filepath.Join(base, "statm"))); len(statm) > 1 {
			rss, _ := strconv.ParseUint(statm[1], 10, 64)
			info.Memory = rss * page
		}
		info.Kernel = info.Command == "" && (info.PPID == 2 || pid == 2)
		if p.containerID != "" {
			info.Container = names[p.containerID]
		}
		total := utime + stime
		ticks[pid] = total
		if prev, ok := l.prev[pid]; ok && total >= prev {
			if secs := now.Sub(l.prevT).Seconds(); secs > 0 {
				info.CPU = float64(total-prev) / clockTicks / secs * 100
			}
		}
		list = append(list, info)
	}
	l.prev, l.prevT = ticks, now
	sort.Slice(list, func(i, j int) bool { return list[i].PID < list[j].PID })
	return list
}

func (s *server) handleProcesses(w http.ResponseWriter, r *http.Request) {
	processes.mu.Lock()
	defer processes.mu.Unlock()
	// Several pollers share one scan; CPU needs some time between scans to mean anything.
	if time.Since(processes.at) > 1500*time.Millisecond {
		processes.list = processes.collect(r.Context(), s.docker)
		processes.at = time.Now()
	}
	writeJSON(w, http.StatusOK, processes.list)
}
