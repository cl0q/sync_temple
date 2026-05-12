---
phase: 01-upload-reliability
verified: 2026-05-12T00:00:00Z
status: human_needed
score: 5/5 must-haves verified
overrides_applied: 0
human_verification:
  - test: "Drag a folder with 500+ files onto the Channel A drop zone in Chrome/Safari"
    expected: "All files upload successfully. DevTools Console shows no WebKitBlobResource error 4. DevTools Network panel shows at most 4 concurrent POST /api/a/upload requests at any time."
    why_human: "WebKitBlobResource error 4 is a browser-specific runtime failure that cannot be reproduced programmatically. Concurrency cap enforcement (UPLOAD_CONCURRENCY=4) can be read in code but peak-in-flight count requires live DevTools observation."
  - test: "Kill the server process mid-upload (after a few files complete). Observe the UI for the retry/failed transition."
    expected: "Affected file rows enter 'retrying' state showing 'retrying N/4', then transition to 'failed' after 3 retries. No further requests fire after the failure terminus."
    why_human: "Retry state display and timing require real network conditions and a live browser session."
  - test: "Click Cancel during an in-progress upload."
    expected: "In-flight requests show '(canceled)' in DevTools Network panel. No further upload requests fire. Status bar shows 'Upload cancelled.' Upload controller is cleared."
    why_human: "AbortController propagation and in-flight request cancellation require live browser verification."
  - test: "Cancel an upload mid-way, then reload the page. Observe Channel A drop zone."
    expected: "A Resume row appears inside the drop zone showing 'N / M files remaining from previous attempt' with 'Resume (re-select folder)' and 'Discard' buttons."
    why_human: "localStorage persistence and DOM rendering of the resume button require a live browser session to confirm."
  - test: "Click 'Resume (re-select folder)', re-select the same folder, confirm in the picker, and let it complete."
    expected: "Hashing phase completes faster than a fresh upload (hash reuse from saved manifest observable). Only previously-missing/failed files are POSTed. On full success, localStorage key sync_resume_a is removed and the Resume row disappears."
    why_human: "Hashing speed difference, diff-only upload set, and localStorage auto-clear on success require a real browser + server interaction to verify end-to-end."
  - test: "POST a request body larger than 500 MB to POST /api/a/upload with a valid token."
    expected: "Server returns HTTP 413 with Content-Type: application/json and body containing {\"code\":\"SIZE_LIMIT\"}. No file is written to disk."
    why_human: "Smoke test is deterministic and was run by executor (result: PASS per SUMMARY). Listed here for confirmatory re-run if desired; all static checks pass."
---

# Phase 1: Upload Reliability — Verification Report

**Phase Goal:** Users can upload folders of any size (including 500+ files) through the web UI without connection drops, with visible progress and automatic retry on transient failures, backed by a server that enforces sane limits and cleans up after itself.
**Verified:** 2026-05-12
**Status:** human_needed
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | User drags a folder with 500+ files onto the UI and every file uploads without WebKitBlobResource errors or connection drops | ? UNCERTAIN | `UPLOAD_CONCURRENCY=4` constant exists (line 234), `BATCH_MAX` absent (grep count 0), `runUploadQueue` worker pool spawns exactly 4 workers. Behavioral proof requires live browser test. |
| 2 | User can see per-file progress and an overall progress bar while upload is running | ✓ VERIFIED | `renderUploadProgress` (line 920), per-file `.uf-row` rows with state badges (`pending`/`uploading`/`done`/`failed`/`retrying`), `<progress id="upload-bar-{ch}">` DOM elements for both channels (lines 117, 144), `scheduleProgressRender` throttled to 200ms + rAF. All wired. |
| 3 | When a transient network error occurs, the upload retries automatically (up to 3 times) before surfacing the failure | ✓ VERIFIED | `RETRY_DELAYS = [1000, 3000, 10000]` (line 235), `shouldRetry` (line 875) returns true for undefined `.status` (network), `>=500`, `=408`; returns false for other 4xx. `abortableSleep` (line 884) wired into `uploadOneFile` retry loop. Max 4 total attempts (`RETRY_DELAYS.length + 1`). |
| 4 | User can resume an interrupted upload from where it left off rather than starting over | ✓ VERIFIED | `persistResumeState` (line 982), `loadResumeState` (line 967), `clearResumeState` (line 977), `renderResumeButton` (line 1006), `resumeUpload` (line 1027). `sync_resume_` key confirmed (line 964). D-07 clear-on-success (`clearResumeState` in `failCount===0` branch, line 774) and D-07 clear-on-new-upload (line 692) both present. Hash reuse from saved manifest in hashing loop (line 709). Both `renderResumeButton('a')` and `renderResumeButton('b')` called in `DOMContentLoaded` (lines 281-282). |
| 5 | Server rejects oversized requests with HTTP 413 and leaves no empty or partial files behind | ✓ VERIFIED | `http.MaxBytesReader(w, r.Body, MaxUploadBytes)` (line 255), `errors.As(err, &maxErr)` checks at both MultipartReader init (line 259) and `NextPart` (line 282), both return `writeJSONError(w, http.StatusRequestEntityTooLarge, "SIZE_LIMIT", ...)`. Atomic writes via `.tmp` + `os.Rename` in `uploadOnePart` (lines 329, 366). `os.Remove(tmp)` on both error paths (lines 356, 367). Executor smoke test (in SUMMARY 01-01): 600 MB body → HTTP 413 + `{"code":"SIZE_LIMIT","error":"request exceeds 500 MB"}` PASS. |

