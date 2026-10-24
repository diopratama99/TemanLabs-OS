package main

import (
	"context"
	"errors"
	"net/http"
	"os"
	"os/exec"
	"sort"
	"strconv"
	"strings"
	"time"
)

// Users & Groups: the server's login accounts, their groups and admin rights, without useradd
// and usermod. root and the account TemanLabsOS runs as can't be deleted or locked here.

type systemUser struct {
	Name     string   `json:"name"`
	UID      int      `json:"uid"`
	FullName string   `json:"fullName,omitempty"`
	Home     string   `json:"home"`
	Shell    string   `json:"shell"`
	Groups   []string `json:"groups"`
	Admin    bool     `json:"admin"`
	Locked   bool     `json:"locked"`
	// Can't log in to a shell (e.g. sharing-only accounts).
	NoLogin   bool `json:"noLogin"`
	Protected bool `json:"protected"`
}

type systemGroup struct {
	Name    string   `json:"name"`
	GID     int      `json:"gid"`
	Members []string `json:"members"`
}

func readGroups() []systemGroup {
	data, err := os.ReadFile("/etc/group")
	if err != nil {
		return nil
	}
	var groups []systemGroup
	for _, line := range strings.Split(string(data), "\n") {
		f := strings.Split(line, ":")
		if len(f) < 4 {
			continue
		}
		gid, _ := strconv.Atoi(f[2])
		g := systemGroup{Name: f[0], GID: gid, Members: []string{}}
		for _, m := range strings.Split(f[3], ",") {
			if m != "" {
				g.Members = append(g.Members, m)
			}
		}
		groups = append(groups, g)
	}
	return groups
}

func (s *server) protectedUser(name string) bool {
	return name == "root" || (s.owner != nil && s.owner.name == name)
}

func (s *server) handleUsers(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := context.WithTimeout(r.Context(), 15*time.Second)
	defer cancel()
	groups := readGroups()
	primary := map[int]string{}
	for _, g := range groups {
		primary[g.GID] = g.Name
	}
	data, err := os.ReadFile("/etc/passwd")
	if err != nil {
		writeError(w, http.StatusBadGateway, err.Error())
		return
	}
	// passwd -S -a reports every account's state in one call (L = locked).
	locked := map[string]bool{}
	if out, err := exec.CommandContext(ctx, "passwd", "-S", "-a").Output(); err == nil {
		for _, line := range strings.Split(string(out), "\n") {
			if f := strings.Fields(line); len(f) > 1 {
				locked[f[0]] = f[1] == "L"
			}
		}
	}
	var users []systemUser
	for _, line := range strings.Split(string(data), "\n") {
		f := strings.Split(line, ":")
		if len(f) < 7 {
			continue
		}
		uid, _ := strconv.Atoi(f[2])
		gid, _ := strconv.Atoi(f[3])
		// People, not system services: root plus the regular UID range.
		if uid != 0 && (uid < 1000 || uid >= 60000) {
			continue
		}
		u := systemUser{
			Name: f[0], UID: uid, FullName: strings.Split(f[4], ",")[0], Home: f[5], Shell: f[6],
			Locked: locked[f[0]], Protected: s.protectedUser(f[0]),
			NoLogin: strings.HasSuffix(f[6], "nologin") || strings.HasSuffix(f[6], "false"),
		}
		u.Groups = []string{}
		if name := primary[gid]; name != "" {
			u.Groups = append(u.Groups, name)
		}
		for _, g := range groups {
			for _, m := range g.Members {
				if m == u.Name && g.GID != gid {
					u.Groups = append(u.Groups, g.Name)
				}
			}
		}
		for _, g := range u.Groups {
			u.Admin = u.Admin || g == "sudo" || g == "admin" || g == "wheel"
		}
		if uid == 0 {
			u.Admin = true
		}
		users = append(users, u)
	}
	sort.Slice(groups, func(i, j int) bool { return groups[i].Name < groups[j].Name })
	writeJSON(w, http.StatusOK, map[string]any{"users": users, "groups": groups})
}

func runAdmin(ctx context.Context, stdin string, name string, args ...string) error {
	cmd := exec.CommandContext(ctx, name, args...)
	if stdin != "" {
		cmd.Stdin = strings.NewReader(stdin)
	}
	if out, err := cmd.CombinedOutput(); err != nil {
		return errors.New(strings.TrimSpace(lastLines(string(out), 2)))
	}
	return nil
}

