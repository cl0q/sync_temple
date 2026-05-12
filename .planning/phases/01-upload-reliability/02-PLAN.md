---
phase: 01-upload-reliability
plan: 02
type: execute
wave: 1
depends_on: []
files_modified:
  - static/index.html
autonomous: true
requirements:
  - UPLOAD-01
  - UPLOAD-02
  - UPLOAD-03
  - UPLOAD-04
user_setup: []

must_haves:
  truths:
    - "D-01: Browser uploads a folder with 500+ files without WebKitBlobResource error 4 or connection drops"
    - "D-01: At most UPLOAD_CONCURRENCY=4 fetch POST requests to /api/{ch}/upload are in flight at any moment"
    - "D-02: The old BATCH_MAX 15 MB size-batching loop is fully removed from uploadFiles"
    - "D-03: On HTTP 5xx, HTTP 408, or network error, a failed file is retried with delays 1s/3s/10s for up to 3 attempts before being marked failed"
    - "D-03: On HTTP 4xx other than 408, the file is marked failed immediately without retry"
    - "D-04: Cancelling the upload aborts in-flight requests and prevents queued retries from firing"
    - "D-08: User sees per-file rows with states pending/uploading/done/failed/retrying AND an overall progress bar showing files-done / files-total"
    - "D-09: Progress DOM updates are throttled to ~200 ms with a requestAnimationFrame-backed bar update"
    - "D-11: api() helper parses structured JSON error bodies (Content-Type sniff) with text fallback, exposing .status and .code on the thrown Error"
    - "D-16: UPLOAD_CONCURRENCY = 4 constant lives near the top of the UI script block"
  artifacts:
    - path: "static/index.html"
      provides: "Per-file upload queue with concurrency control (D-01)"
      contains: "UPLOAD_CONCURRENCY"
    - path: "static/index.html"
      provides: "Per-file retry with exponential backoff (D-03)"
      contains: "uploadOneFile"
    - path: "static/index.html"
      provides: "Per-file + overall progress UI styled consistently with the picker (D-08)"
      contains: "renderUploadProgress"
    - path: "static/index.html"
      provides: "JSON-or-text error parsing in api() helper (D-11)"
      contains: "application/json"
  key_links:
    - from: "static/index.html:uploadFiles"
      to: "queue worker pool"
      via: "spawns UPLOAD_CONCURRENCY workers that pull from the pending queue"
      pattern: "UPLOAD_CONCURRENCY"
    - from: "static/index.html:uploadOneFile"
      to: "fetch with AbortController + backoff"
      via: "retry loop with delays [1000, 3000, 10000]"
      pattern: "RETRY_DELAYS|\\[1000,\\s*3000,\\s*10000\\]"
    - from: "static/index.html:api"
      to: "structured JSON error"
      via: "Content-Type sniff -> parse JSON {error, code}"
      pattern: "application/json"
---

<objective>
Rewrite `uploadFiles` in `static/index.html` (currently lines 631-712) to replace the existing 15 MB batch-by-size loop (`BATCH_MAX = 15 * 1024 * 1024`) with a per-file queue + worker pool (concurrency = 4), add per-file retry with exponential backoff (1s / 3s / 10s, max 3 attempts, retry on network/5xx/408, NO retry on other 4xx), upgrade `api()` (line 251) to parse structured JSON errors with text fallback (D-11), and add a two-tier progress UI (per-file rows + overall bar) whose styling matches the existing `.tree-row` vocabulary used by the picker modal. Delivers UPLOAD-01, UPLOAD-02, UPLOAD-03, UPLOAD-04. Out of scope: resume from localStorage (Plan 03), visual polish (Phase 4), changes to the picker itself.

Purpose: The WIP commit already shipped the picker flow (drop → `openPicker(ch, files)` → `confirmPicker()` → `uploadFiles(ch, selected)`) and the picker UI uses a rich tree styling vocabulary (`.tree`, `.tree-row`, `.tree-children`, `.caret`, `.meta`, etc.) defined around lines 53-69. But `uploadFiles` itself (line 631) still dispatches the selected file set through a `BATCH_MAX = 15 MB` FormData accumulator with one or two giant multipart POSTs. With 500+ files this collapses the WebKit connection pool (`WebKitBlobResource error 4`). Replacing that loop with a small worker pool + per-file POSTs + retry + AbortController + a progress UI that uses the SAME monospace/colour-token vocabulary as the picker tree directly solves the reliability bug and gives the user something to look at while 500 files upload — and feels native rather than bolted on.

