# UI Migration Implementation Plan – sync_temple → wormhole‑v0 React UI

## 1. Align API contracts

| Current UI (static) | New UI (`wormhole‑v0`) | Action |
|----------------------|------------------------|--------|
| Calls `api(method, path, body?, extraHeaders?)` – token sent via **Bearer** header or `?token=` query string. | `lib/wormhole‑api.ts` uses the same helper (`fetch` with `Authorization: Bearer …`). | Verify that the helper in `wormhole‑v0` does **not** add the hard‑coded demo token. If it does, change it to read the token from `localStorage` (or a UI‑provided field) and send it unchanged. |
| Demo mode is unlocked when the token string equals `"demo"` (client‑side check). | Same check exists in the React code (see `components/lock-screen.tsx`). | Remove/guard the `"demo"` shortcut so it works only when an environment flag is set (e.g., `process.env.NEXT_PUBLIC_DEMO_MODE`). This prevents the production build from accepting the demo token. |

**Result** – Both front‑ends use identical authentication semantics; the React UI no longer allows the back‑door token unless explicitly enabled.

## 2. Build the React app as a **static export**

1. **Add an npm script** (in `wormhole‑v0/package.json`):
   ```json
   "scripts": {
     "build-static": "next build && next export"
   }
   ```
   `next export` writes a self‑contained `out/` directory with HTML, CSS, and JS assets.
2. **Run the build locally**:
   ```bash
   cd wormhole-v0
   npm ci          # install deps
   npm run build-static
   ```
   The `out/` folder now contains `index.html`, `/_next/*` bundles, etc.
3. **Optional sanity‑check** – Open `out/index.html` in a browser pointed at a running server (`http://localhost:8787`) and confirm the UI works (login, file‑pick, upload, download, SSE).

## 3. Replace the embedded static assets in `sync_temple`

1. **Backup the current UI** (just in case):
   ```bash
   cp -r sync_temple/static sync_temple/static-backup-$(date +%Y%m%d%H%M%S)
   ```
2. **Copy the exported React build into the embed directory**:
   ```bash
   rm -rf sync_temple/static/*
   cp -r wormhole-v0/out/* sync_temple/static/
   ```
3. **Update the Go embed directive** (if needed): ensure it covers sub‑folders, e.g. `//go:embed static/**`.
4. **Re‑compile the server**:
   ```bash
   cd sync_temple
   go build -o sync-temple .
   ```
5. **Deploy the new binary** on the FreeBSD VPS and restart the service (`service sync_temple restart` or the rc script).

## 4. Remove the demo‑mode backdoor from the production build

1. **Guard the demo check** in `wormhole‑v0/components/lock-screen.tsx` (or wherever it lives):
   ```tsx
   const DEMO_MODE = process.env.NEXT_PUBLIC_DEMO_MODE === "true";
   const isDemo = DEMO_MODE && token === "demo";
   ```
2. **Set the env flag only for a dedicated demo deployment** – never for production. For a demo container:
   ```bash
   NEXT_PUBLIC_DEMO_MODE=true npm run build-static
   ```
   For production omit the flag (defaults to `false`).
3. **Commit the change** before the static export step.

## 5. Verify functional parity

| Feature | How to test (manual) | Acceptance |
|---------|----------------------|------------|
| **Token entry** | Open UI, enter a real token, press Connect. UI stores the token in `sessionStorage` and all subsequent API calls include `Authorization: Bearer <token>`. | No 401 errors; server logs `auth OK`. |
| **Demo mode disabled** | Enter token `"demo"` and connect. UI should reject it (show error) – the server must return 401. | 401 → UI shows “Invalid token”. |
| **File upload** | Drag a folder onto a channel, confirm picker, watch per‑file progress bars. | All files appear in the channel’s file list and are present on the server’s `data/<ch>/files/`. |
| **Download ZIP** | Click “Download ZIP”. | Browser receives a valid ZIP containing the channel’s files. |
| **Quick text** | Push and pull text snippets. | Text appears on both sides, SSE updates instantly. |
| **SSE live updates** | Open two browsers, make a change in one, ensure the other updates without reload. | Immediate UI refresh. |
| **Responsive layout** | Resize to mobile width (`< 768 px`). | UI collapses to a single column, all controls remain usable. |

Automated testing can be added later (e.g., Cypress) but isn’t required for the initial migration.

## 6. Clean‑up and documentation

1. **Remove unused files** – delete the old `sync_temple/static/index.html` and any related JS helpers no longer referenced.
2. **Update `MANUAL.md`** – point the “Connect” instructions to the new UI (the token prompt remains identical).
3. **Add a “Demo mode” section** – explain how to build a demo instance (`NEXT_PUBLIC_DEMO_MODE=true`).
4. **Version bump** in `CLAUDE.md` and `REQUIREMENTS.md` to reflect the UI rewrite.

## 7. Optional – Serve the React UI from a separate static server

If you prefer not to embed the React build into the Go binary:
1. Host the `out/` directory behind Caddy (or any static file server) on a sub‑domain (e.g., `ui.sync.example.com`).
2. Update the Go server to only expose the API routes (`/api/...`) and set CORS headers to allow the UI origin.
3. Adjust the UI’s `BASE_URL` configuration accordingly.

This decouples UI builds from the Go binary and simplifies future UI upgrades.

## 8. Timeline (estimated)

| Day | Milestone |
|-----|-----------|
| 1   | Verify API compatibility, remove demo‑token check in React code. |
| 2   | Add `build-static` script, produce static export, copy to `sync_temple/static/`. |
| 3   | Re‑compile Go server, restart service, run manual verification checklist. |
| 4   | Clean up old files, update docs, commit changes. |
| 5   | (Optional) Set up separate static hosting if desired. |

---

**Bottom line** – Export the Next.js app as static assets, embed them with the existing Go `//go:embed` mechanism, and remove the hard‑coded demo token. This gives you a modern React UI without altering the server’s authentication model or breaking existing deployments on the FreeBSD VPS.
