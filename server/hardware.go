package main

import (
	"context"
	"net/http"
	"os/exec"
	"regexp"
	"strings"
	"time"
)

// What the server is: a mini PC, a desktop, a laptop, a single-board computer or a virtual
// server (a VPS), read from the firmware's DMI tables, the device tree and systemd-detect-virt.

type hardwareInfo struct {
	Vendor string `json:"vendor,omitempty"`
	Model  string `json:"model,omitempty"`
	// The maker's own number for the model (Lenovo's machine type, 10MQS31W00), when the
	// model is a name.
	ModelNumber string `json:"modelNumber,omitempty"`
	// mini, desktop, laptop, allinone, server, board, virtual, or unknown.
	Kind string `json:"kind"`
	// The hypervisor for a virtual server (kvm, vmware, microsoft…).
	Virtualization string `json:"virtualization,omitempty"`
	Serial         string `json:"serial,omitempty"`
	// The firmware's year: about when the machine was made.
	Year string `json:"year,omitempty"`
}

// Values firmware fills in when the maker didn't.
var dmiJunk = regexp.MustCompile(`(?i)^(|none|n/a|na|null|default string|not specified|not applicable|to be filled by o\.?e\.?m\.?|system product name|system version|system serial number|system manufacturer|o\.?e\.?m\.?|0+|x+|123456789|chassis serial number)$`)

func dmi(name string) string {
	v := strings.Join(strings.Fields(readTrim("/sys/class/dmi/id/"+name)), " ")
	if dmiJunk.MatchString(v) {
		return ""
	}
	return v
}

// Makers' legal names, as people say them.
var vendorNames = []struct{ match, name string }{
	{"lenovo", "Lenovo"}, {"dell", "Dell"}, {"hewlett", "HP"}, {"hp", "HP"}, {"asustek", "ASUS"}, {"asus", "ASUS"},
	{"micro-star", "MSI"}, {"gigabyte", "Gigabyte"}, {"acer", "Acer"}, {"intel", "Intel"}, {"supermicro", "Supermicro"},
	{"fujitsu", "Fujitsu"}, {"toshiba", "Toshiba"}, {"samsung", "Samsung"}, {"msi", "MSI"}, {"beelink", "Beelink"},
	{"minisforum", "Minisforum"}, {"zotac", "ZOTAC"}, {"asrock", "ASRock"}, {"microsoft", "Microsoft"},
	{"amazon", "Amazon EC2"}, {"google", "Google Cloud"}, {"digitalocean", "DigitalOcean"}, {"hetzner", "Hetzner"},
	{"vultr", "Vultr"}, {"linode", "Akamai (Linode)"}, {"akamai", "Akamai (Linode)"}, {"alibaba", "Alibaba Cloud"},
	{"tencent", "Tencent Cloud"}, {"oracle", "Oracle Cloud"}, {"ovh", "OVHcloud"}, {"scaleway", "Scaleway"},
}

func vendorName(v string) string {
	low := strings.ToLower(v)
	for _, n := range vendorNames {
		if strings.HasPrefix(low, n.match) {
			return n.name
		}
	}
	return v
}

// Hypervisor makers' names in the DMI tables say nothing about whose server it is.
var genericVirtVendors = regexp.MustCompile(`(?i)^(qemu|red hat|vmware|innotek|oracle corporation|xen|bochs|openstack|nutanix|parallels|proxmox)`)

// chassisKind maps the SMBIOS chassis type.
func chassisKind(t string) string {
	switch t {
	case "8", "9", "10", "14", "31", "32":
		return "laptop"
	case "13":
		return "allinone"
	case "17", "23", "28", "29":
		return "server"
	case "35", "36":
		return "mini"
	case "3", "4", "5", "6", "7", "15", "16", "24":
		return "desktop"
	}
	return "unknown"
}

func detectVirt() string {
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	out, _ := exec.CommandContext(ctx, "systemd-detect-virt", "--vm").Output()
	if v := strings.TrimSpace(string(out)); v != "none" {
		return v
	}
	return ""
}

func readHardware() hardwareInfo {
	h := hardwareInfo{Kind: "unknown", Virtualization: detectVirt(), Serial: dmi("product_serial")}
	vendor, name, version := dmi("sys_vendor"), dmi("product_name"), dmi("product_version")
	h.Vendor = vendorName(vendor)
	h.Model = name
	// Lenovo puts the machine type in the name and the model in the version.
	if h.Vendor == "Lenovo" && version != "" && !strings.EqualFold(version, name) {
		h.Model, h.ModelNumber = version, name
	}
	if d := dmi("bios_date"); len(d) >= 4 {
		h.Year = d[len(d)-4:]
	}
	h.Kind = chassisKind(dmi("chassis_type"))
	// Small form factor machines often say "desktop": Lenovo's Tiny ThinkCentres end in "q".
	if h.Kind == "desktop" && h.Vendor == "Lenovo" && regexp.MustCompile(`(?i)^thinkcentre m\d+q\b`).MatchString(h.Model) {
		h.Kind = "mini"
	}
	// Single-board computers (Raspberry Pi…) have no DMI tables but a device tree.
	if h.Model == "" {
		if m := strings.Trim(readTrim("/proc/device-tree/model"), "\x00"); m != "" {
			h.Model, h.Kind = m, "board"
			if strings.HasPrefix(m, "Raspberry Pi") {
				h.Vendor = "Raspberry Pi"
			}
		}
	}
	if h.Virtualization != "" {
		h.Kind = "virtual"
		h.Year, h.Serial, h.ModelNumber = "", "", ""
		if genericVirtVendors.MatchString(vendor) {
			h.Vendor = ""
		}
		h.Model = ""
	}
	return h
}

func (s *server) handleHardware(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, readHardware())
}
