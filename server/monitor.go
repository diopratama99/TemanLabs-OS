package main

import (
	"context"
	"encoding/binary"
	"fmt"
	"io"
	"net/http"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"
)

const (
	monitorInterval = 2 * time.Second
	// Stop sampling once nobody has asked for stats in this long (the Activity window is closed).
	monitorIdle        = 45 * time.Second
	monitorConcurrency = 8
	maxLogBytes        = 2 << 20
)

// Container IDs and names as Docker accepts them; keeps user input out of the API path.
var containerRef = regexp.MustCompile(`^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,127}$`)

// dockerStats is the subset of GET /containers/{id}/stats we use.
type dockerStats struct {
	CPUStats    cpuSample `json:"cpu_stats"`
	PreCPUStats cpuSample `json:"precpu_stats"`
	MemoryStats struct {
		Usage uint64            `json:"usage"`
		Limit uint64            `json:"limit"`
		Stats map[string]uint64 `json:"stats"`
	} `json:"memory_stats"`
	Networks map[string]struct {
		RxBytes uint64 `json:"rx_bytes"`
		TxBytes uint64 `json:"tx_bytes"`
	} `json:"networks"`
	BlkioStats struct {
		IOServiceBytesRecursive []struct {
			Op    string `json:"op"`
			Value uint64 `json:"value"`
		} `json:"io_service_bytes_recursive"`
	} `json:"blkio_stats"`
	PidsStats struct {
		Current uint64 `json:"current"`
	} `json:"pids_stats"`
}

type cpuSample struct {
	CPUUsage struct {
		TotalUsage uint64 `json:"total_usage"`
	} `json:"cpu_usage"`
	SystemUsage uint64 `json:"system_cpu_usage"`
	OnlineCPUs  int    `json:"online_cpus"`
}

// containerSample is one container's resource use, computed like `docker stats` does.
type containerSample struct {
	CPU        float64 `json:"cpu"`
	MemUsed    uint64  `json:"memUsed"`
	MemLimit   uint64  `json:"memLimit"`
	NetRx      float64 `json:"netRx"`
	NetTx      float64 `json:"netTx"`
	BlockRead  uint64  `json:"blockRead"`
	BlockWrite uint64  `json:"blockWrite"`
	PIDs       uint64  `json:"pids"`

	rxTotal, txTotal   uint64
	cpuTotal, sysTotal uint64
	at                 time.Time
}

func (st *dockerStats) sample(prev *containerSample, now time.Time) *containerSample {
	s := &containerSample{
		at:       now,
		PIDs:     st.PidsStats.Current,
		MemLimit: st.MemoryStats.Limit,
		cpuTotal: st.CPUStats.CPUUsage.TotalUsage,
		sysTotal: st.CPUStats.SystemUsage,
	}
	// One-shot stats carry no precpu reading, so CPU is measured against our previous sample.
	preCPU, preSys := st.PreCPUStats.CPUUsage.TotalUsage, st.PreCPUStats.SystemUsage
	if prev != nil {
		preCPU, preSys = prev.cpuTotal, prev.sysTotal
	}
	cpuDelta := float64(s.cpuTotal) - float64(preCPU)
	sysDelta := float64(s.sysTotal) - float64(preSys)
	cpus := st.CPUStats.OnlineCPUs
	if cpus == 0 {
		cpus = 1
	}
	if cpuDelta > 0 && sysDelta > 0 {
		// Percent of one core, like `docker stats` (so up to cores × 100%).
		s.CPU = cpuDelta / sysDelta * float64(cpus) * 100
	}
	// Page cache isn't "used" memory: cgroup v2 reports inactive_file, v1 total_inactive_file.
	cache := st.MemoryStats.Stats["inactive_file"]
	if cache == 0 {
		cache = st.MemoryStats.Stats["total_inactive_file"]
	}
	if st.MemoryStats.Usage > cache {
		s.MemUsed = st.MemoryStats.Usage - cache
	}
	for _, n := range st.Networks {
		s.rxTotal += n.RxBytes
		s.txTotal += n.TxBytes
	}
	if prev != nil && s.rxTotal >= prev.rxTotal && s.txTotal >= prev.txTotal {
		if secs := now.Sub(prev.at).Seconds(); secs > 0 {
			s.NetRx = float64(s.rxTotal-prev.rxTotal) / secs
			s.NetTx = float64(s.txTotal-prev.txTotal) / secs
		}
	}
	for _, io := range st.BlkioStats.IOServiceBytesRecursive {
		switch strings.ToLower(io.Op) {
		case "read":
			s.BlockRead += io.Value
		case "write":
			s.BlockWrite += io.Value
		}
	}
	return s
}

