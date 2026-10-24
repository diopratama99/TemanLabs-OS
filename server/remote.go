package main

import (
	"bufio"
	"bytes"
	"context"
	"crypto/rand"
	"errors"
	"fmt"
	"io"
	"log"
	"net"
	"net/http"
	"strconv"
	"strings"
	"sync"
	"time"
	"unicode/utf8"

	"github.com/coder/websocket"
)

// Remote screens: guacd (Apache Guacamole's proxy daemon) runs in a small container, listening
// on localhost only. It speaks VNC and RDP to the other computers and a simple text protocol to
// the browser, which this file relays over a WebSocket. The server makes the connection itself,
// with the saved password, so the browser only ever sees pictures and sends keys and clicks.

const (
	remoteImage     = "guacamole/guacd:1.6.0"
	remoteContainer = "temanlabsos-remote"
	remoteAddr      = "127.0.0.1:4822"
	// Containers TemanLabsOS runs for itself; they stay out of the app list.
	labelSystem = "temanlabs.system"
)

type remoteEngine struct {
	docker *dockerClient

	mu         sync.Mutex
	installing bool
	step       string
	err        string
}

type engineStatus struct {
	// Docker is there to run the engine.
	Docker     bool   `json:"docker"`
	Installed  bool   `json:"installed"`
	Running    bool   `json:"running"`
	Installing bool   `json:"installing"`
	Step       string `json:"step,omitempty"`
	Error      string `json:"error,omitempty"`
}

func newRemoteEngine(docker *dockerClient) *remoteEngine {
	return &remoteEngine{docker: docker}
}

func (e *remoteEngine) find(ctx context.Context) (*container, error) {
	list, err := e.docker.containers(ctx)
	if err != nil {
		return nil, err
	}
	for _, c := range list {
		if c.name() == remoteContainer {
			return &c, nil
		}
	}
	return nil, nil
}

func (e *remoteEngine) status(ctx context.Context) engineStatus {
	e.mu.Lock()
	st := engineStatus{Installing: e.installing, Step: e.step, Error: e.err}
	e.mu.Unlock()
	c, err := e.find(ctx)
	if err != nil {
		return st
	}
	st.Docker = true
	if c != nil {
		st.Installed = true
		st.Running = c.State == "running"
	}
	return st
}

// install downloads the engine, creates its container and starts it, in the background.
func (e *remoteEngine) install() {
	e.mu.Lock()
	if e.installing {
		e.mu.Unlock()
		return
	}
	e.installing, e.step, e.err = true, "Downloading", ""
	e.mu.Unlock()

	go func() {
		ctx, cancel := context.WithTimeout(context.Background(), 20*time.Minute)
		defer cancel()
		err := e.ensure(ctx, func(step string) {
			e.mu.Lock()
			e.step = step
			e.mu.Unlock()
		})
		e.mu.Lock()
		e.installing, e.step = false, ""
		if err != nil {
			e.err = err.Error()
			log.Printf("remote desktop engine: %v", err)
		}
		e.mu.Unlock()
	}()
}

// ensure makes the engine run: pulling and creating it if needed, starting it if stopped.
func (e *remoteEngine) ensure(ctx context.Context, progress func(string)) error {
	c, err := e.find(ctx)
	if err != nil {
		return err
	}
	if c == nil {
		progress("Downloading")
		if err := e.docker.pull(ctx, remoteImage, func(string, ...any) {}); err != nil {
			return err
		}
		progress("Starting")
		body := map[string]any{
			"Image":        remoteImage,
			"Labels":       map[string]string{labelSystem: "remote-desktop"},
			"ExposedPorts": map[string]any{"4822/tcp": map[string]any{}},
			"HostConfig": map[string]any{
				// Only the server itself can reach it: guacd connects anywhere it's told to.
				"PortBindings":  map[string]any{"4822/tcp": []map[string]string{{"HostIp": "127.0.0.1", "HostPort": "4822"}}},
				"RestartPolicy": map[string]any{"Name": "unless-stopped"},
			},
		}
		var created struct {
			ID string `json:"Id"`
		}
		if err := e.docker.send(ctx, http.MethodPost, "/containers/create?name="+remoteContainer, body, &created); err != nil {
			return err
		}
		return e.docker.startContainer(ctx, created.ID)
	}
	if c.State != "running" {
		progress("Starting")
		return e.docker.startContainer(ctx, c.ID)
	}
	return nil
}

func (s *server) handleInstallRemote(w http.ResponseWriter, r *http.Request) {
	if !s.remote.status(r.Context()).Docker {
		writeError(w, http.StatusBadRequest, "remote screens need Docker on the server")
		return
	}
	s.remote.install()
	w.WriteHeader(http.StatusAccepted)
}

// ----- The Guacamole protocol -----
// Instructions are comma-separated elements ending in ';', each written as LENGTH.VALUE, where
// the length counts Unicode characters, not bytes.

