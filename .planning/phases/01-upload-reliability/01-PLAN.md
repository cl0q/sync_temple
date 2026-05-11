---
phase: 01-upload-reliability
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - main.go
autonomous: true
requirements:
  - UPLOAD-06
  - UPLOAD-07
  - UPLOAD-01
user_setup: []

must_haves:
  truths:
    - "POST /api/{ch}/upload with a request body >500 MB returns HTTP 413 with Content-Type: application/json and JSON body containing code=SIZE_LIMIT"
    - "After a successful upload, the destination directory contains no .tmp files"
    - "When an upload aborts mid-stream (client disconnects), no zero-byte or partial file remains in dataDir/{ch}/files/"
    - "Multi-file upload response is JSON with shape {uploaded:int, failed:int, errors:[{file, code, message}]}"
    - "A single stalled part times out after 5 minutes and the rest of the multipart request continues"
  artifacts:
    - path: "main.go"
      provides: "Hardened handleUpload with MaxBytesReader, atomic writes, per-file timeout, JSON error responses"
      contains: "MaxUploadBytes"
    - path: "main.go"
      provides: "Top-level constants for upload limits"
      contains: "PerFileUploadTimeout"
    - path: "main.go"
      provides: "JSON error helper used by upload handler"
      contains: "writeJSONError"
  key_links:
    - from: "main.go:handleUpload"
      to: "http.MaxBytesReader"
      via: "wraps r.Body before mr.NextPart loop"
      pattern: "http\\.MaxBytesReader\\(w, r\\.Body, MaxUploadBytes\\)"
    - from: "main.go:handleUpload"
      to: "os.Rename"
      via: "atomic finalization of .tmp file"
      pattern: "os\\.Rename\\("
    - from: "main.go:handleUpload"
      to: "context.WithTimeout"
      via: "per-part deadline"
      pattern: "context\\.WithTimeout"
---

<objective>
Harden `main.go` `handleUpload` to enforce a 500 MB request size limit (HTTP 413 with structured JSON), perform atomic writes via `.tmp` + `os.Rename` so partial/empty files never appear on disk, apply a 5-minute per-file timeout, and return an extended JSON response shape `{uploaded, failed, errors[]}`. Adds two new constants at the top of `main.go` and a small `writeJSONError` helper. Closes the server-side half of UPLOAD-01 (reliability foundation) and fully delivers UPLOAD-06 and UPLOAD-07.

Purpose: Without server limits and atomic writes, the per-file client queue from Plan 02 can still leave the server with empty files on abort and can be DoS'd by a single oversize request. This plan establishes the server contract that Plan 02 codes against.

Output: Modified `main.go` — single file, no new files, no new imports beyond `context` and `time` (both stdlib).
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/PROJECT.md
@.planning/ROADMAP.md
@.planning/STATE.md
@.planning/REQUIREMENTS.md
@.planning/phases/01-upload-reliability/01-CONTEXT.md
@.planning/codebase/CONCERNS.md
@.planning/codebase/CONVENTIONS.md
@main.go

<interfaces>
<!-- Key contracts the executor must preserve / produce. Extracted from main.go and CONTEXT.md. -->

Existing handler signature (line 231) — preserve:
```go
func (s *server) handleUpload(w http.ResponseWriter, r *http.Request)
```

Existing helpers — reuse, do not duplicate:
```go
func (s *server) filesDir(ch string) string                 // main.go:103
func safePath(p string) (string, bool)                      // main.go:128
func (s *server) notify(ch string)                          // main.go:69
```

Existing imports (main.go:3-22) — `context` and `time` are NOT yet imported, add them.

Existing response shape (line 278) — extend, do not break:
```go
json.NewEncoder(w).Encode(map[string]int{"uploaded": n})
// becomes (per D-15):
json.NewEncoder(w).Encode(map[string]any{
    "uploaded": uploaded,
    "failed":   failed,
    "errors":   errs, // []map[string]string{{"file":..., "code":..., "message":...}}
})
```
The `uploaded` field MUST remain present and integer-typed — Python CLI (`sync` script) parses it via `.json()` and reads `r["uploaded"]` (D-17).

