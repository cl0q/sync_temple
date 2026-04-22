package main

import (
	"archive/zip"
	"bytes"
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	_ "embed"
	"encoding/hex"
	"encoding/json"
	"flag"
	"fmt"
	"io"
	"io/fs"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync"
)

//go:embed static/index.html
var indexHTML []byte

type server struct {
	dataDir string
	token   string
	locks   map[string]*sync.RWMutex
	subs    map[string][]chan struct{}
	subMu   sync.Mutex
}

func newServer(dataDir, token string) *server {
	s := &server{
		dataDir: dataDir,
		token:   token,
		locks:   map[string]*sync.RWMutex{"a": {}, "b": {}},
		subs:    map[string][]chan struct{}{"a": nil, "b": nil},
	}
	for ch := range s.locks {
		os.MkdirAll(filepath.Join(dataDir, ch, "files"), 0755)
	}
	return s
}

// --- Pub/Sub for SSE ---

func (s *server) subscribe(ch string) chan struct{} {
	s.subMu.Lock()
	defer s.subMu.Unlock()
	c := make(chan struct{}, 1)
	s.subs[ch] = append(s.subs[ch], c)
	return c
}

func (s *server) unsubscribe(ch string, c chan struct{}) {
	s.subMu.Lock()
	defer s.subMu.Unlock()
	for i, sub := range s.subs[ch] {
		if sub == c {
			s.subs[ch] = append(s.subs[ch][:i], s.subs[ch][i+1:]...)
			return
		}
	}
}

func (s *server) notify(ch string) {
	s.subMu.Lock()
	defer s.subMu.Unlock()
	for _, c := range s.subs[ch] {
		select {
		case c <- struct{}{}:
		default:
		}
	}
}

// --- Auth ---

func (s *server) requireAuth(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		tok := strings.TrimPrefix(r.Header.Get("Authorization"), "Bearer ")
		if tok == "" {
			tok = r.URL.Query().Get("token")
		}
		if subtle.ConstantTimeCompare([]byte(tok), []byte(s.token)) != 1 {
			http.Error(w, "unauthorized", http.StatusUnauthorized)
			return
		}
		ch := r.PathValue("channel")
		if ch != "a" && ch != "b" {
			http.Error(w, "invalid channel", http.StatusBadRequest)
			return
		}
		next(w, r)
	}
}

// --- Helpers ---

func (s *server) filesDir(ch string) string {
	return filepath.Join(s.dataDir, ch, "files")
}

func (s *server) manifest(ch string) (map[string]string, error) {
	root := s.filesDir(ch)
	m := make(map[string]string)
	err := filepath.WalkDir(root, func(path string, d fs.DirEntry, err error) error {
		if err != nil || d.IsDir() {
			return err
		}
		rel, _ := filepath.Rel(root, path)
		f, err := os.Open(path)
		if err != nil {
			return err
		}
		defer f.Close()
		h := sha256.New()
		io.Copy(h, f)
		m[filepath.ToSlash(rel)] = hex.EncodeToString(h.Sum(nil))
		return nil
	})
	return m, err
}

func safePath(p string) (string, bool) {
	c := filepath.Clean(filepath.FromSlash(p))
	if strings.HasPrefix(c, "..") || filepath.IsAbs(c) {
		return "", false
	}
	return c, true
}

func (s *server) writeZip(w io.Writer, ch string, files []string) error {
	root := s.filesDir(ch)
	zw := zip.NewWriter(w)
	defer zw.Close()
	for _, p := range files {
		clean, ok := safePath(p)
		if !ok {
			continue
		}
		f, err := os.Open(filepath.Join(root, clean))
		if err != nil {
			continue
		}
		fw, err := zw.Create(filepath.ToSlash(clean))
		if err != nil {
			f.Close()
			continue
		}
		io.Copy(fw, f)
		f.Close()
	}
	return nil
}

func cleanEmptyDirs(root string) {
	// Walk bottom-up by collecting dirs first
	var dirs []string
	filepath.WalkDir(root, func(path string, d fs.DirEntry, err error) error {
		if err == nil && d.IsDir() && path != root {
			dirs = append(dirs, path)
		}
		return nil
	})
	// Remove in reverse order (deepest first)
	for i := len(dirs) - 1; i >= 0; i-- {
		entries, _ := os.ReadDir(dirs[i])
		if len(entries) == 0 {
			os.Remove(dirs[i])
		}
	}
}

