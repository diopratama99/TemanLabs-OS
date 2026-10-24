// TemanLabsOS backend: serves the web desktop and the API it uses (system stats, Docker apps,
// files under the data root, and a terminal), behind a password login.
package main

import (
	"bufio"
	"embed"
	"flag"
	"fmt"
	"io/fs"
	"log"
	"net"
	"net/http"
	"os"
	"strings"
	"time"
)

//go:embed all:web
var webFS embed.FS

func main() {
	configPath := flag.String("config", "/var/lib/temanlabsos/config.json", "path to the config file")
	flag.Usage = func() {
		fmt.Fprintf(os.Stderr, "usage: temanlabsos [-config path]            run the server\n")
		fmt.Fprintf(os.Stderr, "       temanlabsos [-config path] set-password  set the login password (read from stdin)\n")
	}
	flag.Parse()

	cfg, err := loadConfig(*configPath)
	if err != nil {
		log.Fatalf("config: %v", err)
	}

	if flag.Arg(0) == "set-password" {
		if err := setPasswordFromStdin(cfg); err != nil {
			log.Fatal(err)
		}
		fmt.Println("Password updated.")
		return
	}
	if cfg.PasswordHash == "" {
		log.Fatalf("no password set; run: temanlabsos -config %s set-password", *configPath)
	}

	srv, err := newServer(cfg)
	if err != nil {
		log.Fatal(err)
	}
	httpServer := &http.Server{
		Addr:              cfg.Addr,
		Handler:           srv.routes(),
		ReadHeaderTimeout: 10 * time.Second,
	}
	for _, addr := range cfg.RedirectFrom {
		go func() {
			r := &http.Server{Addr: addr, Handler: redirectTo(cfg.Addr), ReadHeaderTimeout: 10 * time.Second}
			log.Printf("redirect from %s: %v", addr, r.ListenAndServe())
		}()
	}
	log.Printf("TemanLabsOS %s listening on %s (files root %s, terminal user %s)", version, cfg.Addr, cfg.Root, cfg.User)
	log.Fatal(httpServer.ListenAndServe())
}

// redirectTo sends requests on to the same host and path at addr's port (none for 80). The
// redirect is temporary, so browsers don't remember it if the address changes again.
func redirectTo(addr string) http.Handler {
	_, port, _ := net.SplitHostPort(addr)
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		host := r.Host
		if h, _, err := net.SplitHostPort(r.Host); err == nil {
			host = h
		}
		if strings.Contains(host, ":") {
			host = "[" + host + "]"
		}
		if port != "" && port != "80" {
			host += ":" + port
		}
		http.Redirect(w, r, "http://"+host+r.URL.RequestURI(), http.StatusTemporaryRedirect)
	})
}

func setPasswordFromStdin(cfg *Config) error {
	fmt.Fprint(os.Stderr, "New password: ")
	line, err := bufio.NewReader(os.Stdin).ReadString('\n')
	if err != nil && line == "" {
		return fmt.Errorf("read password: %w", err)
	}
	password := strings.TrimRight(line, "\r\n")
	if len(password) < 8 {
		return fmt.Errorf("password must be at least 8 characters")
	}
	hash, err := hashPassword(password)
	if err != nil {
		return err
	}
	cfg.PasswordHash = hash
	return cfg.save()
}

// staticHandler serves the embedded frontend, falling back to index.html for client-side routes.
func staticHandler() http.Handler {
	dist, err := fs.Sub(webFS, "web")
	if err != nil {
		panic(err)
	}
	files := http.FileServer(http.FS(dist))
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		path := strings.TrimPrefix(r.URL.Path, "/")
		if path == "" {
			path = "index.html"
		}
		if _, err := fs.Stat(dist, path); err != nil {
			r.URL.Path = "/"
			path = "index.html"
		}
		if strings.HasPrefix(path, "assets/") {
			// Vite puts a content hash in every asset name.
			w.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
		} else {
			w.Header().Set("Cache-Control", "no-cache")
		}
		files.ServeHTTP(w, r)
	})
}
