package main

import (
	"strings"
	"testing"
)

func TestComposeWithRestart(t *testing.T) {
	in := `# my app
services:
    web:
        image: nginx
        restart: unless-stopped
    db:
        image: postgres # the database
`
	out, err := composeWithRestart([]byte(in), "no")
	if err != nil {
		t.Fatal(err)
	}
	s := string(out)
	if strings.Count(s, "restart: \"no\"")+strings.Count(s, "restart: 'no'")+strings.Count(s, "restart: no") != 2 {
		t.Fatalf("restart not set on both services:\n%s", s)
	}
	if strings.Contains(s, "unless-stopped") {
		t.Fatalf("old policy left:\n%s", s)
	}
	if !strings.Contains(s, "# my app") || !strings.Contains(s, "# the database") || !strings.Contains(s, "    web:") {
		t.Fatalf("comments or indentation lost:\n%s", s)
	}
}
