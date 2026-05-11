<!-- refreshed: 2026-05-11 -->
# Architecture

**Analysis Date:** 2026-05-11

## System Overview

Sync Temple is a three-tier file synchronization system: a Go HTTP server backend, a browser-based frontend, and command-line clients. It enables bidirectional file sync between two channels (A and B) with diff-based uploads, live updates via Server-Sent Events, and quick text exchange.

```text
┌────────────────────────────────────────────────────────────────────┐
│                        Client Layer                                 │
├──────────────────────────┬──────────────────────────────────────────┤
│   Web Browser UI         │         CLI Clients (Python)              │
│  `static/index.html`     │  `sync` — push/pull/text ops              │
│  - Drag/drop folders     │  - File scanning & hashing                │
│  - Multipart upload      │  - Diff-based sync                        │
│  - Live file list SSE    │  - Batch upload (50 files/request)        │
│  - Text exchange         │                                            │
└──────────┬───────────────┴──────────────────────────────────────────┘
           │
           │ HTTP (Bearer token in Authorization header or query param)
           │
┌──────────┴──────────────────────────────────────────────────────────┐
│                   HTTP Handler Layer                                 │
│              `main.go` — Server struct handlers                      │
├──────────────────────────────────────────────────────────────────────┤
│ Auth (token validation)                                              │
│ ├─ POST /api/{a,b}/upload       — multipart file upload             │
│ ├─ GET /api/{a,b}/download      — zip all files                     │
│ ├─ POST /api/{a,b}/download     — zip selected files               │
│ ├─ POST /api/{a,b}/diff         — compare local vs server hashes    │
│ ├─ GET /api/{a,b}/files         — list files with hash & size       │
│ ├─ POST /api/{a,b}/delete       — delete specific files             │
│ ├─ DELETE /api/{a,b}/files      — clear channel                     │
│ ├─ GET/POST /api/{a,b}/text     — quick text exchange               │
│ ├─ GET /api/{a,b}/events        — SSE live updates (push/delete)    │
│ └─ GET /                         — serve embedded index.html        │
└──────────┬───────────────────────────────────────────────────────────┘
           │
┌──────────┴──────────────────────────────────────────────────────────┐
│              Concurrency & Locking Layer                             │
│                  `server.locks` map                                  │
├──────────────────────────────────────────────────────────────────────┤
│ Per-channel RWMutex (channel "a" and "b" each have dedicated lock)  │
│ - Write locks: upload, delete, clear, settext                       │
│ - Read locks: diff (manifest), download, files, gettext             │
│ - SSE pub/sub channels for live notifications                       │
└──────────┬───────────────────────────────────────────────────────────┘
           │
┌──────────┴──────────────────────────────────────────────────────────┐
│                  Filesystem & Data Layer                             │
├──────────────────────────────────────────────────────────────────────┤
│ dataDir/                                                              │
│ ├─ a/files/  — channel A files                                      │
│ ├─ a/text.txt — channel A quick text                                │
│ ├─ b/files/  — channel B files                                      │
│ └─ b/text.txt — channel B quick text                                │
│                                                                      │
│ SHA256 hashing on every manifest (for diff calculation)             │
└──────────────────────────────────────────────────────────────────────┘
```

## Component Responsibilities

| Component | Responsibility | File |
|-----------|----------------|------|
| Web Server | HTTP routing, request dispatch, embedded UI serving | `main.go` |
| Frontend | UI rendering, file selection tree, multipart batch uploads, SSE subscription | `static/index.html` |
| CLI Tool | Local directory scanning, manifest hashing, batch upload/download via API | `sync` (Python) |
| Service Config | FreeBSD rc.d daemon, auto-token generation, port/data dir config | `sync_temple.rc` |
| Setup Script | Jail installation, pf.conf rules, Caddy reverse proxy config | `setup-sync-jail.sh` |

## Pattern Overview

**Overall:** Client-server file sync with channel-based isolation and diff-driven updates.

**Key Characteristics:**
- **Two fixed channels** (a, b) for bidirectional sync — no per-user isolation
- **Diff-based uploads** — client hashes local files, server compares, only changed files are POSTed
- **Multipart streaming** — single request can upload multiple files; both web UI and CLI batch uploads to manage request size
- **Live updates** — Server-Sent Events (SSE) notify all connected browsers when files/text changes
- **Token-based auth** — single shared token (no user accounts); passed as Bearer or query param
- **Filesystem-backed** — direct file storage under `dataDir`; no database

