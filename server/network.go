package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"time"
)

// Network Tools: interfaces, ping, traceroute, DNS lookup, connections and the firewall.

var hostPattern = regexp.MustCompile(`^[a-zA-Z0-9]([a-zA-Z0-9.:-]{0,252}[a-zA-Z0-9])?$`)

type netInterface struct {
	Name      string   `json:"name"`
	MAC       string   `json:"mac,omitempty"`
	State     string   `json:"state"`
	MTU       int      `json:"mtu"`
	Addresses []string `json:"addresses"`
	SpeedMbps int      `json:"speedMbps,omitempty"`
	RxBytes   uint64   `json:"rxBytes"`
	TxBytes   uint64   `json:"txBytes"`
	// Docker's bridges and veths, shown apart from the real links.
	Virtual bool `json:"virtual"`
}

func readUint(path string) uint64 {
	n, _ := strconv.ParseUint(readTrim(path), 10, 64)
	return n
}

func (s *server) handleInterfaces(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := context.WithTimeout(r.Context(), 10*time.Second)
	defer cancel()
	out, err := exec.CommandContext(ctx, "ip", "-j", "addr").Output()
	if err != nil {
		writeError(w, http.StatusBadGateway, "ip: "+err.Error())
		return
	}
	var raw []struct {
		Name  string `json:"ifname"`
		MAC   string `json:"address"`
		State string `json:"operstate"`
		MTU   int    `json:"mtu"`
		Addrs []struct {
			Local  string `json:"local"`
			Prefix int    `json:"prefixlen"`
			Scope  string `json:"scope"`
		} `json:"addr_info"`
	}
	if json.Unmarshal(out, &raw) != nil {
		writeError(w, http.StatusBadGateway, "unreadable interface list")
		return
	}
	list := make([]netInterface, 0, len(raw))
	for _, it := range raw {
		base := filepath.Join("/sys/class/net", it.Name)
		n := netInterface{Name: it.Name, MAC: it.MAC, State: strings.ToLower(it.State), MTU: it.MTU,
			RxBytes: readUint(filepath.Join(base, "statistics/rx_bytes")), TxBytes: readUint(filepath.Join(base, "statistics/tx_bytes"))}
		if speed, err := strconv.Atoi(readTrim(filepath.Join(base, "speed"))); err == nil && speed > 0 {
			n.SpeedMbps = speed
		}
		_, physical := os.Stat(filepath.Join(base, "device"))
		n.Virtual = physical != nil && it.Name != "tailscale0" && !strings.HasPrefix(it.Name, "wg")
		for _, a := range it.Addrs {
			if a.Scope != "link" {
				n.Addresses = append(n.Addresses, fmt.Sprintf("%s/%d", a.Local, a.Prefix))
			}
		}
		list = append(list, n)
	}
	sort.SliceStable(list, func(i, j int) bool { return !list[i].Virtual && list[j].Virtual })
	writeJSON(w, http.StatusOK, list)
}

// handleNetTool runs ping or traceroute (tracepath) and returns their output.
func (s *server) handleNetTool(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Tool  string `json:"tool"`
		Host  string `json:"host"`
		Count int    `json:"count"`
	}
	if decodeJSON(r, &body) != nil || !hostPattern.MatchString(body.Host) {
		writeError(w, http.StatusBadRequest, "enter a host name or IP address")
		return
	}
	var args []string
	timeout := 30 * time.Second
	switch body.Tool {
	case "ping":
		count := min(max(body.Count, 1), 20)
		args = []string{"ping", "-c", strconv.Itoa(count), "-W", "2", "--", body.Host}
	case "traceroute":
		args = []string{"tracepath", "-n", "-m", "20", body.Host}
		timeout = 60 * time.Second
	default:
		writeError(w, http.StatusBadRequest, "unknown tool")
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), timeout)
	defer cancel()
	out, err := exec.CommandContext(ctx, args[0], args[1:]...).CombinedOutput()
	writeJSON(w, http.StatusOK, map[string]any{"output": string(out), "ok": err == nil})
}

