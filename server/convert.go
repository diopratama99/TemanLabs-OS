package main

import (
	"bufio"
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"slices"
	"strconv"
	"strings"
	"sync"
	"time"
)

// Remux: changes a video's container without touching the picture or sound (fast, lossless),
// or converts it with ffmpeg. One conversion runs at a time, at low priority, and the rest
// wait in a queue. Output goes to a hidden part file beside the result and is renamed into place
// only when ffmpeg succeeds, so a failed or cancelled run never leaves half a video behind.

// ----- What ffmpeg can write -----

type convertTarget struct {
	Format string // ffmpeg muxer
	Audio  bool   // audio-only result
	// Codecs that can be copied in as they are; nil means any.
	Video []string
	Sound []string
	// Subtitles: "copy" keeps every kind; otherwise text subtitles are converted to this codec
	// and picture-based ones (Blu-ray, DVD) are left out. "" drops subtitles.
	Subs string
}

var convertTargets = map[string]convertTarget{
	"mp4":  {Format: "mp4", Video: []string{"h264", "hevc", "av1", "vp9", "mpeg4"}, Sound: []string{"aac", "mp3", "ac3", "eac3", "alac", "opus", "flac"}, Subs: "mov_text"},
	"mkv":  {Format: "matroska", Subs: "copy"},
	"webm": {Format: "webm", Video: []string{"vp8", "vp9", "av1"}, Sound: []string{"opus", "vorbis"}, Subs: "webvtt"},
	"mov":  {Format: "mov", Video: []string{"h264", "hevc", "prores", "mpeg4", "mjpeg"}, Sound: []string{"aac", "mp3", "alac", "ac3", "pcm_s16le", "pcm_s24le"}, Subs: "mov_text"},
	// MPEG transport stream, for TV boxes, IPTV and recorders. Its subtitles are DVB pictures,
	// which other formats' subtitles can't become, so none go in.
	"ts":   {Format: "mpegts", Video: []string{"h264", "hevc", "mpeg2video", "mpeg1video"}, Sound: []string{"aac", "mp3", "mp2", "ac3", "eac3", "dts", "opus"}},
	"mp3":  {Format: "mp3", Audio: true, Sound: []string{"mp3"}},
	"m4a":  {Format: "ipod", Audio: true, Sound: []string{"aac", "alac"}},
	"flac": {Format: "flac", Audio: true, Sound: []string{"flac"}},
	"opus": {Format: "opus", Audio: true, Sound: []string{"opus"}},
	"wav":  {Format: "wav", Audio: true, Sound: []string{"pcm_s16le", "pcm_s24le", "pcm_f32le"}},
}

var textSubtitles = []string{"subrip", "srt", "ass", "ssa", "mov_text", "webvtt", "text"}

// Encoders by the names the UI uses, with the ffmpeg encoder that provides each (first found wins).
var videoEncoders = map[string][]string{"h264": {"libx264"}, "hevc": {"libx265"}, "vp9": {"libvpx-vp9"}, "av1": {"libsvtav1", "libaom-av1"}}
var audioEncoders = map[string][]string{"aac": {"aac"}, "opus": {"libopus"}, "mp3": {"libmp3lame"}, "flac": {"flac"}, "pcm": {"pcm_s16le"}}

// Quality presets: CRF (lower is better) or bitrate per codec, for high / medium / small.
var videoQuality = map[string][3]string{"libx264": {"18", "22", "27"}, "libx265": {"20", "25", "30"}, "libvpx-vp9": {"24", "32", "38"}, "libsvtav1": {"26", "32", "40"}, "libaom-av1": {"26", "32", "40"}}
var audioQuality = map[string][3]string{"aac": {"256k", "192k", "128k"}, "libopus": {"160k", "128k", "96k"}, "libmp3lame": {"0", "2", "5"}}

// ----- Probing -----