Output: Modified `static/index.html` — single file. New `UPLOAD_CONCURRENCY` + `RETRY_DELAYS` constants, new `uploadOneFile`, new `runUploadQueue`, new `renderUploadProgress` (+ small helpers `shouldRetry`, `abortableSleep`, `scheduleProgressRender`, `updateProgressBar`, `showUploadProgress`, `hideUploadProgress`, `cancelUpload`), rewritten `uploadFiles` body, rewritten `api()` body, new CSS rules that share the picker's color tokens (`var(--accent)`, `var(--danger)`, `var(--dim)`, `var(--success)`, `#d29922`) and monospace font stack. No new HTML files, no new HTTP endpoints, no changes to the picker (`openPicker`, `confirmPicker`, `renderRow`, etc.).
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
@static/index.html

<interfaces>
<!-- Key contracts extracted from the CURRENT static/index.html (post-WIP). -->

Existing flow — PRESERVE unchanged:
```
drop event (line 235-240)  ─┐
input change  (line 241-245) ┴─> openPicker(ch, files)  (line 379)
                                  → picker modal (HTML at line 152-169, CSS at 53-69)
                                  → confirmPicker()  (line 622)
                                  → await uploadFiles(ch, selected)  (line 626)
```
`uploadFiles(ch, files)` signature stays the same; only its internals change.

Existing helpers — reuse, do not duplicate:
```js
async function api(method, path, body, extraHeaders)  // line 251 — rewrite body for JSON-error parsing
async function sha256(buffer)                          // line 304
function refreshFiles(ch)                              // line 716
function esc(s)                                        // line 731
function fmtBytes(n)                                   // line 468
```

Existing styling vocabulary the new progress UI MUST share (from style block lines 7-72):
- Color tokens: `var(--bg) #0d1117`, `var(--surface) #161b22`, `var(--border) #30363d`, `var(--text) #c9d1d9`, `var(--dim) #8b949e`, `var(--accent) #58a6ff`, `var(--danger) #f85149`, `var(--success) #3fb950`, plus the warning yellow `#d29922` used at line 66 for `.meta.big`.
- Monospace stack: `'SF Mono','Fira Code','Cascadia Code',monospace` (used in `.tree` line 57 and `.text-section textarea` line 43).
- Picker tree rows: `.tree-row` (line 58) is the visual reference — flex row, `padding:1px 4px`, `border-radius:3px`, hover tint via `rgba(88,166,255,.06)` (line 59). The new per-file upload rows should feel like a sibling: same monospace, same row padding/radius, same hover treatment, same meta-column color discipline (dim for neutral, accent for active, success/danger/warning for terminal/transient states).