// containerMonitor samples stats for running containers in the background, but only while
// someone is looking (the Activity window is open).
type containerMonitor struct {
	docker *dockerClient

	mu         sync.Mutex
	samples    map[string]*containerSample
	lastWanted time.Time
	running    bool
}

func newContainerMonitor(d *dockerClient) *containerMonitor {
	return &containerMonitor{docker: d, samples: map[string]*containerSample{}}
}

func (m *containerMonitor) want() {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.lastWanted = time.Now()
	if !m.running {
		m.running = true
		go m.loop()
	}
}

func (m *containerMonitor) loop() {
	for {
		m.mu.Lock()
		if time.Since(m.lastWanted) > monitorIdle {
			m.running = false
			m.samples = map[string]*containerSample{}
			m.mu.Unlock()
			return
		}
		m.mu.Unlock()
		m.sampleAll()
		time.Sleep(monitorInterval)
	}
}

func (m *containerMonitor) sampleAll() {
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	list, err := m.docker.containers(ctx)
	if err != nil {
		return
	}
	var wg sync.WaitGroup
	slots := make(chan struct{}, monitorConcurrency)
	alive := map[string]bool{}
	for _, c := range list {
		if c.State != "running" {
			continue
		}
		alive[c.ID] = true
		wg.Add(1)
		go func(id string) {
			defer wg.Done()
			slots <- struct{}{}
			defer func() { <-slots }()
			// one-shot skips Docker's one-second wait for a second CPU reading.
			var st dockerStats
			if err := m.docker.do(ctx, http.MethodGet, "/containers/"+id+"/stats?stream=false&one-shot=true", &st); err != nil {
				return
			}
			now := time.Now()
			m.mu.Lock()
			m.samples[id] = st.sample(m.samples[id], now)
			m.mu.Unlock()
		}(c.ID)
	}
	wg.Wait()
	m.mu.Lock()
	for id := range m.samples {
		if !alive[id] {
			delete(m.samples, id)
		}
	}
	m.mu.Unlock()
}

func (m *containerMonitor) get(id string) *containerSample {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.samples[id]
}

// containerInfo is one row of the Activity window.
type containerInfo struct {
	ID      string           `json:"id"`
	Name    string           `json:"name"`
	Image   string           `json:"image"`
	State   string           `json:"state"`
	Status  string           `json:"status"`
	AppID   string           `json:"appId"`
	Created int64            `json:"created"`
	Ports   []string         `json:"ports"`
	Stats   *containerSample `json:"stats"`
}

type containerListing struct {
	ID      string            `json:"Id"`
	Names   []string          `json:"Names"`
	Image   string            `json:"Image"`
	State   string            `json:"State"`
	Status  string            `json:"Status"`
	Created int64             `json:"Created"`
	Labels  map[string]string `json:"Labels"`
	Ports   []containerPort   `json:"Ports"`
}