New JSON error contract (D-10) — Content-Type `application/json`, body shape:
```json
{"error": "<human message>", "code": "<MACHINE_CODE>"}
```
Initial codes: `SIZE_LIMIT`, `TIMEOUT`, `BAD_REQUEST`, `AUTH_FAILED`, `INTERNAL`.

Atomic write pattern (D-13) — write to `<dest>.tmp`, then `os.Rename` to `<dest>`. On any error before rename, `os.Remove(dest + ".tmp")`.
</interfaces>
</context>

<tasks>

<task type="auto" tdd="false">
  <name>Task 1: Add constants and JSON error helper</name>
  <files>main.go</files>
  <read_first>
    - main.go (entire file — single-file project, 477 lines)
    - .planning/phases/01-upload-reliability/01-CONTEXT.md §Decisions D-10, D-12, D-16
    - .planning/codebase/CONVENTIONS.md §"Code Style" (Go) — gofmt, idiomatic naming
  </read_first>
  <behavior>
    - Constants are package-level (top of main.go, near imports) and immutable.
    - `writeJSONError(w, status, code, message)` sets `Content-Type: application/json`, calls `w.WriteHeader(status)`, encodes `{"error": message, "code": code}`. It MUST NOT call `http.Error` (which sets text/plain).
    - Adding `context` and `time` to the import block is required for Task 2 — do it here so Task 2 stays focused on `handleUpload`.
  </behavior>
  <action>
    Edit `main.go`:

    1. Extend the existing stdlib import block (currently `main.go:3-22`) by adding `"context"` and `"time"` in alphabetical order. The result must still be a single import block with all stdlib paths sorted alphabetically. Do NOT add any external dependency (Go-stdlib-only constraint from CLAUDE.md).

    2. Insert a constants block immediately after the import block (around line 23, before the `//go:embed` directive at line 24). Use this exact text (D-16 verbatim):
       ```go
       const (
           // MaxUploadBytes caps a single multipart upload request body. Enforced via http.MaxBytesReader.
           MaxUploadBytes = 500 << 20 // 500 MB

           // PerFileUploadTimeout is the deadline applied per multipart part during streaming.
           PerFileUploadTimeout = 5 * time.Minute
       )
       ```

    3. Add a new unexported helper `writeJSONError` placed in the `// --- Helpers ---` section (after `cleanEmptyDirs`, around line 177, before `// --- Handlers ---`). Use this exact signature and body:
       ```go
       func writeJSONError(w http.ResponseWriter, status int, code, message string) {
           w.Header().Set("Content-Type", "application/json")
           w.WriteHeader(status)
           json.NewEncoder(w).Encode(map[string]string{
               "error": message,
               "code":  code,
           })
       }
       ```

    4. Do NOT change `handleUpload` yet — that is Task 2.

    Run `go build ./...` to confirm the file still compiles with the unused-yet helper and constants (Go does not complain about unused package-level identifiers).
  </action>
  <verify>
    <automated>cd /Users/olli/schenanigans/sync_temple &amp;&amp; go build -o /tmp/sync-temple-task1 ./... &amp;&amp; grep -c '^const ($\|MaxUploadBytes\s*=\s*500\s*&lt;&lt;\s*20\|PerFileUploadTimeout\s*=\s*5\s*\*\s*time\.Minute\|^func writeJSONError' main.go | grep -v '^0$'</automated>
  </verify>
  <acceptance_criteria>
    - `grep -c '"context"' main.go` returns at least 1
    - `grep -c '"time"' main.go` returns at least 1
    - `grep -c 'MaxUploadBytes = 500 &lt;&lt; 20' main.go` returns exactly 1
    - `grep -c 'PerFileUploadTimeout = 5 \* time.Minute' main.go` returns exactly 1
    - `grep -c 'func writeJSONError(w http.ResponseWriter, status int, code, message string)' main.go` returns exactly 1
    - `go build -o /tmp/sync-temple-task1 ./...` exits with status 0
    - `go vet ./...` exits with status 0
  </acceptance_criteria>
  <done>
    main.go compiles; constants and helper exist and are exported only as package-private (lowercase `writeJSONError`); no behavioral change to existing handlers yet.
  </done>
