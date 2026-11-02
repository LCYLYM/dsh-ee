package main

import (
	"context"
	"database/sql"
	"encoding/json"
	"os"
	"time"

	_ "github.com/go-sql-driver/mysql"
)

type release struct {
	Target      string `json:"target"`
	Kind        string `json:"kind"`
	Version     string `json:"version"`
	File        string `json:"file"`
	Size        int64  `json:"size"`
	SHA512      string `json:"sha512"`
	LocalPath   string `json:"local_path"`
	UpstreamURL string `json:"upstream_url"`
}

func main() {
	var r release
	if err := json.Unmarshal([]byte(os.Getenv("E2E_RELEASE")), &r); err != nil {
		panic(err)
	}
	db, err := sql.Open("mysql", os.Getenv("E2E_DSN")+os.Getenv("E2E_DB"))
	if err != nil {
		panic(err)
	}
	defer db.Close()
	if _, err := db.ExecContext(context.Background(), `INSERT INTO dsh_releases
		(target, kind, version, released_at, file, size, sha512, upstream_url, state, recommended, local_path, mirrored_at, created_at)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'mirrored', 0, ?, ?, ?)`, r.Target, r.Kind, r.Version, time.Now().UTC(), r.File, r.Size, r.SHA512, r.UpstreamURL, r.LocalPath, time.Now().UTC(), time.Now().UTC()); err != nil {
		panic(err)
	}
}
