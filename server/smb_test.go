package main

import (
	"context"
	"encoding/json"
	"testing"
)

// A server with no Samba yet (no users, no shares) still sends lists, never null: the File
// Sharing window reads their length.
func TestSmbListsAreNeverNull(t *testing.T) {
	ctx := context.Background()
	for name, v := range map[string]any{"users": listSmbUsers(ctx), "shares": listShares()} {
		b, err := json.Marshal(v)
		if err != nil {
			t.Fatal(err)
		}
		if string(b) == "null" {
			t.Errorf("%s: got null, want a list", name)
		}
	}
}
