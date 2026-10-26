package main

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"net"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"slices"
	"strconv"
	"strings"
	"sync"
	"time"
)

// Devices: the other computers on the network (a desktop PC, a laptop, another server). The
// server is always on and sits on the same network, so it can wake them (Wake-on-LAN) and show
// their screens (see remote.go). Passwords for their screens stay here; the browser never sees them.

type device struct {
	ID       string `json:"id"`
	Name     string `json:"name"`
	Kind     string `json:"kind"` // windows, mac, linux, other
	Host     string `json:"host"`
	MAC      string `json:"mac"`
	Protocol string `json:"protocol"` // vnc, rdp, or "" (wake only)
	Port     int    `json:"port"`
	Username string `json:"username"`
	Password string `json:"password,omitempty"`
}

// deviceView is a device as the browser sees it: whether there's a password, not the password.
type deviceView struct {
	device
	// Shadows the embedded password, so it is never sent.
	Password    string `json:"password,omitempty"`
	HasPassword bool   `json:"hasPassword"`
}

func (d device) view() deviceView {
	return deviceView{device: d, HasPassword: d.Password != ""}
}

type deviceStore struct {
	mu      sync.Mutex
	path    string
	devices []device
}

func newDeviceStore(stateDir string) *deviceStore {
	st := &deviceStore{path: filepath.Join(stateDir, "devices.json")}
	if data, err := os.ReadFile(st.path); err == nil {
		_ = json.Unmarshal(data, &st.devices)
	}
	return st
}

// save writes the list out (readable by root only: it holds passwords); callers hold st.mu.
func (st *deviceStore) save() error {
	data, err := json.MarshalIndent(st.devices, "", "  ")
	if err != nil {
		return err
	}
	tmp := st.path + ".tmp"
	if err := os.WriteFile(tmp, data, 0o600); err != nil {
		return err
	}
	return os.Rename(tmp, st.path)
}

func (st *deviceStore) get(id string) (device, bool) {
	st.mu.Lock()
	defer st.mu.Unlock()
	for _, d := range st.devices {
		if d.ID == id {
			return d, true
		}
	}
	return device{}, false
}

var (
	deviceKinds = map[string]bool{"windows": true, "mac": true, "linux": true, "other": true}
	macPattern  = regexp.MustCompile(`^([0-9a-f]{2}[:-]){5}[0-9a-f]{2}$`)
)

var defaultPorts = map[string]int{"vnc": 5900, "rdp": 3389}

// normalize checks a device from the browser and fills in defaults.
func (d *device) normalize() error {
	d.Name = strings.TrimSpace(d.Name)
	d.Host = strings.TrimSpace(d.Host)
	d.MAC = strings.ToLower(strings.ReplaceAll(strings.TrimSpace(d.MAC), "-", ":"))
	d.Username = strings.TrimSpace(d.Username)
	if d.Name == "" {
		return errors.New("give the device a name")
	}
	if !deviceKinds[d.Kind] {
		d.Kind = "other"
	}
	if d.Host == "" || !hostPattern.MatchString(d.Host) {
		return errors.New("enter the device's IP address or host name")
	}
	if d.MAC != "" && !macPattern.MatchString(d.MAC) {
		return errors.New("the MAC address should look like 9c:6b:00:12:34:56")
	}
	switch d.Protocol {
	case "vnc", "rdp":
		if d.Port <= 0 || d.Port > 65535 {
			d.Port = defaultPorts[d.Protocol]
		}
	default:
		d.Protocol, d.Port = "", 0
	}
	return nil
}

func newDeviceID() string {
	b := make([]byte, 6)
	_, _ = rand.Read(b)
	return hex.EncodeToString(b)
}

func (s *server) handleListDevices(w http.ResponseWriter, r *http.Request) {
	s.devices.mu.Lock()
	list := make([]deviceView, len(s.devices.devices))
	for i, d := range s.devices.devices {
		list[i] = d.view()
	}
	s.devices.mu.Unlock()
	writeJSON(w, http.StatusOK, map[string]any{"devices": list, "engine": s.remote.status(r.Context())})
}

// deviceInput is a device from the browser; a missing password keeps the saved one.
type deviceInput struct {
	device
	Password *string `json:"password"`
}

