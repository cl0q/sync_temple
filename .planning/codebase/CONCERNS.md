# Codebase Concerns

**Analysis Date:** 2026-05-11

## Critical Issues

### Browser Upload Bug: WebKitBlobResource Error 4 on Large Folder Uploads

**What happens:** Uploading folders with several hundred files fails after ~15 files with "WebKitBlobResource error 4" and "network connection lost". This occurs in the web UI (`static/index.html`).

**Root cause:** The upload dispatcher sends multiple files in parallel without concurrency control or request queuing. Lines 677-703 in `static/index.html` batch files by size (15MB limit) but do NOT limit parallel `fetch()` requests. When picker sends 100+ files with many small-to-medium files, the FormData batches are created correctly, but the browser's HTTP connection pool and socket limits get overwhelmed.

**Why it's wrong:** 
- Line 688-695: After hitting `BATCH_MAX` size, code sends `api('POST', ..., fd)` without awaiting network completion or managing browser fetch concurrency
- No exponential backoff or retry logic for failed uploads
- No per-file upload progress feedback
- No connection throttling (browser defaults to ~6 concurrent connections; additional requests queue and timeout)
- Network error handling (line 708-711) is silent after failure; no mechanism to resume

**Evidence in code:**
```javascript
// static/index.html:688-695
if (batchSize >= BATCH_MAX) {
  batchNum++;
  status.textContent = 'Uploading batch ' + batchNum + '... (' + uploaded + '/' + toUpload.length + ')';
  const r = await api('POST', '/api/' + ch + '/upload', fd).then(r => r.json());
  uploaded += r.uploaded || 0;
  fd = new FormData();
  batchSize = 0;
}
```

The await is there, but the issue is that 15 files per batch is still too many files being batched together when there are hundreds to upload. The browser can't handle the parallel fetch requests spawned by the picker/batch strategy.

**Do this instead:**
1. Implement per-file upload with a queue of maximum 3-4 concurrent uploads at a time
2. Add exponential backoff retry (3 attempts with 1s/3s/10s delays)
3. Track upload progress per-file and show in status bar
4. On error, allow user to resume from last successful upload point
5. Add client-side timeout handling for stalled connections

**Impact:** High — Users cannot upload project folders with 100+ files; sync workflow is blocked for large codebases.

---

## Tech Debt

### CLI Implementation: Shell Wrapper Instead of Proper Binary Release

**Issue:** CLI is a Python script (`sync` at `/Users/olli/schenanigans/sync_temple/sync`) aliased via shell (~/.zshrc). No release pipeline, no versioning, no compiled binary.

**Files:** `sync` (Python), `MANUAL.md:14-18` (alias setup)

**Problems:**
- No version checking — can't tell which version is deployed
- Path resolution fragile — depends on correct PYTHONPATH and Python 3 being available
- No release artifacts — binary distributed by file copy, not package manager
- No auto-update mechanism
- Difficult to distribute to other machines (requires full repo clone + manual alias setup)
- No code signing or integrity verification

**Fix approach:**
1. Convert to Go CLI binary (matching server language) or compile Python to standalone executable using PyInstaller
2. Add semantic versioning: `sync --version`
3. Create release pipeline: build binary, tag git, publish to GitHub Releases
4. Implement auto-update check (e.g., warn if `sync` is older than latest server)
5. Package for macOS (DMG/homebrew) and FreeBSD (pkg)
6. Add integration tests for CLI commands

**Impact:** Medium — Maintainability and distribution friction; scales poorly as user base grows.

---

## Server-Side Concerns

### Missing Request Size Limits and Validation

**Issue:** `main.go:231-279` (`handleUpload`) has no maximum file size, upload timeout, or request size validation.

**Files:** `main.go:231-279` (handleUpload)

**Problems:**
- No `http.MaxBytesReader` on upload endpoint — attacker can OOM server with single massive file
- No per-file size limit — uploaded files are unbounded
- No timeout for slow/stalled uploads
- Error handling silently continues on write failure (line 269: `if _, err := io.Copy(dst, part); err == nil { n++ }` — if error, file is still created but empty)

**Evidence:**
```go
// main.go:231-279
func (s *server) handleUpload(w http.ResponseWriter, r *http.Request) {
	// ... no size limit ...
	for {
		part, err := mr.NextPart()
		// ... no timeout ...
		dst, err := os.Create(dest)
		if _, err := io.Copy(dst, part); err == nil {
			n++  // only increment if no error, but file is already created
		}
		dst.Close()
		part.Close()
	}
}
```