## Layers

**Frontend Layer:**
- Purpose: User interface for folder uploads, file browsing, text exchange, and live notifications
- Location: `static/index.html` (embedded in binary via `//go:embed`)
- Contains: HTML, CSS, JavaScript (vanilla)
- Depends on: HTTP API (`/api/{channel}/*` routes)
- Used by: Web browsers

**API Handler Layer:**
- Purpose: HTTP endpoints for client operations
- Location: `main.go` (handler methods on `server` struct)
- Contains: 10 route handlers (auth, upload, download, diff, files, delete, clear, text, events, UI)
- Depends on: Filesystem, file locking, pub/sub channels
- Used by: Web UI and CLI clients

**Concurrency Layer:**
- Purpose: Prevent race conditions on channel data
- Location: `server.locks` (map of per-channel RWMutex), `server.subs` (pub/sub channels)
- Contains: 2 RWMutex (one per channel), 2 slice of SSE channels (one per channel)
- Depends on: sync.RWMutex, sync.Mutex
- Used by: All write/read handlers

**Filesystem Layer:**
- Purpose: Persistent storage and manifest generation
- Location: `server.dataDir` (default `./data`)
- Contains: Directory tree (`a/files/`, `a/text.txt`, `b/files/`, `b/text.txt`)
- Depends on: OS filesystem
- Used by: All handlers for read/write operations

**CLI Client Layer:**
- Purpose: Command-line operations for batch sync from local machines
- Location: `sync` (Python 3 script)
- Contains: 6 commands (push, pull, text-push, text-pull, files, clear)
- Depends on: HTTP API
- Used by: Shell aliases/scripting

## Data Flow

### Primary Upload Path (Web UI Drag-Drop)

1. User drops folder onto drop-zone (`static/index.html` line 238) — `getFilesFromDrop()` or `getFilesFromInput()` traverses file tree
2. File picker modal opens (`openPicker()` line 379) — renders tree with checkboxes, filters via `isIgnored()` (DEFAULT_IGNORE patterns + localStorage override)
3. User clicks "Upload selected" → `confirmPicker()` calls `uploadFiles()` (line 631)
4. **Hashing phase** (`uploadFiles` lines 637–656): reads each file locally, SHA256 hashes in browser
5. **Diff phase** (line 660): POST `/api/{channel}/diff` with manifest of {filepath: sha256} → server returns `{client_only, server_only, different, same}`
6. **Upload batches** (lines 670–703): builds FormData with only changed files, POSTs to `/api/{channel}/upload` in 15MB chunks (multipart boundary)
7. **Server receipt** (`handleUpload` line 231): acquires write lock, iterates multipart parts, creates files under `dataDir/{channel}/files/`
8. **Live notification** (line 276): server calls `notify()` → pushes updates to all SSE subscribers for that channel
9. Browser receives SSE event → calls `refreshFiles()` → fetches `/api/{channel}/files`, re-renders file list

### Diff Calculation (Server-Side)

1. Client POSTs `/api/{channel}/diff` with `{files: {path: hash, ...}}`
2. Server acquires read lock (`handleDiff` line 196)
3. Walks `dataDir/{channel}/files/` tree with `filepath.WalkDir()`, SHA256-hashes each file → server manifest
4. Compares client manifest to server manifest:
   - **client_only**: paths in client but not on server → upload needed
   - **server_only**: paths on server but not in client → may delete if user requests
   - **different**: paths with different hashes → upload needed
   - **same**: count of unchanged files

### Download Path (ZIP Export)

1. User clicks "Download ZIP" or selects files and downloads
2. Browser calls `downloadAll()` (line 739) → GET `/api/{channel}/download?token=...` or POST `/api/{channel}/download` with file list
3. Server acquires read lock (`handleDownload` line 282)
4. Calls `writeZip()` (line 136): creates zip.Writer, adds files from `dataDir/{channel}/files/` with safe path check
5. Streams zip bytes to `w` (http.ResponseWriter)
6. Browser receives `Content-Type: application/zip`, triggers download

### CLI Push (Batch Upload)