func (s *server) handleCreateDevice(w http.ResponseWriter, r *http.Request) {
	var in deviceInput
	if err := decodeJSON(r, &in); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request")
		return
	}
	d := in.device
	if in.Password != nil {
		d.Password = *in.Password
	}
	if err := d.normalize(); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	d.ID = newDeviceID()
	st := s.devices
	st.mu.Lock()
	defer st.mu.Unlock()
	st.devices = append(st.devices, d)
	if err := st.save(); err != nil {
		st.devices = st.devices[:len(st.devices)-1]
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusCreated, d.view())
}

func (s *server) handleUpdateDevice(w http.ResponseWriter, r *http.Request) {
	var in deviceInput
	if err := decodeJSON(r, &in); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request")
		return
	}
	st := s.devices
	st.mu.Lock()
	defer st.mu.Unlock()
	i := slices.IndexFunc(st.devices, func(d device) bool { return d.ID == r.PathValue("id") })
	if i < 0 {
		writeError(w, http.StatusNotFound, "no such device")
		return
	}
	d := in.device
	d.ID = st.devices[i].ID
	d.Password = st.devices[i].Password
	if in.Password != nil {
		d.Password = *in.Password
	}
	if err := d.normalize(); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	old := st.devices[i]
	st.devices[i] = d
	if err := st.save(); err != nil {
		st.devices[i] = old
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, d.view())
}

