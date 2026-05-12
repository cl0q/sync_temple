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
    - "D-12: POST /api/{ch}/upload with a request body >500 MB returns HTTP 413 with Content-Type: application/json and JSON body containing code=SIZE_LIMIT"
    - "D-13: After a successful upload, the destination directory contains no .tmp files"
    - "D-13: When an upload aborts mid-stream (client disconnects), no zero-byte or partial file remains in dataDir/{ch}/files/"
    - "D-15: Multi-file upload response is JSON with shape {uploaded:int, failed:int, errors:[{file, code, message}]}"
    - "D-14: A single stalled part times out after 5 minutes and the rest of the multipart request continues"
    - "D-10: All upload error responses use Content-Type: application/json with body {error, code} where code is one of {SIZE_LIMIT, TIMEOUT, BAD_REQUEST, INTERNAL}"
    - "D-17: Python CLI continues to read response.json()['uploaded'] without modification — uploaded field preserved"
  artifacts:
    - path: "main.go"
      provides: "Hardened handleUpload with MaxBytesReader, atomic writes, per-file timeout, JSON error responses"
      contains: "MaxUploadBytes"
    - path: "main.go"
      provides: "Top-level constants for upload limits (D-16)"
      contains: "PerFileUploadTimeout"
    - path: "main.go"
      provides: "JSON error helper used by upload handler (D-10)"
      contains: "writeJSONError"
    - path: "main.go"
      provides: "Per-part helper with atomic .tmp+Rename and timeout (D-13, D-14)"
      contains: "uploadOnePart"
  key_links:
    - from: "main.go:handleUpload"
      to: "http.MaxBytesReader"
      via: "wraps r.Body before mr.NextPart loop"
      pattern: "http\\.MaxBytesReader\\(w, r\\.Body, MaxUploadBytes\\)"
    - from: "main.go:uploadOnePart"
      to: "os.Rename"
      via: "atomic finalization of .tmp file"
      pattern: "os\\.Rename\\("
    - from: "main.go:uploadOnePart"
      to: "context.WithTimeout"
      via: "per-part deadline"
      pattern: "context\\.WithTimeout"
---

<objective>
Harden the existing `main.go` `handleUpload` (which has ALREADY been migrated to a streaming `r.MultipartReader()` loop in a recent WIP commit) by adding:
1. A 500 MB request body cap via `http.MaxBytesReader` returning HTTP 413 + JSON `code=SIZE_LIMIT` (D-12).
2. Atomic writes per part via a new `uploadOnePart` helper that streams to `<dest>.tmp` then `os.Rename`s on success, removing the `.tmp` on any error (D-13).
3. A 5-minute per-part timeout via `context.WithTimeout(r.Context(), PerFileUploadTimeout)` (D-14).
4. Structured JSON error responses via a new `writeJSONError` helper (D-10).
5. An extended response shape `{uploaded, failed, errors[]}` preserving the integer `uploaded` field for Python CLI compatibility (D-15, D-17).
6. Two new top-level constants `MaxUploadBytes` and `PerFileUploadTimeout` (D-16).

Closes the server-side half of UPLOAD-01 (reliability foundation) and fully delivers UPLOAD-06 and UPLOAD-07.

Purpose: The WIP already moved upload from `r.ParseMultipartForm(200<<20)` to a per-part streaming loop with `mr.NextPart()` + direct `os.Create` + `io.Copy`. This eliminated the buffer-everything DoS path. But the loop still has three gaps: there is no overall body cap (a single 50 GB request could exhaust disk), files are written directly to their final path (a mid-stream cancel leaves a corrupt final file), and a stalled stream has no per-part deadline. This plan layers those three properties on top of the existing loop and replaces the bare `http.Error(...)` calls with structured JSON.

