package main

import (
	"bufio"
	"context"
	"encoding/hex"
	"fmt"
	"net"
	"net/http"
	"os"
	"os/user"
	"path/filepath"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"sync"
	"syscall"
	"time"
)

// listenPort is one port something on the server listens on, with who owns it.
type listenPort struct {
	Port     int      `json:"port"`
	Protocol string   `json:"protocol"`
	Address  []string `json:"addresses"`
	// Reachable from other machines, i.e. not bound to loopback only.
	Public  bool   `json:"public"`
	PID     int    `json:"pid,omitempty"`
	Process string `json:"process,omitempty"`
	Command string `json:"command,omitempty"`
	User    string `json:"user,omitempty"`
	// The container the port belongs to: published by Docker, or a process inside a container
	// (host networking).
	Container   string `json:"container,omitempty"`
	ContainerID string `json:"containerId,omitempty"`
	AppID       string `json:"appId,omitempty"`
	// Port inside the container, for published ports.
	TargetPort int `json:"targetPort,omitempty"`
}

type socketEntry struct {
	proto string
	ip    net.IP
	port  int
	inode string
}

// readSockets parses /proc/net/{tcp,udp}{,6}: listening TCP sockets and bound UDP ones.
func readSockets() []socketEntry {
	var out []socketEntry
	ephemeralLo, ephemeralHi := ephemeralRange()
	for _, f := range []struct{ file, proto string }{
		{"/proc/net/tcp", "tcp"}, {"/proc/net/tcp6", "tcp"}, {"/proc/net/udp", "udp"}, {"/proc/net/udp6", "udp"},
	} {
		file, err := os.Open(f.file)
		if err != nil {
			continue
		}
		scanner := bufio.NewScanner(file)
		scanner.Scan() // header
		for scanner.Scan() {
			fields := strings.Fields(scanner.Text())
			if len(fields) < 10 {
				continue
			}
			state := fields[3]
			if f.proto == "tcp" && state != "0A" { // LISTEN
				continue
			}
			if f.proto == "udp" && (state != "07" || !strings.HasSuffix(fields[2], ":0000")) {
				continue
			}
			ip, port, ok := parseHexAddr(fields[1])
			if !ok || port == 0 {
				continue
			}
			// Unconnected UDP sockets on ephemeral ports are clients (DNS lookups…), not services.
			if f.proto == "udp" && port >= ephemeralLo && port <= ephemeralHi {
				continue
			}
			out = append(out, socketEntry{proto: f.proto, ip: ip, port: port, inode: fields[9]})
		}
		file.Close()
	}
	return out
}

func ephemeralRange() (int, int) {
	fields := strings.Fields(readTrim("/proc/sys/net/ipv4/ip_local_port_range"))
	if len(fields) == 2 {
		lo, err1 := strconv.Atoi(fields[0])
		hi, err2 := strconv.Atoi(fields[1])
		if err1 == nil && err2 == nil {
			return lo, hi
		}
	}
	return 32768, 60999
}

// parseHexAddr decodes "0100007F:1F90": the address is stored as host-order 32-bit words.
func parseHexAddr(s string) (net.IP, int, bool) {
	addr, portHex, ok := strings.Cut(s, ":")
	if !ok {
		return nil, 0, false
	}
	port, err := strconv.ParseUint(portHex, 16, 16)
	if err != nil {
		return nil, 0, false
	}
	raw, err := hex.DecodeString(addr)
	if err != nil || (len(raw) != 4 && len(raw) != 16) {
		return nil, 0, false
	}
	ip := make(net.IP, len(raw))
	for i := 0; i < len(raw); i += 4 {
		ip[i], ip[i+1], ip[i+2], ip[i+3] = raw[i+3], raw[i+2], raw[i+1], raw[i]
	}
	if v4 := ip.To4(); v4 != nil && len(raw) == 16 && !ip.IsUnspecified() {
		ip = v4
	}
	return ip, int(port), true
}

var (
	dockerIDPattern = regexp.MustCompile(`[0-9a-f]{64}`)
	// The systemd service a process runs in, from its cgroup path (system or user services).
	unitPattern = regexp.MustCompile(`/([^/]+.service)(?:/|$)`)
)

type procInfo struct {
	pid             int
	name, cmd, user string
	containerID     string
	unit            string
}

// socketOwners maps socket inodes to the process holding them (needs root to see every process).
func socketOwners(inodes map[string]bool) map[string]*procInfo {
	owners := map[string]*procInfo{}
	dirs, _ := os.ReadDir("/proc")
	users := map[string]string{}
	for _, d := range dirs {
		pid, err := strconv.Atoi(d.Name())
		if err != nil {
			continue
		}
		base := filepath.Join("/proc", d.Name())
		fds, err := os.ReadDir(filepath.Join(base, "fd"))
		if err != nil {
			continue
		}
		var info *procInfo
		for _, fd := range fds {
			link, err := os.Readlink(filepath.Join(base, "fd", fd.Name()))
			if err != nil || !strings.HasPrefix(link, "socket:[") {
				continue
			}
			inode := link[8 : len(link)-1]
			if !inodes[inode] {
				continue
			}
			if _, seen := owners[inode]; seen {
				continue
			}
			if info == nil {
				info = describeProcess(pid, base, users)
			}
			owners[inode] = info
		}
	}
	return owners
}

