package main

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestSameOriginBehindProxy(t *testing.T) {
	ok := sameOrigin(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(http.StatusNoContent) }))
	cases := []struct {
		name    string
		host    string
		origin  string
		headers map[string]string
		want    int
	}{
		{"same host", "192.168.1.10:7700", "http://192.168.1.10:7700", nil, http.StatusNoContent},
		{"no origin", "localhost:8080", "", nil, http.StatusNoContent},
		{"other site", "192.168.1.10:7700", "https://evil.example", nil, http.StatusForbidden},
		{"proxy that rewrites Host", "localhost:8080", "https://8080-abc.instabox.tech", map[string]string{"X-Forwarded-Host": "8080-abc.instabox.tech"}, http.StatusNoContent},
		{"proxy naming the default port", "localhost:8080", "https://box.example.net", map[string]string{"X-Forwarded-Host": "box.example.net:443, inner"}, http.StatusNoContent},
		{"Forwarded header", "127.0.0.1:8080", "https://box.example.net", map[string]string{"Forwarded": `for=1.2.3.4;host="box.example.net";proto=https`}, http.StatusNoContent},
		{"proxy for another site", "localhost:8080", "https://evil.example", map[string]string{"X-Forwarded-Host": "box.example.net"}, http.StatusForbidden},
	}
	for _, c := range cases {
		r := httptest.NewRequest("POST", "/api/login", nil)
		r.Host = c.host
		if c.origin != "" {
			r.Header.Set("Origin", c.origin)
		}
		for k, v := range c.headers {
			r.Header.Set(k, v)
		}
		w := httptest.NewRecorder()
		ok.ServeHTTP(w, r)
		if w.Code != c.want {
			t.Errorf("%s: %d, want %d (%s)", c.name, w.Code, c.want, w.Body.String())
		}
	}
}
