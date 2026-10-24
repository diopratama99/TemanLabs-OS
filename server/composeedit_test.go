package main

import (
	"strings"
	"testing"
)

const casaFile = `name: qbittorrent
services:
    qbittorrent:
        cpu_shares: 90
        container_name: qbittorrent
        deploy:
            resources:
                limits:
                    memory: "16652435456"
        environment:
            PGID: "1000"
            PUID: "1000"
        image: ghcr.io/hotio/qbittorrent:release-5.0.4
        network_mode: bridge
        ports:
            - target: 8080
              published: "8080"
              protocol: tcp
            - target: 6881
              published: "6881"
              protocol: udp
              host_ip: 0.0.0.0
        restart: unless-stopped
        volumes:
            - type: bind
              source: /DATA/AppData/qbittorrent/config
              target: /config
            - type: bind
              source: /DATA/Downloads
              target: /app/qBittorrent/downloads
x-casaos:
    main: qbittorrent
    port_map: "8080"
    title:
        en_us: qBittorrent
`

const userFile = `# My stack
services:
  web: # the site
    image: nginx:1.27 # pinned
    ports:
      - "8080:80"
      - "${ADMIN_PORT}:8081"
    volumes:
      - ./html:/usr/share/nginx/html:ro
  db:
    image: postgres:16
    environment:
      - POSTGRES_PASSWORD=secret
`

func TestReadCasaOS(t *testing.T) {
	d, err := parseComposeDoc([]byte(casaFile))
	if err != nil {
		t.Fatal(err)
	}
	if d.indent != 4 {
		t.Fatalf("indent %d", d.indent)
	}
	v := readService(d.service(d.mainService()))
	s := v.spec
	if s.Image != "ghcr.io/hotio/qbittorrent" || s.Tag != "release-5.0.4" {
		t.Fatalf("image %q tag %q", s.Image, s.Tag)
	}
	if len(s.Ports) != 1 || s.Ports[0].Host != 8080 || len(v.rawPorts) != 1 {
		t.Fatalf("ports %+v raw %d", s.Ports, len(v.rawPorts))
	}
	if len(s.Volumes) != 2 || s.Volumes[0].Host != "/DATA/AppData/qbittorrent/config" {
		t.Fatalf("volumes %+v", s.Volumes)
	}
	if s.MemoryMB != 15881 || !v.deployMemory || s.CPUShares != 90 || s.Network != "bridge" {
		t.Fatalf("mem %d deploy %v cpu %d net %q", s.MemoryMB, v.deployMemory, s.CPUShares, s.Network)
	}
	if got := appDataDirs(d.bindSources()); len(got) != 1 || got[0] != "/DATA/AppData/qbittorrent" {
		t.Fatalf("data dirs %v", got)
	}
}

func TestApplyKeepsUntouched(t *testing.T) {
	st := &appStore{}
	d, _ := parseComposeDoc([]byte(userFile))
	spec := readService(d.service("web")).spec
	changed, err := st.applyForm(d, "web", &spec, nil)
	if err != nil || changed {
		t.Fatalf("unchanged form: changed=%v err=%v", changed, err)
	}
	spec.Tag = "1.28"
	changed, err = st.applyForm(d, "web", &spec, nil)
	if err != nil || !changed {
		t.Fatalf("tag change: changed=%v err=%v", changed, err)
	}
	out, _ := d.bytes()
	text := string(out)
	for _, want := range []string{"# My stack", "# the site", "image: nginx:1.28", "${ADMIN_PORT}:8081", "./html:/usr/share/nginx/html:ro", "POSTGRES_PASSWORD=secret"} {
		if !strings.Contains(text, want) {
			t.Errorf("missing %q in:\n%s", want, text)
		}
	}
}

func TestApplyCasaOSPortsAndMeta(t *testing.T) {
	st := &appStore{}
	d, _ := parseComposeDoc([]byte(casaFile))
	spec := readService(d.service("qbittorrent")).spec
	spec.Ports[0].Host = 8099
	spec.Env = append(spec.Env, struct {
		Key   string `json:"key"`
		Value string `json:"value"`
	}{"TZ", "Asia/Jakarta"})
	spec.MemoryMB = 512
	// 8099 is "ours" so the free-port check passes even if something listens there.
	changed, err := st.applyForm(d, "qbittorrent", &spec, map[int]bool{8099: true})
	if err != nil || !changed {
		t.Fatalf("changed=%v err=%v", changed, err)
	}
	applyMeta(d, customMeta{title: "Torrents", port: 8099, scheme: "http", path: "/"})
	out, _ := d.bytes()
	text := string(out)
	for _, want := range []string{`- "8099:8080/tcp"`, "host_ip: 0.0.0.0", "TZ: Asia/Jakarta", "memory: 512M", "custom: Torrents", `port_map: "8099"`, "        image: ghcr.io/hotio/qbittorrent:release-5.0.4"} {
		if !strings.Contains(text, want) {
			t.Errorf("missing %q in:\n%s", want, text)
		}
	}
	if strings.Contains(text, "temanlabs.name") {
		t.Errorf("CasaOS file got labels:\n%s", text)
	}
	// The result must still parse and read back the same.
	d2, err := parseComposeDoc(out)
	if err != nil {
		t.Fatal(err)
	}
	back := readService(d2.service("qbittorrent")).spec
	if back.Ports[0].Host != 8099 || back.MemoryMB != 512 {
		t.Fatalf("read back %+v", back)
	}
}

func TestParseImageRef(t *testing.T) {
	cases := map[string][3]string{
		"nginx":                          {"registry-1.docker.io", "library/nginx", "latest"},
		"nginx:1.27-alpine":              {"registry-1.docker.io", "library/nginx", "1.27-alpine"},
		"n8nio/n8n:2.13.2":               {"registry-1.docker.io", "n8nio/n8n", "2.13.2"},
		"ghcr.io/hotio/qbittorrent:rel5": {"ghcr.io", "hotio/qbittorrent", "rel5"},
		"localhost:5000/app":             {"localhost:5000", "app", "latest"},
	}
	for in, want := range cases {
		h, r, tag, err := parseImageRef(in)
		if err != nil || h != want[0] || r != want[1] || tag != want[2] {
			t.Errorf("%s → %s %s %s %v", in, h, r, tag, err)
		}
	}
}
