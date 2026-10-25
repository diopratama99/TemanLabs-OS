package main

import (
	"encoding/json"
	"errors"
	"fmt"
	"io/fs"
	"log"
	"net/http"
	"net/url"
	"os"
	"os/user"
	"strconv"
	"time"
)

type server struct {
	cfg      *Config
	sessions *sessions
	limiter  *loginLimiter
	stats    *statsSampler
	docker   *dockerClient
	store    *appStore
	monitor  *containerMonitor
	frames   *frameProxies
	native   *nativeApps
	thumbs   *thumbnailer
	updates  *updateChecker
	stores   *appStores
	usb      *usbMounter
	cloud    *cloudDrives
	convert  *converter
	commands *commandStore
	playback *playbackStore
	devices  *deviceStore
	remote   *remoteEngine
	logins   *appLogins
	adblock  *adblockEngine
	meta     *fileMeta
	links    *shareLinks
	backups  *backupStore
	history  *history
	health   *healthStore
	dl       *downloader
	recorder *recorderStore
	owner    *owner
}

// owner is the configured Linux user; files created through the UI are chowned to them and the
// terminal runs as them.
type owner struct {
	name  string
	home  string
	shell string
	uid   int
	gid   int
	gids  []uint32
}

func lookupOwner(name string) (*owner, error) {
	if name == "" {
		return nil, nil
	}
	u, err := user.Lookup(name)
	if err != nil {
		return nil, err
	}
	uid, _ := strconv.Atoi(u.Uid)
	gid, _ := strconv.Atoi(u.Gid)
	o := &owner{name: u.Username, home: u.HomeDir, shell: loginShell(u.Username), uid: uid, gid: gid}
	if ids, err := u.GroupIds(); err == nil {
		for _, id := range ids {
			if n, err := strconv.Atoi(id); err == nil {
				o.gids = append(o.gids, uint32(n))
			}
		}
	}
	return o, nil
}

func newServer(cfg *Config) (*server, error) {
	if _, err := os.Stat(cfg.Root); err != nil {
		return nil, fmt.Errorf("files root %s: %w", cfg.Root, err)
	}
	o, err := lookupOwner(cfg.User)
	if err != nil {
		return nil, fmt.Errorf("user %q: %w", cfg.User, err)
	}
	docker := newDockerClient()
	s := &server{
		cfg:      cfg,
		sessions: newSessions(cfg.StateDir),
		limiter:  newLoginLimiter(),
		stats:    newStatsSampler(),
		docker:   docker,
		owner:    o,
	}
	s.store = newAppCenter(cfg, docker, o)
	s.native = newNativeApps(cfg.StateDir)
	s.thumbs = newThumbnailer(cfg.StateDir)
	s.store.native = s.native
	s.monitor = newContainerMonitor(docker)
	s.updates = newUpdateChecker(docker)
	s.stores = newAppStores(cfg.StateDir)
	s.usb = newUSBMounter(cfg.StateDir, o)
	s.cloud = newCloudDrives(cfg.StateDir, o)
	s.convert = newConverter(cfg.StateDir, s.chown)
	s.commands = newCommandStore(cfg.StateDir)
	s.playback = newPlaybackStore(cfg.StateDir)
	s.devices = newDeviceStore(cfg.StateDir)
	s.remote = newRemoteEngine(docker)
	s.logins = newAppLogins(cfg.StateDir)
	s.adblock = newAdblock(docker, cfg.StateDir)
	s.meta = newFileMeta(cfg.StateDir)
	s.links = newShareLinks(cfg.StateDir)
	s.backups = newBackupStore(cfg.StateDir)
	s.history = newHistory(cfg.StateDir)
	s.health = newHealthStore(cfg.StateDir)
	s.dl = newDownloader(cfg.StateDir)
	s.recorder = newRecorder(cfg.StateDir)
	s.frames = newFrameProxies(s)
	go s.stats.run()
	go s.pruneTrash()
	go s.runSchedule()
	go s.runHistory()
	go s.runHealth()
	go s.runDownloads()
	go s.runRecorder()
	return s, nil
}

