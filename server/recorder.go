package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"slices"
	"strings"
	"sync"
	"time"
)

// Live Recorder: channels on Twitch, YouTube, Kick, TikTok and the other sites streamlink
// knows, checked every couple of minutes; when one goes live it's recorded until the stream
// ends, then turned into an MP4 (remuxed, not re-encoded). Each recording runs as a systemd
// unit of its own, so it carries on through a TemanLabsOS restart or update.

const (
	recCheckEvery    = 2 * time.Minute
	defaultRecFolder = "/DATA/Media/Recordings"
	recUnitPrefix    = "temanlabsos-rec-"
)

type recChannel struct {
	ID       string    `json:"id"`
	URL      string    `json:"url"`
	Name     string    `json:"name"`
	Platform string    `json:"platform"`
	Quality  string    `json:"quality"` // best, 1080, 720, 480, audio
	Auto     bool      `json:"auto"`
	KeepDays int       `json:"keepDays"`
	Added    time.Time `json:"added"`

	live    bool
	title   string
	checked time.Time
	err     string
	// Stopped by hand: not recorded again until the stream has ended once.
	skip bool
}

type recording struct {
	ID      string     `json:"id"`
	Channel string     `json:"channel"`
	Title   string     `json:"title"`
	File    string     `json:"file"`
	Unit    string     `json:"unit"`
	Status  string     `json:"status"` // recording, converting, done, failed
	Started time.Time  `json:"started"`
	Ended   *time.Time `json:"ended,omitempty"`
	Bytes   int64      `json:"bytes"`
	Error   string     `json:"error,omitempty"`
}

type recorderStore struct {
	mu         sync.Mutex
	file       string
	Folder     string        `json:"folder"`
	Channels   []*recChannel `json:"channels"`
	Recordings []*recording  `json:"recordings"`
	wake       chan struct{}
}

func newRecorder(stateDir string) *recorderStore {
	r := &recorderStore{file: filepath.Join(stateDir, "recorder.json"), wake: make(chan struct{}, 1)}
	if data, err := os.ReadFile(r.file); err == nil {
		_ = json.Unmarshal(data, r)
	}
	return r
}

// save writes the file; the caller holds mu.
func (r *recorderStore) save() {
	data, err := json.MarshalIndent(r, "", "  ")
	if err != nil {
		return
	}
	tmp := r.file + ".tmp"
	if os.WriteFile(tmp, data, 0o600) == nil {
		_ = os.Rename(tmp, r.file)
	}
}

func (r *recorderStore) folder() string {
	if r.Folder != "" {
		return r.Folder
	}
	return defaultRecFolder
}

func (r *recorderStore) channel(id string) *recChannel {
	for _, c := range r.Channels {
		if c.ID == id {
			return c
		}
	}
	return nil
}

// active is the channel's recording in progress, if any.
func (r *recorderStore) active(channel string) *recording {
	for _, x := range r.Recordings {
		if x.Channel == channel && (x.Status == "recording" || x.Status == "converting") {
			return x
		}
	}
	return nil
}

func (r *recorderStore) poke() {
	select {
	case r.wake <- struct{}{}:
	default:
	}
}

// platformOf names the site, and a channel name from its address (twitch.tv/xqc → xqc).
func platformOf(raw string) (platform, name string) {
	u, err := url.Parse(raw)
	if err != nil {
		return "", ""
	}
	host := strings.TrimPrefix(strings.ToLower(u.Hostname()), "www.")
	host = strings.TrimPrefix(host, "m.")
	switch {
	case strings.HasSuffix(host, "youtube.com") || host == "youtu.be":
		platform = "youtube"
	case strings.HasSuffix(host, "twitch.tv"):
		platform = "twitch"
	case strings.HasSuffix(host, "tiktok.com"):
		platform = "tiktok"
	case strings.HasSuffix(host, "kick.com"):
		platform = "kick"
	default:
		platform = host
	}
	for _, part := range strings.Split(strings.Trim(u.Path, "/"), "/") {
		part = strings.TrimPrefix(part, "@")
		if part != "" && part != "live" && part != "channel" && part != "c" && part != "user" && part != "watch" {
			return platform, part
		}
	}
	return platform, host
}

