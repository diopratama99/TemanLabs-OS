package main

import (
	"bufio"
	"context"
	"crypto/tls"
	"encoding/json"
	"encoding/xml"
	"html"
	"io"
	"net"
	"net/http"
	"os/exec"
	"regexp"
	"slices"
	"strings"
	"sync"
	"time"
)

// Finding routers: the server's gateway; the routers between it and the internet (from
// tracepath), when they are the household's own (their admin page answers; the ISP's own
// network further on doesn't); and the routers and access points on the network, told apart by
// what they announce over UPnP, the admin page they serve and the ports they answer on. Smart
// plugs (Tasmota, Shelly) are found too, to restart routers with.

type foundRouter struct {
	Host  string `json:"host"`
	Name  string `json:"name"`
	Kind  string `json:"kind"`
	Brand string `json:"brand,omitempty"`
	// The host of the router it connects through ("" when it faces the internet).
	Parent string `json:"parent,omitempty"`
	// How it can probably be restarted (mikrotik, ssh) or "".
	Method  string   `json:"method,omitempty"`
	Gateway bool     `json:"gateway"`
	Why     []string `json:"why"`
}

type foundPlug struct {
	Host string `json:"host"`
	Type string `json:"type"` // tasmota, shelly
	Name string `json:"name,omitempty"`
}

// routerBrands: what an admin page or UPnP description says → brand, and whether it's an ISP's
// modem and how it restarts.
var routerBrands = []struct {
	match  *regexp.Regexp
	brand  string
	modem  bool
	method string
}{
	{regexp.MustCompile(`(?i)routeros|mikrotik`), "MikroTik", false, "mikrotik"},
	{regexp.MustCompile(`(?i)openwrt|luci`), "OpenWrt", false, "ssh"},
	{regexp.MustCompile(`(?i)unifi|ubiquiti|edgeos|airos`), "Ubiquiti", false, "ssh"},
	{regexp.MustCompile(`(?i)\bzte\b|zxhn|f6[0-9]{2}\b|f670|f609`), "ZTE", true, ""},
	{regexp.MustCompile(`(?i)huawei|hg8[0-9]{3}|eg8[0-9]{3}|optixstar|echolife`), "Huawei", true, ""},
	{regexp.MustCompile(`(?i)fiberhome|\ban5506|fh_access|login_inter\.html`), "FiberHome", true, ""},
	{regexp.MustCompile(`(?i)nokia|g-240w|alcatel`), "Nokia", true, ""},
	// TP-Link and Mercusys share firmware; its globalType says which it is.
	{regexp.MustCompile(`(?i)mercusys|globalType\s*=\s*"MW"`), "Mercusys", false, ""},
	{regexp.MustCompile(`(?i)tp-?link|tplinkwifi|archer|\bdeco\b`), "TP-Link", false, ""},
	{regexp.MustCompile(`(?i)tenda`), "Tenda", false, ""},
	{regexp.MustCompile(`(?i)totolink`), "TOTOLINK", false, ""},
	{regexp.MustCompile(`(?i)asuswrt|\basus\b`), "ASUS", false, ""},
	{regexp.MustCompile(`(?i)netgear`), "NETGEAR", false, ""},
	{regexp.MustCompile(`(?i)linksys`), "Linksys", false, ""},
	{regexp.MustCompile(`(?i)d-?link`), "D-Link", false, ""},
	{regexp.MustCompile(`(?i)xiaomi|mi ?router|redmi router`), "Xiaomi", false, ""},
	{regexp.MustCompile(`(?i)ruijie|reyee`), "Ruijie", false, ""},
	{regexp.MustCompile(`(?i)draytek|vigor`), "DrayTek", false, ""},
	{regexp.MustCompile(`(?i)opnsense`), "OPNsense", false, "ssh"},
	{regexp.MustCompile(`(?i)pfsense`), "pfSense", false, ""},
	{regexp.MustCompile(`(?i)fritz!?box`), "FRITZ!Box", true, ""},
	{regexp.MustCompile(`(?i)cisco|linksys smart wi-?fi`), "Cisco", false, ""},
}

var (
	tracepathHop  = regexp.MustCompile(`^\s*\d+\??:\s+(\d+\.\d+\.\d+\.\d+)\b`)
	tracerouteHop = regexp.MustCompile(`^\s*\d+\s+(\d+\.\d+\.\d+\.\d+)\b`)
	// Addresses ISP modems answer on, though they're not on the household's network.
	modemAddresses = []string{"192.168.100.1", "192.168.1.254", "192.168.8.1", "192.168.0.1", "192.168.1.1", "10.0.0.138"}
)