func (s *server) handleDeleteDevice(w http.ResponseWriter, r *http.Request) {
	st := s.devices
	st.mu.Lock()
	defer st.mu.Unlock()
	kept := slices.DeleteFunc(slices.Clone(st.devices), func(d device) bool { return d.ID == r.PathValue("id") })
	if len(kept) == len(st.devices) {
		writeError(w, http.StatusNotFound, "no such device")
		return
	}
	old := st.devices
	st.devices = kept
	if err := st.save(); err != nil {
		st.devices = old
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// ----- Status -----

type deviceStatus struct {
	Online bool `json:"online"`
	// The screen-sharing port answers: ready to connect.
	Screen bool `json:"screen"`
	// Round trip in milliseconds, when known.
	Latency int `json:"latency,omitempty"`
}

// Ports that most computers answer on (or refuse, which also proves they're on).
var probePorts = []int{445, 22, 135, 139, 5900, 3389, 5000, 7000, 62078, 80}

// probeDevice reports whether a host is up, trying the screen port first, then a ping and common
// ports at once. A refused connection counts: only a running computer refuses.
func probeDevice(ctx context.Context, host string, screenPort int) deviceStatus {
	ctx, cancel := context.WithTimeout(ctx, 1500*time.Millisecond)
	defer cancel()
	var st deviceStatus
	var mu sync.Mutex
	var wg sync.WaitGroup
	up := func(latency time.Duration) {
		mu.Lock()
		defer mu.Unlock()
		ms := max(1, int(latency.Milliseconds()))
		if !st.Online || ms < st.Latency {
			st.Latency = ms
		}
		st.Online = true
	}
	dial := func(port int, screen bool) {
		defer wg.Done()
		start := time.Now()
		conn, err := (&net.Dialer{}).DialContext(ctx, "tcp", net.JoinHostPort(host, strconv.Itoa(port)))
		if err == nil {
			conn.Close()
			up(time.Since(start))
			if screen {
				mu.Lock()
				st.Screen = true
				mu.Unlock()
			}
		} else if isRefused(err) {
			up(time.Since(start))
		}
	}
	if screenPort > 0 {
		wg.Add(1)
		go dial(screenPort, true)
	}
	for _, p := range probePorts {
		if p != screenPort {
			wg.Add(1)
			go dial(p, false)
		}
	}
	wg.Add(1)
	go func() {
		defer wg.Done()
		start := time.Now()
		if exec.CommandContext(ctx, "ping", "-c", "1", "-W", "1", "--", host).Run() == nil {
			up(time.Since(start))
		}
	}()
	wg.Wait()
	return st
}

func isRefused(err error) bool {
	return err != nil && strings.Contains(err.Error(), "connection refused")
}

func (s *server) handleDeviceStatus(w http.ResponseWriter, r *http.Request) {
	s.devices.mu.Lock()
	list := slices.Clone(s.devices.devices)
	s.devices.mu.Unlock()
	out := make(map[string]deviceStatus, len(list))
	var mu sync.Mutex
	var wg sync.WaitGroup
	for _, d := range list {
		wg.Add(1)
		go func() {
			defer wg.Done()
			st := probeDevice(r.Context(), d.Host, d.Port)
			mu.Lock()
			out[d.ID] = st
			mu.Unlock()
		}()
	}
	wg.Wait()
	writeJSON(w, http.StatusOK, out)
}

// ----- Wake-on-LAN -----

// magicPacket is six 0xff bytes, then the MAC address sixteen times.
func magicPacket(mac string) ([]byte, error) {
	hw, err := net.ParseMAC(mac)
	if err != nil || len(hw) != 6 {
		return nil, errors.New("invalid MAC address")
	}
	packet := make([]byte, 0, 102)
	for range 6 {
		packet = append(packet, 0xff)
	}
	for range 16 {
		packet = append(packet, hw...)
	}
	return packet, nil
}

// lanInterfaces are the server's real network interfaces (not loopback, containers or VPNs).
func lanInterfaces() []net.Interface {
	ifaces, _ := net.Interfaces()
	var out []net.Interface
	for _, iface := range ifaces {
		if iface.Flags&net.FlagUp == 0 || iface.Flags&net.FlagLoopback != 0 || iface.Flags&net.FlagBroadcast == 0 {
			continue
		}
		if slices.ContainsFunc([]string{"docker", "br-", "veth", "cni", "flannel", "tailscale", "virbr", "zt", "wg", "tun"}, func(p string) bool {
			return strings.HasPrefix(iface.Name, p)
		}) {
			continue
		}
		out = append(out, iface)
	}
	return out
}

// lanNetworks are the IPv4 networks on those interfaces.
func lanNetworks() []*net.IPNet {
	var out []*net.IPNet
	for _, iface := range lanInterfaces() {
		addrs, _ := iface.Addrs()
		for _, a := range addrs {
			if n, ok := a.(*net.IPNet); ok && n.IP.To4() != nil {
				out = append(out, &net.IPNet{IP: n.IP.To4(), Mask: n.Mask})
			}
		}
	}
	return out
}

func broadcastOf(n *net.IPNet) net.IP {
	ip := n.IP.To4()
	mask := net.IP(n.Mask).To4()
	if ip == nil || mask == nil {
		return nil
	}
	out := make(net.IP, 4)
	for i := range 4 {
		out[i] = ip[i] | ^mask[i]
	}
	return out
}

// sendWake broadcasts the magic packet on every local network (and to the general broadcast
// address), on the two usual ports. Network cards listen for it whatever the port.
func sendWake(mac string) error {
	packet, err := magicPacket(mac)
	if err != nil {
		return err
	}
	targets := []net.IP{net.IPv4bcast}
	for _, n := range lanNetworks() {
		if b := broadcastOf(n); b != nil {
			targets = append(targets, b)
		}
	}
	conn, err := net.ListenUDP("udp4", nil)
	if err != nil {
		return err
	}
	defer conn.Close()
	sent := 0
	var last error
	for _, ip := range targets {
		for _, port := range []int{9, 7} {
			if _, err := conn.WriteToUDP(packet, &net.UDPAddr{IP: ip, Port: port}); err != nil {
				last = err
			} else {
				sent++
			}
		}
	}
	if sent == 0 {
		return fmt.Errorf("couldn't send the wake packet: %w", last)
	}
	return nil
}

func (s *server) handleWakeDevice(w http.ResponseWriter, r *http.Request) {
	d, ok := s.devices.get(r.PathValue("id"))
	if !ok {
		writeError(w, http.StatusNotFound, "no such device")
		return
	}
	if d.MAC == "" {
		writeError(w, http.StatusBadRequest, "this device has no MAC address to wake")
		return
	}
	if err := sendWake(d.MAC); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// ----- Discovery -----

type foundDevice struct {
	IP    string `json:"ip"`
	MAC   string `json:"mac"`
	Name  string `json:"name,omitempty"`
	Kind  string `json:"kind"`
	Ports []int  `json:"ports"`
	// The server itself, or the network's router.
	Self   bool `json:"self,omitempty"`
	Router bool `json:"router,omitempty"`
}

// Ports that hint at what a computer is: file sharing and RPC on Windows; screen sharing and
// media receivers on a Mac; SSH alone usually means Linux.
var discoverPorts = []int{22, 135, 445, 548, 3389, 5900, 5000, 7000, 62078}

// handleDiscover finds the computers on the local network: it knocks on every address (which
// also fills the server's neighbour table with their MAC addresses), then reads that table.
func (s *server) handleDiscover(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := context.WithTimeout(r.Context(), 12*time.Second)
	defer cancel()
	self, neighbours := sweepLAN(ctx)

	// Then, for the computers that are there, which services they offer.
	open := map[string][]int{}
	var mu sync.Mutex
	var wg sync.WaitGroup
	for _, nb := range neighbours {
		for _, port := range discoverPorts {
			wg.Add(1)
			go func() {
				defer wg.Done()
				if knockPort(ctx, nb.ip, port, 800*time.Millisecond) {
					mu.Lock()
					open[nb.ip] = append(open[nb.ip], port)
					mu.Unlock()
				}
			}()
		}
	}
	wg.Wait()

	router := defaultGateway()
	var found []foundDevice
	seen := map[string]bool{}
	for _, nb := range neighbours {
		if seen[nb.ip] || !inNetworks(nb.ip) {
			continue
		}
		seen[nb.ip] = true
		ports := open[nb.ip]
		slices.Sort(ports)
		found = append(found, foundDevice{IP: nb.ip, MAC: nb.mac, Kind: guessKind(ports), Ports: ports, Router: nb.ip == router})
	}
	// Names: the network's DNS first, then the computers themselves (multicast DNS).
	var nameWG sync.WaitGroup
	for i := range found {
		nameWG.Add(1)
		go func() {
			defer nameWG.Done()
			found[i].Name = lookupName(ctx, found[i].IP)
		}()
	}
	nameWG.Wait()
	slices.SortFunc(found, func(a, b foundDevice) int { return compareIP(a.IP, b.IP) })
	for _, ip := range self {
		found = append([]foundDevice{{IP: ip, Kind: "linux", Name: hostname(), Self: true}}, found...)
	}
	writeJSON(w, http.StatusOK, found)
}

// sweepLAN knocks on every address of the server's networks (its own /24 on bigger ones), which
// makes the kernel ask for each one's MAC address: the ones that answer end up in the neighbour
// table, whatever their firewall does. It returns the server's own addresses and that table.
func sweepLAN(ctx context.Context) (self []string, neighbours []neighbour) {
	var hosts []net.IP
	for _, n := range lanNetworks() {
		self = append(self, n.IP.String())
		ones, bits := n.Mask.Size()
		if bits != 32 || ones < 22 {
			// Large networks would take too long to sweep; stay on the server's own /24.
			n = &net.IPNet{IP: n.IP, Mask: net.CIDRMask(24, 32)}
		}
		base := n.IP.Mask(n.Mask).To4()
		size := 1 << (32 - maskOnes(n.Mask))
		for i := 1; i < size-1; i++ {
			v := uint32(base[0])<<24 | uint32(base[1])<<16 | uint32(base[2])<<8 | uint32(base[3])
			v += uint32(i)
			hosts = append(hosts, net.IPv4(byte(v>>24), byte(v>>16), byte(v>>8), byte(v)).To4())
		}
	}

	var wg sync.WaitGroup
	for _, ip := range hosts {
		wg.Add(1)
		go func() {
			defer wg.Done()
			knockPort(ctx, ip.String(), 9, 600*time.Millisecond)
		}()
	}
	wg.Wait()
	return self, readNeighbours()
}

// knockPort: does host accept a connection on port within timeout?
func knockPort(ctx context.Context, host string, port int, timeout time.Duration) bool {
	c, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()
	conn, err := (&net.Dialer{}).DialContext(c, "tcp", net.JoinHostPort(host, strconv.Itoa(port)))
	if err == nil {
		conn.Close()
	}
	return err == nil
}

func maskOnes(m net.IPMask) int {
	ones, _ := m.Size()
	return ones
}

func inNetworks(ip string) bool {
	addr := net.ParseIP(ip)
	for _, n := range lanNetworks() {
		if n.Contains(addr) {
			return true
		}
	}
	return false
}

func compareIP(a, b string) int {
	x, y := net.ParseIP(a).To4(), net.ParseIP(b).To4()
	if x == nil || y == nil {
		return strings.Compare(a, b)
	}
	for i := range 4 {
		if x[i] != y[i] {
			return int(x[i]) - int(y[i])
		}
	}
	return 0
}

func guessKind(ports []int) string {
	has := func(p int) bool { return slices.Contains(ports, p) }
	switch {
	case has(135) || has(3389) || (has(445) && !has(548) && !has(5000)):
		return "windows"
	case has(548) || has(62078) || (has(5000) && has(7000)):
		return "mac"
	case has(22):
		return "linux"
	}
	return "other"
}

type neighbour struct{ ip, mac string }

// readNeighbours reads the kernel's ARP table (complete entries only).
func readNeighbours() []neighbour {
	data, err := os.ReadFile("/proc/net/arp")
	if err != nil {
		return nil
	}
	var out []neighbour
	for _, line := range strings.Split(string(data), "\n")[1:] {
		f := strings.Fields(line)
		if len(f) < 6 || f[2] == "0x0" || f[3] == "00:00:00:00:00:00" {
			continue
		}
		out = append(out, neighbour{ip: f[0], mac: strings.ToLower(f[3])})
	}
	return out
}

// macFor looks up a host's MAC address in the neighbour table (after reaching it once).
func macFor(ctx context.Context, host string) string {
	ip := host
	if net.ParseIP(host) == nil {
		addrs, err := net.DefaultResolver.LookupHost(ctx, host)
		if err != nil || len(addrs) == 0 {
			return ""
		}
		ip = addrs[0]
	}
	probeDevice(ctx, ip, 0)
	for _, nb := range readNeighbours() {
		if nb.ip == ip {
			return nb.mac
		}
	}
	return ""
}

func (s *server) handleLookupMAC(w http.ResponseWriter, r *http.Request) {
	host := strings.TrimSpace(r.URL.Query().Get("host"))
	if host == "" || !hostPattern.MatchString(host) {
		writeError(w, http.StatusBadRequest, "enter an IP address")
		return
	}
	mac := macFor(r.Context(), host)
	if mac == "" {
		writeError(w, http.StatusNotFound, "couldn't find that device's MAC address; it must be switched on and on this network")
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"mac": mac})
}

// defaultGateway reads the IPv4 default route's gateway from /proc/net/route.
func defaultGateway() string {
	data, err := os.ReadFile("/proc/net/route")
	if err != nil {
		return ""
	}
	for _, line := range strings.Split(string(data), "\n")[1:] {
		f := strings.Fields(line)
		if len(f) < 3 || f[1] != "00000000" {
			continue
		}
		v, err := strconv.ParseUint(f[2], 16, 32)
		if err != nil || v == 0 {
			continue
		}
		return net.IPv4(byte(v), byte(v>>8), byte(v>>16), byte(v>>24)).String()
	}
	return ""
}

func hostname() string {
	name, _ := os.Hostname()
	return name
}

// lookupName finds a computer's name: reverse DNS (the router or Pi-hole may know it), then
// multicast DNS, which Macs and most Linux desktops answer, then NetBIOS, which Windows answers.
func lookupName(ctx context.Context, ip string) string {
	c, cancel := context.WithTimeout(ctx, 800*time.Millisecond)
	defer cancel()
	if names, err := net.DefaultResolver.LookupAddr(c, ip); err == nil && len(names) > 0 {
		if name := cleanHostName(names[0]); name != "" && name != ip {
			return name
		}
	}
	if name := cleanHostName(mdnsReverse(ip, 900*time.Millisecond)); name != "" {
		return name
	}
	return netbiosName(ip, 900*time.Millisecond)
}

// netbiosName asks a host for its NetBIOS names (a node status query on UDP 137) and returns
// the computer's own one.
func netbiosName(ip string, timeout time.Duration) string {
	v4 := net.ParseIP(ip).To4()
	if v4 == nil {
		return ""
	}
	// Header: id 1, no flags, one question; the name "*" in NetBIOS encoding; type NBSTAT, class IN.
	msg := []byte{0, 1, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 32, 'C', 'K'}
	for range 30 {
		msg = append(msg, 'A')
	}
	msg = append(msg, 0, 0, 0x21, 0, 1)
	conn, err := net.DialUDP("udp4", nil, &net.UDPAddr{IP: v4, Port: 137})
	if err != nil {
		return ""
	}
	defer conn.Close()
	_ = conn.SetDeadline(time.Now().Add(timeout))
	if _, err := conn.Write(msg); err != nil {
		return ""
	}
	buf := make([]byte, 1500)
	n, err := conn.Read(buf)
	if err != nil {
		return ""
	}
	return parseNodeStatus(buf[:n])
}

// parseNodeStatus picks the workstation name (suffix 0, not a group) from a node status reply.
func parseNodeStatus(b []byte) string {
	if len(b) < 12 {
		return ""
	}
	qd := int(b[4])<<8 | int(b[5])
	off := 12
	for range qd {
		_, next := readDNSName(b, off)
		if next < 0 {
			return ""
		}
		off = next + 4
	}
	_, next := readDNSName(b, off)
	if next < 0 || next+10 > len(b) {
		return ""
	}
	data := next + 10
	if data >= len(b) {
		return ""
	}
	count := int(b[data])
	for i := range count {
		e := data + 1 + i*18
		if e+18 > len(b) {
			break
		}
		suffix, flags := b[e+15], int(b[e+16])<<8|int(b[e+17])
		if suffix == 0 && flags&0x8000 == 0 {
			return strings.TrimSpace(string(b[e : e+15]))
		}
	}
	return ""
}

func cleanHostName(name string) string {
	name = strings.TrimSuffix(name, ".")
	for _, suffix := range []string{".local", ".lan", ".home", ".localdomain"} {
		name = strings.TrimSuffix(name, suffix)
	}
	return name
}

// mdnsReverse asks a host directly (unicast reply, port 5353) for its multicast-DNS name.
func mdnsReverse(ip string, timeout time.Duration) string {
	v4 := net.ParseIP(ip).To4()
	if v4 == nil {
		return ""
	}
	qname := fmt.Sprintf("%d.%d.%d.%d.in-addr.arpa", v4[3], v4[2], v4[1], v4[0])
	// Header: id 0, no flags, one question.
	msg := []byte{0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0}
	for _, label := range strings.Split(qname, ".") {
		msg = append(msg, byte(len(label)))
		msg = append(msg, label...)
	}
	msg = append(msg, 0, 0, 12, 0x80, 1) // PTR, class IN with the unicast-response bit
	conn, err := net.DialUDP("udp4", nil, &net.UDPAddr{IP: v4, Port: 5353})
	if err != nil {
		return ""
	}
	defer conn.Close()
	_ = conn.SetDeadline(time.Now().Add(timeout))
	if _, err := conn.Write(msg); err != nil {
		return ""
	}
	buf := make([]byte, 1500)
	n, err := conn.Read(buf)
	if err != nil {
		return ""
	}
	return parsePTRAnswer(buf[:n])
}

// parsePTRAnswer returns the name in the first PTR record of a DNS reply.
func parsePTRAnswer(b []byte) string {
	if len(b) < 12 {
		return ""
	}
	qd := int(b[4])<<8 | int(b[5])
	an := int(b[6])<<8 | int(b[7])
	off := 12
	for range qd {
		_, next := readDNSName(b, off)
		if next < 0 || next+4 > len(b) {
			return ""
		}
		off = next + 4
	}
	for range an {
		_, next := readDNSName(b, off)
		if next < 0 || next+10 > len(b) {
			return ""
		}
		typ := int(b[next])<<8 | int(b[next+1])
		rdlen := int(b[next+8])<<8 | int(b[next+9])
		data := next + 10
		if data+rdlen > len(b) {
			return ""
		}
		if typ == 12 {
			name, _ := readDNSName(b, data)
			return name
		}
		off = data + rdlen
	}
	return ""
}

// readDNSName decodes a (possibly compressed) name at off; it returns the name and the offset
// just past it, or -1 if the message is malformed.
func readDNSName(b []byte, off int) (string, int) {
	var labels []string
	next := -1
	for jumps := 0; jumps < 20; jumps++ {
		if off >= len(b) {
			return "", -1
		}
		l := int(b[off])
		switch {
		case l == 0:
			if next < 0 {
				next = off + 1
			}
			return strings.Join(labels, "."), next
		case l&0xc0 == 0xc0:
			if off+1 >= len(b) {
				return "", -1
			}
			if next < 0 {
				next = off + 2
			}
			off = (l&0x3f)<<8 | int(b[off+1])
		default:
			if off+1+l > len(b) {
				return "", -1
			}
			labels = append(labels, string(b[off+1:off+1+l]))
			off += 1 + l
		}
	}
	return "", -1
}
