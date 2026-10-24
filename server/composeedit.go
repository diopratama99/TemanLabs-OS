package main

import (
	"bytes"
	"errors"
	"fmt"
	"regexp"
	"slices"
	"sort"
	"strconv"
	"strings"

	"gopkg.in/yaml.v3"
)

// Editing compose files in place: the file is kept as a yaml.Node tree so comments, key order
// and formatting survive, and only the fields the user changed are rewritten.

var (
	volumeName = regexp.MustCompile(`^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,127}$`)
	plainPort  = regexp.MustCompile(`^\d{1,5}$`)
	portLike   = regexp.MustCompile(`^[0-9][0-9:.-]*(/(tcp|udp))?$`)
	memoryQty  = regexp.MustCompile(`^(\d+(?:\.\d+)?)\s*([kKmMgGtT]?)[iI]?[bB]?$`)
)

type composeDoc struct {
	root   *yaml.Node // the document node
	indent int
}

func parseComposeDoc(text []byte) (*composeDoc, error) {
	var root yaml.Node
	if err := yaml.Unmarshal(text, &root); err != nil {
		return nil, fmt.Errorf("compose file: %w", err)
	}
	if root.Kind != yaml.DocumentNode || len(root.Content) == 0 || root.Content[0].Kind != yaml.MappingNode {
		return nil, errors.New("compose file must be a YAML mapping")
	}
	d := &composeDoc{root: &root, indent: guessIndent(text)}
	if s := d.services(); s == nil || s.Kind != yaml.MappingNode || len(s.Content) == 0 {
		return nil, errors.New("compose file has no services")
	}
	return d, nil
}

func (d *composeDoc) top() *yaml.Node      { return d.root.Content[0] }
func (d *composeDoc) services() *yaml.Node { return mapGet(d.top(), "services") }

func (d *composeDoc) serviceNames() []string {
	var names []string
	s := d.services()
	for i := 0; i+1 < len(s.Content); i += 2 {
		names = append(names, s.Content[i].Value)
	}
	return names
}

func (d *composeDoc) service(name string) *yaml.Node {
	if n := mapGet(d.services(), name); n != nil && n.Kind == yaml.MappingNode {
		return n
	}
	return nil
}

// mainService is the service the settings form edits: the one x-casaos names, else the only
// one, else the first that publishes a port, else the first.
func (d *composeDoc) mainService() string {
	names := d.serviceNames()
	if x := mapGet(d.top(), "x-casaos"); x != nil {
		if m := mapGet(x, "main"); m != nil && d.service(m.Value) != nil {
			return m.Value
		}
	}
	if len(names) == 1 {
		return names[0]
	}
	for _, n := range names {
		if svc := d.service(n); svc != nil && mapGet(svc, "ports") != nil {
			return n
		}
	}
	return names[0]
}

func (d *composeDoc) bytes() ([]byte, error) {
	var buf bytes.Buffer
	enc := yaml.NewEncoder(&buf)
	enc.SetIndent(d.indent)
	if err := enc.Encode(d.root); err != nil {
		return nil, err
	}
	_ = enc.Close()
	return buf.Bytes(), nil
}

// guessIndent keeps a file's own indentation (CasaOS writes 4 spaces) when it is re-encoded.
func guessIndent(text []byte) int {
	for _, line := range strings.Split(string(text), "\n") {
		trimmed := strings.TrimLeft(line, " ")
		if n := len(line) - len(trimmed); n > 0 && trimmed != "" && !strings.HasPrefix(trimmed, "#") && !strings.HasPrefix(trimmed, "-") {
			if n >= 2 && n <= 8 {
				return n
			}
			break
		}
	}
	return 2
}

func mapGet(m *yaml.Node, key string) *yaml.Node {
	if m == nil || m.Kind != yaml.MappingNode {
		return nil
	}
	for i := 0; i+1 < len(m.Content); i += 2 {
		if m.Content[i].Value == key {
			return m.Content[i+1]
		}
	}
	return nil
}

func mapSet(m *yaml.Node, key string, v *yaml.Node) {
	for i := 0; i+1 < len(m.Content); i += 2 {
		if m.Content[i].Value == key {
			// Keep the comment that was on the old value.
			v.LineComment, v.HeadComment = m.Content[i+1].LineComment, m.Content[i+1].HeadComment
			m.Content[i+1] = v
			return
		}
	}
	m.Content = append(m.Content, &yaml.Node{Kind: yaml.ScalarNode, Tag: "!!str", Value: key}, v)
}

