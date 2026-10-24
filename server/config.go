package main

import (
	"crypto/pbkdf2"
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strconv"
	"strings"
)

type Config struct {
	// Address to listen on. CasaOS uses :80, so the default stays out of its way.
	Addr string `json:"addr"`
	// Root of the file manager and code editor. "/" is the whole filesystem, like CasaOS's file
	// manager; set e.g. "/DATA" to keep it to user data.
	Root string `json:"root"`
	// Linux user the terminal runs as and who owns files created through the UI.
	User string `json:"user"`
	// Where TemanLabsOS keeps compose files for apps it installs.
	StateDir     string `json:"stateDir"`
	PasswordHash string `json:"passwordHash"`

	path string
}

func loadConfig(path string) (*Config, error) {
	cfg := &Config{
		Addr:     ":7700",
		Root:     "/",
		User:     "",
		StateDir: filepath.Dir(path),
		path:     path,
	}
	data, err := os.ReadFile(path)
	if err != nil && !errors.Is(err, os.ErrNotExist) {
		return nil, err
	}
	if err == nil {
		if err := json.Unmarshal(data, cfg); err != nil {
			return nil, fmt.Errorf("%s: %w", path, err)
		}
	}
	cfg.Root = filepath.Clean(cfg.Root)
	return cfg, nil
}

func (c *Config) save() error {
	if err := os.MkdirAll(filepath.Dir(c.path), 0o700); err != nil {
		return err
	}
	data, err := json.MarshalIndent(c, "", "  ")
	if err != nil {
		return err
	}
	tmp := c.path + ".tmp"
	if err := os.WriteFile(tmp, data, 0o600); err != nil {
		return err
	}
	return os.Rename(tmp, c.path)
}

const (
	hashIterations = 600_000
	hashScheme     = "pbkdf2-sha256"
)

func hashPassword(password string) (string, error) {
	salt := make([]byte, 16)
	if _, err := rand.Read(salt); err != nil {
		return "", err
	}
	key, err := pbkdf2.Key(sha256.New, password, salt, hashIterations, 32)
	if err != nil {
		return "", err
	}
	enc := base64.RawStdEncoding
	return fmt.Sprintf("%s$%d$%s$%s", hashScheme, hashIterations, enc.EncodeToString(salt), enc.EncodeToString(key)), nil
}

func verifyPassword(stored, password string) bool {
	parts := strings.Split(stored, "$")
	if len(parts) != 4 || parts[0] != hashScheme {
		return false
	}
	iterations, err := strconv.Atoi(parts[1])
	if err != nil {
		return false
	}
	enc := base64.RawStdEncoding
	salt, err1 := enc.DecodeString(parts[2])
	want, err2 := enc.DecodeString(parts[3])
	if err1 != nil || err2 != nil {
		return false
	}
	got, err := pbkdf2.Key(sha256.New, password, salt, iterations, len(want))
	return err == nil && subtle.ConstantTimeCompare(got, want) == 1
}