type probeStream struct {
	Index    int     `json:"index"`
	Type     string  `json:"type"` // video, audio, subtitle, attachment, data
	Codec    string  `json:"codec"`
	Width    int     `json:"width,omitempty"`
	Height   int     `json:"height,omitempty"`
	FPS      float64 `json:"fps,omitempty"`
	HDR      bool    `json:"hdr,omitempty"`
	Channels int     `json:"channels,omitempty"`
	Language string  `json:"language,omitempty"`
	Title    string  `json:"title,omitempty"`
	// A cover picture (an "attached picture" video stream), not part of the film.
	Cover   bool  `json:"cover,omitempty"`
	Bitrate int64 `json:"bitrate,omitempty"`
}

type probeResult struct {
	Path      string        `json:"path"`
	Container string        `json:"container"`
	Duration  float64       `json:"duration"`
	Size      int64         `json:"size"`
	Bitrate   int64         `json:"bitrate,omitempty"`
	Streams   []probeStream `json:"streams"`
	// For each result format: why its video or sound can't be copied in as it is ("" when it can).
	Remux map[string]remuxCheck `json:"remux"`
}

type remuxCheck struct {
	Video string `json:"video,omitempty"`
	Audio string `json:"audio,omitempty"`
}

func probeFile(ctx context.Context, path string) (*probeResult, error) {
	ctx, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()
	out, err := exec.CommandContext(ctx, "ffprobe", "-v", "error", "-print_format", "json", "-show_format", "-show_streams", path).Output()
	if err != nil {
		var exit *exec.ExitError
		if errors.As(err, &exit) && len(exit.Stderr) > 0 {
			return nil, fmt.Errorf("can’t read this file: %s", strings.TrimSpace(lastLine(string(exit.Stderr))))
		}
		return nil, fmt.Errorf("can’t read this file: %w", err)
	}
	var raw struct {
		Format struct {
			Name     string `json:"format_name"`
			Duration string `json:"duration"`
			Size     string `json:"size"`
			Bitrate  string `json:"bit_rate"`
		} `json:"format"`
		Streams []struct {
			Index       int               `json:"index"`
			Type        string            `json:"codec_type"`
			Codec       string            `json:"codec_name"`
			Width       int               `json:"width"`
			Height      int               `json:"height"`
			FrameRate   string            `json:"avg_frame_rate"`
			Transfer    string            `json:"color_transfer"`
			Channels    int               `json:"channels"`
			Bitrate     string            `json:"bit_rate"`
			Tags        map[string]string `json:"tags"`
			Disposition map[string]int    `json:"disposition"`
		} `json:"streams"`
	}
	if err := json.Unmarshal(out, &raw); err != nil {
		return nil, fmt.Errorf("can’t read this file: %w", err)
	}
	p := &probeResult{Path: path, Container: raw.Format.Name}
	p.Duration, _ = strconv.ParseFloat(raw.Format.Duration, 64)
	p.Size, _ = strconv.ParseInt(raw.Format.Size, 10, 64)
	p.Bitrate, _ = strconv.ParseInt(raw.Format.Bitrate, 10, 64)
	for _, s := range raw.Streams {
		st := probeStream{Index: s.Index, Type: s.Type, Codec: s.Codec, Width: s.Width, Height: s.Height, Channels: s.Channels}
		st.Bitrate, _ = strconv.ParseInt(s.Bitrate, 10, 64)
		if n, d, ok := strings.Cut(s.FrameRate, "/"); ok {
			num, _ := strconv.ParseFloat(n, 64)
			den, _ := strconv.ParseFloat(d, 64)
			if den > 0 {
				st.FPS = float64(int(num/den*100+0.5)) / 100
			}
		}
		st.HDR = s.Transfer == "smpte2084" || s.Transfer == "arib-std-b67"
		st.Language = s.Tags["language"]
		if st.Language == "und" {
			st.Language = ""
		}
		st.Title = s.Tags["title"]
		st.Cover = s.Disposition["attached_pic"] == 1
		p.Streams = append(p.Streams, st)
	}
	p.Remux = map[string]remuxCheck{}
	for name, t := range convertTargets {
		var c remuxCheck
		if err := copyProblem(p, name, "audio"); err != nil {
			c.Audio = err.Error()
		}
		if !t.Audio {
			if err := copyProblem(p, name, "video"); err != nil {
				c.Video = err.Error()
			}
		}
		p.Remux[name] = c
	}
	return p, nil
}