**Do this instead:**
1. Wrap request body: `r.Body = http.MaxBytesReader(w, r.Body, 500*1024*1024)` (500MB limit)
2. Add per-file timeout: context with 5-minute deadline per file
3. Validate multipart form name length (prevent path traversal via long names)
4. Delete empty/failed files: check file size after upload, remove if 0 bytes
5. Return detailed error response: currently returns generic "part error" — should distinguish between size limit, timeout, parse error

**Impact:** High — DoS vector; silent failures leave corrupted empty files on server.

---

### Concurrent Upload Handling and Race Conditions

**Issue:** `handleUpload` holds a global lock for entire upload operation (line 239-240: `s.locks[ch].Lock()`). Multiple concurrent uploads to same channel are serialized, causing performance degradation.

**Files:** `main.go:239-240, 362-363` (handleUpload, handleDeleteFiles)

**Problems:**
- Entire multipart read is sequential under one lock — if client is slow, server blocks other users
- No per-file locking — file-level granularity would allow concurrent uploads to different files
- Locks are module-level singletons (line 39: `locks: map[string]*sync.RWMutex{"a": {}, "b": {}}`) — no growth or per-file tracking

**Evidence:**
```go
// main.go:239-240
s.locks[ch].Lock()
defer s.locks[ch].Unlock()  // entire multipart read is under lock
for {
	part, err := mr.NextPart()
	// ... file I/O ...
}
```

**Do this instead:**
1. Release channel lock after reading part header, acquire per-file lock for write
2. Use atomic operations for counter (`n`) instead of relying on lock
3. Consider `sync/atomic` for concurrent `uploaded` count
4. Profile with concurrent uploads to measure actual contention

**Impact:** Medium — Performance degrades linearly with concurrent users; single slow upload blocks channel.

---

### Text Handler Silent Failures

**Issue:** `handleSetText` (line 403-414) reads request body with `io.LimitReader` but silently ignores errors.

**Files:** `main.go:403-414`

**Problems:**
- Line 405: `io.ReadAll(io.LimitReader(r.Body, 10<<20))` — if read fails, error is ignored (`_` discard)
- No validation of text size before writing
- Returns `{"status": "ok"}` even if write failed
- No error logging for diagnostics

**Evidence:**
```go
// main.go:403-414
func (s *server) handleSetText(w http.ResponseWriter, r *http.Request) {
	ch := r.PathValue("channel")
	body, _ := io.ReadAll(io.LimitReader(r.Body, 10<<20))  // error silently dropped
	s.locks[ch].Lock()
	os.WriteFile(filepath.Join(s.dataDir, ch, "text.txt"), body, 0644)  // error ignored
	s.locks[ch].Unlock()
	// ... always returns ok ...
}
```

**Do this instead:**
1. Check error from `io.ReadAll`: `body, err := io.ReadAll(...); if err != nil { ... }`
2. Check error from `os.WriteFile`: `if err := os.WriteFile(...); err != nil { http.Error(...) }`
3. Return HTTP 400/500 with error message on failure
4. Add structured logging: log errors with channel and timestamp

**Impact:** Low — Silent data loss possible but unlikely in practice; affects debugging.

---

## Security Considerations

### Missing CORS Configuration

**Issue:** No `Access-Control-Allow-Origin` header set in any response.

**Files:** All handlers in `main.go` (no CORS middleware)

**Risk:** Web UI deployed at same domain as API. If UI is at separate domain (e.g., CDN), requests will fail. If UI is self-hosted, CORS is not needed but should be explicit for clarity.

**Current mitigation:** UI is embedded in server binary (`//go:embed static/index.html` line 24), so same-origin policy is satisfied. But this is implicit, not explicit.

**Recommendations:**
1. Add explicit `Access-Control-Allow-Origin: self` header (or specific domain)
2. Set `Access-Control-Allow-Methods: GET, POST, DELETE` on API endpoints
3. Document CORS policy in README

**Impact:** Low — Currently safe due to embedding, but fragile if UI ever moves.

---

### Path Traversal Protection: Incomplete

**Issue:** `safePath` function (line 128-134) checks for `..` and absolute paths but does not validate symlink escapes.

**Files:** `main.go:128-134`