// handleDNS looks a name up with the server's resolver, record type by record type.
func (s *server) handleDNS(w http.ResponseWriter, r *http.Request) {
	name := strings.TrimSpace(r.URL.Query().Get("name"))
	if !hostPattern.MatchString(name) {
		writeError(w, http.StatusBadRequest, "enter a domain name or IP address")
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 10*time.Second)
	defer cancel()
	res := net.DefaultResolver
	records := map[string][]string{}
	add := func(kind string, values []string, err error) {
		if err == nil && len(values) > 0 {
			records[kind] = values
		}
	}
	if ip := net.ParseIP(name); ip != nil {
		names, err := res.LookupAddr(ctx, name)
		add("PTR", names, err)
	} else {
		addrs, err := res.LookupHost(ctx, name)
		var v4, v6 []string
		for _, a := range addrs {
			if strings.Contains(a, ":") {
				v6 = append(v6, a)
			} else {
				v4 = append(v4, a)
			}
		}
		add("A", v4, err)
		add("AAAA", v6, err)
		cname, err := res.LookupCNAME(ctx, name)
		if err == nil && strings.TrimSuffix(cname, ".") != strings.TrimSuffix(name, ".") {
			add("CNAME", []string{cname}, nil)
		}
		if mx, err := res.LookupMX(ctx, name); err == nil {
			var v []string
			for _, m := range mx {
				v = append(v, fmt.Sprintf("%d %s", m.Pref, m.Host))
			}
			add("MX", v, nil)
		}
		ns, err := res.LookupNS(ctx, name)
		if err == nil {
			var v []string
			for _, n := range ns {
				v = append(v, n.Host)
			}
			add("NS", v, nil)
		}
		txt, err := res.LookupTXT(ctx, name)
		add("TXT", txt, err)
	}
	resolvers := []string{}
	if data, err := os.ReadFile("/etc/resolv.conf"); err == nil {
		for _, line := range strings.Split(string(data), "\n") {
			if f := strings.Fields(line); len(f) == 2 && f[0] == "nameserver" {
				resolvers = append(resolvers, f[1])
			}
		}
	}
	writeJSON(w, http.StatusOK, map[string]any{"name": name, "records": records, "resolvers": resolvers})
}

type netConnection struct {
	Protocol string `json:"protocol"`
	State    string `json:"state"`
	Local    string `json:"local"`
	Peer     string `json:"peer"`
	Process  string `json:"process,omitempty"`
	PID      int    `json:"pid,omitempty"`
}

var ssProcess = regexp.MustCompile(`users:\(\("([^"]+)",pid=(\d+)`)

func (s *server) handleConnections(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := context.WithTimeout(r.Context(), 10*time.Second)
	defer cancel()
	out, err := exec.CommandContext(ctx, "ss", "-H", "-t", "-u", "-n", "-p", "state", "connected").Output()
	if err != nil {
		writeError(w, http.StatusBadGateway, "ss: "+err.Error())
		return
	}
	list := []netConnection{}
	for _, line := range strings.Split(string(out), "\n") {
		f := strings.Fields(line)
		if len(f) < 6 {
			continue
		}
		c := netConnection{Protocol: f[0], State: strings.ToLower(f[1]), Local: f[4], Peer: f[5]}
		if m := ssProcess.FindStringSubmatch(line); m != nil {
			c.Process = m[1]
			c.PID, _ = strconv.Atoi(m[2])
		}
		list = append(list, c)
	}
	writeJSON(w, http.StatusOK, list)
}

// ----- Firewall (ufw) -----

type firewallRule struct {
	Number int    `json:"number"`
	To     string `json:"to"`
	Action string `json:"action"`
	From   string `json:"from"`
	V6     bool   `json:"v6"`
}

var ufwRule = regexp.MustCompile(`^\[\s*(\d+)\]\s+(.+?)\s{2,}(ALLOW|DENY|REJECT|LIMIT)(?: IN| OUT)?\s+(.+)$`)