// Stream names to ask streamlink for, best first; the first one that exists is recorded.
func streamsFor(q string) string {
	switch q {
	case "1080":
		return "1080p60,1080p,720p60,720p,best"
	case "720":
		return "720p60,720p,480p,best"
	case "480":
		return "480p,360p,worst"
	case "audio":
		return "audio_only,audio,worst"
	}
	return "best"
}

// liveInfo asks streamlink whether a channel is live, and its stream's title.
func (s *server) liveInfo(ctx context.Context, channelURL string) (live bool, title string, err error) {
	ctx, cancel := context.WithTimeout(ctx, 45*time.Second)
	defer cancel()
	cmd := exec.CommandContext(ctx, s.toolPath("streamlink"), "--json", channelURL)
	cmd.Env = s.toolEnv()
	out, _ := cmd.Output()
	var res struct {
		Error    string            `json:"error"`
		Streams  map[string]any    `json:"streams"`
		Metadata map[string]string `json:"metadata"`
	}
	if json.Unmarshal(out, &res) != nil {
		if ctx.Err() != nil {
			return false, "", errors.New("the site took too long to answer")
		}
		return false, "", errors.New("streamlink gave no answer")
	}
	if res.Error != "" {
		if strings.Contains(res.Error, "No playable streams") {
			return false, "", nil
		}
		return false, "", errors.New(res.Error)
	}
	return len(res.Streams) > 0, res.Metadata["title"], nil
}

var unsafeName = regexp.MustCompile(`[\\/:*?"<>|\x00-\x1f]+`)

func safeName(s string, max int) string {
	s = strings.TrimSpace(unsafeName.ReplaceAllString(s, " "))
	s = strings.Join(strings.Fields(s), " ")
	if r := []rune(s); len(r) > max {
		s = string(r[:max])
	}
	return strings.TrimRight(s, ". ")
}

// startRecording starts streamlink in a systemd unit of its own.
func (s *server) startRecording(c *recChannel, title string) (*recording, error) {
	s.recorder.mu.Lock()
	folder := filepath.Join(s.recorder.folder(), safeName(c.Name, 80))
	s.recorder.mu.Unlock()
	if err := os.MkdirAll(folder, 0o755); err != nil {
		return nil, err
	}
	s.chown(filepath.Dir(folder))
	s.chown(folder)
	now := time.Now()
	name := now.Format("2006-01-02 15.04")
	if t := safeName(title, 120); t != "" {
		name += " " + t
	}
	rec := &recording{ID: dlID(), Channel: c.ID, Title: title, File: filepath.Join(folder, name+".ts"), Status: "recording", Started: now}
	rec.Unit = recUnitPrefix + rec.ID
	args := []string{"--unit", rec.Unit, "--collect", "--quiet", "--property=KillSignal=SIGINT", "--property=TimeoutStopSec=30",
		"--setenv=PATH=" + filepath.Join(s.toolsDir(), "bin") + ":/usr/local/bin:/usr/bin:/bin",
		s.toolPath("streamlink"), "--loglevel", "info", "--retry-open", "3", "--stream-segment-threads", "2",
		"--force", "-o", rec.File, c.URL, streamsFor(c.Quality)}
	if out, err := exec.Command("systemd-run", args...).CombinedOutput(); err != nil {
		return nil, fmt.Errorf("couldn't start the recording: %s", strings.TrimSpace(string(out)))
	}
	s.recorder.mu.Lock()
	s.recorder.Recordings = append(s.recorder.Recordings, rec)
	s.recorder.save()
	s.recorder.mu.Unlock()
	return rec, nil
}

func unitActive(unit string) bool {
	out, _ := exec.Command("systemctl", "is-active", unit).Output()
	state := strings.TrimSpace(string(out))
	return state == "active" || state == "activating" || state == "deactivating"
}

