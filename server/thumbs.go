package main

import (
	"bytes"
	"context"
	"crypto/sha1"
	"encoding/binary"
	"encoding/hex"
	"errors"
	"fmt"
	"image"
	"image/jpeg"
	"io"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"time"

	_ "image/gif"
	_ "image/png"

	_ "golang.org/x/image/bmp"
	"golang.org/x/image/draw"
	_ "golang.org/x/image/webp"
)

// Thumbnails for Files: photos are scaled in Go, videos get a frame from ffmpeg. Results are
// cached under the state directory, keyed by path, size and modification time, so an edited
// file gets a new one.

const (
	thumbSide = 320 // longest side; sharp on 2× screens at Files' icon size
	// Larger images aren't worth decoding just for a thumbnail (and could exhaust memory).
	maxThumbPixels = 80_000_000
	thumbQuality   = 80
)

var (
	thumbImage = map[string]bool{".jpg": true, ".jpeg": true, ".png": true, ".gif": true, ".webp": true, ".bmp": true}
	thumbVideo = map[string]bool{".mp4": true, ".m4v": true, ".mkv": true, ".mov": true, ".avi": true, ".webm": true, ".ts": true, ".m2ts": true, ".mts": true}
)

type thumbnailer struct {
	dir string
	// Generating is CPU-heavy; a folder of hundreds of photos shouldn't take the whole server.
	slots chan struct{}

	mu       sync.Mutex
	inflight map[string]chan struct{}
}

func newThumbnailer(stateDir string) *thumbnailer {
	return &thumbnailer{dir: filepath.Join(stateDir, "thumbs"), slots: make(chan struct{}, 2), inflight: map[string]chan struct{}{}}
}

func (t *thumbnailer) cachePath(path string, info os.FileInfo) string {
	sum := sha1.Sum([]byte(fmt.Sprintf("%s\x00%d\x00%d\x00%d", path, info.Size(), info.ModTime().UnixNano(), thumbSide)))
	key := hex.EncodeToString(sum[:])
	return filepath.Join(t.dir, key[:2], key+".jpg")
}

// get returns the cached thumbnail file, making it first if needed. Requests for the same
// file wait for one generation instead of each doing the work.
func (t *thumbnailer) get(ctx context.Context, path string, info os.FileInfo) (string, error) {
	out := t.cachePath(path, info)
	failed := out + ".failed"
	for {
		if _, err := os.Stat(out); err == nil {
			return out, nil
		}
		if _, err := os.Stat(failed); err == nil {
			return "", errors.New("no thumbnail for this file")
		}
		t.mu.Lock()
		wait, busy := t.inflight[out]
		if !busy {
			wait = make(chan struct{})
			t.inflight[out] = wait
		}
		t.mu.Unlock()
		if busy {
			select {
			case <-wait:
				continue
			case <-ctx.Done():
				return "", ctx.Err()
			}
		}
		err := t.generate(ctx, path, out)
		t.mu.Lock()
		delete(t.inflight, out)
		close(wait)
		t.mu.Unlock()
		if err != nil {
			// Remember failures (corrupt file, odd codec) so a folder view doesn't retry each time.
			if !errors.Is(err, context.Canceled) {
				_ = os.MkdirAll(filepath.Dir(failed), 0o755)
				_ = os.WriteFile(failed, []byte(err.Error()), 0o644)
			}
			return "", err
		}
		return out, nil
	}
}

func (t *thumbnailer) generate(ctx context.Context, path, out string) error {
	select {
	case t.slots <- struct{}{}:
	case <-ctx.Done():
		return ctx.Err()
	}
	defer func() { <-t.slots }()
	if err := os.MkdirAll(filepath.Dir(out), 0o755); err != nil {
		return err
	}
	ext := strings.ToLower(filepath.Ext(path))
	tmp := out + ".tmp"
	var err error
	switch {
	case thumbImage[ext]:
		err = imageThumb(path, tmp)
	case thumbVideo[ext]:
		err = videoThumb(ctx, path, tmp)
	default:
		err = errors.New("not an image or video")
	}
	if err != nil {
		os.Remove(tmp)
		return err
	}
	return os.Rename(tmp, out)
}

func imageThumb(path, out string) error {
	f, err := os.Open(path)
	if err != nil {
		return err
	}
	defer f.Close()
	cfg, _, err := image.DecodeConfig(f)
	if err != nil {
		return err
	}
	if cfg.Width*cfg.Height > maxThumbPixels {
		return errors.New("image too large for a thumbnail")
	}
	if _, err := f.Seek(0, io.SeekStart); err != nil {
		return err
	}
	head := make([]byte, 128<<10)
	n, _ := io.ReadFull(f, head)
	orientation := exifOrientation(head[:n])
	if _, err := f.Seek(0, io.SeekStart); err != nil {
		return err
	}
	src, _, err := image.Decode(f)
	if err != nil {
		return err
	}
	b := src.Bounds()
	scale := min(1, float64(thumbSide)/float64(max(b.Dx(), b.Dy())))
	w, h := max(1, int(float64(b.Dx())*scale)), max(1, int(float64(b.Dy())*scale))
	dst := image.NewRGBA(image.Rect(0, 0, w, h))
	draw.BiLinear.Scale(dst, dst.Bounds(), src, b, draw.Src, nil)
	return writeJPEG(out, orient(dst, orientation))
}