Output: Modified `main.go` — single file. New top-level constants, two new helpers (`writeJSONError`, `uploadOnePart`), and a rewritten `handleUpload` body. New stdlib imports: `context`, `errors`, `time`. No new external dependencies (Go-stdlib-only constraint).
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
<!-- Key contracts extracted from the CURRENT main.go (post-WIP). The executor must preserve these and add the missing properties. -->

Current `handleUpload` (main.go:231-279) ALREADY uses `r.MultipartReader()` streaming. The full current body for reference:

```go
func (s *server) handleUpload(w http.ResponseWriter, r *http.Request) {
    ch := r.PathValue("channel")
    mr, err := r.MultipartReader()
    if err != nil {
        http.Error(w, "multipart error: "+err.Error(), http.StatusBadRequest)
        return
    }

    s.locks[ch].Lock()
    defer s.locks[ch].Unlock()

    root := s.filesDir(ch)
    n := 0
    for {
        part, err := mr.NextPart()
        if err == io.EOF {
            break
        }
        if err != nil {
            http.Error(w, "part error: "+err.Error(), http.StatusBadRequest)
            return
        }
        name := part.FormName()
        clean, ok := safePath(name)
        if !ok {
            part.Close()
            continue
        }
        dest := filepath.Join(root, clean)
        if err := os.MkdirAll(filepath.Dir(dest), 0755); err != nil {
            part.Close()
            continue
        }
        dst, err := os.Create(dest)
        if err != nil {
            part.Close()
            continue
        }
        if _, err := io.Copy(dst, part); err == nil {
            n++
        }
        dst.Close()
        part.Close()
    }

    s.notify(ch)
    w.Header().Set("Content-Type", "application/json")
    json.NewEncoder(w).Encode(map[string]int{"uploaded": n})
}
```

The rewrite preserves: streaming via `mr.NextPart()`, channel write-lock at the top, single terminal `s.notify(ch)` AFTER the loop, JSON response. It changes: adds size cap, replaces direct `os.Create(dest)` with `uploadOnePart` (atomic `.tmp` + Rename + per-part context timeout), tracks `failed` + `errors[]`, replaces `http.Error` with `writeJSONError`.

Existing helpers — reuse, do not duplicate:
```go
func (s *server) filesDir(ch string) string                 // main.go:103
func safePath(p string) (string, bool)                      // main.go:128
func (s *server) notify(ch string)                          // main.go:69
```

Existing imports (main.go:3-22) — current set:
```
"archive/zip", "bytes", "crypto/rand", "crypto/sha256", "crypto/subtle",
_ "embed", "encoding/hex", "encoding/json", "flag", "fmt", "io", "io/fs",
"log", "net/http", "os", "path/filepath", "strings", "sync"
```
ADD: `"context"`, `"errors"`, `"time"`. Keep alphabetical order; `"errors"` slots between `"encoding/json"` and `"flag"`.

New JSON error contract (D-10) — Content-Type `application/json`, body shape:
```json
{"error": "<human message>", "code": "<MACHINE_CODE>"}
```
Initial codes used in this plan: `SIZE_LIMIT`, `TIMEOUT`, `BAD_REQUEST`, `INTERNAL`. (`AUTH_FAILED` is reserved for a future refactor of `requireAuth` — not in this plan.)

Extended success response (D-15) — additive over current `{"uploaded": N}`:
```json
{"uploaded": <int>, "failed": <int>, "errors": [{"file": "...", "code": "...", "message": "..."}]}
```
The `uploaded` integer field MUST remain present and integer-typed — Python CLI (`sync` script) parses it via `.json()` and reads `r["uploaded"]` (D-17).

Atomic write pattern (D-13) — write to `<dest>.tmp`, then `os.Rename` to `<dest>`. On any error before rename, `os.Remove(dest + ".tmp")`.
</interfaces>
</context>

<tasks>

