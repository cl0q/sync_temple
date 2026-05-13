# Roadmap: sync_temple — M1 "robust"

## Overview

Four phases that take sync_temple from a working-but-fragile prototype to a reliable daily-driver. Phase 1 fixes the critical upload bug that blocks actual usage. Phase 2 replaces the Python CLI with a proper Go binary. Phase 3 ships the release pipeline and CLI UX polish. Phase 4 rounds out the web UI with visual design and mobile support. Phases 2-4 can be sequenced once Phase 1 is done.

## Phases

- [x] **Phase 1: Upload Reliability** - Fix the browser upload bug and harden the server — restores core value (completed 2026-05-12)
- [ ] **Phase 2: CLI Rewrite** - Port CLI from Python to Go with correct path handling and server preflight checks
- [ ] **Phase 3: CLI Release Pipeline** - Cross-compile, GitHub Actions, distribution, and UX polish
- [ ] **Phase 4: Web UI Polish** - Visual design, actionable errors, download progress, and mobile support

## Phase Details

### Phase 1: Upload Reliability
**Goal**: Users can upload folders of any size (including 500+ files) through the web UI without connection drops, with visible progress and automatic retry on transient failures, backed by a server that enforces sane limits and cleans up after itself
**Depends on**: Nothing (first phase)
**Requirements**: UPLOAD-01, UPLOAD-02, UPLOAD-03, UPLOAD-04, UPLOAD-05, UPLOAD-06, UPLOAD-07
**Success Criteria** (what must be TRUE):
  1. User drags a folder with 500+ files onto the UI and every file uploads successfully without WebKitBlobResource errors or connection drops
  2. User can see per-file progress and an overall progress bar while upload is running
  3. When a transient network error occurs, the upload retries automatically (up to 3 times) before surfacing the failure
  4. User can resume an interrupted upload from where it left off rather than starting over
  5. Server rejects oversized requests with HTTP 413 and leaves no empty or partial files behind
**Plans**: 3 plans
- [ ] 01-PLAN.md — Server-side hardening: MaxBytesReader, atomic writes via .tmp+rename, per-file timeout, JSON error responses, extended response shape (UPLOAD-06, UPLOAD-07, UPLOAD-01 server-side)
- [ ] 02-PLAN.md — Per-file upload queue with concurrency=4, exponential-backoff retry, AbortController cancel, two-tier progress UI, JSON error parsing in api() (UPLOAD-01, UPLOAD-02, UPLOAD-03, UPLOAD-04)
- [ ] 03-PLAN.md — localStorage-backed resume mechanism with Resume button, re-diff against saved manifest, auto-clear on success (UPLOAD-05)
**UI hint**: partial

### Phase 01.1: Token Persistence (INSERTED)

**Goal:** Server token survives restarts (via SYNC_TEMPLE_TOKEN env var OR a `<dataDir>/.token` file with mode 0600) so the browser session stays valid across server restarts. Frontend handles 401 by clearing the stale token and re-prompting once, instead of spamming N parallel error rows. MANUAL.md documents the env var.
**Depends on:** Phase 1
**Requirements**: TOKEN-01..04 (to be defined during planning)
**Success Criteria** (what must be TRUE):
  1. Server restart with no `--token` flag re-uses the previous token (from `<dataDir>/.token`) — existing browser session still works
  2. Setting `SYNC_TEMPLE_TOKEN=...` in the environment overrides the file and the auto-generation
  3. CLI flag `--token` still wins over env var and file (precedence: flag > env > file > auto-generate)
  4. When the server returns 401, the browser clears `sessionStorage.sync_token` and prompts the user once — not N times in parallel
  5. The `.token` file is created with mode 0600 and lives only inside the data dir (never tracked in git)
**Plans:** 1/0 plans complete

Plans:
- [x] TBD (run /gsd-plan-phase 01.1 to break down) (completed 2026-05-13)

### Phase 2: CLI Rewrite
**Goal**: The Python CLI is replaced by a compiled Go binary that resolves paths correctly, validates server connectivity before touching files, and carries a version identifier
**Depends on**: Phase 1
**Requirements**: CLI-01, CLI-02, CLI-03, CLI-07
**Success Criteria** (what must be TRUE):
  1. User runs `sync --version` and gets a semver string (e.g., v1.0.0)
  2. User runs `sync push a ~/projects/foo` and all files upload correctly with `~` expanded and relative paths resolved against `pwd`
  3. User runs `sync push a ./dir` with an unreachable server URL and gets a clear failure message before any file I/O begins
  4. Existing `SYNC_TEMPLE_URL` / `SYNC_TEMPLE_TOKEN` env vars work without any changes
**Plans**: TBD

### Phase 3: CLI Release Pipeline
**Goal**: The Go CLI binary is built and distributed automatically via GitHub Actions for all four target platforms, with colored output and structured help text that makes the tool pleasant to use
**Depends on**: Phase 2
**Requirements**: CLI-04, CLI-05, CLI-06
**Success Criteria** (what must be TRUE):
  1. Pushing a git tag triggers a GitHub Actions workflow that produces release binaries for macOS-arm64, macOS-amd64, Linux-amd64, and FreeBSD-amd64
  2. User can download the binary from GitHub Releases and run it without installing any runtime or dependency
  3. User runs `sync --help` and sees organized subcommand help with clear flag descriptions
  4. Terminal output uses color and progress indicators on TTY and degrades cleanly to plain text when piped
**Plans**: TBD

### Phase 4: Web UI Polish
**Goal**: The web UI has a coherent visual identity, surfaces actionable error messages, shows download progress, and works correctly on mobile devices
**Depends on**: Phase 1
**Requirements**: UI-01, UI-02, UI-03, UI-04, UI-05
**Success Criteria** (what must be TRUE):
  1. UI has a distinct visual character: consistent typography, spacing, and a dark-mode-capable color scheme that goes beyond "bare HTML"
  2. When an upload fails with HTTP 413, the user sees a human-readable message with an action hint (not just "Error: HTTP 413")
  3. User can click a "Retry" button on any failed upload item without re-selecting the entire folder
  4. User can see download progress as a percentage while a ZIP is being streamed
  5. On a smartphone, the drag-drop zone falls back to a file picker that works correctly and the layout does not break
**Plans**: TBD
**UI hint**: yes

## Progress

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. Upload Reliability | 3/3 | Complete   | 2026-05-12 |
| 2. CLI Rewrite | 0/? | Not started | - |
| 3. CLI Release Pipeline | 0/? | Not started | - |
| 4. Web UI Polish | 0/? | Not started | - |

---
*Roadmap created: 2026-05-11 — Milestone M1 "robust"*
