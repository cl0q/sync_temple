<!-- refreshed: 2026-05-11 -->
# Codebase Structure

**Analysis Date:** 2026-05-11

## Directory Layout

```
/Users/olli/schenanigans/sync_temple/
├── main.go                   # Go HTTP server (entry point, routes, handlers)
├── go.mod                    # Module declaration (sync-temple, Go 1.22)
├── sync                      # Python CLI client (6 commands: push, pull, text-push, text-pull, files, clear)
├── sync-temple               # Shell script wrapper (Linux/macOS symlink or build artifact)
├── sync-temple-freebsd       # Shell script wrapper (FreeBSD-specific)
├── sync_temple.rc            # FreeBSD rc.d service config
├── setup-sync-jail.sh        # Setup script for FreeBSD jail installation
├── static/
│   └── index.html            # Embedded web UI (HTML + CSS + vanilla JavaScript)
├── MANUAL.md                 # User documentation (setup, CLI usage, typical workflow)
├── MANUAL                    # Plain text version of MANUAL.md
├── LOGS/
│   └── MLM/
│       └── log_apple_1.md    # Activity log (not version-controlled, for reference)
├── data/                     # Runtime directory (created on first run, not committed)
│   ├── a/
│   │   ├── files/           # Channel A uploaded files
│   │   └── text.txt         # Channel A quick text storage
│   └── b/
│       ├── files/           # Channel B uploaded files
│       └── text.txt         # Channel B quick text storage
└── .planning/
    └── codebase/            # (Generated documents, not source code)
        ├── ARCHITECTURE.md
        └── STRUCTURE.md
```

## Directory Purposes

**Root directory:**
- Purpose: Server entry point and client scripts colocated with deployment config
- Contains: Go server, shell wrappers, Python CLI, rc.d service file, setup script
- Key files: `main.go` (server), `sync` (CLI), `sync_temple.rc` (service)

**`static/`:**
- Purpose: Embedded web frontend
- Contains: Single-page application (HTML + CSS + JS)
- Key files: `index.html` (the web UI)
- Embedded in binary: Compiled into binary via `//go:embed static/index.html` (main.go line 24), served at `GET /`

**`data/`:**
- Purpose: Runtime file storage
- Contains: Per-channel file trees and text buffers
- Generated: Created automatically by server on first run via `os.MkdirAll(filepath.Join(dataDir, ch, "files"), 0755)` (main.go line 43)
- Committed: No, this is gitignore'd (or should be)
- Structure:
  - `a/files/` — uploaded files for channel A, preserving directory structure
  - `a/text.txt` — 10MB-capped text buffer for channel A
  - `b/files/` — uploaded files for channel B
  - `b/text.txt` — 10MB-capped text buffer for channel B

**`LOGS/`:**
- Purpose: Activity/incident logs (operational reference)
- Contains: Markdown notes on issues, deployments, bugs
- Not version-controlled data: reference logs, not source code

## Key File Locations

**Entry Points:**
- `main.go` line 443: Go server entry point (`func main()`) — parses flags, initializes server, starts HTTP listener
- `static/index.html` line 171: JavaScript entry point (`<script>`) — `connect()` handler, `DOMContentLoaded` init

**Configuration:**
- `go.mod` line 1: Go module name (`sync-temple`) and version (`go 1.22.0`)
- `sync_temple.rc` lines 15–18: FreeBSD rc.d defaults (token, address, data directory)
- `setup-sync-jail.sh` lines 8–12: Jail installation config (jail name, token handling, paths)
- `static/index.html` lines 172–199: DEFAULT_IGNORE patterns (frontend)
- `sync` lines 19–48: IGNORE_DIRS/IGNORE_FILES/IGNORE_GLOBS (CLI)