func mapDel(m *yaml.Node, key string) {
	for i := 0; i+1 < len(m.Content); i += 2 {
		if m.Content[i].Value == key {
			m.Content = slices.Delete(m.Content, i, i+2)
			return
		}
	}
}

func strNode(s string) *yaml.Node {
	// The encoder quotes what YAML would read as another type (numbers, booleans, "a: b");
	// port mappings like "8080:80" are quoted too, as compose's docs recommend.
	n := &yaml.Node{Kind: yaml.ScalarNode, Tag: "!!str", Value: s}
	if portLike.MatchString(s) {
		n.Style = yaml.DoubleQuotedStyle
	}
	return n
}

func seqNode(items []*yaml.Node) *yaml.Node {
	return &yaml.Node{Kind: yaml.SequenceNode, Tag: "!!seq", Content: items}
}

func ensureMap(parent *yaml.Node, key string) *yaml.Node {
	if n := mapGet(parent, key); n != nil && n.Kind == yaml.MappingNode {
		return n
	}
	n := &yaml.Node{Kind: yaml.MappingNode, Tag: "!!map"}
	mapSet(parent, key, n)
	return n
}

// ----- Reading a service into the settings form -----

// formView is a service as the form shows it, plus the entries the form can't represent
// (port ranges, host IPs, tmpfs mounts…), which are kept as they are on save.
type formView struct {
	spec       customSpec
	rawPorts   []*yaml.Node
	rawVolumes []*yaml.Node
	rawDevices []*yaml.Node
	// Whether memory comes from deploy.resources.limits (CasaOS) rather than mem_limit.
	deployMemory bool
}

func scalar(n *yaml.Node) (string, bool) {
	if n == nil || n.Kind != yaml.ScalarNode {
		return "", false
	}
	return n.Value, true
}

func splitImage(ref string) (image, tag string) {
	if strings.Contains(ref, "@") {
		return ref, ""
	}
	slash := strings.LastIndex(ref, "/")
	if i := strings.LastIndex(ref, ":"); i > slash {
		return ref[:i], ref[i+1:]
	}
	return ref, ""
}

