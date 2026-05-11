# sync_temple

## What This Is

sync_temple ist ein selbst-gehostetes File-Sync-System für den schnellen, schlanken Austausch von Dateien und Texten zwischen zwei festen Kanälen ("a" und "b"). Es besteht aus einem Go-HTTP-Server (Single-Binary, Zero-Dependency), einer eingebetteten Web-UI (Drag-and-Drop, Live-Updates via SSE) und einer CLI für Skript- und Terminal-Workflows. Zielnutzer: ich selbst — als Brücke zwischen Geräten und Boxen, ohne Cloud-Provider und ohne fremde Konten.

## Core Value

**Beliebig viele Dateien zuverlässig zwischen zwei Endpunkten austauschen — über Web-UI oder CLI — ohne mit unsichtbaren Limits gegen die Wand zu fahren.**

Wenn Uploads bei 15 Dateien abbrechen, ist das ganze System nutzlos. Robustheit beim Upload schlägt jedes andere Feature.

## Requirements

### Validated

<!-- Aus existierendem Code abgeleitet — funktioniert bereits in production. -->

- ✓ **SYNC-01**: Server stellt zwei feste Kanäle (a, b) für bidirektionalen Datei-Austausch bereit — existing (`main.go`)
- ✓ **SYNC-02**: Token-basierte Auth (Bearer-Header oder `?token=`-Query, constant-time-Vergleich) — existing (`main.go:88`)
- ✓ **SYNC-03**: Diff-basierter Upload (Client hasht lokal SHA256, Server liefert client_only/server_only/different/same) — existing (`main.go:186-229`)
- ✓ **SYNC-04**: Multipart-Upload mit Batch-Logik (BATCH_MAX ≈ 15 MB pro Request) — existing (`static/index.html:631-712`, `sync` Python CLI)
- ✓ **SYNC-05**: ZIP-Download des kompletten Kanals oder einer Datei-Auswahl — existing (`main.go:282-315`)
- ✓ **SYNC-06**: SSE-Live-Updates (Browser bekommt Push, wenn andere Seite hochlädt/löscht) — existing (`main.go:416-441`)
- ✓ **SYNC-07**: Schneller Text-Austausch (`/api/{ch}/text`, max 10 MB) — existing (`main.go:395-414`)
- ✓ **SYNC-08**: Single-Binary-Deployment (Go stdlib only, kein externes Package, Web-UI via `//go:embed`) — existing
- ✓ **SYNC-09**: FreeBSD-Jail-Setup + `rc.d`-Service-Script — existing (`setup-sync-jail.sh`, `sync_temple.rc`)
- ✓ **SYNC-10**: Default-Ignore-Patterns für `.env`, `node_modules`, etc. — existing (`static/index.html:192`, `sync:39`)

### Active

<!-- Diese Milestone (M1: "robust") — Hypothesen bis ausgeliefert und validiert. -->

**Upload-Reliability (kritisch):**
- [ ] **UPLOAD-01**: Browser kann Ordner mit ≥500 Dateien zuverlässig hochladen, ohne dass `WebKitBlobResource error 4` oder Connection-Drops auftreten
- [ ] **UPLOAD-02**: Browser throttelt parallele Uploads auf konfigurierbares Limit (Default 3-4 concurrent) statt unbeschränkter Promise.all-Flut
- [ ] **UPLOAD-03**: Fehlgeschlagene Datei-Uploads werden automatisch mit Exponential-Backoff retried (3 Versuche: 1s/3s/10s)
- [ ] **UPLOAD-04**: Browser zeigt pro-Datei-Progress + Gesamt-Fortschrittsbalken während des Uploads
- [ ] **UPLOAD-05**: Bei Abbruch kann der User vom letzten erfolgreichen Upload-Punkt fortsetzen ("Resume")
- [ ] **UPLOAD-06**: Server schützt sich mit `http.MaxBytesReader` (z.B. 500 MB) und gibt klare HTTP-Codes (413, 408) bei Limit-Verstößen statt stille Failures
- [ ] **UPLOAD-07**: Server löscht leere/halb-geschriebene Dateien automatisch bei Upload-Abbruch

