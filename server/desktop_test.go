package main

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestDesktopLook(t *testing.T) {
	s := &server{cfg: &Config{StateDir: t.TempDir()}}
	get := func() desktopLook {
		w := httptest.NewRecorder()
		s.handleGetDesktop(w, httptest.NewRequest("GET", "/api/desktop", nil))
		var look desktopLook
		_ = json.NewDecoder(w.Body).Decode(&look)
		return look
	}
	put := func(body string) int {
		w := httptest.NewRecorder()
		s.handleSetDesktop(w, httptest.NewRequest("PUT", "/api/desktop", strings.NewReader(body)))
		return w.Code
	}
	if look := get(); !look.Updated.IsZero() || look.Custom != nil {
		t.Errorf("before any choice: %+v", look)
	}
	for body, want := range map[string]int{
		`{"wallpaper":3,"customWallpaper":null,"customWallpaperPreview":null}`: http.StatusOK,
		`{"wallpaper":-1}`: http.StatusBadRequest,
		`{"wallpaper":0,"customWallpaper":"https://evil.example/x.jpg"}`: http.StatusBadRequest,
		`{"wallpaper":0,"customWallpaper":"/api/wallpapers/0123456789abcdef.jpg","customWallpaperPreview":{"url":"/api/wallpapers/other.jpg","data":"data:image/jpeg;base64,AA"}}`: http.StatusBadRequest,
		`{"wallpaper":0,"customWallpaper":"/api/wallpapers/0123456789abcdef.jpg","customWallpaperPreview":{"url":"/api/wallpapers/0123456789abcdef.jpg","data":"javascript:x"}}`:   http.StatusBadRequest,
	} {
		if code := put(body); code != want {
			t.Errorf("%s: %d, want %d", body, code, want)
		}
	}
	if code := put(`{"wallpaper":0,"customWallpaper":"/api/wallpapers/0123456789abcdef.jpg","customWallpaperPreview":{"url":"/api/wallpapers/0123456789abcdef.jpg","data":"data:image/jpeg;base64,AA"}}`); code != http.StatusOK {
		t.Fatalf("custom photo: %d", code)
	}
	look := get()
	if look.Custom == nil || *look.Custom != "/api/wallpapers/0123456789abcdef.jpg" || look.Preview == nil || look.Updated.IsZero() {
		t.Errorf("saved %+v", look)
	}
}
