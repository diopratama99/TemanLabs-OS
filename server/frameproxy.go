package main

import (
	"crypto/tls"
	"fmt"
	"log"
	"net"
	"net/http"
	"net/http/httputil"
	"net/url"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"time"
)

// Many apps send X-Frame-Options or CSP frame-ancestors, so the browser refuses to show them in
// a TemanLabsOS window. For those, a per-app reverse proxy on its own port (the app keeps "/" as
// its root, so absolute links work) passes everything through except those headers.
const (
	framePortFirst = 7710
	framePortLast  = 7799
)

var frameAncestors = regexp.MustCompile(`(?i)\s*frame-ancestors[^;]*;?`)

// Apps that refuse frames only to browsers elsewhere on the network, so the server's own check
// (from the server itself) can't see it: their images.
var framesBlockedRemotely = []string{"tailscale/tailscale"}

var upstreamTransport = &http.Transport{
	Proxy:               nil,
	TLSClientConfig:     &tls.Config{InsecureSkipVerify: true}, // self-signed certs on apps' own ports are normal
	MaxIdleConnsPerHost: 16,
	IdleConnTimeout:     90 * time.Second,
}

type frameProxies struct {
	mu     sync.Mutex
	ports  map[string]int    // upstream origin → proxy port
	apps   map[string]string // upstream origin → app ID (for its saved sign-in)
	server *server
}

func newFrameProxies(s *server) *frameProxies {
	return &frameProxies{ports: map[string]int{}, apps: map[string]string{}, server: s}
}

type frameProbe struct {
	// It forbids being framed.
	blocked bool
	// It asks for an HTTP Basic login (still, if one was sent).
	basic bool
}

// probeFrame asks the app for its page, with a Basic login if auth is set.
func probeFrame(target, auth string) (frameProbe, error) {
	client := &http.Client{Transport: upstreamTransport, Timeout: 6 * time.Second}
	req, err := http.NewRequest(http.MethodGet, target, nil)
	if err != nil {
		return frameProbe{}, err
	}
	if auth != "" {
		req.Header.Set("Authorization", auth)
	}
	res, err := client.Do(req)
	if err != nil {
		return frameProbe{}, err
	}
	res.Body.Close()
	p := frameProbe{basic: isBasicChallenge(res), blocked: res.Header.Get("X-Frame-Options") != ""}
	csp := strings.ToLower(res.Header.Get("Content-Security-Policy"))
	if strings.Contains(csp, "frame-ancestors") && !strings.Contains(csp, "frame-ancestors *") {
		p.blocked = true
	}
	return p, nil
}

func appOrigin(a *app) string {
	scheme := a.Scheme
	if scheme != "https" {
		scheme = "http"
	}
	host := "127.0.0.1"
	if a.host != "" {
		host = a.host
	}
	return fmt.Sprintf("%s://%s", scheme, net.JoinHostPort(host, strconv.Itoa(*a.Port)))
}

// portFor returns the proxy port for an upstream origin, starting a proxy on first use.
func (f *frameProxies) portFor(origin string, appPort int, appID string) (int, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.apps[origin] = appID
	if p, ok := f.ports[origin]; ok {
		return p, nil
	}
	upstream, err := url.Parse(origin)
	if err != nil {
		return 0, err
	}
	for p := framePortFirst; p <= framePortLast; p++ {
		l, err := net.Listen("tcp", ":"+strconv.Itoa(p))
		if err != nil {
			continue
		}
		srv := &http.Server{Handler: f.handler(origin, upstream, appPort), ReadHeaderTimeout: 10 * time.Second}
		go func() {
			if err := srv.Serve(l); err != nil && err != http.ErrServerClosed {
				log.Printf("frame proxy :%d: %v", p, err)
			}
		}()
		f.ports[origin] = p
		log.Printf("frame proxy :%d → %s", p, origin)
		return p, nil
	}
	return 0, fmt.Errorf("no free port between %d and %d", framePortFirst, framePortLast)
}

// login is the saved sign-in for the app behind an origin, if any.
func (f *frameProxies) login(origin string) (appLogin, bool) {
	f.mu.Lock()
	id := f.apps[origin]
	f.mu.Unlock()
	return f.server.logins.get(id)
}

