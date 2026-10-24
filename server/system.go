package main

import (
	"bufio"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"sync"
	"syscall"
	"time"
)

const sampleInterval = 2 * time.Second

type cpuStats struct {
	Usage float64 `json:"usage"`
	Cores int     `json:"cores"`
	Temp  float64 `json:"temp"`
	Model string  `json:"model"`
}

type disk struct {
	Name  string `json:"name"`
	Mount string `json:"mount"`
	Used  uint64 `json:"used"`
	Total uint64 `json:"total"`
}

type lanAddress struct {
	Interface string `json:"interface"`
	IPv4      string `json:"ipv4"`
}

type tailscaleAddress struct {
	IPv4 string `json:"ipv4"`
}

type systemStats struct {
	Hostname string   `json:"hostname"`
	OS       string   `json:"os"`
	Kernel   string   `json:"kernel"`
	Uptime   float64  `json:"uptime"`
	CPU      cpuStats `json:"cpu"`
	Memory   struct {
		Used  uint64 `json:"used"`
		Total uint64 `json:"total"`
	} `json:"memory"`
	Disks   []disk `json:"disks"`
	Network struct {
		RX float64 `json:"rx"`
		TX float64 `json:"tx"`
	} `json:"network"`
	Addresses struct {
		LAN       *lanAddress       `json:"lan"`
		Tailscale *tailscaleAddress `json:"tailscale"`
	} `json:"addresses"`
}

// statsSampler reads /proc every couple of seconds; CPU usage and network speed need two
// readings to compute a rate, so requests are answered from the latest sample.
type statsSampler struct {
	mu     sync.RWMutex
	latest systemStats

	prevIdle, prevTotal uint64
	prevRX, prevTX      uint64
	prevAt              time.Time
	model               string
	osName              string
}

func newStatsSampler() *statsSampler {
	s := &statsSampler{model: cpuModel(), osName: osPrettyName()}
	s.sample()
	return s
}

func (s *statsSampler) run() {
	for range time.Tick(sampleInterval) {
		s.sample()
	}
}

func (s *statsSampler) get() systemStats {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.latest
}

func (s *statsSampler) sample() {
	var st systemStats
	st.Hostname, _ = os.Hostname()
	st.OS = s.osName
	st.Kernel = readTrim("/proc/sys/kernel/osrelease")
	if f := strings.Fields(readTrim("/proc/uptime")); len(f) > 0 {
		st.Uptime, _ = strconv.ParseFloat(f[0], 64)
	}

	idle, total := readCPUTimes()
	if s.prevTotal > 0 && total > s.prevTotal {
		busy := float64((total - s.prevTotal) - (idle - s.prevIdle))
		st.CPU.Usage = 100 * busy / float64(total-s.prevTotal)
	}
	s.prevIdle, s.prevTotal = idle, total
	st.CPU.Cores = runtime.NumCPU()
	st.CPU.Model = s.model
	st.CPU.Temp = cpuTemperature()

	st.Memory.Total, st.Memory.Used = memoryUsage()
	st.Disks = diskUsage()

	iface := defaultInterface()
	now := time.Now()
	rx, tx := interfaceBytes(iface)
	if !s.prevAt.IsZero() && rx >= s.prevRX && tx >= s.prevTX {
		secs := now.Sub(s.prevAt).Seconds()
		st.Network.RX = float64(rx-s.prevRX) / secs
		st.Network.TX = float64(tx-s.prevTX) / secs
	}
	s.prevRX, s.prevTX, s.prevAt = rx, tx, now

	if ip := interfaceIPv4(iface); ip != "" {
		st.Addresses.LAN = &lanAddress{Interface: iface, IPv4: ip}
	}
	if ip := interfaceIPv4("tailscale0"); ip != "" {
		st.Addresses.Tailscale = &tailscaleAddress{IPv4: ip}
	}

	s.mu.Lock()
	s.latest = st
	s.mu.Unlock()
}

func (s *server) handleSystem(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, s.stats.get())
}

func readTrim(path string) string {
	data, _ := os.ReadFile(path)
	return strings.TrimSpace(string(data))
}

func osPrettyName() string {
	for _, line := range strings.Split(readTrim("/etc/os-release"), "\n") {
		if v, ok := strings.CutPrefix(line, "PRETTY_NAME="); ok {
			return strings.Trim(v, `"`)
		}
	}
	return runtime.GOOS
}

func cpuModel() string {
	for _, line := range strings.Split(readTrim("/proc/cpuinfo"), "\n") {
		if k, v, ok := strings.Cut(line, ":"); ok && strings.TrimSpace(k) == "model name" {
			return strings.Join(strings.Fields(v), " ")
		}
	}
	return ""
}

