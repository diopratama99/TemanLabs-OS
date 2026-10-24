package main

import (
	"bufio"
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestGuacRoundTrip(t *testing.T) {
	// Lengths count characters: "héllo" is 5, not 6 bytes.
	stream := string(guacEncode("select", "vnc")) + string(guacEncode("clipboard", "héllo, 世界;")) + string(guacEncode("", "ping", "123"))
	gr := &guacReader{r: bufio.NewReader(strings.NewReader(stream))}
	want := [][]string{{"select", "vnc"}, {"clipboard", "héllo, 世界;"}, {"", "ping", "123"}}
	var raws []byte
	for _, w := range want {
		raw, elems, err := gr.next()
		if err != nil {
			t.Fatal(err)
		}
		raws = append(raws, raw...)
		if strings.Join(elems, "|") != strings.Join(w, "|") {
			t.Fatalf("got %q, want %q", elems, w)
		}
	}
	if string(raws) != stream {
		t.Fatalf("raw text changed: %q", raws)
	}
	if string(guacEncode("size", "1280", "720")) != "4.size,4.1280,3.720;" {
		t.Fatal("bad encoding")
	}
	if _, _, err := (&guacReader{r: bufio.NewReader(strings.NewReader("4.sizeX"))}).next(); err == nil {
		t.Fatal("malformed instruction accepted")
	}
}

func TestMagicPacket(t *testing.T) {
	p, err := magicPacket("9c:6b:00:68:7d:27")
	if err != nil || len(p) != 102 {
		t.Fatalf("len %d, err %v", len(p), err)
	}
	if !bytes.Equal(p[:6], bytes.Repeat([]byte{0xff}, 6)) || !bytes.Equal(p[96:], []byte{0x9c, 0x6b, 0x00, 0x68, 0x7d, 0x27}) {
		t.Fatal("bad packet")
	}
	if _, err := magicPacket("nope"); err == nil {
		t.Fatal("bad MAC accepted")
	}
}

func TestDeviceNormalize(t *testing.T) {
	d := device{Name: " PC ", Kind: "windows", Host: "192.168.1.11", MAC: "9C-6B-00-68-7D-27", Protocol: "vnc"}
	if err := d.normalize(); err != nil {
		t.Fatal(err)
	}
	if d.Name != "PC" || d.MAC != "9c:6b:00:68:7d:27" || d.Port != 5900 {
		t.Fatalf("got %+v", d)
	}
	for _, host := range []string{"", "-c 1", "a b", "x;rm"} {
		bad := device{Name: "x", Host: host}
		if bad.normalize() == nil {
			t.Fatalf("host %q accepted", host)
		}
	}
	wake := device{Name: "x", Host: "pc.lan", Protocol: "ssh", Port: 22}
	if err := wake.normalize(); err != nil || wake.Protocol != "" || wake.Port != 0 {
		t.Fatalf("got %+v, %v", wake, err)
	}
}

func TestDeviceViewHidesPassword(t *testing.T) {
	data, _ := json.Marshal(device{ID: "a", Name: "Mac", Password: "secret"}.view())
	if strings.Contains(string(data), "secret") || !strings.Contains(string(data), `"hasPassword":true`) {
		t.Fatalf("got %s", data)
	}
	var in deviceInput
	_ = json.Unmarshal([]byte(`{"name":"x","password":"new"}`), &in)
	if in.Password == nil || *in.Password != "new" {
		t.Fatal("password not read")
	}
}

func TestGuessKind(t *testing.T) {
	cases := map[string][]int{"windows": {135, 445}, "mac": {5000, 7000}, "linux": {22}, "other": nil}
	for want, ports := range cases {
		if got := guessKind(ports); got != want {
			t.Errorf("%v: got %s, want %s", ports, got, want)
		}
	}
}

func TestParsePTRAnswer(t *testing.T) {
	// A reply to "2.1.168.192.in-addr.arpa PTR" naming "Dios-Mac.local", with the answer's
	// name compressed to point at the question.
	q := []byte{1, '2', 1, '1', 3, '1', '6', '8', 3, '1', '9', '2', 7, 'i', 'n', '-', 'a', 'd', 'd', 'r', 4, 'a', 'r', 'p', 'a', 0}
	msg := []byte{0, 0, 0x84, 0, 0, 1, 0, 1, 0, 0, 0, 0}
	msg = append(msg, q...)
	msg = append(msg, 0, 12, 0, 1)
	rdata := []byte{8, 'D', 'i', 'o', 's', '-', 'M', 'a', 'c', 5, 'l', 'o', 'c', 'a', 'l', 0}
	msg = append(msg, 0xc0, 12, 0, 12, 0, 1, 0, 0, 0, 10, 0, byte(len(rdata)))
	msg = append(msg, rdata...)
	if got := cleanHostName(parsePTRAnswer(msg)); got != "Dios-Mac" {
		t.Fatalf("got %q", got)
	}
	if parsePTRAnswer(msg[:20]) != "" {
		t.Fatal("truncated reply parsed")
	}
}

func TestParseNodeStatus(t *testing.T) {
	// A reply with a group name first (WORKGROUP), then the computer's name.
	msg := []byte{0, 1, 0x84, 0, 0, 0, 0, 1, 0, 0, 0, 0, 32}
	msg = append(msg, []byte("CKAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA")...)
	msg = append(msg, 0, 0, 0x21, 0, 1, 0, 0, 0, 0, 0, 37, 2)
	entry := func(name string, suffix byte, flags uint16) []byte {
		e := []byte(name + strings.Repeat(" ", 15-len(name)))
		return append(e, suffix, byte(flags>>8), byte(flags))
	}
	msg = append(msg, entry("WORKGROUP", 0, 0x8400)...)
	msg = append(msg, entry("DESKTOP-4K2P", 0, 0x0400)...)
	if got := parseNodeStatus(msg); got != "DESKTOP-4K2P" {
		t.Fatalf("got %q", got)
	}
	if parseNodeStatus(msg[:30]) != "" {
		t.Fatal("truncated reply parsed")
	}
}

func TestRedirectTo(t *testing.T) {
	cases := []struct{ addr, host, want string }{
		{":80", "100.106.53.46:7700", "http://100.106.53.46/#/x?y=1"},
		{":8080", "serverdio:7700", "http://serverdio:8080/#/x?y=1"},
		{":80", "[fd7a::1]:7700", "http://[fd7a::1]/#/x?y=1"},
	}
	for _, c := range cases {
		rec := httptest.NewRecorder()
		req := httptest.NewRequest(http.MethodGet, "http://"+c.host+"/%23/x?y=1", nil)
		req.Host = c.host
		redirectTo(c.addr).ServeHTTP(rec, req)
		if got := rec.Header().Get("Location"); got != strings.Replace(c.want, "#", "%23", 1) {
			t.Errorf("%s via %s: got %q", c.host, c.addr, got)
		}
	}
}