func (s *server) handleFirewall(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := context.WithTimeout(r.Context(), 10*time.Second)
	defer cancel()
	out, err := exec.CommandContext(ctx, "ufw", "status", "numbered").CombinedOutput()
	if err != nil {
		writeError(w, http.StatusBadGateway, "ufw: "+strings.TrimSpace(string(out)))
		return
	}
	text := string(out)
	rules := []firewallRule{}
	for _, line := range strings.Split(text, "\n") {
		m := ufwRule.FindStringSubmatch(strings.TrimSpace(line))
		if m == nil {
			continue
		}
		n, _ := strconv.Atoi(m[1])
		to := strings.TrimSpace(m[2])
		rules = append(rules, firewallRule{Number: n, To: strings.TrimSuffix(to, " (v6)"), Action: m[3], From: strings.TrimSpace(m[4]), V6: strings.Contains(to, "(v6)")})
	}
	writeJSON(w, http.StatusOK, map[string]any{"enabled": strings.Contains(text, "Status: active"), "rules": rules})
}

var (
	portSpec = regexp.MustCompile(`^\d{1,5}(:\d{1,5})?$`)
	fromSpec = regexp.MustCompile(`^(any|[0-9a-fA-F:.]+(/\d{1,3})?)$`)
)

// Ports the firewall must never block: SSH and TemanLabsOS itself (and so this page).
func (s *server) lifelinePorts() []string {
	ports := []string{"22/tcp"}
	if _, port, err := net.SplitHostPort(s.cfg.Addr); err == nil && port != "" {
		ports = append(ports, port+"/tcp")
	}
	return ports
}

func (s *server) handleFirewallChange(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Op       string `json:"op"` // enable, disable, add, delete
		Action   string `json:"action"`
		Port     string `json:"port"`
		Protocol string `json:"protocol"`
		From     string `json:"from"`
		Number   int    `json:"number"`
	}
	if decodeJSON(r, &body) != nil {
		writeError(w, http.StatusBadRequest, "invalid request")
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 30*time.Second)
	defer cancel()
	run := func(args ...string) error {
		out, err := exec.CommandContext(ctx, "ufw", args...).CombinedOutput()
		if err != nil {
			return errors.New(strings.TrimSpace(lastLines(string(out), 2)))
		}
		return nil
	}
	var err error
	switch body.Op {
	case "enable":
		// Allow SSH and TemanLabsOS first, or turning the firewall on would lock everyone out.
		for _, p := range s.lifelinePorts() {
			if err = run("allow", p); err != nil {
				break
			}
		}
		if err == nil {
			err = run("--force", "enable")
		}
	case "disable":
		err = run("disable")
	case "add":
		action := strings.ToLower(body.Action)
		if action != "allow" && action != "deny" && action != "limit" {
			writeError(w, http.StatusBadRequest, "choose allow, deny or limit")
			return
		}
		if !portSpec.MatchString(body.Port) {
			writeError(w, http.StatusBadRequest, "a port is a number like 8080, or a range like 6000:6010")
			return
		}
		proto := strings.ToLower(body.Protocol)
		if proto != "tcp" && proto != "udp" && proto != "" {
			writeError(w, http.StatusBadRequest, "protocol must be tcp or udp")
			return
		}
		from := strings.TrimSpace(body.From)
		if from == "" {
			from = "any"
		}
		if !fromSpec.MatchString(from) {
			writeError(w, http.StatusBadRequest, "from is any, an IP address or a network like 192.168.1.0/24")
			return
		}
		args := []string{action, "from", from, "to", "any", "port", body.Port}
		if proto != "" {
			args = append(args, "proto", proto)
		} else if strings.Contains(body.Port, ":") {
			writeError(w, http.StatusBadRequest, "port ranges need a protocol")
			return
		}
		err = run(args...)
	case "delete":
		if body.Number <= 0 {
			writeError(w, http.StatusBadRequest, "invalid rule")
			return
		}
		err = run("--force", "delete", strconv.Itoa(body.Number))
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