</task>

<task type="auto" tdd="false">
  <name>Task 2: Rewrite handleUpload with MaxBytesReader, atomic writes, per-file timeout, and extended response</name>
  <files>main.go</files>
  <read_first>
    - main.go (current `handleUpload` at lines 231-279)
    - main.go (current `handleSetText` at lines 403-414 — the silent-error anti-pattern to AVOID)
    - .planning/phases/01-upload-reliability/01-CONTEXT.md §Decisions D-10..D-17
    - .planning/codebase/CONCERNS.md §"Missing Request Size Limits and Validation"
  </read_first>
  <behavior>
    - Request body wrapped by `http.MaxBytesReader(w, r.Body, MaxUploadBytes)` BEFORE calling `r.MultipartReader()`.
    - Any error from `r.MultipartReader()` or `mr.NextPart()` that is caused by exceeding `MaxBytesReader` returns HTTP 413 with `code=SIZE_LIMIT`. Detect via `errors.As` on `*http.MaxBytesError`, or by string-matching `"http: request body too large"` (Go 1.22 wraps this; both approaches are acceptable, prefer `errors.As` if it works against the stdlib type).
    - Each part is streamed to `<dest>.tmp`, then `os.Rename` to `<dest>` on success. On ANY error during `io.Copy` (including ctx cancellation), the .tmp file is removed and the part is counted as failed (not uploaded), AND an entry is appended to `errors[]`.
    - A `context.WithTimeout(r.Context(), PerFileUploadTimeout)` is created per part. The timeout cancellation must abort the in-progress `io.Copy` — implement via a goroutine that closes the part on ctx.Done, OR use a custom reader wrapping `part` that checks `ctx.Err()` on each Read. Either is acceptable; the simpler approach is the goroutine + `part.Close()` trick.
    - `failed` counter increments on every error path (bad name, MkdirAll fail, Create fail, Copy fail, Rename fail). The `n++` (renamed `uploaded`) increments ONLY after a successful `os.Rename`.
    - The per-channel write lock continues to wrap the whole loop (do not change locking — D-14 explicitly preserves channel-lock granularity).
    - `s.notify(ch)` still fires ONCE at the end (D-08 / CONTEXT §Reusable Assets).
    - Final response: `{"uploaded": N, "failed": M, "errors": [...]}` with `Content-Type: application/json`. The `uploaded` integer field is preserved for Python CLI compat (D-17).
    - On `MaxBytesReader` overflow, use `writeJSONError(w, http.StatusRequestEntityTooLarge, "SIZE_LIMIT", "request exceeds 500 MB")` and return.
    - On malformed multipart, use `writeJSONError(w, http.StatusBadRequest, "BAD_REQUEST", "multipart parse error: <err>")`.
  </behavior>
  <action>
    Replace the body of `handleUpload` (currently main.go:231-279) with a hardened version. The handler MUST follow this structure:

    ```go
    func (s *server) handleUpload(w http.ResponseWriter, r *http.Request) {
        ch := r.PathValue("channel")

        // D-12: enforce 500 MB request cap
        r.Body = http.MaxBytesReader(w, r.Body, MaxUploadBytes)

        mr, err := r.MultipartReader()
        if err != nil {
            // Detect oversize at parse time
            var maxErr *http.MaxBytesError
            if errors.As(err, &maxErr) {
                writeJSONError(w, http.StatusRequestEntityTooLarge, "SIZE_LIMIT", "request exceeds 500 MB")
                return
            }
            writeJSONError(w, http.StatusBadRequest, "BAD_REQUEST", "multipart parse error: "+err.Error())
            return
        }

        s.locks[ch].Lock()
        defer s.locks[ch].Unlock()

        root := s.filesDir(ch)
        uploaded := 0
        failed := 0
        errs := make([]map[string]string, 0)

        for {
            part, err := mr.NextPart()
            if err == io.EOF {
                break
            }
            if err != nil {
                var maxErr *http.MaxBytesError
                if errors.As(err, &maxErr) {
                    writeJSONError(w, http.StatusRequestEntityTooLarge, "SIZE_LIMIT", "request exceeds 500 MB")
                    return
                }
                writeJSONError(w, http.StatusBadRequest, "BAD_REQUEST", "part error: "+err.Error())
                return
            }

            name := part.FormName()
            // D-15: count every attempted part. Per-part failures append to errs and continue.
            if code, msg, ok := s.uploadOnePart(r.Context(), root, name, part); ok {
                uploaded++
            } else {
                failed++
                errs = append(errs, map[string]string{
                    "file":    name,
                    "code":    code,
                    "message": msg,
                })
                log.Printf("upload failed: ch=%s file=%q code=%s msg=%s", ch, name, code, msg)
            }
            part.Close()
        }

        s.notify(ch)
        w.Header().Set("Content-Type", "application/json")
        json.NewEncoder(w).Encode(map[string]any{
            "uploaded": uploaded,
            "failed":   failed,
            "errors":   errs,
        })
    }
    ```

    Add a new helper method `uploadOnePart` immediately after `handleUpload` with this exact signature and behavior (D-13, D-14):

    ```go
    // uploadOnePart streams a single multipart part to <root>/<safePath(name)>.tmp,
    // then atomically renames to the final path. Per-part deadline is PerFileUploadTimeout.
    // Returns (code, message, ok). On ok=false, no file is left on disk for this part.
    func (s *server) uploadOnePart(parentCtx context.Context, root, name string, part io.Reader) (string, string, bool) {
        clean, ok := safePath(name)
        if !ok {
            return "BAD_REQUEST", "invalid path: " + name, false
        }
        dest := filepath.Join(root, clean)
        if err := os.MkdirAll(filepath.Dir(dest), 0755); err != nil {
            return "INTERNAL", "mkdir: " + err.Error(), false
        }

        tmp := dest + ".tmp"
        dst, err := os.Create(tmp)
        if err != nil {
            return "INTERNAL", "create tmp: " + err.Error(), false
        }

        ctx, cancel := context.WithTimeout(parentCtx, PerFileUploadTimeout)
        defer cancel()

        // Abort io.Copy on context cancellation by closing the part reader.
        // Closing a multipart.Part causes the next Read to return io.ErrUnexpectedEOF.
        done := make(chan struct{})
        go func() {
            select {
            case <-ctx.Done():
                if pc, ok := part.(io.Closer); ok {
                    pc.Close()
                }
            case <-done:
            }
        }()

        _, copyErr := io.Copy(dst, part)
        close(done)
        closeErr := dst.Close()

        if copyErr != nil || closeErr != nil {
            os.Remove(tmp)
            if ctx.Err() == context.DeadlineExceeded {
                return "TIMEOUT", "per-file timeout exceeded", false
            }
            if copyErr != nil {
                return "INTERNAL", "copy: " + copyErr.Error(), false
            }
            return "INTERNAL", "close: " + closeErr.Error(), false
        }

        if err := os.Rename(tmp, dest); err != nil {
            os.Remove(tmp)
            return "INTERNAL", "rename: " + err.Error(), false
        }
        return "", "", true
    }
    ```

    Add `"errors"` to the stdlib import block (alphabetical). Run `go build` and `go vet` to verify.

    Do NOT modify any other handler in this task. `handleSetText`, `handleDownload`, etc. are out of scope (per CONTEXT.md §domain).
  </action>
  <verify>
    <automated>cd /Users/olli/schenanigans/sync_temple &amp;&amp; go build -o /tmp/sync-temple-task2 ./... &amp;&amp; go vet ./... &amp;&amp; grep -c 'http\.MaxBytesReader(w, r\.Body, MaxUploadBytes)' main.go &amp;&amp; grep -c 'os\.Rename(tmp, dest)' main.go &amp;&amp; grep -c 'context\.WithTimeout(parentCtx, PerFileUploadTimeout)' main.go &amp;&amp; grep -c 'writeJSONError(w, http\.StatusRequestEntityTooLarge, "SIZE_LIMIT"' main.go</automated>
  </verify>
  <acceptance_criteria>
    - `grep -c 'http.MaxBytesReader(w, r.Body, MaxUploadBytes)' main.go` returns exactly 1
    - `grep -c 'os.Rename(tmp, dest)' main.go` returns exactly 1
    - `grep -c 'dest + ".tmp"' main.go` returns at least 1
    - `grep -c 'context.WithTimeout(parentCtx, PerFileUploadTimeout)' main.go` returns exactly 1
    - `grep -c '"SIZE_LIMIT"' main.go` returns at least 2 (multipart-init check and per-part check)
    - `grep -c '"uploaded":' main.go` returns at least 1 (response shape)
    - `grep -c '"failed":' main.go` returns at least 1
    - `grep -c '"errors":' main.go` returns at least 1
    - `grep -c 'func (s \*server) uploadOnePart' main.go` returns exactly 1
    - `grep -c '"errors"$\|"errors"$' main.go` — confirm `errors` stdlib package imported (check via `grep -n '"errors"' main.go | grep -v '"errors":' | wc -l` returns at least 1)
    - `go build -o /tmp/sync-temple-task2 ./...` exits with status 0
    - `go vet ./...` exits with status 0
    - Manual smoke test (executor MUST run): start binary on `:8788` (avoid port clash), curl an oversize body:
      ```
      go build -o /tmp/sync-temple ./... && /tmp/sync-temple -addr :8788 -data /tmp/sync-data-$$ -token testtok &
      SERVER_PID=$!
      sleep 1
      # 600 MB of zeros via multipart, expect 413 + JSON
      dd if=/dev/zero bs=1M count=600 2>/dev/null | \
        curl -s -o /tmp/resp.json -w "%{http_code}\n" \
          -H "Authorization: Bearer testtok" \
          -F "huge.bin=@-;filename=huge.bin" \
          http://127.0.0.1:8788/api/a/upload
      kill $SERVER_PID 2>/dev/null
      ```
      Must print `413` and `/tmp/resp.json` must contain `"code":"SIZE_LIMIT"`.
    - Manual smoke test 2: upload a normal small file via curl multipart, then `ls /tmp/sync-data-*/a/files/` shows no `.tmp` suffix files.
  </acceptance_criteria>
  <done>
    handleUpload enforces 500 MB cap with HTTP 413 + JSON `SIZE_LIMIT`; every uploaded file goes through `.tmp` + `os.Rename`; per-part 5-min timeout returns `TIMEOUT` code on stall; response includes `{uploaded, failed, errors}`; Python CLI `r["uploaded"]` access path still works (additive change); no `.tmp` debris in data dir after success.
  </done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| client → /api/{channel}/upload | Untrusted multipart body. Must be size-capped and parsed without OOM. |
