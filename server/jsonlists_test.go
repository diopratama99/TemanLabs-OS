package main

import (
	"encoding/json"
	"testing"
	"time"
)

func TestResponsesSendEmptyLists(t *testing.T) {
	type item struct {
		Name string   `json:"name"`
		Tags []string `json:"tags"`
		Opt  []string `json:"opt,omitempty"`
	}
	type reply struct {
		Items  []item           `json:"items"`
		Ptr    *item            `json:"ptr"`
		Nested map[string][]int `json:"nested"`
		Raw    json.RawMessage  `json:"raw,omitempty"`
		When   time.Time        `json:"when"`
		hidden []int
	}
	when := time.Date(2026, 10, 26, 12, 0, 0, 0, time.UTC)
	cases := []struct {
		in   any
		want string
	}{
		{reply{When: when}, `{"items":[],"ptr":null,"nested":null,"when":"2026-10-26T12:00:00Z"}`},
		{reply{Items: []item{{Name: "a"}}, Ptr: &item{Name: "b"}, Nested: map[string][]int{"x": nil}, When: when},
			`{"items":[{"name":"a","tags":[]}],"ptr":{"name":"b","tags":[]},"nested":{"x":[]},"when":"2026-10-26T12:00:00Z"}`},
		{map[string]any{"users": []string(nil), "count": 0}, `{"count":0,"users":[]}`},
		{[]item(nil), `[]`},
		{map[string]string{"error": "x"}, `{"error":"x"}`},
		{nil, `null`},
	}
	for _, c := range cases {
		b, err := json.Marshal(withLists(c.in))
		if err != nil {
			t.Fatal(err)
		}
		if string(b) != c.want {
			t.Errorf("got %s\nwant %s", b, c.want)
		}
	}
	// The original is left as it was.
	orig := reply{}
	_ = withLists(orig)
	if orig.Items != nil {
		t.Error("withLists changed its input")
	}
}