func describeProcess(pid int, base string, users map[string]string) *procInfo {
	info := &procInfo{pid: pid, name: readTrim(filepath.Join(base, "comm"))}
	if cmd, err := os.ReadFile(filepath.Join(base, "cmdline")); err == nil {
		info.cmd = strings.TrimSpace(strings.ReplaceAll(string(cmd), "\x00", " "))
		if len(info.cmd) > 400 {
			info.cmd = info.cmd[:400] + "…"
		}
	}
	if status, err := os.ReadFile(filepath.Join(base, "status")); err == nil {
		for _, line := range strings.Split(string(status), "\n") {
			if fields := strings.Fields(line); len(fields) > 1 && fields[0] == "Uid:" {
				uid := fields[1]
				if _, ok := users[uid]; !ok {
					users[uid] = uid
					if u, err := user.LookupId(uid); err == nil {
						users[uid] = u.Username
					}
				}
				info.user = users[uid]
				break
			}
		}
	}
	if cgroup, err := os.ReadFile(filepath.Join(base, "cgroup")); err == nil {
		info.containerID = dockerIDPattern.FindString(string(cgroup))
		if m := unitPattern.FindAllStringSubmatch(strings.TrimSpace(string(cgroup)), -1); len(m) > 0 {
			info.unit = m[len(m)-1][1]
		}
	}
	return info
}

func isLoopback(ip net.IP) bool { return ip.IsLoopback() }

func (s *server) listPorts(ctx context.Context) ([]*listenPort, error) {
	sockets := readSockets()
	inodes := map[string]bool{}
	for _, sk := range sockets {
		inodes[sk.inode] = true
	}
	owners := socketOwners(inodes)

	containers, _ := s.docker.containers(ctx)
	byID := map[string]container{}
	for _, c := range containers {
		byID[c.ID] = c
	}
	appOf := func(c container) string {
		if id := c.Labels[labelTemanLabs]; id != "" {
			return id
		}
		if p := c.Labels[labelProject]; p != "" {
			return p
		}
		return c.name()
	}

	type key struct {
		proto string
		port  int
	}
	ports := map[key]*listenPort{}
	get := func(proto string, port int) *listenPort {
		k := key{proto, port}
		if p, ok := ports[k]; ok {
			return p
		}
		p := &listenPort{Port: port, Protocol: proto}
		ports[k] = p
		return p
	}
	addAddr := func(p *listenPort, ip string, loopback bool) {
		for _, a := range p.Address {
			if a == ip {
				return
			}
		}
		p.Address = append(p.Address, ip)
		p.Public = p.Public || !loopback
	}

	for _, sk := range sockets {
		p := get(sk.proto, sk.port)
		addAddr(p, sk.ip.String(), isLoopback(sk.ip))
		if o := owners[sk.inode]; o != nil && (p.PID == 0 || o.pid < p.PID) {
			p.PID, p.Process, p.Command, p.User = o.pid, o.name, o.cmd, o.user
			if c, ok := byID[o.containerID]; ok {
				p.Container, p.ContainerID, p.AppID = c.name(), c.ID, appOf(c)
			}
		}
	}
	// Published container ports: their host socket belongs to docker-proxy, or to nobody at all
	// when Docker forwards with iptables only.
	for _, c := range containers {
		if c.State != "running" {
			continue
		}
		for _, cp := range c.Ports {
			if cp.PublicPort == 0 {
				continue
			}
			p := get(cp.Type, cp.PublicPort)
			ip := net.ParseIP(cp.IP)
			if ip == nil {
				ip = net.IPv4zero
			}
			addAddr(p, ip.String(), isLoopback(ip))
			p.Container, p.ContainerID, p.AppID, p.TargetPort = c.name(), c.ID, appOf(c), cp.PrivatePort
		}
	}

	list := make([]*listenPort, 0, len(ports))
	for _, p := range ports {
		sort.Strings(p.Address)
		list = append(list, p)
	}
	sort.Slice(list, func(i, j int) bool {
		if list[i].Port != list[j].Port {
			return list[i].Port < list[j].Port
		}
		return list[i].Protocol < list[j].Protocol
	})
	return list, nil
}

var portsCache struct {
	sync.Mutex
	at   time.Time
	list []*listenPort
}

func (s *server) handlePorts(w http.ResponseWriter, r *http.Request) {
	// Walking every process's file descriptors isn't free; share one scan between pollers.
	portsCache.Lock()
	defer portsCache.Unlock()
	if time.Since(portsCache.at) > 1500*time.Millisecond {
		list, err := s.listPorts(r.Context())
		if err != nil {
			writeError(w, http.StatusInternalServerError, err.Error())
			return
		}
		portsCache.list, portsCache.at = list, time.Now()
	}
	writeJSON(w, http.StatusOK, portsCache.list)
}

// handleKillProcess sends SIGTERM (or SIGKILL with ?force=1) to a process, so a stuck service
// holding a port can be stopped without a terminal.
func (s *server) handleKillProcess(w http.ResponseWriter, r *http.Request) {
	pid, err := strconv.Atoi(r.PathValue("pid"))
	if err != nil || pid <= 1 {
		writeError(w, http.StatusBadRequest, "invalid process ID")
		return
	}
	if pid == os.Getpid() {
		writeError(w, http.StatusBadRequest, "that is TemanLabsOS itself; restart it from Settings or systemd instead")
		return
	}
	sig := syscall.SIGTERM
	if r.URL.Query().Get("force") == "1" {
		sig = syscall.SIGKILL
	}
	if err := syscall.Kill(pid, sig); err != nil {
		writeError(w, http.StatusBadRequest, fmt.Sprintf("couldn't stop process %d: %v", pid, err))
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