var findClient = &http.Client{
	Timeout: 3 * time.Second,
	Transport: &http.Transport{
		// Routers' admin pages use their own certificates.
		TLSClientConfig: &tls.Config{InsecureSkipVerify: true},
	},
	CheckRedirect: func(req *http.Request, via []*http.Request) error {
		if len(via) >= 3 {
			return http.ErrUseLastResponse
		}
		return nil
	},
}

// pageInfo is what a web page on host says about the device: its title and brand.
type pageInfo struct {
	title, brand, method string
	modem, tasmota       bool
}

func fetchPage(ctx context.Context, url string) (string, http.Header, bool) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return "", nil, false
	}
	res, err := findClient.Do(req)
	if err != nil {
		return "", nil, false
	}
	defer res.Body.Close()
	body, _ := io.ReadAll(io.LimitReader(res.Body, 96<<10))
	return string(body), res.Header, true
}

func brandOf(text string) (brand, method string, modem bool) {
	for _, b := range routerBrands {
		if b.match.MatchString(text) {
			return b.brand, b.method, b.modem
		}
	}
	return "", "", false
}

func readPage(ctx context.Context, host string, ports map[int]bool) (pageInfo, bool) {
	var urls []string
	if ports[80] {
		urls = append(urls, "http://"+host+"/")
	}
	if ports[443] {
		urls = append(urls, "https://"+host+"/")
	}
	if ports[8080] {
		urls = append(urls, "http://"+host+":8080/")
	}
	for _, u := range urls {
		body, header, ok := fetchPage(ctx, u)
		if !ok {
			continue
		}
		var p pageInfo
		if m := titlePattern.FindStringSubmatch(body); m != nil {
			p.title = strings.Join(strings.Fields(html.UnescapeString(m[1])), " ")
		}
		p.tasmota = strings.Contains(body, "Tasmota")
		p.brand, p.method, p.modem = brandOf(p.title + " " + header.Get("Server") + " " + header.Get("WWW-Authenticate") + " " + body)
		return p, true
	}
	return pageInfo{}, false
}

// shellyName asks host whether it's a Shelly (its /shelly page), and returns its model.
func shellyName(ctx context.Context, host string) (string, bool) {
	body, _, ok := fetchPage(ctx, "http://"+host+"/shelly")
	if !ok {
		return "", false
	}
	var info struct {
		Type  string `json:"type"`
		Model string `json:"model"`
		App   string `json:"app"`
	}
	if json.Unmarshal([]byte(body), &info) != nil || (info.Type == "" && info.App == "" && info.Model == "") {
		return "", false
	}
	return "Shelly " + strings.TrimSpace(info.App+" "+info.Type), true
}

// upnpDevice is what a device describes about itself over UPnP.
type upnpDevice struct {
	deviceType, name, manufacturer, model string
}

// ssdpSearch asks the network who's there (UPnP) and reads each answer's description.
func ssdpSearch(ctx context.Context) map[string]upnpDevice {
	out := map[string]upnpDevice{}
	conn, err := net.ListenUDP("udp4", nil)
	if err != nil {
		return out
	}
	defer conn.Close()
	group := &net.UDPAddr{IP: net.IPv4(239, 255, 255, 250), Port: 1900}
	for _, st := range []string{"urn:schemas-upnp-org:device:InternetGatewayDevice:1", "urn:schemas-upnp-org:device:WLANAccessPointDevice:1", "upnp:rootdevice"} {
		msg := "M-SEARCH * HTTP/1.1\r\nHOST: 239.255.255.250:1900\r\nMAN: \"ssdp:discover\"\r\nMX: 2\r\nST: " + st + "\r\n\r\n"
		_, _ = conn.WriteToUDP([]byte(msg), group)
	}
	locations := map[string]string{}
	_ = conn.SetReadDeadline(time.Now().Add(2500 * time.Millisecond))
	buf := make([]byte, 4096)
	for {
		n, from, err := conn.ReadFromUDP(buf)
		if err != nil {
			break
		}
		sc := bufio.NewScanner(strings.NewReader(string(buf[:n])))
		for sc.Scan() {
			k, v, ok := strings.Cut(sc.Text(), ":")
			if ok && strings.EqualFold(strings.TrimSpace(k), "location") {
				ip := from.IP.String()
				// A gateway's description wins over its other devices'.
				if _, seen := locations[ip]; !seen || strings.Contains(string(buf[:n]), "InternetGatewayDevice") {
					locations[ip] = strings.TrimSpace(v)
				}
			}
		}
	}
	var mu sync.Mutex
	var wg sync.WaitGroup
	for ip, loc := range locations {
		if !strings.HasPrefix(loc, "http://") {
			continue
		}
		wg.Add(1)
		go func() {
			defer wg.Done()
			body, _, ok := fetchPage(ctx, loc)
			if !ok {
				return
			}
			var desc struct {
				Device struct {
					DeviceType   string `xml:"deviceType"`
					FriendlyName string `xml:"friendlyName"`
					Manufacturer string `xml:"manufacturer"`
					ModelName    string `xml:"modelName"`
				} `xml:"device"`
			}
			if xml.Unmarshal([]byte(body), &desc) != nil {
				return
			}
			mu.Lock()
			out[ip] = upnpDevice{desc.Device.DeviceType, desc.Device.FriendlyName, desc.Device.Manufacturer, desc.Device.ModelName}
			mu.Unlock()
		}()
	}
	wg.Wait()
	return out
}

