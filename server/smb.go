package main

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"os"
	"os/exec"
	"os/user"
	"path/filepath"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"
)

// File Sharing: Samba shares and users, managed from the web instead of smb.conf and
// smbpasswd. TemanLabsOS keeps its shares in their own file, included from smb.conf, so the
// shares CasaOS writes (smb.casa.conf) and anything hand-written stay untouched.

const (
	smbConf       = "/etc/samba/smb.conf"
	smbOurConf    = "/etc/samba/smb.temanlabs.conf"
	smbConfBackup = "/etc/samba/smb.conf.before-temanlabs"
)

var (
	shareNamePattern = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9 _.$-]{0,79}$`)
	unixUserPattern  = regexp.MustCompile(`^[a-z_][a-z0-9_-]{0,31}$`)
	reservedShares   = map[string]bool{"global": true, "homes": true, "printers": true, "print$": true}
	smbMu            sync.Mutex
)

type smbShare struct {
	Name       string   `json:"name"`
	Path       string   `json:"path"`
	Comment    string   `json:"comment,omitempty"`
	ReadOnly   bool     `json:"readOnly"`
	Guest      bool     `json:"guest"`
	Users      []string `json:"users,omitempty"`
	Browseable bool     `json:"browseable"`
	// temanlabs (editable here), casaos (CasaOS rewrites its file) or samba (smb.conf itself).
	Source string `json:"source"`
}

type smbUser struct {
	Name     string `json:"name"`
	FullName string `json:"fullName,omitempty"`
	Disabled bool   `json:"disabled"`
}

// iniSections reads the [sections] of a Samba config file, keys lower-cased.
func iniSections(path string) ([]string, map[string]map[string]string, string) {
	f, err := os.Open(path)
	if err != nil {
		return nil, nil, ""
	}
	defer f.Close()
	var order []string
	sections := map[string]map[string]string{}
	current, include := "", ""
	scanner := bufio.NewScanner(f)
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if line == "" || line[0] == '#' || line[0] == ';' {
			continue
		}
		if strings.HasPrefix(line, "[") && strings.HasSuffix(line, "]") {
			current = line[1 : len(line)-1]
			if _, ok := sections[current]; !ok {
				order = append(order, current)
				sections[current] = map[string]string{}
			}
			continue
		}
		k, v, ok := strings.Cut(line, "=")
		if !ok || current == "" {
			continue
		}
		key := strings.ToLower(strings.TrimSpace(k))
		sections[current][key] = strings.TrimSpace(v)
		if key == "include" && strings.Contains(v, "casa") {
			include = strings.TrimSpace(v)
		}
	}
	return order, sections, include
}

func smbBool(v string, def bool) bool {
	switch strings.ToLower(v) {
	case "yes", "true", "1":
		return true
	case "no", "false", "0":
		return false
	}
	return def
}

func shareFrom(name string, kv map[string]string, source string) smbShare {
	sh := smbShare{Name: name, Path: kv["path"], Comment: kv["comment"], Source: source}
	sh.ReadOnly = smbBool(kv["read only"], true)
	if v, ok := kv["writable"]; ok {
		sh.ReadOnly = !smbBool(v, false)
	} else if v, ok := kv["writeable"]; ok {
		sh.ReadOnly = !smbBool(v, false)
	}
	sh.Guest = smbBool(kv["guest ok"], false) || smbBool(kv["public"], false)
	sh.Browseable = smbBool(kv["browseable"], true)
	if users := strings.Fields(strings.ReplaceAll(kv["valid users"], ",", " ")); len(users) > 0 {
		sh.Users = users
	}
	return sh
}

func listShares() []smbShare {
	shares := []smbShare{}
	order, sections, casaFile := iniSections(smbConf)
	for _, name := range order {
		if !reservedShares[strings.ToLower(name)] {
			shares = append(shares, shareFrom(name, sections[name], "samba"))
		}
	}
	if casaFile != "" {
		o, s, _ := iniSections(casaFile)
		for _, name := range o {
			shares = append(shares, shareFrom(name, s[name], "casaos"))
		}
	}
	o, s, _ := iniSections(smbOurConf)
	for _, name := range o {
		shares = append(shares, shareFrom(name, s[name], "temanlabs"))
	}
	sort.SliceStable(shares, func(i, j int) bool { return strings.ToLower(shares[i].Name) < strings.ToLower(shares[j].Name) })
	return shares
}

func listSmbUsers(ctx context.Context) []smbUser {
	users := []smbUser{}
	out, err := exec.CommandContext(ctx, "pdbedit", "-L", "-v").Output()
	if err != nil {
		return users
	}
	var cur *smbUser
	for _, line := range strings.Split(string(out), "\n") {
		k, v, ok := strings.Cut(line, ":")
		if !ok {
			continue
		}
		k, v = strings.TrimSpace(k), strings.TrimSpace(v)
		switch k {
		case "Unix username":
			users = append(users, smbUser{Name: v})
			cur = &users[len(users)-1]
		case "Full Name":
			if cur != nil {
				cur.FullName = v
			}
		case "Account Flags":
			if cur != nil {
				cur.Disabled = strings.Contains(v, "D")
			}
		}
	}
	return users
}

// writeOurShares validates the new share file with testparm, then puts it in place, includes
// it from smb.conf (once, after a backup) and tells smbd to reload without dropping anyone.
func writeOurShares(ctx context.Context, shares []smbShare, owner string) error {
	var b strings.Builder
	b.WriteString("# Shares managed by TemanLabsOS (File Sharing). Edits here may be overwritten.\n")
	for _, sh := range shares {
		fmt.Fprintf(&b, "\n[%s]\n", sh.Name)
		if sh.Comment != "" {
			fmt.Fprintf(&b, "   comment = %s\n", sh.Comment)
		}
		fmt.Fprintf(&b, "   path = %s\n", sh.Path)
		fmt.Fprintf(&b, "   browseable = %s\n", yesNo(sh.Browseable))
		fmt.Fprintf(&b, "   read only = %s\n", yesNo(sh.ReadOnly))
		fmt.Fprintf(&b, "   guest ok = %s\n", yesNo(sh.Guest))
		if !sh.Guest && len(sh.Users) > 0 {
			fmt.Fprintf(&b, "   valid users = %s\n", strings.Join(sh.Users, " "))
		}
		// New files belong to the server's user, not root (CasaOS's shares use root).
		if owner != "" {
			fmt.Fprintf(&b, "   force user = %s\n", owner)
		}
		b.WriteString("   create mask = 0664\n   directory mask = 0775\n")
	}

	tmp := smbOurConf + ".new"
	if err := os.WriteFile(tmp, []byte(b.String()), 0o644); err != nil {
		return err
	}
	main, err := os.ReadFile(smbConf)
	if err != nil {
		os.Remove(tmp)
		return err
	}
	included := strings.Contains(string(main), smbOurConf)
	// testparm on a copy of smb.conf that includes the new file: nothing live changes until it passes.
	check := string(main)
	if included {
		check = strings.ReplaceAll(check, smbOurConf, tmp)
	} else {
		check += "\ninclude = " + tmp + "\n"
	}
	checkFile := filepath.Join(os.TempDir(), "temanlabs-smb-check.conf")
	if err := os.WriteFile(checkFile, []byte(check), 0o600); err != nil {
		os.Remove(tmp)
		return err
	}
	defer os.Remove(checkFile)
	if out, err := exec.CommandContext(ctx, "testparm", "-s", "--suppress-prompt", checkFile).CombinedOutput(); err != nil {
		os.Remove(tmp)
		return fmt.Errorf("Samba rejected the change: %s", lastLines(string(out), 3))
	}
	if err := os.Rename(tmp, smbOurConf); err != nil {
		return err
	}
	if !included {
		if _, err := os.Stat(smbConfBackup); errors.Is(err, os.ErrNotExist) {
			_ = os.WriteFile(smbConfBackup, main, 0o644)
		}
		f, err := os.OpenFile(smbConf, os.O_APPEND|os.O_WRONLY, 0o644)
		if err != nil {
			return err
		}
		_, err = f.WriteString("\n# Shares managed by TemanLabsOS (File Sharing)\ninclude = " + smbOurConf + "\n")
		if err := errors.Join(err, f.Close()); err != nil {
			return err
		}
	}
	return exec.CommandContext(ctx, "smbcontrol", "smbd", "reload-config").Run()
}

func yesNo(b bool) string {
	if b {
		return "yes"
	}
	return "no"
}

// ----- HTTP -----

type smbShareBody struct {
	Name       string   `json:"name"`
	Path       string   `json:"path"`
	Comment    string   `json:"comment"`
	ReadOnly   bool     `json:"readOnly"`
	Guest      bool     `json:"guest"`
	Users      []string `json:"users"`
	Browseable bool     `json:"browseable"`
}

func (s *server) handleSmb(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := context.WithTimeout(r.Context(), 10*time.Second)
	defer cancel()
	_, err := exec.LookPath("smbd")
	installed := err == nil
	running := exec.CommandContext(ctx, "systemctl", "is-active", "--quiet", "smbd").Run() == nil
	version := ""
	if out, err := exec.CommandContext(ctx, "smbd", "--version").Output(); err == nil {
		version = strings.TrimPrefix(strings.TrimSpace(string(out)), "Version ")
	}
	// People who can log in on this machine, for the share and user pickers.
	people := []string{}
	if data, err := os.ReadFile("/etc/passwd"); err == nil {
		for _, line := range strings.Split(string(data), "\n") {
			f := strings.Split(line, ":")
			if len(f) < 7 {
				continue
			}
			if uid, _ := strconv.Atoi(f[2]); uid >= 1000 && uid < 60000 {
				people = append(people, f[0])
			}
		}
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"installed": installed, "running": running, "version": version,
		"shares": listShares(), "users": listSmbUsers(ctx), "people": people,
	})
}

func (s *server) validShare(body *smbShareBody, editing string) error {
	body.Name = strings.TrimSpace(body.Name)
	body.Comment = strings.Join(strings.Fields(body.Comment), " ")
	if len(body.Comment) > 120 {
		body.Comment = body.Comment[:120]
	}
	if !shareNamePattern.MatchString(body.Name) || reservedShares[strings.ToLower(body.Name)] {
		return errors.New("share names use letters, numbers, spaces, dots, dashes and underscores")
	}
	for _, sh := range listShares() {
		if strings.EqualFold(sh.Name, body.Name) && !strings.EqualFold(sh.Name, editing) {
			return fmt.Errorf("a share called %s already exists", sh.Name)
		}
	}
	path, err := s.resolve(body.Path)
	if err != nil || strings.ContainsAny(path, "\n\r") {
		return errors.New("choose a folder on the server")
	}
	if info, err := os.Stat(path); err != nil || !info.IsDir() {
		return fmt.Errorf("%s isn’t a folder", body.Path)
	}
	body.Path = path
	for _, u := range body.Users {
		if !unixUserPattern.MatchString(u) {
			return fmt.Errorf("invalid user %q", u)
		}
	}
	if !body.Guest && len(body.Users) == 0 {
		return errors.New("choose who can use the share, or allow everyone")
	}
	return nil
}

func (s *server) ownShares() []smbShare {
	var own []smbShare
	for _, sh := range listShares() {
		if sh.Source == "temanlabs" {
			own = append(own, sh)
		}
	}
	return own
}

func (s *server) smbOwner() string {
	if s.owner != nil {
		return s.owner.name
	}
	return ""
}

func (s *server) handleSmbShareSave(w http.ResponseWriter, r *http.Request) {
	var body smbShareBody
	if decodeJSON(r, &body) != nil {
		writeError(w, http.StatusBadRequest, "invalid request")
		return
	}
	editing := r.PathValue("name")
	smbMu.Lock()
	defer smbMu.Unlock()
	if err := s.validShare(&body, editing); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	shares := s.ownShares()
	next := smbShare{
		Name: body.Name, Path: body.Path, Comment: body.Comment, ReadOnly: body.ReadOnly, Guest: body.Guest,
		Users: body.Users, Browseable: body.Browseable, Source: "temanlabs",
	}
	replaced := false
	for i, sh := range shares {
		if editing != "" && strings.EqualFold(sh.Name, editing) {
			shares[i], replaced = next, true
		}
	}
	if editing != "" && !replaced {
		writeError(w, http.StatusNotFound, "only shares made in TemanLabsOS can be edited here")
		return
	}
	if !replaced {
		shares = append(shares, next)
	}
	ctx, cancel := context.WithTimeout(r.Context(), 20*time.Second)
	defer cancel()
	if err := writeOurShares(ctx, shares, s.smbOwner()); err != nil {
		writeError(w, http.StatusBadGateway, err.Error())
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *server) handleSmbShareDelete(w http.ResponseWriter, r *http.Request) {
	name := r.PathValue("name")
	smbMu.Lock()
	defer smbMu.Unlock()
	var keep []smbShare
	found := false
	for _, sh := range s.ownShares() {
		if strings.EqualFold(sh.Name, name) {
			found = true
			continue
		}
		keep = append(keep, sh)
	}
	if !found {
		writeError(w, http.StatusNotFound, "only shares made in TemanLabsOS can be removed here")
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 20*time.Second)
	defer cancel()
	if err := writeOurShares(ctx, keep, s.smbOwner()); err != nil {
		writeError(w, http.StatusBadGateway, err.Error())
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// smbpasswd reads the new password twice from stdin with -s.
func setSmbPassword(ctx context.Context, name, password string, add bool) error {
	args := []string{"-s"}
	if add {
		args = append(args, "-a")
	}
	cmd := exec.CommandContext(ctx, "smbpasswd", append(args, name)...)
	cmd.Stdin = strings.NewReader(password + "\n" + password + "\n")
	if out, err := cmd.CombinedOutput(); err != nil {
		return errors.New(strings.TrimSpace(lastLines(string(out), 2)))
	}
	return nil
}

func (s *server) handleSmbUserAdd(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Name     string `json:"name"`
		Password string `json:"password"`
	}
	if decodeJSON(r, &body) != nil || !unixUserPattern.MatchString(body.Name) {
		writeError(w, http.StatusBadRequest, "user names are lowercase letters, numbers, - and _")
		return
	}
	if len(body.Password) < 4 || strings.ContainsAny(body.Password, "\n\r") {
		writeError(w, http.StatusBadRequest, "choose a password of at least 4 characters")
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 20*time.Second)
	defer cancel()
	// Samba users must exist on the system; new ones get no home and can't log in to a shell.
	if _, err := user.Lookup(body.Name); err != nil {
		if out, err := exec.CommandContext(ctx, "useradd", "--no-create-home", "--shell", "/usr/sbin/nologin", "--user-group", body.Name).CombinedOutput(); err != nil {
			writeError(w, http.StatusBadGateway, "couldn’t create the user: "+strings.TrimSpace(string(out)))
			return
		}
	}
	if err := setSmbPassword(ctx, body.Name, body.Password, true); err != nil {
		writeError(w, http.StatusBadGateway, err.Error())
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *server) handleSmbUserAction(w http.ResponseWriter, r *http.Request) {
	name, action := r.PathValue("name"), r.PathValue("action")
	if !unixUserPattern.MatchString(name) {
		writeError(w, http.StatusBadRequest, "invalid user")
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 20*time.Second)
	defer cancel()
	var err error
	switch action {
	case "password":
		var body struct {
			Password string `json:"password"`
		}
		if decodeJSON(r, &body) != nil || len(body.Password) < 4 || strings.ContainsAny(body.Password, "\n\r") {
			writeError(w, http.StatusBadRequest, "choose a password of at least 4 characters")
			return
		}
		err = setSmbPassword(ctx, name, body.Password, false)
	case "enable", "disable", "remove":
		flag := map[string]string{"enable": "-e", "disable": "-d", "remove": "-x"}[action]
		if out, e := exec.CommandContext(ctx, "smbpasswd", flag, name).CombinedOutput(); e != nil {
			err = errors.New(strings.TrimSpace(lastLines(string(out), 2)))
		}
	default:
		writeError(w, http.StatusBadRequest, "unknown action")
		return
	}
	if err != nil {
		writeError(w, http.StatusBadGateway, err.Error())
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// handleSmbStatus lists who is connected and to which shares (smbstatus --json).
func (s *server) handleSmbStatus(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := context.WithTimeout(r.Context(), 10*time.Second)
	defer cancel()
	out, err := exec.CommandContext(ctx, "smbstatus", "--json").Output()
	if err != nil {
		writeJSON(w, http.StatusOK, map[string]any{"sessions": []any{}, "error": "smbstatus failed"})
		return
	}
	var raw struct {
		Sessions map[string]struct {
			Username      string `json:"username"`
			RemoteMachine string `json:"remote_machine"`
			Dialect       string `json:"session_dialect"`
			ID            string `json:"session_id"`
		} `json:"sessions"`
		Tcons map[string]struct {
			Service   string `json:"service"`
			SessionID string `json:"session_id"`
			Machine   string `json:"machine"`
			Connected string `json:"connected_at"`
		} `json:"tcons"`
		OpenFiles map[string]any `json:"open_files"`
	}
	if json.Unmarshal(bytes.TrimSpace(out), &raw) != nil {
		writeJSON(w, http.StatusOK, map[string]any{"sessions": []any{}})
		return
	}
	type session struct {
		User     string   `json:"user"`
		Machine  string   `json:"machine"`
		Protocol string   `json:"protocol"`
		Shares   []string `json:"shares"`
		Since    string   `json:"since,omitempty"`
	}
	byID := map[string]*session{}
	for _, se := range raw.Sessions {
		byID[se.ID] = &session{User: se.Username, Machine: se.RemoteMachine, Protocol: se.Dialect, Shares: []string{}}
	}
	for _, t := range raw.Tcons {
		if se := byID[t.SessionID]; se != nil {
			se.Shares = append(se.Shares, t.Service)
			if se.Since == "" || t.Connected < se.Since {
				se.Since = t.Connected
			}
		}
	}
	list := make([]*session, 0, len(byID))
	for _, se := range byID {
		sort.Strings(se.Shares)
		list = append(list, se)
	}
	sort.Slice(list, func(i, j int) bool { return list[i].Machine < list[j].Machine })
	writeJSON(w, http.StatusOK, map[string]any{"sessions": list, "openFiles": len(raw.OpenFiles)})
}

// smbRestarting is held while Samba restarts: clicks that come meanwhile don't restart it again
// (each restart drops every connected computer).
var smbRestarting sync.Mutex

func (s *server) handleSmbRestart(w http.ResponseWriter, r *http.Request) {
	if !smbRestarting.TryLock() {
		writeError(w, http.StatusConflict, "Samba is already restarting")
		return
	}
	defer smbRestarting.Unlock()
	ctx, cancel := context.WithTimeout(r.Context(), 60*time.Second)
	defer cancel()
	if out, err := exec.CommandContext(ctx, "systemctl", "restart", "smbd").CombinedOutput(); err != nil {
		writeError(w, http.StatusBadGateway, strings.TrimSpace(lastLines(string(out), 2)))
		return
	}
	// nmbd only answers NetBIOS names. With "disable netbios" it isn't running (or is masked), and
	// restarting it anyway fails and makes a good restart look broken: it's restarted only when
	// it runs.
	_ = exec.CommandContext(ctx, "systemctl", "try-restart", "nmbd").Run()
	w.WriteHeader(http.StatusNoContent)
}
