package main

import (
	"archive/tar"
	"bufio"
	"bytes"
	"compress/gzip"
	"context"
	"crypto/rand"
	"crypto/tls"
	"encoding/csv"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/http/httptrace"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"slices"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"time"
)

// Speed Test: the internet's download and upload speed, ping and jitter, measured by hand or on a
// schedule and kept for 180 days, so a slow evening (or a line that never reaches its plan) can be
// shown to the ISP. Two providers: Cloudflare's speed test, built in (plain HTTPS to
// speed.cloudflare.com, nothing to install), and Ookla's Speedtest CLI, its official binary,
// downloaded once its license is accepted; its results have a speedtest.net link, which ISPs know.
// A test moves real data (hundreds of MB on a fast line), so the window shows what a schedule
// costs a day.

const (
	speedKeep = 180 * 24 * time.Hour
	// A new server's first scheduled test waits a little, past the start's own work.
	speedFirstWait = 2 * time.Minute
	speedTimeout   = 3 * time.Minute
	ooklaVersion   = "1.2.0"
)

// Minutes between scheduled tests; 0 tests only by hand.
var speedIntervals = []int{0, 15, 30, 60, 120, 180, 360, 720, 1440}

var speedProviders = map[string]bool{"cloudflare": true, "ookla": true}

// How much one Cloudflare test may move each way, and for how long: light keeps frequent tests
// cheap on a line with a data cap, full measures a fast line properly.
var cfSizes = map[string]struct {
	down, up       time.Duration
	downCap, upCap int64
}{
	"light": {6 * time.Second, 5 * time.Second, 60 << 20, 30 << 20},
	"full":  {10 * time.Second, 8 * time.Second, 600 << 20, 300 << 20},
}

// cfSpeedBase is Cloudflare's speed test; tests point it at a local server.
var cfSpeedBase = "https://speed.cloudflare.com"

type speedResult struct {
	Time     time.Time `json:"time"`
	Provider string    `json:"provider"`
	// Megabits a second.
	Down float64 `json:"down"`
	Up   float64 `json:"up"`
	// Milliseconds: idle ping and its jitter, and the ping while the line is busy (Ookla only).
	Ping   float64 `json:"ping"`
	Jitter float64 `json:"jitter"`
	Loaded float64 `json:"loaded,omitempty"`
	// Percent of packets lost (Ookla only, when it could measure it).
	Loss   *float64 `json:"loss,omitempty"`
	Server string   `json:"server,omitempty"`
	ISP    string   `json:"isp,omitempty"`
	IP     string   `json:"ip,omitempty"`
	// The data the test used, both ways.
	Bytes int64 `json:"bytes"`
	// Ookla's result page.
	URL    string `json:"url,omitempty"`
	Error  string `json:"error,omitempty"`
	Manual bool   `json:"manual,omitempty"`
}

type speedConfig struct {
	Interval int    `json:"interval"`
	Provider string `json:"provider"`
	// Cloudflare: light or full.
	Size string `json:"size"`
	// Ookla's server to test against; 0 lets it pick the nearest.
	OoklaServer   int  `json:"ooklaServer"`
	OoklaAccepted bool `json:"ooklaAccepted"`
	// The speeds the ISP sells, in Mbps (0: not set), to compare the results with.
	PlanDown float64 `json:"planDown"`
	PlanUp   float64 `json:"planUp"`
}

// speedRun is the test in progress.
type speedRun struct {
	Started  time.Time `json:"started"`
	Provider string    `json:"provider"`
	// starting, ping, download or upload.
	Phase string `json:"phase"`
	// The speed right now, in the phase running.
	Mbps float64 `json:"mbps"`
	// The whole test's progress, 0 to 1.
	Progress float64 `json:"progress"`
	Manual   bool    `json:"manual"`

	cancel  context.CancelFunc
	stopped bool
}

type speedStore struct {
	mu      sync.Mutex
	conf    string
	log     string
	Config  speedConfig
	results []speedResult
	run     *speedRun
	// When the last test started, kept or not: the schedule counts from it.
	tried time.Time
	// Ookla's server list, kept for an hour.
	servers   []ooklaServer
	serversAt time.Time
}