func guacEncode(elems ...string) []byte {
	var b bytes.Buffer
	for i, el := range elems {
		if i > 0 {
			b.WriteByte(',')
		}
		b.WriteString(strconv.Itoa(utf8.RuneCountInString(el)))
		b.WriteByte('.')
		b.WriteString(el)
	}
	b.WriteByte(';')
	return b.Bytes()
}

var errMalformed = errors.New("malformed instruction")

type guacReader struct{ r *bufio.Reader }

// next reads one instruction: its raw text (to pass on unchanged) and its elements.
func (g *guacReader) next() (raw []byte, elems []string, err error) {
	for {
		n := 0
		for {
			c, err := g.r.ReadByte()
			if err != nil {
				return nil, nil, err
			}
			raw = append(raw, c)
			if c == '.' {
				break
			}
			if c < '0' || c > '9' || n > 1<<24 {
				return nil, nil, errMalformed
			}
			n = n*10 + int(c-'0')
		}
		start := len(raw)
		for i := 0; i < n; {
			// Most of the stream is base64 image data: take ASCII runs in bulk.
			peek, _ := g.r.Peek(min(n-i, g.r.Size()))
			k := 0
			for k < len(peek) && peek[k] < utf8.RuneSelf {
				k++
			}
			if k > 0 {
				raw = append(raw, peek[:k]...)
				_, _ = g.r.Discard(k)
				i += k
				continue
			}
			ch, _, err := g.r.ReadRune()
			if err != nil {
				return nil, nil, err
			}
			raw = utf8.AppendRune(raw, ch)
			i++
		}
		elems = append(elems, string(raw[start:]))
		c, err := g.r.ReadByte()
		if err != nil {
			return nil, nil, err
		}
		raw = append(raw, c)
		switch c {
		case ',':
		case ';':
			return raw, elems, nil
		default:
			return nil, nil, errMalformed
		}
	}
}

// Status codes the browser's client understands (Guacamole.Status.Code).
const (
	guacServerError         = 512
	guacUpstreamNotFound    = 519
	guacUpstreamUnavailable = 520
	guacClientBadRequest    = 768
)

type remoteError struct {
	code int
	msg  string
}

func (e *remoteError) Error() string { return e.msg }

// connectParams are guacd's settings for one device's screen.
func connectParams(d device, q map[string]string) map[string]string {
	p := map[string]string{
		"hostname": d.Host,
		"port":     strconv.Itoa(d.Port),
		"password": d.Password,
	}
	if d.Username != "" {
		p["username"] = d.Username
	}
	switch d.Protocol {
	case "rdp":
		p["security"] = "any"
		p["ignore-cert"] = "true"
		p["resize-method"] = "display-update"
		p["enable-font-smoothing"] = "true"
		p["dpi"] = q["dpi"]
		p["timezone"] = q["timezone"]
	case "vnc":
		// Text copied on either side goes across, including non-Latin characters.
		p["clipboard-encoding"] = "UTF-8"
		// Tight with a JPEG quality: the computer sends compressed pictures instead of lossless
		// pixels, a fraction of the data, and far less for the engine to decode and re-encode.
		p["encodings"] = "tight copyrect zrle hextile zlib raw"
		p["quality-level"] = "6"
		p["compress-level"] = "6"
	}
	return p
}

// handshake opens a session on guacd for the device. It returns guacd's error, if any, as a
// remoteError for the browser.
func handshake(conn net.Conn, gr *guacReader, d device, q map[string]string) error {
	_ = conn.SetDeadline(time.Now().Add(20 * time.Second))
	defer conn.SetDeadline(time.Time{})
	write := func(elems ...string) error {
		_, err := conn.Write(guacEncode(elems...))
		return err
	}
	if err := write("select", d.Protocol); err != nil {
		return err
	}
	var args []string
	for {
		_, elems, err := gr.next()
		if err != nil {
			return err
		}
		if elems[0] == "args" {
			args = elems[1:]
			break
		}
	}
	width, height, dpi := q["width"], q["height"], q["dpi"]
	if err := write("size", width, height, dpi); err != nil {
		return err
	}
	for _, step := range [][]string{
		{"audio"},
		{"video"},
		{"image", "image/png", "image/jpeg", "image/webp"},
	} {
		if err := write(step...); err != nil {
			return err
		}
	}
	if q["timezone"] != "" {
		if err := write("timezone", q["timezone"]); err != nil {
			return err
		}
	}
	params := connectParams(d, q)
	values := []string{"connect"}
	for _, name := range args {
		if strings.HasPrefix(name, "VERSION_") {
			values = append(values, "VERSION_1_5_0")
		} else {
			values = append(values, params[name])
		}
	}
	if err := write(values...); err != nil {
		return err
	}
	for {
		_, elems, err := gr.next()
		if err != nil {
			return err
		}
		switch elems[0] {
		case "ready":
			return nil
		case "error":
			code := guacServerError
			if len(elems) > 2 {
				code, _ = strconv.Atoi(elems[2])
			}
			return &remoteError{code, elems[1]}
		}
	}
}

