package main

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
)

func trashServer(t *testing.T) (*server, string) {
	t.Helper()
	state := t.TempDir()
	return &server{cfg: &Config{Root: "/", StateDir: state}, meta: newFileMeta(state)}, t.TempDir()
}

func call(t *testing.T, h http.HandlerFunc, method, target string, body any) *httptest.ResponseRecorder {
	t.Helper()
	var buf bytes.Buffer
	if body != nil {
		_ = json.NewEncoder(&buf).Encode(body)
	}
	w := httptest.NewRecorder()
	h(w, httptest.NewRequest(method, target, &buf))
	return w
}

func TestTrashMoveListRestore(t *testing.T) {
	s, dir := trashServer(t)
	file := filepath.Join(dir, "notes.txt")
	if err := os.WriteFile(file, []byte("hi"), 0o644); err != nil {
		t.Fatal(err)
	}
	if w := call(t, s.handleMoveToTrash, "POST", "/api/trash", map[string]any{"paths": []string{file}}); w.Code != http.StatusNoContent {
		t.Fatalf("trash: %d %s", w.Code, w.Body)
	}
	if _, err := os.Stat(file); !os.IsNotExist(err) {
		t.Fatalf("file still there: %v", err)
	}
	items := s.trashItems()
	if len(items) != 1 || items[0].Name != "notes.txt" || items[0].From != dir || items[0].Size != 2 {
		t.Fatalf("items = %+v", items)
	}

	// The name was taken while it was in the Trash: it comes back as "notes 2.txt".
	_ = os.WriteFile(file, []byte("new"), 0o644)
	w := call(t, s.handleTrashRestore, "POST", "/api/trash/restore", map[string]any{"ids": []string{items[0].ID}})
	if w.Code != http.StatusOK {
		t.Fatalf("restore: %d %s", w.Code, w.Body)
	}
	if data, err := os.ReadFile(filepath.Join(dir, "notes 2.txt")); err != nil || string(data) != "hi" {
		t.Fatalf("restored = %q, %v", data, err)
	}
	if len(s.trashItems()) != 0 {
		t.Fatal("trash not empty after restore")
	}
}

func TestTrashRestoreMakesFolderAndEmpty(t *testing.T) {
	s, dir := trashServer(t)
	sub := filepath.Join(dir, "a", "b")
	_ = os.MkdirAll(sub, 0o755)
	_ = os.WriteFile(filepath.Join(sub, "x.bin"), []byte("x"), 0o644)
	_ = os.WriteFile(filepath.Join(dir, "y.bin"), []byte("y"), 0o644)
	if err := s.moveToTrash(filepath.Join(sub, "x.bin")); err != nil {
		t.Fatal(err)
	}
	if err := s.moveToTrash(filepath.Join(dir, "y.bin")); err != nil {
		t.Fatal(err)
	}
	_ = os.RemoveAll(filepath.Join(dir, "a"))
	var x string
	for _, it := range s.trashItems() {
		if it.Name == "x.bin" {
			x = it.ID
		}
	}
	if w := call(t, s.handleTrashRestore, "POST", "/", map[string]any{"ids": []string{x}}); w.Code != http.StatusOK {
		t.Fatalf("restore: %d %s", w.Code, w.Body)
	}
	if _, err := os.Stat(filepath.Join(sub, "x.bin")); err != nil {
		t.Fatal("folder not made again:", err)
	}
	if w := call(t, s.handleEmptyTrash, "DELETE", "/api/trash", nil); w.Code != http.StatusNoContent {
		t.Fatalf("empty: %d", w.Code)
	}
	if n := len(s.trashItems()); n != 0 {
		t.Fatalf("%d left after emptying", n)
	}
}

func TestTrashRefusesProtectedAndBadIDs(t *testing.T) {
	s, _ := trashServer(t)
	if err := s.moveToTrash("/etc"); err == nil {
		t.Fatal("moved /etc to the Trash")
	}
	if _, _, err := s.findTrash("../../etc/passwd"); err == nil {
		t.Fatal("found a bad id")
	}
}

func TestMountOf(t *testing.T) {
	mounts := []string{"/DATA/HDD", "/DATA", "/"}
	for path, want := range map[string]string{"/DATA/HDD/a": "/DATA/HDD", "/DATA/HDDX": "/DATA", "/DATA": "/DATA", "/etc/x": "/"} {
		if got := mountOf(path, mounts); got != want {
			t.Errorf("mountOf(%s) = %s, want %s", path, got, want)
		}
	}
}

func TestTagsFollowMoves(t *testing.T) {
	s, dir := trashServer(t)
	_ = os.MkdirAll(filepath.Join(dir, "photos"), 0o755)
	inner := filepath.Join(dir, "photos", "cat.jpg")
	_ = os.WriteFile(inner, []byte("j"), 0o644)
	if w := call(t, s.handleSetTags, "PUT", "/", map[string]any{"paths": []string{inner}, "tags": []string{"blue", "nope", "red"}}); w.Code != http.StatusNoContent {
		t.Fatalf("tag: %d %s", w.Code, w.Body)
	}
	if got := s.meta.Tags[inner]; len(got) != 2 || got[0] != "red" || got[1] != "blue" {
		t.Fatalf("tags = %v", got)
	}
	_ = os.Rename(filepath.Join(dir, "photos"), filepath.Join(dir, "pics"))
	s.meta.moved(filepath.Join(dir, "photos"), filepath.Join(dir, "pics"))
	w := call(t, s.handleTagged, "GET", "/api/files/tagged?tag=red", nil)
	var list []placedEntry
	_ = json.Unmarshal(w.Body.Bytes(), &list)
	if len(list) != 1 || list[0].Path != filepath.Join(dir, "pics", "cat.jpg") {
		t.Fatalf("tagged = %s", w.Body)
	}
	// Saved, and read back by the next start.
	if again := newFileMeta(s.cfg.StateDir); len(again.Tags) != 1 {
		t.Fatalf("not saved: %v", again.Tags)
	}
}