func newSpeedStore(stateDir string) *speedStore {
	st := &speedStore{
		conf:   filepath.Join(stateDir, "speedtest.json"),
		log:    filepath.Join(stateDir, "speedtest.jsonl"),
		Config: speedConfig{Provider: "cloudflare", Size: "light"},
	}
	if data, err := os.ReadFile(st.conf); err == nil {
		_ = json.Unmarshal(data, &st.Config)
	}
	if f, err := os.Open(st.log); err == nil {
		sc := bufio.NewScanner(f)
		sc.Buffer(make([]byte, 64<<10), 1<<20)
		for sc.Scan() {
			var r speedResult
			if json.Unmarshal(sc.Bytes(), &r) == nil {
				st.results = append(st.results, r)
			}
		}
		f.Close()
	}
	slices.SortStableFunc(st.results, func(a, b speedResult) int { return a.Time.Compare(b.Time) })
	st.prune()
	return st
}

// prune drops results older than speedKeep and rewrites the file when it did; the caller holds mu
// (or owns the store).
func (st *speedStore) prune() {
	cut := time.Now().Add(-speedKeep)
	n := 0
	for n < len(st.results) && st.results[n].Time.Before(cut) {
		n++
	}
	if n == 0 {
		return
	}
	st.results = slices.Clone(st.results[n:])
	_ = st.rewrite()
}

func (st *speedStore) rewrite() error {
	var buf bytes.Buffer
	enc := json.NewEncoder(&buf)
	for _, r := range st.results {
		_ = enc.Encode(r)
	}
	tmp := st.log + ".tmp"
	if err := os.WriteFile(tmp, buf.Bytes(), 0o600); err != nil {
		return err
	}
	return os.Rename(tmp, st.log)
}

// add keeps a result, appending it to the file; the caller holds mu.
func (st *speedStore) add(r speedResult) {
	st.results = append(st.results, r)
	if f, err := os.OpenFile(st.log, os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0o600); err == nil {
		_ = json.NewEncoder(f).Encode(r)
		f.Close()
	}
	st.prune()
}

func (st *speedStore) saveConfig() error {
	data, err := json.MarshalIndent(st.Config, "", "  ")
	if err != nil {
		return err
	}
	tmp := st.conf + ".tmp"
	if err := os.WriteFile(tmp, data, 0o600); err != nil {
		return err
	}
	return os.Rename(tmp, st.conf)
}

func (st *speedStore) last() *speedResult {
	if len(st.results) == 0 {
		return nil
	}
	r := st.results[len(st.results)-1]
	return &r
}

// ----- Running tests -----

// runSpeedTests starts the scheduled tests: one whenever the last test (by hand or not) is as old
// as the interval.
func (s *server) runSpeedTests() {
	time.Sleep(speedFirstWait)
	tick := time.NewTicker(30 * time.Second)
	defer tick.Stop()
	for {
		st := s.speed
		st.mu.Lock()
		every := time.Duration(st.Config.Interval) * time.Minute
		since := st.tried
		if l := st.last(); l != nil && l.Time.After(since) {
			since = l.Time
		}
		due := every > 0 && st.run == nil && time.Since(since) >= every
		st.mu.Unlock()
		if due {
			_ = s.startSpeedTest(false)
		}
		<-tick.C
	}
}

var errSpeedRunning = errors.New("a speed test is already running")

func (s *server) startSpeedTest(manual bool) error {
	st := s.speed
	st.mu.Lock()
	if st.run != nil {
		st.mu.Unlock()
		return errSpeedRunning
	}
	conf := st.Config
	if conf.Provider == "ookla" && (!conf.OoklaAccepted || !fileExists(s.ooklaPath())) {
		conf.Provider = "cloudflare"
	}
	ctx, cancel := context.WithTimeout(context.Background(), speedTimeout)
	run := &speedRun{Started: time.Now(), Provider: conf.Provider, Phase: "starting", Manual: manual, cancel: cancel}
	st.run = run
	st.tried = run.Started
	st.mu.Unlock()

	go func() {
		defer cancel()
		progress := func(phase string, mbps, overall float64) {
			st.mu.Lock()
			run.Phase, run.Mbps, run.Progress = phase, mbps, max(run.Progress, min(1, overall))
			st.mu.Unlock()
		}
		var res speedResult
		var err error
		if conf.Provider == "ookla" {
			res, err = s.ooklaTest(ctx, conf.OoklaServer, progress)
		} else {
			res, err = cloudflareTest(ctx, cfClient(), conf.Size, progress)
		}
		res.Time, res.Provider, res.Manual = run.Started, conf.Provider, manual
		if err != nil {
			if errors.Is(err, context.DeadlineExceeded) {
				err = errors.New("the test took too long")
			}
			res.Error = err.Error()
		}
		st.mu.Lock()
		defer st.mu.Unlock()
		st.run = nil
		// A test stopped by hand isn't a result, nor a scheduled one Cloudflare turned away: that says
		// nothing about the line (one by hand is kept, to show why it failed).
		if !run.stopped && (manual || !errors.Is(err, errCloudflareBusy)) {
			st.add(res)
		}
	}()
	return nil
}

