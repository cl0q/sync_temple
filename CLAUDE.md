<!-- GSD:project-start source:PROJECT.md -->
## Project

**sync_temple**

sync_temple ist ein selbst-gehostetes File-Sync-System für den schnellen, schlanken Austausch von Dateien und Texten zwischen zwei festen Kanälen ("a" und "b"). Es besteht aus einem Go-HTTP-Server (Single-Binary, Zero-Dependency), einer eingebetteten Web-UI (Drag-and-Drop, Live-Updates via SSE) und einer CLI für Skript- und Terminal-Workflows. Zielnutzer: ich selbst — als Brücke zwischen Geräten und Boxen, ohne Cloud-Provider und ohne fremde Konten.

**Core Value:** **Beliebig viele Dateien zuverlässig zwischen zwei Endpunkten austauschen — über Web-UI oder CLI — ohne mit unsichtbaren Limits gegen die Wand zu fahren.**

Wenn Uploads bei 15 Dateien abbrechen, ist das ganze System nutzlos. Robustheit beim Upload schlägt jedes andere Feature.

### Constraints

- **Tech-Stack-Lock-in (Server)**: Go stdlib only, keine externen Go-Dependencies — Begründung: Single-Binary, einfaches FreeBSD-Jail-Deployment, kein supply-chain-Risiko. Diese Regel gilt weiter.
- **Tech-Stack-Lock-in (Frontend)**: Vanilla JavaScript, kein Build-Step, kein Framework — Begründung: UI ist via `//go:embed` ins Binary geliefert; React/Vue würde Build-Pipeline erzwingen.
- **CLI-Sprache**: Wechsel von Python zu Go für die CLI — Begründung: Eine Sprache im Stack, single Binary, keine Python-Runtime-Abhängigkeit, einfacher Cross-Compile für FreeBSD.
- **Compatibility**: macOS-arm64, macOS-amd64, Linux-amd64, FreeBSD-amd64 müssen alle laufen.
- **Hosting**: FreeBSD-Jail mit `bastille`, Caddy als TLS-Termination. Diese Topologie bleibt.
- **Auth-Modell**: Single-Shared-Token. Keine User-Accounts in dieser oder absehbarer Milestone.
- **Backward-Compatibility**: Bestehende `SYNC_TEMPLE_URL`/`SYNC_TEMPLE_TOKEN`-Env-Vars und die zwei Kanäle (a, b) müssen weiter funktionieren.
<!-- GSD:project-end -->

<!-- GSD:stack-start source:codebase/STACK.md -->
## Technology Stack