**Score:** 5/5 truths have passing code evidence. 2 require human confirmation for runtime behavior.

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `main.go` | Hardened handleUpload with MaxBytesReader, atomic writes, per-file timeout, JSON error responses | ✓ VERIFIED | All patterns confirmed at stated line numbers. |
| `main.go` | Top-level constants `MaxUploadBytes`, `PerFileUploadTimeout` | ✓ VERIFIED | Lines 29, 32. |
| `main.go` | `writeJSONError` helper | ✓ VERIFIED | Lines 189-196. |
| `main.go` | `uploadOnePart` per-part helper with .tmp+Rename and timeout | ✓ VERIFIED | Lines 319-371. |
| `static/index.html` | Per-file upload queue with concurrency control | ✓ VERIFIED | `UPLOAD_CONCURRENCY=4` line 234, `runUploadQueue` line 799. |
| `static/index.html` | Per-file retry with exponential backoff | ✓ VERIFIED | `uploadOneFile` line 830, `RETRY_DELAYS`, `shouldRetry`, `abortableSleep` all present. |
| `static/index.html` | Per-file + overall progress UI | ✓ VERIFIED | `renderUploadProgress` line 920, DOM containers for both channels, CSS matching picker vocabulary. |
| `static/index.html` | JSON-or-text error parsing in `api()` | ✓ VERIFIED | Content-Type sniff at line 307, `e.code = payload.code` line 313, `opts.signal` threading line 301. |
| `static/index.html` | localStorage-backed resume state per channel | ✓ VERIFIED | `sync_resume_` key, `persistResumeState`, `loadResumeState`, `clearResumeState` all present. |
| `static/index.html` | Resume button rendered on page load when state exists | ✓ VERIFIED | `renderResumeButton` called in `DOMContentLoaded` for both channels. |
| `static/index.html` | Resume action re-triggers picker flow | ✓ VERIFIED | `resumeUpload` programmatically clicks `#input-{ch}` (line 1031). |

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `main.go:handleUpload` | `http.MaxBytesReader` | wraps r.Body before mr.NextPart loop | ✓ WIRED | Line 255: `r.Body = http.MaxBytesReader(w, r.Body, MaxUploadBytes)` |
| `main.go:uploadOnePart` | `os.Rename` | atomic finalization of .tmp file | ✓ WIRED | Line 366: `os.Rename(tmp, dest)` |
| `main.go:uploadOnePart` | `context.WithTimeout` | per-part deadline | ✓ WIRED | Line 335: `context.WithTimeout(parentCtx, PerFileUploadTimeout)` |
| `static/index.html:uploadFiles` | queue worker pool | spawns UPLOAD_CONCURRENCY workers | ✓ WIRED | Line 824: `for (let i = 0; i < UPLOAD_CONCURRENCY; i++) workers.push(worker())` |
| `static/index.html:uploadOneFile` | fetch with AbortController + backoff | retry loop with delays [1000, 3000, 10000] | ✓ WIRED | `RETRY_DELAYS` consumed at lines 850, 864; `abortableSleep` called. |
| `static/index.html:api` | structured JSON error | Content-Type sniff + parse {error, code} | ✓ WIRED | Line 307-314: CT sniff → JSON parse → `e.code = payload.code` |
| `static/index.html:runUploadQueue` | `persistResumeState` | called on done/failed file transitions | ✓ WIRED | Lines 812, 818: `persistResumeState(ch, false)` after each terminal state. |
| `static/index.html:resumeUpload` | existing picker flow | input.click() → openPicker → confirmPicker → uploadFiles | ✓ WIRED | Line 1031: `input.click()`. Change handler at line 275 routes to `openPicker`. |
| `static/index.html:uploadFiles` | `clearResumeState` then `persistResumeState` | clear prior marker at start, persist on cancel/partial | ✓ WIRED | Lines 692 (clear), 774 (clear on success), 779 (persist on partial), 786 (persist on cancel). |

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
|----------|--------------|--------|--------------------|--------|
| `renderUploadProgress` | `uploadProgress.files` Map | `runUploadQueue` sets `st.state` per file transition | Yes — state transitions driven by actual fetch results | ✓ FLOWING |
| `updateProgressBar` | `uploadProgress.done + uploadProgress.failed` | counters incremented in `runUploadQueue` per real upload outcome | Yes | ✓ FLOWING |
| `renderResumeButton` | `loadResumeState(ch)` from localStorage | `persistResumeState` writes real `uploadProgress` snapshot | Yes — real per-file state captured | ✓ FLOWING |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| Binary compiles with all new symbols | `go build -o /tmp/sync-temple-verify ./...` | exit 0 | ✓ PASS |
| No vet issues | `go vet ./...` | exit 0 | ✓ PASS |
| BATCH_MAX fully removed | `grep -c 'BATCH_MAX' static/index.html` | 0 | ✓ PASS |
| upload-progress DOM containers present for both channels | grep for `id="upload-progress-a"` and `id="upload-progress-b"` | 1 each | ✓ PASS |
| Old plain-text error responses gone from upload path | `grep -c 'http.Error(w, "multipart error'` | 0 | ✓ PASS |
| 500 MB body → HTTP 413 + SIZE_LIMIT | Executor smoke test (SUMMARY 01-01) | 413 + `{"code":"SIZE_LIMIT"}` | ✓ PASS (executor-run) |
| Normal upload response shape | Executor smoke test (SUMMARY 01-01) | `{"errors":[],"failed":0,"uploaded":1}` | ✓ PASS (executor-run) |
| `uploaded` field is integer (Python CLI compat) | `uploaded := 0` (line 272), encoded via `map[string]any` | int type preserved | ✓ PASS |
| Live 500-file browser upload without WebKit errors | Requires browser + server | — | ? SKIP → human_needed |
| Retry UI visible on server kill mid-upload | Requires live server + browser | — | ? SKIP → human_needed |
| Cancel aborts in-flight requests | Requires live server + browser | — | ? SKIP → human_needed |
| Resume button appears after cancel + page reload | Requires live browser + localStorage | — | ? SKIP → human_needed |
| Resume completes with hash shortcut + diff-only uploads | Requires live server + browser + folder re-select | — | ? SKIP → human_needed |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|------------|-------------|--------|----------|
| UPLOAD-01 | Plans 01, 02 | Browser uploads ≥500 files without WebKitBlobResource error 4 | ✓ CODE_VERIFIED / ? BROWSER_NEEDED | BATCH_MAX removed; per-file queue with concurrency=4 implemented. Runtime behavior requires human test. |
| UPLOAD-02 | Plan 02 | Throttle parallel uploads to configurable limit (3-4 concurrent) | ✓ VERIFIED | `UPLOAD_CONCURRENCY=4`, worker pool uses closure cursor limiting concurrency precisely. |
| UPLOAD-03 | Plan 02 | Automatic retry with exponential backoff 3 attempts: 1s/3s/10s | ✓ VERIFIED | `RETRY_DELAYS=[1000,3000,10000]`, `shouldRetry`, `abortableSleep` all wired into `uploadOneFile`. |
| UPLOAD-04 | Plan 02 | Per-file progress + overall progress bar | ✓ VERIFIED | `renderUploadProgress`, per-file `.uf-row` rows, `<progress>` bar, both channels, `scheduleProgressRender` with 200ms throttle + rAF. |
| UPLOAD-05 | Plan 03 | Resume from last successful upload point | ✓ CODE_VERIFIED / ? BROWSER_NEEDED | All resume helpers present and wired. End-to-end flow requires live browser confirmation. |
| UPLOAD-06 | Plan 01 | Server `http.MaxBytesReader` (500 MB) + HTTP 413 | ✓ VERIFIED | `MaxUploadBytes=500<<20`, `http.MaxBytesReader` call, `writeJSONError` with `SIZE_LIMIT`. Executor smoke test passed. |
| UPLOAD-07 | Plan 01 | Server deletes empty/partial files on abort | ✓ VERIFIED | `.tmp` + `os.Rename` atomic pattern; `os.Remove(tmp)` on both error paths in `uploadOnePart`. |