1. User runs `sync push a ./mydir`
2. Script calls `scan_dir()` (line 139) → walks local directory, SHA256-hashes each file, builds manifest
3. POSTs `/api/a/diff` with manifest
4. Batches files into groups of 50 (line 190), POSTs multipart to `/api/a/upload`
5. Server processes as above

### SSE Live Update Channel

1. Browser calls `/api/{channel}/events` (GET) → `handleEvents()` line 416
2. Server checks if response writer supports Flusher, subscribes channel to pub/sub: `c := s.subscribe(ch)` (line 429)
3. Server loops: waits on `<-c` channel for notifications
4. When a file upload/delete/clear happens, `s.notify(ch)` (line 276/378/391) sends `struct{}{}` to all subscribers
5. Subscriber writes SSE-formatted "data: update\n\n" and flushes
6. Browser receives event, calls `refreshFiles()` to re-list

**State Management:**
- **Per-request state**: multipart reader, form data — discarded after request
- **Per-channel state**: file tree on disk, manifest (computed on-demand via `filepath.WalkDir()`)
- **Global state**: `server.locks` (2 RWMutex), `server.subs` (2 channel slices), `server.token` (immutable after init)
- **Client-side state**: localStorage (`sync_ignore`, `sync_all`), sessionStorage (`sync_token`), tree expansion state in memory

## Key Abstractions

**Server struct:**
- Purpose: Holds shared state (dataDir, token, locks, pub/sub channels)
- Location: `main.go` lines 27–33
- Pattern: Closure-based handlers that capture `*server`
- Usage: Passed as receiver to all handler methods

**Per-Channel Locks:**
- Purpose: Enforce serialization of writes (upload, delete) and prevent dirty reads
- Pattern: RWMutex in map keyed by channel name ("a" or "b")
- Guarantees: Only one upload/delete at a time per channel; concurrent reads allowed during reads

**Pub/Sub Channels:**
- Purpose: Notify SSE subscribers of server-side changes
- Pattern: map of channel name → slice of `chan struct{}`
- Usage: `subscribe()` appends new channel, `notify()` sends to all, `unsubscribe()` removes on disconnect

**Safe Path:**
- Purpose: Prevent path traversal attacks (e.g., `../../etc/passwd`)
- Pattern: `safePath()` function (line 128) cleans and validates relative paths
- Guarantee: Returns empty string if path is absolute or starts with `..`

**Manifest (Hash Dictionary):**
- Purpose: Represent file state for diff computation
- Pattern: `map[string]string` where key is filepath (forward slashes) and value is hex SHA256
- Computation: On-demand via `filepath.WalkDir()`, every call re-hashes all files
- Note: No caching — inefficient for large directory trees, but ensures fresh data

## Entry Points

**Go Server (`main()` function):**
- Location: `main.go` line 443
- Triggers: Binary execution `./sync-temple [--addr] [--data] [--token]`
- Responsibilities:
  - Parse command-line flags (address, data directory, auth token)
  - Auto-generate token if not provided
  - Initialize `server` struct with directories
  - Register HTTP routes on `http.NewServeMux()`
  - Start HTTP listener on specified address
  - Print startup banner with listen address and token

**Web UI Load:**
- Location: Browser navigates to server URL (e.g., `https://sync.0xxi.cloud`)
- Route: `GET /` → `serveUI()` (line 180)
- Responsibilities: Serves embedded `index.html`, sets `Cache-Control: no-cache`
- Client then renders UI, prompts for token, establishes auth

**CLI Entry:**
- Location: `sync` script line 294 (`main()` function)
- Triggers: `python3 sync push a ./dir` or other subcommand
- Responsibilities: Parse args, read `SYNC_TEMPLE_URL` and `SYNC_TEMPLE_TOKEN` env vars, dispatch to command handler

## Architectural Constraints

- **Two hard-coded channels**: Architecture assumes exactly 2 channels (a, b). Adding more requires changes to route handlers and server initialization.
- **Single token, no user isolation**: All connected clients share the same auth token. No per-user quotas, file ownership, or access control.
- **RWMutex per channel**: Read-heavy operations (diff, files, download) can overlap. Write operations (upload, delete, clear) are serialized per channel.
- **Manifest re-computed on every diff**: No caching of file hashes. Large directories with 1000+ files will re-walk and re-hash on every diff request.
- **In-memory pub/sub**: SSE subscribers stored in RAM (`server.subs`). Server restart loses all active SSE connections; clients must reconnect.
- **Multipart size limits**: No explicit per-file limit in Go code, but `handleSetText` uses `io.LimitReader` to cap text at 10MB (line 405).
- **Filename path encoding**: All paths normalized to forward slashes internally (line 122, 341). OS path separator is used only for filesystem operations.
- **Synchronous request handling**: Each upload request blocks until all parts are written to disk. Large uploads may timeout or exhaust memory.