func (s *server) routes() http.Handler {
	mux := http.NewServeMux()

	mux.HandleFunc("POST /api/login", s.handleLogin)
	mux.HandleFunc("POST /api/logout", s.handleLogout)
	mux.HandleFunc("GET /api/me", s.handleMe)
	// Unlocking works with a locked session (it has its own check).
	mux.HandleFunc("POST /api/unlock", s.handleUnlock)
	// The lock screen shows the wallpaper before anyone signs in. Names are random (64 bits) and
	// listing, uploading and deleting them still need a session.
	mux.HandleFunc("GET /api/wallpapers/{name}", s.handleGetWallpaper)
	// Share links: pages for whoever has the link, no session needed.
	mux.HandleFunc("GET /s/{id}", s.handleLinkPage)
	mux.HandleFunc("POST /s/{id}", s.handleLinkPassword)
	mux.HandleFunc("GET /s/{id}/file", s.handleLinkFile)
	mux.HandleFunc("GET /s/{id}/zip", s.handleLinkZip)
	mux.HandleFunc("POST /s/{id}/upload", s.handleLinkUpload)

	api := http.NewServeMux()
	api.HandleFunc("POST /api/password", s.handleChangePassword)
	api.HandleFunc("POST /api/lock", s.handleLock)
	api.HandleFunc("GET /api/sessions", s.handleSessions)
	api.HandleFunc("DELETE /api/sessions/{id}", s.handleEndSession)
	api.HandleFunc("POST /api/sessions/end-others", s.handleEndOtherSessions)
	api.HandleFunc("GET /api/system", s.handleSystem)
	api.HandleFunc("GET /api/store", s.handleStore)
	api.HandleFunc("GET /api/apps", s.handleApps)
	api.HandleFunc("POST /api/apps/custom", s.handleInstallCustom)
	api.HandleFunc("POST /api/apps/{id}/install", s.handleInstall)
	api.HandleFunc("POST /api/apps/{id}/start", s.handleStart)
	api.HandleFunc("POST /api/apps/{id}/stop", s.handleStop)
	api.HandleFunc("DELETE /api/apps/{id}", s.handleUninstallApp)
	api.HandleFunc("GET /api/apps/updates", s.handleAppUpdates)
	api.HandleFunc("GET /api/appstore", s.handleAppStore)
	api.HandleFunc("GET /api/appstore/apps/{id}", s.handleStoreApp)
	api.HandleFunc("POST /api/appstore/apps/{id}/install", s.handleInstallStoreApp)
	api.HandleFunc("POST /api/appstore/refresh", s.handleRefreshStores)
	api.HandleFunc("PUT /api/appstore/sources", s.handleSetStores)
	api.HandleFunc("GET /api/apps/{id}/config", s.handleAppConfig)
	api.HandleFunc("PUT /api/apps/{id}/config", s.handleSaveAppConfig)
	api.HandleFunc("POST /api/apps/{id}/update", s.handleUpdateApp)
	api.HandleFunc("GET /api/apps/{id}/frame", s.handleAppFrame)
	api.HandleFunc("GET /api/apps/{id}/icon", s.handleAppIcon)
	api.HandleFunc("GET /api/services", s.handleServices)
	api.HandleFunc("POST /api/services/{unit}/{action}", s.handleServiceAction)
	api.HandleFunc("GET /api/services/{unit}/logs", s.handleServiceLogs)
	api.HandleFunc("GET /api/processes", s.handleProcesses)
	api.HandleFunc("GET /api/jobs/{kind}", s.handleJob)
	api.HandleFunc("GET /api/k8s", s.handleK8s)
	api.HandleFunc("POST /api/k8s/install", s.handleK8sInstall)
	api.HandleFunc("POST /api/k8s/uninstall", s.handleK8sUninstall)
	api.HandleFunc("GET /api/k8s/resources", s.handleK8sResources)
	api.HandleFunc("POST /api/k8s/action", s.handleK8sAction)
	api.HandleFunc("GET /api/k8s/text/{view}", s.handleK8sText)
	api.HandleFunc("GET /api/k8s/rollout", s.handleK8sRollout)
	api.HandleFunc("GET /api/updates", s.handleUpdates)
	api.HandleFunc("POST /api/updates/check", s.handleUpdatesCheck)
	api.HandleFunc("POST /api/updates/install", s.handleUpdatesInstall)
	api.HandleFunc("POST /api/power/{action}", s.handlePower)
	api.HandleFunc("GET /api/time", s.handleTime)
	api.HandleFunc("POST /api/time", s.handleTimeSet)
	api.HandleFunc("GET /api/logs", s.handleLogs)
	api.HandleFunc("GET /api/disks", s.handleDisks)
	api.HandleFunc("POST /api/disks/mount", s.handleMount)
	api.HandleFunc("POST /api/disks/automount", s.handleAutomount)
	api.HandleFunc("POST /api/disks/format", s.handleFormat)
	api.HandleFunc("POST /api/disks/eject", s.handleEject)
	api.HandleFunc("GET /api/storage", s.handleStorage)
	api.HandleFunc("POST /api/storage/merge", s.handleMerge)
	api.HandleFunc("DELETE /api/storage/merge/{name}", s.handleUnmerge)
	api.HandleFunc("POST /api/storage/mergerfs", s.handleInstallMergerfs)
	api.HandleFunc("PUT /api/storage/usb", s.handleUSBSetting)
	api.HandleFunc("GET /api/cloud", s.handleCloud)
	api.HandleFunc("GET /api/system/hardware", s.handleHardware)
	api.HandleFunc("GET /api/system/history", s.handleHistory)
	api.HandleFunc("GET /api/health", s.handleHealth)
	api.HandleFunc("GET /api/apps/{id}/move", s.handleMovePreview)
	api.HandleFunc("POST /api/apps/{id}/move", s.handleMoveToDocker)
	api.HandleFunc("GET /api/moved", s.handleMovedApps)
	api.HandleFunc("POST /api/moved/{project}/back", s.handleMoveBack)
	api.HandleFunc("PUT /api/health/{id}", s.handleSetHealth)
	api.HandleFunc("GET /api/startup", s.handleStartupApps)
	api.HandleFunc("PUT /api/startup/{id}", s.handleSetStartupApp)
	api.HandleFunc("GET /api/system/release", s.handleReleaseStatus)
	api.HandleFunc("POST /api/system/release/install", s.handleSelfUpdate)
	api.HandleFunc("POST /api/cloud", s.handleAddCloud)
	api.HandleFunc("POST /api/cloud/auth", s.handleCloudAuth)
	api.HandleFunc("POST /api/cloud/{name}/{action}", s.handleCloudAction)
	api.HandleFunc("DELETE /api/cloud/{name}", s.handleRemoveCloud)
	api.HandleFunc("GET /api/convert", s.handleConvert)
	api.HandleFunc("GET /api/convert/probe", s.handleConvertProbe)
	api.HandleFunc("POST /api/convert", s.handleConvertStart)
	api.HandleFunc("DELETE /api/convert/tasks", s.handleConvertClear)
	api.HandleFunc("DELETE /api/convert/tasks/{id}", s.handleConvertCancel)
	api.HandleFunc("POST /api/convert/ffmpeg", s.handleInstallFFmpeg)
	api.HandleFunc("GET /api/commands", s.handleCommands)
	api.HandleFunc("GET /api/media/position", s.handleGetPosition)
	api.HandleFunc("PUT /api/media/position", s.handleSetPosition)
	api.HandleFunc("PUT /api/apps/{id}/signin", s.handleAppSignIn)
	api.HandleFunc("DELETE /api/apps/{id}/signin", s.handleAppSignOut)
	api.HandleFunc("GET /api/adblock", s.handleAdblock)
	api.HandleFunc("POST /api/adblock/install", s.handleAdblockInstall)
	api.HandleFunc("POST /api/adblock/protection", s.handleAdblockProtection)
	api.HandleFunc("POST /api/adblock/allow", s.handleAdblockAllow)
	api.HandleFunc("DELETE /api/adblock/allow", s.handleAdblockAllow)
	api.HandleFunc("POST /api/adblock/test", s.handleAdblockTest)
	api.HandleFunc("POST /api/adblock/list", s.handleAdblockList)
	api.HandleFunc("DELETE /api/adblock", s.handleAdblockRemove)
	api.HandleFunc("GET /api/devices", s.handleListDevices)
	api.HandleFunc("POST /api/devices", s.handleCreateDevice)
	api.HandleFunc("GET /api/devices/status", s.handleDeviceStatus)
	api.HandleFunc("GET /api/devices/discover", s.handleDiscover)
	api.HandleFunc("GET /api/devices/mac", s.handleLookupMAC)
	api.HandleFunc("POST /api/devices/engine", s.handleInstallRemote)
	api.HandleFunc("PUT /api/devices/{id}", s.handleUpdateDevice)
	api.HandleFunc("DELETE /api/devices/{id}", s.handleDeleteDevice)
	api.HandleFunc("POST /api/devices/{id}/wake", s.handleWakeDevice)
	api.HandleFunc("PUT /api/commands/book", s.handleSaveCommands)
	api.HandleFunc("GET /api/disks/usage", s.handleUsage)
	api.HandleFunc("GET /api/network/interfaces", s.handleInterfaces)
	api.HandleFunc("POST /api/network/tool", s.handleNetTool)
	api.HandleFunc("GET /api/network/dns", s.handleDNS)
	api.HandleFunc("GET /api/network/connections", s.handleConnections)
	api.HandleFunc("GET /api/firewall", s.handleFirewall)
	api.HandleFunc("POST /api/firewall", s.handleFirewallChange)
	api.HandleFunc("GET /api/cron", s.handleCron)
	api.HandleFunc("PUT /api/cron/{user}", s.handleCronSave)
	api.HandleFunc("POST /api/cron/run", s.handleCronRun)
	api.HandleFunc("GET /api/users", s.handleUsers)
	api.HandleFunc("POST /api/users", s.handleUserCreate)
	api.HandleFunc("POST /api/users/{name}", s.handleUserChange)
	api.HandleFunc("DELETE /api/users/{name}", s.handleUserDelete)
	api.HandleFunc("GET /api/smb", s.handleSmb)
	api.HandleFunc("GET /api/smb/status", s.handleSmbStatus)
	api.HandleFunc("POST /api/smb/restart", s.handleSmbRestart)
	api.HandleFunc("POST /api/smb/shares", s.handleSmbShareSave)
	api.HandleFunc("PUT /api/smb/shares/{name}", s.handleSmbShareSave)
	api.HandleFunc("DELETE /api/smb/shares/{name}", s.handleSmbShareDelete)
	api.HandleFunc("POST /api/smb/users", s.handleSmbUserAdd)
	api.HandleFunc("POST /api/smb/users/{name}/{action}", s.handleSmbUserAction)
	api.HandleFunc("GET /api/containers", s.handleContainers)
	api.HandleFunc("GET /api/networks", s.handleNetworks)
	api.HandleFunc("GET /api/ports", s.handlePorts)
	api.HandleFunc("POST /api/processes/{pid}/kill", s.handleKillProcess)
	api.HandleFunc("GET /api/wallpapers", s.handleListWallpapers)
	api.HandleFunc("POST /api/wallpapers", s.handleUploadWallpaper)
	api.HandleFunc("POST /api/wallpapers/from-file", s.handleWallpaperFromFile)
	api.HandleFunc("DELETE /api/wallpapers/{name}", s.handleDeleteWallpaper)
	api.HandleFunc("POST /api/containers/{id}/{action}", s.handleContainerAction)
	api.HandleFunc("GET /api/containers/{id}/logs", s.handleContainerLogs)
	api.HandleFunc("GET /api/files", s.handleListFiles)
	api.HandleFunc("POST /api/files", s.handleCreateFile)
	api.HandleFunc("DELETE /api/files", s.handleDelete)
	api.HandleFunc("POST /api/files/folders", s.handleCreateFolder)
	api.HandleFunc("POST /api/files/rename", s.handleRename)
	api.HandleFunc("POST /api/files/copy", s.handleCopy)
	api.HandleFunc("GET /api/files/content", s.handleReadFile)
	api.HandleFunc("GET /api/files/raw", s.handleRawFile)
	api.HandleFunc("GET /api/files/thumb", s.handleThumb)
	api.HandleFunc("GET /api/files/info", s.handleFileInfo)
	api.HandleFunc("PUT /api/files/content", s.handleWriteFile)
	api.HandleFunc("GET /api/files/search", s.handleSearch)
	api.HandleFunc("GET /api/files/tree", s.handleTree)
	api.HandleFunc("POST /api/files/upload", s.handleUpload)
	api.HandleFunc("GET /api/files/tags", s.handleTags)
	api.HandleFunc("PUT /api/files/tags", s.handleSetTags)
	api.HandleFunc("GET /api/files/tagged", s.handleTagged)
	api.HandleFunc("GET /api/files/recents", s.handleRecents)
	api.HandleFunc("POST /api/files/recents", s.handleAddRecent)
	api.HandleFunc("GET /api/backups", s.handleBackups)
	api.HandleFunc("POST /api/backups", s.handleCreateBackup)
	api.HandleFunc("POST /api/backups/install", s.handleInstallRestic)
	api.HandleFunc("GET /api/backups/key", s.handleRecoveryKey)
	api.HandleFunc("PUT /api/backups/key", s.handleSetRecoveryKey)
	api.HandleFunc("GET /api/backups/destinations", s.handleBackupDestinations)
	api.HandleFunc("GET /api/backups/apps", s.handleBackupApps)
	api.HandleFunc("PUT /api/backups/{id}", s.handleUpdateBackup)
	api.HandleFunc("DELETE /api/backups/{id}", s.handleDeleteBackup)
	api.HandleFunc("POST /api/backups/{id}/run", s.handleRunBackup)
	api.HandleFunc("POST /api/backups/{id}/stop", s.handleStopBackup)
	api.HandleFunc("GET /api/backups/{id}/versions", s.handleBackupVersions)
	api.HandleFunc("GET /api/backups/{id}/versions/{version}/files", s.handleVersionFiles)
	api.HandleFunc("POST /api/backups/{id}/restore", s.handleRestore)
	api.HandleFunc("GET /api/media-tools", s.handleMediaTools)
	api.HandleFunc("POST /api/media-tools/install", s.handleInstallMediaTools)
	api.HandleFunc("GET /api/downloads", s.handleDownloads)
	api.HandleFunc("POST /api/downloads", s.handleAddDownloads)
	api.HandleFunc("DELETE /api/downloads", s.handleClearDownloads)
	api.HandleFunc("PUT /api/downloads/settings", s.handleDownloadSettings)
	api.HandleFunc("PUT /api/downloads/cookies", s.handleDownloadCookies)
	api.HandleFunc("DELETE /api/downloads/cookies", s.handleDownloadCookies)
	api.HandleFunc("POST /api/downloads/cookies/check", s.handleCheckCookies)
	api.HandleFunc("POST /api/downloads/browse", s.handleBrowse)
	api.HandleFunc("GET /api/downloads/browse/{list}/thumb/{index}", s.handleBrowseThumb)
	api.HandleFunc("POST /api/downloads/browse/{list}/pick", s.handleBrowsePick)
	api.HandleFunc("GET /api/downloads/{id}/file", s.handleDownloadFile)
	api.HandleFunc("POST /api/downloads/{id}/{action}", s.handleDownloadAction)
	api.HandleFunc("DELETE /api/downloads/{id}", s.handleRemoveDownload)
	api.HandleFunc("GET /api/recorder", s.handleRecorder)
	api.HandleFunc("PUT /api/recorder/settings", s.handleRecorderSettings)
	api.HandleFunc("POST /api/recorder/channels", s.handleAddChannel)
	api.HandleFunc("PUT /api/recorder/channels/{id}", s.handleUpdateChannel)
	api.HandleFunc("DELETE /api/recorder/channels/{id}", s.handleDeleteChannel)
	api.HandleFunc("POST /api/recorder/channels/{id}/{action}", s.handleChannelAction)
	api.HandleFunc("DELETE /api/recorder/recordings/{id}", s.handleDeleteRecording)
	api.HandleFunc("GET /api/links", s.handleListLinks)
	api.HandleFunc("POST /api/links", s.handleCreateLink)
	api.HandleFunc("PUT /api/links/settings", s.handleLinkSettings)
	api.HandleFunc("DELETE /api/links/{id}", s.handleDeleteLink)
	api.HandleFunc("GET /api/trash", s.handleTrashList)
	api.HandleFunc("POST /api/trash", s.handleMoveToTrash)
	api.HandleFunc("POST /api/trash/restore", s.handleTrashRestore)
	api.HandleFunc("DELETE /api/trash/{id}", s.handleTrashDelete)
	api.HandleFunc("DELETE /api/trash", s.handleEmptyTrash)
	api.HandleFunc("GET /ws/terminal", s.handleTerminal)
	api.HandleFunc("GET /ws/apps/{id}/terminal", s.handleAppTerminal)
	api.HandleFunc("GET /ws/remote/{id}", s.handleRemoteTunnel)

	mux.Handle("/api/", s.requireAuth(api))
	mux.Handle("/ws/", s.requireAuth(api))
	mux.Handle("/", staticHandler())
	return logRequests(sameOrigin(mux))
}

