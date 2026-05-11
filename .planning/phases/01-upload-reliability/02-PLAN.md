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
    - "Browser uploads a folder with 500+ files without WebKitBlobResource error 4 or connection drops"
    - "At most UPLOAD_CONCURRENCY=4 fetch POST requests to /api/{ch}/upload are in flight at any moment"
    - "On HTTP 5xx, HTTP 408, or network error, a failed file is retried with delays 1s/3s/10s for up to 3 attempts before being marked failed"
    - "On HTTP 4xx other than 408, the file is marked failed immediately without retry"
    - "User sees per-file rows with states pending/uploading/done/failed/retrying AND an overall progress bar showing files-done / files-total"
    - "Cancelling the upload aborts in-flight requests and prevents queued retries from firing"
  artifacts:
    - path: "static/index.html"
      provides: "Per-file upload queue with concurrency control"
      contains: "UPLOAD_CONCURRENCY"
    - path: "static/index.html"
      provides: "Per-file retry with exponential backoff"
      contains: "uploadOneFile"
    - path: "static/index.html"
      provides: "Per-file + overall progress UI"
      contains: "renderUploadProgress"
    - path: "static/index.html"
      provides: "JSON-or-text error parsing in api() helper"
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
Rewrite `uploadFiles` in `static/index.html` to replace the current 15 MB batch-by-size loop with a per-file queue + worker pool (concurrency = 4), add per-file retry with exponential backoff (1s / 3s / 10s, max 3 attempts, retry on network/5xx/408, NO retry on other 4xx), upgrade `api()` to parse structured JSON errors with text fallback (D-11), and add a two-tier progress UI (per-file rows + overall bar). Delivers UPLOAD-01, UPLOAD-02, UPLOAD-03, UPLOAD-04. Out of scope: resume from localStorage (Plan 03), visual polish (Phase 4).

Purpose: Today the upload dispatches 100+ files through one or two FormData batches and the WebKit connection pool collapses. A small worker pool with retry + AbortController + a progress UI directly solves the WebKitBlobResource error and gives the user something to look at while 500 files upload.

Output: Modified `static/index.html` — single file. New `UPLOAD_CONCURRENCY` constant, new `uploadOneFile`, new `runUploadQueue`, new `renderUploadProgress`, modified `uploadFiles`, modified `api()`. No new files, no new HTTP endpoints.
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
Existing public entry point (line 622) — preserve signature:
```js
async function confirmPicker()        // calls uploadFiles(ch, selected)
async function uploadFiles(ch, files) // files = [{file: File, path: "relative/path"}]
```

Existing helpers — reuse:
```js
async function api(method, path, body, extraHeaders)  // line 251 — needs JSON-error upgrade
async function sha256(buffer)                          // line 304
function refreshFiles(ch)                              // line 716
function esc(s)                                        // line 731
```