func (s *server) handleContainers(w http.ResponseWriter, r *http.Request) {
	s.monitor.want()
	var list []containerListing
	if err := s.docker.do(r.Context(), http.MethodGet, "/containers/json?all=1", &list); err != nil {
		writeError(w, http.StatusBadGateway, err.Error())
		return
	}
	rows := make([]containerInfo, 0, len(list))
	for _, c := range list {
		name := c.ID[:12]
		if len(c.Names) > 0 {
			name = strings.TrimPrefix(c.Names[0], "/")
		}
		// Same grouping as the Dock: TemanLabsOS installs, then compose project, then the name.
		appID := c.Labels[labelTemanLabs]
		if appID == "" {
			appID = c.Labels[labelProject]
		}
		if appID == "" {
			appID = name
		}
		ports := []string{}
		seen := map[string]bool{}
		for _, p := range c.Ports {
			if p.PublicPort == 0 {
				continue
			}
			ip := p.IP
			if ip == "" || ip == "::" {
				ip = "0.0.0.0"
			}
			label := fmt.Sprintf("%s:%d→%d/%s", ip, p.PublicPort, p.PrivatePort, p.Type)
			if key := fmt.Sprintf("%d/%s", p.PublicPort, p.Type); !seen[key] {
				seen[key] = true
				ports = append(ports, label)
			}
		}
		rows = append(rows, containerInfo{
			ID: c.ID, Name: name, Image: c.Image, State: c.State, Status: c.Status,
			AppID: appID, Created: c.Created, Ports: ports, Stats: s.monitor.get(c.ID),
		})
	}
	sort.Slice(rows, func(i, j int) bool { return strings.ToLower(rows[i].Name) < strings.ToLower(rows[j].Name) })
	writeJSON(w, http.StatusOK, rows)
}

func (s *server) handleContainerAction(w http.ResponseWriter, r *http.Request) {
	id, action := r.PathValue("id"), r.PathValue("action")
	if !containerRef.MatchString(id) {
		writeError(w, http.StatusBadRequest, "invalid container id")
		return
	}
	path := map[string]string{
		"start":   "/containers/" + id + "/start",
		"stop":    "/containers/" + id + "/stop?t=15",
		"restart": "/containers/" + id + "/restart?t=15",
	}[action]
	if path == "" {
		writeError(w, http.StatusNotFound, "unknown action")
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 2*time.Minute)
	defer cancel()
	if err := s.docker.do(ctx, http.MethodPost, path, nil); err != nil {
		writeError(w, http.StatusBadGateway, err.Error())
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// handleContainerLogs returns the last lines of a container's stdout and stderr as plain text.
func (s *server) handleContainerLogs(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	if !containerRef.MatchString(id) {
		writeError(w, http.StatusBadRequest, "invalid container id")
		return
	}
	tail, err := strconv.Atoi(r.URL.Query().Get("tail"))
	if err != nil || tail <= 0 || tail > 5000 {
		tail = 300
	}
	var inspect struct {
		Config struct {
			Tty bool `json:"Tty"`
		} `json:"Config"`
	}
	if err := s.docker.do(r.Context(), http.MethodGet, "/containers/"+id+"/json", &inspect); err != nil {
		writeError(w, http.StatusBadGateway, err.Error())
		return
	}
	req, _ := http.NewRequestWithContext(r.Context(), http.MethodGet,
		fmt.Sprintf("http://docker/containers/%s/logs?stdout=1&stderr=1&timestamps=1&tail=%d", id, tail), nil)
	res, err := s.docker.http.Do(req)
	if err != nil {
		writeError(w, http.StatusBadGateway, err.Error())
		return
	}
	defer res.Body.Close()
	body := io.LimitReader(res.Body, maxLogBytes)
	w.Header().Set("Content-Type", "text/plain; charset=utf-8")
	if inspect.Config.Tty {
		_, _ = io.Copy(w, body)
		return
	}
	// Without a TTY Docker multiplexes stdout/stderr: an 8-byte header (stream, 0, 0, 0,
	// big-endian length) before each chunk.
	header := make([]byte, 8)
	for {
		if _, err := io.ReadFull(body, header); err != nil {
			return
		}
		size := int64(binary.BigEndian.Uint32(header[4:]))
		if _, err := io.CopyN(w, body, size); err != nil {
			return
		}
	}
}
