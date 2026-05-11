# Testing Patterns

**Analysis Date:** 2026-05-11

## Test Framework

**Status:** No tests detected

**Runner:** None (no *_test.go files present)

**Assertion Library:** N/A

**Run Commands:** N/A (no test files to execute)

### Test Audit

Project contains:
- `main.go` — Core server implementation (478 lines)
- `setup-sync-jail.sh` — Deployment/configuration script
- `sync_temple.rc` — FreeBSD rc.d service script
- `static/index.html` — Frontend (HTML, CSS, JavaScript inline)
- `go.mod` — No external Go dependencies (`go 1.22.0`)

**No test files found:**
- No `*_test.go` files in root or subdirectories
- No `*_test.sh` files
- No Jest/Vitest config (not applicable to Go project)
- No Go test configuration files (`testing.toml`, etc.)

## Critical Testing Gaps

### Server Logic (`main.go`)

**What's not tested:**
- Authentication via token validation (`requireAuth` middleware, line 82-99)
- File manifest generation and hashing (`manifest` function, line 107-126)
- Path validation (`safePath` function, line 128-134) — critical security boundary
- Pub/Sub notification system (`subscribe`, `unsubscribe`, `notify` functions, lines 50-78)
- ZIP file creation (`writeZip` function, line 136-158)
- File upload handling with multipart parsing (`handleUpload`, line 231-279)
- Download/selected file download (`handleDownload`, `handleDownloadSelected`, lines 281-314)
- File deletion with empty directory cleanup (`handleDeleteFiles`, `cleanEmptyDirs`, lines 352-381)
- Text storage operations (`handleGetText`, `handleSetText`, lines 396-414)
- Server-Sent Events streaming (`handleEvents`, line 416-441)

**Priority:** High — These are core operations. Path traversal vulnerability in `safePath` is a silent contract; should be tested exhaustively.

**Risk:** No automated safeguards. Bugs in file operations could lead to:
- Directory traversal attacks (e.g., symlinks, `..` paths)
- Data corruption or loss
- Authentication bypass

### Frontend JavaScript (`static/index.html`)

**What's not tested:**
- API client (`api` function, line 251-268) — network error handling
- Authentication flow (`connect` function, line 208-221)
- File hashing (`sha256` function, line 304-307)
- File tree building and rendering (`buildTree`, `renderChildren`, `renderRow`, lines 418-555)
- Upload with diff-based batching (`uploadFiles`, lines 631-712)
- File picker UI interaction (checkbox state, expand/collapse, lines 372-627)
- Ignore pattern matching (`isIgnored` function, line 277-300)
- SSE event handling and reconnection (`connectSSE`, line 775-784)
- Drag-and-drop file handling (`getFilesFromDrop`, `traverseEntry`, lines 325-369)

**Priority:** High — Frontend is the primary user interface. No tests for:
- State consistency (selected files, checked boxes)
- Error recovery (network failures, retries)
- Large file handling (batch splitting at 15MB)
- Cross-browser compatibility (Drag/Drop, File API)

**Risk:** Silent data loss (unchecked file selection), UI bugs (state sync), authentication state leaks

### Shell Scripts

**What's not tested:**
- `setup-sync-jail.sh`: FreeBSD jails, pf.conf modification, Caddy config injection (lines 1-129)
- `sync_temple.rc`: rc.d service lifecycle (start/stop/restart)

**Priority:** Medium — Destructive operations (sed, pfctl reload). Test paths:
- Jail existence validation
- Permission checks
- Config file backup before modification
- Rollback on partial failure

## Recommended Testing Strategy

### Phase 1: Unit Tests (Go)

**Start with safest, most critical functions:**

1. **Path validation (`safePath`)** — Test matrix:
   ```go
   // Should reject
   safePath("../etc/passwd")        // directory traversal
   safePath("/etc/passwd")          // absolute path
   safePath("a/../../../etc/passwd") // traversal via clean
   
   // Should accept
   safePath("file.txt")
   safePath("dir/subdir/file.txt")
   safePath("./relative/path")
   ```

2. **Manifest generation** — Mock filesystem:
   ```go
   // Test with empty directory, single file, nested structure
   // Verify SHA256 hashing correctness
   // Test error handling (permission denied, file deleted mid-walk)
   ```

3. **Token validation** — Constant-time comparison:
   ```go
   // Verify subtle.ConstantTimeCompare prevents timing attacks
   // Test empty token, wrong token, correct token
   // Test Bearer header and query param fallback
   ```

4. **ZIP writing** — Test with malicious input:
   ```go
   // Test symlinks (should be rejected or normalized)
   // Test very deep paths (boundary condition)
   // Test large files (>1GB)
   // Test concurrent access (race condition check via -race flag)
   ```

**Test framework:** Standard `testing` package (`*_test.go` files)

**Run with race detector:** `go test -race ./...`

**Example structure** (`main_test.go`):
```go
package main

import (
	"testing"
)

func TestSafePath(t *testing.T) {
	tests := []struct {
		input    string
		want     string
		wantOk   bool
	}{
		{"file.txt", "file.txt", true},
		{"../etc", "", false},
		{"/abs/path", "", false},
	}
	for _, tt := range tests {
		got, ok := safePath(tt.input)
		if ok != tt.wantOk || got != tt.want {
			t.Errorf("safePath(%q) = %q, %v; want %q, %v", 
				tt.input, got, ok, tt.want, tt.wantOk)
		}
	}
}
```

### Phase 2: Integration Tests (Go)

**Test HTTP endpoints with server running:**

