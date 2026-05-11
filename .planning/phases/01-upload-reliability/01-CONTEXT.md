# Phase 1: Upload Reliability - Context

**Gathered:** 2026-05-11
**Status:** Ready for planning

<domain>
## Phase Boundary

This phase delivers a browser upload that succeeds for folders of any size (target: ≥500 files) without `WebKitBlobResource error 4` or dropped connections, with visible per-file progress, automatic retry on transient failures, and a Resume path after interruption. The Go server is hardened with `http.MaxBytesReader`, structured JSON error responses, and atomic file writes that leave no partial files behind on error.

**In scope:** `static/index.html` upload-path JavaScript (concurrency control, retry, progress, resume) + `main.go` upload handler + error-response refactor.

**Out of scope:** UI visual redesign (Phase 4), download progress UI (Phase 4), mobile responsiveness (Phase 4), CLI changes (Phase 2/3), rate limiting (v2), manifest caching (v2), test suite (v2).

</domain>

<decisions>
## Implementation Decisions

### Concurrency Strategy
- **D-01:** Replace the current size-batched `Promise.all`-style upload with a **per-file queue**. Each file is its own multipart-POST. A small worker pool (default `N = 4`, configurable via constant `UPLOAD_CONCURRENCY` in `static/index.html`) drains the queue. This directly addresses the WebKit connection-pool exhaustion described in `CONCERNS.md` and satisfies UPLOAD-02.
- **D-02:** The existing `BATCH_MAX = 15 MB` size-batching is **removed** in favor of per-file uploads. Rationale: with retry + per-file progress, batching adds complexity (which file in a batch failed?) without proportional throughput gain on real connections. If perf measurements during execution show single-file uploads are too slow, we can revisit by bundling tiny files (<64 KB) into a single multipart request — but only as a follow-up, not in this phase.