func fileExists(path string) bool {
	_, err := os.Stat(path)
	return err == nil
}

func mbit(n int64, d time.Duration) float64 {
	if d <= 0 {
		return 0
	}
	return float64(n) * 8 / 1e6 / d.Seconds()
}

// ----- Cloudflare -----

// cfClient opens a connection per stream (HTTP/1.1, as browsers' speed tests do): over HTTP/2
// the streams would share one connection and measure less than the line can do.
func cfClient() *http.Client {
	return &http.Client{Transport: &http.Transport{
		Proxy:                 http.ProxyFromEnvironment,
		DialContext:           (&net.Dialer{Timeout: 10 * time.Second}).DialContext,
		TLSNextProto:          map[string]func(string, *tls.Conn) http.RoundTripper{},
		TLSHandshakeTimeout:   10 * time.Second,
		ResponseHeaderTimeout: 15 * time.Second,
		MaxIdleConnsPerHost:   16,
		DisableCompression:    true,
	}}
}

func cloudflareTest(ctx context.Context, client *http.Client, size string, progress func(phase string, mbps, overall float64)) (speedResult, error) {
	if t, ok := client.Transport.(*http.Transport); ok {
		defer t.CloseIdleConnections()
	}
	sz, ok := cfSizes[size]
	if !ok {
		sz = cfSizes["light"]
	}
	var res speedResult
	// Where the test runs (Cloudflare's nearest data centre) and the address the internet sees.
	meta, err := cfTrace(ctx, client)
	if err != nil {
		return res, fmt.Errorf("no answer from Cloudflare: %w", err)
	}
	res.IP, res.Server = meta["ip"], cfPlace(meta["colo"])
	progress("ping", 0, 0.02)
	pings, err := cfPings(ctx, client, 20, func(i int) { progress("ping", 0, 0.02+0.08*float64(i)/20) })
	if err != nil {
		return res, err
	}
	res.Ping, res.Jitter = median(pings), jitter(pings)
	down, n, err := cfTransfer(ctx, client, false, sz.down, sz.downCap, func(mbps, done float64) { progress("download", mbps, 0.1+0.45*done) })
	res.Down, res.Bytes = down, res.Bytes+n
	if err != nil {
		return res, err
	}
	up, n, err := cfTransfer(ctx, client, true, sz.up, sz.upCap, func(mbps, done float64) { progress("upload", mbps, 0.55+0.45*done) })
	res.Up, res.Bytes = up, res.Bytes+n
	return res, err
}

// cfTrace reads Cloudflare's /cdn-cgi/trace: ip=, colo=, loc= lines.
func cfTrace(ctx context.Context, client *http.Client) (map[string]string, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, cfSpeedBase+"/cdn-cgi/trace", nil)
	if err != nil {
		return nil, err
	}
	resp, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("HTTP %d", resp.StatusCode)
	}
	out := map[string]string{}
	sc := bufio.NewScanner(io.LimitReader(resp.Body, 16<<10))
	for sc.Scan() {
		if k, v, ok := strings.Cut(sc.Text(), "="); ok {
			out[k] = v
		}
	}
	return out, nil
}

// Cloudflare's data centres near Indonesia (and the big ones), by airport code.
var cfColos = map[string]string{
	"CGK": "Jakarta", "SUB": "Surabaya", "DPS": "Denpasar", "JOG": "Yogyakarta", "KNO": "Medan", "BTH": "Batam",
	"UPG": "Makassar", "BPN": "Balikpapan", "PDG": "Padang", "PLM": "Palembang", "SIN": "Singapore", "KUL": "Kuala Lumpur",
	"JHB": "Johor Bahru", "BKK": "Bangkok", "MNL": "Manila", "HKG": "Hong Kong", "TPE": "Taipei", "NRT": "Tokyo", "KIX": "Osaka",
	"ICN": "Seoul", "SYD": "Sydney", "PER": "Perth", "BOM": "Mumbai", "DEL": "New Delhi", "DXB": "Dubai", "FRA": "Frankfurt",
	"AMS": "Amsterdam", "LHR": "London", "CDG": "Paris", "LAX": "Los Angeles", "SJC": "San Jose", "SEA": "Seattle", "IAD": "Ashburn",
}

