package main

import (
	"bufio"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"os/exec"
	"path/filepath"
	"slices"
	"strconv"
	"strings"
	"sync"
	"time"
)

// Playing a video at a lower resolution: ffmpeg turns it into H.264 at that size as it plays, so
// a phone on a slow or metered line gets 720p instead of the original. The picture comes as
// fragmented MP4, which plays as it arrives; it can't be seeked into, so seeking further than
// what's arrived starts a new one from there (the player keeps the time). The Intel or AMD GPU
// does the work when it can (VAAPI), the processor otherwise.

// The sizes offered: the shorter side, so a phone's upright video is sized like a landscape one.
var transcodeHeights = []int{360, 480, 720, 1080, 1440, 2160}

// Video bitrate (kb/s) at each size, at up to 30 frames a second; more frames get half as much again.
var transcodeRate = map[int]int{360: 700, 480: 1200, 720: 2500, 1080: 4500, 1440: 8000, 2160: 14000}

const (
	transcodeAudioKbps = 128
	// Converting is heavy: this many at once, each for one player.
	maxTranscodes = 2
)

var transcodeSlots = make(chan struct{}, maxTranscodes)

type mediaProbe struct {
	Duration float64 `json:"duration"`
	Width    int     `json:"width"`
	Height   int     `json:"height"`
	FPS      float64 `json:"fps"`
	// Bits a second of the whole file (for what an hour of it costs).
	Bitrate int64 `json:"bitrate"`
	// The sizes it can be played at, below its own.
	Qualities []int `json:"qualities"`
	// What converts: vaapi, x264, or "" when ffmpeg isn't there (only the original plays).
	Encoder string `json:"encoder"`
}

// transcodeEncoder is found once: the GPU if a short test encode works on it, else the processor.
var transcodeEncoder = sync.OnceValue(func() string {
	if _, err := exec.LookPath("ffmpeg"); err != nil {
		return ""
	}
	if fileExists(vaapiDevice) {
		ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
		defer cancel()
		err := exec.CommandContext(ctx, "ffmpeg", "-hide_banner", "-loglevel", "error", "-nostdin",
			"-init_hw_device", "vaapi=va:"+vaapiDevice, "-filter_hw_device", "va",
			"-f", "lavfi", "-i", "testsrc2=size=1280x720:rate=30", "-t", "1",
			"-vf", "format=nv12,hwupload,scale_vaapi=w=640:h=360", "-c:v", "h264_vaapi", "-f", "null", "-").Run()
		if err == nil {
			log.Printf("transcode: converting videos on the GPU (VAAPI)")
			return "vaapi"
		}
		log.Printf("transcode: the GPU can't convert (%v); the processor does", err)
	}
	return "x264"
})

const vaapiDevice = "/dev/dri/renderD128"

func (s *server) handleMediaProbe(w http.ResponseWriter, r *http.Request) {
	path, err := s.resolve(r.URL.Query().Get("path"))
	if err != nil {
		writeFSError(w, err)
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 20*time.Second)
	defer cancel()
	p, err := probeVideo(ctx, path)
	if err != nil {
		writeError(w, http.StatusUnprocessableEntity, err.Error())
		return
	}
	p.Encoder = transcodeEncoder()
	writeJSON(w, http.StatusOK, p)
}

// probeVideo reads a video's size, length and frame rate with ffprobe.
func probeVideo(ctx context.Context, path string) (mediaProbe, error) {
	out, err := exec.CommandContext(ctx, "ffprobe", "-v", "error", "-select_streams", "v:0",
		"-show_entries", "stream=width,height,avg_frame_rate,r_frame_rate:stream_side_data=rotation:stream_tags=rotate:format=duration,bit_rate",
		"-of", "json", path).Output()
	if err != nil {
		return mediaProbe{}, fmt.Errorf("couldn't read the video: %w", err)
	}
	var v struct {
		Streams []struct {
			Width, Height int
			AvgFrameRate  string `json:"avg_frame_rate"`
			RFrameRate    string `json:"r_frame_rate"`
			Tags          struct {
				Rotate string `json:"rotate"`
			} `json:"tags"`
			SideData []struct {
				Rotation float64 `json:"rotation"`
			} `json:"side_data_list"`
		} `json:"streams"`
		Format struct {
			Duration string `json:"duration"`
			BitRate  string `json:"bit_rate"`
		} `json:"format"`
	}
	if err := json.Unmarshal(out, &v); err != nil || len(v.Streams) == 0 {
		return mediaProbe{}, fmt.Errorf("no video in it")
	}
	st := v.Streams[0]
	p := mediaProbe{Width: st.Width, Height: st.Height}
	p.Duration, _ = strconv.ParseFloat(v.Format.Duration, 64)
	p.Bitrate, _ = strconv.ParseInt(v.Format.BitRate, 10, 64)
	p.FPS = frameRate(st.AvgFrameRate)
	if p.FPS == 0 {
		p.FPS = frameRate(st.RFrameRate)
	}
	// A phone's upright video is stored sideways with a note to turn it.
	rot := 0.0
	if r, err := strconv.ParseFloat(st.Tags.Rotate, 64); err == nil {
		rot = r
	}
	for _, sd := range st.SideData {
		if sd.Rotation != 0 {
			rot = sd.Rotation
		}
	}
	if int(rot)%180 != 0 {
		p.Width, p.Height = p.Height, p.Width
	}
	short := min(p.Width, p.Height)
	p.Qualities = []int{}
	for _, h := range transcodeHeights {
		// Below its own size, and enough below to be worth it (not 1080 for a 1088 one).
		if h < short-short/20 {
			p.Qualities = append(p.Qualities, h)
		}
	}
	return p, nil
}

