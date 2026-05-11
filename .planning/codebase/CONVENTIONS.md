# Coding Conventions

**Analysis Date:** 2026-05-11

## Naming Patterns

**Files:**
- Go: `main.go` (single monolithic server file)
- Shell: `setup-sync-jail.sh` (kebab-case with .sh extension)
- Service: `sync_temple.rc` (snake_case for FreeBSD rc.d scripts)
- HTML/static: `static/index.html`

**Functions (Go):**
- Exported (public) functions: PascalCase (`newServer`, `handleDiff`, `handleUpload`)
- Unexported (private) functions: camelCase (`safePath`, `cleanEmptyDirs`, `serveUI`)
- HTTP handler methods: `handle[Action]` pattern (e.g., `handleDiff`, `handleUpload`, `handleListFiles`)
- Helper methods: descriptive camelCase (e.g., `filesDir`, `manifest`, `notify`, `subscribe`)

**Variables (Go):**
- Local variables: camelCase (`dataDir`, `token`, `locks`, `subs`, `fileList`)
- Struct fields: PascalCase (exported publicly) - see `server` struct at `main.go:27-33`
- Channel variables: single letters or descriptive (`ch` for channel, `c` for chan struct{})

**Types (Go):**
- Struct names: PascalCase (`server`)
- Interface names: idiomatic Go (not used extensively; error handling via explicit types)
- Receiver names: single-letter abbreviation (`s *server`)

**Functions (JavaScript):**
- Event handlers: `on[Event]` pattern (e.g., `onPickerCheck`)
- Async functions: camelCase with clear purpose (`uploadFiles`, `refreshFiles`, `connectSSE`)
- Utility functions: descriptive camelCase (`getFilesFromDrop`, `traverseEntry`, `buildTree`, `isIgnored`)
- State getters: `[noun]Stats` (e.g., `pickerStats`)
- Format/helper functions: `fmt[Type]` or `format[Type]` (e.g., `fmtBytes`, `fmtSize`)

**Variables (JavaScript):**
- Module-level state: camelCase (`token`, `ignorePatterns`, `syncAll`, `eventSources`, `pickerFiles`)
- DOM references: typically stored in functions (e.g., document.getElementById calls inline)
- Collection names: plural noun form (`files`, `dirs`, `entries`, `ignorePatterns`)

**Shell (Bash/sh):**
- Variables: UPPER_CASE for constants (`JAIL`, `HOME_DIR`, `SYNC_TEMPLE_TOKEN`)
- Functions: snake_case (`log`, `ok`, `err`)
- Local variables: snake_case lowercase (`pf`, `caddyfile`)

## Code Style

**Formatting:**

**Go:**
- Uses standard `gofmt` formatting (automatic code reformatting implied by idiomatic Go)
- No visible linting overrides or custom formatters
- Standard Go conventions: 8-space indentation (via gofmt)
- Line length: appears to follow Go convention (~80-100 chars, flexible)
- See `main.go:1-50` for import organization and basic structure

**Shell:**
- Manual formatting in `setup-sync-jail.sh` and `sync_temple.rc`
- Consistent 2-space indentation
- Uses section comments with ASCII art delimiters: `# ── 1. Install binary ──` (line 18)
- Comments precede logical sections

**HTML/CSS:**
- Minified CSS in style block (`static/index.html:7-72`)
- CSS custom properties (variables) for theming: `--bg`, `--surface`, `--accent`, `--danger`, `--success`
- Inline JavaScript (no separate .js file)

**Linting:**

**Go:**
- No explicit linting config present (no `.golangci.yml`, no lintrc files)
- Follows idiomatic Go practices implicitly
- Standard library imports only; no external dependencies in go.mod (go 1.22.0)

**Shell:**
- No linter configuration present
- Script uses `set -e` in `setup-sync-jail.sh:5` for error exit on failure
- `sync_temple.rc` uses `/etc/rc.subr` conventions (FreeBSD standard)