func screenQuery(r *http.Request) map[string]string {
	q := r.URL.Query()
	clamp := func(key string, def, lo, hi int) string {
		v, err := strconv.Atoi(q.Get(key))
		if err != nil {
			v = def
		}
		return strconv.Itoa(min(hi, max(lo, v)))
	}
	tz := q.Get("timezone")
	if len(tz) > 64 || strings.ContainsAny(tz, ",;") {
		tz = ""
	}
	return map[string]string{
		"width":    clamp("width", 1280, 320, 7680),
		"height":   clamp("height", 720, 240, 4320),
		"dpi":      clamp("dpi", 96, 48, 384),
		"timezone": tz,
	}
}

// handleRemoteTunnel relays one remote screen between the browser and guacd.
func (s *server) handleRemoteTunnel(w http.ResponseWriter, r *http.Request) {
	ws, err := websocket.Accept(w, r, &websocket.AcceptOptions{Subprotocols: []string{"guacamole"}})
	if err != nil {
		return
	}
	ws.SetReadLimit(8 << 20)
	ctx, cancel := context.WithCancel(r.Context())
	defer cancel()

	// Our own failures carry a key (the browser words them); guacd's carry its message.
	fail := func(code int, msg string) {
		_ = ws.Write(ctx, websocket.MessageText, guacEncode("error", msg, strconv.Itoa(code)))
		ws.Close(websocket.StatusNormalClosure, "")
	}
	d, ok := s.devices.get(r.PathValue("id"))
	if !ok {
		fail(guacClientBadRequest, "device-gone")
		return
	}
	if d.Protocol == "" {
		fail(guacClientBadRequest, "no-screen")
		return
	}
	// guacd reports an unreachable computer and a refused password alike, and retries for a while;
	// a knock on the port first tells them apart, at once.
	probe, err := net.DialTimeout("tcp", net.JoinHostPort(d.Host, strconv.Itoa(d.Port)), 4*time.Second)
	if err != nil {
		// A firewall may drop the knock instead of refusing it; then see whether the computer is up.
		if isRefused(err) || probeDevice(ctx, d.Host, 0).Online {
			fail(guacUpstreamNotFound, "screen-off")
		} else {
			fail(guacUpstreamNotFound, "unreachable")
		}
		return
	}
	probe.Close()

	conn, err := net.DialTimeout("tcp", remoteAddr, 3*time.Second)
	if err != nil {
		// The engine may be stopped (after a reboot of Docker, say): start it and try again.
		if st := s.remote.status(ctx); st.Installed && !st.Running {
			if s.remote.ensure(ctx, func(string) {}) == nil {
				time.Sleep(1500 * time.Millisecond)
				conn, err = net.DialTimeout("tcp", remoteAddr, 3*time.Second)
			}
		}
		if err != nil {
			fail(guacUpstreamUnavailable, "engine-down")
			return
		}
	}
	defer conn.Close()
	gr := &guacReader{r: bufio.NewReaderSize(conn, 64<<10)}
	if err := handshake(conn, gr, d, screenQuery(r)); err != nil {
		var re *remoteError
		if errors.As(err, &re) {
			fail(re.code, re.msg)
		} else {
			fail(guacUpstreamNotFound, "Couldn't start the session: "+err.Error())
		}
		return
	}
	// The client's tunnel opens on this first, internal instruction, which carries its id.
	if err := ws.Write(ctx, websocket.MessageText, guacEncode("", sessionUUID())); err != nil {
		return
	}

	// guacd → browser: whole instructions only, batched while more are already waiting.
	go func() {
		defer cancel()
		var batch bytes.Buffer
		for {
			raw, _, err := gr.next()
			if err != nil {
				if !errors.Is(err, io.EOF) && ctx.Err() == nil {
					log.Printf("remote %s: %v", d.Name, err)
				}
				return
			}
			batch.Write(raw)
			if gr.r.Buffered() == 0 || batch.Len() >= 128<<10 {
				if ws.Write(ctx, websocket.MessageText, batch.Bytes()) != nil {
					return
				}
				batch.Reset()
			}
		}
	}()

	// browser → guacd: keys, mouse, clipboard, size; the tunnel's own pings are answered here.
	go func() {
		defer cancel()
		for {
			_, data, err := ws.Read(ctx)
			if err != nil {
				return
			}
			in := &guacReader{r: bufio.NewReader(bytes.NewReader(data))}
			for {
				raw, elems, err := in.next()
				if err != nil {
					break
				}
				if elems[0] == "" {
					if len(elems) > 1 && elems[1] == "ping" {
						_ = ws.Write(ctx, websocket.MessageText, raw)
					}
					continue
				}
				if _, err := conn.Write(raw); err != nil {
					return
				}
			}
		}
	}()
	<-ctx.Done()
	ws.Close(websocket.StatusNormalClosure, "")
}

func sessionUUID() string {
	b := make([]byte, 16)
	_, _ = rand.Read(b)
	return fmt.Sprintf("%x-%x-%x-%x-%x", b[0:4], b[4:6], b[6:8], b[8:10], b[10:])
}