Server contract from Plan 01 (Wave 1 sibling — code against this contract, do not wait):
- Each `POST /api/{ch}/upload` is now ONE file as multipart with form-field name = the relative path (server's `safePath` already accepts the form-field name as the destination path; see main.go line 253 `part.FormName()`).
- Successful response: `{"uploaded": 1, "failed": 0, "errors": []}` (extended shape, additive over old `{"uploaded": N}`).
- Error response on size cap: HTTP 413, `Content-Type: application/json`, body `{"error": "...", "code": "SIZE_LIMIT"}`.
- Error response on per-file timeout: HTTP 200 with `{"uploaded": 0, "failed": 1, "errors": [{"file": "...", "code": "TIMEOUT", ...}]}`. Client treats `r.uploaded === 0 && r.failed >= 1` after a 200 response as a retriable failure if any of the errors has `code in {TIMEOUT, INTERNAL}`.

Module-level state added by this plan:
```js
const UPLOAD_CONCURRENCY = 4;             // D-01, D-16
const RETRY_DELAYS = [1000, 3000, 10000]; // D-03
let uploadController = null;              // current AbortController, or null when idle
let uploadProgress = null;                // { ch, total, done, failed, files: Map<path, {state, attempt, error}> }
```

Per-file state values (D-08): `'pending' | 'uploading' | 'done' | 'failed' | 'retrying'`.
</interfaces>
</context>

<tasks>

<task type="auto" tdd="false">
  <name>Task 1: Upgrade api() to parse JSON errors, add upload progress DOM, and replace uploadFiles internals with per-file queue + retry</name>
  <files>static/index.html</files>
  <read_first>
    - static/index.html (entire file — single 810-line file)
    - .planning/phases/01-upload-reliability/01-CONTEXT.md §Decisions D-01..D-11, D-16
    - .planning/codebase/CONCERNS.md §"Browser Upload Bug: WebKitBlobResource Error 4 on Large Folder Uploads"
  </read_first>
  <behavior>
    - `api()` returns a structured Error on `!resp.ok`: parses JSON body when `Content-Type: application/json`, else falls back to text. Error carries `.status` (HTTP code) and `.code` (machine code string, possibly undefined). Network errors thrown by fetch bubble unchanged (no `.status` property — that's the signal for "retry").
    - `api()` accepts an optional `AbortSignal` via `extraHeaders.__signal`; the signal is moved to `opts.signal` and the `__signal` key is removed before fetch.
    - `uploadFiles(ch, files)` keeps the hash + diff phase (existing behavior), then dispatches the upload set through `runUploadQueue` with concurrency 4.
    - `runUploadQueue` spawns exactly `UPLOAD_CONCURRENCY` workers that pull from a shared pending list (closure index counter, not Promise.all on the full set). Workers exit when the queue is drained OR the AbortController is aborted.
    - `uploadOneFile(ch, entry, signal)` POSTs ONE file per request as multipart, form-field name = `entry.path`, body = `entry.file`. Returns `{ok: true}` on 200 with `uploaded === 1`, else throws.
    - Retry loop inside `uploadOneFile`: up to 3 attempts. Retry triggers on (a) thrown Error with no `.status` (network error), (b) `.status >= 500`, (c) `.status === 408`, (d) HTTP 200 but `r.uploaded === 0 && (r.errors[0]?.code === 'TIMEOUT' || r.errors[0]?.code === 'INTERNAL')`. NO retry on other 4xx — those mark the file failed immediately.
    - Between attempts: `await sleep(RETRY_DELAYS[attempt-1])` where attempt index 1 -> 1000ms, 2 -> 3000ms, 3 -> 10000ms (D-03). The sleep MUST abort if `signal.aborted` becomes true.
    - Progress UI: `renderUploadProgress()` writes into a new container `<div id="upload-progress-{ch}">` inserted after the existing `<div class="status-bar" id="status-{ch}">`. Container holds: an overall `<progress>` bar (max=total, value=done+failed), a percentage label "X / Y files (Z failed)", and a scrollable `<div class="upload-files">` with one row per file showing path + state badge. Updates throttled to ~200ms via a `requestAnimationFrame`-backed scheduler so DOM stays responsive with 500 rows (D-09).
    - On full completion (queue drained, all workers exited): refresh the file list via `refreshFiles(ch)`, set the status bar to a success/partial-success summary, and clear `uploadController`.
    - On abort: leave per-file rows in their last state ('uploading' rows become 'failed' with `error = 'cancelled'`). No further DOM updates after abort. Plan 03 will wire the Resume button against this state.
  </behavior>
  <action>
    This task makes 6 surgical edits to `static/index.html`. Apply them in order. Use Edit tool (not Write) since the file is large.

    **Edit A — Add constants and module state (insert after line 204, after the existing `let eventSources = {};` line):**

    ```js
    // --- Upload tuning constants (D-01, D-03, D-16) ---
    const UPLOAD_CONCURRENCY = 4;
    const RETRY_DELAYS = [1000, 3000, 10000];
    let uploadController = null;   // AbortController for the active upload, or null
    let uploadProgress = null;     // { ch, total, done, failed, files: Map }
    let uploadRenderScheduled = false;
    ```

    **Edit B — Add `<style>` rules. Append these rules to the existing inline `<style>` block (before the closing `</style>` at line 72-ish — find via `</style>`):**

    ```css
    .upload-progress{margin:6px 0;font-size:11px;display:none}
    .upload-progress.active{display:block}
    .upload-progress progress{width:100%;height:6px}
    .upload-progress .label{display:flex;justify-content:space-between;color:var(--dim);margin:4px 0}
    .upload-progress .upload-files{max-height:180px;overflow-y:auto;background:var(--surface);border-radius:6px;padding:6px 8px;font-family:'SF Mono','Fira Code',monospace}
    .upload-progress .uf-row{display:flex;justify-content:space-between;gap:8px;padding:1px 0;white-space:nowrap}
    .upload-progress .uf-row .p{overflow:hidden;text-overflow:ellipsis;flex:1;color:var(--dim)}
    .upload-progress .uf-row .s{flex-shrink:0;font-size:10px;padding:1px 6px;border-radius:3px;border:1px solid var(--border)}
    .upload-progress .uf-row .s.pending{color:var(--dim)}
    .upload-progress .uf-row .s.uploading{color:var(--accent);border-color:var(--accent)}
    .upload-progress .uf-row .s.done{color:var(--success);border-color:var(--success)}
    .upload-progress .uf-row .s.failed{color:var(--danger);border-color:var(--danger)}
    .upload-progress .uf-row .s.retrying{color:#d29922;border-color:#d29922}
    .upload-progress .upload-actions{margin-top:6px;display:flex;gap:8px}
    ```

    **Edit C — Add the progress container DOM. For each channel (a and b), insert a new div directly after the existing `<div class="status-bar" id="status-{ch}"></div>`. Concretely, edit the two lines that match the pattern `<div class="status-bar" id="status-a"></div>` and `<div class="status-bar" id="status-b"></div>` and append immediately after each:**

    ```html
    <div class="upload-progress" id="upload-progress-a">
      <progress id="upload-bar-a" value="0" max="1"></progress>
      <div class="label"><span id="upload-counts-a">0 / 0</span><span id="upload-pct-a">0%</span></div>
      <div class="upload-files" id="upload-files-a"></div>
      <div class="upload-actions"><button onclick="cancelUpload('a')" class="danger" id="upload-cancel-a">Cancel</button></div>
    </div>
    ```

    (and the same with `a` replaced by `b` for channel B).

    **Edit D — Replace the body of `api()` (currently `static/index.html:251-268`). New body, verbatim:**

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

    **Edit E — Replace `uploadFiles` (currently `static/index.html:631-712`) with a hash + diff + queue dispatch + summary. New function body, verbatim:**

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

        // Run the queue
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

    **Edit F — Add the queue runner, single-file uploader, progress renderer, and cancel helper. Insert these AFTER `uploadFiles` (i.e. after the closing brace of the function inserted by Edit E):**

    ```js
    // --- Upload queue + retry (Plan 02) ---

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
        // 200 OK but server reports retriable in-band failure?
        if ((r.uploaded || 0) >= 1) {
          st.state = 'uploading'; // transient — caller will mark 'done'
          return;
        }
        const firstErr = (r.errors && r.errors[0]) || {};
        const inBandRetriable = firstErr.code === 'TIMEOUT' || firstErr.code === 'INTERNAL';
        if (inBandRetriable && attempt <= RETRY_DELAYS.length) {
          st.error = firstErr.message || firstErr.code || 'server failure';
          await abortableSleep(RETRY_DELAYS[attempt - 1], signal);
          continue;
        }
        // Non-retriable in-band failure -> throw
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
      // Render rows
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

    After all edits, the file MUST still validate as parseable HTML. Run a smoke build with the embedded UI to catch issues:
    ```
    cd /Users/olli/schenanigans/sync_temple && go build -o /tmp/sync-temple ./...
    ```
  </action>
  <verify>
    <automated>cd /Users/olli/schenanigans/sync_temple &amp;&amp; go build -o /tmp/sync-temple-plan02 ./... &amp;&amp; grep -c 'const UPLOAD_CONCURRENCY = 4' static/index.html &amp;&amp; grep -c 'const RETRY_DELAYS = \[1000, 3000, 10000\]' static/index.html &amp;&amp; grep -c 'function uploadOneFile' static/index.html &amp;&amp; grep -c 'function runUploadQueue' static/index.html &amp;&amp; grep -c 'function renderUploadProgress' static/index.html &amp;&amp; grep -c 'function shouldRetry' static/index.html &amp;&amp; grep -c 'AbortController' static/index.html &amp;&amp; grep -c 'upload-progress-a' static/index.html &amp;&amp; grep -c 'upload-progress-b' static/index.html</automated>
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
    - `grep -c 'BATCH_MAX' static/index.html` returns exactly 0 (old batch logic deleted)
    - `grep -c 'id="upload-progress-a"' static/index.html` returns exactly 1
    - `grep -c 'id="upload-progress-b"' static/index.html` returns exactly 1
    - `grep -c "opts.signal = headers.__signal" static/index.html` returns exactly 1
    - `grep -c "e.code = payload.code" static/index.html` returns exactly 1
    - `go build -o /tmp/sync-temple-plan02 ./...` exits with status 0 (embedded HTML still embeds cleanly)
    - Manual smoke (executor MUST run): start the server, open the UI in Chrome/Safari, drag a folder with at least 50 files, confirm in DevTools Network panel that no more than 4 concurrent POST /api/a/upload requests are ever in flight. (Count via DevTools "Network" filter on `upload`.)
    - Manual smoke (executor MUST run): stop the server mid-upload (kill the binary). Confirm in the UI that affected file rows transition to 'retrying' state showing `attempt N/4`, and after 3 retries the rows show 'failed'. Restart server, confirm no further activity (no new requests fire after the failure terminus).
    - Manual smoke (executor MUST run): click Cancel during an upload. Confirm in DevTools Network panel that in-flight requests show "(canceled)" and no further requests fire.
  </acceptance_criteria>
  <done>
    `uploadFiles` no longer batches by 15 MB; uploads one file per request through a 4-worker pool; failed files retry on transient errors with 1s/3s/10s backoff up to 3 retries; the user sees a progress container with overall bar + per-file rows and can cancel; `api()` parses JSON errors and exposes `.status` + `.code` for retry classification; server still receives requests in the existing multipart shape (form-field name = path).
  </done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| browser fetch -> server | Same as today; auth header carries token. |
| user input (file paths) -> DOM rendering | New per-file rows render paths via `esc()` to prevent HTML injection. |

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
- Existing CLI smoke: `python3 sync push a /tmp/somedir` (or whatever the user runs) still returns success because server response keeps `uploaded` field (Plan 01 D-17 compat).
</verification>

<success_criteria>
- All `<acceptance_criteria>` grep counts pass and `go build` succeeds.
- All three manual smoke tests pass (concurrency cap, retry visible, cancel works).
- UPLOAD-01, UPLOAD-02, UPLOAD-03, UPLOAD-04 marked satisfied by this plan.
</success_criteria>

<output>
After completion, create `.planning/phases/01-upload-reliability/01-02-SUMMARY.md` capturing:
- Final line ranges of `api`, `uploadFiles`, `uploadOneFile`, `runUploadQueue`, `renderUploadProgress`
- DevTools screenshot evidence (path or description) of peak-4 concurrency
- Smoke test transcripts (paste DevTools timing, kill-server-mid-upload retry log, cancel observation)
- Confirmation that `BATCH_MAX` is fully removed and no `Promise.all(uploadPromises)` pattern remains
</output>

## Decision Coverage

This plan addresses the following CONTEXT.md decisions (from `01-CONTEXT.md`):

- D-01: Per-file upload queue with `UPLOAD_CONCURRENCY = 4` worker pool — implemented in `runUploadQueue`.
- D-02: 15 MB size-batching (`BATCH_MAX`) removed in favor of per-file POSTs — acceptance criterion enforces `grep -c 'BATCH_MAX'` returns 0 in the rewritten upload path.
- D-03: Exponential backoff retry `[1000, 3000, 10000]` ms, max 3 attempts, retry on network/5xx/408, no retry on other 4xx — implemented via `RETRY_DELAYS` constant and `shouldRetry()` predicate.
- D-04: `AbortController` respected during retry sleeps — `abortableSleep` helper checks `signal.aborted` and removes its listener on resolution.
- D-08: Two-tier progress UI — overall progress bar via `renderUploadProgress` plus per-file rows in expandable list with states `pending` / `uploading` / `done` / `failed` / `retrying`.
- D-09: Progress DOM updates throttled to ~200 ms via `scheduleProgressRender()` with `requestAnimationFrame` for the overall bar.
- D-11: `api()` helper upgraded to parse structured JSON errors — checks `Content-Type` and falls back to text for backward compatibility with existing endpoints.
- D-16: Top-of-file constant `const UPLOAD_CONCURRENCY = 4` added to `static/index.html` script block.
