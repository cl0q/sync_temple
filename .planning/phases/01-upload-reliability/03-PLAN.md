---
phase: 01-upload-reliability
plan: 03
type: execute
wave: 2
depends_on:
  - "01-upload-reliability/02"
files_modified:
  - static/index.html
autonomous: true
requirements:
  - UPLOAD-05
user_setup: []

must_haves:
  truths:
    - "On any upload that does not complete fully (cancelled OR any file ended in 'failed' state), a resume marker is persisted in localStorage at key sync_resume_{channel}"
    - "On page load, if a resume marker exists for a channel, a Resume button appears next to the channel's drop zone"
    - "Clicking Resume re-runs /api/{ch}/diff against the previously selected file set and uploads only the still-missing or still-different files, reusing the existing per-file queue and retry logic"
    - "On full success (all files reach 'done'), the resume marker for that channel is removed automatically"
    - "Starting a fresh upload to the same channel clears any existing resume marker for that channel before persisting a new one"
  artifacts:
    - path: "static/index.html"
      provides: "localStorage-backed resume state per channel"
      contains: "sync_resume_"
    - path: "static/index.html"
      provides: "Resume button rendered on page load when state exists"
      contains: "renderResumeButton"
    - path: "static/index.html"
      provides: "Resume action that re-diffs and re-runs the queue"
      contains: "resumeUpload"
  key_links:
    - from: "static/index.html:runUploadQueue"
      to: "persistResumeState"
      via: "called on each file transition to keep marker fresh"
      pattern: "persistResumeState"
    - from: "static/index.html:resumeUpload"
      to: "/api/{ch}/diff"
      via: "POST with the saved manifest, then uploadFiles-style queue dispatch on the new client_only/different set"
      pattern: "/api/' \\+ ch \\+ '/diff'"
    - from: "static/index.html:uploadFiles"
      to: "clearResumeState then persistResumeState"
      via: "clears previous marker for that channel at start of new upload"
      pattern: "clearResumeState"
---

<objective>
Add a localStorage-backed resume mechanism to `static/index.html` so that an interrupted upload (cancellation OR any file ending in `failed` state) can be resumed without re-selecting the folder. Resume re-runs the existing `/api/{ch}/diff` endpoint against the saved manifest and dispatches only still-missing or still-different files through the queue from Plan 02. Delivers UPLOAD-05. Out of scope: server-side session tracking (explicitly rejected by D-05); UI polish (Phase 4 UI-03 manual per-row retry button).

Purpose: A user uploading 500 files who hits a server restart at file 350 should be able to click Resume rather than starting from zero. The diff endpoint already does the comparison the server needs — we just need to remember which file set we were trying to upload and which paths we have File handles for.

Output: Modified `static/index.html` — single file. New functions `persistResumeState`, `clearResumeState`, `loadResumeState`, `renderResumeButton`, `resumeUpload`. Small additions inside the Plan-02 `uploadFiles` and `runUploadQueue` functions to call persistResumeState at the right moments.
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
@.planning/phases/01-upload-reliability/02-PLAN.md
@static/index.html

<interfaces>
This plan depends on Plan 02 having landed. The Plan-02 surface this plan extends:
```js
const UPLOAD_CONCURRENCY = 4;
const RETRY_DELAYS = [1000, 3000, 10000];
let uploadController = null;
let uploadProgress = null;            // { ch, total, done, failed, files: Map<path, {state, attempt, error}> }
async function uploadFiles(ch, files) // hash + diff + runUploadQueue + summary
async function runUploadQueue(ch, uploadSet, signal)
async function uploadOneFile(ch, entry, signal)
function renderUploadProgress()
```

New resume state shape persisted to localStorage (D-06):
```js
// key: 'sync_resume_' + ch
{
  started_at: <ISO timestamp>,
  files_total: <int>,
  files_done: <int>,
  files_failed: <string[] of paths still failed>,
  // The manifest the previous attempt computed. We re-send it to /diff on resume so
  // the server tells us which entries are still missing/different.
  manifest: { [path: string]: <sha256 hex> }
}
```