// upstreamHops: the addresses on the way to the internet, nearest first.
func upstreamHops(ctx context.Context) []string {
	var hops []string
	add := func(ip string) {
		if !slices.Contains(hops, ip) {
			hops = append(hops, ip)
		}
	}
	if out, err := exec.CommandContext(ctx, "tracepath", "-n", "-m", "5", "1.1.1.1").Output(); err == nil || len(out) > 0 {
		for _, line := range strings.Split(string(out), "\n") {
			if m := tracepathHop.FindStringSubmatch(line); m != nil {
				add(m[1])
			}
		}
	}
	if len(hops) == 0 {
		out, _ := exec.CommandContext(ctx, "traceroute", "-n", "-m", "5", "-w", "1", "1.1.1.1").Output()
		for _, line := range strings.Split(string(out), "\n") {
			if m := tracerouteHop.FindStringSubmatch(line); m != nil {
				add(m[1])
			}
		}
	}
	return hops
}

// privateIP: an address only used inside a network (not the ISP's shared 100.64/10).
func privateIP(ip string) bool {
	a := net.ParseIP(ip)
	return a != nil && a.IsPrivate()
}

func (s *server) handleFindRouters(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := context.WithTimeout(r.Context(), 25*time.Second)
	defer cancel()
	gateway := defaultGateway()

	var hops []string
	var upnp map[string]upnpDevice
	var wg sync.WaitGroup
	wg.Add(2)
	go func() { defer wg.Done(); hops = upstreamHops(ctx) }()
	go func() { defer wg.Done(); upnp = ssdpSearch(ctx) }()
	self, neighbours := sweepLAN(ctx)
	wg.Wait()

	// Everyone worth a closer look: the network's devices, the hops on the way out, and the
	// addresses ISP modems use.
	candidates := map[string]bool{}
	for _, nb := range neighbours {
		if inNetworks(nb.ip) && !slices.Contains(self, nb.ip) {
			candidates[nb.ip] = true
		}
	}
	for _, h := range hops {
		if privateIP(h) && !slices.Contains(self, h) {
			candidates[h] = true
		}
	}
	for _, m := range modemAddresses {
		if !slices.Contains(self, m) {
			candidates[m] = true
		}
	}
	if gateway != "" {
		candidates[gateway] = true
	}

	routerPortsFind := []int{80, 443, 8080, 8291, 7547, 22}
	type look struct {
		ports  map[int]bool
		page   pageInfo
		web    bool
		shelly string
	}
	looks := map[string]*look{}
	var mu sync.Mutex
	for ip := range candidates {
		wg.Add(1)
		go func() {
			defer wg.Done()
			l := &look{ports: map[int]bool{}}
			var pw sync.WaitGroup
			var pmu sync.Mutex
			for _, p := range routerPortsFind {
				pw.Add(1)
				go func() {
					defer pw.Done()
					if knockPort(ctx, ip, p, 900*time.Millisecond) {
						pmu.Lock()
						l.ports[p] = true
						pmu.Unlock()
					}
				}()
			}
			pw.Wait()
			if len(l.ports) == 0 {
				return
			}
			l.page, l.web = readPage(ctx, ip, l.ports)
			if l.web && !l.page.tasmota && l.page.brand == "" {
				l.shelly, _ = shellyName(ctx, ip)
			}
			mu.Lock()
			looks[ip] = l
			mu.Unlock()
		}()
	}
	wg.Wait()

	result := struct {
		Routers []foundRouter `json:"routers"`
		Plugs   []foundPlug   `json:"plugs"`
		Gateway string        `json:"gateway"`
	}{Routers: []foundRouter{}, Plugs: []foundPlug{}, Gateway: gateway}

	found := map[string]*foundRouter{}
	add := func(ip string, l *look, why string) *foundRouter {
		if f := found[ip]; f != nil {
			if why != "" && !slices.Contains(f.Why, why) {
				f.Why = append(f.Why, why)
			}
			return f
		}
		f := &foundRouter{Host: ip, Kind: "ap", Gateway: ip == gateway, Why: []string{}}
		if why != "" {
			f.Why = append(f.Why, why)
		}
		if l != nil {
			f.Brand, f.Method = l.page.brand, l.page.method
			if l.ports[8291] {
				f.Brand, f.Method = "MikroTik", "mikrotik"
			}
			if l.page.modem || l.ports[7547] {
				f.Kind = "modem"
			}
		}
		if u, ok := upnp[ip]; ok {
			if f.Brand == "" {
				f.Brand, _, _ = brandOf(u.manufacturer + " " + u.model + " " + u.name)
			}
			if f.Name == "" {
				f.Name = strings.TrimSpace(u.name)
				if f.Name == "" {
					f.Name = strings.TrimSpace(u.manufacturer + " " + u.model)
				}
			}
		}
		found[ip] = f
		return f
	}

	// The way out: the gateway, then the household's own routers beyond it (whose admin page
	// answers); the ISP's network starts at the first one that doesn't.
	chain := []string{}
	if gateway != "" {
		add(gateway, looks[gateway], "This server’s gateway")
		chain = append(chain, gateway)
	}
	for _, h := range hops {
		if h == gateway || slices.Contains(chain, h) {
			continue
		}
		l := looks[h]
		if !privateIP(h) || l == nil || !l.web {
			break
		}
		add(h, l, "On the way to the internet")
		chain = append(chain, h)
	}
	// An ISP modem in bridge mode isn't on the way, but still answers on its own address.
	for _, m := range modemAddresses {
		if l := looks[m]; l != nil && l.web && (l.page.modem || l.page.brand != "") && found[m] == nil && !inNetworks(m) {
			f := add(m, l, "Answers at a modem’s address")
			f.Kind = "modem"
			chain = append(chain, m)
		}
	}
	for i, ip := range chain {
		if i+1 < len(chain) {
			found[ip].Parent = chain[i+1]
		}
	}
	if gateway != "" {
		if f := found[gateway]; f.Kind != "modem" {
			f.Kind = "router"
		}
	}

	// The rest of the network: what announces itself as a gateway or access point, or serves a
	// router's admin page, or MikroTik's Winbox; and the smart plugs.
	for ip, l := range looks {
		if found[ip] != nil || !inNetworks(ip) {
			continue
		}
		u, hasUPnP := upnp[ip]
		switch {
		case l.page.tasmota:
			result.Plugs = append(result.Plugs, foundPlug{Host: ip, Type: "tasmota", Name: l.page.title})
			continue
		case l.shelly != "":
			result.Plugs = append(result.Plugs, foundPlug{Host: ip, Type: "shelly", Name: l.shelly})
			continue
		}
		why := ""
		switch {
		case hasUPnP && (strings.Contains(u.deviceType, "InternetGatewayDevice") || strings.Contains(u.deviceType, "WLANAccessPoint")):
			why = "Announces itself as a router (UPnP)"
		case l.ports[8291]:
			why = "Answers on MikroTik’s Winbox port"
		case l.page.brand != "":
			why = l.page.brand + " admin page"
		}
		if why == "" {
			continue
		}
		f := add(ip, l, why)
		if gateway != "" {
			f.Parent = gateway
		}
		if hasUPnP && strings.Contains(u.deviceType, "InternetGatewayDevice") && f.Kind != "modem" {
			f.Kind = "router"
		}
	}

	// Names: UPnP's first (set above); then the page title, when it names the device (not
	// "Opening..." or "Login"); then the brand; then the network's DNS.
	for ip, f := range found {
		if f.Name == "" {
			if l := looks[ip]; l != nil && len(l.page.title) <= 40 {
				if b, _, _ := brandOf(l.page.title); b != "" && !strings.Contains(strings.ToLower(l.page.title), "login") {
					f.Name = l.page.title
				}
			}
		}
		if f.Name == "" && f.Brand != "" {
			f.Name = f.Brand + " " + map[string]string{"modem": "Modem", "router": "Router", "ap": "Access Point"}[f.Kind]
		}
		if f.Name == "" {
			f.Name = lookupName(ctx, ip)
		}
		if f.Name == "" {
			f.Name = ip
		}
		result.Routers = append(result.Routers, *f)
	}
	// Nearest the internet first, then by address.
	depth := func(f foundRouter) int {
		d := 0
		for p := f.Parent; p != "" && d < 10; d++ {
			if pf := found[p]; pf != nil {
				p = pf.Parent
			} else {
				break
			}
		}
		return d
	}
	slices.SortFunc(result.Routers, func(a, b foundRouter) int {
		if da, db := depth(a), depth(b); da != db {
			return da - db
		}
		return compareIP(a.Host, b.Host)
	})
	slices.SortFunc(result.Plugs, func(a, b foundPlug) int { return compareIP(a.Host, b.Host) })
	writeJSON(w, http.StatusOK, result)
}