func readService(svc *yaml.Node) formView {
	var v formView
	s := &v.spec
	if img, ok := scalar(mapGet(svc, "image")); ok {
		s.Image, s.Tag = splitImage(img)
	}

	if ports := mapGet(svc, "ports"); ports != nil && ports.Kind == yaml.SequenceNode {
		for _, p := range ports.Content {
			host, ctr, proto, ok := readPort(p)
			if !ok {
				v.rawPorts = append(v.rawPorts, p)
				continue
			}
			s.Ports = append(s.Ports, struct {
				Host      int    `json:"host"`
				Container int    `json:"container"`
				Protocol  string `json:"protocol"`
			}{host, ctr, proto})
		}
	}

	if vols := mapGet(svc, "volumes"); vols != nil && vols.Kind == yaml.SequenceNode {
		for _, n := range vols.Content {
			host, ctr, ro, ok := readVolume(n)
			if !ok {
				v.rawVolumes = append(v.rawVolumes, n)
				continue
			}
			s.Volumes = append(s.Volumes, struct {
				Host      string `json:"host"`
				Container string `json:"container"`
				ReadOnly  bool   `json:"readOnly"`
			}{host, ctr, ro})
		}
	}

	switch env := mapGet(svc, "environment"); {
	case env == nil:
	case env.Kind == yaml.MappingNode:
		for i := 0; i+1 < len(env.Content); i += 2 {
			val := env.Content[i+1].Value
			if env.Content[i+1].Tag == "!!null" {
				val = ""
			}
			s.Env = append(s.Env, struct {
				Key   string `json:"key"`
				Value string `json:"value"`
			}{env.Content[i].Value, val})
		}
	case env.Kind == yaml.SequenceNode:
		for _, e := range env.Content {
			key, val, _ := strings.Cut(e.Value, "=")
			s.Env = append(s.Env, struct {
				Key   string `json:"key"`
				Value string `json:"value"`
			}{key, val})
		}
	}

	if devs := mapGet(svc, "devices"); devs != nil && devs.Kind == yaml.SequenceNode {
		for _, n := range devs.Content {
			parts := strings.Split(n.Value, ":")
			if n.Kind != yaml.ScalarNode || len(parts) > 3 || !strings.HasPrefix(parts[0], "/dev/") {
				v.rawDevices = append(v.rawDevices, n)
				continue
			}
			ctr := parts[0]
			if len(parts) > 1 {
				ctr = parts[1]
			}
			s.Devices = append(s.Devices, struct {
				Host      string `json:"host"`
				Container string `json:"container"`
			}{parts[0], ctr})
		}
	}

	switch cmd := mapGet(svc, "command"); {
	case cmd == nil:
	case cmd.Kind == yaml.ScalarNode:
		s.Command = cmd.Value
	case cmd.Kind == yaml.SequenceNode:
		var parts []string
		for _, c := range cmd.Content {
			if strings.ContainsAny(c.Value, " \t\"'") {
				parts = append(parts, strconv.Quote(c.Value))
			} else {
				parts = append(parts, c.Value)
			}
		}
		s.Command = strings.Join(parts, " ")
	}

	s.Restart, _ = scalar(mapGet(svc, "restart"))
	if s.Restart == "" {
		s.Restart = "no"
	}
	if mode, ok := scalar(mapGet(svc, "network_mode")); ok {
		s.Network = mode
	} else if nets := mapGet(svc, "networks"); nets != nil {
		switch nets.Kind {
		case yaml.SequenceNode:
			if len(nets.Content) > 0 {
				s.Network = nets.Content[0].Value
			}
		case yaml.MappingNode:
			if len(nets.Content) > 0 {
				s.Network = nets.Content[0].Value
			}
		}
	}
	if p, ok := scalar(mapGet(svc, "privileged")); ok {
		s.Privileged = p == "true"
	}
	if limits := mapGet(mapGet(mapGet(svc, "deploy"), "resources"), "limits"); limits != nil {
		if m, ok := scalar(mapGet(limits, "memory")); ok {
			s.MemoryMB, v.deployMemory = memoryMB(m), true
		}
	}
	if m, ok := scalar(mapGet(svc, "mem_limit")); ok && !v.deployMemory {
		s.MemoryMB = memoryMB(m)
	}
	if c, ok := scalar(mapGet(svc, "cpu_shares")); ok {
		s.CPUShares, _ = strconv.Atoi(c)
	}
	if caps := mapGet(svc, "cap_add"); caps != nil && caps.Kind == yaml.SequenceNode {
		for _, c := range caps.Content {
			s.CapAdd = append(s.CapAdd, c.Value)
		}
	}
	s.Hostname, _ = scalar(mapGet(svc, "hostname"))
	return v
}

// readPort understands "8080:80", "8080:80/udp", "80" (published as itself) and the long syntax.
func readPort(n *yaml.Node) (host, ctr int, proto string, ok bool) {
	proto = "tcp"
	switch n.Kind {
	case yaml.ScalarNode:
		spec := n.Value
		if p, rest, found := strings.Cut(spec, "/"); found {
			spec, proto = p, rest
		}
		parts := strings.Split(spec, ":")
		if len(parts) > 2 {
			return 0, 0, "", false // host IP
		}
		for _, p := range parts {
			if !plainPort.MatchString(p) {
				return 0, 0, "", false // range or variable
			}
		}
		ctr, _ = strconv.Atoi(parts[len(parts)-1])
		host = ctr
		if len(parts) == 2 {
			host, _ = strconv.Atoi(parts[0])
		}
	case yaml.MappingNode:
		if mapGet(n, "host_ip") != nil {
			return 0, 0, "", false
		}
		t, _ := scalar(mapGet(n, "target"))
		pub, _ := scalar(mapGet(n, "published"))
		if !plainPort.MatchString(t) || (pub != "" && !plainPort.MatchString(pub)) {
			return 0, 0, "", false
		}
		ctr, _ = strconv.Atoi(t)
		host = ctr
		if pub != "" {
			host, _ = strconv.Atoi(pub)
		}
		if p, ok := scalar(mapGet(n, "protocol")); ok && p != "" {
			proto = p
		}
	default:
		return 0, 0, "", false
	}
	return host, ctr, proto, (proto == "tcp" || proto == "udp") && ctr > 0
}