**Core Logic:**
- `main.go` lines 27–46: Server struct definition and initialization
- `main.go` lines 50–78: Pub/sub implementation (`subscribe`, `unsubscribe`, `notify`)
- `main.go` lines 82–99: Auth middleware (`requireAuth`)
- `main.go` lines 107–126: Manifest generation (`manifest`) — walks tree, SHA256 hashes
- `main.go` lines 128–134: Path validation (`safePath`) — prevents traversal attacks
- `main.go` lines 231–279: Upload handler (`handleUpload`) — multipart streaming, file creation
- `main.go` lines 136–158: ZIP creation (`writeZip`) — builds zip with files
- `main.go` lines 186–229: Diff computation (`handleDiff`) — compares client vs server manifests

**Frontend (JavaScript in static/index.html):**
- Lines 201–221: Auth (`connect()` function) — validates token, fetches `/api/a/files`
- Lines 311–369: File collection (`getFilesFromInput()`, `getFilesFromDrop()`, `traverseEntry()`) — builds file array with paths and objects
- Lines 372–619: File picker UI (`openPicker()`, `renderPicker()`, `buildTree()`) — interactive tree with checkboxes, expansion, filtering
- Lines 631–712: Upload (`uploadFiles()`) — hash, diff, batch multipart POST
- Lines 715–791: Channel ops (`refreshFiles()`, `connectSSE()`) — fetch file list, subscribe to live updates
- Lines 793–806: Ignore patterns modal — edit localStorage

**CLI (Python in sync):**
- Lines 51–60: Environment (`get_env()`) — reads `SYNC_TEMPLE_URL` and `SYNC_TEMPLE_TOKEN`
- Lines 63–87: Ignore logic (`should_ignore()`) — evaluates IGNORE_DIRS/GLOBS
- Lines 92–134: HTTP helpers (`request()`, `json_req()`, `multipart_upload()`) — Bearer token injection, multipart encoding
- Lines 139–155: Scanning (`scan_dir()`) — walks local directory, builds manifest
- Lines 160–204: Push command (`cmd_push()`) — diff, batch upload 50 files/request
- Lines 206–244: Pull command (`cmd_pull()`) — diff, zip download, extract
- Lines 247–259: Text commands (`cmd_text_push()`, `cmd_text_pull()`) — read/write channel text
- Lines 262–273: Files listing (`cmd_files()`)
- Lines 276–283: Clear command (`cmd_clear()`)

**Testing/Validation:**
- No test files in repo. Manual testing only (see MANUAL.md "TYPICAL LOOP").

## Naming Conventions

**Files:**
- Executables: lowercase with hyphens (`sync-temple`, `sync-temple-freebsd`)
- Scripts: lowercase with hyphens (`setup-sync-jail.sh`)
- Go modules: snake_case (`sync-temple` in go.mod)
- Documentation: UPPERCASE.md or UPPERCASE without extension (MANUAL.md, MANUAL)

**Directories:**
- Runtime storage: lowercase (`data`, `static`, `LOGS`)
- Language-specific: lowercase (no language dir, everything is root-level)