func cfPlace(colo string) string {
	if city := cfColos[colo]; city != "" {
		return "Cloudflare " + city
	}
	if colo != "" {
		return "Cloudflare " + colo
	}
	return "Cloudflare"
}

// cfPings times empty downloads on one open connection: the time to the first byte, less what
// Cloudflare says it spent on the request (Server-Timing), is the round trip.
func cfPings(ctx context.Context, client *http.Client, n int, step func(int)) ([]float64, error) {
	var out []float64
	// The first opens the connection (DNS, TCP, TLS) and isn't counted.
	for i := 0; i <= n; i++ {
		var sent, first time.Time
		trace := &httptrace.ClientTrace{
			WroteRequest:         func(httptrace.WroteRequestInfo) { sent = time.Now() },
			GotFirstResponseByte: func() { first = time.Now() },
		}
		req, err := http.NewRequestWithContext(httptrace.WithClientTrace(ctx, trace), http.MethodGet, cfSpeedBase+"/__down?bytes=0", nil)
		if err != nil {
			return nil, err
		}
		resp, err := client.Do(req)
		if err != nil {
			return nil, err
		}
		_, _ = io.Copy(io.Discard, resp.Body)
		resp.Body.Close()
		if err := cfStatus(resp); err != nil {
			return nil, err
		}
		if i == 0 {
			continue
		}
		ms := float64(first.Sub(sent).Microseconds())/1000 - serverTime(resp.Header)
		out = append(out, max(ms, 0.1))
		step(i)
	}
	return out, nil
}

// serverTime is what Cloudflare spent on a request, in ms: the durations in Server-Timing
// ("cfSpeedEdge;dur=4, cfSpeedWorker;dur=18") added up. Taking off both leaves a steady round
// trip; the worker's share alone swings by 15 ms from one request to the next.
func serverTime(h http.Header) float64 {
	var total float64
	for _, v := range h.Values("Server-Timing") {
		for _, part := range strings.Split(v, ",") {
			_, rest, ok := strings.Cut(part, "dur=")
			if !ok {
				continue
			}
			end := strings.IndexFunc(rest, func(r rune) bool { return (r < '0' || r > '9') && r != '.' })
			if end < 0 {
				end = len(rest)
			}
			if d, err := strconv.ParseFloat(rest[:end], 64); err == nil {
				total += d
			}
		}
	}
	return total
}

var errCloudflareBusy = errors.New("Cloudflare is turning away tests from this address for now (too many in a short time). Try again in a while, or test with Ookla")

func cfStatus(resp *http.Response) error {
	switch {
	case resp.StatusCode == http.StatusTooManyRequests:
		return errCloudflareBusy
	case resp.StatusCode != http.StatusOK:
		return fmt.Errorf("Cloudflare answered HTTP %d", resp.StatusCode)
	}
	return nil
}

func median(v []float64) float64 {
	if len(v) == 0 {
		return 0
	}
	s := slices.Clone(v)
	slices.Sort(s)
	if len(s)%2 == 1 {
		return s[len(s)/2]
	}
	return (s[len(s)/2-1] + s[len(s)/2]) / 2
}

// jitter is the mean change between one ping and the next.
func jitter(v []float64) float64 {
	if len(v) < 2 {
		return 0
	}
	var sum float64
	for i := 1; i < len(v); i++ {
		d := v[i] - v[i-1]
		if d < 0 {
			d = -d
		}
		sum += d
	}
	return sum / float64(len(v)-1)
}

const cfStreams = 6

// The bytes an upload sends: random, so nothing on the way can compress them.
var uploadBlock = func() []byte {
	b := make([]byte, 1<<20)
	_, _ = rand.Read(b)
	return b
}()

type countWriter struct{ n *atomic.Int64 }

func (c countWriter) Write(p []byte) (int, error) {
	c.n.Add(int64(len(p)))
	return len(p), nil
}

// uploadBody is size bytes of uploadBlock, counted as the connection takes them (the data the test
// uses; not its speed, as the system's send buffers take the first megabytes at once).
type uploadBody struct {
	left int64
	off  int
	n    *atomic.Int64
}

func (u *uploadBody) Read(p []byte) (int, error) {
	if u.left <= 0 {
		return 0, io.EOF
	}
	k := copy(p[:min(int64(len(p)), u.left)], uploadBlock[u.off:])
	u.off = (u.off + k) % len(uploadBlock)
	u.left -= int64(k)
	u.n.Add(int64(k))
	return k, nil
}

