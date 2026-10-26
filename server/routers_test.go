package main

import (
	"context"
	"crypto/ed25519"
	"crypto/rand"
	"errors"
	"net"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"golang.org/x/crypto/ssh"
)

func TestOutageFree(t *testing.T) {
	now := time.Now()
	end := now.Add(-23 * time.Hour)
	list := []incident{{Start: now.Add(-24 * time.Hour), End: &end}}
	if got := outageFree(list, 24*time.Hour, now.Add(-48*time.Hour)); got < 0.958 || got > 0.959 {
		t.Errorf("one hour down in a day = %v", got)
	}
	// Added an hour ago and up since: 100%.
	if got := outageFree(nil, 24*time.Hour, now.Add(-time.Hour)); got != 1 {
		t.Errorf("no outages = %v", got)
	}
}

func TestRouterNormalize(t *testing.T) {
	others := []routerConf{{ID: "a", Name: "Modem"}, {ID: "b", Name: "Router", Parent: "a"}}
	circle := routerConf{ID: "a", Name: "Modem", Host: "192.168.1.1", Parent: "b"}
	if err := circle.normalize(&others[0], others); err == nil || !strings.Contains(err.Error(), "circle") {
		t.Errorf("circle: %v", err)
	}
	ok := routerConf{ID: "c", Name: "AP", Host: "192.168.1.3", Parent: "b", Restart: routerRestart{Method: "ssh", Username: "root", Password: "x"}}
	if err := ok.normalize(nil, others); err != nil || ok.Kind != "router" || ok.Added.IsZero() {
		t.Errorf("ok: %v %+v", err, ok)
	}
	// Leaving the password empty keeps the saved one; a new host forgets the old SSH key.
	edit := ok
	edit.Restart.Password = ""
	saved := ok
	saved.Restart.HostKey = "SHA256:old"
	if err := edit.normalize(&saved, others); err != nil || edit.Restart.Password != "x" || edit.Restart.HostKey != "SHA256:old" {
		t.Errorf("edit: %v %+v", err, edit.Restart)
	}
	moved := ok
	moved.Host = "192.168.1.4"
	if err := moved.normalize(&saved, others); err != nil || moved.Restart.HostKey != "" {
		t.Errorf("moved: %v %+v", err, moved.Restart)
	}
	noWay := routerConf{ID: "d", Name: "X", Host: "10.0.0.1", AutoRestart: true}
	if err := noWay.normalize(nil, others); err != nil || noWay.AutoRestart {
		t.Errorf("no method can't restart by itself: %v %+v", err, noWay)
	}
}

func TestPlugs(t *testing.T) {
	var mu sync.Mutex
	var got []string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		mu.Lock()
		got = append(got, r.URL.RequestURI())
		mu.Unlock()
		switch {
		case r.URL.Path == "/cm" && r.URL.Query().Get("cmnd") == "Power1":
			_, _ = w.Write([]byte(`{"POWER1":"ON"}`))
		case r.URL.Path == "/cm":
			_, _ = w.Write([]byte(`{"POWER1":"OFF"}`))
		case r.URL.Path == "/rpc/Switch.GetStatus":
			_, _ = w.Write([]byte(`{"id":0,"output":true}`))
		case r.URL.Path == "/rpc/Switch.Set":
			_, _ = w.Write([]byte(`{"was_on":true}`))
		default:
			http.NotFound(w, r)
		}
	}))
	defer srv.Close()
	plug := strings.TrimPrefix(srv.URL, "http://")
	ctx := context.Background()

	tas := routerRestart{Method: "tasmota", Plug: plug, Password: "pw"}
	if on, err := plugState(ctx, tas); err != nil || !on {
		t.Fatalf("tasmota state: %v %v", on, err)
	}
	if err := plugCycle(ctx, tas); err != nil {
		t.Fatal(err)
	}
	last := got[len(got)-1]
	if !strings.Contains(last, "Backlog+Power1+Off%3B+Delay+100%3B+Power1+On") || !strings.Contains(last, "user=admin") || !strings.Contains(last, "password=pw") {
		t.Errorf("tasmota cycle = %s", last)
	}

	shelly := routerRestart{Method: "shelly", Plug: plug}
	if on, err := plugState(ctx, shelly); err != nil || !on {
		t.Fatalf("shelly state: %v %v", on, err)
	}
	if err := plugCycle(ctx, shelly); err != nil {
		t.Fatal(err)
	}
	// The plug switches itself back on: the off command carries the timer.
	if last := got[len(got)-1]; last != "/rpc/Switch.Set?id=0&on=false&toggle_after=10" {
		t.Errorf("shelly cycle = %s", last)
	}
}