**Risk:** If attacker symlinks `/var/sensitive → ../data/a/files/link`, then uploads to `link/file.txt`, it could write outside intended directory (depending on OS and permissions).

**Evidence:**
```go
// main.go:128-134
func safePath(p string) (string, bool) {
	c := filepath.Clean(filepath.FromSlash(p))
	if strings.HasPrefix(c, "..") || filepath.IsAbs(c) {
		return "", false
	}
	return c, true  // does not check symlinks
}
```

**Current mitigation:** Tight file permissions (0755 directories, 0644 files) and running in restricted environment (FreeBSD jail) limit blast radius. Symbolic link attacks require write access to data directory.

**Recommendations:**
1. Use `filepath.EvalSymlinks` to resolve symlinks and check result is within root:
   ```go
   real, _ := filepath.EvalSymlinks(filepath.Join(root, c))
   if !strings.HasPrefix(real, root) { return "", false }
   ```
2. Add unit tests for path validation: test with symlinks, `.` `..` variants
3. Document that `files/` directory must not contain attacker-writable symlinks

**Impact:** Low-Medium — Requires attacker write access to data dir; jail isolation mitigates in production.

---

### No Rate Limiting or Throttling

**Issue:** No rate limiting on auth endpoint or API endpoints.

**Files:** No rate limiting middleware in `main.go`

**Risk:** Brute force token guessing (16 bytes = 128 bits, but can try thousands/sec), DDoS via bulk downloads or repeated diff requests.

**Current mitigation:** Token is 128-bit random hex (line 450-452), so brute force is computationally infeasible. But intentional DoS via many concurrent requests is not prevented.

**Recommendations:**
1. Add per-IP rate limiting: e.g., 100 requests/minute per IP
2. Implement exponential backoff for failed auth attempts
3. Add metrics/logging for suspicious activity patterns
4. Document expected request rate for capacity planning

**Impact:** Medium — DoS vector; production environment (Caddy reverse proxy) may already implement rate limiting externally.

---

## UI/UX Robustness

### Error Handling: Minimal Feedback on Failure

**Issue:** `api()` function (line 250-268) throws generic "HTTP {status}" errors. No detailed error messages or retry guidance shown to user.

**Files:** `static/index.html:250-268, 708-711`

**Problems:**
- Line 709: `status.textContent = 'Error: ' + err.message` — user sees only "HTTP 413" or "Error: fetch failed"
- No distinction between network timeout, server error, auth failure, size limit
- No retry button or resume mechanism
- User must manually retry by re-selecting files

**Evidence:**
```javascript
// static/index.html:708-711
catch (err) {
  status.textContent = 'Error: ' + err.message;
  status.style.color = 'var(--danger)';
}
```

**Do this instead:**
1. Return detailed error from server: `{"error": "File exceeds 100MB limit", "code": "SIZE_LIMIT"}`
2. Client detects error code and shows actionable message: "File too large — max 100MB. Compress or split."
3. Add "Retry" button that resumes from last successful file
4. Implement exponential backoff in `api()`: retry on 5xx/network errors up to 3 times
5. Add timeout handler: warn user if upload stalls for >30 seconds

**Impact:** Medium — User experience poor on failures; acceptable for one-off sync tool but poor for critical workflows.

---

### No Progress Feedback During Download

**Issue:** Download endpoint (line 281-295) streams full ZIP without progress feedback.

**Files:** `static/index.html:739-746` (`downloadAll` function)

**Problems:**
- Browser shows generic "downloading channel_a.zip" in downloads panel
- No in-app progress bar or ETA
- Large ZIPs (1GB+) give no feedback; user can't tell if download is stalled
- No resume capability if download is interrupted

**Evidence:**
```javascript
// static/index.html:739-746
function downloadAll(ch) {
  const a = document.createElement('a');
  a.href = '/api/' + ch + '/download?token=' + encodeURIComponent(token);
  a.download = 'channel_' + ch + '.zip';
  document.body.appendChild(a);
  a.click();  // no progress tracking
  document.body.removeChild(a);
}
```

**Do this instead:**
1. Implement `fetch()` + progress events instead of `<a>` element click:
   ```javascript
   const resp = await fetch(...);
   const total = parseInt(resp.headers.get('content-length'), 10);
   const reader = resp.body.getReader();
   let loaded = 0;
   while (true) {
     const {done, value} = await reader.read();
     if (done) break;
     loaded += value.length;
     updateProgressBar(loaded / total * 100);
   }
   ```
