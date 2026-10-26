package main

import (
	"strings"
	"testing"
)

func TestBrandOf(t *testing.T) {
	cases := map[string]struct{ brand, method string }{
		// A FiberHome ONT's start page (seen on an IndiHome-style modem).
		`XHR.get("get_operator", null, redirect); var url = "/html/login_inter.html"; sessionStorage.setItem("fh_access", "0")`: {"FiberHome", ""},
		// TP-Link and Mercusys share firmware; globalType tells them apart.
		`window.globalType="TP",window.globalURL="TP"==window.globalType?"http://tplinkrepeater.net":"http://mwlogin.net"`: {"TP-Link", ""},
		`window.globalType="MW",window.globalURL="TP"==window.globalType?"http://tplinkrepeater.net":"http://mwlogin.net"`: {"Mercusys", ""},
		`<title>RouterOS router configuration page</title>`:                                                                {"MikroTik", "mikrotik"},
		`<title>OpenWrt - LuCI</title>`:       {"OpenWrt", "ssh"},
		`<title>ZXHN F670L</title>`:           {"ZTE", ""},
		`<title>HG8245H5</title>`:             {"Huawei", ""},
		`<title>Synology DiskStation</title>`: {"", ""},
	}
	for page, want := range cases {
		brand, method, _ := brandOf(page)
		if brand != want.brand || method != want.method {
			t.Errorf("%.50s… = %q %q, want %q %q", page, brand, method, want.brand, want.method)
		}
	}
	if _, _, modem := brandOf("fh_access"); !modem {
		t.Error("a FiberHome ONT is a modem")
	}
}

func TestTracepathHops(t *testing.T) {
	out := ` 1?: [LOCALHOST]                      pmtu 1500
 1:  192.168.1.1                                           1.028ms
 1:  192.168.1.1                                           0.881ms
 2:  10.19.128.1                                          10.098ms
 3:  no reply
 4:  172.17.2.58                                          13.673ms
     Too many hops: pmtu 1500`
	var hops []string
	for _, line := range strings.Split(out, "\n") {
		if m := tracepathHop.FindStringSubmatch(line); m != nil {
			hops = append(hops, m[1])
		}
	}
	if got := strings.Join(hops, " "); got != "192.168.1.1 192.168.1.1 10.19.128.1 172.17.2.58" {
		t.Errorf("hops = %s", got)
	}
	if !privateIP("10.19.128.1") || privateIP("100.64.0.1") || privateIP("1.1.1.1") {
		t.Error("privateIP")
	}
}
