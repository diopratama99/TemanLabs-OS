package main

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"net"
	"net/http"
	"os/exec"
	"slices"
	"strconv"
	"strings"
	"sync"
	"syscall"
	"time"
)

// Settings › Network › Port: the port the desktop is opened at, changed while the server runs.
// The new port opens beside the old one, so nothing restarts and nobody is cut off: the old port
// (kept in redirectFrom) still serves everything, and a browser that opens it moves itself to the
// new port, taking this browser's settings (kept per address by the browser) along.

// listeners is every address TemanLabsOS listens on: the desktop's (main) and the old ones.
type listeners struct {
	mu      sync.Mutex
	handler http.Handler
	main    string
	open    map[string]*http.Server
}

func newListeners(handler http.Handler) *listeners {
	return &listeners{handler: handler, open: map[string]*http.Server{}}
}

// listen opens addr; opened says whether it wasn't open already.
func (l *listeners) listen(addr string) (opened bool, err error) {
	l.mu.Lock()
	defer l.mu.Unlock()
	if _, ok := l.open[addr]; ok {
		return false, nil
	}
	ln, err := net.Listen("tcp", addr)
	if err != nil {
		return false, err
	}
	srv := &http.Server{Handler: l.handler, ReadHeaderTimeout: 10 * time.Second}
	l.open[addr] = srv
	go func() {
		err := srv.Serve(ln)
		if errors.Is(err, http.ErrServerClosed) {
			return
		}
		if l.mainAddr() == addr {
			log.Fatalf("listen on %s: %v", addr, err)
		}
		log.Printf("listen on %s: %v", addr, err)
	}()
	return true, nil
}

// close stops listening on addr, letting requests under way finish first.
func (l *listeners) close(addr string) {
	l.mu.Lock()
	srv := l.open[addr]
	delete(l.open, addr)
	l.mu.Unlock()
	if srv == nil {
		return
	}
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if srv.Shutdown(ctx) != nil {
		_ = srv.Close()
	}
}

func (l *listeners) mainAddr() string {
	l.mu.Lock()
	defer l.mu.Unlock()
	return l.main
}

func (l *listeners) setMain(addr string) {
	l.mu.Lock()
	l.main = addr
	l.mu.Unlock()
}

// addr is the desktop's address now (the config's, until it's changed while running).
func (s *server) addr() string {
	if s.listen != nil {
		return s.listen.mainAddr()
	}
	return s.cfg.Addr
}

func portOf(addr string) int {
	_, p, _ := net.SplitHostPort(addr)
	n, _ := strconv.Atoi(p)
	return n
}

// arrivedOn is the port of the listener the request came in on.
func arrivedOn(r *http.Request) int {
	if a, ok := r.Context().Value(http.LocalAddrContextKey).(net.Addr); ok {
		return portOf(a.String())
	}
	return 0
}

// direct says the browser asked for this server's port itself, not through a reverse proxy,
// tunnel or a router's port forward (whose address the server doesn't know): only then can it
// move to the new port by changing the port in its address.
func direct(r *http.Request) bool {
	for _, h := range []string{"X-Forwarded-For", "X-Forwarded-Host", "Forwarded", "X-Real-Ip"} {
		if r.Header.Get(h) != "" {
			return false
		}
	}
	port := 80
	if _, p, err := net.SplitHostPort(r.Host); err == nil {
		port, _ = strconv.Atoi(p)
	}
	return port == arrivedOn(r)
}

type portInfo struct {
	Port int `json:"port"`
	// The port this request came in on, and whether the browser asked for it directly.
	Here   int  `json:"here"`
	Direct bool `json:"direct"`
	// Old ports that still open the desktop.
	OldPorts []int `json:"oldPorts"`
}

// handleGetPort needs no session: the page asks it before signing in, to move to the new port.
func (s *server) handleGetPort(w http.ResponseWriter, r *http.Request) {
	s.portMu.Lock()
	old := []int{}
	for _, a := range s.cfg.RedirectFrom {
		if p := portOf(a); p > 0 && !slices.Contains(old, p) {
			old = append(old, p)
		}
	}
	s.portMu.Unlock()
	writeJSON(w, http.StatusOK, portInfo{Port: portOf(s.addr()), Here: arrivedOn(r), Direct: direct(r), OldPorts: old})
}

