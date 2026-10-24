package main

import (
	"errors"
	"fmt"
	"io"
	"io/fs"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"syscall"
)

// Copy, Cut and Paste in Files. Pasting where a name is taken keeps both:
// "photo copy.jpg", "photo copy 2.jpg".

// copyName is the name a pasted item gets in dir: its own, or "name copy N".
func copyName(dir, name string) string {
	ext := filepath.Ext(name)
	stem := strings.TrimSuffix(name, ext)
	if ext == name { // ".bashrc"
		stem, ext = name, ""
	}
	return uniqueName(dir, name, func(n int) string {
		if n == 2 {
			return stem + " copy" + ext
		}
		return fmt.Sprintf("%s copy %d%s", stem, n-1, ext)
	})
}

// copyTree copies a file or folder (recursively), keeping permissions; every new item gets its
// owner from the folder it lands in, as files created through the UI do.
func (s *server) copyTree(src, dst string) error {
	info, err := os.Lstat(src)
	if err != nil {
		return err
	}
	switch {
	case info.Mode()&fs.ModeSymlink != 0:
		target, err := os.Readlink(src)
		if err != nil {
			return err
		}
		if err := os.Symlink(target, dst); err != nil {
			return err
		}
	case info.IsDir():
		if err := os.Mkdir(dst, info.Mode().Perm()); err != nil {
			return err
		}
		s.chown(dst)
		entries, err := os.ReadDir(src)
		if err != nil {
			return err
		}
		for _, e := range entries {
			if err := s.copyTree(filepath.Join(src, e.Name()), filepath.Join(dst, e.Name())); err != nil {
				return err
			}
		}
		return nil
	case info.Mode().IsRegular():
		in, err := os.Open(src)
		if err != nil {
			return err
		}
		defer in.Close()
		out, err := os.OpenFile(dst, os.O_CREATE|os.O_EXCL|os.O_WRONLY, info.Mode().Perm())
		if err != nil {
			return err
		}
		_, copyErr := io.Copy(out, in)
		if err := errors.Join(copyErr, out.Close()); err != nil {
			os.Remove(dst)
			return err
		}
	default:
		return fmt.Errorf("%s: can’t copy special files", filepath.Base(src))
	}
	s.chown(dst)
	return nil
}

func (s *server) handleCopy(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Paths []string `json:"paths"`
		To    string   `json:"to"`
		Move  bool     `json:"move"`
	}
	if decodeJSON(r, &body) != nil || len(body.Paths) == 0 {
		writeError(w, http.StatusBadRequest, "invalid request")
		return
	}
	to, err := s.resolve(body.To)
	if err != nil {
		writeFSError(w, err)
		return
	}
	if info, err := os.Stat(to); err != nil || !info.IsDir() {
		writeError(w, http.StatusBadRequest, "paste into a folder")
		return
	}
	var names []string
	for _, p := range body.Paths {
		src, err := s.resolve(p)
		if err != nil {
			writeFSError(w, err)
			return
		}
		if _, err := os.Lstat(src); err != nil {
			writeFSError(w, err)
			return
		}
		// A folder can't go inside itself.
		if to == src || strings.HasPrefix(to, src+"/") {
			writeError(w, http.StatusBadRequest, fmt.Sprintf("can’t put %s inside itself", filepath.Base(src)))
			return
		}
		if body.Move {
			if err := s.checkModifiable(src); err != nil {
				writeFSError(w, err)
				return
			}
			// Moving to the folder it's already in does nothing.
			if filepath.Dir(src) == to {
				names = append(names, filepath.Base(src))
				continue
			}
		}
		name := copyName(to, filepath.Base(src))
		dst := filepath.Join(to, name)
		if body.Move {
			err = os.Rename(src, dst)
			// Across disks rename fails; copy, then remove the original.
			if errors.Is(err, syscall.EXDEV) {
				if err = s.copyTree(src, dst); err == nil {
					err = os.RemoveAll(src)
				}
			}
		} else {
			err = s.copyTree(src, dst)
		}
		if err != nil {
			writeFSError(w, err)
			return
		}
		if body.Move {
			s.meta.moved(src, dst)
		}
		names = append(names, name)
	}
	writeJSON(w, http.StatusOK, map[string][]string{"names": names})
}