**JavaScript:**
- No linter or formatter config (eslint, prettier, biome not present)
- Uses standard ES2020+ features (async/await, fetch, object spread)
- Inline event handlers via `onclick` attributes (HTML event binding style)
- Manual formatting maintained throughout

## Import Organization

**Go (main.go:3-22):**

Order observed:
1. Standard library: `archive/zip`, `bytes`, `crypto/...`, `encoding/...`, `flag`, `fmt`, `io`, `io/fs`, `log`, `net/http`, `os`, `path/filepath`, `strings`, `sync`
2. Special imports: `_ "embed"` (for embed.go directive)

Pattern: Standard library only, in alphabetical order. No external dependencies.

**JavaScript (static/index.html:171+):**

No explicit imports (all code inline in script block). Constants and functions defined sequentially:
1. Constants and defaults (DEFAULT_IGNORE array at line 172)
2. Module-level state (lines 201-204)
3. Logical function groups: Auth, API, Ignore, Hashing, File reading, Picker, Upload, Channel ops, SSE, Modals

**Shell:**
- Source external configs via `. /etc/rc.subr` (FreeBSD standard)
- All scripts are self-contained; no sourced library functions except rc.subr

## Error Handling

**Go:**

Pattern: Explicit error returns and error checking throughout.

Examples from `main.go`:
- `handleDiff` (line 186-229): Decodes JSON, checks error, returns HTTP error responses
- `manifest` (line 107-126): Returns error tuple `(map[string]string, error)`
- `safePath` (line 128-134): Returns `(string, bool)` tuple for validation
- File operations (e.g., line 145-146, 258-273): Check error, continue on failure in loops
- Silent error ignoring: `_, _ := filepath.Rel(root, path)` (line 114) — explicit blank assignment

Error response pattern:
```go
if err != nil {
    http.Error(w, "message", http.StatusBadRequest)
    return
}
```

Or in some cases, continue silently:
```go
f, err := os.Open(path)
if err != nil {
    continue  // skip file in manifest walk
}
```

**JavaScript:**

Pattern: Try-catch with promise `.catch()` for async operations.

Examples from `static/index.html`:
- `uploadFiles` (lines 631-712): Wraps entire operation in try-catch, catches `err` and updates status message
- `api` function (line 265): Throws `new Error('HTTP ' + resp.status)` on !ok response
- Promise chaining with `.catch()` (line 218-220): `api(...).catch(() => { alert(...) })`
- Silent failures: `console.warn(...)` used to log without stopping execution (lines 330, 646, 684)

**Shell:**

Pattern: `set -e` (exit on error) combined with explicit error checking.

`setup-sync-jail.sh:5`: Sets `set -e` at the top

Error handling via `err` helper (lines 16, 20, 26, 39, 76):
```sh
err() { printf "\033[1;31m    FAIL: %s\033[0m\n" "$1"; exit 1; }
cp ... || err "copy binary"
```

Conditional checks (lines 44-48):
```sh
if [ $? -eq 0 ]; then
    ok
else
    err "sync-temple not listening on 8787"
fi
```

## Logging

**Framework:** `log` package (Go), `console` (JavaScript), `printf` (shell)

**Go:**
- `main.go:476`: Single use: `log.Fatal(http.ListenAndServe(*addr, mux))`
- Status output via `fmt.Printf` (lines 457-461):
  ```go
  fmt.Printf("\n  Sync Temple\n")
  fmt.Printf("  ───────────\n")
  fmt.Printf("  Listen: %s\n", *addr)
  ```
- No structured logging; informational messages printed once at startup

**JavaScript:**
- Status updates via DOM: `status.textContent = "..."` (line 636)
- Console logging for debugging: `console.warn(...)` (lines 330, 646, 654, 684)
- Status color coding: `status.style.color = 'var(--success)'` or `'var(--danger)'`
- No logging framework; all logging is conditional (warnings only)

**Shell:**
- Custom logging functions: `log()`, `ok()`, `err()` (lines 14-16)
- Colored output using ANSI escape codes: `\033[1;34m` (blue), `\033[1;32m` (green), `\033[1;31m` (red)
- Every section step preceded by `log "message"` followed by `ok` on success
- Example (lines 19-22):
  ```sh
  log "Installing sync-temple binary into jail"
  cp ... || err "copy binary"
  ok
  ```

