package main

import (
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"slices"
	"strings"
	"testing"
)

// makeVideo writes a few seconds of a test picture with sound (rotate: as a phone's upright video).
func makeVideo(t *testing.T, dir, name, size, rate string, rotate bool) string {
	t.Helper()
	if _, err := exec.LookPath("ffmpeg"); err != nil {
		t.Skip("ffmpeg isn't installed")
	}
	path := filepath.Join(dir, name)
	args := []string{"-hide_banner", "-loglevel", "error", "-y", "-f", "lavfi", "-i", "testsrc2=size=" + size + ":rate=" + rate,
		"-f", "lavfi", "-i", "sine=frequency=440", "-t", "4", "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p", "-c:a", "aac"}
	made := path
	if rotate {
		made = path + ".flat.mp4"
	}
	if out, err := exec.Command("ffmpeg", append(args, made)...).CombinedOutput(); err != nil {
		t.Fatalf("ffmpeg: %v %s", err, out)
	}
	if rotate {
		// Marked to be turned on playing, as a phone does.
		if out, err := exec.Command("ffmpeg", "-hide_banner", "-loglevel", "error", "-y", "-display_rotation:v:0", "90", "-i", made, "-c", "copy", path).CombinedOutput(); err != nil {
			t.Fatalf("ffmpeg: %v %s", err, out)
		}
	}
	return path
}

func TestProbeVideo(t *testing.T) {
	dir := t.TempDir()
	p, err := probeVideo(t.Context(), makeVideo(t, dir, "wide.mp4", "1920x1080", "60", false))
	if err != nil {
		t.Fatal(err)
	}
	if p.Width != 1920 || p.Height != 1080 || p.FPS != 60 || p.Duration < 3.9 {
		t.Errorf("probe %+v", p)
	}
	if !slices.Equal(p.Qualities, []int{360, 480, 720}) {
		t.Errorf("qualities %v, want those below 1080", p.Qualities)
	}
	// A phone's upright video: its shorter side is what's sized.
	up, err := probeVideo(t.Context(), makeVideo(t, dir, "upright.mp4", "1280x720", "30", true))
	if err != nil {
		t.Fatal(err)
	}
	if up.Width != 720 || up.Height != 1280 || !slices.Equal(up.Qualities, []int{360, 480}) {
		t.Errorf("upright %+v", up)
	}
}

func TestTranscodeArgs(t *testing.T) {
	p := mediaProbe{Width: 1920, Height: 1080, FPS: 60}
	args := strings.Join(transcodeArgs("/v.mp4", p, 720, 90, "x264"), " ")
	for _, want := range []string{"-ss 90.000 -i /v.mp4", "fps=30,scale=-2:720", "-b:v 2500k", "frag_keyframe+empty_moov"} {
		if !strings.Contains(args, want) {
			t.Errorf("missing %q in %s", want, args)
		}
	}
	// 1080p keeps 60 frames a second, with the bitrate for them.
	if a := strings.Join(transcodeArgs("/v.mp4", mediaProbe{Width: 3840, Height: 2160, FPS: 60}, 1080, 0, "x264"), " "); strings.Contains(a, "fps=30") || !strings.Contains(a, "-b:v 6750k") || strings.Contains(a, "-ss") {
		t.Errorf("1080p60: %s", a)
	}
	up := strings.Join(transcodeArgs("/v.mp4", mediaProbe{Width: 1080, Height: 1920, FPS: 30}, 480, 0, "vaapi"), " ")
	if !strings.Contains(up, "scale_vaapi=w=480:h=-2") || !strings.Contains(up, "h264_vaapi") {
		t.Errorf("upright on the GPU: %s", up)
	}
}

func TestMediaTranscode(t *testing.T) {
	dir := t.TempDir()
	src := makeVideo(t, dir, "wide.mp4", "1920x1080", "60", false)
	s := &server{cfg: &Config{Root: "/", StateDir: t.TempDir()}}
	srv := httptest.NewServer(http.HandlerFunc(s.handleMediaTranscode))
	defer srv.Close()

	resp, err := http.Get(srv.URL + "?height=720&start=1&path=" + src)
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK || resp.Header.Get("Content-Type") != "video/mp4" {
		body, _ := io.ReadAll(resp.Body)
		t.Fatalf("status %d %s", resp.StatusCode, body)
	}
	out := filepath.Join(dir, "out.mp4")
	f, _ := os.Create(out)
	_, _ = io.Copy(f, resp.Body)
	f.Close()
	p, err := probeVideo(t.Context(), out)
	if err != nil {
		t.Fatal(err)
	}
	if p.Height != 720 || p.Width != 1280 || p.FPS != 30 {
		t.Errorf("converted %+v, want 1280x720 at 30 fps", p)
	}

	if resp, _ := http.Get(srv.URL + "?height=999&path=" + src); resp.StatusCode != http.StatusBadRequest {
		t.Errorf("odd size: %d", resp.StatusCode)
	}
}