## Anti-Patterns

### Lack of Manifest Caching

**What happens:** Every call to `handleDiff()` and `handleListFiles()` walks the entire file tree and re-computes SHA256 hashes for all files (lines 107–126, 328–346).

**Why it's wrong:** Directories with 1000+ files will stall the server on each client request, especially if multiple clients diff simultaneously. This is O(n) per request with no opportunity for parallelism or caching.

**Do this instead:** Implement a manifest cache with invalidation on write operations. When `uploadFiles()` or `deleteFiles()` succeeds, clear the cache for that channel. Cache can be a simple `map[string]map[string]string` with a timestamp. Or use filesystem-level change detection (e.g., file system watcher on `dataDir`).

### Unbounded SSE Subscriber List

**What happens:** Every call to `subscribe()` appends a new channel to `server.subs[ch]` (line 54). There is no cleanup if a browser stays connected forever or reconnects repeatedly.

**Why it's wrong:** Over time, `server.subs[ch]` grows unbounded in memory. Each `notify()` call iterates all of them. Memory leak over days/weeks of operation.

**Do this instead:** Implement a timeout on SSE connections. If a subscriber doesn't receive updates within X seconds, auto-close and unsubscribe. Or use a leaky bucket pattern where old subscribers are periodically pruned.

### No Request Rate Limiting

**What happens:** Any client can POST unlimited upload requests, DELETE requests, or diff calls without throttle.

**Why it's wrong:** A malicious or buggy client can spam the server, causing disk I/O exhaustion or denial of service to other clients.

**Do this instead:** Implement per-token or per-channel rate limiting. Count requests per second, limit to N requests per minute, or throttle based on upload size.

### Reliance on External ZIP Library for Download

**What happens:** `writeZip()` builds a zip in-memory (`zip.NewWriter(w)`) or streams to buffer (line 310) before sending to client.

**Why it's wrong:** Large ZIP files are not streamed; they're buffered entirely. A 1GB file download will allocate 1GB in RAM. For `handleDownloadSelected()` (line 297), the entire ZIP is written to a `bytes.Buffer` before responding.

**Do this instead:** Stream the zip directly to `http.ResponseWriter`. This requires wrapping the writer to track compressed size, but avoids memory bloat.

## Error Handling

**Strategy:** Fail-open with informative HTTP errors; continue processing other files on partial failures.

**Patterns:**
- **Multipart upload**: If one file fails to read or write, log warning and skip (lines 254–274). Upload continues with remaining files. Client sees total count of successful uploads.
- **File deletion**: If `os.Remove()` fails, log and skip (lines 372–374). Return count of deleted files.
- **Manifest walking**: If `filepath.WalkDir()` encounters an error, return error to caller (lines 110–126). But callers ignore errors in some cases (e.g., `handleListFiles()` line 335: `_, _ := d.Info()`).
- **JSON encoding**: If JSON marshal fails, log and return 500 (not shown, but assumed in handlers that use `json.NewEncoder`).
- **Safe path validation**: Invalid paths are silently dropped, not rejected with an error.

## Cross-Cutting Concerns

**Logging:** Minimal logging. Only startup banner printed to stdout. No structured logging of requests, errors, or file operations. Useful for debugging but not suitable for production auditing.

**Validation:** 
- Token comparison uses `crypto/subtle.ConstantTimeCompare()` (line 88) to prevent timing attacks.
- Paths validated with `safePath()` to prevent directory traversal.
- JSON decoded with standard `json.NewDecoder`, no schema validation.

**Authentication:** Bearer token in Authorization header or URL query param. Single shared token, no expiration or revocation. Token printed to stdout on startup, recommended to be saved/guarded separately.

**Concurrency Control:** Per-channel RWMutex. No global lock, so concurrent operations on channel A and B can proceed in parallel. But within a channel, writes are fully serialized.

---

*Architecture analysis: 2026-05-11*