Server contract from Plan 01 (Wave 1 sibling — code against this contract, do not wait):
- Each `POST /api/{ch}/upload` is now ONE file as multipart with form-field name = the relative path (server's `safePath` already accepts the form-field name as the destination path; see main.go line 253 `part.FormName()`).
- Successful response: `{"uploaded": 1, "failed": 0, "errors": []}` (extended shape, additive over the WIP's `{"uploaded": N}`).
- Error response on size cap: HTTP 413, `Content-Type: application/json`, body `{"error": "...", "code": "SIZE_LIMIT"}`.
- Error response on per-file timeout / internal: HTTP 200 with `{"uploaded": 0, "failed": 1, "errors": [{"file": "...", "code": "TIMEOUT", ...}]}`. Client treats `r.uploaded === 0 && r.failed >= 1` after a 200 response as a retriable in-band failure if any of the errors has `code in {TIMEOUT, INTERNAL}`.
- Error response on bad request: HTTP 400, JSON, `code: "BAD_REQUEST"` — NOT retriable.

Module-level state added by this plan (D-01, D-03, D-16):
```js
const UPLOAD_CONCURRENCY = 4;
const RETRY_DELAYS = [1000, 3000, 10000];
let uploadController = null;   // current AbortController, or null when idle
let uploadProgress = null;     // { ch, total, done, failed, files: Map<path, {state, attempt, error}> }
let uploadRenderScheduled = false;
```

Per-file state values (D-08): `'pending' | 'uploading' | 'done' | 'failed' | 'retrying'`.

Progress UI placement decision (within Claude's Discretion per CONTEXT.md):
The progress container is a NEW per-channel `<div class="upload-progress" id="upload-progress-{ch}">` inserted immediately AFTER the existing `<div class="status-bar" id="status-{ch}"></div>` (line 100 for channel a, line 121 for channel b). This keeps progress inline with the channel column where the user currently looks for status, and stays out of the picker modal — the picker is for pre-upload selection; once `confirmPicker` fires the modal closes and the user's attention moves to the inline progress.
</interfaces>
</context>

<tasks>

<task type="auto" tdd="false">
  <name>Task 1: Upgrade api() to parse JSON errors, add upload progress DOM + CSS, and replace uploadFiles internals with per-file queue + retry</name>
  <files>static/index.html</files>
  <read_first>
    - static/index.html (entire file — single 810-line file, post-WIP)
    - .planning/phases/01-upload-reliability/01-CONTEXT.md §Decisions D-01..D-11, D-16
    - .planning/codebase/CONCERNS.md §"Browser Upload Bug: WebKitBlobResource Error 4 on Large Folder Uploads"
  </read_first>
  <behavior>
    - `api()` returns a structured Error on `!resp.ok`: parses JSON body when `Content-Type: application/json`, else falls back to text. Error carries `.status` (HTTP code) and `.code` (machine code string, possibly undefined). Network errors thrown by fetch bubble unchanged (no `.status` property — that's the signal for "retry").
    - `api()` accepts an optional `AbortSignal` via `extraHeaders.__signal`; the signal is moved to `opts.signal` and the `__signal` key is removed before fetch (so it is never sent on the wire).
    - `uploadFiles(ch, files)` keeps the hash + diff phase (existing behavior at lines 636-668), then dispatches the upload set through `runUploadQueue` with concurrency 4 INSTEAD OF the BATCH_MAX loop (lines 670-703 in the current file — these lines are fully removed).
    - `runUploadQueue` spawns exactly `UPLOAD_CONCURRENCY` workers that pull from a shared pending list via a closure index counter (NOT `Promise.all` on the full set). Workers exit when the queue is drained OR the AbortController is aborted.
    - `uploadOneFile(ch, entry, signal)` POSTs ONE file per request as multipart, form-field name = `entry.path`, body = `entry.file`. Returns on 200 with `uploaded === 1`, else throws.
    - Retry loop inside `uploadOneFile`: up to 3 retry attempts (4 total tries). Retry triggers on (a) thrown Error with no `.status` (network error), (b) `.status >= 500`, (c) `.status === 408`, (d) HTTP 200 but `r.uploaded === 0 && (r.errors[0]?.code === 'TIMEOUT' || r.errors[0]?.code === 'INTERNAL')`. NO retry on other 4xx — those mark the file failed immediately.
    - Between attempts: `await abortableSleep(RETRY_DELAYS[attempt-1], signal)` where attempt index 1 → 1000ms, 2 → 3000ms, 3 → 10000ms (D-03). The sleep MUST abort if `signal.aborted` becomes true.
    - Progress UI styling: a new CSS block uses the SAME color tokens and monospace stack as `.tree-row` (D-08 explicitly cites tree-style reuse). Per-file rows visually mirror `.tree-row` — same row padding (`1px 0`/`1px 4px`), same monospace font family, same color discipline. State badges use `var(--accent)` for uploading, `var(--success)` for done, `var(--danger)` for failed, `#d29922` for retrying (matching the picker's `.meta.big` warning color at line 66), `var(--dim)` for pending. This keeps the new rows feeling native to the picker vocabulary.
    - Progress UI placement: a new `<div class="upload-progress" id="upload-progress-{ch}">` container inserted immediately after each `<div class="status-bar" id="status-{ch}"></div>`. Container holds: an overall `<progress>` bar (max=total, value=done+failed), a counts/percentage label, a scrollable `<div class="upload-files">` with `.uf-row` rows for each file, and a Cancel button. Updates throttled to ~200 ms via `setTimeout` for the file list, plus `requestAnimationFrame` for the overall bar (D-09).
    - On full completion (queue drained, all workers exited): refresh the file list via `refreshFiles(ch)`. If `failed === 0`, hide the progress container (success path); otherwise leave it visible so the user can see which files failed. Clear `uploadController`.
    - On abort: leave per-file rows in their last state; in-flight rows transition to 'failed' with `error = 'cancelled'`. No further DOM updates after abort. Plan 03 will wire the Resume button against this state.
  </behavior>
  <action>
    This task makes 6 surgical edits to `static/index.html`. Apply them in order. Use the Edit tool (not Write) since the file is large.

    **Edit A — Add constants and module state. Insert after line 204 (just after `let eventSources = {};` and before the `// --- Auth ---` comment at line 206):**

    ```js
    // --- Upload tuning constants (D-01, D-03, D-16) ---
    const UPLOAD_CONCURRENCY = 4;
    const RETRY_DELAYS = [1000, 3000, 10000];
    let uploadController = null;   // AbortController for the active upload, or null
    let uploadProgress = null;     // { ch, total, done, failed, files: Map }
    let uploadRenderScheduled = false;
    ```

    **Edit B — Add CSS rules consistent with the picker's `.tree-row` vocabulary. Append these rules to the existing `<style>` block, immediately BEFORE the `@media(max-width:768px)` rule at line 71. Use the same color tokens, monospace font, and row geometry that `.tree-row` already uses:**

    ```css
    .upload-progress{margin:6px 0;font-size:12px;display:none}
    .upload-progress.active{display:block}
    .upload-progress progress{width:100%;height:6px}
    .upload-progress .label{display:flex;justify-content:space-between;color:var(--dim);margin:4px 0;font-size:11px}
    .upload-progress .upload-files{max-height:200px;overflow-y:auto;background:var(--bg);border:1px solid var(--border);border-radius:6px;padding:6px;font-family:'SF Mono','Fira Code','Cascadia Code',monospace;font-size:12px;line-height:1.6}
    .upload-progress .uf-row{display:flex;align-items:center;gap:8px;padding:1px 4px;border-radius:3px;white-space:nowrap}
    .upload-progress .uf-row:hover{background:rgba(88,166,255,.06)}
    .upload-progress .uf-row .p{flex:1;overflow:hidden;text-overflow:ellipsis;color:var(--dim)}
    .upload-progress .uf-row .s{flex-shrink:0;font-size:10px;padding:1px 6px;border-radius:3px;border:1px solid var(--border)}
    .upload-progress .uf-row .s.pending{color:var(--dim)}
    .upload-progress .uf-row .s.uploading{color:var(--accent);border-color:var(--accent)}
    .upload-progress .uf-row .s.done{color:var(--success);border-color:var(--success)}
    .upload-progress .uf-row .s.failed{color:var(--danger);border-color:var(--danger)}
    .upload-progress .uf-row .s.retrying{color:#d29922;border-color:#d29922}
    .upload-progress .upload-actions{margin-top:6px;display:flex;gap:8px;justify-content:flex-end}
    ```

    Note: This CSS deliberately mirrors `.tree-row` (line 58) — same `display:flex;align-items:center;gap:?;padding:1px 4px;border-radius:3px;white-space:nowrap`, same monospace stack, same hover tint `rgba(88,166,255,.06)`, same border-token discipline. A reviewer should be able to read it as "this is the same visual family as the picker tree".

    **Edit C — Add the progress container DOM. For channel A, find the line `<div class="status-bar" id="status-a"></div>` (currently line 100) and insert IMMEDIATELY AFTER it:**

    ```html
          <div class="upload-progress" id="upload-progress-a">
            <progress id="upload-bar-a" value="0" max="1"></progress>
            <div class="label"><span id="upload-counts-a">0 / 0</span><span id="upload-pct-a">0%</span></div>
            <div class="upload-files" id="upload-files-a"></div>
            <div class="upload-actions"><button onclick="cancelUpload('a')" class="danger" id="upload-cancel-a">Cancel</button></div>
          </div>
    ```

    For channel B, find `<div class="status-bar" id="status-b"></div>` (currently line 121) and insert the same block with `a` replaced by `b`.

    **Edit D — Replace the body of `api()` (currently `static/index.html:251-268`). New function, verbatim:**

    ```js
    async function api(method, path, body, extraHeaders) {
      const headers = { 'Authorization': 'Bearer ' + token };
      if (extraHeaders) Object.assign(headers, extraHeaders);
      const opts = { method, headers };
      if (body !== undefined) {
        if (body instanceof FormData) {
          opts.body = body;
        } else if (typeof body === 'object' && !(body instanceof Blob)) {
          opts.body = JSON.stringify(body);
          headers['Content-Type'] = 'application/json';
        } else {
          opts.body = body;
        }
      }
      if (headers.__signal) {
        opts.signal = headers.__signal;
        delete headers.__signal;
      }
      const resp = await fetch(path, opts);
      if (!resp.ok) {
        const ct = resp.headers.get('Content-Type') || '';
        if (ct.startsWith('application/json')) {
          let payload;
          try { payload = await resp.json(); } catch (_) { payload = {}; }
          const e = new Error(payload.error || ('HTTP ' + resp.status));
          e.status = resp.status;
          e.code = payload.code;
          throw e;
        }
        let txt = '';
        try { txt = await resp.text(); } catch (_) { /* ignore */ }
        const e = new Error('HTTP ' + resp.status + (txt ? ': ' + txt.slice(0, 200) : ''));
        e.status = resp.status;
        throw e;
      }
      return resp;
    }
    ```

    **Edit E — Replace `uploadFiles` (currently `static/index.html:631-712`). New function, verbatim:**

    ```js
    async function uploadFiles(ch, files) {
      const status = document.getElementById('status-' + ch);
      status.style.color = '';

      // Cancel any in-flight upload on the same channel
      if (uploadController) {
        try { uploadController.abort(); } catch (_) {}
      }
      uploadController = new AbortController();

      try {
        // Hash
        status.textContent = 'Hashing ' + files.length + ' files...';
        const manifest = {};
        let hashErrors = 0;
        const skippedFiles = [];
        for (let i = 0; i < files.length; i++) {
          if (uploadController.signal.aborted) throw new Error('cancelled');
          try {
            manifest[files[i].path] = await sha256(await files[i].file.arrayBuffer());
          } catch (e) {
            hashErrors++;
            skippedFiles.push(files[i].path);
            console.warn('Hash error for', files[i].path, e);
          }
          if (i % 10 === 0 || i === files.length - 1) {
            status.textContent = 'Hashing ' + (i+1) + '/' + files.length + '...';
            await new Promise(r => setTimeout(r, 0));
          }
        }
        if (hashErrors > 0) {
          console.warn('Skipped files due to I/O errors:', skippedFiles);
        }

        // Diff
        status.textContent = 'Computing diff...';
        const diff = await api('POST', '/api/' + ch + '/diff', { files: manifest }).then(r => r.json());
        const toUpload = [...(diff.client_only||[]), ...(diff.different||[])];
        const same = diff.same || 0;

        if (toUpload.length === 0) {
          status.textContent = 'No changes. ' + same + ' files identical.';
          status.style.color = 'var(--success)';
          uploadController = null;
          return;
        }

        // Build upload set as [{path, file}]
        const uploadSet = [];
        for (const p of toUpload) {
          const entry = files.find(f => f.path === p);
          if (entry) uploadSet.push(entry);
        }

        // Init progress
        uploadProgress = {
          ch,
          total: uploadSet.length,
          done: 0,
          failed: 0,
          files: new Map(uploadSet.map(e => [e.path, { state: 'pending', attempt: 0, error: '' }])),
        };
        showUploadProgress(ch);
        renderUploadProgress();

        // Run the queue (per-file POSTs, UPLOAD_CONCURRENCY workers — D-01)
        status.textContent = 'Uploading ' + uploadSet.length + ' files...';
        await runUploadQueue(ch, uploadSet, uploadController.signal);

        // Summary
        const okCount = uploadProgress.done;
        const failCount = uploadProgress.failed;
        if (failCount === 0) {
          status.textContent = okCount + ' uploaded, ' + same + ' unchanged';
          status.style.color = 'var(--success)';
          hideUploadProgress(ch);
        } else {
          status.textContent = okCount + ' uploaded, ' + failCount + ' failed, ' + same + ' unchanged';
          status.style.color = 'var(--danger)';
          // Keep progress UI visible so the user can see which files failed.
        }
        refreshFiles(ch);
      } catch (err) {
        if (err.message === 'cancelled' || uploadController?.signal.aborted) {
          status.textContent = 'Upload cancelled.';
          status.style.color = 'var(--danger)';
        } else {
          status.textContent = 'Error: ' + err.message;
          status.style.color = 'var(--danger)';
        }
      } finally {
        uploadController = null;
      }
    }
    ```

    **Edit F — Add the queue runner, single-file uploader, progress renderer, and cancel helper. Insert these IMMEDIATELY AFTER `uploadFiles` (i.e. after the closing `}` of the function inserted by Edit E, before the `// --- Channel ops ---` comment at line 714):**

    ```js
    // --- Upload queue + retry (Plan 02, D-01..D-04, D-08..D-09) ---

    async function runUploadQueue(ch, uploadSet, signal) {
      let cursor = 0;
      async function worker() {
        while (true) {
          if (signal.aborted) return;
          const idx = cursor++;
          if (idx >= uploadSet.length) return;
          const entry = uploadSet[idx];
          try {
            await uploadOneFile(ch, entry, signal);
            const st = uploadProgress.files.get(entry.path);
            st.state = 'done';
            uploadProgress.done++;
          } catch (err) {
            const st = uploadProgress.files.get(entry.path);
            st.state = 'failed';
            st.error = err.message || String(err);
            uploadProgress.failed++;
          }
          scheduleProgressRender();
        }
      }
      const workers = [];
      for (let i = 0; i < UPLOAD_CONCURRENCY; i++) workers.push(worker());
      await Promise.all(workers);
      // Force a final flush
      renderUploadProgress();
    }

    async function uploadOneFile(ch, entry, signal) {
      const path = entry.path;
      const st = uploadProgress.files.get(path);
      for (let attempt = 1; attempt <= RETRY_DELAYS.length + 1; attempt++) {
        if (signal.aborted) throw new Error('cancelled');
        st.attempt = attempt;
        st.state = attempt === 1 ? 'uploading' : 'retrying';
        scheduleProgressRender();

        const fd = new FormData();
        fd.append(path, entry.file);
        let r;
        try {
          const resp = await api('POST', '/api/' + ch + '/upload', fd, { __signal: signal });
          r = await resp.json();
        } catch (err) {
          if (signal.aborted || err.name === 'AbortError') throw new Error('cancelled');
          // Retry decision
          if (shouldRetry(err) && attempt <= RETRY_DELAYS.length) {
            st.error = err.message;
            await abortableSleep(RETRY_DELAYS[attempt - 1], signal);
            continue;
          }
          throw err;
        }
        // 200 OK + uploaded:1 → success
        if ((r.uploaded || 0) >= 1) {
          return;
        }
        // 200 OK but server reports in-band failure
        const firstErr = (r.errors && r.errors[0]) || {};
        const inBandRetriable = firstErr.code === 'TIMEOUT' || firstErr.code === 'INTERNAL';
        if (inBandRetriable && attempt <= RETRY_DELAYS.length) {
          st.error = firstErr.message || firstErr.code || 'server failure';
          await abortableSleep(RETRY_DELAYS[attempt - 1], signal);
          continue;
        }
        // Non-retriable in-band failure → throw
        const e = new Error(firstErr.message || firstErr.code || 'upload failed');
        e.code = firstErr.code;
        throw e;
      }
      throw new Error('retries exhausted');
    }

    function shouldRetry(err) {
      // No .status => network error (fetch threw). Retry.
      if (err.status === undefined) return true;
      if (err.status >= 500) return true;
      if (err.status === 408) return true;
      // 4xx other than 408: no retry (D-03).
      return false;
    }

    function abortableSleep(ms, signal) {
      return new Promise((resolve, reject) => {
        if (signal.aborted) return reject(new Error('cancelled'));
        const t = setTimeout(() => {
          signal.removeEventListener('abort', onAbort);
          resolve();
        }, ms);
        function onAbort() {
          clearTimeout(t);
          signal.removeEventListener('abort', onAbort);
          reject(new Error('cancelled'));
        }
        signal.addEventListener('abort', onAbort);
      });
    }

    function scheduleProgressRender() {
      if (uploadRenderScheduled) return;
      uploadRenderScheduled = true;
      // ~200ms throttle for the file list; rAF for the bar (D-09).
      setTimeout(() => {
        uploadRenderScheduled = false;
        renderUploadProgress();
      }, 200);
      requestAnimationFrame(() => updateProgressBar());
    }

    function updateProgressBar() {
      if (!uploadProgress) return;
      const ch = uploadProgress.ch;
      const bar = document.getElementById('upload-bar-' + ch);
      if (!bar) return;
      bar.max = uploadProgress.total;
      bar.value = uploadProgress.done + uploadProgress.failed;
    }

    function renderUploadProgress() {
      if (!uploadProgress) return;
      const ch = uploadProgress.ch;
      updateProgressBar();
      const counts = document.getElementById('upload-counts-' + ch);
      const pct = document.getElementById('upload-pct-' + ch);
      const list = document.getElementById('upload-files-' + ch);
      if (!counts || !list) return;
      const done = uploadProgress.done;
      const failed = uploadProgress.failed;
      const total = uploadProgress.total;
      counts.textContent = (done + failed) + ' / ' + total + ' files' + (failed ? ' (' + failed + ' failed)' : '');
      pct.textContent = total ? Math.floor(((done + failed) / total) * 100) + '%' : '0%';
      const rows = [];
      for (const [path, st] of uploadProgress.files) {
        const label = st.state === 'retrying'
          ? 'retrying ' + st.attempt + '/' + (RETRY_DELAYS.length + 1)
          : st.state;
        rows.push('<div class="uf-row"><span class="p">' + esc(path) + '</span><span class="s ' + st.state + '">' + esc(label) + '</span></div>');
      }
      list.innerHTML = rows.join('');
    }

    function showUploadProgress(ch) {
      const el = document.getElementById('upload-progress-' + ch);
      if (el) el.classList.add('active');
    }

    function hideUploadProgress(ch) {
      const el = document.getElementById('upload-progress-' + ch);
      if (el) el.classList.remove('active');
    }

    function cancelUpload(ch) {
      if (uploadController && uploadProgress && uploadProgress.ch === ch) {
        uploadController.abort();
      }
    }
    ```

    After all edits, the file MUST still validate as parseable HTML and the Go binary must still embed it cleanly:
    ```
    cd /Users/olli/schenanigans/sync_temple && go build -o /tmp/sync-temple-plan02 ./...
    ```
  </action>
  <verify>
    <automated>cd /Users/olli/schenanigans/sync_temple &amp;&amp; go build -o /tmp/sync-temple-plan02 ./... &amp;&amp; grep -c 'const UPLOAD_CONCURRENCY = 4' static/index.html &amp;&amp; grep -c 'const RETRY_DELAYS = \[1000, 3000, 10000\]' static/index.html &amp;&amp; grep -c 'function uploadOneFile' static/index.html &amp;&amp; grep -c 'function runUploadQueue' static/index.html &amp;&amp; grep -c 'function renderUploadProgress' static/index.html &amp;&amp; grep -c 'function shouldRetry' static/index.html &amp;&amp; grep -c 'new AbortController' static/index.html &amp;&amp; grep -c 'upload-progress-a' static/index.html &amp;&amp; grep -c 'upload-progress-b' static/index.html &amp;&amp; [ "$(grep -c 'BATCH_MAX' static/index.html)" = "0" ]</automated>
  </verify>
  <acceptance_criteria>
    - `grep -c 'const UPLOAD_CONCURRENCY = 4' static/index.html` returns exactly 1
    - `grep -c 'const RETRY_DELAYS = \[1000, 3000, 10000\]' static/index.html` returns exactly 1
    - `grep -c 'function uploadOneFile' static/index.html` returns exactly 1
    - `grep -c 'function runUploadQueue' static/index.html` returns exactly 1
    - `grep -c 'function renderUploadProgress' static/index.html` returns exactly 1
    - `grep -c 'function shouldRetry' static/index.html` returns exactly 1
    - `grep -c 'function abortableSleep' static/index.html` returns exactly 1
    - `grep -c 'function cancelUpload' static/index.html` returns exactly 1
    - `grep -c 'new AbortController' static/index.html` returns at least 1
    - `grep -c 'BATCH_MAX' static/index.html` returns exactly 0 (old batch logic fully removed — both the constant and the 15 MB loop)
    - `grep -c 'id="upload-progress-a"' static/index.html` returns exactly 1
    - `grep -c 'id="upload-progress-b"' static/index.html` returns exactly 1
    - `grep -c "opts.signal = headers.__signal" static/index.html` returns exactly 1
    - `grep -c "e.code = payload.code" static/index.html` returns exactly 1
    - `grep -c "'SF Mono','Fira Code','Cascadia Code',monospace" static/index.html` returns at least 2 (one for existing `.tree`, one for new `.upload-files`)
    - `grep -c "rgba(88,166,255,.06)" static/index.html` returns at least 2 (one for existing `.tree-row:hover`, one for new `.uf-row:hover`)
    - `go build -o /tmp/sync-temple-plan02 ./...` exits with status 0 (embedded HTML still embeds cleanly)
    - Manual smoke (executor MUST run): start the server, open the UI in Chrome/Safari, drag a folder with at least 50 files, confirm in DevTools Network panel that no more than 4 concurrent POST /api/a/upload requests are ever in flight. (Count via DevTools "Network" filter on `upload`.)
    - Manual smoke (executor MUST run): stop the server mid-upload (kill the binary). Confirm in the UI that affected file rows transition to 'retrying' state showing `attempt N/4`, and after 3 retries the rows show 'failed'. Restart server, confirm no further activity (no new requests fire after the failure terminus).
    - Manual smoke (executor MUST run): click Cancel during an upload. Confirm in DevTools Network panel that in-flight requests show "(canceled)" and no further requests fire.
    - Visual sanity (executor MUST eyeball): the upload progress rows look visually consistent with the picker tree rows — same monospace font, same hover tint, same color discipline for state badges. If they look "bolted on", the CSS in Edit B needs another pass.
  </acceptance_criteria>
  <done>
    `uploadFiles` no longer batches by 15 MB; uploads one file per request through a 4-worker pool; failed files retry on transient errors with 1s/3s/10s backoff up to 3 retries; the user sees a progress container with overall bar + per-file rows styled in the same visual family as the picker tree and can cancel; `api()` parses JSON errors and exposes `.status` + `.code` for retry classification; server still receives requests in the existing multipart shape (form-field name = path).
  </done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| browser fetch → server | Same as today; auth header carries token. |
| user input (file paths) → DOM rendering | New per-file rows render paths via `esc()` to prevent HTML injection. |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-01-07 | T (Tampering) | upload-files DOM list — user-supplied filenames | mitigate | `esc()` (existing helper at static/index.html:731) is applied to `path` and to status label before innerHTML write. |
| T-01-08 | D (DoS) | retry storm against a failing server | mitigate | Bounded retry (3 attempts) with monotonic backoff 1s/3s/10s; AbortController stops retries on user cancel. |
| T-01-09 | I (Info Disclosure) | error messages echo server-supplied `error` string | accept | Server controls its own error wording; this is a self-hosted single-tenant tool, no untrusted server. |
| T-01-10 | S (Spoofing) | __signal header smuggling via api() | mitigate | __signal key is moved to opts.signal then deleted from headers before fetch — never sent on the wire. |
</threat_model>

<verification>
- Build the binary: `go build -o /tmp/sync-temple ./...` succeeds.
- Open the UI, drag a folder of 500+ small files. All files reach 'done' state. No WebKitBlobResource error in DevTools console. No connection drops in Network panel.
- DevTools Network panel: peak concurrent `POST /api/{ch}/upload` is exactly 4.
- Server is stopped mid-upload: affected file rows enter 'retrying' state with visible attempt counter, then 'failed' after 3 retries.
- Cancel button: aborts in-flight requests and stops further activity.
- Visual: upload progress rows look like siblings of the picker tree rows (same monospace, same hover, same color discipline).
- Existing CLI smoke: `python3 sync push a /tmp/somedir` (or whatever the user runs) still returns success because server response keeps `uploaded` field (Plan 01 D-17 compat).
</verification>

<success_criteria>
- All `<acceptance_criteria>` grep counts pass and `go build` succeeds.
- All three manual smoke tests pass (concurrency cap, retry visible, cancel works).
- Visual sanity check passes (rows feel native, not bolted-on).
- UPLOAD-01, UPLOAD-02, UPLOAD-03, UPLOAD-04 marked satisfied by this plan.
</success_criteria>

<output>
After completion, create `.planning/phases/01-upload-reliability/01-02-SUMMARY.md` capturing:
- Final line ranges of `api`, `uploadFiles`, `uploadOneFile`, `runUploadQueue`, `renderUploadProgress`
- DevTools screenshot evidence (path or description) of peak-4 concurrency
- Smoke test transcripts (paste DevTools timing, kill-server-mid-upload retry log, cancel observation)
- Confirmation that `BATCH_MAX` is fully removed and no `Promise.all(uploadPromises)` pattern remains
- Note on visual consistency with the picker tree (a one-liner like "rows share `.tree-row` font/hover/color tokens")
</output>

## Decision Coverage

This plan addresses the following CONTEXT.md decisions (from `01-CONTEXT.md`):

- D-01: Per-file upload queue with `UPLOAD_CONCURRENCY = 4` worker pool — implemented in `runUploadQueue`.
- D-02: 15 MB size-batching (`BATCH_MAX`) removed in favor of per-file POSTs — acceptance criterion enforces `grep -c 'BATCH_MAX'` returns 0.
- D-03: Exponential backoff retry `[1000, 3000, 10000]` ms, max 3 attempts, retry on network/5xx/408, no retry on other 4xx — implemented via `RETRY_DELAYS` constant and `shouldRetry()` predicate.
- D-04: `AbortController` respected during retry sleeps — `abortableSleep` helper checks `signal.aborted` and removes its listener on resolution.
- D-08: Two-tier progress UI — overall progress bar via `renderUploadProgress` plus per-file rows in expandable list with states `pending` / `uploading` / `done` / `failed` / `retrying`. Per-file rows reuse the picker's `.tree-row` styling vocabulary (monospace, hover tint, color tokens) so they feel native to the existing picker UI.
- D-09: Progress DOM updates throttled to ~200 ms via `scheduleProgressRender()` with `requestAnimationFrame` for the overall bar.
- D-11: `api()` helper upgraded to parse structured JSON errors — checks `Content-Type` and falls back to text for backward compatibility with existing endpoints.
- D-16: Top-of-file constant `const UPLOAD_CONCURRENCY = 4` added to `static/index.html` script block.