// readVolume understands "src:dst", "src:dst:ro" and long-syntax bind and volume mounts.
func readVolume(n *yaml.Node) (host, ctr string, ro bool, ok bool) {
	switch n.Kind {
	case yaml.ScalarNode:
		parts := strings.Split(n.Value, ":")
		if len(parts) < 2 || len(parts) > 3 {
			return "", "", false, false
		}
		if len(parts) == 3 {
			if parts[2] != "ro" && parts[2] != "rw" {
				return "", "", false, false
			}
			ro = parts[2] == "ro"
		}
		return parts[0], parts[1], ro, parts[0] != "" && parts[1] != ""
	case yaml.MappingNode:
		t, _ := scalar(mapGet(n, "type"))
		if t != "bind" && t != "volume" {
			return "", "", false, false
		}
		for i := 0; i+1 < len(n.Content); i += 2 {
			switch n.Content[i].Value {
			case "type", "source", "target", "read_only":
			default:
				return "", "", false, false // bind options, volume options…
			}
		}
		host, _ = scalar(mapGet(n, "source"))
		ctr, _ = scalar(mapGet(n, "target"))
		r, _ := scalar(mapGet(n, "read_only"))
		return host, ctr, r == "true", host != "" && ctr != ""
	}
	return "", "", false, false
}

func memoryMB(q string) int {
	if n, err := strconv.ParseInt(q, 10, 64); err == nil {
		return int(n >> 20) // plain bytes
	}
	m := memoryQty.FindStringSubmatch(strings.TrimSpace(q))
	if m == nil {
		return 0
	}
	value, _ := strconv.ParseFloat(m[1], 64)
	switch strings.ToLower(m[2]) {
	case "k":
		value /= 1024
	case "g":
		value *= 1024
	case "t":
		value *= 1024 * 1024
	case "":
		value /= 1024 * 1024
	}
	return int(value)
}

// ----- Writing the form back -----

