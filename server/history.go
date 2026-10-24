package main

import (
	"bufio"
	"encoding/binary"
	"math"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"time"
)

// History: the server's CPU, memory, temperature, network, disk and power, one point a minute
// for 30 days, so a slow evening can be looked back at. Points live in memory (about 2 MB) and
// are written to the state folder every few minutes; a gap means the server was off.

const (
	historyKeep  = 30 * 24 * time.Hour
	historyEvery = 10 * time.Second
	historySave  = 2 * time.Minute
	maxBuckets   = 360
)

// histPoint is one minute, averaged; CPUMax is the busiest sample in it.
type histPoint struct {
	T      int64 // unix seconds, start of the minute
	CPU    float32
	CPUMax float32
	Mem    float32 // percent
	Temp   float32
	RX, TX float32 // bytes a second
	Read   float32 // disk bytes a second
	Write  float32
	Load   float32
	Watts  float32
}

type history struct {
	mu     sync.RWMutex
	file   string
	points []histPoint

	// The minute being collected.
	cur histPoint
	n   int
	// Disk counters from the previous reading.
	prevRead, prevWrite uint64
	prevAt              time.Time
}

func newHistory(stateDir string) *history {
	h := &history{file: filepath.Join(stateDir, "history.bin")}
	h.load()
	return h
}

func (h *history) load() {
	f, err := os.Open(h.file)
	if err != nil {
		return
	}
	defer f.Close()
	r := bufio.NewReader(f)
	cutoff := time.Now().Add(-historyKeep).Unix()
	for {
		var p histPoint
		if err := binary.Read(r, binary.LittleEndian, &p); err != nil {
			break
		}
		if p.T >= cutoff {
			h.points = append(h.points, p)
		}
	}
}

func (h *history) save() error {
	h.mu.RLock()
	points := append([]histPoint(nil), h.points...)
	h.mu.RUnlock()
	tmp := h.file + ".tmp"
	f, err := os.OpenFile(tmp, os.O_CREATE|os.O_TRUNC|os.O_WRONLY, 0o600)
	if err != nil {
		return err
	}
	w := bufio.NewWriter(f)
	err = binary.Write(w, binary.LittleEndian, points)
	if err == nil {
		err = w.Flush()
	}
	if cerr := f.Close(); err == nil {
		err = cerr
	}
	if err != nil {
		os.Remove(tmp)
		return err
	}
	return os.Rename(tmp, h.file)
}

// diskCounters adds up bytes read and written on the whole disks (not partitions or loops).
func diskCounters() (read, write uint64) {
	data, err := os.ReadFile("/proc/diskstats")
	if err != nil {
		return 0, 0
	}
	for _, line := range strings.Split(string(data), "\n") {
		f := strings.Fields(line)
		if len(f) < 10 {
			continue
		}
		name := f[2]
		if _, err := os.Stat("/sys/block/" + name + "/device"); err != nil {
			continue // partitions, loop devices, device-mapper
		}
		r, _ := strconv.ParseUint(f[5], 10, 64)
		w, _ := strconv.ParseUint(f[9], 10, 64)
		read += r * 512
		write += w * 512
	}
	return read, write
}

// record folds one reading into the current minute, closing the minute when it has passed.
func (h *history) record(st systemStats, now time.Time) {
	read, write := diskCounters()
	var readRate, writeRate float64
	if !h.prevAt.IsZero() && read >= h.prevRead && write >= h.prevWrite {
		if dt := now.Sub(h.prevAt).Seconds(); dt > 0 {
			readRate, writeRate = float64(read-h.prevRead)/dt, float64(write-h.prevWrite)/dt
		}
	}
	h.prevRead, h.prevWrite, h.prevAt = read, write, now

	minute := now.Truncate(time.Minute).Unix()
	if h.n > 0 && h.cur.T != minute {
		h.close()
	}
	if h.n == 0 {
		h.cur = histPoint{T: minute}
	}
	mem := 0.0
	if st.Memory.Total > 0 {
		mem = float64(st.Memory.Used) / float64(st.Memory.Total) * 100
	}
	watts := 0.0
	if st.Power != nil {
		watts = st.Power.Watts
	}
	add := func(sum *float32, v float64) { *sum += float32(v) }
	add(&h.cur.CPU, st.CPU.Usage)
	add(&h.cur.Mem, mem)
	add(&h.cur.Temp, st.CPU.Temp)
	add(&h.cur.RX, st.Network.RX)
	add(&h.cur.TX, st.Network.TX)
	add(&h.cur.Read, readRate)
	add(&h.cur.Write, writeRate)
	add(&h.cur.Load, st.Load[0])
	add(&h.cur.Watts, watts)
	h.cur.CPUMax = float32(math.Max(float64(h.cur.CPUMax), st.CPU.Usage))
	h.n++
}

