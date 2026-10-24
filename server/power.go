package main

import (
	"path/filepath"
	"strconv"
	"strings"
	"time"
)

// Power draw for the menu bar and the Power widget. A laptop's battery (while it runs on it)
// measures the whole machine; otherwise the processor's own energy counters (RAPL, Intel and
// AMD) measure the CPU package and the RAM, which is most of what changes from moment to moment
// but not the disks, the board or the power supply.

type powerPart struct {
	Name  string  `json:"name"` // package, core, uncore, dram, psys
	Watts float64 `json:"watts"`
}

type powerStats struct {
	Watts  float64     `json:"watts"`
	Source string      `json:"source"` // "cpu" (RAPL) or "battery"
	Parts  []powerPart `json:"parts,omitempty"`
}

type raplDomain struct {
	name string
	file string
	max  uint64
	top  bool // a package-level domain (not a part of one)
	prev uint64
	ok   bool
}

type powerMeter struct {
	domains []*raplDomain
	prevAt  time.Time
}

func newPowerMeter() *powerMeter {
	m := &powerMeter{}
	dirs, _ := filepath.Glob("/sys/class/powercap/intel-rapl:*")
	for _, dir := range dirs {
		base := filepath.Base(dir)
		name := readTrim(filepath.Join(dir, "name"))
		file := filepath.Join(dir, "energy_uj")
		if name == "" || readTrim(file) == "" {
			continue // not readable (the service isn't root) or not a domain
		}
		max, _ := strconv.ParseUint(readTrim(filepath.Join(dir, "max_energy_range_uj")), 10, 64)
		m.domains = append(m.domains, &raplDomain{name: name, file: file, max: max, top: strings.Count(base, ":") == 1})
	}
	return m
}

// read returns the power since the last call, or nil when nothing measures it.
func (m *powerMeter) read(now time.Time) *powerStats {
	if b := batteryPower(); b != nil {
		return b
	}
	if len(m.domains) == 0 {
		return nil
	}
	seconds := now.Sub(m.prevAt).Seconds()
	first := m.prevAt.IsZero()
	m.prevAt = now
	st := &powerStats{Source: "cpu"}
	var pkg, dram, psys float64
	for _, d := range m.domains {
		v, err := strconv.ParseUint(readTrim(d.file), 10, 64)
		if err != nil {
			continue
		}
		prev, had := d.prev, d.ok
		d.prev, d.ok = v, true
		if first || !had || seconds <= 0 {
			continue
		}
		delta := v - prev
		if v < prev && d.max > 0 { // the counter wrapped
			delta = d.max - prev + v
		}
		w := float64(delta) / 1e6 / seconds
		st.Parts = append(st.Parts, powerPart{Name: d.name, Watts: w})
		switch {
		case d.top && strings.HasPrefix(d.name, "package"):
			pkg += w
		case d.name == "dram":
			dram += w
		case d.name == "psys":
			psys += w
		}
	}
	if first {
		return nil
	}
	// The platform domain (newer laptops) covers the package and more; else package + RAM.
	st.Watts = pkg + dram
	if psys > 0 {
		st.Watts = psys
	}
	return st
}

// batteryPower is what a laptop draws from its battery, while it's discharging.
func batteryPower() *powerStats {
	dirs, _ := filepath.Glob("/sys/class/power_supply/BAT*")
	for _, dir := range dirs {
		if readTrim(filepath.Join(dir, "status")) != "Discharging" {
			continue
		}
		if uw, err := strconv.ParseFloat(readTrim(filepath.Join(dir, "power_now")), 64); err == nil && uw > 0 {
			return &powerStats{Watts: uw / 1e6, Source: "battery"}
		}
		// Some batteries report current and voltage instead.
		ua, err1 := strconv.ParseFloat(readTrim(filepath.Join(dir, "current_now")), 64)
		uv, err2 := strconv.ParseFloat(readTrim(filepath.Join(dir, "voltage_now")), 64)
		if err1 == nil && err2 == nil && ua > 0 && uv > 0 {
			return &powerStats{Watts: ua * uv / 1e12, Source: "battery"}
		}
	}
	return nil
}

// loadAverage reads the 1, 5 and 15 minute load averages.
func loadAverage() [3]float64 {
	var out [3]float64
	f := strings.Fields(readTrim("/proc/loadavg"))
	for i := 0; i < 3 && i < len(f); i++ {
		out[i], _ = strconv.ParseFloat(f[i], 64)
	}
	return out
}