// finish turns a finished recording into an MP4, or says why there's nothing.
func (s *server) finishRecording(rec *recording) {
	s.recorder.mu.Lock()
	rec.Status = "converting"
	if rec.Ended == nil {
		now := time.Now()
		rec.Ended = &now
	}
	file := rec.File
	s.recorder.save()
	s.recorder.mu.Unlock()

	info, err := os.Stat(file)
	var failure string
	switch {
	case err != nil || info.Size() == 0:
		out, _ := exec.Command("journalctl", "-u", rec.Unit, "-n", "6", "--no-pager", "-o", "cat").Output()
		failure = strings.TrimSpace(lastLines(string(out), 3))
		if failure == "" {
			failure = "nothing was recorded"
		}
		_ = os.Remove(file)
	case strings.HasSuffix(file, ".ts"):
		mp4 := strings.TrimSuffix(file, ".ts") + ".mp4"
		ctx, cancel := context.WithTimeout(context.Background(), 2*time.Hour)
		out, err := exec.CommandContext(ctx, "ffmpeg", recordingToMP4(file, mp4)...).CombinedOutput()
		cancel()
		if err == nil {
			_ = os.Remove(file)
			file = mp4
		} else {
			// The .ts plays anyway; keep it.
			_ = os.Remove(mp4)
			failure = "kept as .ts, it couldn't be turned into MP4: " + lastLines(string(out), 2)
		}
	}
	s.recorder.mu.Lock()
	defer s.recorder.mu.Unlock()
	rec.File = file
	if st, err := os.Stat(file); err == nil {
		rec.Bytes = st.Size()
		s.chown(file)
	}
	switch {
	case rec.Bytes > 0:
		rec.Status, rec.Error = "done", ""
		if strings.HasPrefix(failure, "kept as") {
			rec.Error = failure
		}
	default:
		rec.Status, rec.Error = "failed", failure
	}
	s.recorder.save()
}

// recordingToMP4 is ffmpeg's command line that puts a recording's video and sound in an MP4 as
// they are. Only those: streams also carry data an MP4 can't hold (Kick's and Twitch's timed ID3
// metadata), which would stop the whole conversion.
func recordingToMP4(ts, mp4 string) []string {
	return []string{"-nostdin", "-y", "-loglevel", "error", "-i", ts, "-map", "0:v?", "-map", "0:a?", "-c", "copy", "-movflags", "+faststart", mp4}
}

// runRecorder watches the channels and the recordings running.
func (s *server) runRecorder() {
	// Recordings that were being made when TemanLabsOS stopped: still running in their unit,
	// or finished meanwhile.
	s.recorder.mu.Lock()
	var pending []*recording
	for _, rec := range s.recorder.Recordings {
		if rec.Status == "converting" || (rec.Status == "recording" && !unitActive(rec.Unit)) {
			pending = append(pending, rec)
		}
	}
	// And ones kept as .ts because they couldn't be turned into MP4 then: tried again, one at a time.
	var retry []*recording
	for _, rec := range s.recorder.Recordings {
		if rec.Status == "done" && strings.HasSuffix(rec.File, ".ts") && strings.HasPrefix(rec.Error, "kept as .ts") {
			retry = append(retry, rec)
		}
	}
	s.recorder.mu.Unlock()
	for _, rec := range pending {
		go s.finishRecording(rec)
	}
	go func() {
		for _, rec := range retry {
			s.finishRecording(rec)
		}
	}()

	ticker := time.NewTicker(15 * time.Second)
	defer ticker.Stop()
	lastPrune := time.Time{}
	for {
		select {
		case <-ticker.C:
		case <-s.recorder.wake:
		}
		if !s.toolsInstalled() {
			continue
		}
		// Recordings whose stream ended.
		s.recorder.mu.Lock()
		var ended []*recording
		for _, rec := range s.recorder.Recordings {
			if rec.Status == "recording" && !unitActive(rec.Unit) {
				ended = append(ended, rec)
			}
		}
		var check []*recChannel
		for _, c := range s.recorder.Channels {
			if time.Since(c.checked) >= recCheckEvery && s.recorder.active(c.ID) == nil {
				check = append(check, c)
			}
		}
		s.recorder.mu.Unlock()
		for _, rec := range ended {
			go s.finishRecording(rec)
		}
		for _, c := range check {
			live, title, err := s.liveInfo(context.Background(), c.URL)
			s.recorder.mu.Lock()
			c.checked, c.live, c.title, c.err = time.Now(), live, title, ""
			if err != nil {
				c.err = err.Error()
			}
			if !live {
				c.skip = false
			}
			start := live && c.Auto && !c.skip && s.recorder.active(c.ID) == nil
			s.recorder.mu.Unlock()
			if start {
				if _, err := s.startRecording(c, title); err != nil {
					s.recorder.mu.Lock()
					c.err = err.Error()
					s.recorder.mu.Unlock()
				}
			}
		}
		if time.Since(lastPrune) > time.Hour {
			lastPrune = time.Now()
			s.pruneRecordings()
		}
	}
}