// close turns the sums into averages and keeps the minute.
func (h *history) close() {
	n := float32(h.n)
	p := h.cur
	p.CPU, p.Mem, p.Temp, p.RX, p.TX, p.Read, p.Write, p.Load, p.Watts =
		p.CPU/n, p.Mem/n, p.Temp/n, p.RX/n, p.TX/n, p.Read/n, p.Write/n, p.Load/n, p.Watts/n
	h.mu.Lock()
	h.points = append(h.points, p)
	cutoff := time.Now().Add(-historyKeep).Unix()
	drop := 0
	for drop < len(h.points) && h.points[drop].T < cutoff {
		drop++
	}
	if drop > 0 {
		h.points = append(h.points[:0], h.points[drop:]...)
	}
	h.mu.Unlock()
	h.n = 0
}

func (s *server) runHistory() {
	lastSave := time.Now()
	for now := range time.Tick(historyEvery) {
		s.history.record(s.stats.get(), now)
		if now.Sub(lastSave) >= historySave {
			lastSave = now
			_ = s.history.save()
		}
	}
}

// histBucket is what a chart draws for one stretch of time; nil when the server was off.
type histBucket struct {
	T      int64   `json:"t"`
	CPU    float32 `json:"cpu"`
	CPUMax float32 `json:"cpuMax"`
	Mem    float32 `json:"mem"`
	Temp   float32 `json:"temp"`
	RX     float32 `json:"rx"`
	TX     float32 `json:"tx"`
	Read   float32 `json:"read"`
	Write  float32 `json:"write"`
	Load   float32 `json:"load"`
	Watts  float32 `json:"watts"`
}

var historyRanges = map[string]time.Duration{"1h": time.Hour, "24h": 24 * time.Hour, "7d": 7 * 24 * time.Hour, "30d": historyKeep}

// buckets averages the points of the last span into at most maxBuckets stretches.
func (h *history) buckets(span time.Duration, now time.Time) (int64, []*histBucket) {
	step := int64(span.Seconds()) / maxBuckets
	if step < 60 {
		step = 60
	}
	end := now.Unix() / step * step
	start := end - int64(span.Seconds()) + step
	out := make([]*histBucket, (end-start)/step+1)
	counts := make([]float32, len(out))
	h.mu.RLock()
	defer h.mu.RUnlock()
	for _, p := range h.points {
		if p.T < start {
			continue
		}
		i := (p.T - start) / step
		if i >= int64(len(out)) {
			continue
		}
		b := out[i]
		if b == nil {
			b = &histBucket{T: start + i*step}
			out[i] = b
		}
		b.CPU += p.CPU
		b.Mem += p.Mem
		b.Temp += p.Temp
		b.RX += p.RX
		b.TX += p.TX
		b.Read += p.Read
		b.Write += p.Write
		b.Load += p.Load
		b.Watts += p.Watts
		b.CPUMax = float32(math.Max(float64(b.CPUMax), float64(p.CPUMax)))
		counts[i]++
	}
	for i, b := range out {
		if b == nil {
			continue
		}
		n := counts[i]
		b.CPU, b.Mem, b.Temp, b.RX, b.TX, b.Read, b.Write, b.Load, b.Watts =
			b.CPU/n, b.Mem/n, b.Temp/n, b.RX/n, b.TX/n, b.Read/n, b.Write/n, b.Load/n, b.Watts/n
	}
	return step, out
}

func (s *server) handleHistory(w http.ResponseWriter, r *http.Request) {
	span, ok := historyRanges[r.URL.Query().Get("range")]
	if !ok {
		span = 24 * time.Hour
	}
	step, points := s.history.buckets(span, time.Now())
	s.history.mu.RLock()
	since := int64(0)
	if len(s.history.points) > 0 {
		since = s.history.points[0].T
	}
	s.history.mu.RUnlock()
	writeJSON(w, http.StatusOK, map[string]any{"step": step, "since": since, "points": points})
}