// copyProblem reports why a file's video or audio streams can't be copied into a format as they
// are, if they can't.
func copyProblem(p *probeResult, container, kind string) error {
	t := convertTargets[container]
	allowed, what := t.Video, "video"
	if kind == "audio" {
		allowed, what = t.Sound, "sound"
	}
	found := false
	for _, s := range p.Streams {
		if s.Type != kind || s.Cover {
			continue
		}
		found = true
		if allowed != nil && !slices.Contains(allowed, s.Codec) {
			return fmt.Errorf("%s %s can’t go into %s as it is", codecName(s.Codec), what, strings.ToUpper(container))
		}
	}
	if !found {
		return fmt.Errorf("this file has no %s", what)
	}
	return nil
}

func codecName(c string) string {
	names := map[string]string{"h264": "H.264", "hevc": "H.265", "av1": "AV1", "vp9": "VP9", "vp8": "VP8", "mpeg4": "MPEG-4", "mpeg2video": "MPEG-2",
		"aac": "AAC", "mp3": "MP3", "ac3": "Dolby Digital", "eac3": "Dolby Digital Plus", "dts": "DTS", "truehd": "Dolby TrueHD", "flac": "FLAC",
		"opus": "Opus", "vorbis": "Vorbis", "alac": "ALAC", "wmav2": "WMA", "wmv3": "WMV", "vc1": "VC-1", "prores": "ProRes",
		"mp2": "MP2", "mpeg1video": "MPEG-1"}
	if n, ok := names[c]; ok {
		return n
	}
	return strings.ToUpper(c)
}

func lastLine(s string) string {
	lines := strings.Split(strings.TrimSpace(s), "\n")
	return lines[len(lines)-1]
}

// ----- Building the ffmpeg command -----

type convertRequest struct {
	Path      string `json:"path"`
	Container string `json:"container"` // a key of convertTargets
	Video     string `json:"video"`     // copy, h264, hevc, vp9, av1
	Audio     string `json:"audio"`     // copy, aac, opus, mp3, flac, pcm, none
	Quality   string `json:"quality"`   // high, medium, small (when converting)
	Height    int    `json:"height"`    // shrink to this height; 0 keeps the size
	Subtitles bool   `json:"subtitles"` // keep subtitles where the format allows
	Name      string `json:"name"`      // result's file name, in the same folder; optional
}