// sshServer is an SSH server that accepts admin/secret and records the commands run; "reboot"
// drops the connection without an exit status, as a router going down does.
func sshServer(t *testing.T) (host string, port int, commands *[]string) {
	_, priv, _ := ed25519.GenerateKey(rand.Reader)
	signer, _ := ssh.NewSignerFromKey(priv)
	cfg := &ssh.ServerConfig{PasswordCallback: func(c ssh.ConnMetadata, pass []byte) (*ssh.Permissions, error) {
		if c.User() == "admin" && string(pass) == "secret" {
			return nil, nil
		}
		return nil, errors.New("denied")
	}}
	cfg.AddHostKey(signer)
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { ln.Close() })
	var mu sync.Mutex
	cmds := []string{}
	go func() {
		for {
			conn, err := ln.Accept()
			if err != nil {
				return
			}
			go func() {
				defer conn.Close()
				_, chans, reqs, err := ssh.NewServerConn(conn, cfg)
				if err != nil {
					return
				}
				go ssh.DiscardRequests(reqs)
				for ch := range chans {
					channel, requests, _ := ch.Accept()
					for req := range requests {
						if req.Type != "exec" {
							_ = req.Reply(false, nil)
							continue
						}
						cmd := string(req.Payload[4:])
						mu.Lock()
						cmds = append(cmds, cmd)
						mu.Unlock()
						_ = req.Reply(true, nil)
						if cmd == "reboot" {
							conn.Close()
							return
						}
						_, _ = channel.SendRequest("exit-status", false, ssh.Marshal(struct{ Status uint32 }{1}))
						_, _ = channel.Write([]byte("unknown command\n"))
						channel.Close()
					}
				}
			}()
		}
	}()
	addr := ln.Addr().(*net.TCPAddr)
	return "127.0.0.1", addr.Port, &cmds
}

func TestSSHRestart(t *testing.T) {
	host, port, cmds := sshServer(t)
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	r := routerConf{Host: host, Restart: routerRestart{Method: "ssh", Username: "admin", Password: "secret", Port: port}}

	key, _, err := testRestart(ctx, r)
	if err != nil || !strings.HasPrefix(key, "SHA256:") {
		t.Fatalf("test: %q %v", key, err)
	}
	r.Restart.HostKey = key
	if err := restartRouter(ctx, r); err != nil {
		t.Fatalf("reboot dropping the connection is success: %v", err)
	}
	r.Restart.Command = "frobnicate"
	if err := restartRouter(ctx, r); err == nil || !strings.Contains(err.Error(), "unknown command") {
		t.Errorf("a failing command: %v", err)
	}
	if got := strings.Join(*cmds, ","); got != "reboot,frobnicate" {
		t.Errorf("commands = %s", got)
	}

	bad := r
	bad.Restart.Password = "nope"
	if _, _, err := testRestart(ctx, bad); err == nil || !strings.Contains(err.Error(), "didn’t accept") {
		t.Errorf("wrong password: %v", err)
	}
	moved := r
	moved.Restart.HostKey = "SHA256:someone-else"
	if _, _, err := testRestart(ctx, moved); !errors.Is(err, errHostKeyChanged) {
		t.Errorf("changed key: %v", err)
	}
}