// cfTransfer moves data over several connections for at most limit (or until max bytes), and
// returns the speed after a warm-up (TCP needs a moment to open up) and the bytes it used. A
// download counts what arrives; an upload counts each piece once Cloudflare has answered for it,
// so in pieces small enough to finish many times over.
func cfTransfer(parent context.Context, client *http.Client, up bool, limit time.Duration, maxBytes int64, progress func(mbps, done float64)) (float64, int64, error) {
	progress(0, 0)
	ctx, cancel := context.WithTimeout(parent, limit)
	defer cancel()
	// moved is what counts for the speed; sent is all the data used.
	var moved, uploaded atomic.Int64
	sent := &moved
	var errMu sync.Mutex
	var firstErr error
	chunk := int64(25 << 20)
	if up {
		sent = &uploaded
		chunk = min(max(maxBytes/12, 1<<20), 8<<20)
	}
	once := func() error {
		var req *http.Request
		var err error
		if up {
			req, err = http.NewRequestWithContext(ctx, http.MethodPost, cfSpeedBase+"/__up", &uploadBody{left: chunk, n: &uploaded})
			if req != nil {
				req.ContentLength = chunk
				req.Header.Set("Content-Type", "application/octet-stream")
			}
		} else {
			req, err = http.NewRequestWithContext(ctx, http.MethodGet, cfSpeedBase+"/__down?bytes="+strconv.FormatInt(chunk, 10), nil)
		}
		if err != nil {
			return err
		}
		resp, err := client.Do(req)
		if err != nil {
			return err
		}
		defer resp.Body.Close()
		if err := cfStatus(resp); err != nil {
			return err
		}
		if up {
			if _, err = io.Copy(io.Discard, resp.Body); err == nil {
				moved.Add(chunk)
			}
		} else {
			_, err = io.Copy(countWriter{&moved}, resp.Body)
		}
		return err
	}
	var wg sync.WaitGroup
	for range cfStreams {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for ctx.Err() == nil && sent.Load() < maxBytes {
				if err := once(); err != nil && ctx.Err() == nil {
					errMu.Lock()
					if firstErr == nil {
						firstErr = err
					}
					errMu.Unlock()
					cancel()
					return
				}
			}
		}()
	}
	done := make(chan struct{})
	go func() {
		wg.Wait()
		close(done)
	}()

	type sample struct {
		at    time.Duration
		bytes int64
	}
	start := time.Now()
	samples := []sample{{0, 0}}
	tick := time.NewTicker(200 * time.Millisecond)
	defer tick.Stop()
wait:
	for {
		select {
		case <-done:
			break wait
		case <-tick.C:
			s := sample{time.Since(start), moved.Load()}
			samples = append(samples, s)
			// The speed over the last second, for the gauge.
			prev := samples[max(0, len(samples)-6)]
			used := sent.Load()
			progress(mbit(s.bytes-prev.bytes, s.at-prev.at), max(float64(s.at)/float64(limit), float64(used)/float64(maxBytes)))
			if used >= maxBytes {
				cancel()
			}
		}
	}
	end := sample{time.Since(start), moved.Load()}
	used := sent.Load()
	if err := parent.Err(); err != nil {
		return 0, used, err
	}
	if firstErr != nil && end.bytes < chunk {
		return 0, used, firstErr
	}
	// The first quarter (2 seconds at most) is the warm-up.
	warm := min(end.at/4, 2*time.Second)
	from := samples[0]
	for _, s := range samples {
		if s.at <= warm {
			from = s
		}
	}
	return mbit(end.bytes-from.bytes, end.at-from.at), used, nil
}

// ----- Ookla -----

var ooklaArch = map[string]string{"amd64": "x86_64", "arm64": "aarch64", "arm": "armhf", "386": "i386"}

func (s *server) ooklaPath() string {
	return filepath.Join(s.cfg.StateDir, "tools", "speedtest", "speedtest")
}