// --- Handlers ---

func (s *server) serveUI(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.Header().Set("Cache-Control", "no-cache")
	w.Write(indexHTML)
}

func (s *server) handleDiff(w http.ResponseWriter, r *http.Request) {
	ch := r.PathValue("channel")
	var req struct {
		Files map[string]string `json:"files"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "bad json", http.StatusBadRequest)
		return
	}

	s.locks[ch].RLock()
	serverM, err := s.manifest(ch)
	s.locks[ch].RUnlock()
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	var clientOnly, serverOnly, different []string
	same := 0
	for p, clientHash := range req.Files {
		serverHash, exists := serverM[p]
		if !exists {
			clientOnly = append(clientOnly, p)
		} else if serverHash != clientHash {
			different = append(different, p)
		} else {
			same++
		}
	}
	for p := range serverM {
		if _, exists := req.Files[p]; !exists {
			serverOnly = append(serverOnly, p)
		}
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]any{
		"client_only": clientOnly,
		"server_only": serverOnly,
		"different":   different,
		"same":        same,
	})
}

func (s *server) handleUpload(w http.ResponseWriter, r *http.Request) {
	ch := r.PathValue("channel")
	if err := r.ParseMultipartForm(200 << 20); err != nil {
		http.Error(w, "parse error: "+err.Error(), http.StatusBadRequest)
		return
	}

	s.locks[ch].Lock()
	defer s.locks[ch].Unlock()

	root := s.filesDir(ch)
	n := 0
	for name, fhs := range r.MultipartForm.File {
		clean, ok := safePath(name)
		if !ok {
			continue
		}
		src, err := fhs[0].Open()
		if err != nil {
			continue
		}
		dest := filepath.Join(root, clean)
		os.MkdirAll(filepath.Dir(dest), 0755)
		dst, err := os.Create(dest)
		if err != nil {
			src.Close()
			continue
		}
		io.Copy(dst, src)
		dst.Close()
		src.Close()
		n++
	}

	s.notify(ch)
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]int{"uploaded": n})
}

func (s *server) handleDownload(w http.ResponseWriter, r *http.Request) {
	ch := r.PathValue("channel")
	s.locks[ch].RLock()
	defer s.locks[ch].RUnlock()

	m, _ := s.manifest(ch)
	files := make([]string, 0, len(m))
	for p := range m {
		files = append(files, p)
	}

	w.Header().Set("Content-Type", "application/zip")
	w.Header().Set("Content-Disposition", fmt.Sprintf(`attachment; filename="channel_%s.zip"`, ch))
	s.writeZip(w, ch, files)
}

func (s *server) handleDownloadSelected(w http.ResponseWriter, r *http.Request) {
	ch := r.PathValue("channel")
	s.locks[ch].RLock()
	defer s.locks[ch].RUnlock()

	var req struct {
		Files []string `json:"files"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "bad json", http.StatusBadRequest)
		return
	}

	var buf bytes.Buffer
	s.writeZip(&buf, ch, req.Files)
	w.Header().Set("Content-Type", "application/zip")
	w.Write(buf.Bytes())
}

func (s *server) handleListFiles(w http.ResponseWriter, r *http.Request) {
	ch := r.PathValue("channel")
	s.locks[ch].RLock()
	defer s.locks[ch].RUnlock()

	root := s.filesDir(ch)
	type fileInfo struct {
		Hash string `json:"hash"`
		Size int64  `json:"size"`
	}
	files := make(map[string]fileInfo)

	filepath.WalkDir(root, func(path string, d fs.DirEntry, err error) error {
		if err != nil || d.IsDir() {
			return err
		}
		rel, _ := filepath.Rel(root, path)
		info, _ := d.Info()
		f, err := os.Open(path)
		if err != nil {
			return nil
		}
		defer f.Close()
		h := sha256.New()
		io.Copy(h, f)
		files[filepath.ToSlash(rel)] = fileInfo{
			Hash: hex.EncodeToString(h.Sum(nil)),
			Size: info.Size(),
		}
		return nil
	})

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(files)
}

