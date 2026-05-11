# Technology Stack

**Analysis Date:** 2026-05-11

## Languages

**Primary:**
- Go 1.22.0 - HTTP server implementation in `main.go`

**Secondary:**
- Python 3 - CLI tool in `sync` (requires python3)
- Shell (sh) - Service initialization in `sync_temple.rc` and setup script `setup-sync-jail.sh`
- JavaScript (ES6) - Web UI frontend in `static/index.html`
- HTML5 - Web UI markup in `static/index.html`
- CSS3 - Web UI styling in `static/index.html` (inline)

## Runtime

**Environment:**
- Go 1.22.0 (server binary compilation)
- Python 3.x (CLI execution)
- Shell (FreeBSD rc.d, bash/sh for setup)

**Package Manager:**
- Go modules (`go.mod`)
- Pip/built-in modules for Python (no requirements.txt)

**Server Binary:**
- Compiled macOS arm64 Mach-O executable: `sync-temple` (8.4 MB)
- Also available: `sync-temple-freebsd` (FreeBSD variant)

## Frameworks

**Core:**
- Go stdlib `net/http` - HTTP server and request handling
- Go stdlib `encoding/json` - JSON serialization/deserialization
- Go stdlib `archive/zip` - ZIP file creation for downloads
- Go stdlib `crypto/sha256` - File hash computation
- Go stdlib `sync` - Mutexes and channels for concurrency
- Go stdlib `io/fs` - Directory traversal and file operations

**Frontend:**
- Vanilla JavaScript (no framework)
- Browser native APIs: Fetch API, EventSource (SSE), WebCrypto (SHA-256), File API, DataTransfer

**CLI:**
- Python standard library: `argparse`, `urllib`, `hashlib`, `json`, `zipfile`, `ssl`
- No external dependencies

**Testing:**
- Not detected

**Build/Dev:**
- Not detected

## Key Dependencies

**Critical (Go stdlib only - zero external deps):**
- Go 1.22.0 standard library provides all functionality
- No third-party Go packages imported
- No external package manager required for server

**Infrastructure:**
- Go compiler (for building binary from source)
- FreeBSD bastille (for jailing on production)
- Caddy reverse proxy (frontend proxy, not a dependency)
- OpenSSL/TLS (runtime, provided by OS)

## Configuration

**Environment:**
- `SYNC_TEMPLE_URL` - Server URL (e.g., https://sync.0xxi.cloud)
- `SYNC_TEMPLE_TOKEN` - Authentication token (auto-generated if not provided to server, required for CLI)

**Build:**
- `go.mod` - Single module, no external dependencies
- Default binary output: `sync-temple` (run `go build -o sync-temple main.go`)

**Server Flags (main.go):**
- `-addr` - Listen address (default: `:8787`)
- `-data` - Data directory path (default: `./data`)
- `-token` - Auth token (auto-generated from 16 random bytes if empty)

**Service (FreeBSD rc.d):**
- `sync_temple.rc` - Service script with configurable:
  - `sync_temple_enable` - Enable/disable service
  - `sync_temple_token` - Token for this instance
  - `sync_temple_addr` - Listen address
  - `sync_temple_data` - Data directory (default: `/var/db/sync_temple`)

## Platform Requirements

**Development:**
- Go 1.22+ compiler
- Python 3.6+ (for CLI tool only)
- macOS, Linux, or FreeBSD

**Production:**
- FreeBSD (jail deployment in `setup-sync-jail.sh`)
- Alternative: Any OS that can run the Go binary (Linux, macOS, Windows)
- Caddy reverse proxy (for HTTPS termination and routing)
- Cloudflare DNS proxy (optional, for public access)
- pf firewall (for FreeBSD jail networking)

## Notable Technical Choices

**Zero external dependencies (Go):**
- All HTTP, crypto, compression, and file I/O uses Go stdlib
- Makes deployment trivial: single statically-compiled binary

**Embedded static assets:**
- Web UI (`static/index.html`) embedded into binary via `//go:embed` directive
- No separate file distribution needed

**Pure JavaScript frontend:**
- No build step, framework, or node_modules
- Inline CSS for minimal requests
- Works in any modern browser

**Pure Python CLI:**
- Standard library only (no pip install needed)
- Cross-platform (macOS, Linux tested; Windows path handling included)
- Self-contained in `sync` file

---

*Stack analysis: 2026-05-11*