1. **Authentication** — Test all endpoint protection:
   ```go
   // Missing token → 401
   // Wrong token → 401
   // Valid token → 200
   ```

2. **Upload/Download cycle** — Full flow:
   - Upload file
   - Verify manifest includes it
   - Download and compare hash
   - Delete and verify removal

3. **Pub/Sub notifications** — Multi-client:
   - Two clients subscribe to same channel
   - One client uploads
   - Both receive update via SSE

**Test framework:** `net/http/httptest` package

**Example** (`main_test.go`):
```go
func TestHandleUpload(t *testing.T) {
	s := newServer(t.TempDir(), "test-token")
	
	// Create request with file
	buf := new(bytes.Buffer)
	mw := multipart.NewWriter(buf)
	part, _ := mw.CreateFormFile("test.txt", "test.txt")
	part.Write([]byte("hello"))
	mw.Close()
	
	req := httptest.NewRequest("POST", "/api/a/upload", buf)
	req.Header.Set("Authorization", "Bearer test-token")
	req.Header.Set("Content-Type", mw.FormDataContentType())
	
	w := httptest.NewRecorder()
	s.handleUpload(w, req)
	
	if w.Code != 200 {
		t.Errorf("expected 200, got %d", w.Code)
	}
}
```

### Phase 3: Frontend Tests (JavaScript)

**Test framework:** Vitest or Jest (lightweight for this codebase)

**Start with:**

1. **`isIgnored` pattern matching:**
   ```javascript
   test('isIgnored matches extension patterns', () => {
     ignorePatterns = ['*.log', '*.tmp'];
     expect(isIgnored('debug.log')).toBe(true);
     expect(isIgnored('file.txt')).toBe(false);
   });
   ```

2. **`safePath` equivalent for browser:**
   ```javascript
   test('traverseEntry filters hidden .claude dirs', async () => {
     // Mock FileSystemDirectoryEntry with .claude/worktrees structure
     // Verify isIgnored prevents sync
   });
   ```

3. **SHA256 hashing:**
   ```javascript
   test('sha256 produces correct hash', async () => {
     const buffer = new TextEncoder().encode('test');
     const hash = await sha256(buffer);
     // Verify against known SHA256('test')
   });
   ```

4. **File tree building:**
   ```javascript
   test('buildTree computes correct sizes', () => {
     const files = [
       { path: 'a/b.txt', file: { size: 100 } },
       { path: 'a/c.txt', file: { size: 200 } },
     ];
     const tree = buildTree(files);
     expect(tree.children.a.size).toBe(300);
   });
   ```

### Phase 4: E2E Tests (Optional)

**Skip for now** — This is a small, focused tool. Integration tests sufficient.

## Coverage Targets

| Component | Coverage | Priority |
|-----------|----------|----------|
| `safePath` | 100% | Critical |
| `manifest` | 95% | Critical |
| `requireAuth` | 100% | High |
| `handleUpload` | 85% | High |
| `handleDownload` | 85% | High |
| `isIgnored` (JS) | 95% | High |
| `uploadFiles` (JS) | 70% | Medium |
| `buildTree` (JS) | 90% | Medium |
| Shell scripts | Manual smoke test | Low |

**Do not enforce coverage threshold initially** — Focus on critical paths first (security, data integrity). Aim for 70%+ on core handlers within Q2.

## Test File Organization

**Proposed structure:**

```
sync_temple/
├── main.go
├── main_test.go                    # Unit + integration tests
├── testdata/                       # Fixtures
│   ├── sample_manifest.json
│   └── test_files/
├── static/
│   ├── index.html
│   └── index.test.js               # Jest/Vitest tests for JS
└── scripts/
    └── test-setup.sh               # Helper to run all tests
```

**Run commands:**

```bash
# Go tests
go test -v ./...                    # All tests
go test -race ./...                 # With race detector
go test -cover ./...                # With coverage
go test -coverprofile=coverage.out ./... && go tool cover -html=coverage.out

# JavaScript tests (when added)
npm test                            # Run Jest/Vitest
npm test -- --coverage              # With coverage
```

## Mocking Strategy

**Go:**
- Use `httptest.Server` for HTTP integration tests
- Use `os.TempDir()` for filesystem tests
- Mock `http.ResponseWriter` with `httptest.ResponseRecorder`
- Use interfaces (not yet present) if deeper mocking needed later

**JavaScript:**
- Mock `fetch` with Jest mock (`jest.mock('fetch')`)
- Mock `localStorage` for session persistence tests
- Mock `EventSource` for SSE testing
- Use `jest.useFakeTimers()` for async timeout tests

**What NOT to mock:**
- Actual file hashing (`crypto.subtle.digest`)
- Path traversal logic (test with real paths)
- DOM rendering (test only that `innerHTML` was set, not actual layout)

## Known Fragile Areas

| Area | Why Fragile | Test approach |
|------|--------|----|
| `safePath` | Silent security bug if broken | Exhaustive path matrix tests |
| Multipart upload | Can silently skip files | Mock multipart reader errors |
| File manifest walking | Concurrent file changes | Use fs mocking or tmpdir |
| SSE reconnection | Network timing | Mock EventSource, test backoff |
| Empty dir cleanup | Edge case in deletion | Test with nested empty structures |
| Ignore patterns | Regex-like behavior | Comprehensive pattern matrix |

---

*Testing analysis: 2026-05-11*

**Summary:** sync_temple has **zero test coverage**. This is a critical gap for a file sync server. Recommend starting with Phase 1 (unit tests for `safePath`, `manifest`, auth) immediately. Path validation and file operations are security-critical. Backend should reach 80%+ coverage before adding significant new features.