**CLI-Hardening:**
- [ ] **CLI-01**: CLI wird als richtiges Release-Binary ausgeliefert (Go-Binary, single executable, keine Python-Runtime-Abhängigkeit)
- [ ] **CLI-02**: CLI hat `--version`-Flag und Semantic Versioning
- [ ] **CLI-03**: CLI löst Pfade korrekt auf (relative, absolute, `~`-Expansion, optional Glob-Patterns)
- [ ] **CLI-04**: Release-Pipeline via GitHub Actions (Tag → Binary für macOS-arm64, macOS-amd64, Linux-amd64, FreeBSD-amd64)
- [ ] **CLI-05**: Distribution: GitHub Releases + optional Homebrew-Tap
- [ ] **CLI-06**: CLI hat schöneres UX (farbiger Output, klare Progress-Anzeige, hilfreichere Fehlermeldungen, `--help`-Struktur über Subcommands)
- [ ] **CLI-07**: CLI prüft Server-Reachability + Token-Validität bevor sie Datei-Operationen startet

**Web-UI-Polish:**
- [ ] **UI-01**: UI hat sichtbares, kohärentes Visual-Design (nicht nur "funktional") — eigener Charakter, gute Typografie, Spacing
- [ ] **UI-02**: Detaillierte Fehler-Meldungen mit Action-Hints statt nur "Error: HTTP 413"
- [ ] **UI-03**: Manuelle Retry-Buttons bei fehlgeschlagenen Uploads
- [ ] **UI-04**: Download-Progress mit Fortschrittsanzeige (statt blindem `<a>.click()`)
- [ ] **UI-05**: Mobile-tauglich (Drag-Drop fällt sinnvoll auf File-Input zurück)

### Out of Scope

- **Multi-Tenancy / mehr als 2 Kanäle** — Das Tool ist explizit ein 2-Endpunkt-Bridge; mehr Kanäle würde Architektur und Auth verkomplizieren
- **User-Accounts / OAuth** — Single-Shared-Token reicht für persönliche Nutzung; Multi-User würde Storage- und Audit-Layer brauchen
- **Mobile-Native-App** — Web-UI auf Mobile reicht; Native-App lohnt sich nicht
- **End-to-End-Encryption** — TLS via Caddy-Reverse-Proxy ist die einzige Sicherheitsebene; E2E würde Browser-Krypto-UX-Pain bringen
- **File-Versioning / History** — Es ist ein Sync-Tool, kein Git; alte Versionen werden überschrieben
- **Echtzeit-Chat** — `text.txt` reicht für quick exchange; richtiger Chat wäre Scope-Creep
- **Cloud-Backup-Integration** — Bewusst lokal/selbst-gehostet; kein S3/Backblaze/Dropbox
- **Mehr als ein Token** — Single-shared-Token bleibt; Per-Device-Tokens würden Multi-User-Pfade erzwingen

## Context

**Aktueller Stand:**

sync_temple läuft in Production auf einer FreeBSD-Jail hinter Caddy mit Cloudflare-Proxy (`sync.0xxi.cloud`). Server-Binary kompiliert ohne externe Dependencies (Go stdlib only). Web-UI ist in das Binary embedded via `//go:embed`. CLI ist aktuell ein Python-3-Script (`sync`) — der User dachte fälschlicherweise, es sei ein Shell-Alias; tatsächlich ist es Python, aber per Alias eingebunden und ohne Release-Pipeline.

**Bekannte Probleme (Codebase-Map):**