func (s *server) handleSetPort(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Port    int  `json:"port"`
		KeepOld bool `json:"keepOld"`
	}
	if decodeJSON(r, &body) != nil {
		writeError(w, http.StatusBadRequest, "invalid request")
		return
	}
	if msg := checkPort(body.Port); msg != "" {
		writeError(w, http.StatusBadRequest, msg)
		return
	}
	if s.listen == nil {
		writeError(w, http.StatusServiceUnavailable, "the port can't be changed on this server")
		return
	}
	s.portMu.Lock()
	defer s.portMu.Unlock()
	old := s.addr()
	host, _, _ := net.SplitHostPort(old)
	next := net.JoinHostPort(host, strconv.Itoa(body.Port))
	if next == old {
		writeError(w, http.StatusBadRequest, fmt.Sprintf("TemanLabsOS already uses port %d.", body.Port))
		return
	}
	opened, err := s.listen.listen(next)
	if err != nil {
		if errors.Is(err, syscall.EADDRINUSE) {
			writeError(w, http.StatusConflict, fmt.Sprintf("Another program uses port %d. Choose another one.", body.Port))
		} else {
			writeError(w, http.StatusInternalServerError, err.Error())
		}
		return
	}
	firewall := allowInFirewall(r.Context(), body.Port)

	prevAddr, prevFrom := s.cfg.Addr, s.cfg.RedirectFrom
	from := slices.DeleteFunc(slices.Clone(prevFrom), func(a string) bool { return a == next || a == old })
	if body.KeepOld {
		from = append(from, old)
	}
	s.cfg.Addr, s.cfg.RedirectFrom = next, from
	if err := s.cfg.save(); err != nil {
		s.cfg.Addr, s.cfg.RedirectFrom = prevAddr, prevFrom
		if opened {
			go s.listen.close(next)
		}
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	s.listen.setMain(next)
	log.Printf("moved to %s (from %s, kept: %v)", next, old, body.KeepOld)
	if !body.KeepOld {
		// After this answer is out.
		go func() {
			time.Sleep(2 * time.Second)
			s.listen.close(old)
		}()
	}
	writeJSON(w, http.StatusOK, map[string]any{"port": body.Port, "firewall": firewall})
}

// checkPort says what's wrong with a port for the desktop, if anything.
func checkPort(port int) string {
	switch {
	case port < 1 || port > 65535:
		return "A port is a number from 1 to 65535."
	case port >= framePortFirst && port <= framePortLast:
		return fmt.Sprintf("Ports %d–%d are kept for apps’ windows. Choose another one.", framePortFirst, framePortLast)
	}
	return ""
}

// allowInFirewall opens the port in ufw when it's on, so the new address isn't blocked: "allowed",
// "failed", or "" when there's no firewall to open.
func allowInFirewall(ctx context.Context, port int) string {
	if _, err := exec.LookPath("ufw"); err != nil {
		return ""
	}
	ctx, cancel := context.WithTimeout(ctx, 20*time.Second)
	defer cancel()
	out, err := exec.CommandContext(ctx, "ufw", "status").CombinedOutput()
	if err != nil || !strings.Contains(string(out), "Status: active") {
		return ""
	}
	if exec.CommandContext(ctx, "ufw", "allow", fmt.Sprintf("%d/tcp", port)).Run() != nil {
		return "failed"
	}
	return "allowed"
}

// ----- Taking a browser's settings to the new port -----

// A browser keeps settings per address, port included, so at the new port it would start afresh.
// Before moving, the page leaves its settings here under a random token and picks them up at the
// new port. They're kept a few minutes and given out once.

const (
	handoffMax   = 512 << 10
	handoffKeep  = 5 * time.Minute
	handoffLimit = 20
)

type handoff struct {
	data []byte
	at   time.Time
}

type handoffs struct {
	mu   sync.Mutex
	byID map[string]handoff
}

func (h *handoffs) put(data []byte) string {
	b := make([]byte, 16)
	_, _ = rand.Read(b)
	id := hex.EncodeToString(b)
	h.mu.Lock()
	defer h.mu.Unlock()
	if h.byID == nil {
		h.byID = map[string]handoff{}
	}
	for k, v := range h.byID {
		if time.Since(v.at) > handoffKeep {
			delete(h.byID, k)
		}
	}
	for len(h.byID) >= handoffLimit {
		var oldest string
		for k, v := range h.byID {
			if oldest == "" || v.at.Before(h.byID[oldest].at) {
				oldest = k
			}
		}
		delete(h.byID, oldest)
	}
	h.byID[id] = handoff{data: data, at: time.Now()}
	return id
}

func (h *handoffs) take(id string) ([]byte, bool) {
	h.mu.Lock()
	defer h.mu.Unlock()
	v, ok := h.byID[id]
	delete(h.byID, id)
	if !ok || time.Since(v.at) > handoffKeep {
		return nil, false
	}
	return v.data, true
}

// handlePutHandoff needs no session, like the lock screen: settings are this browser's own, and
// the token is the only way to them.
func (s *server) handlePutHandoff(w http.ResponseWriter, r *http.Request) {
	var data map[string]string
	r.Body = http.MaxBytesReader(w, r.Body, handoffMax)
	if err := json.NewDecoder(r.Body).Decode(&data); err != nil {
		writeError(w, http.StatusBadRequest, "invalid settings")
		return
	}
	raw, _ := json.Marshal(data)
	writeJSON(w, http.StatusOK, map[string]string{"token": s.handoffs.put(raw)})
}

func (s *server) handleTakeHandoff(w http.ResponseWriter, r *http.Request) {
	data, ok := s.handoffs.take(r.PathValue("token"))
	if !ok {
		writeError(w, http.StatusNotFound, "gone")
		return
	}
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-store")
	_, _ = w.Write(data)
}