// applyForm writes the fields that differ from what the file says into the service. Fields the
// user didn't touch keep their exact text, even if the form would have written them differently.
func (s *appStore) applyForm(d *composeDoc, service string, next *customSpec, ownPorts map[int]bool) (changed bool, err error) {
	svc := d.service(service)
	if svc == nil {
		return false, fmt.Errorf("no service %q", service)
	}
	view := readService(svc)
	prev := view.spec

	// Validate the new values through the same rules as Manual Install. Only changed fields are
	// checked: what the file already says (variables, odd networks) stays as written.
	probe := *next
	if next.Image == prev.Image && next.Tag == prev.Tag {
		probe.Image, probe.Tag = "busybox", ""
	}
	if samePorts(prev, *next) {
		probe.Ports = nil
	}
	if sameVolumes(prev, *next) {
		probe.Volumes = nil
	}
	if sameEnv(prev, *next) {
		probe.Env = nil
	}
	if sameDevices(prev, *next) {
		probe.Devices = nil
	}
	if slices.Equal(prev.CapAdd, next.CapAdd) {
		probe.CapAdd = nil
	}
	if next.Network == prev.Network {
		probe.Network = ""
	}
	if next.Restart == prev.Restart {
		probe.Restart = ""
	}
	if next.Hostname == prev.Hostname {
		probe.Hostname = ""
	}
	if ownPorts == nil {
		ownPorts = map[int]bool{}
	}
	fields, external, err := s.serviceFields(&probe, ownPorts)
	if err != nil {
		return false, err
	}
	before, _ := yaml.Marshal(svc)
	defer func() {
		after, _ := yaml.Marshal(svc)
		changed = !bytes.Equal(before, after) || changed
	}()

	if next.Image != prev.Image || next.Tag != prev.Tag {
		mapSet(svc, "image", strNode(fields.Image))
	}
	if !samePorts(prev, *next) {
		items := append([]*yaml.Node(nil), view.rawPorts...)
		for _, p := range fields.Ports {
			items = append(items, strNode(p))
		}
		setOrDelete(svc, "ports", items)
	}
	if !sameVolumes(prev, *next) {
		items := append([]*yaml.Node(nil), view.rawVolumes...)
		for _, v := range fields.Volumes {
			items = append(items, strNode(v))
		}
		setOrDelete(svc, "volumes", items)
		declareNamedVolumes(d, next)
	}
	if !sameEnv(prev, *next) {
		if len(next.Env) == 0 {
			mapDel(svc, "environment")
		} else {
			env := &yaml.Node{Kind: yaml.MappingNode, Tag: "!!map"}
			for _, e := range next.Env {
				if strings.TrimSpace(e.Key) == "" {
					continue
				}
				env.Content = append(env.Content, strNode(strings.TrimSpace(e.Key)), strNode(e.Value))
			}
			mapSet(svc, "environment", env)
		}
	}
	if !sameDevices(prev, *next) {
		items := append([]*yaml.Node(nil), view.rawDevices...)
		for _, dev := range fields.Devices {
			items = append(items, strNode(dev))
		}
		setOrDelete(svc, "devices", items)
	}
	if next.Command != prev.Command {
		if fields.Command == "" {
			mapDel(svc, "command")
		} else {
			mapSet(svc, "command", strNode(fields.Command))
		}
	}
	if next.Restart != prev.Restart {
		mapSet(svc, "restart", strNode(fields.Restart))
	}
	if next.Network != prev.Network {
		switch {
		case fields.NetworkMode != "":
			mapSet(svc, "network_mode", strNode(fields.NetworkMode))
			mapDel(svc, "networks")
		case external != "":
			mapDel(svc, "network_mode")
			mapSet(svc, "networks", seqNode([]*yaml.Node{strNode(external)}))
			nets := ensureMap(d.top(), "networks")
			if mapGet(nets, external) == nil {
				ext := &yaml.Node{Kind: yaml.MappingNode, Tag: "!!map"}
				mapSet(ext, "external", &yaml.Node{Kind: yaml.ScalarNode, Tag: "!!bool", Value: "true"})
				mapSet(nets, external, ext)
				changed = true
			}
		}
	}
	if next.Privileged != prev.Privileged {
		if next.Privileged {
			mapSet(svc, "privileged", &yaml.Node{Kind: yaml.ScalarNode, Tag: "!!bool", Value: "true"})
		} else {
			mapDel(svc, "privileged")
		}
	}
	if next.MemoryMB != prev.MemoryMB {
		if view.deployMemory {
			limits := ensureMap(ensureMap(ensureMap(svc, "deploy"), "resources"), "limits")
			if next.MemoryMB > 0 {
				mapSet(limits, "memory", strNode(strconv.Itoa(next.MemoryMB)+"M"))
			} else {
				mapDel(limits, "memory")
			}
		} else if next.MemoryMB > 0 {
			mapSet(svc, "mem_limit", strNode(fields.MemLimit))
		} else {
			mapDel(svc, "mem_limit")
		}
	}
	if next.CPUShares != prev.CPUShares {
		if next.CPUShares > 0 {
			mapSet(svc, "cpu_shares", &yaml.Node{Kind: yaml.ScalarNode, Tag: "!!int", Value: strconv.Itoa(next.CPUShares)})
		} else {
			mapDel(svc, "cpu_shares")
		}
	}
	if !slices.Equal(prev.CapAdd, next.CapAdd) {
		items := make([]*yaml.Node, 0, len(fields.CapAdd))
		for _, c := range fields.CapAdd {
			items = append(items, strNode(c))
		}
		setOrDelete(svc, "cap_add", items)
	}
	if next.Hostname != prev.Hostname {
		if fields.Hostname == "" {
			mapDel(svc, "hostname")
		} else {
			mapSet(svc, "hostname", strNode(fields.Hostname))
		}
	}
	return false, nil
}

func setOrDelete(svc *yaml.Node, key string, items []*yaml.Node) {
	if len(items) == 0 {
		mapDel(svc, key)
		return
	}
	mapSet(svc, key, seqNode(items))
}

// declareNamedVolumes adds named volumes the form introduced to the top-level volumes block.
func declareNamedVolumes(d *composeDoc, spec *customSpec) {
	for _, v := range spec.Volumes {
		name := strings.TrimSpace(v.Host)
		if strings.HasPrefix(name, "/") || !volumeName.MatchString(name) {
			continue
		}
		vols := ensureMap(d.top(), "volumes")
		if mapGet(vols, name) == nil {
			mapSet(vols, name, &yaml.Node{Kind: yaml.MappingNode, Tag: "!!map"})
		}
	}
}