1. **Upload-Bug:** `static/index.html:677-703` batched Dateien zwar nach Größe (15 MB), wartet aber zwischen Batches nicht auf Browser-Connection-Pool. Bei 100+ Dateien überfordert das WebKit und führt zu `WebKitBlobResource error 4` + Connection-Drops. Keine Retry-Logik, kein Throttling, keine Resume-Capability.
2. **Server-Härtung fehlt:** kein `http.MaxBytesReader`, stille Failures in `handleUpload` (`main.go:269`), leere Dateien bleiben bei Abbruch liegen.
3. **CLI-Tech-Debt:** Python-Script per Shell-Alias, keine Versionierung, kein Release, keine Tests, brüchige Pfad-Behandlung.
4. **Zero Tests:** Keine `*_test.go`, keine CLI-Tests. Kritisch: `safePath`, `manifest`, auth-Pfade.
5. **Performance:** `manifest()` re-hasht den ganzen Tree bei jedem `/files`- oder `/diff`-Request — bei >1000 Dateien spürbar.

**Operations-Kontext:**
- Production-Domain: `sync.0xxi.cloud`
- FreeBSD-Jail via `bastille` + Caddy-Reverse-Proxy
- Service via `sync_temple.rc` (rc.d-Script)
- `MANUAL.md` dokumentiert Setup für Endnutzer

## Constraints

- **Tech-Stack-Lock-in (Server)**: Go stdlib only, keine externen Go-Dependencies — Begründung: Single-Binary, einfaches FreeBSD-Jail-Deployment, kein supply-chain-Risiko. Diese Regel gilt weiter.
- **Tech-Stack-Lock-in (Frontend)**: Vanilla JavaScript, kein Build-Step, kein Framework — Begründung: UI ist via `//go:embed` ins Binary geliefert; React/Vue würde Build-Pipeline erzwingen.
- **CLI-Sprache**: Wechsel von Python zu Go für die CLI — Begründung: Eine Sprache im Stack, single Binary, keine Python-Runtime-Abhängigkeit, einfacher Cross-Compile für FreeBSD.
- **Compatibility**: macOS-arm64, macOS-amd64, Linux-amd64, FreeBSD-amd64 müssen alle laufen.
- **Hosting**: FreeBSD-Jail mit `bastille`, Caddy als TLS-Termination. Diese Topologie bleibt.
- **Auth-Modell**: Single-Shared-Token. Keine User-Accounts in dieser oder absehbarer Milestone.
- **Backward-Compatibility**: Bestehende `SYNC_TEMPLE_URL`/`SYNC_TEMPLE_TOKEN`-Env-Vars und die zwei Kanäle (a, b) müssen weiter funktionieren.

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| CLI von Python nach Go portieren | Single-Language-Stack, single Binary, kein Runtime-Abhängigkeitsproblem, einfacher Cross-Compile | — Pending |
| Upload-Concurrency clientseitig limitieren (statt server-side throttling) | Bug-Root-Cause liegt im Browser-Connection-Pool; clientseitige Queue ist die direkte Korrektur | — Pending |
| Server-Härtung mit MaxBytesReader + klaren HTTP-Codes statt komplettem Rewrite | Minimal-invasiver Schutz, behält Single-Binary-Ansatz | — Pending |
| Zwei Kanäle (a/b) bleiben hard-coded | Bewusst: Tool ist 2-Endpunkt-Bridge, keine Multi-Tenancy | ✓ Good (locked in scope) |
| GitHub Actions als Release-Pipeline | Standard, kostenlos für Public Repos, Cross-Compile via `goreleaser` möglich | — Pending |

## Evolution

This document evolves at phase transitions and milestone boundaries.

**After each phase transition** (via `/gsd-transition`):
1. Requirements invalidated? → Move to Out of Scope with reason
2. Requirements validated? → Move to Validated with phase reference
3. New requirements emerged? → Add to Active
4. Decisions to log? → Add to Key Decisions
5. "What This Is" still accurate? → Update if drifted

**After each milestone** (via `/gsd-complete-milestone`):
1. Full review of all sections
2. Core Value check — still the right priority?
3. Audit Out of Scope — reasons still valid?
4. Update Context with current state

---
*Last updated: 2026-05-11 after initialization*