// installOokla downloads Ookla's Speedtest CLI from Ookla into the state folder.
func (s *server) installOokla(ctx context.Context) error {
	arch, ok := ooklaArch[runtime.GOARCH]
	if !ok {
		return fmt.Errorf("Ookla has no Speedtest CLI for %s", runtime.GOARCH)
	}
	url := fmt.Sprintf("https://install.speedtest.net/app/cli/ookla-speedtest-%s-linux-%s.tgz", ooklaVersion, arch)
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return err
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return fmt.Errorf("downloading Speedtest: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("downloading Speedtest: HTTP %d", resp.StatusCode)
	}
	gz, err := gzip.NewReader(resp.Body)
	if err != nil {
		return err
	}
	tr := tar.NewReader(gz)
	for {
		h, err := tr.Next()
		if err == io.EOF {
			return errors.New("the download has no speedtest program in it")
		}
		if err != nil {
			return err
		}
		if filepath.Base(h.Name) != "speedtest" || h.Typeflag != tar.TypeReg {
			continue
		}
		path := s.ooklaPath()
		if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
			return err
		}
		tmp := path + ".tmp"
		f, err := os.OpenFile(tmp, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, 0o755)
		if err != nil {
			return err
		}
		_, err = io.Copy(f, io.LimitReader(tr, 64<<20))
		if cerr := f.Close(); err == nil {
			err = cerr
		}
		if err != nil {
			os.Remove(tmp)
			return err
		}
		return os.Rename(tmp, path)
	}
}

// ookla runs the CLI, with its settings file in its own folder.
func (s *server) ookla(ctx context.Context, args ...string) *exec.Cmd {
	cmd := exec.CommandContext(ctx, s.ooklaPath(), append([]string{"--accept-license", "--accept-gdpr"}, args...)...)
	cmd.Env = []string{"HOME=" + filepath.Dir(s.ooklaPath()), "PATH=/usr/sbin:/usr/bin:/sbin:/bin"}
	return cmd
}

type ooklaServer struct {
	ID       int    `json:"id"`
	Name     string `json:"name"`
	Location string `json:"location"`
	Country  string `json:"country"`
	Host     string `json:"host"`
}

type ooklaStage struct {
	Bandwidth float64 `json:"bandwidth"` // bytes a second
	Bytes     int64   `json:"bytes"`
	Progress  float64 `json:"progress"`
	Latency   struct {
		IQM float64 `json:"iqm"`
	} `json:"latency"`
}

// ooklaLine is one line of `speedtest -f jsonl -p yes`.
type ooklaLine struct {
	Type      string `json:"type"`
	Level     string `json:"level"`
	Message   string `json:"message"`
	ISP       string `json:"isp"`
	Interface struct {
		ExternalIP string `json:"externalIp"`
	} `json:"interface"`
	Server ooklaServer `json:"server"`
	Ping   struct {
		Jitter   float64 `json:"jitter"`
		Latency  float64 `json:"latency"`
		Progress float64 `json:"progress"`
	} `json:"ping"`
	Download   ooklaStage `json:"download"`
	Upload     ooklaStage `json:"upload"`
	PacketLoss *float64   `json:"packetLoss"`
	Result     struct {
		URL string `json:"url"`
	} `json:"result"`
}

func (o ooklaServer) label() string {
	if o.Location == "" {
		return o.Name
	}
	return o.Name + ", " + o.Location
}

func (s *server) ooklaTest(ctx context.Context, serverID int, progress func(phase string, mbps, overall float64)) (speedResult, error) {
	args := []string{"-f", "jsonl", "-p", "yes"}
	if serverID > 0 {
		args = append(args, "-s", strconv.Itoa(serverID))
	}
	cmd := s.ookla(ctx, args...)
	out, err := cmd.StdoutPipe()
	if err != nil {
		return speedResult{}, err
	}
	var stderr bytes.Buffer
	cmd.Stderr = &stderr
	if err := cmd.Start(); err != nil {
		return speedResult{}, err
	}
	var res speedResult
	var finished bool
	var problem string
	sc := bufio.NewScanner(out)
	sc.Buffer(make([]byte, 64<<10), 1<<20)
	for sc.Scan() {
		var l ooklaLine
		if json.Unmarshal(sc.Bytes(), &l) != nil {
			continue
		}
		switch l.Type {
		case "testStart":
			res.ISP, res.IP, res.Server = l.ISP, l.Interface.ExternalIP, l.Server.label()
		case "ping":
			progress("ping", 0, 0.1*l.Ping.Progress)
		case "download":
			progress("download", l.Download.Bandwidth*8/1e6, 0.1+0.45*l.Download.Progress)
		case "upload":
			progress("upload", l.Upload.Bandwidth*8/1e6, 0.55+0.45*l.Upload.Progress)
		case "log":
			if l.Level == "error" && l.Message != "" {
				problem = l.Message
			}
		case "result":
			finished = true
			res.Down, res.Up = l.Download.Bandwidth*8/1e6, l.Upload.Bandwidth*8/1e6
			res.Ping, res.Jitter = l.Ping.Latency, l.Ping.Jitter
			res.Loaded = max(l.Download.Latency.IQM, l.Upload.Latency.IQM)
			res.Loss, res.Bytes, res.URL = l.PacketLoss, l.Download.Bytes+l.Upload.Bytes, l.Result.URL
			if l.ISP != "" {
				res.ISP, res.IP, res.Server = l.ISP, l.Interface.ExternalIP, l.Server.label()
			}
		}
	}
	werr := cmd.Wait()
	if finished {
		return res, nil
	}
	if err := ctx.Err(); err != nil {
		return res, err
	}
	if problem == "" {
		problem = strings.TrimSpace(stderr.String())
	}
	if problem == "" && werr != nil {
		problem = werr.Error()
	}
	return res, fmt.Errorf("Speedtest: %s", firstLine(problem))
}

