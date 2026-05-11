# External Integrations

**Analysis Date:** 2026-05-11

## APIs & External Services

**Public Web Interface:**
- HTTPS endpoint: `https://sync.0xxi.cloud` (reverse proxied via Caddy)
- API base path: `/api/{channel}` where channel is `a` or `b`

**No third-party API integrations detected.**
- Server does not call any external APIs
- No cloud storage, SaaS, or external service integrations
- No webhooks to third-party systems

## Data Storage

**Databases:**
- None - no traditional database engine
- All data stored as files in filesystem

**File Storage:**
- Local filesystem only
- Default location: `./data/` (relative to working directory)
- Production location: `/var/db/sync_temple` (FreeBSD jail)
- Directory structure:
  - `{datadir}/a/files/` - Channel A uploaded files
  - `{datadir}/a/text.txt` - Channel A text storage
  - `{datadir}/b/files/` - Channel B uploaded files
  - `{datadir}/b/text.txt` - Channel B text storage

**Caching:**
- None - no caching layer
- Live updates via Server-Sent Events (SSE) for file change notifications

## Authentication & Identity

**Auth Provider:**
- Custom bearer token (no external provider)
- Implementation approach:
  - Token: 32-character hex string (16 random bytes from `crypto/rand`)
  - Mechanism: `Authorization: Bearer <token>` header or `?token=<token>` query param
  - Validation: Constant-time comparison in `main.go` line 88 using `crypto/subtle.ConstantTimeCompare()`
  - Scope: Per-deployment (single token per server instance)
  - Environment variable: `SYNC_TEMPLE_TOKEN` (CLI and UI)

**No user management:**
- Single shared token per deployment
- No per-user isolation or role-based access control

## Monitoring & Observability

**Error Tracking:**
- None detected
- No error reporting service integration

**Logs:**
- Standard output to console
- Server startup info logged (`fmt.Printf` in `main.go`)
- HTTP server errors via Go's `log.Fatal()` on fatal startup errors
- No persistent logging to file (must be captured by service manager or redirect)
- CLI tools (`sync`, `sync-temple`) print progress to stdout/stderr

## CI/CD & Deployment

**Hosting:**
- FreeBSD jail on vpstracker infrastructure
- Jail name: `sync`
- IP: `127.0.1.7` (internal, not public)
- Public access: via Caddy reverse proxy at `sync.0xxi.cloud`

**Reverse Proxy:**
- Caddy handles TLS termination
- Configuration: `Caddyfile` (in `caddy` jail)
  ```
  sync.0xxi.cloud {
      reverse_proxy 127.0.1.7:8787
  }
  ```

**DNS:**
- Cloudflare proxy (DNS only, not orange cloud)
- A record: `sync.0xxi.cloud` → `159.195.29.107`

**CI Pipeline:**
- None detected
- Manual binary deployment via `setup-sync-jail.sh`

**Deployment Script:**
- `setup-sync-jail.sh` - Automated jail setup:
  - Copies binary to `/usr/local/bin/sync-temple`
  - Installs rc.d service script
  - Configures pf firewall rules
  - Updates Caddy config
  - Requires FreeBSD bastille and doas(1) for privilege escalation

**Service Management:**
- FreeBSD rc.d via `sync_temple.rc`
- Command: `bastille service sync sync_temple restart`
- Starts as daemon with `-f` flag and logs to syslog

## Environment Configuration

**Required env vars:**
- `SYNC_TEMPLE_URL` - Server URL (e.g., `https://sync.0xxi.cloud`) - CLI only
- `SYNC_TEMPLE_TOKEN` - Authentication token - required for CLI and UI login

**Optional env vars:**
- `SYNC_TEMPLE_TOKEN` env var in jail config (set during setup)

**Secrets location:**
- Token stored in FreeBSD rc.d config via `sysrc` in `sync_temple.rc`
- Local machine: stored in shell profile (`~/.zshrc`) or shell alias setup
- Web UI: stored in sessionStorage (browser memory, cleared on tab close)
- Python CLI: reads from environment variables only

**No secrets files:**
- No `.env` files in codebase
- No credential files
- Token is the only secret (environment-based)

## Webhooks & Callbacks

**Incoming:**
- None - no webhook endpoints
- API endpoints are request/response only

**Outgoing:**
- None - server does not call external services

## Real-time Communication

**Server-Sent Events (SSE):**
- Endpoint: `GET /api/{channel}/events`
- Purpose: Live file update notifications
- Implementation: `main.go` lines 416-441
  - Pub/sub pattern with channels
  - Subscribers notified on upload/delete/clear operations
  - Auto-reconnect with 5-second backoff on error (UI)

## Cross-Origin & Network

**CORS:**
- Not explicitly configured in Go server
- Browser allows same-origin requests (static UI at `/`)
- Cross-origin requests from different domain require browser preflight

**Network Model:**
- Server listens on single address:port
- Supports concurrent requests (Go net/http handles)
- Multipart uploads with 10MB size limit per read (`io.LimitReader` in `handleSetText`)
- Batch uploads limited by Cloudflare 100MB request limit (UI batches at 15MB)

## File Transfer Protocol

**Upload:**
- Endpoint: `POST /api/{channel}/upload`
- Format: `multipart/form-data` with file parts
- Handler: `main.go` lines 231-279

**Download:**
- All files: `GET /api/{channel}/download` → ZIP
- Selected files: `POST /api/{channel}/download` → ZIP (body: `{"files": [...]}`)
- Handler: `main.go` lines 281-314

**Zip compression:**
- Uses Go stdlib `archive/zip`
- Applied to all downloads for efficient transfer

## Data Formats

**JSON:**
- Diff request: `{"files": {path: hash}}`
- File listing: `{path: {hash, size}}`
- Text push: plain text (not JSON)
- Delete request: `{"files": [paths]}`
- Download selected: `{"files": [paths]}`

**Hashing:**
- Algorithm: SHA-256
- Format: hexadecimal string
- Used for: file change detection, integrity checking

---

*Integration audit: 2026-05-11*