## Languages
- Go 1.22.0 - HTTP server implementation in `main.go`
- Python 3 - CLI tool in `sync` (requires python3)
- Shell (sh) - Service initialization in `sync_temple.rc` and setup script `setup-sync-jail.sh`
- JavaScript (ES6) - Web UI frontend in `static/index.html`
- HTML5 - Web UI markup in `static/index.html`
- CSS3 - Web UI styling in `static/index.html` (inline)
## Runtime
- Go 1.22.0 (server binary compilation)
- Python 3.x (CLI execution)
- Shell (FreeBSD rc.d, bash/sh for setup)
- Go modules (`go.mod`)
- Pip/built-in modules for Python (no requirements.txt)
- Compiled macOS arm64 Mach-O executable: `sync-temple` (8.4 MB)
- Also available: `sync-temple-freebsd` (FreeBSD variant)
## Frameworks
- Go stdlib `net/http` - HTTP server and request handling
- Go stdlib `encoding/json` - JSON serialization/deserialization
- Go stdlib `archive/zip` - ZIP file creation for downloads
- Go stdlib `crypto/sha256` - File hash computation
- Go stdlib `sync` - Mutexes and channels for concurrency
- Go stdlib `io/fs` - Directory traversal and file operations
- Vanilla JavaScript (no framework)
- Browser native APIs: Fetch API, EventSource (SSE), WebCrypto (SHA-256), File API, DataTransfer
- Python standard library: `argparse`, `urllib`, `hashlib`, `json`, `zipfile`, `ssl`
- No external dependencies
- Not detected
- Not detected
## Key Dependencies
- Go 1.22.0 standard library provides all functionality
- No third-party Go packages imported
- No external package manager required for server
- Go compiler (for building binary from source)
- FreeBSD bastille (for jailing on production)
- Caddy reverse proxy (frontend proxy, not a dependency)
- OpenSSL/TLS (runtime, provided by OS)
## Configuration
- `SYNC_TEMPLE_URL` - Server URL (e.g., https://sync.0xxi.cloud)
- `SYNC_TEMPLE_TOKEN` - Authentication token (auto-generated if not provided to server, required for CLI)
- `go.mod` - Single module, no external dependencies
- Default binary output: `sync-temple` (run `go build -o sync-temple main.go`)
- `-addr` - Listen address (default: `:8787`)
- `-data` - Data directory path (default: `./data`)
- `-token` - Auth token (auto-generated from 16 random bytes if empty)
- `sync_temple.rc` - Service script with configurable:
## Platform Requirements
- Go 1.22+ compiler
- Python 3.6+ (for CLI tool only)
- macOS, Linux, or FreeBSD
- FreeBSD (jail deployment in `setup-sync-jail.sh`)
- Alternative: Any OS that can run the Go binary (Linux, macOS, Windows)
- Caddy reverse proxy (for HTTPS termination and routing)
- Cloudflare DNS proxy (optional, for public access)
- pf firewall (for FreeBSD jail networking)
## Notable Technical Choices
- All HTTP, crypto, compression, and file I/O uses Go stdlib
- Makes deployment trivial: single statically-compiled binary
- Web UI (`static/index.html`) embedded into binary via `//go:embed` directive
- No separate file distribution needed
- No build step, framework, or node_modules
- Inline CSS for minimal requests
- Works in any modern browser
- Standard library only (no pip install needed)
- Cross-platform (macOS, Linux tested; Windows path handling included)
- Self-contained in `sync` file
<!-- GSD:stack-end -->

<!-- GSD:conventions-start source:CONVENTIONS.md -->
## Conventions

## Naming Patterns
- Go: `main.go` (single monolithic server file)
- Shell: `setup-sync-jail.sh` (kebab-case with .sh extension)
- Service: `sync_temple.rc` (snake_case for FreeBSD rc.d scripts)
- HTML/static: `static/index.html`
- Exported (public) functions: PascalCase (`newServer`, `handleDiff`, `handleUpload`)
- Unexported (private) functions: camelCase (`safePath`, `cleanEmptyDirs`, `serveUI`)
- HTTP handler methods: `handle[Action]` pattern (e.g., `handleDiff`, `handleUpload`, `handleListFiles`)
- Helper methods: descriptive camelCase (e.g., `filesDir`, `manifest`, `notify`, `subscribe`)
- Local variables: camelCase (`dataDir`, `token`, `locks`, `subs`, `fileList`)
- Struct fields: PascalCase (exported publicly) - see `server` struct at `main.go:27-33`
- Channel variables: single letters or descriptive (`ch` for channel, `c` for chan struct{})
- Struct names: PascalCase (`server`)
- Interface names: idiomatic Go (not used extensively; error handling via explicit types)
- Receiver names: single-letter abbreviation (`s *server`)
- Event handlers: `on[Event]` pattern (e.g., `onPickerCheck`)
- Async functions: camelCase with clear purpose (`uploadFiles`, `refreshFiles`, `connectSSE`)
- Utility functions: descriptive camelCase (`getFilesFromDrop`, `traverseEntry`, `buildTree`, `isIgnored`)
- State getters: `[noun]Stats` (e.g., `pickerStats`)
- Format/helper functions: `fmt[Type]` or `format[Type]` (e.g., `fmtBytes`, `fmtSize`)
- Module-level state: camelCase (`token`, `ignorePatterns`, `syncAll`, `eventSources`, `pickerFiles`)
- DOM references: typically stored in functions (e.g., document.getElementById calls inline)
- Collection names: plural noun form (`files`, `dirs`, `entries`, `ignorePatterns`)
- Variables: UPPER_CASE for constants (`JAIL`, `HOME_DIR`, `SYNC_TEMPLE_TOKEN`)
- Functions: snake_case (`log`, `ok`, `err`)
- Local variables: snake_case lowercase (`pf`, `caddyfile`)
## Code Style
- Uses standard `gofmt` formatting (automatic code reformatting implied by idiomatic Go)
- No visible linting overrides or custom formatters
- Standard Go conventions: 8-space indentation (via gofmt)
- Line length: appears to follow Go convention (~80-100 chars, flexible)
- See `main.go:1-50` for import organization and basic structure
- Manual formatting in `setup-sync-jail.sh` and `sync_temple.rc`
- Consistent 2-space indentation
- Uses section comments with ASCII art delimiters: `# ── 1. Install binary ──` (line 18)
- Comments precede logical sections
- Minified CSS in style block (`static/index.html:7-72`)
- CSS custom properties (variables) for theming: `--bg`, `--surface`, `--accent`, `--danger`, `--success`
- Inline JavaScript (no separate .js file)
- No explicit linting config present (no `.golangci.yml`, no lintrc files)
- Follows idiomatic Go practices implicitly
- Standard library imports only; no external dependencies in go.mod (go 1.22.0)
- No linter configuration present
- Script uses `set -e` in `setup-sync-jail.sh:5` for error exit on failure
- `sync_temple.rc` uses `/etc/rc.subr` conventions (FreeBSD standard)
- No linter or formatter config (eslint, prettier, biome not present)
- Uses standard ES2020+ features (async/await, fetch, object spread)
- Inline event handlers via `onclick` attributes (HTML event binding style)
- Manual formatting maintained throughout
## Import Organization
- Source external configs via `. /etc/rc.subr` (FreeBSD standard)
- All scripts are self-contained; no sourced library functions except rc.subr
## Error Handling
- `handleDiff` (line 186-229): Decodes JSON, checks error, returns HTTP error responses
- `manifest` (line 107-126): Returns error tuple `(map[string]string, error)`
- `safePath` (line 128-134): Returns `(string, bool)` tuple for validation
- File operations (e.g., line 145-146, 258-273): Check error, continue on failure in loops
- Silent error ignoring: `_, _ := filepath.Rel(root, path)` (line 114) — explicit blank assignment
- `uploadFiles` (lines 631-712): Wraps entire operation in try-catch, catches `err` and updates status message
- `api` function (line 265): Throws `new Error('HTTP ' + resp.status)` on !ok response
- Promise chaining with `.catch()` (line 218-220): `api(...).catch(() => { alert(...) })`
- Silent failures: `console.warn(...)` used to log without stopping execution (lines 330, 646, 684)
## Logging
- `main.go:476`: Single use: `log.Fatal(http.ListenAndServe(*addr, mux))`
- Status output via `fmt.Printf` (lines 457-461):
- No structured logging; informational messages printed once at startup
- Status updates via DOM: `status.textContent = "..."` (line 636)
- Console logging for debugging: `console.warn(...)` (lines 330, 646, 654, 684)
- Status color coding: `status.style.color = 'var(--success)'` or `'var(--danger)'`
- No logging framework; all logging is conditional (warnings only)
- Custom logging functions: `log()`, `ok()`, `err()` (lines 14-16)
- Colored output using ANSI escape codes: `\033[1;34m` (blue), `\033[1;32m` (green), `\033[1;31m` (red)
- Every section step preceded by `log "message"` followed by `ok` on success
- Example (lines 19-22):
## Comments
- Sparse but strategic: Functions have no comment headers except for exported API endpoints
- Section headers with `// ---` pattern (lines 48, 80, 101, 178)
- Inline comments for logic: "Walk bottom-up by collecting dirs first" (line 161)
- No verbose function documentation; code is self-documenting
- Sparse: No function docstrings
- Section headers: `// --- Auth ---` (line 206), `// --- API ---` (line 249)
- Inline comments explain complex logic: "webkitRelativePath is ..." (line 314)
- Algorithm comments: "sort: dirs first (by size desc)..." (line 514)
- Line comments before each logical section
- PROVIDE/REQUIRE/KEYWORD directives in rc.d header (lines 3-5 of sync_temple.rc)
- Inline comments explaining variable purpose (lines 8-10 of setup-sync-jail.sh)
## Function Design
- Handlers: 30-50 lines typical (e.g., `handleDiff` 43 lines, `handleUpload` 44 lines)
- Helpers: 5-30 lines (e.g., `safePath` 7 lines, `cleanEmptyDirs` 17 lines)
- Largest: `manifest` walk function is 18 lines (lines 107-126)
- Handlers: 20-80 lines (e.g., `uploadFiles` 82 lines with batching logic)
- Tree rendering: `renderRow` is 21 lines; `renderChildren` is 16 lines
- Tree walk logic: `traverseEntry` is 23 lines with recursion
- No excessively long functions; max observed ~82 lines
- Scripts are procedural, not modular: `setup-sync-jail.sh` is single 129-line flow
- Helper functions: `log`, `ok`, `err` are 1-line utilities
- Receiver pattern: `(s *server)` on all server methods
- HTTP handlers: Always `(w http.ResponseWriter, r *http.Request)`
- Helpers: 1-2 parameters typical (e.g., `filesDir(ch string)`, `manifest(ch string)`)
- No variadic functions
- Single parameter typical: `api(method, path, body?, extraHeaders?)`
- Event handlers: Single parameter (implicit `event` or no parameter)
- State functions: No parameters (use module-level state)
- Async callbacks: Return Promise, caller awaits
- `log`, `ok`, `err` take single string parameter
- Command invocations pass quoted strings to functions
- Error returns: `(T, error)` tuple pattern throughout
- Some functions return single values: `filesDir` returns `string`
- Void helpers: `notify`, `unsubscribe` return nothing
- HTTP handlers return nothing (write response via `w`)
- Async functions return Promise (implicit or explicit await)
- Void callbacks: `connect()` updates DOM, returns nothing
- Helper functions return values: `isIgnored(path)` returns bool
- Event handlers: Return nothing, side-effect via DOM/state
- Functions return exit code implicitly (0 for success, 1 for error via `err` function)
- No explicit return values; functions perform actions
## Module Design
- Single `main` function as entry point (`main.go:443-477`)
- `server` type and methods form the core (receiver pattern)
- Helpers are unexported: `safePath`, `cleanEmptyDirs`
- Exported types: None (struct `server` is unexported)
- No explicit exports/imports (single global scope)
- All functions are global (accessible from HTML event handlers)
- Module-level state is global: `token`, `ignorePatterns`, `syncAll`, etc.
- No modules; scripts are standalone
- `setup-sync-jail.sh` calls external commands (`bastille`, `doas`)
<!-- GSD:conventions-end -->

<!-- GSD:architecture-start source:ARCHITECTURE.md -->
## Architecture

## System Overview
```text
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
- **Two fixed channels** (a, b) for bidirectional sync — no per-user isolation
- **Diff-based uploads** — client hashes local files, server compares, only changed files are POSTed
- **Multipart streaming** — single request can upload multiple files; both web UI and CLI batch uploads to manage request size
- **Live updates** — Server-Sent Events (SSE) notify all connected browsers when files/text changes
- **Token-based auth** — single shared token (no user accounts); passed as Bearer or query param
- **Filesystem-backed** — direct file storage under `dataDir`; no database
## Layers
- Purpose: User interface for folder uploads, file browsing, text exchange, and live notifications
- Location: `static/index.html` (embedded in binary via `//go:embed`)
- Contains: HTML, CSS, JavaScript (vanilla)
- Depends on: HTTP API (`/api/{channel}/*` routes)
- Used by: Web browsers
- Purpose: HTTP endpoints for client operations
- Location: `main.go` (handler methods on `server` struct)
- Contains: 10 route handlers (auth, upload, download, diff, files, delete, clear, text, events, UI)
- Depends on: Filesystem, file locking, pub/sub channels
- Used by: Web UI and CLI clients
- Purpose: Prevent race conditions on channel data
- Location: `server.locks` (map of per-channel RWMutex), `server.subs` (pub/sub channels)
- Contains: 2 RWMutex (one per channel), 2 slice of SSE channels (one per channel)
- Depends on: sync.RWMutex, sync.Mutex
- Used by: All write/read handlers
- Purpose: Persistent storage and manifest generation
- Location: `server.dataDir` (default `./data`)
- Contains: Directory tree (`a/files/`, `a/text.txt`, `b/files/`, `b/text.txt`)
- Depends on: OS filesystem
- Used by: All handlers for read/write operations
- Purpose: Command-line operations for batch sync from local machines
- Location: `sync` (Python 3 script)
- Contains: 6 commands (push, pull, text-push, text-pull, files, clear)
- Depends on: HTTP API
- Used by: Shell aliases/scripting
## Data Flow
### Primary Upload Path (Web UI Drag-Drop)
### Diff Calculation (Server-Side)
### Download Path (ZIP Export)
### CLI Push (Batch Upload)
### SSE Live Update Channel
- **Per-request state**: multipart reader, form data — discarded after request
- **Per-channel state**: file tree on disk, manifest (computed on-demand via `filepath.WalkDir()`)
- **Global state**: `server.locks` (2 RWMutex), `server.subs` (2 channel slices), `server.token` (immutable after init)
- **Client-side state**: localStorage (`sync_ignore`, `sync_all`), sessionStorage (`sync_token`), tree expansion state in memory
## Key Abstractions
- Purpose: Holds shared state (dataDir, token, locks, pub/sub channels)
- Location: `main.go` lines 27–33
- Pattern: Closure-based handlers that capture `*server`
- Usage: Passed as receiver to all handler methods
- Purpose: Enforce serialization of writes (upload, delete) and prevent dirty reads
- Pattern: RWMutex in map keyed by channel name ("a" or "b")
- Guarantees: Only one upload/delete at a time per channel; concurrent reads allowed during reads
- Purpose: Notify SSE subscribers of server-side changes
- Pattern: map of channel name → slice of `chan struct{}`
- Usage: `subscribe()` appends new channel, `notify()` sends to all, `unsubscribe()` removes on disconnect
- Purpose: Prevent path traversal attacks (e.g., `../../etc/passwd`)
- Pattern: `safePath()` function (line 128) cleans and validates relative paths
- Guarantee: Returns empty string if path is absolute or starts with `..`
- Purpose: Represent file state for diff computation
- Pattern: `map[string]string` where key is filepath (forward slashes) and value is hex SHA256
- Computation: On-demand via `filepath.WalkDir()`, every call re-hashes all files
- Note: No caching — inefficient for large directory trees, but ensures fresh data
## Entry Points
- Location: `main.go` line 443
- Triggers: Binary execution `./sync-temple [--addr] [--data] [--token]`
- Responsibilities:
- Location: Browser navigates to server URL (e.g., `https://sync.0xxi.cloud`)
- Route: `GET /` → `serveUI()` (line 180)
- Responsibilities: Serves embedded `index.html`, sets `Cache-Control: no-cache`
- Client then renders UI, prompts for token, establishes auth
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
### Unbounded SSE Subscriber List
### No Request Rate Limiting
### Reliance on External ZIP Library for Download
## Error Handling
- **Multipart upload**: If one file fails to read or write, log warning and skip (lines 254–274). Upload continues with remaining files. Client sees total count of successful uploads.
- **File deletion**: If `os.Remove()` fails, log and skip (lines 372–374). Return count of deleted files.
- **Manifest walking**: If `filepath.WalkDir()` encounters an error, return error to caller (lines 110–126). But callers ignore errors in some cases (e.g., `handleListFiles()` line 335: `_, _ := d.Info()`).
- **JSON encoding**: If JSON marshal fails, log and return 500 (not shown, but assumed in handlers that use `json.NewEncoder`).
- **Safe path validation**: Invalid paths are silently dropped, not rejected with an error.
## Cross-Cutting Concerns
- Token comparison uses `crypto/subtle.ConstantTimeCompare()` (line 88) to prevent timing attacks.
- Paths validated with `safePath()` to prevent directory traversal.
- JSON decoded with standard `json.NewDecoder`, no schema validation.
<!-- GSD:architecture-end -->

<!-- GSD:skills-start source:skills/ -->
## Project Skills

No project skills found. Add skills to any of: `.claude/skills/`, `.agents/skills/`, `.cursor/skills/`, `.github/skills/`, or `.codex/skills/` with a `SKILL.md` index file.
<!-- GSD:skills-end -->

<!-- GSD:workflow-start source:GSD defaults -->
## GSD Workflow Enforcement

Before using Edit, Write, or other file-changing tools, start work through a GSD command so planning artifacts and execution context stay in sync.

Use these entry points:
- `/gsd-quick` for small fixes, doc updates, and ad-hoc tasks
- `/gsd-debug` for investigation and bug fixing
- `/gsd-execute-phase` for planned phase work

Do not make direct repo edits outside a GSD workflow unless the user explicitly asks to bypass it.
<!-- GSD:workflow-end -->



<!-- GSD:profile-start -->
## Developer Profile

> Profile not yet configured. Run `/gsd-profile-user` to generate your developer profile.
> This section is managed by `generate-claude-profile` -- do not edit manually.
<!-- GSD:profile-end -->
