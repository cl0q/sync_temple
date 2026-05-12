---
phase: 01-upload-reliability
plan: 01
subsystem: api
tags: [go, http, multipart, upload, atomic-writes, context-timeout, json-errors]

# Dependency graph
requires: []
provides:
  - "handleUpload with http.MaxBytesReader (500 MB cap, HTTP 413 + SIZE_LIMIT on overflow)"
  - "uploadOnePart helper with atomic .tmp + os.Rename writes and per-file 5-minute timeout"
  - "writeJSONError helper for structured JSON error responses {error, code}"
  - "MaxUploadBytes and PerFileUploadTimeout package-level constants"
  - "Extended upload response shape {uploaded, failed, errors[]} preserving uploaded int for Python CLI"
affects: [02-upload-reliability, 03-upload-reliability]

# Tech tracking
tech-stack:
  added: ["context (stdlib)", "errors (stdlib)", "time (stdlib)"]
  patterns:
    - "Atomic write: stream to dest+.tmp, os.Rename on success, os.Remove on error"
    - "Per-part deadline: context.WithTimeout + goroutine closes part reader on ctx.Done"
    - "Structured JSON errors: writeJSONError(w, status, code, message) for all error paths"
    - "MaxBytesError detection: errors.As(err, &maxErr) at both MultipartReader init and NextPart"

key-files:
  created: []
  modified:
    - main.go

key-decisions:
  - "Task 1 adds only 'time' import (not context/errors) to avoid unused-import compiler error — context and errors added in Task 2 when first used"
  - "uploadOnePart takes io.Reader not *multipart.Part to avoid import cycle and allow clean testing"
  - "per-part errors accumulate in errors[] and do NOT abort the loop — only top-level multipart parse errors abort with 4xx terminal response"
  - "s.notify(ch) fires once at end of loop regardless of per-part failures"

patterns-established:
  - "writeJSONError pattern: set Content-Type header before WriteHeader, encode map[string]string"
  - "Atomic file writes via .tmp suffix + os.Rename for any file mutation in the upload path"

requirements-completed: [UPLOAD-06, UPLOAD-07, UPLOAD-01]

# Metrics
duration: 15min
completed: 2026-05-12
---

# Phase 01 Plan 01: Upload Server Hardening Summary

**handleUpload hardened with http.MaxBytesReader (500 MB cap), atomic .tmp+os.Rename writes, per-file 5-min context timeout, structured JSON errors, and extended {uploaded, failed, errors[]} response shape**

## Performance

- **Duration:** ~15 min
- **Started:** 2026-05-12T11:50:00Z
- **Completed:** 2026-05-12T11:58:58Z
- **Tasks:** 2
- **Files modified:** 1 (main.go)

## Accomplishments

- Enforced 500 MB request body cap via http.MaxBytesReader; oversized requests return HTTP 413 + JSON `{"code":"SIZE_LIMIT","error":"request exceeds 500 MB"}` at both MultipartReader init and NextPart error paths
- Replaced direct `os.Create(dest)` with `uploadOnePart` helper that streams to `dest+.tmp` then `os.Rename` — no partial/corrupt files left on disk after mid-stream abort or error
- Added per-file 5-minute `context.WithTimeout` with goroutine that closes the part reader on deadline, aborting the in-flight `io.Copy` — stalled parts return `code=TIMEOUT`
- Extended success response from `{"uploaded":N}` to `{"uploaded":N,"failed":M,"errors":[...]}` preserving Python CLI backward compatibility
- Added `writeJSONError` helper: sets `Content-Type: application/json`, calls `w.WriteHeader(status)`, encodes `{"error": message, "code": code}` — replaces all `http.Error(...)` calls in upload path

## Task Commits

Each task was committed atomically:

1. **Task 1: Add constants, imports, and JSON error helper** - `af23ab2` (feat)
2. **Task 2: Rewrite handleUpload with MaxBytesReader, atomic writes, per-file timeout, extended response** - `93824cf` (feat)

## Files Created/Modified

- `main.go` - Added `time`/`context`/`errors` imports; added `MaxUploadBytes = 500 << 20` and `PerFileUploadTimeout = 5 * time.Minute` constants (lines 28-32); added `writeJSONError` helper (line 189-197); rewrote `handleUpload` (lines 251-315); added `uploadOnePart` helper (lines 319-371)

## Key Symbol Locations

| Symbol | Type | Lines |
|--------|------|-------|
| `MaxUploadBytes` | constant | 29 |
| `PerFileUploadTimeout` | constant | 32 |
| `writeJSONError` | helper func | 189-197 |
| `handleUpload` | handler method | 251-315 |
| `uploadOnePart` | helper method | 319-371 |

## Smoke Test Results

**Test 1: 600 MB body → HTTP 413 + SIZE_LIMIT**
```
HTTP Code: 413
Response: {"code":"SIZE_LIMIT","error":"request exceeds 500 MB"}
```
PASS

**Test 2: Normal small file upload → {uploaded:1, failed:0, errors:[]} + no .tmp files**
```
HTTP Code: 200
Response: {"errors":[],"failed":0,"uploaded":1}
Files in channel a: testfile.txt (no .tmp files: 0)
```
PASS

**Test 3: Python CLI r["uploaded"] access**
```python
r = json.loads('{"errors":[],"failed":0,"uploaded":1}')
r["uploaded"]  # → 1 (int)
```
PASS — uploaded field preserved as integer, backward compatible

## Decisions Made

- Task 1 adds only `"time"` import (not `context`/`errors`) — Go compiler rejects unused imports; `context` and `errors` added in Task 2 when first used
- `uploadOnePart` takes `io.Reader` (not `*multipart.Part`) for a clean function boundary; `part.Close()` called at the `handleUpload` loop level after `uploadOnePart` returns
- Per-part errors accumulate into `errors[]` slice — loop continues to next part; only top-level multipart parse errors abort with a terminal 4xx response
- `s.notify(ch)` preserved at end of loop (fires once regardless of per-part failures)
- The goroutine-closes-part approach for context timeout is idiomatic for this stdlib-only constraint (no `io.ReadContext` available)

## Deviations from Plan

None — plan executed exactly as written. The note in Task 1's action block about splitting imports between Task 1 and Task 2 was followed precisely.

## Issues Encountered

None. Build and vet passed cleanly on first attempt for both tasks.

## User Setup Required

None — no external service configuration required.

## Known Stubs

None — all functionality fully wired with real implementation.

## Threat Flags

None — all threat model mitigations from the plan's STRIDE register (T-01-01 through T-01-06) are implemented. No new security surface introduced beyond the plan's scope.

## Next Phase Readiness

- Server-side upload hardening complete: size cap, atomic writes, per-file timeout, structured errors
- Plan 02 (client-side upload concurrency throttling in static/index.html) can proceed independently
- Plan 03 (test suite for safePath, manifest, auth paths) can also proceed — main.go is stable

## Self-Check: PASSED

All files present, commits found, key symbols verified, build and vet clean.

---
*Phase: 01-upload-reliability*
*Completed: 2026-05-12*