// pruneRecordings deletes recordings older than their channel keeps.
func (s *server) pruneRecordings() {
	s.recorder.mu.Lock()
	defer s.recorder.mu.Unlock()
	keep := map[string]int{}
	for _, c := range s.recorder.Channels {
		keep[c.ID] = c.KeepDays
	}
	changed := false
	s.recorder.Recordings = slices.DeleteFunc(s.recorder.Recordings, func(rec *recording) bool {
		days := keep[rec.Channel]
		if days <= 0 || rec.Status != "done" || rec.Ended == nil || time.Since(*rec.Ended) < time.Duration(days)*24*time.Hour {
			return false
		}
		_ = os.Remove(rec.File)
		changed = true
		return true
	})
	if changed {
		s.recorder.save()
	}
}

// ----- HTTP -----

type recChannelView struct {
	*recChannel
	Live      bool       `json:"live"`
	Title     string     `json:"title,omitempty"`
	Checked   *time.Time `json:"checked,omitempty"`
	Error     string     `json:"error,omitempty"`
	Recording string     `json:"recording,omitempty"`
}

func (s *server) handleRecorder(w http.ResponseWriter, r *http.Request) {
	s.recorder.mu.Lock()
	defer s.recorder.mu.Unlock()
	channels := []recChannelView{}
	for _, c := range s.recorder.Channels {
		v := recChannelView{recChannel: c, Live: c.live, Title: c.title, Error: c.err}
		if !c.checked.IsZero() {
			t := c.checked
			v.Checked = &t
		}
		if a := s.recorder.active(c.ID); a != nil {
			v.Recording = a.ID
		}
		channels = append(channels, v)
	}
	recs := []recording{}
	for i := len(s.recorder.Recordings) - 1; i >= 0; i-- {
		rec := *s.recorder.Recordings[i]
		// A recording in progress: how far it's got.
		if rec.Status == "recording" {
			if st, err := os.Stat(rec.File); err == nil {
				rec.Bytes = st.Size()
			}
		}
		recs = append(recs, rec)
	}
	writeJSON(w, http.StatusOK, map[string]any{"folder": s.recorder.folder(), "channels": channels, "recordings": recs})
}

func (s *server) channelFromBody(r *http.Request, c *recChannel) error {
	var body recChannel
	if decodeJSON(r, &body) != nil {
		return errors.New("invalid request")
	}
	u, err := url.Parse(strings.TrimSpace(body.URL))
	if err != nil || (u.Scheme != "http" && u.Scheme != "https") || u.Host == "" {
		return errors.New("enter the channel's address, like https://www.twitch.tv/name")
	}
	platform, name := platformOf(u.String())
	// A YouTube or TikTok profile streams at its /live page.
	if (platform == "youtube" || platform == "tiktok") && strings.HasPrefix(strings.Trim(u.Path, "/"), "@") && !strings.HasSuffix(strings.TrimRight(u.Path, "/"), "/live") {
		u.Path = strings.TrimRight(u.Path, "/") + "/live"
	}
	c.URL = u.String()
	c.Platform = platform
	c.Name = safeName(body.Name, 80)
	if c.Name == "" {
		c.Name = name
	}
	switch body.Quality {
	case "1080", "720", "480", "audio":
		c.Quality = body.Quality
	default:
		c.Quality = "best"
	}
	c.Auto, c.KeepDays = body.Auto, max(0, body.KeepDays)
	return nil
}

func (s *server) handleAddChannel(w http.ResponseWriter, r *http.Request) {
	if !s.toolsInstalled() {
		writeError(w, http.StatusConflict, "install the download tools first")
		return
	}
	c := &recChannel{ID: dlID(), Added: time.Now()}
	if err := s.channelFromBody(r, c); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	cmd := exec.CommandContext(r.Context(), s.toolPath("streamlink"), "--can-handle-url", c.URL)
	cmd.Env = s.toolEnv()
	if cmd.Run() != nil {
		writeError(w, http.StatusBadRequest, "streamlink doesn't know this site; use the channel's own page (Twitch, YouTube, Kick, TikTok…)")
		return
	}
	s.recorder.mu.Lock()
	s.recorder.Channels = append(s.recorder.Channels, c)
	s.recorder.save()
	s.recorder.mu.Unlock()
	s.recorder.poke()
	writeJSON(w, http.StatusCreated, c)
}

