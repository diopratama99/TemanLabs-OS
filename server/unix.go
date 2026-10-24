package main

import (
	"io/fs"
	"os"
	"strings"
	"syscall"
)

type fileOwner struct{ uid, gid int }

func statOwner(info fs.FileInfo) (fileOwner, bool) {
	st, ok := info.Sys().(*syscall.Stat_t)
	if !ok {
		return fileOwner{}, false
	}
	return fileOwner{uid: int(st.Uid), gid: int(st.Gid)}, true
}

// loginShell reads the user's shell from /etc/passwd (os/user doesn't expose it).
func loginShell(username string) string {
	data, _ := os.ReadFile("/etc/passwd")
	for _, line := range strings.Split(string(data), "\n") {
		f := strings.Split(line, ":")
		if len(f) >= 7 && f[0] == username && f[6] != "" {
			return f[6]
		}
	}
	return "/bin/bash"
}
