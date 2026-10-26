package main

import (
	"log"
	"os"
	"path/filepath"
)

// dataFolders are the folders CasaOS keeps user data in. Files, the Downloader, the recorder and
// App Center all use them, so a server without /DATA (a fresh one, not moved over from CasaOS)
// gets them on its first start, owned by the configured user.
var dataFolders = []string{"AppData", "Documents", "Downloads", "Gallery", "Media"}

// ensureDataRoot creates /DATA and its folders when there's no /DATA yet; an existing one is left
// as it is.
func ensureDataRoot(o *owner) {
	if os.Geteuid() != 0 {
		return
	}
	if _, err := os.Lstat(appDataRoot); !os.IsNotExist(err) {
		return
	}
	for _, dir := range append([]string{appDataRoot}, dataFolders...) {
		if dir != appDataRoot {
			dir = filepath.Join(appDataRoot, dir)
		}
		if err := os.Mkdir(dir, 0o755); err != nil {
			log.Printf("data folders: %v", err)
			return
		}
		if o != nil {
			_ = os.Chown(dir, o.uid, o.gid)
		}
	}
	log.Printf("created %s for user data", appDataRoot)
}