| multipart part name → filesystem path | Untrusted filename used in `filepath.Join`. `safePath` already validates. |
| request → file write | Half-written files could leak partial state to other clients. |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-01-01 | D (DoS) | handleUpload — unbounded body | mitigate | `http.MaxBytesReader(w, r.Body, MaxUploadBytes)` caps body at 500 MB; oversize requests get HTTP 413 + `SIZE_LIMIT` JSON without buffering. |
| T-01-02 | T (Tampering) | uploadOnePart — partial writes leaking dirty state | mitigate | Atomic write via `<dest>.tmp` + `os.Rename`; failed copies `os.Remove` the .tmp file. Readers never see a half-written final path. |
| T-01-03 | D (DoS) | uploadOnePart — slow-loris per part | mitigate | `context.WithTimeout(r.Context(), 5*time.Minute)` per part; goroutine closes the part reader on timeout, freeing the goroutine. |
| T-01-04 | I (Info Disclosure) | error responses leaking server paths | accept | Errors return code + short message; concrete paths only appear in `log.Printf` to stderr, not in HTTP body. Acceptable trade-off for debuggability on single-tenant deployment. |
| T-01-05 | S (Spoofing) | upload requires auth | mitigate | Existing `requireAuth` middleware (main.go:82) unchanged; constant-time token compare. |
| T-01-06 | E (Elevation) | path traversal via part name | mitigate | Existing `safePath` (main.go:128) unchanged; symlink-escape hardening deferred to v2 ROB-03 per CONTEXT.md. |
</threat_model>

