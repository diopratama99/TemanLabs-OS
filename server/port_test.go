package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"slices"
	"strings"
	"testing"
	"time"
)

func freePort(t *testing.T) int {
	t.Helper()
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	defer ln.Close()
	return ln.Addr().(*net.TCPAddr).Port
}

func getPort(t *testing.T, port int, host string) portInfo {
	t.Helper()
	req, _ := http.NewRequest(http.MethodGet, fmt.Sprintf("http://127.0.0.1:%d/api/server/port", port), nil)
	if host != "" {
		req.Host = host
	}
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	var info portInfo
	if err := json.NewDecoder(res.Body).Decode(&info); err != nil {
		t.Fatal(err)
	}
	return info
}

// TestChangePort moves a running server to another port: the new one opens, the old one keeps
// answering (and tells a browser there to move), the config remembers both, and without keepOld
// the old port closes.
func TestChangePort(t *testing.T) {
	first, second, third := freePort(t), freePort(t), freePort(t)
	cfg := &Config{Addr: fmt.Sprintf("127.0.0.1:%d", first), path: filepath.Join(t.TempDir(), "config.json")}
	s := &server{cfg: cfg}
	mux := http.NewServeMux()
	mux.HandleFunc("GET /api/server/port", s.handleGetPort)
	mux.HandleFunc("PUT /api/server/port", s.handleSetPort)
	s.listen = newListeners(mux)
	s.listen.setMain(cfg.Addr)
	if _, err := s.listen.listen(cfg.Addr); err != nil {
		t.Fatal(err)
	}

	info := getPort(t, first, "")
	if info.Port != first || info.Here != first || !info.Direct {
		t.Fatalf("before: %+v", info)
	}

	set := func(on, port int, keepOld bool) *http.Response {
		body, _ := json.Marshal(map[string]any{"port": port, "keepOld": keepOld})
		req, _ := http.NewRequest(http.MethodPut, fmt.Sprintf("http://127.0.0.1:%d/api/server/port", on), bytes.NewReader(body))
		res, err := http.DefaultClient.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		return res
	}

	if res := set(first, second, true); res.StatusCode != http.StatusOK {
		msg, _ := io.ReadAll(res.Body)
		t.Fatalf("move: %d %s", res.StatusCode, msg)
	}
	// The old port still answers and says where the desktop is now.
	if info := getPort(t, first, ""); info.Port != second || info.Here != first || !info.Direct || !slices.Equal(info.OldPorts, []int{first}) {
		t.Fatalf("old port after the move: %+v", info)
	}
	if info := getPort(t, second, ""); info.Port != second || info.Here != second {
		t.Fatalf("new port: %+v", info)
	}
	// Through a proxy the browser can't move by changing the port.
	if info := getPort(t, first, "public.example.net"); info.Direct {
		t.Fatalf("a request for another host counted as direct: %+v", info)
	}
	saved, err := loadConfig(cfg.path)
	if err != nil {
		t.Fatal(err)
	}
	if saved.Addr != fmt.Sprintf("127.0.0.1:%d", second) || !slices.Equal(saved.RedirectFrom, []string{fmt.Sprintf("127.0.0.1:%d", first)}) {
		t.Fatalf("saved %q %q", saved.Addr, saved.RedirectFrom)
	}

	// Refused: the same port, apps' window ports, a port another program has.
	for _, c := range []struct {
		port   int
		status int
	}{{second, http.StatusBadRequest}, {framePortFirst, http.StatusBadRequest}, {0, http.StatusBadRequest}} {
		if res := set(second, c.port, true); res.StatusCode != c.status {
			t.Errorf("port %d: got %d", c.port, res.StatusCode)
		}
	}
	busy, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	defer busy.Close()
	res := set(second, busy.Addr().(*net.TCPAddr).Port, true)
	msg, _ := io.ReadAll(res.Body)
	if res.StatusCode != http.StatusConflict || !strings.Contains(string(msg), "Another program") {
		t.Errorf("busy port: %d %s", res.StatusCode, msg)
	}

	// Moving back onto an old port that's still open, then on without keeping the old one.
	if res := set(second, first, true); res.StatusCode != http.StatusOK {
		t.Fatalf("back: %d", res.StatusCode)
	}
	if info := getPort(t, first, ""); info.Port != first || !slices.Equal(info.OldPorts, []int{second}) {
		t.Fatalf("back on the first port: %+v", info)
	}
	if res := set(first, third, false); res.StatusCode != http.StatusOK {
		t.Fatalf("third: %d", res.StatusCode)
	}
	deadline := time.Now().Add(15 * time.Second)
	for {
		c, err := net.DialTimeout("tcp", fmt.Sprintf("127.0.0.1:%d", first), time.Second)
		if err != nil {
			break
		}
		c.Close()
		if time.Now().After(deadline) {
			t.Fatal("the old port stayed open")
		}
		time.Sleep(200 * time.Millisecond)
	}
	if info := getPort(t, third, ""); info.Port != third || !slices.Equal(info.OldPorts, []int{second}) {
		t.Fatalf("after closing the old port: %+v", info)
	}
	// The second port was kept from before, and still answers.
	if info := getPort(t, second, ""); info.Port != third {
		t.Fatalf("second port: %+v", info)
	}
}

func TestHandoff(t *testing.T) {
	s := &server{}
	put := httptest.NewRecorder()
	s.handlePutHandoff(put, httptest.NewRequest(http.MethodPost, "/api/server/handoff", strings.NewReader(`{"temanlabs.settings":"{\"theme\":\"light\"}"}`)))
	var got struct{ Token string }
	if err := json.Unmarshal(put.Body.Bytes(), &got); err != nil || len(got.Token) != 32 {
		t.Fatalf("put: %d %s", put.Code, put.Body)
	}
	take := func() *httptest.ResponseRecorder {
		req := httptest.NewRequest(http.MethodGet, "/api/server/handoff/"+got.Token, nil)
		req.SetPathValue("token", got.Token)
		rec := httptest.NewRecorder()
		s.handleTakeHandoff(rec, req)
		return rec
	}
	if rec := take(); rec.Code != http.StatusOK || !strings.Contains(rec.Body.String(), `"temanlabs.settings":"{\"theme\":\"light\"}"`) {
		t.Fatalf("take: %d %s", rec.Code, rec.Body)
	}
	if rec := take(); rec.Code != http.StatusNotFound {
		t.Fatalf("taken twice: %d", rec.Code)
	}
	// Not a list of settings, or too big.
	for _, body := range []string{`[1]`, `{"k":"` + strings.Repeat("x", handoffMax) + `"}`} {
		rec := httptest.NewRecorder()
		s.handlePutHandoff(rec, httptest.NewRequest(http.MethodPost, "/api/server/handoff", strings.NewReader(body)))
		if rec.Code != http.StatusBadRequest {
			t.Errorf("accepted %.20s…: %d", body, rec.Code)
		}
	}
	// Only the newest are kept.
	for range handoffLimit + 5 {
		s.handoffs.put([]byte("{}"))
	}
	if n := len(s.handoffs.byID); n != handoffLimit {
		t.Fatalf("kept %d", n)
	}
}