// ffmpegArgs turns a request into ffmpeg's arguments (without input and output).
func ffmpegArgs(p *probeResult, req convertRequest, encoders map[string]bool) ([]string, error) {
	t, ok := convertTargets[req.Container]
	if !ok {
		return nil, errors.New("unknown format")
	}
	pick := func(table map[string][]string, name string) string {
		for _, enc := range table[name] {
			if encoders[enc] {
				return enc
			}
		}
		return ""
	}
	q := map[string]int{"high": 0, "medium": 1, "small": 2}[req.Quality]

	var args []string
	if !t.Audio {
		switch req.Video {
		case "copy":
			if req.Height > 0 {
				return nil, errors.New("changing the size means converting the video")
			}
			if err := copyProblem(p, req.Container, "video"); err != nil {
				return nil, fmt.Errorf("%v: convert the video", err)
			}
			args = append(args, "-c:v", "copy")
		default:
			enc := pick(videoEncoders, req.Video)
			if enc == "" {
				return nil, fmt.Errorf("this server’s ffmpeg can’t make %s video", codecName(req.Video))
			}
			if t.Video != nil && !slices.Contains(t.Video, req.Video) {
				return nil, fmt.Errorf("%s video can’t go into %s", codecName(req.Video), strings.ToUpper(req.Container))
			}
			args = append(args, "-c:v", enc)
			if crf, ok := videoQuality[enc]; ok {
				args = append(args, "-crf", crf[q])
			}
			switch enc {
			case "libx264":
				// 8-bit 4:2:0 plays on every device and browser.
				args = append(args, "-preset", "medium", "-pix_fmt", "yuv420p")
			case "libx265":
				args = append(args, "-preset", "medium")
			case "libvpx-vp9":
				args = append(args, "-b:v", "0", "-row-mt", "1", "-deadline", "good", "-cpu-used", "2")
			case "libsvtav1":
				args = append(args, "-preset", "8")
			case "libaom-av1":
				args = append(args, "-b:v", "0", "-cpu-used", "6", "-row-mt", "1")
			}
			if req.Height > 0 {
				args = append(args, "-vf", fmt.Sprintf("scale=-2:'min(%d,ih)'", req.Height))
			}
		}
		if (req.Container == "mp4" || req.Container == "mov") && (req.Video == "hevc" || (req.Video == "copy" && hasCodec(p, "video", "hevc"))) {
			// Lets Safari and phones play H.265 in MP4.
			args = append(args, "-tag:v", "hvc1")
		}
	}

	switch req.Audio {
	case "none":
	case "copy":
		if err := copyProblem(p, req.Container, "audio"); err != nil && hasStream(p, "audio") {
			return nil, fmt.Errorf("%v: convert the sound", err)
		}
		args = append(args, "-c:a", "copy")
	default:
		enc := pick(audioEncoders, req.Audio)
		if enc == "" {
			return nil, fmt.Errorf("this server’s ffmpeg can’t make %s sound", strings.ToUpper(req.Audio))
		}
		codec := map[string]string{"pcm": "pcm_s16le"}[req.Audio]
		if codec == "" {
			codec = req.Audio
		}
		if t.Sound != nil && !slices.Contains(t.Sound, codec) {
			return nil, fmt.Errorf("%s sound can’t go into %s", codecName(codec), strings.ToUpper(req.Container))
		}
		args = append(args, "-c:a", enc)
		if br, ok := audioQuality[enc]; ok {
			if enc == "libmp3lame" {
				args = append(args, "-q:a", br[q])
			} else {
				args = append(args, "-b:a", br[q])
			}
		}
	}

	// Which streams go in: the film's video (not cover pictures), the sound tracks, subtitles the
	// format can hold, and fonts for styled subtitles in MKV.
	var maps []string
	subs := 0
	for _, s := range p.Streams {
		switch s.Type {
		case "video":
			if !t.Audio && !s.Cover {
				maps = append(maps, "-map", fmt.Sprintf("0:%d", s.Index))
			}
		case "audio":
			if req.Audio != "none" {
				maps = append(maps, "-map", fmt.Sprintf("0:%d", s.Index))
			}
		case "subtitle":
			if !req.Subtitles || t.Subs == "" {
				continue
			}
			text := slices.Contains(textSubtitles, s.Codec)
			codec := "copy"
			switch {
			case t.Subs == "copy" && s.Codec == "mov_text":
				codec = "srt" // MKV can't hold MP4's subtitle kind
			case t.Subs == "copy":
			case text:
				codec = t.Subs
			default:
				continue
			}
			maps = append(maps, "-map", fmt.Sprintf("0:%d", s.Index))
			args = append(args, fmt.Sprintf("-c:s:%d", subs), codec)
			subs++
		case "attachment":
			if req.Container == "mkv" {
				maps = append(maps, "-map", fmt.Sprintf("0:%d", s.Index))
			}
		}
	}
	if len(maps) == 0 {
		return nil, errors.New("nothing to put in the new file")
	}
	if req.Container == "mkv" {
		args = append(args, "-c:t", "copy")
	}
	args = append(maps, args...)
	args = append(args, "-map_metadata", "0", "-map_chapters", "0")
	if req.Container == "mp4" || req.Container == "mov" || req.Container == "m4a" {
		args = append(args, "-movflags", "+faststart")
	}
	return append(args, "-f", t.Format), nil
}

func hasStream(p *probeResult, kind string) bool {
	return slices.ContainsFunc(p.Streams, func(s probeStream) bool { return s.Type == kind && !s.Cover })
}

