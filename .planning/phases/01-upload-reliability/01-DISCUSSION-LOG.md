# Phase 1: Upload Reliability - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-05-11
**Phase:** 1-Upload Reliability
**Areas discussed:** concurrency-strategy, retry-policy, resume-mechanism, progress-ui-granularity, server-error-format, resume-state-storage, server-cleanup-strategy
**Mode:** `--auto` (Claude selected recommended option for each gray area, no user prompts)

---

## Concurrency Strategy

| Option | Description | Selected |
|--------|-------------|----------|
| Per-file queue with N=4 concurrent fetches | Each file is its own POST; small worker pool drains queue | ✓ |
| Smaller multipart batches with capped concurrency | Keep batching but limit parallel batches | |
| Sequential one-at-a-time | Simplest, safest, but slow | |

**User's choice:** Per-file queue (auto-selected, recommended)
**Notes:** Maps directly to UPLOAD-02 in REQUIREMENTS.md. WebKit's default per-origin HTTP/1.1 connection limit is 6; N=4 leaves headroom for SSE + diff polling. Existing 15 MB size-batching is removed — combining batching with per-file retry/progress adds complexity without clear wins.

---

## Retry Policy

| Option | Description | Selected |
|--------|-------------|----------|
| Exponential backoff 1s/3s/10s, 3 attempts | Per-file retry on network/5xx/408 | ✓ |
| Linear retries (3× 2s) | Simpler, but doesn't accommodate transient overload | |
| Fail-fast with manual retry only | Smallest code, worst UX | |

**User's choice:** Exponential backoff (auto-selected, locked by REQUIREMENTS.md UPLOAD-03)
**Notes:** Total wait before giving up: ~14s per file. No retry on 4xx other than 408 (client problem). `AbortController` used so cancel works mid-retry.

---

## Resume Mechanism

| Option | Description | Selected |
|--------|-------------|----------|
| Re-run /api/{ch}/diff after failure, continue with delta | Reuses existing endpoint, no new server state | ✓ |
| Server-side upload-session tracking with session-id | More precise, but adds DB-like state | |
| Client-side per-file checkpoint in localStorage only | Doesn't survive across devices | |

**User's choice:** Re-diff (auto-selected, recommended)
**Notes:** Simpler architecture, leverages existing infrastructure. Cost: re-hashes entire tree on the server on each Resume — accepted since manifest caching is v2 (PERF-01).

---

## Progress UI Granularity

| Option | Description | Selected |
|--------|-------------|----------|
| Per-file rows + overall progress bar | Two-tier: granular status + bird's-eye | ✓ |
| Single overall progress bar only | Minimal, less informative | |
| Per-file rows only (no overall) | Detailed but no bird's-eye for 500 files | |

**User's choice:** Both per-file and overall (auto-selected, recommended)
**Notes:** Maps to UPLOAD-04. Per-file rows support Phase 4 UI-03 retry-buttons. Updates throttled to ~200ms to avoid DOM thrash.

---

## Server Error Response Format

| Option | Description | Selected |
|--------|-------------|----------|
| Structured JSON `{error, code}` with Content-Type: application/json | Machine-parseable for UI mapping | ✓ |
| Plain text error message (current) | Simple but client can't act on it | |
| HTTP status code only, no body | Smallest but loses context | |

**User's choice:** JSON with error code (auto-selected, recommended)
**Notes:** Enables Phase 4 UI-02 actionable messages without protocol change. Backward-compatible — Python CLI uses `.json()` on success, browser checks `Content-Type` and falls back to text for old responses.

---

## Resume State Storage

| Option | Description | Selected |
|--------|-------------|----------|
| localStorage keyed by `sync_resume_{channel}` | Survives tab refresh, scoped per channel | ✓ |
| sessionStorage | Lost on tab close, doesn't help most resume scenarios | |
| In-memory only | Lost on refresh | |

**User's choice:** localStorage (auto-selected, recommended)
**Notes:** Auto-cleared when upload completes or user starts new upload to same channel.

---

## Server Cleanup Strategy

| Option | Description | Selected |
|--------|-------------|----------|
| Write to .tmp file, os.Rename on success, defer Remove on error | Atomic, idiomatic Go | ✓ |
| Write directly, os.Remove on error path | Simpler but race-prone | |
| Buffer entire file in memory, write atomically | Memory-bloated for large files | |

**User's choice:** tmp + rename (auto-selected, recommended)
**Notes:** Idiomatic Go pattern. Avoids race with concurrent reads on same path. Empty/partial files never appear in `dataDir/{ch}/files/`.

---

## Claude's Discretion

The following implementation details were explicitly left to the planner/executor:

- Exact DOM structure for the per-file progress list (Phase 4 will restyle).
- Specific JS module structure inside `static/index.html` (keep current single-file pattern; planner decides function boundaries).
- Exact wording of error messages — clear and actionable, but text can iterate in Phase 4.
- Whether per-file timeout uses `context.WithTimeout` or `time.AfterFunc(reader.Close)`.

## Deferred Ideas

Ideas that came up while thinking through Phase 1 but belong elsewhere — fully listed in CONTEXT.md `<deferred>`:

- Manifest caching → v2 PERF-01
- Per-file server-side locking → v2 / Phase 3+
- SSE heartbeat + reconnect → v2 ROB-01
- Streaming ZIP download → v2 PERF-02
- Rate limiting per token → v2 ROB-02
- Visual redesign of progress UI → Phase 4 UI-01..03
- Mobile-friendly drag-drop fallback → Phase 4 UI-05
- Symlink-escape hardening in safePath → v2 ROB-03
- Tests → v2 TEST-01..02
- Bundling tiny files into multipart batches → perf follow-up if measurements warrant