func writeJPEG(out string, img image.Image) error {
	var buf bytes.Buffer
	if err := jpeg.Encode(&buf, img, &jpeg.Options{Quality: thumbQuality}); err != nil {
		return err
	}
	return os.WriteFile(out, buf.Bytes(), 0o644)
}

// videoThumb grabs a frame a few seconds in (the first is often black), or the first frame of
// a short clip. ffmpeg applies the video's rotation itself.
func videoThumb(ctx context.Context, path, out string) error {
	ffmpeg, err := exec.LookPath("ffmpeg")
	if err != nil {
		return errors.New("video thumbnails need ffmpeg on the server")
	}
	ctx, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()
	scale := fmt.Sprintf("scale=%d:%d:force_original_aspect_ratio=decrease", thumbSide, thumbSide)
	for _, at := range []string{"3", "0"} {
		cmd := exec.CommandContext(ctx, ffmpeg, "-hide_banner", "-loglevel", "error", "-ss", at, "-i", path,
			"-frames:v", "1", "-vf", scale, "-q:v", "4", "-f", "image2", "-y", out)
		if err := cmd.Run(); err == nil {
			if info, err := os.Stat(out); err == nil && info.Size() > 0 {
				return nil
			}
		}
	}
	return errors.New("couldn't read a frame from this video")
}

// exifOrientation reads the EXIF orientation (1–8) of a JPEG, 1 when absent. Phone photos are
// often stored sideways with this tag saying how to turn them.
func exifOrientation(data []byte) int {
	if len(data) < 4 || data[0] != 0xFF || data[1] != 0xD8 {
		return 1
	}
	for i := 2; i+4 <= len(data); {
		if data[i] != 0xFF {
			return 1
		}
		marker := data[i+1]
		size := int(binary.BigEndian.Uint16(data[i+2:]))
		if marker == 0xDA || size < 2 { // image data starts: no EXIF before it
			return 1
		}
		seg := data[i+4 : min(len(data), i+2+size)]
		if marker == 0xE1 && len(seg) > 14 && string(seg[:6]) == "Exif\x00\x00" {
			return tiffOrientation(seg[6:])
		}
		i += 2 + size
	}
	return 1
}

func tiffOrientation(t []byte) int {
	if len(t) < 8 {
		return 1
	}
	var order binary.ByteOrder
	switch string(t[:2]) {
	case "II":
		order = binary.LittleEndian
	case "MM":
		order = binary.BigEndian
	default:
		return 1
	}
	ifd := int(order.Uint32(t[4:]))
	if ifd+2 > len(t) {
		return 1
	}
	count := int(order.Uint16(t[ifd:]))
	for e := 0; e < count; e++ {
		at := ifd + 2 + e*12
		if at+12 > len(t) {
			return 1
		}
		if order.Uint16(t[at:]) == 0x0112 {
			if v := int(order.Uint16(t[at+8:])); v >= 1 && v <= 8 {
				return v
			}
			return 1
		}
	}
	return 1
}

// orient turns a decoded image the way its EXIF orientation says.
func orient(src *image.RGBA, o int) image.Image {
	if o <= 1 {
		return src
	}
	b := src.Bounds()
	w, h := b.Dx(), b.Dy()
	dw, dh := w, h
	if o >= 5 {
		dw, dh = h, w
	}
	dst := image.NewRGBA(image.Rect(0, 0, dw, dh))
	for y := 0; y < h; y++ {
		for x := 0; x < w; x++ {
			var dx, dy int
			switch o {
			case 2:
				dx, dy = w-1-x, y
			case 3:
				dx, dy = w-1-x, h-1-y
			case 4:
				dx, dy = x, h-1-y
			case 5:
				dx, dy = y, x
			case 6:
				dx, dy = h-1-y, x
			case 7:
				dx, dy = h-1-y, w-1-x
			case 8:
				dx, dy = y, w-1-x
			}
			dst.SetRGBA(dx, dy, src.RGBAAt(x, y))
		}
	}
	return dst
}

func (s *server) handleThumb(w http.ResponseWriter, r *http.Request) {
	path, err := s.resolve(r.URL.Query().Get("path"))
	if err != nil {
		writeFSError(w, err)
		return
	}
	info, err := os.Stat(path)
	if err != nil {
		writeFSError(w, err)
		return
	}
	if info.IsDir() || onCloudDrive(path) {
		http.NotFound(w, r)
		return
	}
	file, err := s.thumbs.get(r.Context(), path, info)
	if err != nil {
		http.Error(w, err.Error(), http.StatusNotFound)
		return
	}
	// The URL carries the file's size and date (v=), so a changed file gets a new URL.
	w.Header().Set("Cache-Control", "private, max-age=604800")
	w.Header().Set("Content-Type", "image/jpeg")
	http.ServeFile(w, r, file)
}

// onCloudDrive reports whether path is on an rclone mount (see cloud.go).
func onCloudDrive(path string) bool {
	data, err := os.ReadFile("/proc/self/mounts")
	if err != nil {
		return false
	}
	best, cloud := "", false
	for _, line := range strings.Split(string(data), "\n") {
		f := strings.Fields(line)
		if len(f) < 3 {
			continue
		}
		mount := unescapeMount(f[1])
		if (path == mount || strings.HasPrefix(path, strings.TrimSuffix(mount, "/")+"/")) && len(mount) > len(best) {
			best, cloud = mount, f[2] == "fuse.rclone"
		}
	}
	return cloud
}