<verification>
- Server compiles and passes `go vet`.
- `curl` of a 600 MB body returns HTTP 413 with `Content-Type: application/json` and JSON `{"error":"...","code":"SIZE_LIMIT"}`.
- After a normal multipart upload of N files, the destination directory contains exactly N files and zero `.tmp` files.
- Simulating a client disconnect mid-upload (kill curl during dd-of-large-file) leaves no .tmp and no final file for the in-progress part.
- Python CLI `sync push a /tmp/somedir` still works unchanged (D-17 compat check — executor MUST run this).
</verification>

<success_criteria>
- All `<acceptance_criteria>` grep counts and build/vet checks pass.
- Manual 413 smoke test returns the expected HTTP code and JSON body.
- No partial files left on disk in any tested failure path.
- Python CLI continues to function (smoke: run existing `sync` script against the new binary, no error from `.json()["uploaded"]` access).
</success_criteria>

<output>
After completion, create `.planning/phases/01-upload-reliability/01-01-SUMMARY.md` capturing:
- Constants added (`MaxUploadBytes`, `PerFileUploadTimeout`) and final line numbers
- New helper signatures (`writeJSONError`, `uploadOnePart`) and where they live
- Final `handleUpload` line range
- Smoke test commands used and their outputs (413 + JSON, no .tmp debris)
- Confirmation that Python CLI still works against the new response shape
</output>

