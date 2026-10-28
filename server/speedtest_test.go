package main

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
	"time"
)

// A stand-in for speed.cloudflare.com: the trace, sized downloads and uploads.
func fakeCloudflare(t *testing.T) *httptest.Server {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /cdn-cgi/trace", func(w http.ResponseWriter, r *http.Request) {
		io.WriteString(w, "fl=1\nip=203.0.113.7\ncolo=SIN\nloc=ID\n")
	})
	mux.HandleFunc("GET /__down", func(w http.ResponseWriter, r *http.Request) {
		n, _ := strconv.ParseInt(r.URL.Query().Get("bytes"), 10, 64)
		w.Header().Set("Server-Timing", "cfSpeedEdge;dur=1, cfSpeedWorker;dur=2")
		w.Header().Set("Content-Length", strconv.FormatInt(n, 10))
		buf := make([]byte, 64<<10)
		for n > 0 {
			k := min(n, int64(len(buf)))
			if _, err := w.Write(buf[:k]); err != nil {
				return
			}
			n -= k
		}
	})
	mux.HandleFunc("POST /__up", func(w http.ResponseWriter, r *http.Request) {
		_, _ = io.Copy(io.Discard, r.Body)
	})
	srv := httptest.NewServer(mux)
	t.Cleanup(srv.Close)
	old := cfSpeedBase
	cfSpeedBase = srv.URL
	t.Cleanup(func() { cfSpeedBase = old })
	return srv
}

func TestCloudflareTest(t *testing.T) {
	fakeCloudflare(t)
	cfSizes["test"] = struct {
		down, up       time.Duration
		downCap, upCap int64
	}{time.Second, time.Second, 40 << 20, 20 << 20}
	defer delete(cfSizes, "test")

	var phases []string
	res, err := cloudflareTest(context.Background(), cfClient(), "test", func(phase string, mbps, overall float64) {
		if len(phases) == 0 || phases[len(phases)-1] != phase {
			phases = append(phases, phase)
		}
		if overall < 0 || overall > 1.0001 {
			t.Errorf("progress %v out of range", overall)
		}
	})
	if err != nil {
		t.Fatal(err)
	}
	if res.Down <= 0 || res.Up <= 0 {
		t.Errorf("speeds %v down, %v up", res.Down, res.Up)
	}
	if res.Server != "Cloudflare Singapore" || res.IP != "203.0.113.7" {
		t.Errorf("server %q, ip %q", res.Server, res.IP)
	}
	// The caps hold (give or take what was on the way when they were reached).
	if res.Bytes < 20<<20 || res.Bytes > 200<<20 {
		t.Errorf("moved %d bytes", res.Bytes)
	}
	if res.Ping < 0.1 {
		t.Errorf("ping %v", res.Ping)
	}
	if strings.Join(phases, ",") != "ping,download,upload" {
		t.Errorf("phases %v", phases)
	}
}

func TestCloudflareTestNoInternet(t *testing.T) {
	old := cfSpeedBase
	cfSpeedBase = "http://127.0.0.1:1"
	defer func() { cfSpeedBase = old }()
	_, err := cloudflareTest(context.Background(), cfClient(), "light", func(string, float64, float64) {})
	if err == nil || !strings.Contains(err.Error(), "no answer from Cloudflare") {
		t.Fatalf("err = %v", err)
	}
}

func TestServerTimeAndStats(t *testing.T) {
	h := http.Header{}
	h.Add("Server-Timing", "cfSpeedEdge;dur=4.5, cfSpeedWorker;dur=18")
	if got := serverTime(h); got != 22.5 {
		t.Errorf("serverTime = %v", got)
	}
	if got := median([]float64{5, 1, 3, 2}); got != 2.5 {
		t.Errorf("median = %v", got)
	}
	if got := jitter([]float64{10, 12, 11, 15}); got != (2.0+1+4)/3 {
		t.Errorf("jitter = %v", got)
	}
	if cfPlace("CGK") != "Cloudflare Jakarta" || cfPlace("XYZ") != "Cloudflare XYZ" || cfPlace("") != "Cloudflare" {
		t.Error("cfPlace")
	}
}

