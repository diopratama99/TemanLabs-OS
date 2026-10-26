package main

import "testing"

func TestNewerVersion(t *testing.T) {
	cases := []struct {
		latest, current string
		want            bool
	}{
		{"v0.3.4", "v0.3.3", true},
		{"v0.3.3", "v0.3.4", false},
		{"v0.3.4", "v0.3.4", false},
		{"v0.3.4-beta", "v0.3.3", true},
		// The release after its beta is an update; the beta after its release isn't.
		{"v0.3.4", "v0.3.4-beta", true},
		{"v0.3.4-beta", "v0.3.4", false},
		{"v0.3.4-beta.2", "v0.3.4-beta.1", true},
		{"v0.3.4-beta.10", "v0.3.4-beta.2", true},
		{"v0.3.4-beta.1", "v0.3.4-beta", true},
		{"v0.3.4-rc.1", "v0.3.4-beta.3", true},
		{"v0.3.4-beta", "v0.3.4-beta", false},
		{"v0.3.5-beta", "v0.3.4", true},
		// A local build (git describe) can always update; a tag that isn't a version never offers one.
		{"v0.3.4-beta", "v0.3.3-1-g4638ab0-dirty", true},
		{"nightly", "v0.3.3", false},
	}
	for _, c := range cases {
		if got := newer(c.latest, c.current); got != c.want {
			t.Errorf("newer(%q, %q) = %v, want %v", c.latest, c.current, got, c.want)
		}
	}
}
