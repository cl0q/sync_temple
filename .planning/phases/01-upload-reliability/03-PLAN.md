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
    - "D-05: Resume re-uses the existing /api/{ch}/diff endpoint; no new server-side state, no new endpoint"
    - "D-06: On any upload that does not complete fully (cancelled OR any file ended in 'failed' state), a resume marker is persisted in localStorage at key sync_resume_{channel}"
    - "D-06: Resume marker JSON shape is {started_at, files_total, files_done, files_failed[], manifest}"
    - "D-07: On full success (all files reach 'done'), the resume marker for that channel is removed automatically"
    - "D-07: Starting a fresh upload to the same channel clears any existing resume marker for that channel before persisting a new one"
    - "On page load, if a resume marker exists for a channel, a Resume button appears next to the channel's drop zone with a 'N / M files remaining' label"
    - "Clicking Resume opens the existing picker flow; if the user re-selects the same folder, hashing is skipped for files whose path appears in the saved manifest, then diff identifies remaining work, then the existing per-file queue uploads only the missing files"
  artifacts:
    - path: "static/index.html"
      provides: "localStorage-backed resume state per channel (D-06)"
      contains: "sync_resume_"
    - path: "static/index.html"
      provides: "Resume button rendered on page load when state exists"
      contains: "renderResumeButton"
    - path: "static/index.html"
      provides: "Resume action that re-triggers the picker flow"
      contains: "resumeUpload"
  key_links:
    - from: "static/index.html:runUploadQueue"
      to: "persistResumeState"
      via: "called on each file transition (done/failed) to keep marker fresh"
      pattern: "persistResumeState"
    - from: "static/index.html:resumeUpload"
      to: "input change → openPicker → confirmPicker → uploadFiles → /api/{ch}/diff"
      via: "saved manifest reused inside uploadFiles to skip re-hashing, then existing diff endpoint identifies remaining work"
      pattern: "savedResume"
    - from: "static/index.html:uploadFiles"
      to: "clearResumeState then persistResumeState"
      via: "clears previous marker for that channel at start of new upload, persists fresh marker on cancel/partial-fail"
      pattern: "clearResumeState"
---

<objective>
Add a localStorage-backed resume mechanism to `static/index.html` so that an interrupted upload (cancellation OR any file ending in `failed` state) can be resumed without re-doing all the hashing work. Resume re-runs the existing `/api/{ch}/diff` endpoint against the saved manifest and dispatches only still-missing or still-different files through the queue from Plan 02. Delivers UPLOAD-05. Out of scope: server-side session tracking (explicitly rejected by D-05); UI polish (Phase 4 UI-03 manual per-row retry button); auto-pre-checking the picker tree from saved manifest (optional refinement noted below, not blocking).

Purpose: A user uploading 500 files who hits a server restart at file 350 should be able to click Resume rather than starting from zero. The diff endpoint already does the comparison the server needs — we just need to remember which file set we were trying to upload, which paths we have hashed manifest entries for, and let the user re-select the same folder so the picker → confirmPicker → uploadFiles flow has File handles again.

Output: Modified `static/index.html` — single file. New functions `persistResumeState`, `clearResumeState`, `loadResumeState`, `renderResumeButton`, `resumeUpload`. Small additions inside the Plan-02 `uploadFiles` and `runUploadQueue` functions to call `persistResumeState` at the right moments. New page-load hook that calls `renderResumeButton('a')` and `renderResumeButton('b')` after the existing `DOMContentLoaded` setup.

Note on Resume + Picker (optional refinement, not in must_haves): once the user clicks Resume and the picker opens with the re-selected folder, the picker COULD pre-uncheck files that are already in the saved manifest's done set (paths in `manifest` but NOT in `files_failed`). This would let the user confirm immediately on the remaining set. This refinement is OPTIONAL — the core D-05 decision ("re-run diff and continue with delta") works regardless because the diff endpoint will report `same` for already-uploaded files and the queue will only upload missing/different ones. If the executor has bandwidth they MAY wire `pickerExcluded` pre-population from the saved manifest's done set; if not, the diff-only path is sufficient and ships UPLOAD-05.
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
<!-- This plan depends on Plan 02 having landed. Verify before starting with `grep -c "function uploadOneFile" static/index.html` returning 1. -->