// A stand-in for Ookla's CLI: prints what `speedtest -f jsonl -p yes` prints.
const fakeOokla = `#!/bin/sh
case "$*" in
*-L*) echo '{"type":"serverList","servers":[{"id":46362,"host":"speedtest.example","port":8080,"name":"MyRepublic Indonesia","location":"Tangerang","country":"Indonesia"}]}'; exit 0 ;;
esac
echo '{"type":"testStart","isp":"MyRepublic Indonesia","interface":{"externalIp":"158.140.162.218"},"server":{"id":61871,"name":"Hayat","location":"Bekasi","country":"Indonesia"}}'
echo '{"type":"ping","ping":{"jitter":0.2,"latency":2.6,"progress":0.5}}'
echo '{"type":"download","download":{"bandwidth":25000000,"bytes":1000,"progress":0.5}}'
echo '{"type":"upload","upload":{"bandwidth":12500000,"bytes":1000,"progress":0.5}}'
echo '{"type":"result","ping":{"jitter":0.272,"latency":2.674},"download":{"bandwidth":25754669,"bytes":317436988,"latency":{"iqm":3.153}},"upload":{"bandwidth":25716060,"bytes":293548134,"latency":{"iqm":12.5}},"packetLoss":0,"isp":"MyRepublic Indonesia","interface":{"externalIp":"158.140.162.218"},"server":{"id":61871,"name":"Hayat","location":"Bekasi","country":"Indonesia"},"result":{"url":"https://www.speedtest.net/result/c/abc"}}'
`

func ooklaServerFor(t *testing.T) *server {
	state := t.TempDir()
	s := &server{cfg: &Config{StateDir: state}, speed: newSpeedStore(state)}
	path := s.ooklaPath()
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, []byte(fakeOokla), 0o755); err != nil {
		t.Fatal(err)
	}
	return s
}

func TestOoklaTest(t *testing.T) {
	s := ooklaServerFor(t)
	var last float64
	res, err := s.ooklaTest(context.Background(), 0, func(phase string, mbps, overall float64) { last = overall })
	if err != nil {
		t.Fatal(err)
	}
	if int(res.Down) != 206 || int(res.Up) != 205 || res.Ping != 2.674 || res.Loaded != 12.5 {
		t.Errorf("result %+v", res)
	}
	if res.ISP != "MyRepublic Indonesia" || res.Server != "Hayat, Bekasi" || res.URL == "" || res.Loss == nil || res.Bytes != 317436988+293548134 {
		t.Errorf("result %+v", res)
	}
	if last < 0.7 {
		t.Errorf("progress ended at %v", last)
	}
	list, err := s.ooklaServers(context.Background())
	if err != nil || len(list) != 1 || list[0].ID != 46362 {
		t.Fatalf("servers %v, %v", list, err)
	}
}

func TestOoklaTestError(t *testing.T) {
	s := ooklaServerFor(t)
	// Its error message comes through.
	script := "#!/bin/sh\necho '{\"type\":\"log\",\"level\":\"error\",\"message\":\"Cannot open socket\"}'\nexit 2\n"
	if err := os.WriteFile(s.ooklaPath(), []byte(script), 0o755); err != nil {
		t.Fatal(err)
	}
	_, err := s.ooklaTest(context.Background(), 0, func(string, float64, float64) {})
	if err == nil || err.Error() != "Speedtest: Cannot open socket" {
		t.Fatalf("err = %v", err)
	}
}

func TestSpeedStoreKeepsAndPrunes(t *testing.T) {
	state := t.TempDir()
	st := newSpeedStore(state)
	if st.Config.Provider != "cloudflare" || st.Config.Size != "light" || st.Config.Interval != 0 {
		t.Errorf("defaults %+v", st.Config)
	}
	old := speedResult{Time: time.Now().Add(-speedKeep - time.Hour), Down: 1}
	st.results = []speedResult{old}
	if err := st.rewrite(); err != nil {
		t.Fatal(err)
	}
	st = newSpeedStore(state)
	if len(st.results) != 0 {
		t.Fatalf("old result kept: %v", st.results)
	}
	st.add(speedResult{Time: time.Now().Add(-time.Hour), Down: 100, Up: 50})
	st.add(speedResult{Time: time.Now(), Down: 90, Up: 40, Manual: true})
	st.Config.Interval = 60
	if err := st.saveConfig(); err != nil {
		t.Fatal(err)
	}
	st = newSpeedStore(state)
	if len(st.results) != 2 || st.last().Down != 90 || st.Config.Interval != 60 {
		t.Fatalf("reloaded %+v %+v", st.results, st.Config)
	}
}

