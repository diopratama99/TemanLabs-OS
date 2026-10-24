package main

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// A typical Blu-ray rip: H.264 video, DTS sound, a cover picture, one picture-based and one text
// subtitle, and a font.
func ripProbe() *probeResult {
	return &probeResult{Duration: 60, Streams: []probeStream{
		{Index: 0, Type: "video", Codec: "h264"},
		{Index: 1, Type: "audio", Codec: "dts"},
		{Index: 2, Type: "subtitle", Codec: "hdmv_pgs_subtitle"},
		{Index: 3, Type: "subtitle", Codec: "subrip"},
		{Index: 4, Type: "attachment", Codec: "ttf"},
		{Index: 5, Type: "video", Codec: "mjpeg", Cover: true},
	}}
}

var allEncoders = map[string]bool{"libx264": true, "libx265": true, "libvpx-vp9": true, "aac": true, "libopus": true, "libmp3lame": true, "flac": true}

func TestRemuxToMP4NeedsNewSound(t *testing.T) {
	p := ripProbe()
	_, err := ffmpegArgs(p, convertRequest{Container: "mp4", Video: "copy", Audio: "copy", Subtitles: true}, allEncoders)
	if err == nil || !strings.Contains(err.Error(), "DTS sound") {
		t.Fatalf("want a DTS error, got %v", err)
	}
	args, err := ffmpegArgs(p, convertRequest{Container: "mp4", Video: "copy", Audio: "aac", Quality: "medium", Subtitles: true}, allEncoders)
	if err != nil {
		t.Fatal(err)
	}
	got := strings.Join(args, " ")
	for _, want := range []string{"-map 0:0", "-map 0:1", "-map 0:3", "-c:v copy", "-c:a aac -b:a 192k", "-c:s:0 mov_text", "-movflags +faststart", "-f mp4"} {
		if !strings.Contains(got, want) {
			t.Errorf("missing %q in %s", want, got)
		}
	}
	// No cover picture, no Blu-ray subtitle, no font in an MP4.
	for _, unwanted := range []string{"0:2", "0:4", "0:5"} {
		if strings.Contains(got, unwanted) {
			t.Errorf("unexpected %q in %s", unwanted, got)
		}
	}
}

func TestRemuxToMKVKeepsEverything(t *testing.T) {
	p := ripProbe()
	p.Streams[3].Codec = "mov_text"
	args, err := ffmpegArgs(p, convertRequest{Container: "mkv", Video: "copy", Audio: "copy", Subtitles: true}, allEncoders)
	if err != nil {
		t.Fatal(err)
	}
	got := strings.Join(args, " ")
	for _, want := range []string{"-map 0:2", "-map 0:3", "-map 0:4", "-c:s:0 copy", "-c:s:1 srt", "-c:t copy", "-f matroska"} {
		if !strings.Contains(got, want) {
			t.Errorf("missing %q in %s", want, got)
		}
	}
}

func TestWebMNeedsConverting(t *testing.T) {
	p := ripProbe()
	if _, err := ffmpegArgs(p, convertRequest{Container: "webm", Video: "copy", Audio: "opus"}, allEncoders); err == nil {
		t.Fatal("H.264 can't be copied into WebM")
	}
	if _, err := ffmpegArgs(p, convertRequest{Container: "webm", Video: "h264", Audio: "opus"}, allEncoders); err == nil {
		t.Fatal("H.264 can't be made for WebM")
	}
	args, err := ffmpegArgs(p, convertRequest{Container: "webm", Video: "vp9", Audio: "opus", Quality: "small", Height: 720}, allEncoders)
	if err != nil {
		t.Fatal(err)
	}
	got := strings.Join(args, " ")
	for _, want := range []string{"-c:v libvpx-vp9 -crf 38", "scale=-2:'min(720,ih)'", "-c:a libopus -b:a 96k"} {
		if !strings.Contains(got, want) {
			t.Errorf("missing %q in %s", want, got)
		}
	}
}