2. Show progress bar with percentage and estimated time
3. Add "Cancel" button to abort in-progress download

**Impact:** Low — Works as-is for small files; poor UX for large projects.

---

## Performance Bottlenecks

### Manifest Hashing: O(n) on Every Request

**Issue:** `/api/{channel}/files` endpoint (line 316-350) and `/api/{channel}/diff` (line 186-229) both recompute SHA256 hashes of all files on every request.

**Files:** `main.go:316-350, 186-229, 107-126` (manifest function)

**Problems:**
- Manifest walks entire directory tree, opens each file, computes SHA256 hash
- No caching — if user clicks "refresh" 10 times, all hashes are recomputed
- Large directories (1000+ files) can take seconds, blocking request
- Hashing is synchronous and blocks other channel operations (shares lock)

**Evidence:**
```go
// main.go:107-126
func (s *server) manifest(ch string) (map[string]string, error) {
	root := s.filesDir(ch)
	m := make(map[string]string)
	err := filepath.WalkDir(root, func(path string, d fs.DirEntry, err error) error {
		// ... hash every file ...
		h := sha256.New()
		io.Copy(h, f)
		m[filepath.ToSlash(rel)] = hex.EncodeToString(h.Sum(nil))
	})
}
```

**Do this instead:**
1. Store manifest in a `manifest.json` file in each channel directory, updated on upload/delete
2. Lazy hash: only compute hashes for files changed since last manifest write
3. Cache hashes with file mtime/size as key: if file unchanged, reuse cached hash
4. Async hashing: compute in background, return stale manifest immediately if fresh manifest unavailable

**Impact:** Medium — Acceptable for <1000 files; slow UI for larger projects.

---

### SSE Connection Leak

**Issue:** SSE connections (line 416-441) remain open indefinitely. Browser may not clean them up on disconnect, leading to connection exhaustion.

**Files:** `main.go:416-441, 50-78` (handleEvents, subscribe/notify)

**Problems:**
- No heartbeat/ping — idle connections may be closed by proxies without notice
- No max connection limit per channel
- No timeout on SSE connections
- Subscribe channel is never cleaned if client silently closes connection

**Evidence:**
```go
// main.go:429-440
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
```

While context cleanup is there, a slow client or network hiccup might leave a lingering channel in the map.

**Do this instead:**
1. Add periodic `:ping` frames every 30 seconds (SSE heartbeat)
2. Add connection timeout: close after 5 minutes of inactivity
3. Limit subscriptions per channel: max 100 concurrent SSE connections
4. Add metrics: log connection open/close with timing
5. Client-side: reconnect with exponential backoff on error

**Impact:** Low-Medium — Unlikely to be problem in practice; but scales poorly with many users.

---

## Test Coverage Gaps

### No Automated Tests

**Issue:** No test files found in repository.

**Files:** No `*_test.go`, no test runner config

**Untested areas:**
- `handleUpload`: multipart parsing, concurrent uploads, error cases
- `handleDiff`: manifest comparison logic
- Path traversal protection (`safePath` function)
- Auth token validation and constant-time comparison
- Lock contention and race conditions

**Risk:** Medium — Regression bugs easily introduced; path traversal and security issues could slip in.

**Fix approach:**
1. Add unit tests for core logic:
   - `TestSafePath`: test `..`, absolute paths, symlinks, long names
   - `TestManifest`: test with files of various sizes, permissions, UTF-8 names
   - `TestHandleUpload`: test multipart parsing, error conditions, concurrent uploads
   - `TestAuth`: test bearer token, query param token, invalid tokens
2. Add integration tests: upload/download round-trip, concurrent operations
3. Add race condition detector: `go test -race ./...`
4. Set coverage target: 80%+ for security-critical code

**Impact:** High — Test harness will catch bugs and make refactoring safe.

---

### No CLI Integration Tests

**Issue:** Python CLI (`sync` script) has no automated tests.

**Files:** `sync` (Python CLI)

**Untested:**
- `cmd_push` with ignore patterns
- `cmd_pull` with directory creation
- Multipart upload boundary handling (custom implementation at line 115-134)
- Error handling: invalid channel, network errors, token missing
- Path handling: special characters, Unicode, Windows vs POSIX paths