All 7 Phase 1 requirement IDs (UPLOAD-01 through UPLOAD-07) are claimed by the plans and have implementation evidence in the codebase.

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| None | — | — | — | No stubs, TODOs, or placeholder returns found in modified code paths. |

Checked for: `TODO`, `FIXME`, `return null`, `return {}`, `return []`, hardcoded empty state. None found in the upload path functions.

### Human Verification Required

#### 1. Large Folder Upload (500+ files) — No WebKit Errors

**Test:** Start the server. Open Chrome or Safari. Drag a folder containing at least 500 files onto the Channel A drop zone.
**Expected:** All files reach 'done' state in the progress UI. No `WebKitBlobResource error 4` in DevTools Console. DevTools Network panel filtered to `upload` shows peak concurrent requests never exceeds 4.
**Why human:** WebKitBlobResource error 4 is a browser-specific resource exhaustion failure. The code fix (BATCH_MAX removal + 4-worker pool) is verified in code, but the actual absence of the error can only be confirmed in a live browser session.

#### 2. Retry Behavior on Server Failure

**Test:** Start an upload of a few dozen files, then kill the server process mid-upload. Observe the Channel A upload progress rows.
**Expected:** Affected rows transition to 'retrying N/4', waiting 1s, 3s, 10s between attempts. After 3 retries rows show 'failed'. No further requests fire. Status bar shows the failure count.
**Why human:** The retry state transition sequence (including timing) and the absence of spurious retries after failure terminus require live browser + server interaction.