The Plan-02 surface this plan extends:
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

The existing picker flow this plan re-uses unchanged:
```
input change handler (line 241-245):
  document.getElementById('input-' + ch).addEventListener('change', function() {
    const files = getFilesFromInput(this.files);
    if (files.length) openPicker(ch, files);
    this.value = '';
  });

openPicker(ch, files)   // line 379 — opens picker modal
confirmPicker()         // line 622 — calls await uploadFiles(ch, selected)
```

`resumeUpload(ch)` programmatically clicks `<input id="input-{ch}">` which triggers the existing change handler — no new flow, just re-entering the existing one. Once `uploadFiles` runs, it reads the saved resume state and skips re-hashing for paths whose entry exists in `savedResume.manifest`. After hashing, the existing diff call to `/api/{ch}/diff` runs as normal — the server compares against its disk state and tells the client which paths are still missing.

New resume state shape persisted to localStorage (D-06):
```js
// key: 'sync_resume_' + ch
{
  started_at: <ISO timestamp>,
  files_total: <int>,
  files_done: <int>,
  files_failed: <string[] of paths still failed>,
  manifest: { [path: string]: <sha256 hex> }   // the manifest the previous attempt computed
}
```

Important constraint: `File` objects (from drag-drop / file input) CANNOT be persisted to localStorage. Therefore on Resume the user MUST re-select the same folder via the picker flow. The Resume button on its own cannot re-upload without File handles — instead it primes the resume state and triggers a refreshed file picker. **Decision (within Claude's Discretion per CONTEXT.md):** Resume button label is "Resume (re-select folder)" — clicking it opens the standard file input, the existing change handler routes through `openPicker` → `confirmPicker` → `uploadFiles`, and `uploadFiles` honors the resume marker by skipping hashing for paths in the saved manifest whose File `size` is unchanged.

Resume button DOM target: appended INSIDE `<div class="drop-zone" id="drop-{ch}">` (channel A line 97, channel B line 118), only when `loadResumeState(ch)` returns truthy. Layout: a small flex row at the bottom of the drop zone with the remaining-count label, a primary Resume button, and a secondary Discard button.
</interfaces>
</context>

<tasks>

<task type="auto" tdd="false">
  <name>Task 1: Add resume state persistence + Resume button + resume-aware uploadFiles entry</name>
  <files>static/index.html</files>
  <read_first>
    - static/index.html (entire file — verify Plan 02 has landed by grepping for `function uploadOneFile` and confirming it returns 1)
    - .planning/phases/01-upload-reliability/02-PLAN.md (the Plan 02 contract — `uploadFiles`, `runUploadQueue`, `cancelUpload` line refs will differ from post-WIP baseline)
    - .planning/phases/01-upload-reliability/01-CONTEXT.md §Decisions D-05, D-06, D-07
  </read_first>
  <behavior>
    - `persistResumeState(ch, force)` writes the current `uploadProgress` snapshot to `localStorage['sync_resume_' + ch]` as JSON. It is called from inside `runUploadQueue` after each file transitions to a terminal state (done/failed), throttled to once per 500 ms via a small timestamp gate to avoid thrashing localStorage during a burst of completions. `force=true` bypasses the throttle and is used at terminus events (cancel, partial-fail summary).
    - `clearResumeState(ch)` deletes `localStorage['sync_resume_' + ch]` and re-renders the resume button (so it disappears).
    - `loadResumeState(ch)` returns the parsed object or `null`. Robust against corrupt JSON (returns null on parse error).
    - `renderResumeButton(ch)` checks `loadResumeState(ch)`; if non-null, injects a `<div class="resume-row">` inside `<div id="drop-{ch}">` with a remaining-count label, a primary `Resume (re-select folder)` button, and a secondary `Discard` button. If null, removes any existing resume row.
    - On `uploadFiles` start: BEFORE building the new manifest, snapshot the existing resume state into a local `savedResume` variable, then call `clearResumeState(ch)` (D-07). On normal completion with `failed === 0`: also `clearResumeState(ch)` (the success path needs no resume). On completion with `failed > 0` OR on cancel: persist the latest state with `force=true` so the marker reflects the final state precisely.
    - `resumeUpload(ch)` programmatically clicks the file input: `document.getElementById('input-' + ch).click()`. The existing change handler routes through `openPicker` → `confirmPicker` → `uploadFiles`. The resume state is consumed inside `uploadFiles`'s hashing loop: if a saved manifest entry exists for the path being hashed, reuse the saved hash (skipping the expensive `sha256(arrayBuffer)` call) — best-effort, this trusts the user re-selected the same folder.
    - DOM lifecycle: `renderResumeButton('a')` and `renderResumeButton('b')` are called once on `DOMContentLoaded` (after the existing setup loop ending at line 246) and again whenever `clearResumeState` or `persistResumeState` runs.
  </behavior>
  <action>
    Apply these surgical edits to `static/index.html`. Use Edit (not Write) because the file is large.

    **Edit A — Add resume helpers. Insert this block IMMEDIATELY AFTER the `function cancelUpload(ch)` function added by Plan 02 (at the end of the "Upload queue + retry" section, before the `// --- Channel ops ---` comment):**

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
      row.style.cssText = 'margin-top:8px;display:flex;gap:8px;align-items:center;justify-content:center;font-size:12px;flex-wrap:wrap';
      row.innerHTML =
        '<span style="color:var(--dim)">' + remaining + ' / ' + (state.files_total || 0) + ' files remaining from previous attempt</span>' +
        '<button class="primary" data-act="resume">Resume (re-select folder)</button>' +
        '<button data-act="discard">Discard</button>';
      row.querySelector('[data-act=resume]').addEventListener('click', (e) => { e.stopPropagation(); resumeUpload(ch); });
      row.querySelector('[data-act=discard]').addEventListener('click', (e) => { e.stopPropagation(); clearResumeState(ch); });
      zone.appendChild(row);
    }

    function resumeUpload(ch) {
      // Re-enter the existing picker flow. The input change handler runs
      // openPicker → confirmPicker → uploadFiles, and uploadFiles consumes
      // the saved resume state to skip re-hashing for unchanged files.
      const input = document.getElementById('input-' + ch);
      if (input) input.click();
    }
    ```

    **Edit B — Modify `uploadFiles` (added by Plan 02) to consume / refresh resume state. Apply these targeted modifications IN PLACE (Edit tool, narrow replacements):**

    1. AT THE TOP of `uploadFiles`, immediately AFTER `status.style.color = '';`, BEFORE the `if (uploadController)` block, insert:
       ```js
       // D-07: starting a new upload clears any prior resume marker for THIS channel.
       const savedResume = loadResumeState(ch);
       clearResumeState(ch);
       ```

    2. INSIDE the hashing loop, replace the existing hash assignment with a resume-aware shortcut. Find this exact snippet (inside the `for (let i = 0; i < files.length; i++) { ... try { ... } }`):
       ```js
           try {
             manifest[files[i].path] = await sha256(await files[i].file.arrayBuffer());
           } catch (e) {
       ```
       Replace with:
       ```js
           try {
             const prev = savedResume && savedResume.manifest && savedResume.manifest[files[i].path];
             // Reuse saved hash when the user re-selects the same folder; size-stable assumption.
             if (prev) {
               manifest[files[i].path] = prev;
             } else {
               manifest[files[i].path] = await sha256(await files[i].file.arrayBuffer());
             }
           } catch (e) {
       ```

    3. WHERE `uploadProgress` is initialized (the `uploadProgress = { ch, total: uploadSet.length, done: 0, failed: 0, files: ... }` literal), ADD two fields. Replace:
       ```js
           uploadProgress = {
             ch,
             total: uploadSet.length,
             done: 0,
             failed: 0,
             files: new Map(uploadSet.map(e => [e.path, { state: 'pending', attempt: 0, error: '' }])),
           };
       ```
       With:
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

    4. IN THE SUMMARY block at the end of the `try`, BOTH branches need resume-state housekeeping:
       - In the `if (failCount === 0)` branch, AFTER `hideUploadProgress(ch);`, add: `clearResumeState(ch);`
       - In the `else` branch (failures), AFTER the `status.textContent = ...` line, add: `persistResumeState(ch, true);`

    5. IN THE `catch (err)` block of `uploadFiles`, the cancellation path should persist resume state. After the existing `if (err.message === 'cancelled' || uploadController?.signal.aborted)` branch's `status.textContent`/`status.style.color` lines, add (still inside the if): `persistResumeState(ch, true);`

    6. IN THE `finally` block, AFTER `uploadController = null;`, add a final UI refresh for the resume button: `renderResumeButton(ch);`

    **Edit C — Modify `runUploadQueue` (added by Plan 02) to persist after each file transition. Find the two state-write spots inside the inner `worker()` function (the `st.state = 'done'` block and the `st.state = 'failed'` block) and add a persist call after each counter increment. Replace:**
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

    **Edit D — Render the resume button on page load. Find the `DOMContentLoaded` handler (currently at static/index.html:223). At the END of its body (after the existing `for (const ch of ['a','b']) { ... }` setup loop which currently ends around line 246, BEFORE the closing `});` of the handler), append:**
    ```js
      renderResumeButton('a');
      renderResumeButton('b');
    ```

    After all edits run a build to confirm the embedded HTML still embeds cleanly:
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
    - `grep -c "sync_resume_'" static/index.html` returns at least 1 (key prefix concatenation in `resumeKey`)
    - `grep -c "renderResumeButton('a')" static/index.html` returns at least 1 (DOMContentLoaded)
    - `grep -c "renderResumeButton('b')" static/index.html` returns at least 1 (DOMContentLoaded)
    - `grep -c "persistResumeState(ch, false)" static/index.html` returns exactly 2 (success + failure branch of worker)
    - `grep -c "persistResumeState(ch, true)" static/index.html` returns at least 2 (cancel path + partial-fail summary)
    - `grep -c "clearResumeState(ch)" static/index.html` returns at least 2 (start of upload + full success)
    - `grep -c "savedResume.manifest" static/index.html` returns at least 1 (hashing-shortcut path)
    - `go build -o /tmp/sync-temple-plan03 ./...` exits with status 0
    - Manual smoke (executor MUST run): start server, drag a folder of ~20 files, confirm the picker opens, click "Upload selected", then cancel the upload mid-flight after a few files complete. Confirm in DevTools Application → Local Storage that `sync_resume_a` exists with `files_done >= 1` and `files_total === 20`. Reload page. Confirm the Resume row appears inside the Channel A drop zone with text "N / 20 files remaining". Click Resume, re-select the same folder, confirm the picker opens, click Upload selected, confirm in DevTools that the diff request body's `files` map contains the previously hashed paths (the hashing phase is fast because most hashes come from `savedResume.manifest`). The second upload pass only POSTs the previously-failed/missing files. After full success, confirm `sync_resume_a` is gone from localStorage.
    - Manual smoke 2: trigger another cancelled upload, then click Discard on the Resume row. Confirm `sync_resume_a` is removed from localStorage and the Resume row disappears.
    - Plan 02 regression check (executor MUST run): a fresh, uncancelled upload of 50 files still completes cleanly with no Resume row appearing afterwards. The concurrency cap, retry, and cancel behaviors from Plan 02 are unchanged.
  </acceptance_criteria>
  <done>
    Resume state persists across page reloads, the Resume button appears when state exists, clicking Resume + re-selecting the folder reuses the saved manifest hashes (skipping re-hash), diff identifies remaining work, the queue uploads only the remaining files, and on full success the resume marker auto-clears. Discard removes the marker without uploading. No regressions in Plan 02 behaviors.
  </done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| browser localStorage ↔ JS | localStorage is same-origin; an attacker with XSS could read/write it, but this is no worse than current state. |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-01-11 | T (Tampering) | corrupt/forged localStorage entry could crash JS | mitigate | `loadResumeState` wraps `JSON.parse` in try/catch and returns null on parse error. |
| T-01-12 | I (Info Disclosure) | hashes + paths in localStorage | accept | Same-origin only; sync_temple is single-tenant; user already has full filesystem access. |
| T-01-13 | D (DoS) | persistResumeState fires on every transition | mitigate | 500ms throttle gate via `lastPersistAt` timestamp; `force=true` only at terminus events. |
</threat_model>

<verification>
- localStorage entry `sync_resume_a` exists after a cancelled/partially-failed upload and disappears after full success.
- Resume row renders on page load when state exists, vanishes when state is cleared.
- Resume path skips re-hashing for files whose path appears in the saved manifest — observable as a faster Hashing phase on resume vs. a fresh upload of the same folder. Optionally add `console.time('hash')` for the smoke transcript.
- Discard button clears state and removes the Resume row.
- All Plan 02 success criteria still hold (no regression in concurrency, retry, progress UI).
</verification>

<success_criteria>
- All `<acceptance_criteria>` grep counts and build checks pass.
- Both manual smoke flows pass (cancel-and-resume, discard) plus the Plan 02 regression check.
- UPLOAD-05 marked satisfied.
- All five Phase 1 ROADMAP success criteria are now satisfied end-to-end (Plan 01 covers #5; Plan 02 covers #1, #2, #3; Plan 03 covers #4).
</success_criteria>

<output>
After completion, create `.planning/phases/01-upload-reliability/01-03-SUMMARY.md` capturing:
- Final line ranges of `persistResumeState`, `clearResumeState`, `loadResumeState`, `renderResumeButton`, `resumeUpload`
- localStorage payload schema observed after a cancelled upload (paste raw JSON)
- Smoke transcripts: cancel-then-resume cycle (with hashing speedup evidence) and discard cycle
- Plan 02 regression check result
- Confirmation that all five ROADMAP success criteria for Phase 1 are demonstrably satisfied
</output>

## Decision Coverage

This plan addresses the following CONTEXT.md decisions (from `01-CONTEXT.md`):

- D-05: Resume reuses existing `/api/{ch}/diff` endpoint — `resumeUpload` triggers the existing picker flow (`input.click()` → change handler → `openPicker` → `confirmPicker` → `uploadFiles` → `/api/{ch}/diff`). No server-side session state added.
- D-06: Resume state stored in `localStorage` keyed by `sync_resume_{channel}` — `persistResumeState`/`loadResumeState` write/read the canonical shape `{started_at, files_total, files_done, files_failed[], manifest}`.
- D-07: Resume state auto-cleared on full success AND on new upload start — `clearResumeState(ch)` called at top of `uploadFiles` (snapshot then clear) and in the `if (failCount === 0)` success branch.

Note on D-05 optional polish: the picker COULD pre-populate `pickerExcluded` from `savedResume.manifest` minus `savedResume.files_failed` so the user sees the picker open with only remaining files pre-checked. This is OPTIONAL and not part of the must_haves — the diff-only path already delivers UPLOAD-05 because the server's diff endpoint reports `same` for already-uploaded files and the queue only POSTs the missing ones. Implement only if executor bandwidth allows.