**Risk:** Medium — CLI is harder to debug manually; errors in boundary encoding or parsing could corrupt uploads.

**Fix approach:**
1. Add pytest test suite with mocked server (`unittest.mock`)
2. Test all command paths: push, pull, text-push, text-pull, files, clear
3. Test error conditions: missing env vars, bad channel, network timeout
4. Test multipart boundary generation: ensure no accidental boundary in file data
5. Run tests in CI on PR

**Impact:** Medium — Catches regressions and makes refactoring safe.

---

## Scaling Limits

### Storage Model: Two Hard-Coded Channels

**Issue:** Channels "a" and "b" are hard-coded (line 39: `locks: map[string]*sync.RWMutex{"a": {}, "b": {}}`) with no way to add more users.

**Files:** `main.go:39, 92-95` (server init, auth)

**Problem:** Multi-tenancy is impossible; cannot deploy shared instance. Adding channels requires code change and restart.

**Fix approach:**
1. Support dynamic channel names: accept any alphanumeric channel from auth header
2. Initialize lock on first access (lazy initialization pattern)
3. Add channel quota: max 100 channels per server, cleanup policy for unused channels
4. Add subscription limit: prevent resource exhaustion from single attacker

**Impact:** Low-Medium — Not blocking for current 2-user deployment, but limits future growth.

---

## Known Workarounds in Code

### JavaScript `.env` File Hardcoded in Ignore List

**Issue:** `static/index.html:192` ignores `.env` files globally, but `.env` location is a security concern.

**Files:** `static/index.html:192, sync:39`

**Context:** Both UI and CLI hardcode `.env` in ignore list. This is correct (prevent accidental credential leaks), but the manual setup requires users to trust this without verification.

**Mitigation:** Documentation should emphasize: "Never upload `.env` — it's auto-ignored."

**Impact:** Low — Current behavior is correct.

---

## Dependencies at Risk

### No Version Pinning in Go Server

**Issue:** `main.go` imports standard library only (no external deps). No `go.mod` found.

**Files:** `main.go:3-22` (imports)

**Risk:** Building from source on different Go versions may produce different binaries (version-specific bugs or security patches).

**Fix approach:**
1. Create `go.mod` and `go.sum`: `go mod init sync.temple`
2. Pin Go version in `go.mod`: `go 1.21`
3. Use `go build -a` to force full rebuild; embed version info in binary

**Impact:** Low — Standard library only, so no external dependency risk; but should still version Go.

---

### Python 3.8+ Requirement

**Issue:** CLI (`sync` script) uses f-strings (line 54, 94, etc.) which require Python 3.6+. No `#!python3.9` shebang; defaults to `python3` in PATH.

**Files:** `sync:1` (shebang)

**Risk:** Running on Python 2 or old Python 3 will fail with syntax errors. No error message until runtime.

**Fix approach:**
1. Change shebang to `#!/usr/bin/env python3.9` or higher
2. Add `python_requires=">=3.9"` to setup.py if converted to package
3. Add version check at runtime: `if sys.version_info < (3, 9): sys.exit("Python 3.9+ required")`

**Impact:** Low — Unlikely issue in practice; macOS ships Python 3 by default.

---

## Summary Table: Priority

| Issue | Severity | Category | Effort |
|-------|----------|----------|--------|
| Browser upload bug (WebKitBlobResource error 4) | **Critical** | Bug | High |
| Missing request size limits on upload | **High** | Security/DoS | Medium |
| CLI as shell wrapper (no release pipeline) | **High** | Tech Debt | High |
| Concurrent upload serialization | **Medium** | Performance | Medium |
| Silent errors in text handler | **Medium** | Reliability | Low |
| Manifest hashing on every request | **Medium** | Performance | Medium |
| No automated tests | **Medium** | Quality | High |
| Error handling in browser UI | **Medium** | UX | Medium |
| SSE connection leak | **Low** | Reliability | Medium |
| No CORS configuration | **Low** | Security | Low |
| Path traversal via symlinks | **Low** | Security | Low |
| No rate limiting | **Low** | Security | Medium |
| Text handler error handling | **Low** | Reliability | Low |
| Download progress feedback | **Low** | UX | Medium |
| Storage model: hard-coded channels | **Low** | Scaling | High |
| Python version pinning | **Low** | Reliability | Low |

---

*Concerns audit: 2026-05-11*
