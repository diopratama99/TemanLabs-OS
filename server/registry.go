package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"regexp"
	"strings"
	"sync"
	"time"
)

// Update checks: an image has an update when the registry's current digest for its tag isn't
// one of the digests Docker recorded when the image was pulled. Only manifest HEAD requests are
// made, which Docker Hub doesn't count against its pull limits.

const updateCheckEvery = 6 * time.Hour

var manifestTypes = strings.Join([]string{
	"application/vnd.oci.image.index.v1+json",
	"application/vnd.docker.distribution.manifest.list.v2+json",
	"application/vnd.docker.distribution.manifest.v2+json",
	"application/vnd.oci.image.manifest.v1+json",
}, ", ")

type imageStatus struct {
	Image     string `json:"image"`
	Available bool   `json:"available"`
	// Built on this server (no registry digest), so there is nothing to compare with.
	Local   bool      `json:"local,omitempty"`
	Error   string    `json:"error,omitempty"`
	Checked time.Time `json:"checked"`
}

type updateChecker struct {
	docker *dockerClient
	http   *http.Client

	mu       sync.Mutex
	results  map[string]imageStatus
	checking bool
	last     time.Time
}

func newUpdateChecker(docker *dockerClient) *updateChecker {
	return &updateChecker{docker: docker, http: &http.Client{Timeout: 20 * time.Second}, results: map[string]imageStatus{}}
}

func (u *updateChecker) forget(images []string) {
	u.mu.Lock()
	defer u.mu.Unlock()
	for _, img := range images {
		delete(u.results, img)
	}
}

// refresh checks images in the background unless a check is running; stale only rechecks when
// the last check is older than updateCheckEvery or an image was never checked.
func (u *updateChecker) refresh(images []string, force bool) {
	u.mu.Lock()
	if u.checking {
		u.mu.Unlock()
		return
	}
	var todo []string
	for _, img := range images {
		r, ok := u.results[img]
		if force || !ok || time.Since(r.Checked) > updateCheckEvery {
			todo = append(todo, img)
		}
	}
	if len(todo) == 0 {
		u.mu.Unlock()
		return
	}
	u.checking = true
	u.mu.Unlock()

	go func() {
		results := make(chan imageStatus)
		sem := make(chan struct{}, 4)
		for _, img := range todo {
			go func() {
				sem <- struct{}{}
				defer func() { <-sem }()
				ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
				defer cancel()
				results <- u.check(ctx, img)
			}()
		}
		for range todo {
			r := <-results
			u.mu.Lock()
			u.results[r.Image] = r
			u.mu.Unlock()
		}
		u.mu.Lock()
		u.checking, u.last = false, time.Now()
		u.mu.Unlock()
	}()
}

func (u *updateChecker) check(ctx context.Context, image string) imageStatus {
	st := imageStatus{Image: image, Checked: time.Now()}
	var local struct {
		RepoDigests []string `json:"RepoDigests"`
	}
	if err := u.docker.do(ctx, http.MethodGet, "/images/"+image+"/json", &local); err != nil {
		st.Error = err.Error()
		return st
	}
	if len(local.RepoDigests) == 0 {
		st.Local = true
		return st
	}
	remote, err := u.remoteDigest(ctx, image)
	if errors.Is(err, errNotInRegistry) {
		// Built here, or gone from its registry: nothing newer to get.
		st.Local = true
		return st
	}
	if err != nil {
		st.Error = err.Error()
		return st
	}
	st.Available = true
	for _, d := range local.RepoDigests {
		if _, digest, ok := strings.Cut(d, "@"); ok && digest == remote {
			st.Available = false
		}
	}
	return st
}

// parseImageRef splits an image reference into registry host, repository and tag.
func parseImageRef(image string) (host, repo, tag string, err error) {
	name, tag := splitImage(image)
	if strings.Contains(name, "@") {
		return "", "", "", errors.New("pinned to a digest")
	}
	if tag == "" {
		tag = "latest"
	}
	first, rest, found := strings.Cut(name, "/")
	if found && (strings.ContainsAny(first, ".:") || first == "localhost") {
		host, repo = first, rest
	} else {
		host, repo = "registry-1.docker.io", name
		if !strings.Contains(repo, "/") {
			repo = "library/" + repo
		}
	}
	if host == "docker.io" || host == "index.docker.io" {
		host = "registry-1.docker.io"
	}
	return host, repo, tag, nil
}

// errNotInRegistry: the registry doesn't have the image (or not publicly).
var errNotInRegistry = errors.New("not in a public registry")

var challengeParam = regexp.MustCompile(`(\w+)="([^"]*)"`)