func firstLine(s string) string {
	s, _, _ = strings.Cut(strings.TrimSpace(s), "\n")
	return s
}

func (s *server) ooklaServers(ctx context.Context) ([]ooklaServer, error) {
	st := s.speed
	st.mu.Lock()
	if st.servers != nil && time.Since(st.serversAt) < time.Hour {
		list := st.servers
		st.mu.Unlock()
		return list, nil
	}
	st.mu.Unlock()
	out, err := s.ookla(ctx, "-L", "-f", "json").Output()
	if err != nil {
		return nil, fmt.Errorf("Speedtest: %s", firstLine(string(out)+" "+err.Error()))
	}
	var v struct {
		Servers []ooklaServer `json:"servers"`
	}
	if err := json.Unmarshal(out, &v); err != nil {
		return nil, err
	}
	st.mu.Lock()
	st.servers, st.serversAt = v.Servers, time.Now()
	st.mu.Unlock()
	return v.Servers, nil
}

// ----- Handlers -----

var speedRanges = map[string]time.Duration{
	"24h": 24 * time.Hour, "7d": 7 * 24 * time.Hour, "30d": 30 * 24 * time.Hour, "90d": 90 * 24 * time.Hour, "180d": speedKeep,
}

type speedOokla struct {
	Installed bool   `json:"installed"`
	Version   string `json:"version"`
	Available bool   `json:"available"`
}

type speedInfo struct {
	Config  speedConfig   `json:"config"`
	Running *speedRun     `json:"running"`
	Last    *speedResult  `json:"last"`
	Results []speedResult `json:"results"`
	// Results kept in all, and since when.
	Total int        `json:"total"`
	Since *time.Time `json:"since"`
	Ookla speedOokla `json:"ookla"`
}

func (s *server) speedOoklaInfo() speedOokla {
	_, arch := ooklaArch[runtime.GOARCH]
	return speedOokla{Installed: fileExists(s.ooklaPath()), Version: ooklaVersion, Available: arch}
}

// handleSpeedTest: the settings, the test running, and the results of a range (?range=7d).
// Without a range only the running test and the last result come back, for polling.
func (s *server) handleSpeedTest(w http.ResponseWriter, r *http.Request) {
	span, withResults := speedRanges[r.URL.Query().Get("range")]
	ookla := s.speedOoklaInfo()
	st := s.speed
	st.mu.Lock()
	defer st.mu.Unlock()
	info := speedInfo{Config: st.Config, Last: st.last(), Results: []speedResult{}, Total: len(st.results), Ookla: ookla}
	if st.run != nil {
		run := *st.run
		info.Running = &run
	}
	if len(st.results) > 0 {
		t := st.results[0].Time
		info.Since = &t
	}
	if withResults {
		cut := time.Now().Add(-span)
		i, _ := slices.BinarySearchFunc(st.results, cut, func(r speedResult, t time.Time) int { return r.Time.Compare(t) })
		info.Results = slices.Clone(st.results[i:])
	}
	writeJSON(w, http.StatusOK, info)
}

func (s *server) handleSpeedRun(w http.ResponseWriter, r *http.Request) {
	if err := s.startSpeedTest(true); err != nil {
		writeError(w, http.StatusConflict, err.Error())
		return
	}
	w.WriteHeader(http.StatusAccepted)
}

func (s *server) handleSpeedStop(w http.ResponseWriter, r *http.Request) {
	st := s.speed
	st.mu.Lock()
	if st.run != nil {
		st.run.stopped = true
		st.run.cancel()
	}
	st.mu.Unlock()
	w.WriteHeader(http.StatusNoContent)
}