## Decision Coverage

This plan addresses the following CONTEXT.md decisions (from `01-CONTEXT.md`):

- D-10: Structured JSON error responses (`{error, code}` with Content-Type: application/json) — implemented via `writeJSONError` helper used in all error paths.
- D-12: `http.MaxBytesReader(w, r.Body, MaxUploadBytes)` with `MaxUploadBytes = 500 << 20` — enforced at start of `handleUpload`, returns 413 + SIZE_LIMIT on overflow.
- D-13: Atomic file writes via `<dest>.tmp` + `os.Rename` — implemented in `uploadOnePart` helper. Failed copies trigger `os.Remove(tmp)`.
- D-14: Per-file `context.WithTimeout(r.Context(), PerFileUploadTimeout)` inside the part loop — 5-minute cap per file. Channel write-lock granularity preserved.
- D-15: `uploaded`/`failed` counters incremented per attempt; response shape extended to `{"uploaded": N, "failed": M, "errors": [{file, code, message}]}`.
- D-16: New top-level constants `MaxUploadBytes = 500 << 20` and `PerFileUploadTimeout = 5 * time.Minute` added after the import block in `main.go`.
- D-17: Python CLI backward compatibility — `uploaded` integer field preserved in success response; JSON error format is parsed by Python's existing `.json()` call. No client-side change required.