### Retry Policy
- **D-03:** Per-file retry with exponential backoff: **1s → 3s → 10s, max 3 attempts** (matches UPLOAD-03). Retry triggers on: network errors, HTTP 5xx, HTTP 408. **No retry** on HTTP 4xx other than 408 (4xx = client problem, retry won't help). On final failure, the file is marked failed in the per-file UI and stays in the queue for **manual Retry** (Phase 4 UI-03 wires this up).
- **D-04:** Retries respect an `AbortController` so the user can cancel an upload mid-retry without leaking pending timers.

### Resume Mechanism
- **D-05:** Resume reuses the **existing `/api/{ch}/diff` endpoint** — no new server-side state. On Resume, the client re-runs diff to get the current `client_only` + `different` set, then continues uploading only those files. This is simpler than session-tracking, leverages existing infrastructure, and is robust against partial server state.
- **D-06:** A Resume state object lives in **`localStorage`** keyed by `sync_resume_{channel}` containing `{started_at, files_total, files_done, files_failed[], session_id}`. localStorage (not sessionStorage) so a tab refresh or accidental close doesn't lose the resume point.
- **D-07:** Resume state is **cleared automatically** when the upload completes fully OR when the user starts a new upload to the same channel (the channel slot is rewritten).

### Progress UI Granularity
- **D-08:** Two-tier progress: (a) **overall progress bar** showing `done / total` files + bytes-uploaded estimate; (b) **per-file rows** in an expandable list with state per file (`pending` / `uploading` / `done` / `failed (HTTP N)` / `retrying (attempt 2/3)`). The per-file list reuses the existing tree/file-picker UI styling; we add a status column.
- **D-09:** Progress updates throttled to ~200ms to avoid DOM-thrash on hundreds of files. Use `requestAnimationFrame` for the overall bar.

### Server Error Response Format
- **D-10:** All upload-related error responses become **structured JSON**: `{"error": "<human message>", "code": "<MACHINE_CODE>"}` with `Content-Type: application/json`. Initial error codes: `SIZE_LIMIT`, `TIMEOUT`, `BAD_REQUEST`, `AUTH_FAILED`, `INTERNAL`. The browser maps `code` → user-readable hint (UI-02 in Phase 4 expands this catalog; this phase just ships the protocol).
- **D-11:** Existing endpoints that return plain text (`api()` callers in `static/index.html`) handle the new format by checking `Content-Type` — if `application/json`, parse and use `error` field; otherwise fall back to text. Backward-compatible with the Python CLI which uses `.json()` already on success responses.

### Server-Side Hardening
- **D-12:** Wrap upload request body in **`http.MaxBytesReader(w, r.Body, 500 << 20)`** (500 MB total request size). On overflow, server returns `413 Payload Too Large` with JSON error `{code: "SIZE_LIMIT", error: "request exceeds 500 MB"}`. The 500 MB ceiling is per-request — since uploads are now per-file, this caps individual file size at 500 MB, which is appropriate for sync_temple's use case.
- **D-13:** Atomic file writes: every uploaded part is streamed to `<destination>.tmp` first, then `os.Rename` to the final path on success. If `io.Copy` returns an error OR the request context is cancelled mid-stream, the `.tmp` file is `os.Remove`'d before returning. No empty files, no half-written files in `dataDir/{ch}/files/`.
- **D-14:** `handleUpload` continues to acquire the per-channel write lock once at the start, BUT we add a `context.WithTimeout(r.Context(), 5*time.Minute)` per file inside the loop. A single stalled file does not block the loop indefinitely — it errors after 5 min and the loop continues with the next part.
- **D-15:** The `n++` counter is moved outside the `if err == nil` branch — on error, we still want to count it as "attempted" in the response. Response shape becomes `{"uploaded": N, "failed": M, "errors": [{file, code, message}]}` so the client knows which specific files in a multi-file request failed.

### Configuration & Constants
- **D-16:** Two new constants exposed at the top of `main.go`: `MaxUploadBytes = 500 << 20` and `PerFileUploadTimeout = 5 * time.Minute`. One new constant at the top of the UI script in `static/index.html`: `UPLOAD_CONCURRENCY = 4`. These are NOT runtime-configurable in this phase (keep complexity low); a future phase can promote them to CLI flags.

### Backward Compatibility
- **D-17:** Python CLI (`sync` script) — its current 50-files-per-multipart-batch upload path **continues to work unchanged**. The server-side `MaxBytesReader` (500 MB) is well below the size of 50 small files; the JSON error format is parsed by the existing Python `.json()` call. No breaking change for the CLI in this phase. The CLI gets fully replaced in Phase 2 anyway, so we don't optimize for it.

### Claude's Discretion
- Exact DOM structure for the per-file progress list (Phase 4 will re-style anyway — keep this phase functional, not pretty).
- Specific JS module structure inside `static/index.html` (it's all in one file by design; the planner can decide whether to introduce a small upload-queue helper section or inline it).
- Exact wording of error messages — keep them clear and actionable, but text can iterate in Phase 4.
- Whether per-file timeout uses `context.WithTimeout` on the request or `time.AfterFunc` with a `Close` on the reader. Either works; planner picks based on Go-idiom preference.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Project Context
- `.planning/PROJECT.md` — Core Value, Active requirements, Constraints (Go stdlib only on server, vanilla JS frontend lock-in), Key Decisions (upload concurrency client-side, server hardening with MaxBytesReader).
- `.planning/REQUIREMENTS.md` — UPLOAD-01..07 (locked requirements for this phase).
- `.planning/ROADMAP.md` §Phase 1 — goal statement + 5 success criteria.

### Codebase Maps (relevant subset)
- `.planning/codebase/ARCHITECTURE.md` §"Data Flow" → "Primary Upload Path (Web UI Drag-Drop)" — full pipeline from drop-zone to disk including line refs.
- `.planning/codebase/CONCERNS.md` §"Browser Upload Bug: WebKitBlobResource Error 4 on Large Folder Uploads" — root cause analysis with line numbers in `static/index.html`.
- `.planning/codebase/CONCERNS.md` §"Missing Request Size Limits and Validation" — server-side concerns in `main.go`.
- `.planning/codebase/CONCERNS.md` §"Text Handler Silent Failures" — pattern to fix (silent errors).
- `.planning/codebase/STACK.md` — Go stdlib only constraint, embedded UI via `//go:embed`.

### Source Files (Primary Edit Targets)
- `static/index.html` — upload-path JS (specifically the region around lines 631-712 today: `uploadFiles`, `confirmPicker`, batch loop).
- `main.go` — `handleUpload` (lines 231-279 today), `handleSetText` (silent-error pattern referenced for fix), constants/flags block at top of file.

No external specs/ADRs — sync_temple has no spec repository. All decisions are captured here.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- **`api()` helper in `static/index.html:250-268`** — central fetch wrapper for all API calls. New retry/backoff logic plugs in here so every endpoint benefits (not just upload). Tracks `sync_token` from sessionStorage.
- **`/api/{ch}/diff` endpoint (`main.go:186-229`)** — already returns `{client_only, server_only, different, same}`. Resume mechanism reuses this directly — no new endpoint needed.
- **`safePath()` in `main.go:128`** — validates upload destination paths. Continue to use; symlink-escape hardening is deferred to v2 (ROB-03).
- **Per-channel `RWMutex` in `server.locks`** — write lock is already taken in `handleUpload`. We do NOT change locking granularity in this phase (keeps blast radius small). Per-file locks are a v2 perf improvement.
- **SSE notify via `s.notify(ch)`** — already fires after each upload to push live updates to other connected clients. Keep firing **once at the end** of the upload batch, not per file, to avoid SSE-storm with 500 files (existing `notify` call at `main.go:276` is correctly placed after the loop — preserve this).
- **`isIgnored()` + `DEFAULT_IGNORE` in `static/index.html:192`** — client-side ignore list (.env, node_modules, etc.). Keep filtering pre-upload so we don't waste cycles on files we'd reject anyway.

### Established Patterns
- **Go error pattern: explicit `(T, error)` tuples** — `CONVENTIONS.md` documents this. Server changes follow it; no panic-based control flow.
- **Logging: `fmt.Printf` at startup only** — `main.go` does not log per-request today. We add **minimal** logging on the upload error path (only on failure: file path + code) using `log.Printf` to stderr. Not structured logging — that's a separate concern.
- **Frontend state: module-level vars + closure** — current pattern in `static/index.html`. The upload queue state (active workers, pending files) lives in module-level vars consistent with existing style; no class/framework introduction.
- **Multipart streaming** — `mr.NextPart()` already streams parts; we just wrap with size limit + atomic write. No need to switch parsers.

### Integration Points
- **Drop-zone → picker → uploadFiles** — entrypoint stays at `confirmPicker()` calling `uploadFiles(toUpload)`. We replace `uploadFiles`'s internals with the new queue, but the public signature stays the same so other call sites (if any) keep working.
- **Server handler → notify → SSE** — at the end of `handleUpload`, `s.notify(ch)` still fires. No change to the SSE protocol or `handleEvents`.
- **Upload response JSON** — currently `{"uploaded": N}` from server, consumed by client `r.uploaded`. We extend to `{"uploaded": N, "failed": M, "errors": [...]}` — additive, doesn't break the existing Python CLI which only reads `uploaded`.

</code_context>

<specifics>
## Specific Ideas

- **Concurrency default = 4** based on WebKit's default per-origin HTTP/1.1 connection limit (6) minus headroom for SSE + diff polling.
- **Backoff `1s / 3s / 10s`** is from the user's REQUIREMENTS.md verbatim. Total wait before giving up: ~14s per file — acceptable for transient network blips, fast enough not to feel stuck.
- **500 MB MaxBytesReader limit** is from REQUIREMENTS.md verbatim. Large enough for a single video file, small enough that an attacker can't OOM the server with one request.
- **Resume = re-diff, not session-tracking** because diff is already O(n) on the server side (manifest re-hash) and we accept that cost — manifest caching is v2 (PERF-01).
- The Python CLI's existing 50-files-per-request batch upload path is left untouched — that path is being replaced wholesale in Phase 2.

</specifics>

<deferred>
## Deferred Ideas

These came up while thinking through Phase 1 but belong elsewhere:

- **Manifest caching** — `main.go:107-126` re-hashes the whole tree on every `/diff` and `/files` request. With 1000+ files this is slow. Deferred to v2 PERF-01.
- **Per-file server-side locking** — channel-level lock serializes uploads. Move to per-file locks once we have multi-CLI/multi-client scenarios. Deferred (Phase 3+ or v2).
- **SSE heartbeat + reconnect logic** — long-running browser tabs may silently lose SSE. Deferred to v2 ROB-01.
- **Streaming ZIP download** — `handleDownloadSelected` buffers in memory. Deferred to v2 PERF-02.
- **Rate limiting per token** — Deferred to v2 ROB-02.
- **Visual redesign of progress UI** — functional now, pretty in Phase 4 (UI-01..03).
- **Mobile-friendly drag-drop fallback** — Phase 4 UI-05.
- **Symlink-escape hardening in `safePath`** — Deferred to v2 ROB-03.
- **Tests for `handleUpload` / `safePath`** — Deferred to v2 TEST-01..02.
- **Bundling tiny files (<64 KB) into multipart batches** — possible perf follow-up if per-file uploads measure slow. Not in this phase; revisit only if needed.

</deferred>

---

*Phase: 1-Upload Reliability*
*Context gathered: 2026-05-11*