// readCPUTimes returns idle (incl. iowait) and total jiffies from the aggregate "cpu" line.
func readCPUTimes() (idle, total uint64) {
	f, err := os.Open("/proc/stat")
	if err != nil {
		return 0, 0
	}
	defer f.Close()
	sc := bufio.NewScanner(f)
	if !sc.Scan() {
		return 0, 0
	}
	fields := strings.Fields(sc.Text())
	for i, v := range fields[1:] {
		n, _ := strconv.ParseUint(v, 10, 64)
		total += n
		if i == 3 || i == 4 {
			idle += n
		}
	}
	return idle, total
}

func memoryUsage() (total, used uint64) {
	values := map[string]uint64{}
	for _, line := range strings.Split(readTrim("/proc/meminfo"), "\n") {
		f := strings.Fields(line)
		if len(f) >= 2 {
			n, _ := strconv.ParseUint(f[1], 10, 64)
			values[strings.TrimSuffix(f[0], ":")] = n * 1024
		}
	}
	total = values["MemTotal"]
	return total, total - values["MemAvailable"]
}

func cpuTemperature() float64 {
	zones, _ := filepath.Glob("/sys/class/thermal/thermal_zone*")
	fallback := 0.0
	for _, z := range zones {
		milli, err := strconv.ParseFloat(readTrim(filepath.Join(z, "temp")), 64)
		if err != nil {
			continue
		}
		if readTrim(filepath.Join(z, "type")) == "x86_pkg_temp" {
			return milli / 1000
		}
		if fallback == 0 {
			fallback = milli / 1000
		}
	}
	return fallback
}

var realFilesystems = map[string]bool{
	"ext2": true, "ext3": true, "ext4": true, "xfs": true, "btrfs": true, "zfs": true,
	"f2fs": true, "ntfs": true, "ntfs3": true, "exfat": true, "fuseblk": true, "vfat": true,
}

// diskUsage lists mounted filesystems that hold data: real filesystems, minus boot partitions
// and the bind mounts Docker and snap create.
func diskUsage() []disk {
	f, err := os.Open("/proc/mounts")
	if err != nil {
		return nil
	}
	defer f.Close()
	seen := map[string]bool{}
	var disks []disk
	sc := bufio.NewScanner(f)
	for sc.Scan() {
		fields := strings.Fields(sc.Text())
		if len(fields) < 3 || !realFilesystems[fields[2]] || seen[fields[0]] {
			continue
		}
		mount := unescapeMount(fields[1])
		if strings.HasPrefix(mount, "/boot") || strings.HasPrefix(mount, "/snap") ||
			strings.HasPrefix(mount, "/var/lib/docker") || strings.HasPrefix(mount, "/run") {
			continue
		}
		var fsStat syscall.Statfs_t
		if syscall.Statfs(mount, &fsStat) != nil || fsStat.Blocks == 0 {
			continue
		}
		seen[fields[0]] = true
		bsize := uint64(fsStat.Bsize)
		name := filepath.Base(mount)
		if mount == "/" {
			name = "System"
		}
		disks = append(disks, disk{
			Name:  name,
			Mount: mount,
			Total: fsStat.Blocks * bsize,
			Used:  (fsStat.Blocks - fsStat.Bfree) * bsize,
		})
	}
	return disks
}

// unescapeMount decodes the octal escapes /proc/mounts uses for spaces and tabs.
func unescapeMount(s string) string {
	if !strings.Contains(s, `\`) {
		return s
	}
	var b strings.Builder
	for i := 0; i < len(s); i++ {
		if s[i] == '\\' && i+3 < len(s) {
			if n, err := strconv.ParseUint(s[i+1:i+4], 8, 8); err == nil {
				b.WriteByte(byte(n))
				i += 3
				continue
			}
		}
		b.WriteByte(s[i])
	}
	return b.String()
}

// defaultInterface is the interface of the default IPv4 route (e.g. enp0s31f6).
func defaultInterface() string {
	lines := strings.Split(readTrim("/proc/net/route"), "\n")
	for _, line := range lines[1:] {
		f := strings.Fields(line)
		if len(f) > 2 && f[1] == "00000000" {
			return f[0]
		}
	}
	return ""
}

func interfaceBytes(name string) (rx, tx uint64) {
	for _, line := range strings.Split(readTrim("/proc/net/dev"), "\n") {
		iface, rest, ok := strings.Cut(line, ":")
		if !ok || strings.TrimSpace(iface) != name {
			continue
		}
		f := strings.Fields(rest)
		if len(f) >= 9 {
			rx, _ = strconv.ParseUint(f[0], 10, 64)
			tx, _ = strconv.ParseUint(f[8], 10, 64)
		}
	}
	return rx, tx
}

func interfaceIPv4(name string) string {
	if name == "" {
		return ""
	}
	iface, err := net.InterfaceByName(name)
	if err != nil {
		return ""
	}
	addrs, _ := iface.Addrs()
	for _, a := range addrs {
		if ipnet, ok := a.(*net.IPNet); ok {
			if ip4 := ipnet.IP.To4(); ip4 != nil {
				return ip4.String()
			}
		}
	}
	return ""
}