func hasCodec(p *probeResult, kind, codec string) bool {
	return slices.ContainsFunc(p.Streams, func(s probeStream) bool { return s.Type == kind && s.Codec == codec && !s.Cover })
}

// ----- The queue -----

type convertTask struct {
	ID     string `json:"id"`
	Input  string `json:"input"`
	Output string `json:"output"`
	// What it makes: the format and the video / sound codecs ("copy" keeps them).
	Container string  `json:"container"`
	Video     string  `json:"video,omitempty"`
	Audio     string  `json:"audio"`
	Status    string  `json:"status"` // queued, running, done, failed, cancelled
	Progress  float64 `json:"progress"`
	Speed     float64 `json:"speed,omitempty"` // × real time
	// MP4 and MOV end with a pass that moves the index to the front of the file (so playback can
	// start before the whole file has loaded); it rewrites the whole file and ffmpeg reports no
	// progress meanwhile. Final is set during it, and Finishing says how far it has got.
	Final     bool      `json:"final,omitempty"`
	Finishing float64   `json:"finishing,omitempty"`
	Error     string    `json:"error,omitempty"`
	Size      int64     `json:"size,omitempty"` // of the result, once done
	Created   time.Time `json:"created"`
	Started   time.Time `json:"started,omitzero"`
	Ended     time.Time `json:"ended,omitzero"`
	Duration  float64   `json:"duration"` // of the input, seconds
	args      []string
	cancel    context.CancelFunc
}

type converter struct {
	mu    sync.Mutex
	tasks []*convertTask
	wake  chan struct{}
	// Remembers the part file being written, so one left by a crash is removed at startup.
	marker string
	chown  func(string)

	encOnce  sync.Once
	encoders map[string]bool
	version  string
}

func newConverter(stateDir string, chown func(string)) *converter {
	c := &converter{wake: make(chan struct{}, 1), chown: chown}
	if stateDir != "" {
		c.marker = filepath.Join(stateDir, "convert-part")
		if part, err := os.ReadFile(c.marker); err == nil {
			if p := strings.TrimSpace(string(part)); strings.HasSuffix(p, partSuffix) {
				_ = os.Remove(p)
			}
			_ = os.Remove(c.marker)
		}
	}
	go c.loop()
	return c
}

const partSuffix = ".temanlabs-part"

// probeEncoders finds ffmpeg and the encoders it has (once; installing ffmpeg resets it).
func (c *converter) probeEncoders() (bool, string, map[string]bool) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.encoders == nil {
		c.encoders = map[string]bool{}
		if out, err := exec.Command("ffmpeg", "-hide_banner", "-encoders").Output(); err == nil {
			for _, line := range strings.Split(string(out), "\n") {
				if f := strings.Fields(line); len(f) >= 2 && len(f[0]) == 6 {
					c.encoders[f[1]] = true
				}
			}
			// "ffmpeg version 6.1.1-3ubuntu5 Copyright …"
			if v, err := exec.Command("ffmpeg", "-version").Output(); err == nil {
				if f := strings.Fields(string(v)); len(f) >= 3 {
					c.version = f[2]
				}
			}
		}
	}
	return len(c.encoders) > 0, c.version, c.encoders
}

func (c *converter) resetEncoders() {
	c.mu.Lock()
	c.encoders = nil
	c.mu.Unlock()
}

func (c *converter) snapshot() []convertTask {
	c.mu.Lock()
	defer c.mu.Unlock()
	out := make([]convertTask, 0, len(c.tasks))
	for i := len(c.tasks) - 1; i >= 0; i-- {
		t := *c.tasks[i]
		t.cancel = nil
		out = append(out, t)
	}
	return out
}

func (c *converter) loop() {
	for {
		c.mu.Lock()
		var next *convertTask
		for _, t := range c.tasks {
			if t.Status == "queued" {
				next = t
				break
			}
		}
		if next == nil {
			c.mu.Unlock()
			<-c.wake
			continue
		}
		ctx, cancel := context.WithCancel(context.Background())
		next.Status, next.Started, next.cancel = "running", time.Now(), cancel
		c.mu.Unlock()
		c.run(ctx, next)
		cancel()
	}
}