#### 3. Cancel In-Flight Upload

**Test:** Start an upload of a large folder. Click the Cancel button before completion.
**Expected:** DevTools Network shows in-flight requests cancelled (status "(canceled)"). No new requests fire. Status bar shows "Upload cancelled." Progress UI remains visible showing current state.
**Why human:** AbortController behavior and in-flight request cancellation require live browser observation in DevTools.

#### 4. Resume Button After Cancel + Page Reload

**Test:** Cancel an upload mid-way. Open DevTools Application → Local Storage. Reload the page. Inspect Channel A drop zone.
**Expected:** `sync_resume_a` key exists in localStorage with `files_done >= 1` and `files_total` matching the upload set. After reload, a "Resume (re-select folder)" row appears inside the Channel A drop zone with the correct remaining count.
**Why human:** localStorage persistence, page-reload state recovery, and DOM injection of the resume row require a live browser session.

#### 5. Resume + Hash Reuse + Diff-Only Upload

**Test:** Cancel upload mid-way. Click "Resume (re-select folder)" in the drop zone. Re-select the same folder in the file picker. Confirm in the picker. Observe the hashing phase and the diff request body.
**Expected:** Hashing phase is faster than a fresh upload (saved hashes reused for unchanged files). The POST to `/api/a/diff` contains a manifest with all previously-hashed paths. The upload queue only POSTs files not yet on the server. On full success, `sync_resume_a` is removed from localStorage and the Resume row disappears.
**Why human:** Hash reuse speed and diff-narrowed upload set require real file handles and server state to verify.

### Gaps Summary

No code gaps found. All 5 success criteria are implemented and wired:

- SC1 (no WebKit errors): BATCH_MAX loop removed; UPLOAD_CONCURRENCY=4 worker pool implemented.
- SC2 (per-file progress + bar): Full two-tier progress UI implemented and wired.
- SC3 (retry): RETRY_DELAYS + shouldRetry + abortableSleep fully wired into uploadOneFile.
- SC4 (resume): All 5 resume helpers implemented; DOMContentLoaded hook renders buttons; lifecycle (clear-on-new, persist-on-cancel, clear-on-success) all wired.
- SC5 (413 + no partial files): MaxBytesReader + SIZE_LIMIT JSON error + atomic .tmp+Rename + os.Remove on error all implemented.

Status is `human_needed` because 5 behaviors — WebKit error absence, retry visual transition, cancel abort, localStorage resume persistence, and hash-reuse resume — cannot be confirmed by static code analysis alone.

---

_Verified: 2026-05-12_
_Verifier: Claude (gsd-verifier)_