func samePorts(a, b customSpec) bool {
	if len(a.Ports) != len(b.Ports) {
		return false
	}
	for i := range a.Ports {
		pa, pb := a.Ports[i], b.Ports[i]
		hostB := pb.Host
		if hostB == 0 {
			hostB = pb.Container
		}
		protoB := pb.Protocol
		if protoB == "" {
			protoB = "tcp"
		}
		if pa.Host != hostB || pa.Container != pb.Container || pa.Protocol != protoB {
			return false
		}
	}
	return true
}

func sameVolumes(a, b customSpec) bool {
	return slices.Equal(a.Volumes, b.Volumes)
}

func sameEnv(a, b customSpec) bool {
	var bb []string
	for _, e := range b.Env {
		if strings.TrimSpace(e.Key) != "" {
			bb = append(bb, strings.TrimSpace(e.Key)+"="+e.Value)
		}
	}
	var aa []string
	for _, e := range a.Env {
		aa = append(aa, e.Key+"="+e.Value)
	}
	return slices.Equal(aa, bb)
}

func sameDevices(a, b customSpec) bool {
	return slices.Equal(a.Devices, b.Devices)
}

// ----- App details (title, icon, web UI) -----

// applyMeta stores the Dock details: in the x-casaos block when the file has one (CasaOS reads
// it too), and as temanlabs.* labels on every service otherwise.
func applyMeta(d *composeDoc, m customMeta) {
	hasLabels := false
	for _, name := range d.serviceNames() {
		if l := mapGet(d.service(name), "labels"); l != nil && (mapGet(l, labelName) != nil || mapGet(l, labelTemanLabs) != nil) {
			hasLabels = true
		}
	}
	if x := mapGet(d.top(), "x-casaos"); x != nil && x.Kind == yaml.MappingNode {
		if m.title != "" {
			mapSet(ensureMap(x, "title"), "custom", strNode(m.title))
		}
		if m.icon != "" {
			mapSet(x, "icon", strNode(m.icon))
		}
		if m.port > 0 {
			mapSet(x, "port_map", strNode(strconv.Itoa(m.port)))
			mapSet(x, "scheme", strNode(m.scheme))
			mapSet(x, "index", strNode(m.path))
		} else {
			mapDel(x, "port_map")
		}
		if !hasLabels {
			return
		}
	}
	for _, name := range d.serviceNames() {
		svc := d.service(name)
		if svc == nil {
			continue
		}
		labels := mapGet(svc, "labels")
		if labels != nil && labels.Kind == yaml.SequenceNode {
			// "key=value" list: convert to a mapping so entries can be replaced.
			m := &yaml.Node{Kind: yaml.MappingNode, Tag: "!!map"}
			for _, l := range labels.Content {
				k, v, _ := strings.Cut(l.Value, "=")
				m.Content = append(m.Content, strNode(k), strNode(v))
			}
			mapSet(svc, "labels", m)
			labels = m
		}
		if labels == nil {
			labels = ensureMap(svc, "labels")
		}
		set := func(k, v string) {
			if v == "" {
				mapDel(labels, k)
			} else {
				mapSet(labels, k, strNode(v))
			}
		}
		set(labelName, m.title)
		set(labelIcon, m.icon)
		if m.port > 0 {
			set(labelPort, strconv.Itoa(m.port))
			set(labelScheme, m.scheme)
			set(labelPath, m.path)
		} else {
			set(labelPort, "")
			set(labelScheme, "")
			set(labelPath, "")
		}
	}
}

// bindSources lists the absolute host paths a compose file mounts, for "delete app data".
func (d *composeDoc) bindSources() []string {
	var out []string
	for _, name := range d.serviceNames() {
		vols := mapGet(d.service(name), "volumes")
		if vols == nil {
			continue
		}
		for _, n := range vols.Content {
			if host, _, _, ok := readVolume(n); ok && strings.HasPrefix(host, "/") {
				out = append(out, host)
			}
		}
	}
	sort.Strings(out)
	return slices.Compact(out)
}
