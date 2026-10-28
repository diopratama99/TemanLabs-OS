package main

import (
	"os"
	"os/exec"
	"path/filepath"
	"slices"
	"strings"
	"testing"
)

func TestRecordingToMP4KeepsVideoAndSoundOnly(t *testing.T) {
	args := recordingToMP4("in.ts", "out.mp4")
	if slices.Contains(args, "0") || !strings.Contains(strings.Join(args, " "), "-map 0:v? -map 0:a? -c copy") {
		t.Errorf("args %v", args)
	}
	// TL_TS_SAMPLE: a real recording (with its timed ID3 stream) to convert.
	sample := os.Getenv("TL_TS_SAMPLE")
	if sample == "" {
		return
	}
	out := filepath.Join(t.TempDir(), "out.mp4")
	if msg, err := exec.Command("ffmpeg", recordingToMP4(sample, out)...).CombinedOutput(); err != nil {
		t.Fatalf("ffmpeg: %v %s", err, msg)
	}
	probe, _ := exec.Command("ffprobe", "-v", "error", "-show_entries", "stream=codec_type", "-of", "csv=p=0", out).Output()
	if got := strings.Fields(string(probe)); !slices.Contains(got, "video") || !slices.Contains(got, "audio") {
		t.Errorf("streams %v", got)
	}
}