<task type="auto" tdd="false">
  <name>Task 1: Add constants, imports, and JSON error helper</name>
  <files>main.go</files>
  <read_first>
    - main.go (entire file — single-file project, 477 lines, post-WIP state)
    - .planning/phases/01-upload-reliability/01-CONTEXT.md §Decisions D-10, D-12, D-16
    - .planning/codebase/CONVENTIONS.md §"Code Style" (Go) — gofmt, idiomatic naming
  </read_first>
  <behavior>
    - Constants are package-level (top of main.go, after imports, before `//go:embed`) and immutable.
    - `writeJSONError(w, status, code, message)` sets `Content-Type: application/json`, calls `w.WriteHeader(status)`, encodes `{"error": message, "code": code}`. It MUST NOT call `http.Error` (which sets text/plain).
    - Adding `context`, `errors`, and `time` to the import block is required for Task 2 — do it here so Task 2 stays focused on `handleUpload`.
  </behavior>
  <action>
    Edit `main.go`:

    1. Extend the existing stdlib import block (currently `main.go:3-22`) by adding `"context"`, `"errors"`, and `"time"` in alphabetical order. The result must still be a single import block with all stdlib paths sorted alphabetically. Do NOT add any external dependency (Go-stdlib-only constraint from CLAUDE.md).

       After the edit the import block should contain (alphabetical):
       `"archive/zip"`, `"bytes"`, `"context"`, `"crypto/rand"`, `"crypto/sha256"`, `"crypto/subtle"`, `_ "embed"`, `"encoding/hex"`, `"encoding/json"`, `"errors"`, `"flag"`, `"fmt"`, `"io"`, `"io/fs"`, `"log"`, `"net/http"`, `"os"`, `"path/filepath"`, `"strings"`, `"sync"`, `"time"`.

    2. Insert a constants block immediately after the import block (just before the `//go:embed` directive currently at line 24). Use this exact text (D-16 verbatim):
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

    Run `go build ./...` to confirm the file still compiles. Go will not complain about the unused-yet `errors` package, constants, or helper at package level — but `context` and `time` would be flagged if unused. To avoid that flag breaking Task 1 in isolation, reference `PerFileUploadTimeout` (which uses `time.Minute`) and add a no-op tiny use of `context` if needed — actually, simply note: Go DOES flag unused imports. `time` is used by the constant, fine. `errors` and `context` need to be used by Task 2 in the same commit OR Task 1 must defer adding `errors`/`context` to Task 2. **Resolution:** Task 1 adds ONLY `"time"` (used by the constant). Task 2 adds `"context"` and `"errors"` when it actually uses them.

    Run `go build -o /tmp/sync-temple-task1 ./...` and `go vet ./...` to confirm clean compile.
  </action>
  <verify>
    <automated>cd /Users/olli/schenanigans/sync_temple &amp;&amp; go build -o /tmp/sync-temple-task1 ./... &amp;&amp; go vet ./... &amp;&amp; grep -c '"time"' main.go &amp;&amp; grep -c 'MaxUploadBytes = 500 &lt;&lt; 20' main.go &amp;&amp; grep -c 'PerFileUploadTimeout = 5 \* time.Minute' main.go &amp;&amp; grep -c 'func writeJSONError(w http.ResponseWriter, status int, code, message string)' main.go</automated>
  </verify>
  <acceptance_criteria>
    - `grep -c '"time"' main.go` returns at least 1
    - `grep -c 'MaxUploadBytes = 500 &lt;&lt; 20' main.go` returns exactly 1
    - `grep -c 'PerFileUploadTimeout = 5 \* time.Minute' main.go` returns exactly 1
    - `grep -c 'func writeJSONError(w http.ResponseWriter, status int, code, message string)' main.go` returns exactly 1
    - `go build -o /tmp/sync-temple-task1 ./...` exits with status 0
    - `go vet ./...` exits with status 0
  </acceptance_criteria>
  <done>
    main.go compiles; constants and helper exist; `time` package added; no behavioral change to existing handlers yet. `context` and `errors` packages will be added in Task 2 when first used.
  </done>
</task>