func (s *server) handleSpeedConfig(w http.ResponseWriter, r *http.Request) {
	var c speedConfig
	if err := decodeJSON(r, &c); err != nil {
		writeError(w, http.StatusBadRequest, "bad settings")
		return
	}
	switch {
	case !slices.Contains(speedIntervals, c.Interval):
		writeError(w, http.StatusBadRequest, "unknown interval")
		return
	case !speedProviders[c.Provider]:
		writeError(w, http.StatusBadRequest, "unknown provider")
		return
	case c.PlanDown < 0 || c.PlanUp < 0 || c.PlanDown > 1e5 || c.PlanUp > 1e5:
		writeError(w, http.StatusBadRequest, "the plan's speed should be between 0 and 100,000 Mbps")
		return
	case c.OoklaServer < 0:
		writeError(w, http.StatusBadRequest, "unknown server")
		return
	}
	if _, ok := cfSizes[c.Size]; !ok {
		c.Size = "light"
	}
	st := s.speed
	st.mu.Lock()
	defer st.mu.Unlock()
	c.OoklaAccepted = st.Config.OoklaAccepted
	if c.Provider == "ookla" && (!c.OoklaAccepted || !fileExists(s.ooklaPath())) {
		writeError(w, http.StatusBadRequest, "install Ookla's Speedtest first")
		return
	}
	st.Config = c
	if err := st.saveConfig(); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// handleSpeedOokla installs Ookla's Speedtest CLI once its license is accepted ({accept: true}),
// and makes it the provider.
func (s *server) handleSpeedOokla(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Accept bool `json:"accept"`
	}
	if err := decodeJSON(r, &body); err != nil || !body.Accept {
		writeError(w, http.StatusBadRequest, "Ookla's license and privacy policy have to be accepted first")
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 2*time.Minute)
	defer cancel()
	if err := s.installOokla(ctx); err != nil {
		writeError(w, http.StatusBadGateway, err.Error())
		return
	}
	st := s.speed
	st.mu.Lock()
	defer st.mu.Unlock()
	st.Config.OoklaAccepted = true
	st.Config.Provider = "ookla"
	if err := st.saveConfig(); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *server) handleSpeedRemoveOokla(w http.ResponseWriter, r *http.Request) {
	st := s.speed
	st.mu.Lock()
	defer st.mu.Unlock()
	if st.run != nil && st.run.Provider == "ookla" {
		writeError(w, http.StatusConflict, errSpeedRunning.Error())
		return
	}
	if err := os.RemoveAll(filepath.Dir(s.ooklaPath())); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	st.Config.OoklaAccepted, st.Config.OoklaServer = false, 0
	st.Config.Provider = "cloudflare"
	st.servers = nil
	if err := st.saveConfig(); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *server) handleSpeedServers(w http.ResponseWriter, r *http.Request) {
	if !fileExists(s.ooklaPath()) {
		writeError(w, http.StatusNotFound, "Ookla's Speedtest isn't installed")
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 30*time.Second)
	defer cancel()
	list, err := s.ooklaServers(ctx)
	if err != nil {
		writeError(w, http.StatusBadGateway, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, list)
}

// handleSpeedExport sends every result as CSV, to open in a spreadsheet or send to the ISP.
func (s *server) handleSpeedExport(w http.ResponseWriter, r *http.Request) {
	st := s.speed
	st.mu.Lock()
	results := slices.Clone(st.results)
	st.mu.Unlock()
	w.Header().Set("Content-Type", "text/csv; charset=utf-8")
	w.Header().Set("Content-Disposition", fmt.Sprintf(`attachment; filename="speedtest-%s.csv"`, time.Now().Format("2006-01-02")))
	cw := csv.NewWriter(w)
	_ = cw.Write([]string{"time", "provider", "download_mbps", "upload_mbps", "ping_ms", "jitter_ms", "loaded_ping_ms", "packet_loss_pct", "server", "isp", "ip", "data_mb", "result_url", "error", "manual"})
	num := func(v float64) string { return strconv.FormatFloat(v, 'f', 2, 64) }
	for _, x := range results {
		loss := ""
		if x.Loss != nil {
			loss = num(*x.Loss)
		}
		_ = cw.Write([]string{
			x.Time.Local().Format(time.RFC3339), x.Provider, num(x.Down), num(x.Up), num(x.Ping), num(x.Jitter), num(x.Loaded), loss,
			x.Server, x.ISP, x.IP, num(float64(x.Bytes) / 1e6), x.URL, x.Error, strconv.FormatBool(x.Manual),
		})
	}
	cw.Flush()
}

func (s *server) handleSpeedClear(w http.ResponseWriter, r *http.Request) {
	st := s.speed
	st.mu.Lock()
	defer st.mu.Unlock()
	st.results = nil
	if err := st.rewrite(); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