## Comments

**When to Comment:**

**Go:**
- Sparse but strategic: Functions have no comment headers except for exported API endpoints
- Section headers with `// ---` pattern (lines 48, 80, 101, 178)
- Inline comments for logic: "Walk bottom-up by collecting dirs first" (line 161)
- No verbose function documentation; code is self-documenting

**JavaScript:**
- Sparse: No function docstrings
- Section headers: `// --- Auth ---` (line 206), `// --- API ---` (line 249)
- Inline comments explain complex logic: "webkitRelativePath is ..." (line 314)
- Algorithm comments: "sort: dirs first (by size desc)..." (line 514)

**Shell:**
- Line comments before each logical section
- PROVIDE/REQUIRE/KEYWORD directives in rc.d header (lines 3-5 of sync_temple.rc)
- Inline comments explaining variable purpose (lines 8-10 of setup-sync-jail.sh)

**JSDoc/TSDoc:** Not used (no .ts files; vanilla JavaScript)

## Function Design

**Size:**

**Go:**
- Handlers: 30-50 lines typical (e.g., `handleDiff` 43 lines, `handleUpload` 44 lines)
- Helpers: 5-30 lines (e.g., `safePath` 7 lines, `cleanEmptyDirs` 17 lines)
- Largest: `manifest` walk function is 18 lines (lines 107-126)

**JavaScript:**
- Handlers: 20-80 lines (e.g., `uploadFiles` 82 lines with batching logic)
- Tree rendering: `renderRow` is 21 lines; `renderChildren` is 16 lines
- Tree walk logic: `traverseEntry` is 23 lines with recursion
- No excessively long functions; max observed ~82 lines

**Shell:**
- Scripts are procedural, not modular: `setup-sync-jail.sh` is single 129-line flow
- Helper functions: `log`, `ok`, `err` are 1-line utilities

**Parameters:**

**Go:**
- Receiver pattern: `(s *server)` on all server methods
- HTTP handlers: Always `(w http.ResponseWriter, r *http.Request)`
- Helpers: 1-2 parameters typical (e.g., `filesDir(ch string)`, `manifest(ch string)`)
- No variadic functions

**JavaScript:**
- Single parameter typical: `api(method, path, body?, extraHeaders?)`
- Event handlers: Single parameter (implicit `event` or no parameter)
- State functions: No parameters (use module-level state)
- Async callbacks: Return Promise, caller awaits

**Shell:**
- `log`, `ok`, `err` take single string parameter
- Command invocations pass quoted strings to functions

**Return Values:**

**Go:**
- Error returns: `(T, error)` tuple pattern throughout
- Some functions return single values: `filesDir` returns `string`
- Void helpers: `notify`, `unsubscribe` return nothing
- HTTP handlers return nothing (write response via `w`)

**JavaScript:**
- Async functions return Promise (implicit or explicit await)
- Void callbacks: `connect()` updates DOM, returns nothing
- Helper functions return values: `isIgnored(path)` returns bool
- Event handlers: Return nothing, side-effect via DOM/state

**Shell:**
- Functions return exit code implicitly (0 for success, 1 for error via `err` function)
- No explicit return values; functions perform actions

## Module Design

**Exports:**

**Go:**
- Single `main` function as entry point (`main.go:443-477`)
- `server` type and methods form the core (receiver pattern)
- Helpers are unexported: `safePath`, `cleanEmptyDirs`
- Exported types: None (struct `server` is unexported)

**JavaScript:**
- No explicit exports/imports (single global scope)
- All functions are global (accessible from HTML event handlers)
- Module-level state is global: `token`, `ignorePatterns`, `syncAll`, etc.

**Shell:**
- No modules; scripts are standalone
- `setup-sync-jail.sh` calls external commands (`bastille`, `doas`)

**Barrel Files:** Not applicable (no module bundling; single main.go file, single index.html)

---

*Convention analysis: 2026-05-11*