func (f *frameProxies) handler(origin string, upstream *url.URL, appPort int) http.Handler {
	rp := &httputil.ReverseProxy{
		Transport: upstreamTransport,
		Rewrite: func(pr *httputil.ProxyRequest) {
			pr.SetURL(upstream)
			pr.SetXForwarded()
			// The app sees the address the browser used, so links it builds stay on the proxy.
			pr.Out.Host = pr.In.Host
			withoutSessionCookie(pr.Out)
			if login, ok := f.login(origin); ok && pr.Out.Header.Get("Authorization") == "" {
				pr.Out.Header.Set("Authorization", login.header())
			}
		},
		ModifyResponse: func(res *http.Response) error {
			res.Header.Del("X-Frame-Options")
			// The window signs in itself; the browser's own login dialog would only get in the way.
			if isBasicChallenge(res) {
				res.Header.Del("WWW-Authenticate")
			}
			for _, h := range []string{"Content-Security-Policy", "Content-Security-Policy-Report-Only"} {
				if v := res.Header.Get(h); v != "" {
					res.Header.Set(h, strings.TrimSpace(frameAncestors.ReplaceAllString(v, "")))
				}
			}
			// Redirects to the app's own port would leave the proxy (and be blocked again).
			if loc, err := url.Parse(res.Header.Get("Location")); err == nil && loc.Host != "" && loc.Port() == strconv.Itoa(appPort) {
				loc.Host = res.Request.Host
				loc.Scheme = "http"
				res.Header.Set("Location", loc.String())
			}
			return nil
		},
		ErrorHandler: func(w http.ResponseWriter, r *http.Request, err error) {
			http.Error(w, "TemanLabsOS couldn't reach this app: "+err.Error(), http.StatusBadGateway)
		},
	}
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// Cookies aren't scoped by port, so the TemanLabsOS session arrives here too. Require it:
		// the proxy must not open apps to anyone who isn't signed in.
		if !f.server.sessions.valid(f.server.sessionToken(r)) {
			w.Header().Set("Content-Type", "text/html; charset=utf-8")
			w.WriteHeader(http.StatusUnauthorized)
			fmt.Fprint(w, `<p style="font:14px system-ui;padding:24px">Sign in to TemanLabsOS to open this app.</p>`)
			return
		}
		rp.ServeHTTP(w, r)
	})
}

// withoutSessionCookie keeps the TemanLabsOS session cookie away from proxied apps.
func withoutSessionCookie(r *http.Request) {
	cookies := r.Cookies()
	r.Header.Del("Cookie")
	for _, c := range cookies {
		if c.Name != sessionCookie {
			r.AddCookie(c)
		}
	}
}

// handleAppFrame tells the UI how to show an app in a window: directly, or through a proxy port.
func (s *server) handleAppFrame(w http.ResponseWriter, r *http.Request) {
	a, err := s.findApp(r.Context(), r.PathValue("id"))
	if err != nil {
		writeError(w, http.StatusBadGateway, err.Error())
		return
	}
	if a == nil || a.Port == nil {
		writeError(w, http.StatusNotFound, "this app has no web interface")
		return
	}
	origin := appOrigin(a)
	// Apps listening on localhost only can't be reached from the browser except through the proxy;
	// the window can also ask for it (?proxy=1) when an app doesn't show. Apps behind a Basic
	// login go through it too, which sends the saved sign-in.
	login, signedIn := s.logins.get(a.ID)
	auth := ""
	if signedIn {
		auth = login.header()
	}
	probe, err := probeFrame(origin+a.Path, auth)
	blocked := probe.blocked || probe.basic || signedIn
	for _, c := range a.containers {
		for _, image := range framesBlockedRemotely {
			if strings.HasPrefix(c.Image, image) {
				blocked, err = true, nil
			}
		}
	}
	if r.URL.Query().Get("proxy") == "1" {
		blocked, err = true, nil
	}
	if !a.LocalOnly && (err != nil || !blocked) {
		writeJSON(w, http.StatusOK, map[string]any{"proxied": false})
		return
	}
	port, err := s.frames.portFor(origin, *a.Port, a.ID)
	if err != nil {
		writeJSON(w, http.StatusOK, map[string]any{"proxied": false, "error": err.Error()})
		return
	}
	res := map[string]any{"proxied": true, "port": port}
	if probe.basic || signedIn {
		// Signed in means the saved sign-in still works; otherwise the window asks for one.
		res["auth"] = "basic"
		res["signedIn"] = signedIn && !probe.basic
		res["username"] = login.Username
	}
	writeJSON(w, http.StatusOK, res)
}