func (c *converter) run(ctx context.Context, t *convertTask) {
	part := filepath.Join(filepath.Dir(t.Output), "."+filepath.Base(t.Output)+partSuffix)
	if c.marker != "" {
		_ = os.WriteFile(c.marker, []byte(part), 0o600)
	}
	args := append([]string{"-n", "10", "ffmpeg", "-hide_banner", "-nostdin", "-y", "-i", t.Input, "-progress", "pipe:1", "-nostats"}, t.args...)
	cmd := exec.CommandContext(ctx, "nice", append(args, part)...)
	stdout, _ := cmd.StdoutPipe()
	var stderr tailBuffer
	cmd.Stderr = &stderr
	err := cmd.Start()
	if err == nil {
		done := make(chan struct{})
		defer close(done)
		go c.watchFinish(t, cmd.Process.Pid, part, done)
		scanner := bufio.NewScanner(stdout)
		for scanner.Scan() {
			key, value, _ := strings.Cut(scanner.Text(), "=")
			c.mu.Lock()
			switch key {
			case "out_time_us", "out_time_ms": // both are microseconds
				if us, e := strconv.ParseFloat(value, 64); e == nil && t.Duration > 0 {
					t.Progress = min(0.999, max(0, us/1e6/t.Duration))
				}
			case "speed":
				if x, e := strconv.ParseFloat(strings.TrimSuffix(strings.TrimSpace(value), "x"), 64); e == nil {
					t.Speed = x
				}
			}
			c.mu.Unlock()
		}
		err = cmd.Wait()
	}

	c.mu.Lock()
	defer c.mu.Unlock()
	t.Ended, t.Speed, t.Final, t.Finishing = time.Now(), 0, false, 0
	switch {
	case t.Status == "cancelled":
		_ = os.Remove(part)
	case err != nil:
		_ = os.Remove(part)
		t.Status = "failed"
		t.Error = ffmpegError(stderr.String(), err)
	default:
		// Never overwrite: if something took the name meanwhile, pick another one.
		if _, e := os.Lstat(t.Output); e == nil {
			t.Output = freeName(filepath.Dir(t.Output), filepath.Base(t.Output), nil)
		}
		if e := os.Rename(part, t.Output); e != nil {
			_ = os.Remove(part)
			t.Status, t.Error = "failed", e.Error()
			break
		}
		c.chown(t.Output)
		t.Status, t.Progress = "done", 1
		if info, e := os.Stat(t.Output); e == nil {
			t.Size = info.Size()
		}
	}
	if c.marker != "" {
		_ = os.Remove(c.marker)
	}
}

// watchFinish follows ffmpeg's final pass (see convertTask.Final) by how far it has read
// through the part file, once the conversion itself has reached the end.
func (c *converter) watchFinish(t *convertTask, pid int, part string, done <-chan struct{}) {
	tick := time.NewTicker(time.Second)
	defer tick.Stop()
	for {
		select {
		case <-done:
			return
		case <-tick.C:
		}
		c.mu.Lock()
		near := t.Progress >= 0.99
		c.mu.Unlock()
		if !near {
			continue
		}
		if f, ok := finalPassProgress(pid, part); ok {
			c.mu.Lock()
			t.Final, t.Finishing = true, f
			c.mu.Unlock()
		}
	}
}

// finalPassProgress finds ffmpeg's read-only handle on its own output (the second pass opens it
// to rewrite it) and reports how far through the file it is.
func finalPassProgress(pid int, part string) (float64, bool) {
	info, err := os.Stat(part)
	if err != nil || info.Size() == 0 {
		return 0, false
	}
	dir := fmt.Sprintf("/proc/%d/fd", pid)
	fds, err := os.ReadDir(dir)
	if err != nil {
		return 0, false
	}
	for _, fd := range fds {
		if target, err := os.Readlink(filepath.Join(dir, fd.Name())); err != nil || target != part {
			continue
		}
		data, err := os.ReadFile(fmt.Sprintf("/proc/%d/fdinfo/%s", pid, fd.Name()))
		if err != nil {
			continue
		}
		var pos, flags int64 = -1, -1
		for _, line := range strings.Split(string(data), "\n") {
			key, value, _ := strings.Cut(line, ":")
			switch strings.TrimSpace(key) {
			case "pos":
				pos, _ = strconv.ParseInt(strings.TrimSpace(value), 10, 64)
			case "flags":
				flags, _ = strconv.ParseInt(strings.TrimSpace(value), 8, 64)
			}
		}
		// Opened for reading only (O_RDONLY): the second pass.
		if pos >= 0 && flags >= 0 && flags&3 == 0 {
			return min(1, float64(pos)/float64(info.Size())), true
		}
	}
	return 0, false
}

