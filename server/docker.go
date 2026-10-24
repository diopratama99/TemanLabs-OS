package main

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net"
	"net/http"
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