**Functions (Go):**
- Exported (capitalized): `NewServer` (though written as `newServer` — should be `NewServer`), handler methods (`ServeUI`, `HandleDiff`, etc. — should be capitalized but aren't)
- Private (lowercase): `safePath`, `cleanEmptyDirs`, `manifest` (should be unexported)
- **Issue**: Handlers are private methods (`serveUI`, `handleDiff`) but should be exported (`ServeUI`, `HandleDiff`) per Go conventions

**Functions (Python):**
- Command handlers: `cmd_<operation>` (e.g., `cmd_push`, `cmd_pull`)
- Helpers: lowercase with underscores (e.g., `should_ignore`, `get_env`, `fmt_size`)

**Variables (JavaScript):**
- Global state: camelCase (`token`, `ignorePatterns`, `syncAll`, `eventSources`)
- DOM elements: element ID prefixes (e.g., `drop-a`, `status-a`, `files-a` for channel A; `drop-b`, etc. for channel B)
- Tree state: camelCase (e.g., `pickerCh`, `pickerFiles`, `pickerExcluded`, `pickerExpanded`)

**API Endpoints:**
- Structure: `/api/{channel}/{operation}`
- Channels: `a` or `b` (hardcoded, no wildcards)
- Operations: `upload`, `download`, `diff`, `files`, `delete`, `text`, `events`
- Example: `POST /api/a/upload`, `GET /api/b/files`, `GET /api/b/events`

## Where to Add New Code

**New Feature (e.g., file search):**
- **Backend handler**: Add method to `server` struct in `main.go` (e.g., `handleSearch()`), register route with `mux.HandleFunc()`
- **Frontend**: Add UI element to `static/index.html`, add event handlers and API call in JavaScript
- **CLI**: Add command function to `sync` script (e.g., `cmd_search()`), register in argparse subcommands
- **API route**: Follow pattern `/api/{channel}/{operation}` in `main.go` line 463–474

**New Handler (e.g., ZIP subset)::**
- Location: `main.go` near line 281–314 (where download handlers are)
- Pattern: 
  ```go
  func (s *server) handleNewOp(w http.ResponseWriter, r *http.Request) {
    ch := r.PathValue("channel")
    // validate auth in middleware (requireAuth wrapper)
    s.locks[ch].RLock() // or .Lock() for writes
    defer s.locks[ch].RUnlock()
    // ... implementation
  }
  ```
- Register with: `mux.HandleFunc("POST /api/{channel}/new-op", s.requireAuth(s.handleNewOp))` in `main()` line 463–474

**New Ignore Pattern:**
- **Frontend**: Add to `DEFAULT_IGNORE` array `static/index.html` line 172–199
- **CLI**: Add to `IGNORE_DIRS`, `IGNORE_FILES`, or `IGNORE_GLOBS` in `sync` lines 19–48
- **Note**: Both must be updated to keep CLI and web UI behavior in sync

**New File/Directory Operations (e.g., rename, move):**
- **Backend**: Add handler in `main.go`, use `os.Rename()`, acquire write lock
- **Frontend**: Add UI buttons in relevant channel div (`static/index.html` lines 95–136)
- **CLI**: Add command in `sync`
- **Note**: Update manifest generation and diff logic if operation affects file paths

**Testing:**
- No test files exist. Add tests in `*_test.go` files (Go convention), following pattern:
  ```go
  // main_test.go
  func TestHandleUpload(t *testing.T) { ... }
  ```
- Run with `go test ./...`

## Special Directories

**`data/`:**
- Purpose: Runtime file storage
- Generated: Yes, created on first server start
- Committed: No, should be in `.gitignore`
- Size: Unbounded (server stores all uploaded files indefinitely until cleared)
- Note: Persists across server restarts unless manually deleted

**`static/`:**
- Purpose: Web frontend
- Generated: No, authored directly
- Committed: Yes
- Embedded: Compiled into binary via `//go:embed`, served from memory (no disk reads per request)
- Size: ~30KB (index.html)

**`LOGS/`:**
- Purpose: Activity logs and operational notes
- Generated: By human (not automated)
- Committed: Partially (reference logs, not real-time)
- Note: Not accessed by server at runtime

**`.planning/codebase/`:**
- Purpose: Generated documentation (this directory)
- Generated: Yes, by codebase mapper
- Committed: Yes (to assist future phases)
- Note: Not accessed by server at runtime

## Build & Deployment

**Build (Go):**
```bash
go build -o sync-temple main.go
```
- Produces single binary `sync-temple` with embedded static/index.html
- No dependencies beyond Go stdlib (go.mod has no external imports)

**Deployment (FreeBSD jail):**
- `setup-sync-jail.sh` script automates: binary copy, rc.d registration, pf.conf update, Caddy config
- Service control: `bastille service sync sync_temple <start|stop|restart>`
- Data directory: `/var/db/sync_temple` inside jail (configurable via rc sysrc)

**CLI Setup (macOS/Linux):**
- Copy `sync` script to local PATH or create alias
- Set `SYNC_TEMPLE_URL` and `SYNC_TEMPLE_TOKEN` env vars
- Usage: `sync push a ./dir`, `sync pull b ./dir`, etc.

---

*Structure analysis: 2026-05-11*
