package main

import (
	"bufio"
	"encoding/json"
	"errors"
	"net/http"
	"os"
	"os/user"
	"path/filepath"
	"regexp"
	"slices"
	"strconv"
	"strings"
	"sync"
	"unicode/utf8"
)

// Commands: the server side of the command book. The library itself lives in the frontend
// (src/lib/commandLibrary.ts); the server says which tools are installed, lists the installed
// apps for their own commands, keeps the user's saved commands and favourites, and reads their
// shell history.

type commandApp struct {
	ID         string   `json:"id"`
	Name       string   `json:"name"`
	Containers []string `json:"containers,omitempty"`
	// Compose apps: the project, its folder and compose files.
	Project string   `json:"project,omitempty"`
	Dir     string   `json:"dir,omitempty"`
	Files   []string `json:"files,omitempty"`
	// Native apps: the systemd service that runs it.
	Unit string `json:"unit,omitempty"`
}

type savedCommand struct {
	ID       string `json:"id"`
	Title    string `json:"title"`
	Command  string `json:"command"`
	Note     string `json:"note,omitempty"`
	Keywords string `json:"keywords,omitempty"`
}

type commandBook struct {
	Custom    []savedCommand `json:"custom"`
	Favorites []string       `json:"favorites"`
}

type commandStore struct {
	mu   sync.Mutex
	path string
}

func newCommandStore(stateDir string) *commandStore {
	return &commandStore{path: filepath.Join(stateDir, "commands.json")}
}

func (c *commandStore) load() commandBook {
	c.mu.Lock()
	defer c.mu.Unlock()
	book := commandBook{Custom: []savedCommand{}, Favorites: []string{}}
	if data, err := os.ReadFile(c.path); err == nil {
		_ = json.Unmarshal(data, &book)
	}
	if book.Custom == nil {
		book.Custom = []savedCommand{}
	}
	if book.Favorites == nil {
		book.Favorites = []string{}
	}
	return book
}

func (c *commandStore) save(book commandBook) error {
	c.mu.Lock()
	defer c.mu.Unlock()
	data, err := json.MarshalIndent(book, "", "  ")
	if err != nil {
		return err
	}
	tmp := c.path + ".tmp"
	if err := os.WriteFile(tmp, data, 0o600); err != nil {
		return err
	}
	return os.Rename(tmp, c.path)
}

var toolName = regexp.MustCompile(`^[a-z0-9][a-z0-9._+-]{0,40}$`)

// The service's PATH can be short; look where Ubuntu, snaps and manual installs put programs.
var toolDirs = []string{"/usr/local/sbin", "/usr/local/bin", "/usr/sbin", "/usr/bin", "/sbin", "/bin", "/snap/bin"}

func toolInstalled(name string) bool {
	for _, dir := range toolDirs {
		if info, err := os.Stat(filepath.Join(dir, name)); err == nil && !info.IsDir() && info.Mode()&0o111 != 0 {
			return true
		}
	}
	return false
}

// shellHistory returns the user's shell history, newest first, each command once.
func shellHistory(home string) []string {
	const keep = 500
	var lines []string
	for _, name := range []string{".bash_history", ".zsh_history"} {
		f, err := os.Open(filepath.Join(home, name))
		if err != nil {
			continue
		}
		scanner := bufio.NewScanner(f)
		scanner.Buffer(make([]byte, 64<<10), 1<<20)
		for scanner.Scan() {
			line := scanner.Text()
			// zsh's extended history: ": 1698765432:0;command"
			if strings.HasPrefix(line, ": ") {
				if _, cmd, ok := strings.Cut(line, ";"); ok {
					line = cmd
				}
			}
			if !utf8.ValidString(line) {
				continue
			}
			lines = append(lines, line)
		}
		f.Close()
	}
	seen := map[string]bool{}
	var out []string
	for i := len(lines) - 1; i >= 0 && len(out) < keep; i-- {
		line := strings.TrimSpace(lines[i])
		// Bash's own timestamps ("#1698765432"), one-word noise and huge pastes stay out.
		if line == "" || strings.HasPrefix(line, "#") || len(line) > 500 || seen[line] || line == "ls" || line == "clear" || line == "exit" {
			continue
		}
		seen[line] = true
		out = append(out, line)
	}
	return out
}

// inGroup reports whether the configured user is in a group (docker: commands need no sudo).
func (o *owner) inGroup(name string) bool {
	if o == nil {
		return false
	}
	g, err := user.LookupGroup(name)
	if err != nil {
		return false
	}
	gid, _ := strconv.Atoi(g.Gid)
	return gid == o.gid || slices.Contains(o.gids, uint32(gid))
}

func (s *server) handleCommands(w http.ResponseWriter, r *http.Request) {
	tools := map[string]bool{}
	for _, name := range strings.Split(r.URL.Query().Get("tools"), ",") {
		if name = strings.TrimSpace(name); toolName.MatchString(name) && len(tools) < 200 {
			tools[name] = toolInstalled(name)
		}
	}

	apps := []commandApp{}
	if list, err := s.store.listApps(r.Context()); err == nil {
		for _, a := range list {
			ca := commandApp{ID: a.ID, Name: a.Name, Unit: a.Unit}
			for _, c := range a.containers {
				ca.Containers = append(ca.Containers, c.name())
			}
			if ref, _ := composeOf(a); ref != nil {
				ca.Project, ca.Dir, ca.Files = ref.project, ref.dir, ref.files
			}
			if len(ca.Containers) > 0 || ca.Unit != "" {
				apps = append(apps, ca)
			}
		}
	}

	var history []string
	if s.owner != nil {
		history = shellHistory(s.owner.home)
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"tools":   tools,
		"apps":    apps,
		"book":    s.commands.load(),
		"history": history,
		"user":    s.cfg.User,
		// Docker without sudo when the user is in the docker group.
		"dockerGroup": s.owner.inGroup("docker"),
	})
}

func (s *server) handleSaveCommands(w http.ResponseWriter, r *http.Request) {
	var book commandBook
	if err := decodeJSON(r, &book); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	if err := checkBook(&book); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	if err := s.commands.save(book); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func checkBook(b *commandBook) error {
	if len(b.Custom) > 2000 || len(b.Favorites) > 2000 {
		return errors.New("too many commands")
	}
	ids := map[string]bool{}
	for i := range b.Custom {
		c := &b.Custom[i]
		c.Title, c.Command = strings.TrimSpace(c.Title), strings.TrimSpace(c.Command)
		switch {
		case c.ID == "" || len(c.ID) > 64 || ids[c.ID]:
			return errors.New("every command needs its own id")
		case c.Title == "" || c.Command == "":
			return errors.New("a command needs a title and the command itself")
		case len(c.Title) > 200 || len(c.Command) > 4000 || len(c.Note) > 2000 || len(c.Keywords) > 500:
			return errors.New("that command is too long")
		}
		ids[c.ID] = true
	}
	if b.Custom == nil {
		b.Custom = []savedCommand{}
	}
	if b.Favorites == nil {
		b.Favorites = []string{}
	}
	return nil
}