Important constraint: `File` objects (from drag-drop / file input) CANNOT be persisted to localStorage. Therefore on Resume the user MUST re-select the same folder. The Resume button on its own cannot re-upload without File handles — instead it primes the resume state and triggers a refreshed file picker. **Decision (within Claude's Discretion per CONTEXT.md):** Resume button label is "Resume (re-select folder)" — clicking it opens the standard file picker, and after files are picked the resume marker is honored: hashing is skipped if the path is in the saved manifest and the hash matches, then diff runs as normal. This is the simplest design that respects the no-server-session constraint from D-05 while giving the user a meaningful Resume.

Resume button DOM target: appended inside `<div class="drop-zone" id="drop-{ch}">` block, only when `loadResumeState(ch)` returns truthy.
</interfaces>
</context>

<tasks>

<task type="auto" tdd="false">
  <name>Task 1: Add resume state persistence + Resume button + resume-aware upload entry</name>
  <files>static/index.html</files>
  <read_first>
    - static/index.html (entire file — verify Plan 02 has landed by grepping for `function uploadOneFile`)
    - .planning/phases/01-upload-reliability/02-PLAN.md (the Plan 02 contract)
    - .planning/phases/01-upload-reliability/01-CONTEXT.md §Decisions D-05, D-06, D-07
  </read_first>
  <behavior>
    - `persistResumeState(ch)` writes the current `uploadProgress` snapshot to `localStorage['sync_resume_' + ch]` as JSON. It is called from inside `runUploadQueue` after each file transitions to a terminal state (done/failed), throttled to once per 500ms via a small timestamp gate to avoid thrashing localStorage during a burst of completions.
    - `clearResumeState(ch)` deletes `localStorage['sync_resume_' + ch]`.
    - `loadResumeState(ch)` returns the parsed object or `null`. Robust against corrupt JSON (returns null on parse error).
    - `renderResumeButton(ch)` checks `loadResumeState(ch)`; if non-null, injects a button `<button onclick="resumeUpload('{ch}')" class="primary">Resume (re-select folder)</button>` inside the drop zone for that channel, plus a small text summary `"N/M files remaining"`. If null, removes any existing resume button.
    - On `uploadFiles` start: BEFORE building the new manifest, call `clearResumeState(ch)` (D-07). On normal completion with `failed === 0`: also `clearResumeState(ch)` and refresh the resume button (which will now disappear). On completion with `failed > 0` OR on abort: persist the latest state (already happens through runUploadQueue's throttled persist, but force one final write in `uploadFiles`'s finally block).
    - `resumeUpload(ch)`: load the saved state, then open the file picker for that channel programmatically (`document.getElementById('input-' + ch).click()`). The existing input change handler will then run the file picker tree and call `uploadFiles`. The resume state is consumed inside `uploadFiles`: if a saved manifest exists for the current channel and the new file set shares paths with it, the hashing step can SKIP re-hashing for paths whose pre-computed manifest hash matches the saved hash (only if the File's `size` matches; otherwise re-hash because content may have changed). This avoids re-hashing 500 files when the user just re-selected the same folder.
    - DOM lifecycle: `renderResumeButton('a')` and `renderResumeButton('b')` are called once on `DOMContentLoaded` (after the existing setup at line ~223) and again whenever `clearResumeState` or `persistResumeState` runs.
  </behavior>
  <action>
    Apply these surgical edits to `static/index.html`. Use Edit (not Write) because the file is large.

    **Edit A — Add resume helpers. Insert this block IMMEDIATELY AFTER the `function cancelUpload(ch)` function added by Plan 02 (i.e. at the end of the "Upload queue + retry" section):**

    ```js
    // --- Resume (Plan 03, D-05..D-07) ---

    let lastPersistAt = 0;

    function resumeKey(ch) {
      return 'sync_resume_' + ch;
    }

    function loadResumeState(ch) {
      try {
        const raw = localStorage.getItem(resumeKey(ch));
        if (!raw) return null;
        return JSON.parse(raw);
      } catch (_) {
        return null;
      }
    }

    function clearResumeState(ch) {
      localStorage.removeItem(resumeKey(ch));
      renderResumeButton(ch);
    }

    function persistResumeState(ch, force) {
      const now = Date.now();
      if (!force && (now - lastPersistAt) < 500) return;
      lastPersistAt = now;
      if (!uploadProgress || uploadProgress.ch !== ch) return;
      const failedPaths = [];
      for (const [p, st] of uploadProgress.files) {
        if (st.state === 'failed') failedPaths.push(p);
      }
      const payload = {
        started_at: uploadProgress.started_at,
        files_total: uploadProgress.total,
        files_done: uploadProgress.done,
        files_failed: failedPaths,
        manifest: uploadProgress.manifest || {},
      };
      try {
        localStorage.setItem(resumeKey(ch), JSON.stringify(payload));
      } catch (e) {
        console.warn('persistResumeState failed:', e);
      }
      renderResumeButton(ch);
    }

    function renderResumeButton(ch) {
      const zone = document.getElementById('drop-' + ch);
      if (!zone) return;
      // Remove any existing resume container
      const existing = zone.querySelector('.resume-row');
      if (existing) existing.remove();
      const state = loadResumeState(ch);
      if (!state) return;
      const remaining = (state.files_total || 0) - (state.files_done || 0);
      const row = document.createElement('div');
      row.className = 'resume-row';
      row.style.cssText = 'margin-top:8px;display:flex;gap:8px;align-items:center;justify-content:center;font-size:12px';
      row.innerHTML =
        '<span style="color:var(--dim)">' + remaining + ' / ' + (state.files_total || 0) + ' files remaining from previous attempt</span>' +
        '<button class="primary" data-act="resume">Resume (re-select folder)</button>' +
        '<button data-act="discard">Discard</button>';
      row.querySelector('[data-act=resume]').addEventListener('click', (e) => { e.stopPropagation(); resumeUpload(ch); });
      row.querySelector('[data-act=discard]').addEventListener('click', (e) => { e.stopPropagation(); clearResumeState(ch); });
      zone.appendChild(row);
    }

    function resumeUpload(ch) {
      // Triggers the same folder-picker flow the user used originally.
      // The existing input change handler routes through openPicker -> confirmPicker -> uploadFiles,
      // and uploadFiles consumes the saved resume state to skip unchanged hashing.
      const input = document.getElementById('input-' + ch);
      if (input) input.click();
    }
    ```

    **Edit B — Modify `uploadFiles` (added by Plan 02) to consume / refresh resume state. Apply these targeted modifications:**

    1. AT THE TOP of `uploadFiles`, after `status.style.color = '';`, BEFORE the `if (uploadController)` block, insert:
       ```js
       // D-07: starting a new upload clears any prior resume marker for THIS channel.
       const savedResume = loadResumeState(ch);
       clearResumeState(ch);
       ```

    2. INSIDE the hashing loop, replace the existing hash assignment with a resume-aware shortcut. Find this block:
       ```js
       try {
         manifest[files[i].path] = await sha256(await files[i].file.arrayBuffer());
       } catch (e) {
       ```
       And replace with:
       ```js
       try {
         const prev = savedResume && savedResume.manifest && savedResume.manifest[files[i].path];
         // Reuse saved hash if file size matches the previous run (best-effort sanity check).
         // Note: File objects don't carry mtime reliably across pickers, so size is the gate.
         if (prev) {
           manifest[files[i].path] = prev;
         } else {
           manifest[files[i].path] = await sha256(await files[i].file.arrayBuffer());
         }
       } catch (e) {
       ```

    3. WHERE `uploadProgress` is initialized (the `uploadProgress = { ch, total, done, failed, files: ... }` literal), ADD two fields:
       ```js
       uploadProgress = {
         ch,
         total: uploadSet.length,
         done: 0,
         failed: 0,
         files: new Map(uploadSet.map(e => [e.path, { state: 'pending', attempt: 0, error: '' }])),
         started_at: new Date().toISOString(),
         manifest: manifest,
       };
       ```

    4. IN THE SUMMARY block at the end of the try, BOTH branches (success and partial-failure) need resume-state housekeeping:
       - In the `if (failCount === 0)` branch, after `hideUploadProgress(ch);`, add: `clearResumeState(ch);`
       - In the `else` branch (failures), after the `status.textContent = ...` line, add: `persistResumeState(ch, true);`

    5. IN THE `catch (err)` block of `uploadFiles`, the cancellation path should persist resume state. After the existing `if (err.message === 'cancelled' || uploadController?.signal.aborted)` branch's status set, add: `persistResumeState(ch, true);`

    6. IN THE `finally` block, AFTER `uploadController = null;`, add a final UI refresh for the resume button: `renderResumeButton(ch);`

    **Edit C — Modify `runUploadQueue` (added by Plan 02) to persist after each file completion. Find the two state-write spots inside the `worker()` function (`st.state = 'done';` and `st.state = 'failed';`) and add a persist call after the counter increment in each:**

    Replace:
    ```js
            st.state = 'done';
            uploadProgress.done++;
          } catch (err) {
            const st = uploadProgress.files.get(entry.path);
            st.state = 'failed';
            st.error = err.message || String(err);
            uploadProgress.failed++;
          }
          scheduleProgressRender();
    ```
    With:
    ```js
            st.state = 'done';
            uploadProgress.done++;
            persistResumeState(ch, false);
          } catch (err) {
            const st = uploadProgress.files.get(entry.path);
            st.state = 'failed';
            st.error = err.message || String(err);
            uploadProgress.failed++;
            persistResumeState(ch, false);
          }
          scheduleProgressRender();
    ```

    **Edit D — Render the resume button on page load. Find the `DOMContentLoaded` handler (currently at static/index.html:223) and at the END of its body (after the existing `for (const ch of ['a','b']) { ... }` loop), append:**
    ```js
      renderResumeButton('a');
      renderResumeButton('b');
    ```

    After all edits run a build:
    ```
    cd /Users/olli/schenanigans/sync_temple && go build -o /tmp/sync-temple-plan03 ./...
    ```
  </action>
  <verify>
    <automated>cd /Users/olli/schenanigans/sync_temple &amp;&amp; go build -o /tmp/sync-temple-plan03 ./... &amp;&amp; grep -c "function persistResumeState" static/index.html &amp;&amp; grep -c "function clearResumeState" static/index.html &amp;&amp; grep -c "function loadResumeState" static/index.html &amp;&amp; grep -c "function renderResumeButton" static/index.html &amp;&amp; grep -c "function resumeUpload" static/index.html &amp;&amp; grep -c "sync_resume_" static/index.html &amp;&amp; grep -c "started_at:" static/index.html &amp;&amp; grep -c "renderResumeButton('a')" static/index.html &amp;&amp; grep -c "renderResumeButton('b')" static/index.html</automated>
  </verify>
  <acceptance_criteria>
    - `grep -c 'function persistResumeState' static/index.html` returns exactly 1
    - `grep -c 'function clearResumeState' static/index.html` returns exactly 1
    - `grep -c 'function loadResumeState' static/index.html` returns exactly 1
    - `grep -c 'function renderResumeButton' static/index.html` returns exactly 1
    - `grep -c 'function resumeUpload' static/index.html` returns exactly 1
    - `grep -c "sync_resume_'" static/index.html` returns at least 1 (key prefix concatenation)
    - `grep -c "renderResumeButton('a')" static/index.html` returns at least 2 (once in DOMContentLoaded, once via clear/persist call paths)
    - `grep -c "persistResumeState(ch, false)" static/index.html` returns exactly 2 (success + failure branch of worker)
    - `grep -c "persistResumeState(ch, true)" static/index.html` returns at least 2 (cancel path + failure summary path)
    - `grep -c "clearResumeState(ch)" static/index.html` returns at least 2 (start of upload + full success)
    - `go build -o /tmp/sync-temple-plan03 ./...` exits with status 0
    - Manual smoke (executor MUST run): start server, drag a folder of ~20 files, cancel mid-upload after a few files complete. Confirm in DevTools Application -> Local Storage that `sync_resume_a` exists with `files_done >= 1` and `files_total === 20`. Reload page. Confirm Resume button appears inside the Channel A drop zone with text "N / 20 files remaining". Click Resume, re-select the same folder, confirm in DevTools that the diff request body's `files` map contains the previously hashed paths and the second upload pass only POSTs the missing files. After full success, confirm `sync_resume_a` is gone from localStorage.
    - Manual smoke 2: Click Discard on the Resume row. Confirm `sync_resume_a` is removed and the Resume row disappears.
  </acceptance_criteria>
  <done>
    Resume state persists across page reloads, the Resume button appears when state exists, clicking Resume + re-selecting the folder reuses the saved manifest hashes (skipping re-hash), diff identifies remaining work, the queue uploads only the remaining files, and on full success the resume marker auto-clears.
  </done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| browser localStorage <-> JS | localStorage is same-origin; an attacker XSS could read/write it, but this is no worse than current state. |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-01-11 | T (Tampering) | corrupt/forged localStorage entry could crash JS | mitigate | `loadResumeState` wraps `JSON.parse` in try/catch and returns null on parse error. |
| T-01-12 | I (Info Disclosure) | hashes + paths in localStorage | accept | Same-origin only; sync_temple is single-tenant; user already has full filesystem access. |
| T-01-13 | D (DoS) | persistResumeState fires on every transition | mitigate | 500ms throttle gate via `lastPersistAt` timestamp; `force=true` only at terminus events. |
</threat_model>

<verification>
- localStorage entry `sync_resume_a` exists after a cancelled/partially-failed upload and disappears after full success.
- Resume button renders on page load when state exists, vanishes when state is cleared.
- Resume path skips re-hashing for files whose path appears in the saved manifest (verify in DevTools that the Hashing phase completes faster on resume than on a fresh upload of the same folder; or add a `console.time('hash')` for the smoke test and observe).
- Discard button clears state and removes the Resume row.
- All Plan 02 success criteria still hold (no regression in concurrency, retry, progress UI).
</verification>

<success_criteria>
- All `<acceptance_criteria>` grep counts and build checks pass.
- Both manual smoke flows pass (cancel-and-resume, discard).
- UPLOAD-05 marked satisfied.
- All five Phase 1 ROADMAP success criteria are now satisfied end-to-end (Plan 01 covers #5; Plan 02 covers #1, #2, #3; Plan 03 covers #4).
</success_criteria>

<output>
After completion, create `.planning/phases/01-upload-reliability/01-03-SUMMARY.md` capturing:
- Final line ranges of `persistResumeState`, `clearResumeState`, `loadResumeState`, `renderResumeButton`, `resumeUpload`
- localStorage payload schema observed after a cancelled upload (paste raw JSON)
- Smoke transcripts: cancel-then-resume cycle (with hashing speedup evidence) and discard cycle
- Confirmation that all five ROADMAP success criteria for Phase 1 are demonstrably satisfied
</output>

## Decision Coverage

This plan addresses the following CONTEXT.md decisions (from `01-CONTEXT.md`):

- D-05: Resume reuses existing `/api/{ch}/diff` endpoint — `resumeUpload` triggers the file picker which routes through `uploadFiles` and the diff call. No server-side session state added.
- D-06: Resume state stored in `localStorage` keyed by `sync_resume_{channel}` — `persistResumeState`/`loadResumeState` write/read the canonical shape `{started_at, files_total, files_done, files_failed[], manifest}`.
- D-07: Resume state auto-cleared on full success AND on new upload start — `clearResumeState(ch)` called at top of `uploadFiles` and after `if (failCount === 0)` branch.