func validPassword(p string) bool { return len(p) >= 6 && !strings.ContainsAny(p, "\n\r:") }

func (s *server) handleUserCreate(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Name     string `json:"name"`
		FullName string `json:"fullName"`
		Password string `json:"password"`
		Admin    bool   `json:"admin"`
	}
	if decodeJSON(r, &body) != nil || !unixUserPattern.MatchString(body.Name) {
		writeError(w, http.StatusBadRequest, "user names are lowercase letters, numbers, - and _")
		return
	}
	if !validPassword(body.Password) {
		writeError(w, http.StatusBadRequest, "choose a password of at least 6 characters")
		return
	}
	fullName := strings.NewReplacer(":", " ", ",", " ", "\n", " ").Replace(strings.TrimSpace(body.FullName))
	ctx, cancel := context.WithTimeout(r.Context(), 30*time.Second)
	defer cancel()
	if err := runAdmin(ctx, "", "useradd", "--create-home", "--shell", "/bin/bash", "--comment", fullName, "--user-group", body.Name); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	if err := runAdmin(ctx, body.Name+":"+body.Password+"\n", "chpasswd"); err != nil {
		writeError(w, http.StatusBadGateway, err.Error())
		return
	}
	if body.Admin {
		_ = runAdmin(ctx, "", "usermod", "-aG", "sudo", body.Name)
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *server) handleUserChange(w http.ResponseWriter, r *http.Request) {
	name := r.PathValue("name")
	if !unixUserPattern.MatchString(name) {
		writeError(w, http.StatusBadRequest, "invalid user")
		return
	}
	var body struct {
		Action   string `json:"action"` // password, admin, lock, unlock, addGroup, removeGroup, fullName
		Password string `json:"password"`
		Admin    bool   `json:"admin"`
		Group    string `json:"group"`
		FullName string `json:"fullName"`
	}
	if decodeJSON(r, &body) != nil {
		writeError(w, http.StatusBadRequest, "invalid request")
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 30*time.Second)
	defer cancel()
	var err error
	switch body.Action {
	case "password":
		if !validPassword(body.Password) {
			writeError(w, http.StatusBadRequest, "choose a password of at least 6 characters")
			return
		}
		err = runAdmin(ctx, name+":"+body.Password+"\n", "chpasswd")
	case "admin":
		if s.protectedUser(name) && !body.Admin {
			writeError(w, http.StatusForbidden, name+" keeps admin rights: TemanLabsOS and the server depend on it.")
			return
		}
		if body.Admin {
			err = runAdmin(ctx, "", "usermod", "-aG", "sudo", name)
		} else {
			err = runAdmin(ctx, "", "gpasswd", "-d", name, "sudo")
		}
	case "lock", "unlock":
		if s.protectedUser(name) {
			writeError(w, http.StatusForbidden, name+" can’t be locked from here.")
			return
		}
		flag := map[string]string{"lock": "-L", "unlock": "-U"}[body.Action]
		err = runAdmin(ctx, "", "usermod", flag, name)
	case "addGroup", "removeGroup":
		if !unixUserPattern.MatchString(body.Group) {
			writeError(w, http.StatusBadRequest, "invalid group")
			return
		}
		if body.Action == "addGroup" {
			err = runAdmin(ctx, "", "usermod", "-aG", body.Group, name)
		} else {
			err = runAdmin(ctx, "", "gpasswd", "-d", name, body.Group)
		}
	case "fullName":
		full := strings.NewReplacer(":", " ", ",", " ", "\n", " ").Replace(strings.TrimSpace(body.FullName))
		err = runAdmin(ctx, "", "usermod", "-c", full, name)
	default:
		writeError(w, http.StatusBadRequest, "unknown change")
		return
	}
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *server) handleUserDelete(w http.ResponseWriter, r *http.Request) {
	name := r.PathValue("name")
	if !unixUserPattern.MatchString(name) || s.protectedUser(name) {
		writeError(w, http.StatusForbidden, "this account can’t be deleted here")
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 60*time.Second)
	defer cancel()
	args := []string{name}
	// Keep the home folder unless asked: it may hold the only copy of someone's files.
	if r.URL.Query().Get("removeHome") == "1" {
		args = append([]string{"--remove"}, args...)
	}
	// Their Samba login goes too, if any.
	_ = exec.CommandContext(ctx, "smbpasswd", "-x", name).Run()
	if err := runAdmin(ctx, "", "userdel", args...); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
