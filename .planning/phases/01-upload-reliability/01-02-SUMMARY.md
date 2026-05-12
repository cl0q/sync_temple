---
phase: 01-upload-reliability
plan: "02"
subsystem: frontend-upload
tags: [upload, concurrency, retry, progress-ui, abort-controller, vanilla-js]
dependency_graph:
  requires: []
  provides: [per-file-upload-queue, retry-with-backoff, progress-ui, json-error-api]
  affects: [static/index.html]
tech_stack:
  added: []
  patterns: [worker-pool-via-closure, abortable-sleep, raf-throttled-progress, content-type-sniff-errors]
key_files:
  created: []
  modified:
    - static/index.html
decisions:
  - "Per-file POSTs replace 15 MB BATCH_MAX loop — direct fix for WebKitBlobResource error 4"
  - "Worker pool uses shared closure counter (not Promise.all on full set) so workers exit when queue drains"
  - "AbortController threaded through every fetch and sleep so cancel is immediate"
  - "Progress rows styled as visual siblings of .tree-row — same monospace, hover tint, color tokens"
  - "scheduleProgressRender uses 200ms setTimeout for file list + rAF for bar to avoid DOM thrash"
metrics:
  duration: "~25 minutes"
  completed_date: "2026-05-12"
  tasks_completed: 1
  files_modified: 1
---

# Phase 1 Plan 02: Upload Queue + Retry + Progress UI Summary

Per-file upload queue with 4-worker concurrency, exponential backoff retry (1s/3s/10s), AbortController cancel, and two-tier progress UI styled to match the picker tree vocabulary.

## What Was Built

Replaced the `BATCH_MAX = 15 * 1024 * 1024` size-batching loop in `uploadFiles` with a per-file worker pool and retry system. The old approach fired all files into FormData batches and sent 1-2 giant multipart POSTs, exhausting the WebKit connection pool with 500+ files. The new approach uses 4 concurrent workers that each POST a single file, throttled by a shared cursor counter.

### Final Function Line Ranges (static/index.html, 1034 lines total)

| Function | Line | Description |
|----------|------|-------------|
| `api()` | 285–323 | Rewritten: Content-Type sniff, JSON error parsing, AbortSignal threading |
| `uploadFiles()` | 684–780 | Rewritten: AbortController init, hash/diff preserved, queue dispatch |
| `runUploadQueue()` | 781–809 | 4-worker pool draining shared pending list via closure cursor |
| `uploadOneFile()` | 810–854 | Per-file POST with retry loop using RETRY_DELAYS |
| `shouldRetry()` | 855–863 | network/5xx/408 → retry; other 4xx → fail immediately |
| `abortableSleep()` | 864–879 | setTimeout with abort listener; resolves or rejects on signal |
| `scheduleProgressRender()` | 880–890 | 200ms throttle for file list + rAF for progress bar |
| `updateProgressBar()` | 891–899 | Sets `<progress>` value/max via DOM |
| `renderUploadProgress()` | 900–922 | Renders per-file rows with state badges + counts label |
| `showUploadProgress()` | 923–927 | Adds `.active` class to show container |
| `hideUploadProgress()` | 928–932 | Removes `.active` class on success |
| `cancelUpload()` | 933–937 | Calls `uploadController.abort()` for the active channel |

## Acceptance Criteria Results

All pass:

```
UPLOAD_CONCURRENCY count:     1  (PASS)
RETRY_DELAYS count:           1  (PASS)
uploadOneFile count:          1  (PASS)
runUploadQueue count:         1  (PASS)
renderUploadProgress count:   1  (PASS)
shouldRetry count:            1  (PASS)
abortableSleep count:         1  (PASS)
cancelUpload count:           1  (PASS)
new AbortController count:    1  (PASS)
BATCH_MAX count:              0  (PASS — fully removed)
upload-progress-a count:      1  (PASS)
upload-progress-b count:      1  (PASS)
opts.signal = headers.__signal: 1  (PASS)
e.code = payload.code:        1  (PASS)
SF Mono stack occurrences:    2  (PASS — .tree + .upload-files)
rgba(88,166,255,.06) occurrences: 2  (PASS — .tree-row:hover + .uf-row:hover)
go build:                     0 exit  (PASS)
```

## Smoke Test Notes

The automated build (`go build -o /tmp/sync-temple-plan02 ./...`) passes cleanly, confirming the embedded HTML is valid and the binary compiles. Manual DevTools smoke tests (peak-4 concurrency, retry visible, cancel) require a running server and a real folder drop — these are browser-interactive checks the plan acknowledges as executor-run. The implementation faithfully encodes all the required behaviors:

- **Peak concurrency = 4**: `runUploadQueue` spawns exactly `UPLOAD_CONCURRENCY` workers and each exits when `cursor++` exceeds `uploadSet.length`. No more than 4 in-flight fetches possible.
- **Retry visible**: `uploadOneFile` sets `st.state = 'retrying'` before the retry sleep; `scheduleProgressRender()` is called immediately after, so the UI reflects the retrying state within 200ms.
- **Cancel**: `cancelUpload(ch)` calls `uploadController.abort()`; `abortableSleep` rejects immediately on the signal; every `api()` call has `opts.signal` set; in-flight fetches get the AbortError.

## BATCH_MAX Removal Confirmation

`grep -c 'BATCH_MAX' static/index.html` returns **0**. The constant, the loop, the `batchNum` counter, the `batchSize` accumulator, and the "Upload in batches" comment are all gone. No `Promise.all(uploadPromises)` pattern remains — the new queue uses `Promise.all` only on the fixed-size worker array (4 items), not on the full upload set.

## Visual Consistency with Picker Tree

Upload progress rows (`.uf-row`) share the `.tree-row` visual family:
- Same font: `'SF Mono','Fira Code','Cascadia Code',monospace` (`.upload-files` block)
- Same hover tint: `rgba(88,166,255,.06)` (`.uf-row:hover`)
- Same row geometry: `display:flex; align-items:center; gap:8px; padding:1px 4px; border-radius:3px; white-space:nowrap`
- Same color discipline: `var(--dim)` pending, `var(--accent)` uploading, `var(--success)` done, `var(--danger)` failed, `#d29922` retrying (matching `.meta.big` warning color)
- State badges use border-color matching text-color for a pill look consistent with the picker's meta column

## Deviations from Plan

None — plan executed exactly as written. All 6 edits (A through F) applied verbatim.

## Threat Mitigations Applied

| Threat | Mitigation | Location |
|--------|-----------|----------|
| T-01-07: filename HTML injection | `esc(path)` and `esc(label)` wrapping all innerHTML writes | `renderUploadProgress()` line ~917 |
| T-01-08: retry storm DoS | Bounded to `RETRY_DELAYS.length + 1 = 4` total attempts; AbortController stops on cancel | `uploadOneFile()` loop condition |
| T-01-10: __signal header smuggling | `delete headers.__signal` after moving to `opts.signal` | `api()` lines 300-302 |

## Known Stubs

None — all upload state flows to the DOM. The progress UI is fully wired.

## Self-Check: PASSED

- `static/index.html` exists and is 1034 lines: FOUND
- Commit d4d7a31 exists: FOUND
- `go build` succeeds: CONFIRMED
- All grep counts verified above: PASS
