package main

import (
	"bufio"
	"io"
	"net"
	"net/http"
	"os"
	"os/exec"
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
	// A cloud drive (rclone): its size is whatever the provider reports, so widgets skip it.
	Cloud bool `json:"cloud,omitempty"`
	// The ZFS pool it is, and the pool's state (ONLINE, DEGRADED…).
	Pool   string `json:"pool,omitempty"`
	Health string `json:"health,omitempty"`
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
	// Watts, when something measures them (see power.go).
	Power *powerStats `json:"power,omitempty"`
	Load  [3]float64  `json:"load"`
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
	power               *powerMeter
}

func newStatsSampler() *statsSampler {
	s := &statsSampler{model: cpuModel(), osName: osPrettyName(), power: newPowerMeter()}
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
	st.Power = s.power.read(time.Now())
	st.Load = loadAverage()
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
// and the bind mounts Docker and snap create. A ZFS pool is one entry, however many datasets
// (each its own mount) it has.
func diskUsage() []disk {
	f, err := os.Open("/proc/mounts")
	if err != nil {
		return nil
	}
	defer f.Close()
	disks := listDisks(f, statSpace, zfsPoolSpace)
	for i := range disks {
		if disks[i].Pool != "" {
			disks[i].Health = zfsHealth(disks[i].Pool)
		}
	}
	return disks
}

// fsSpace is a filesystem's size, used and free (for unprivileged users) space in bytes.
type fsSpace struct{ total, used, free uint64 }

func statSpace(mount string) (fsSpace, bool) {
	var st syscall.Statfs_t
	if syscall.Statfs(mount, &st) != nil || st.Blocks == 0 {
		return fsSpace{}, false
	}
	b := uint64(st.Bsize)
	return fsSpace{total: st.Blocks * b, used: (st.Blocks - st.Bfree) * b, free: st.Bavail * b}, true
}

// listDisks reads mounts in /proc/mounts' format; stat and poolSpace measure them.
func listDisks(mounts io.Reader, stat func(string) (fsSpace, bool), poolSpace func(string) (used, free uint64, ok bool)) []disk {
	seen := map[string]bool{}
	var disks []disk
	pools := map[string]int{} // pool name → its entry in disks
	sc := bufio.NewScanner(mounts)
	for sc.Scan() {
		fields := strings.Fields(sc.Text())
		if len(fields) < 3 {
			continue
		}
		// Merged storage (mergerfs) and cloud drives (rclone) are folders people use like drives.
		fuse := fields[2] == "fuse.mergerfs" || fields[2] == "fuse.rclone"
		if (!realFilesystems[fields[2]] && !fuse) || seen[fields[0]] {
			continue
		}
		mount := unescapeMount(fields[1])
		if strings.HasPrefix(mount, "/boot") || strings.HasPrefix(mount, "/snap") ||
			strings.HasPrefix(mount, "/var/lib/docker") || strings.HasPrefix(mount, "/run") {
			continue
		}
		space, ok := stat(mount)
		if !ok {
			continue
		}
		seen[fields[0]] = true
		used := space.used
		if fields[2] == "zfs" {
			// Datasets share the pool's free space: add up what they use, and the pool's entry
			// goes by its topmost mount.
			pool, _, _ := strings.Cut(fields[0], "/")
			free := space.free
			if i, ok := pools[pool]; ok {
				d := &disks[i]
				prevFree := d.Total - d.Used
				d.Used += used
				d.Total = d.Used + max(free, prevFree)
				if len(mount) < len(d.Mount) {
					d.Mount = mount
				}
				continue
			}
			pools[pool] = len(disks)
			disks = append(disks, disk{Name: pool, Mount: mount, Used: used, Total: used + free, Pool: pool})
			continue
		}
		name := filepath.Base(mount)
		if mount == "/" {
			name = "System"
		}
		disks = append(disks, disk{
			Name:  name,
			Mount: mount,
			Total: space.total,
			Used:  used,
			Cloud: fields[2] == "fuse.rclone",
		})
	}
	for pool, i := range pools {
		d := &disks[i]
		if used, free, ok := poolSpace(pool); ok {
			d.Used, d.Total = used, used+free
		}
		if d.Mount == "/" {
			d.Name = "System"
		}
	}
	return disks
}

// zfsPoolSpace is what a pool's datasets use (snapshots and unmounted ones too) and what's left,
// from zfs itself; read at most every 30 seconds, as the stats are polled often.
func zfsPoolSpace(pool string) (used, free uint64, ok bool) {
	zfsSpace.Lock()
	defer zfsSpace.Unlock()
	if time.Since(zfsSpace.at) > 30*time.Second {
		zfsSpace.at = time.Now()
		zfsSpace.pools = map[string][2]uint64{}
		zfsSpace.health = zfsPoolHealth()
		out, _ := exec.Command("zfs", "list", "-Hp", "-d", "0", "-o", "name,used,avail").Output()
		for _, line := range strings.Split(string(out), "\n") {
			f := strings.Fields(line)
			if len(f) != 3 {
				continue
			}
			u, err1 := strconv.ParseUint(f[1], 10, 64)
			a, err2 := strconv.ParseUint(f[2], 10, 64)
			if err1 == nil && err2 == nil {
				zfsSpace.pools[f[0]] = [2]uint64{u, a}
			}
		}
	}
	space, ok := zfsSpace.pools[pool]
	return space[0], space[1], ok
}

// zfsHealth is the pool's state from the same reading as zfsPoolSpace.
func zfsHealth(pool string) string {
	zfsSpace.Lock()
	defer zfsSpace.Unlock()
	return zfsSpace.health[pool]
}

var zfsSpace struct {
	sync.Mutex
	at     time.Time
	pools  map[string][2]uint64
	health map[string]string
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
