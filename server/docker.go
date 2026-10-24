package main

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"strings"
	"time"
)

const dockerSocket = "/var/run/docker.sock"

// dockerClient talks to the Docker Engine API over its Unix socket.
type dockerClient struct {
	http *http.Client
}

func newDockerClient() *dockerClient {
	transport := &http.Transport{
		DialContext: func(ctx context.Context, _, _ string) (net.Conn, error) {
			return (&net.Dialer{}).DialContext(ctx, "unix", dockerSocket)
		},
	}
	return &dockerClient{http: &http.Client{Transport: transport, Timeout: 60 * time.Second}}
}

type containerPort struct {
	IP          string `json:"IP"`
	PrivatePort int    `json:"PrivatePort"`
	PublicPort  int    `json:"PublicPort"`
	Type        string `json:"Type"`
}

type container struct {
	ID     string            `json:"Id"`
	Names  []string          `json:"Names"`
	Image  string            `json:"Image"`
	State  string            `json:"State"`
	Labels map[string]string `json:"Labels"`
	Ports  []containerPort   `json:"Ports"`
}

func (c container) name() string {
	if len(c.Names) == 0 {
		return c.ID[:12]
	}
	return c.Names[0][1:]
}

func (d *dockerClient) do(ctx context.Context, method, path string, out any) error {
	req, err := http.NewRequestWithContext(ctx, method, "http://docker"+path, nil)
	if err != nil {
		return err
	}
	res, err := d.http.Do(req)
	if err != nil {
		return fmt.Errorf("docker: %w", err)
	}
	defer res.Body.Close()
	if res.StatusCode >= 300 && res.StatusCode != http.StatusNotModified {
		var body struct {
			Message string `json:"message"`
		}
		data, _ := io.ReadAll(res.Body)
		if json.Unmarshal(data, &body) == nil && body.Message != "" {
			return fmt.Errorf("docker: %s", body.Message)
		}
		return fmt.Errorf("docker: %s %s: %s", method, path, res.Status)
	}
	if out != nil {
		return json.NewDecoder(res.Body).Decode(out)
	}
	return nil
}

// send is do with a JSON request body.
func (d *dockerClient) send(ctx context.Context, method, path string, body, out any) error {
	data, err := json.Marshal(body)
	if err != nil {
		return err
	}
	req, err := http.NewRequestWithContext(ctx, method, "http://docker"+path, bytes.NewReader(data))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	res, err := d.http.Do(req)
	if err != nil {
		return fmt.Errorf("docker: %w", err)
	}
	defer res.Body.Close()
	if res.StatusCode >= 300 {
		var msg struct {
			Message string `json:"message"`
		}
		raw, _ := io.ReadAll(res.Body)
		if json.Unmarshal(raw, &msg) == nil && msg.Message != "" {
			return fmt.Errorf("docker: %s", msg.Message)
		}
		return fmt.Errorf("docker: %s %s: %s", method, path, res.Status)
	}
	if out != nil {
		return json.NewDecoder(res.Body).Decode(out)
	}
	return nil
}

// pull downloads an image, reporting progress lines (one per layer state change) to logf.
func (d *dockerClient) pull(ctx context.Context, image string, logf func(string, ...any)) error {
	repo, tag := splitImage(image)
	if tag == "" && !strings.Contains(repo, "@") {
		tag = "latest"
	}
	q := url.Values{"fromImage": {repo}}
	if tag != "" {
		q.Set("tag", tag)
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, "http://docker/images/create?"+q.Encode(), nil)
	if err != nil {
		return err
	}
	// Pulls can outlast the client's usual timeout.
	client := &http.Client{Transport: d.http.Transport}
	res, err := client.Do(req)
	if err != nil {
		return fmt.Errorf("docker: %w", err)
	}
	defer res.Body.Close()
	if res.StatusCode >= 300 {
		raw, _ := io.ReadAll(res.Body)
		return fmt.Errorf("docker pull %s: %s", image, strings.TrimSpace(string(raw)))
	}
	dec := json.NewDecoder(res.Body)
	last := map[string]string{}
	for {
		var msg struct {
			ID     string `json:"id"`
			Status string `json:"status"`
			Error  string `json:"error"`
		}
		if err := dec.Decode(&msg); err == io.EOF {
			return nil
		} else if err != nil {
			return err
		}
		if msg.Error != "" {
			return errors.New(msg.Error)
		}
		// Progress ticks repeat the same status; log each change once.
		if last[msg.ID] != msg.Status {
			last[msg.ID] = msg.Status
			if msg.ID != "" {
				logf("%s: %s", msg.ID, msg.Status)
			} else {
				logf("%s", msg.Status)
			}
		}
	}
}

func (d *dockerClient) containers(ctx context.Context) ([]container, error) {
	var list []container
	err := d.do(ctx, http.MethodGet, "/containers/json?all=1", &list)
	return list, err
}

// startContainer and stopContainer treat "already started/stopped" (304) as success.
func (d *dockerClient) startContainer(ctx context.Context, id string) error {
	return d.do(ctx, http.MethodPost, "/containers/"+id+"/start", nil)
}

func (d *dockerClient) stopContainer(ctx context.Context, id string) error {
	return d.do(ctx, http.MethodPost, "/containers/"+id+"/stop?t=15", nil)
}