// sameOrigin rejects state-changing requests sent from other sites. The session cookie is
// SameSite=Lax as well; this is the second line of defence.
func sameOrigin(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet && r.Method != http.MethodHead {
			if origin := r.Header.Get("Origin"); origin != "" {
				u, err := url.Parse(origin)
				if err != nil || u.Host != r.Host {
					writeError(w, http.StatusForbidden, "cross-origin request refused")
					return
				}
			}
		}
		next.ServeHTTP(w, r)
	})
}

type statusRecorder struct {
	http.ResponseWriter
	status int
}

func (r *statusRecorder) WriteHeader(code int) {
	r.status = code
	r.ResponseWriter.WriteHeader(code)
}

// Unwrap lets http.ResponseController (used by the WebSocket upgrade) reach the real writer.
func (r *statusRecorder) Unwrap() http.ResponseWriter { return r.ResponseWriter }

func logRequests(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		start := time.Now()
		rec := &statusRecorder{ResponseWriter: w, status: http.StatusOK}
		next.ServeHTTP(rec, r)
		// Polling endpoints would flood the journal; only log what changes something, or fails.
		if r.Method != http.MethodGet || rec.status >= 400 {
			log.Printf("%s %s %d %s", r.Method, r.URL.Path, rec.status, time.Since(start).Round(time.Millisecond))
		}
	})
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

func writeError(w http.ResponseWriter, status int, message string) {
	writeJSON(w, status, map[string]string{"error": message})
}

// writeFSError maps filesystem errors to HTTP statuses with a message the UI can show.
func writeFSError(w http.ResponseWriter, err error) {
	var pathErr *fs.PathError
	msg := err.Error()
	if errors.As(err, &pathErr) {
		msg = fmt.Sprintf("%s: %s", pathErr.Path, pathErr.Err)
	}
	switch {
	case errors.Is(err, errOutsideRoot), errors.Is(err, errBadName):
		writeError(w, http.StatusBadRequest, msg)
	case errors.Is(err, fs.ErrNotExist):
		writeError(w, http.StatusNotFound, msg)
	case errors.Is(err, fs.ErrExist):
		writeError(w, http.StatusConflict, msg)
	case errors.Is(err, fs.ErrPermission):
		writeError(w, http.StatusForbidden, msg)
	default:
		writeError(w, http.StatusInternalServerError, msg)
	}
}

func decodeJSON(r *http.Request, v any) error {
	r.Body = http.MaxBytesReader(nil, r.Body, 1<<20)
	return json.NewDecoder(r.Body).Decode(v)
}
