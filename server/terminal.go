package main

import (
	"context"
	"encoding/json"
	"log"
	"net/http"
	"os"
	"os/exec"
	"strconv"
	"syscall"

	"github.com/coder/websocket"
	"github.com/creack/pty"
)

// handleTerminal runs a login shell in a PTY and bridges it to a WebSocket.
// Client → server: binary frames are keystrokes; text frames are JSON control messages
// ({"type":"resize","cols":80,"rows":24}). Server → client: binary frames of terminal output.
func (s *server) handleTerminal(w http.ResponseWriter, r *http.Request) {
	// websocket.Accept rejects cross-origin upgrades by default (Origin must match Host).
	conn, err := websocket.Accept(w, r, nil)
	if err != nil {
		return
	}
	defer conn.CloseNow()

	cols, _ := strconv.Atoi(r.URL.Query().Get("cols"))
	rows, _ := strconv.Atoi(r.URL.Query().Get("rows"))
	if cols <= 0 || rows <= 0 {
		cols, rows = 80, 24
	}

	cmd, attrs := s.shellCommand()
	tty, err := pty.StartWithAttrs(cmd, &pty.Winsize{Cols: uint16(cols), Rows: uint16(rows)}, attrs)
	if err != nil {
		conn.Close(websocket.StatusInternalError, "could not start shell: "+err.Error())
		return
	}
	defer func() {
		_ = tty.Close()
		if cmd.Process != nil {
			// The shell is a session leader (pty sets Setsid); kill its whole process group.
			_ = syscall.Kill(-cmd.Process.Pid, syscall.SIGHUP)
		}
		_ = cmd.Wait()
	}()

	ctx, cancel := context.WithCancel(r.Context())
	defer cancel()

	// PTY → browser
	go func() {
		defer cancel()
		buf := make([]byte, 32*1024)
		for {
			n, err := tty.Read(buf)
			if n > 0 {
				if werr := conn.Write(ctx, websocket.MessageBinary, buf[:n]); werr != nil {
					return
				}
			}
			if err != nil {
				conn.Close(websocket.StatusNormalClosure, "shell exited")
				return
			}
		}
	}()

	// Browser → PTY
	conn.SetReadLimit(1 << 20)
	for {
		kind, data, err := conn.Read(ctx)
		if err != nil {
			return
		}
		if kind == websocket.MessageBinary {
			if _, err := tty.Write(data); err != nil {
				return
			}
			continue
		}
		var msg struct {
			Type string `json:"type"`
			Cols uint16 `json:"cols"`
			Rows uint16 `json:"rows"`
		}
		if json.Unmarshal(data, &msg) == nil && msg.Type == "resize" && msg.Cols > 0 && msg.Rows > 0 {
			_ = pty.Setsize(tty, &pty.Winsize{Cols: msg.Cols, Rows: msg.Rows})
		}
	}
}

// shellCommand starts the configured user's login shell in their home directory. When the
// server runs as root (as a system service), the shell drops to that user. The attributes are
// returned separately because pty replaces cmd.SysProcAttr with whatever it is given.
func (s *server) shellCommand() (*exec.Cmd, *syscall.SysProcAttr) {
	shell, home, name := "/bin/bash", "/", "root"
	if s.owner != nil {
		shell, home, name = s.owner.shell, s.owner.home, s.owner.name
	}
	cmd := exec.Command(shell, "-l")
	cmd.Dir = home
	cmd.Env = []string{
		"TERM=xterm-256color",
		"COLORTERM=truecolor",
		"HOME=" + home,
		"USER=" + name,
		"LOGNAME=" + name,
		"SHELL=" + shell,
		"LANG=C.UTF-8",
		"PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin:/snap/bin",
	}
	attrs := &syscall.SysProcAttr{Setsid: true, Setctty: true}
	if s.owner != nil && os.Geteuid() == 0 {
		attrs.Credential = &syscall.Credential{Uid: uint32(s.owner.uid), Gid: uint32(s.owner.gid), Groups: s.owner.gids}
	} else if s.owner != nil && os.Geteuid() != s.owner.uid {
		log.Printf("terminal: not root, so the shell runs as the server's own user instead of %s", s.owner.name)
	}
	return cmd, attrs
}