func (u *updateChecker) remoteDigest(ctx context.Context, image string) (string, error) {
	host, repo, tag, err := parseImageRef(image)
	if err != nil {
		return "", err
	}
	target := fmt.Sprintf("https://%s/v2/%s/manifests/%s", host, repo, tag)
	token := ""
	for attempt := 0; attempt < 2; attempt++ {
		for _, method := range []string{http.MethodHead, http.MethodGet} {
			req, _ := http.NewRequestWithContext(ctx, method, target, nil)
			req.Header.Set("Accept", manifestTypes)
			if token != "" {
				req.Header.Set("Authorization", "Bearer "+token)
			}
			res, err := u.http.Do(req)
			if err != nil {
				if host == "localhost" || strings.HasPrefix(host, "localhost:") || strings.HasPrefix(host, "127.") {
					return "", errNotInRegistry
				}
				return "", err
			}
			res.Body.Close()
			switch {
			case res.StatusCode == http.StatusUnauthorized && token == "":
				if token, err = u.token(ctx, res.Header.Get("WWW-Authenticate")); err != nil {
					return "", err
				}
			case res.StatusCode == http.StatusMethodNotAllowed && method == http.MethodHead:
				continue
			case res.StatusCode >= 300:
				if res.StatusCode == http.StatusNotFound || res.StatusCode == http.StatusUnauthorized {
					return "", errNotInRegistry
				}
				return "", fmt.Errorf("%s: %s", host, res.Status)
			default:
				if d := res.Header.Get("Docker-Content-Digest"); d != "" {
					return d, nil
				}
				return "", fmt.Errorf("%s didn't say which version is current", host)
			}
			break
		}
	}
	return "", errNotInRegistry
}

// token fetches an anonymous pull token from the realm a registry's 401 points to.
func (u *updateChecker) token(ctx context.Context, challenge string) (string, error) {
	scheme, params, _ := strings.Cut(challenge, " ")
	if !strings.EqualFold(scheme, "Bearer") {
		return "", errors.New("registry needs a login")
	}
	values := url.Values{}
	realm := ""
	for _, m := range challengeParam.FindAllStringSubmatch(params, -1) {
		if m[1] == "realm" {
			realm = m[2]
		} else {
			values.Set(m[1], m[2])
		}
	}
	if !strings.HasPrefix(realm, "https://") {
		return "", errors.New("registry sent no token address")
	}
	req, _ := http.NewRequestWithContext(ctx, http.MethodGet, realm+"?"+values.Encode(), nil)
	res, err := u.http.Do(req)
	if err != nil {
		return "", err
	}
	defer res.Body.Close()
	var body struct {
		Token       string `json:"token"`
		AccessToken string `json:"access_token"`
	}
	if res.StatusCode >= 300 || json.NewDecoder(res.Body).Decode(&body) != nil {
		return "", errors.New("registry refused anonymous access (private image?)")
	}
	if body.Token != "" {
		return body.Token, nil
	}
	return body.AccessToken, nil
}

// appImages are the images an app's containers were created from (by name; image IDs are skipped).
func appImages(a *app) []string {
	var out []string
	for _, c := range a.containers {
		if c.Image != "" && !strings.HasPrefix(c.Image, "sha256:") && !containsString(out, c.Image) {
			out = append(out, c.Image)
		}
	}
	return out
}

func containsString(list []string, s string) bool {
	for _, v := range list {
		if v == s {
			return true
		}
	}
	return false
}

type appUpdate struct {
	Available bool          `json:"available"`
	Images    []imageStatus `json:"images"`
}

// handleAppUpdates reports which apps have newer images, starting a check when results are old.
func (s *server) handleAppUpdates(w http.ResponseWriter, r *http.Request) {
	apps, err := s.store.listApps(r.Context())
	if err != nil {
		writeError(w, http.StatusBadGateway, err.Error())
		return
	}
	var all []string
	for _, a := range apps {
		if a.Source != "native" {
			all = append(all, appImages(a)...)
		}
	}
	s.updates.refresh(all, r.URL.Query().Get("refresh") == "1")

	s.updates.mu.Lock()
	defer s.updates.mu.Unlock()
	out := map[string]appUpdate{}
	for _, a := range apps {
		if a.Source == "native" {
			continue
		}
		var u appUpdate
		for _, img := range appImages(a) {
			if st, ok := s.updates.results[img]; ok {
				u.Images = append(u.Images, st)
				u.Available = u.Available || st.Available
			}
		}
		if u.Images != nil {
			out[a.ID] = u
		}
	}
	writeJSON(w, http.StatusOK, map[string]any{"checking": s.updates.checking, "checked": s.updates.last, "apps": out})
}