func TestSpeedHandlers(t *testing.T) {
	s := ooklaServerFor(t)
	s.speed.add(speedResult{Time: time.Now().Add(-48 * time.Hour), Down: 10})
	s.speed.add(speedResult{Time: time.Now().Add(-time.Hour), Down: 20, Bytes: 5e6})

	get := func(q string) speedInfo {
		w := httptest.NewRecorder()
		s.handleSpeedTest(w, httptest.NewRequest("GET", "/api/speedtest"+q, nil))
		var info speedInfo
		_ = json.NewDecoder(w.Body).Decode(&info)
		return info
	}
	if info := get("?range=24h"); len(info.Results) != 1 || info.Total != 2 || info.Last.Down != 20 || !info.Ookla.Installed {
		t.Errorf("24h: %+v", info)
	}
	if info := get(""); len(info.Results) != 0 || info.Last == nil {
		t.Errorf("status: %+v", info)
	}

	put := func(body string) int {
		w := httptest.NewRecorder()
		s.handleSpeedConfig(w, httptest.NewRequest("PUT", "/api/speedtest/config", strings.NewReader(body)))
		return w.Code
	}
	if code := put(`{"interval":7,"provider":"cloudflare"}`); code != http.StatusBadRequest {
		t.Errorf("odd interval: %d", code)
	}
	// Ookla's license hasn't been accepted.
	if code := put(`{"interval":60,"provider":"ookla"}`); code != http.StatusBadRequest {
		t.Errorf("ookla before accepting: %d", code)
	}
	if code := put(`{"interval":60,"provider":"cloudflare","size":"full","planDown":100,"planUp":50}`); code != http.StatusNoContent {
		t.Errorf("valid: %d", code)
	}
	if c := s.speed.Config; c.Interval != 60 || c.Size != "full" || c.PlanDown != 100 {
		t.Errorf("saved %+v", c)
	}

	w := httptest.NewRecorder()
	s.handleSpeedExport(w, httptest.NewRequest("GET", "/api/speedtest/export", nil))
	lines := strings.Split(strings.TrimSpace(w.Body.String()), "\n")
	if len(lines) != 3 || !strings.HasPrefix(lines[0], "time,provider,download_mbps") || !strings.Contains(lines[2], ",20.00,") {
		t.Errorf("csv:\n%s", w.Body.String())
	}
}

func TestSpeedTestRunsAndStops(t *testing.T) {
	s := ooklaServerFor(t)
	s.speed.Config.Provider, s.speed.Config.OoklaAccepted = "ookla", true
	if err := s.startSpeedTest(true); err != nil {
		t.Fatal(err)
	}
	if err := s.startSpeedTest(true); err != errSpeedRunning && err != nil {
		t.Fatal(err)
	}
	deadline := time.Now().Add(10 * time.Second)
	for {
		s.speed.mu.Lock()
		done := s.speed.run == nil
		s.speed.mu.Unlock()
		if done {
			break
		}
		if time.Now().After(deadline) {
			t.Fatal("the test didn't finish")
		}
		time.Sleep(20 * time.Millisecond)
	}
	last := s.speed.last()
	if last == nil || last.Provider != "ookla" || !last.Manual || last.Error != "" || int(last.Down) != 206 {
		t.Fatalf("last %+v", last)
	}
}

// TL_LIVE_SPEEDTEST=light (or full) runs a real test against Cloudflare and prints it.
func TestCloudflareLive(t *testing.T) {
	size := os.Getenv("TL_LIVE_SPEEDTEST")
	if size == "" {
		t.Skip("set TL_LIVE_SPEEDTEST=light or full to run a real test")
	}
	res, err := cloudflareTest(context.Background(), cfClient(), size, func(string, float64, float64) {})
	t.Logf("%+v err=%v", res, err)
}

func TestCloudflareBusy(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/cdn-cgi/trace" {
			io.WriteString(w, "ip=203.0.113.7\ncolo=SIN\n")
			return
		}
		w.WriteHeader(http.StatusTooManyRequests)
	}))
	defer srv.Close()
	old := cfSpeedBase
	cfSpeedBase = srv.URL
	defer func() { cfSpeedBase = old }()
	if _, err := cloudflareTest(context.Background(), cfClient(), "light", func(string, float64, float64) {}); err != errCloudflareBusy {
		t.Fatalf("err = %v", err)
	}
}
