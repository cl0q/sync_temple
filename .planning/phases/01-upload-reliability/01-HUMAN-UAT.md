---
status: partial
phase: 01-upload-reliability
source: [01-VERIFICATION.md]
started: 2026-05-12T00:00:00Z
updated: 2026-05-12T00:00:00Z
---

## Current Test

[awaiting human testing]

## Tests

### 1. 500-file Drag-and-Drop Upload (Chrome / Safari)
expected: All files upload successfully. DevTools Console shows no `WebKitBlobResource error 4`. DevTools Network panel shows at most 4 concurrent `POST /api/a/upload` requests at any time.
result: [pending]

### 2. Retry Behavior on Server Kill
expected: Kill the server process mid-upload (after a few files complete). Affected file rows enter `retrying` state showing `retrying N/4`, then transition to `failed` after 3 retries. No further requests fire after the failure terminus.
result: [pending]

### 3. Cancel Aborts In-flight Requests
expected: Click Cancel during an in-progress upload. DevTools Network panel shows in-flight requests as `(canceled)`. No further upload requests fire. Status bar shows `Upload cancelled.` Upload controller is cleared.
result: [pending]

### 4. Resume State Persists Across Page Reload
expected: Cancel an upload mid-way, then reload the page. Channel A drop zone shows a Resume row with `N / M files remaining from previous attempt` plus `Resume (re-select folder)` and `Discard` buttons.
result: [pending]

### 5. Resume Hash-Reuse + Delta Upload
expected: Click `Resume (re-select folder)`, re-select the same folder, confirm in the picker, let it complete. Hashing phase completes faster than a fresh upload (hash reuse from saved manifest observable in the status bar). Only previously-missing/failed files are POSTed. On full success, `localStorage.getItem('sync_resume_a')` returns null and the Resume row disappears.
result: [pending]

### 6. Server 413 Response on Oversized Upload (Confirmatory)
expected: POST a request body larger than 500 MB to `POST /api/a/upload` with a valid token. Server returns HTTP 413 with `Content-Type: application/json` and body containing `{"code":"SIZE_LIMIT"}`. No file is written to disk. (Executor already smoke-tested this during Plan 01 execution — included here as confirmatory re-run.)
result: [pending]

## Summary

total: 6
passed: 0
issues: 0
pending: 6
skipped: 0
blocked: 0

## Gaps

(none yet — fill in during testing)