func (s *server) handleUpdateChannel(w http.ResponseWriter, r *http.Request) {
	s.recorder.mu.Lock()
	c := s.recorder.channel(r.PathValue("id"))
	s.recorder.mu.Unlock()
	if c == nil {
		writeError(w, http.StatusNotFound, "no such channel")
		return
	}
	next := *c
	if err := s.channelFromBody(r, &next); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	s.recorder.mu.Lock()
	if next.URL != c.URL {
		c.checked = time.Time{}
	}
	c.URL, c.Name, c.Platform, c.Quality, c.Auto, c.KeepDays = next.URL, next.Name, next.Platform, next.Quality, next.Auto, next.KeepDays
	s.recorder.save()
	s.recorder.mu.Unlock()
	s.recorder.poke()
	w.WriteHeader(http.StatusNoContent)
}

// handleDeleteChannel forgets a channel; its recordings stay on the disk and in the list.
func (s *server) handleDeleteChannel(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	s.recorder.mu.Lock()
	defer s.recorder.mu.Unlock()
	if s.recorder.active(id) != nil {
		writeError(w, http.StatusConflict, "stop its recording first")
		return
	}
	s.recorder.Channels = slices.DeleteFunc(s.recorder.Channels, func(c *recChannel) bool { return c.ID == id })
	s.recorder.save()
	w.WriteHeader(http.StatusNoContent)
}

func (s *server) handleChannelAction(w http.ResponseWriter, r *http.Request) {
	s.recorder.mu.Lock()
	c := s.recorder.channel(r.PathValue("id"))
	var active *recording
	if c != nil {
		active = s.recorder.active(c.ID)
	}
	s.recorder.mu.Unlock()
	if c == nil {
		writeError(w, http.StatusNotFound, "no such channel")
		return
	}
	switch r.PathValue("action") {
	case "check":
		s.recorder.mu.Lock()
		c.checked = time.Time{}
		s.recorder.mu.Unlock()
		s.recorder.poke()
	case "record":
		if active != nil {
			writeError(w, http.StatusConflict, "it's being recorded already")
			return
		}
		live, title, err := s.liveInfo(r.Context(), c.URL)
		s.recorder.mu.Lock()
		c.checked, c.live, c.title = time.Now(), live, title
		s.recorder.mu.Unlock()
		if err != nil {
			writeError(w, http.StatusBadGateway, err.Error())
			return
		}
		if !live {
			writeError(w, http.StatusConflict, c.Name+" isn't live right now")
			return
		}
		if _, err := s.startRecording(c, title); err != nil {
			writeError(w, http.StatusInternalServerError, err.Error())
			return
		}
	case "stop":
		if active == nil {
			writeError(w, http.StatusConflict, "nothing is being recorded")
			return
		}
		s.recorder.mu.Lock()
		c.skip = true
		s.recorder.mu.Unlock()
		_ = exec.Command("systemctl", "stop", active.Unit).Run()
		s.recorder.poke()
	default:
		writeError(w, http.StatusBadRequest, "unknown action")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *server) handleDeleteRecording(w http.ResponseWriter, r *http.Request) {
	s.recorder.mu.Lock()
	defer s.recorder.mu.Unlock()
	i := slices.IndexFunc(s.recorder.Recordings, func(x *recording) bool { return x.ID == r.PathValue("id") })
	if i < 0 {
		writeError(w, http.StatusNotFound, "no such recording")
		return
	}
	rec := s.recorder.Recordings[i]
	if rec.Status == "recording" || rec.Status == "converting" {
		writeError(w, http.StatusConflict, "stop it first")
		return
	}
	if r.URL.Query().Get("files") == "1" {
		_ = os.Remove(rec.File)
	}
	s.recorder.Recordings = slices.Delete(s.recorder.Recordings, i, i+1)
	s.recorder.save()
	w.WriteHeader(http.StatusNoContent)
}

func (s *server) handleRecorderSettings(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Folder string `json:"folder"`
	}
	if decodeJSON(r, &body) != nil {
		writeError(w, http.StatusBadRequest, "invalid request")
		return
	}
	full, err := s.resolve(body.Folder)
	if err != nil {
		writeFSError(w, err)
		return
	}
	s.recorder.mu.Lock()
	defer s.recorder.mu.Unlock()
	s.recorder.Folder = full
	s.recorder.save()
	w.WriteHeader(http.StatusNoContent)
}