func (s *server) handleDeleteFiles(w http.ResponseWriter, r *http.Request) {
	ch := r.PathValue("channel")
	var req struct {
		Files []string `json:"files"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "bad json", http.StatusBadRequest)
		return
	}

	s.locks[ch].Lock()
	defer s.locks[ch].Unlock()

	root := s.filesDir(ch)
	n := 0
	for _, p := range req.Files {
		clean, ok := safePath(p)
		if !ok {
			continue
		}
		if err := os.Remove(filepath.Join(root, clean)); err == nil {
			n++
		}
	}
	cleanEmptyDirs(root)

	s.notify(ch)
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]int{"deleted": n})
}

func (s *server) handleClearFiles(w http.ResponseWriter, r *http.Request) {
	ch := r.PathValue("channel")
	s.locks[ch].Lock()
	os.RemoveAll(s.filesDir(ch))
	os.MkdirAll(s.filesDir(ch), 0755)
	os.Remove(filepath.Join(s.dataDir, ch, "text.txt"))
	s.locks[ch].Unlock()

	s.notify(ch)
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{"status": "cleared"})
}

func (s *server) handleGetText(w http.ResponseWriter, r *http.Request) {
	ch := r.PathValue("channel")
	data, _ := os.ReadFile(filepath.Join(s.dataDir, ch, "text.txt"))
	w.Header().Set("Content-Type", "text/plain; charset=utf-8")
	w.Write(data)
}

func (s *server) handleSetText(w http.ResponseWriter, r *http.Request) {
	ch := r.PathValue("channel")
	body, _ := io.ReadAll(io.LimitReader(r.Body, 10<<20))

	s.locks[ch].Lock()
	os.WriteFile(filepath.Join(s.dataDir, ch, "text.txt"), body, 0644)
	s.locks[ch].Unlock()

	s.notify(ch)
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{"status": "ok"})
}

func (s *server) handleEvents(w http.ResponseWriter, r *http.Request) {
	ch := r.PathValue("channel")
	flusher, ok := w.(http.Flusher)
	if !ok {
		http.Error(w, "streaming not supported", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")
	flusher.Flush()

	c := s.subscribe(ch)
	defer s.unsubscribe(ch, c)

	for {
		select {
		case <-c:
			fmt.Fprintf(w, "data: update\n\n")
			flusher.Flush()
		case <-r.Context().Done():
			return
		}
	}
}

func main() {
	addr := flag.String("addr", ":8787", "listen address")
	data := flag.String("data", "./data", "data directory")
	token := flag.String("token", "", "auth token (auto-generated if empty)")
	flag.Parse()

	if *token == "" {
		b := make([]byte, 16)
		rand.Read(b)
		*token = hex.EncodeToString(b)
	}

	s := newServer(*data, *token)

	fmt.Printf("\n  Sync Temple\n")
	fmt.Printf("  ───────────\n")
	fmt.Printf("  Listen: %s\n", *addr)
	fmt.Printf("  Token:  %s\n", *token)
	fmt.Printf("  Data:   %s\n\n", *data)

	mux := http.NewServeMux()
	mux.HandleFunc("GET /", s.serveUI)
	mux.HandleFunc("POST /api/{channel}/diff", s.requireAuth(s.handleDiff))
	mux.HandleFunc("POST /api/{channel}/upload", s.requireAuth(s.handleUpload))
	mux.HandleFunc("GET /api/{channel}/download", s.requireAuth(s.handleDownload))
	mux.HandleFunc("POST /api/{channel}/download", s.requireAuth(s.handleDownloadSelected))
	mux.HandleFunc("GET /api/{channel}/files", s.requireAuth(s.handleListFiles))
	mux.HandleFunc("POST /api/{channel}/delete", s.requireAuth(s.handleDeleteFiles))
	mux.HandleFunc("DELETE /api/{channel}/files", s.requireAuth(s.handleClearFiles))
	mux.HandleFunc("GET /api/{channel}/text", s.requireAuth(s.handleGetText))
	mux.HandleFunc("POST /api/{channel}/text", s.requireAuth(s.handleSetText))
	mux.HandleFunc("GET /api/{channel}/events", s.requireAuth(s.handleEvents))

	log.Fatal(http.ListenAndServe(*addr, mux))
}