// ffmpegError picks the useful line out of ffmpeg's output.
func ffmpegError(out string, err error) string {
	lines := strings.Split(strings.TrimSpace(out), "\n")
	for i := len(lines) - 1; i >= 0; i-- {
		l := strings.TrimSpace(lines[i])
		if l == "" || strings.HasPrefix(l, "Conversion failed") || strings.HasPrefix(l, "[out#") && strings.Contains(l, "Nothing was written") {
			continue
		}
		if strings.Contains(strings.ToLower(l), "error") || strings.Contains(l, "not supported") || strings.Contains(l, "Invalid") || strings.Contains(l, "Could not") {
			return l
		}
	}
	if len(lines) > 0 && lines[len(lines)-1] != "" {
		return lines[len(lines)-1]
	}
	return err.Error()
}

// tailBuffer keeps the last 16 KB written to it (ffmpeg's log, for error messages).
type tailBuffer struct {
	mu  sync.Mutex
	buf []byte
}

func (b *tailBuffer) Write(p []byte) (int, error) {
	b.mu.Lock()
	defer b.mu.Unlock()
	b.buf = append(b.buf, p...)
	if len(b.buf) > 16<<10 {
		b.buf = b.buf[len(b.buf)-16<<10:]
	}
	return len(p), nil
}

func (b *tailBuffer) String() string {
	b.mu.Lock()
	defer b.mu.Unlock()
	return string(b.buf)
}

// freeName returns dir/name, or "name (converted).ext", "(converted 2)"… if that's taken on disk
// or by a queued task.
func freeName(dir, name string, taken []string) string {
	ext := filepath.Ext(name)
	base := strings.TrimSuffix(name, ext)
	for i := 0; ; i++ {
		candidate := name
		switch i {
		case 0:
		case 1:
			candidate = base + " (converted)" + ext
		default:
			candidate = fmt.Sprintf("%s (converted %d)%s", base, i, ext)
		}
		p := filepath.Join(dir, candidate)
		if _, err := os.Lstat(p); errors.Is(err, os.ErrNotExist) && !slices.Contains(taken, p) {
			return p
		}
	}
}

// ----- HTTP -----

func (s *server) handleConvert(w http.ResponseWriter, r *http.Request) {
	ok, version, encoders := s.convert.probeEncoders()
	names := []string{}
	for name, encs := range videoEncoders {
		if slices.ContainsFunc(encs, func(e string) bool { return encoders[e] }) {
			names = append(names, name)
		}
	}
	for name, encs := range audioEncoders {
		if slices.ContainsFunc(encs, func(e string) bool { return encoders[e] }) {
			names = append(names, name)
		}
	}
	slices.Sort(names)
	writeJSON(w, http.StatusOK, map[string]any{"ffmpeg": ok, "version": version, "encoders": names, "tasks": s.convert.snapshot()})
}