<task type="auto" tdd="false">
  <name>Task 2: Rewrite handleUpload with MaxBytesReader, atomic writes via uploadOnePart, per-file timeout, and extended response</name>
  <files>main.go</files>
  <read_first>
    - main.go (current `handleUpload` at lines 231-279 — already uses MultipartReader streaming)
    - main.go (current `handleSetText` at lines 403-414 — the silent-error anti-pattern to AVOID)
    - .planning/phases/01-upload-reliability/01-CONTEXT.md §Decisions D-10..D-17
    - .planning/codebase/CONCERNS.md §"Missing Request Size Limits and Validation"
  </read_first>
  <behavior>
    - Request body wrapped by `http.MaxBytesReader(w, r.Body, MaxUploadBytes)` BEFORE calling `r.MultipartReader()`.
    - Any error from `r.MultipartReader()` or `mr.NextPart()` caused by exceeding `MaxBytesReader` returns HTTP 413 with `code=SIZE_LIMIT`. Detect via `errors.As` on `*http.MaxBytesError`.
    - Each part is streamed to `<dest>.tmp` (NOT directly to `<dest>` — this is the change from the WIP baseline), then `os.Rename` to `<dest>` on success. On ANY error during `io.Copy` (including ctx cancellation), the `.tmp` file is removed and the part is counted as failed (not uploaded), AND an entry is appended to `errors[]`.
    - A `context.WithTimeout(r.Context(), PerFileUploadTimeout)` is created per part. The timeout cancellation must abort the in-progress `io.Copy` — implement via a goroutine that closes the part reader on `ctx.Done`. Closing a `multipart.Part` causes the next `Read` to return an error, terminating `io.Copy`.
    - `failed` counter increments on every error path (bad name, MkdirAll fail, Create fail, Copy fail, Rename fail). The `uploaded` counter increments ONLY after a successful `os.Rename`.
    - The per-channel write lock continues to wrap the whole loop (do not change locking — D-14 explicitly preserves channel-lock granularity).
    - `s.notify(ch)` still fires ONCE at the end of the loop (preserve the WIP placement at line 276).
    - Final response: `{"uploaded": N, "failed": M, "errors": [...]}` with `Content-Type: application/json`. The `uploaded` integer field is preserved for Python CLI compat (D-17).
    - On `MaxBytesReader` overflow detected at MultipartReader-init time, use `writeJSONError(w, http.StatusRequestEntityTooLarge, "SIZE_LIMIT", "request exceeds 500 MB")` and return.
    - On `MaxBytesReader` overflow detected mid-stream at `NextPart`, same response, return.
    - On malformed multipart (non-MaxBytes error), use `writeJSONError(w, http.StatusBadRequest, "BAD_REQUEST", "multipart parse error: <err>")`.
    - Per-part failures DO NOT abort the loop — they accumulate in `errors[]` and the loop continues to the next part. Only top-level multipart errors (init or NextPart returning a non-EOF error) abort with a 4xx/5xx terminal response.
  </behavior>
  <action>
    Replace the body of `handleUpload` (currently main.go:231-279) AND insert a new `uploadOnePart` helper method immediately after it.

    Step 1 — Add `"context"` and `"errors"` to the stdlib import block (alphabetical). After this edit the block now contains (relative order): `... "context", "crypto/rand", ... "encoding/json", "errors", "flag", ...`.

    Step 2 — Replace the entire `handleUpload` function body (lines 231-279 in the current file) with:

    ```go
    func (s *server) handleUpload(w http.ResponseWriter, r *http.Request) {
        ch := r.PathValue("channel")

        // D-12: enforce 500 MB request cap before any parsing.
        r.Body = http.MaxBytesReader(w, r.Body, MaxUploadBytes)

        mr, err := r.MultipartReader()
        if err != nil {
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
            code, msg, ok := s.uploadOnePart(r.Context(), root, name, part)
            if ok {
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

    Step 3 — Insert the new `uploadOnePart` helper method IMMEDIATELY AFTER `handleUpload`, before `handleDownload`. Use this exact signature and body:

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
        // Closing a multipart.Part causes the next Read to return an error.
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

    Step 4 — Do NOT modify any other handler in this task. `handleSetText`, `handleDownload`, etc. are out of scope (per CONTEXT.md §domain).

    Step 5 — Run `go build` and `go vet`. Fix any formatting issues with `gofmt -w main.go`.
  </action>
  <verify>
    <automated>cd /Users/olli/schenanigans/sync_temple &amp;&amp; go build -o /tmp/sync-temple-task2 ./... &amp;&amp; go vet ./... &amp;&amp; grep -c 'http\.MaxBytesReader(w, r\.Body, MaxUploadBytes)' main.go &amp;&amp; grep -c 'os\.Rename(tmp, dest)' main.go &amp;&amp; grep -c 'context\.WithTimeout(parentCtx, PerFileUploadTimeout)' main.go &amp;&amp; grep -c '"SIZE_LIMIT"' main.go &amp;&amp; grep -c 'func (s \*server) uploadOnePart' main.go</automated>
  </verify>
  <acceptance_criteria>
    - `grep -c 'http.MaxBytesReader(w, r.Body, MaxUploadBytes)' main.go` returns exactly 1
    - `grep -c 'os.Rename(tmp, dest)' main.go` returns exactly 1
    - `grep -c 'dest + ".tmp"' main.go` returns at least 1
    - `grep -c 'context.WithTimeout(parentCtx, PerFileUploadTimeout)' main.go` returns exactly 1
    - `grep -c '"SIZE_LIMIT"' main.go` returns at least 2 (multipart-init check and per-part check inside handleUpload)
    - `grep -c '"uploaded":' main.go` returns at least 1 (response shape)
    - `grep -c '"failed":' main.go` returns at least 1
    - `grep -c '"errors":' main.go` returns at least 1
    - `grep -c 'func (s \*server) uploadOnePart' main.go` returns exactly 1
    - `grep -c '"context"' main.go` returns at least 1
    - `grep -n '"errors"' main.go | grep -v '"errors":'` returns at least one line (confirms the `errors` package is imported, not just the JSON field)
    - `grep -c 'http.Error(w, "multipart error' main.go` returns exactly 0 (old plain-text error removed)
    - `grep -c 'http.Error(w, "part error' main.go` returns exactly 0 (old plain-text error removed)
    - `go build -o /tmp/sync-temple-task2 ./...` exits with status 0
    - `go vet ./...` exits with status 0
    - Manual smoke test 1 (executor MUST run): start binary on `:8788`, POST a 600 MB body, expect HTTP 413 + JSON SIZE_LIMIT:
      ```
      go build -o /tmp/sync-temple ./... && /tmp/sync-temple -addr :8788 -data /tmp/sync-data-$$ -token testtok &
      SERVER_PID=$!
      sleep 1
      dd if=/dev/zero bs=1M count=600 2>/dev/null | \
        curl -s -o /tmp/resp.json -w "%{http_code}\n" \
          -H "Authorization: Bearer testtok" \
          -F "huge.bin=@-;filename=huge.bin" \
          http://127.0.0.1:8788/api/a/upload
      cat /tmp/resp.json
      kill $SERVER_PID 2>/dev/null
      ```
      Must print `413` and `/tmp/resp.json` must contain `"code":"SIZE_LIMIT"`.
    - Manual smoke test 2: upload a normal small file via curl multipart, then `ls /tmp/sync-data-*/a/files/` shows no `.tmp` suffix files. Response body must be JSON of shape `{"uploaded":1,"failed":0,"errors":[]}`.
    - Manual smoke test 3 (executor MUST run): existing Python CLI smoke — run any existing `sync push a /tmp/somedir` invocation. Response parsing on `.json()["uploaded"]` must succeed.
  </acceptance_criteria>
  <done>
    handleUpload enforces 500 MB cap with HTTP 413 + JSON `SIZE_LIMIT`; every uploaded file goes through `.tmp` + `os.Rename` via `uploadOnePart`; per-part 5-min timeout returns `TIMEOUT` code on stall; response includes `{uploaded, failed, errors}`; Python CLI `r["uploaded"]` access path still works (additive change); no `.tmp` debris in data dir after success.
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
| T-01-01 | D (DoS) | handleUpload — unbounded body | mitigate | `http.MaxBytesReader(w, r.Body, MaxUploadBytes)` caps body at 500 MB; oversize requests get HTTP 413 + `SIZE_LIMIT` JSON without buffering. The WIP already eliminated `ParseMultipartForm(200<<20)` buffering — this plan adds the explicit cap. |
| T-01-02 | T (Tampering) | uploadOnePart — partial writes leaking dirty state | mitigate | Atomic write via `<dest>.tmp` + `os.Rename`; failed copies `os.Remove` the .tmp file. Readers never see a half-written final path. Replaces the WIP's direct `os.Create(dest)` which left corrupt files on mid-stream abort. |
| T-01-03 | D (DoS) | uploadOnePart — slow-loris per part | mitigate | `context.WithTimeout(r.Context(), 5*time.Minute)` per part; goroutine closes the part reader on timeout, freeing the goroutine. |
| T-01-04 | I (Info Disclosure) | error responses leaking server paths | accept | Errors return code + short message; concrete paths only appear in `log.Printf` to stderr, not in HTTP body. Acceptable trade-off for debuggability on single-tenant deployment. |
| T-01-05 | S (Spoofing) | upload requires auth | mitigate | Existing `requireAuth` middleware (main.go:82) unchanged; constant-time token compare. |
| T-01-06 | E (Elevation) | path traversal via part name | mitigate | Existing `safePath` (main.go:128) unchanged; symlink-escape hardening deferred to v2 ROB-03 per CONTEXT.md. |
</threat_model>

<verification>
- Server compiles and passes `go vet`.
- `curl` of a 600 MB body returns HTTP 413 with `Content-Type: application/json` and JSON `{"error":"...","code":"SIZE_LIMIT"}`.
- After a normal multipart upload of N files, the destination directory contains exactly N files and zero `.tmp` files.
- Simulating a client disconnect mid-upload (kill curl during dd-of-large-file) leaves no `.tmp` and no final file for the in-progress part. Earlier completed parts in the same request remain on disk (this is intentional — atomicity is per-part, not per-request).
- Python CLI `sync push a /tmp/somedir` still works unchanged (D-17 compat check — executor MUST run this).
- `grep -n 'http.Error' main.go | grep upload` returns zero lines for the upload handler (all upload errors now go through `writeJSONError`).
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
- D-12: `http.MaxBytesReader(w, r.Body, MaxUploadBytes)` with `MaxUploadBytes = 500 << 20` — enforced at start of `handleUpload`, returns 413 + SIZE_LIMIT on overflow at both init-time and mid-stream.
- D-13: Atomic file writes via `<dest>.tmp` + `os.Rename` — implemented in `uploadOnePart` helper. Failed copies trigger `os.Remove(tmp)`. Replaces the WIP's direct `os.Create(dest)` which left corrupt files on abort.
- D-14: Per-file `context.WithTimeout(r.Context(), PerFileUploadTimeout)` inside the part loop — 5-minute cap per file. Channel write-lock granularity preserved.
- D-15: `uploaded`/`failed` counters incremented per attempt; response shape extended to `{"uploaded": N, "failed": M, "errors": [{file, code, message}]}`.
- D-16: New top-level constants `MaxUploadBytes = 500 << 20` and `PerFileUploadTimeout = 5 * time.Minute` added after the import block in `main.go`.
- D-17: Python CLI backward compatibility — `uploaded` integer field preserved in success response; JSON error format is parsed by Python's existing `.json()` call. No client-side change required.