func TestSoundOnly(t *testing.T) {
	p := ripProbe()
	args, err := ffmpegArgs(p, convertRequest{Container: "mp3", Audio: "mp3", Quality: "high"}, allEncoders)
	if err != nil {
		t.Fatal(err)
	}
	got := strings.Join(args, " ")
	if strings.Contains(got, "0:0") || !strings.Contains(got, "-map 0:1") || !strings.Contains(got, "-q:a 0") {
		t.Errorf("unexpected %s", got)
	}
	if _, err := ffmpegArgs(p, convertRequest{Container: "mp3", Audio: "none"}, allEncoders); err == nil {
		t.Error("an MP3 without sound must be refused")
	}
}

func TestMissingEncoder(t *testing.T) {
	_, err := ffmpegArgs(ripProbe(), convertRequest{Container: "mkv", Video: "av1", Audio: "copy"}, allEncoders)
	if err == nil || !strings.Contains(err.Error(), "can’t make AV1") {
		t.Fatalf("want a missing-encoder error, got %v", err)
	}
}

func TestRemuxToTS(t *testing.T) {
	p := ripProbe()
	if _, err := ffmpegArgs(p, convertRequest{Container: "ts", Video: "copy", Audio: "copy", Subtitles: true}, allEncoders); err != nil {
		t.Fatalf("H.264 + DTS fit in TS as they are: %v", err)
	}
	args, _ := ffmpegArgs(p, convertRequest{Container: "ts", Video: "copy", Audio: "copy", Subtitles: true}, allEncoders)
	got := strings.Join(args, " ")
	if !strings.Contains(got, "-f mpegts") || strings.Contains(got, "0:3") || strings.Contains(got, "movflags") {
		t.Errorf("unexpected %s", got)
	}
	if _, err := ffmpegArgs(p, convertRequest{Container: "ts", Video: "vp9", Audio: "copy"}, allEncoders); err == nil {
		t.Error("VP9 can't go into TS")
	}
}

func TestIsMPEGTS(t *testing.T) {
	dir := t.TempDir()
	write := func(name string, data []byte) string {
		p := filepath.Join(dir, name)
		if err := os.WriteFile(p, data, 0o600); err != nil {
			t.Fatal(err)
		}
		return p
	}
	stream := make([]byte, 188*400)
	for i := 0; i < len(stream); i += 188 {
		stream[i] = 0x47
	}
	bluray := make([]byte, 192*400)
	for i := 4; i < len(bluray); i += 192 {
		bluray[i] = 0x47
	}
	code := []byte(strings.Repeat("Generic<T> = { value: T }\n", 4000)) // starts with a G (0x47) too
	small := append([]byte{}, stream[:188*3]...)
	for name, want := range map[string]bool{
		write("movie.ts", stream): true,
		write("disc.ts", bluray):  true,
		write("types.ts", code):   false,
		write("tiny.ts", small):   false,
	} {
		info, _ := os.Stat(name)
		if got := isMPEGTS(name, info.Size()); got != want {
			t.Errorf("%s: got %v, want %v", filepath.Base(name), got, want)
		}
	}
}

// ffmpeg's last MP4 pass reads its own output from the start while writing it; the read
// handle's position is the progress. The write handle doesn't count.
func TestFinalPassProgress(t *testing.T) {
	part := filepath.Join(t.TempDir(), ".film.mp4.temanlabs-part")
	if err := os.WriteFile(part, make([]byte, 1<<20), 0o600); err != nil {
		t.Fatal(err)
	}
	w, err := os.OpenFile(part, os.O_WRONLY, 0)
	if err != nil {
		t.Fatal(err)
	}
	defer w.Close()
	if _, ok := finalPassProgress(os.Getpid(), part); ok {
		t.Fatal("only a write handle: not in the last pass yet")
	}
	r, err := os.Open(part)
	if err != nil {
		t.Fatal(err)
	}
	defer r.Close()
	if _, err := r.Seek(1<<19, 0); err != nil {
		t.Fatal(err)
	}
	if f, ok := finalPassProgress(os.Getpid(), part); !ok || f < 0.49 || f > 0.51 {
		t.Fatalf("got %v, %v; want about 0.5", f, ok)
	}
}