func (s *server) handleConvertProbe(w http.ResponseWriter, r *http.Request) {
	path, err := s.resolve(r.URL.Query().Get("path"))
	if err != nil {
		writeFSError(w, err)
		return
	}
	p, err := probeFile(r.Context(), path)
	if err != nil {
		writeError(w, http.StatusUnprocessableEntity, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, p)
}

func (s *server) handleConvertStart(w http.ResponseWriter, r *http.Request) {
	var req convertRequest
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	input, err := s.resolve(req.Path)
	if err != nil {
		writeFSError(w, err)
		return
	}
	if convertTargets[req.Container].Audio {
		req.Video = ""
	}
	ok, _, encoders := s.convert.probeEncoders()
	if !ok {
		writeError(w, http.StatusFailedDependency, "ffmpeg isn’t installed")
		return
	}
	p, err := probeFile(r.Context(), input)
	if err != nil {
		writeError(w, http.StatusUnprocessableEntity, err.Error())
		return
	}
	args, err := ffmpegArgs(p, req, encoders)
	if err != nil {
		writeError(w, http.StatusUnprocessableEntity, err.Error())
		return
	}

	dir := filepath.Dir(input)
	name := strings.TrimSpace(req.Name)
	if name == "" {
		name = strings.TrimSuffix(filepath.Base(input), filepath.Ext(input)) + "." + req.Container
	}
	if strings.ContainsAny(name, "/\x00") || name == "." || name == ".." || strings.HasPrefix(name, ".") && strings.HasSuffix(name, partSuffix) {
		writeError(w, http.StatusBadRequest, "that file name can’t be used")
		return
	}
	if !strings.EqualFold(filepath.Ext(name), "."+req.Container) {
		name += "." + req.Container
	}

	s.convert.mu.Lock()
	var taken []string
	for _, t := range s.convert.tasks {
		if t.Status == "queued" || t.Status == "running" {
			taken = append(taken, t.Output)
		}
	}
	output := freeName(dir, name, append(taken, input))
	b := make([]byte, 6)
	_, _ = rand.Read(b)
	task := &convertTask{
		ID: hex.EncodeToString(b), Input: input, Output: output, Container: req.Container, Video: req.Video, Audio: req.Audio, Status: "queued",
		Created: time.Now(), Duration: p.Duration, args: args,
	}
	s.convert.tasks = append(s.convert.tasks, task)
	// Only the latest 50 tasks are kept (oldest finished ones go first).
	for i := 0; len(s.convert.tasks) > 50 && i < len(s.convert.tasks); {
		if st := s.convert.tasks[i].Status; st != "queued" && st != "running" {
			s.convert.tasks = slices.Delete(s.convert.tasks, i, i+1)
		} else {
			i++
		}
	}
	snap := *task
	snap.cancel = nil
	s.convert.mu.Unlock()
	select {
	case s.convert.wake <- struct{}{}:
	default:
	}
	writeJSON(w, http.StatusCreated, snap)
}

// handleConvertCancel cancels a queued or running task, or removes a finished one from the list.
func (s *server) handleConvertCancel(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	c := s.convert
	c.mu.Lock()
	defer c.mu.Unlock()
	for i, t := range c.tasks {
		if t.ID != id {
			continue
		}
		switch t.Status {
		case "queued":
			t.Status, t.Ended = "cancelled", time.Now()
		case "running":
			t.Status = "cancelled"
			if t.cancel != nil {
				t.cancel()
			}
		default:
			c.tasks = slices.Delete(c.tasks, i, i+1)
		}
		w.WriteHeader(http.StatusNoContent)
		return
	}
	writeError(w, http.StatusNotFound, "no such task")
}

// handleConvertClear removes finished tasks from the list.
func (s *server) handleConvertClear(w http.ResponseWriter, r *http.Request) {
	c := s.convert
	c.mu.Lock()
	c.tasks = slices.DeleteFunc(c.tasks, func(t *convertTask) bool { return t.Status != "queued" && t.Status != "running" })
	c.mu.Unlock()
	w.WriteHeader(http.StatusNoContent)
}

func (s *server) handleInstallFFmpeg(w http.ResponseWriter, r *http.Request) {
	_, err := startJob("apt", "Installing ffmpeg", []string{"DEBIAN_FRONTEND=noninteractive"}, s.convert.resetEncoders, "apt-get", "install", "-y", "ffmpeg")
	if err != nil {
		writeError(w, http.StatusConflict, err.Error())
		return
	}
	writeJSON(w, http.StatusAccepted, map[string]string{"job": "apt"})
}