func frameRate(s string) float64 {
	n, d, ok := strings.Cut(s, "/")
	num, err1 := strconv.ParseFloat(n, 64)
	if !ok {
		return num
	}
	den, err2 := strconv.ParseFloat(d, 64)
	if err1 != nil || err2 != nil || den == 0 {
		return 0
	}
	return num / den
}

// transcodeArgs is ffmpeg's command line for playing path from start at the given size (its shorter
// side), on encoder, as fragmented MP4 on stdout.
func transcodeArgs(path string, p mediaProbe, height int, start float64, encoder string) []string {
	fps := p.FPS
	// Up to 720p, 30 frames a second are plenty (and half the work and data of 60).
	capFPS := fps > 31 && height <= 720
	if capFPS {
		fps = 30
	}
	rate := transcodeRate[height]
	if fps > 31 {
		rate = rate * 3 / 2
	}
	gop := int(fps*2 + 0.5)
	if gop <= 0 {
		gop = 60
	}
	// Scale the shorter side; the other follows, kept even.
	w, h := "-2", strconv.Itoa(height)
	if p.Height > p.Width {
		w, h = strconv.Itoa(height), "-2"
	}
	args := []string{"-hide_banner", "-loglevel", "error", "-nostdin"}
	var filters []string
	if capFPS {
		filters = append(filters, "fps=30")
	}
	switch encoder {
	case "vaapi":
		args = append(args, "-init_hw_device", "vaapi=va:"+vaapiDevice, "-filter_hw_device", "va")
		filters = append(filters, "format=nv12", "hwupload", fmt.Sprintf("scale_vaapi=w=%s:h=%s", w, h))
	default:
		filters = append(filters, fmt.Sprintf("scale=%s:%s", w, h))
	}
	if start > 0 {
		args = append(args, "-ss", strconv.FormatFloat(start, 'f', 3, 64))
	}
	args = append(args, "-i", path, "-map", "0:v:0", "-map", "0:a:0?", "-vf", strings.Join(filters, ","))
	kbps := func(k int) string { return strconv.Itoa(k) + "k" }
	switch encoder {
	case "vaapi":
		args = append(args, "-c:v", "h264_vaapi", "-b:v", kbps(rate), "-maxrate", kbps(rate*3/2), "-g", strconv.Itoa(gop))
	default:
		args = append(args, "-c:v", "libx264", "-preset", "veryfast", "-profile:v", "high", "-pix_fmt", "yuv420p",
			"-b:v", kbps(rate), "-maxrate", kbps(rate*3/2), "-bufsize", kbps(rate*2), "-g", strconv.Itoa(gop), "-sc_threshold", "0")
	}
	return append(args, "-c:a", "aac", "-b:a", kbps(transcodeAudioKbps), "-ac", "2",
		"-f", "mp4", "-movflags", "frag_keyframe+empty_moov+default_base_moof", "pipe:1")
}

// handleMediaTranscode plays a video at a lower size (?height=720), from ?start= seconds.
func (s *server) handleMediaTranscode(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	path, err := s.resolve(q.Get("path"))
	if err != nil {
		writeFSError(w, err)
		return
	}
	height, _ := strconv.Atoi(q.Get("height"))
	start, _ := strconv.ParseFloat(q.Get("start"), 64)
	if !slices.Contains(transcodeHeights, height) || start < 0 {
		writeError(w, http.StatusBadRequest, "unknown size")
		return
	}
	encoder := transcodeEncoder()
	if encoder == "" {
		writeError(w, http.StatusServiceUnavailable, "ffmpeg isn't installed")
		return
	}
	select {
	case transcodeSlots <- struct{}{}:
		defer func() { <-transcodeSlots }()
	default:
		writeError(w, http.StatusServiceUnavailable, fmt.Sprintf("the server is already converting %d videos", maxTranscodes))
		return
	}
	probeCtx, cancel := context.WithTimeout(r.Context(), 20*time.Second)
	p, err := probeVideo(probeCtx, path)
	cancel()
	if err != nil {
		writeError(w, http.StatusUnprocessableEntity, err.Error())
		return
	}
	// Ends when the player goes (another size, a seek, the window closed). At a lower priority:
	// converting takes what the processor has, and the server's other work comes first.
	cmd := exec.CommandContext(r.Context(), "nice", append([]string{"-n", "10", "ffmpeg"}, transcodeArgs(path, p, height, start, encoder)...)...)
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	stderr, _ := cmd.StderrPipe()
	if err := cmd.Start(); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	go func() {
		sc := bufio.NewScanner(stderr)
		for sc.Scan() {
			if r.Context().Err() == nil {
				log.Printf("transcode %s: %s", filepath.Base(path), sc.Text())
			}
		}
	}()
	w.Header().Set("Content-Type", "video/mp4")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(http.StatusOK)
	_, _ = io.Copy(flushWriter{w}, stdout)
	_ = cmd.Wait()
}

// flushWriter sends each piece as soon as ffmpeg makes it, so playing starts at once.
type flushWriter struct{ w http.ResponseWriter }

func (f flushWriter) Write(p []byte) (int, error) {
	n, err := f.w.Write(p)
	_ = http.NewResponseController(f.w).Flush()
	return n, err
}
