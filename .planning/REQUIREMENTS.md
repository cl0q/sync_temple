# Requirements: sync_temple

**Defined:** 2026-05-11
**Core Value:** Beliebig viele Dateien zuverlässig zwischen zwei Endpunkten austauschen — über Web-UI oder CLI — ohne mit unsichtbaren Limits gegen die Wand zu fahren.

## v1 Requirements

Milestone M1 "robust" — drei Workstreams: Upload-Reliability, CLI-Hardening, UI-Polish.

### Upload-Reliability

- [ ] **UPLOAD-01**: Browser kann Ordner mit ≥500 Dateien zuverlässig hochladen, ohne dass `WebKitBlobResource error 4` oder Connection-Drops auftreten
- [ ] **UPLOAD-02**: Browser throttelt parallele Uploads auf konfigurierbares Limit (Default 3-4 concurrent) statt unbeschränkter Promise.all-Flut
- [ ] **UPLOAD-03**: Fehlgeschlagene Datei-Uploads werden automatisch mit Exponential-Backoff retried (3 Versuche: 1s/3s/10s)
- [ ] **UPLOAD-04**: Browser zeigt pro-Datei-Progress + Gesamt-Fortschrittsbalken während des Uploads
- [ ] **UPLOAD-05**: Bei Abbruch kann der User vom letzten erfolgreichen Upload-Punkt fortsetzen ("Resume")
- [ ] **UPLOAD-06**: Server schützt sich mit `http.MaxBytesReader` (z.B. 500 MB) und gibt klare HTTP-Codes (413, 408) bei Limit-Verstößen statt stille Failures
- [ ] **UPLOAD-07**: Server löscht leere/halb-geschriebene Dateien automatisch bei Upload-Abbruch oder Fehler

### CLI

- [ ] **CLI-01**: CLI wird als richtiges Release-Binary ausgeliefert (Go-Binary, single executable, keine Python-Runtime-Abhängigkeit)
- [ ] **CLI-02**: CLI hat `--version`-Flag und Semantic Versioning (z.B. v1.0.0)
- [ ] **CLI-03**: CLI löst Pfade korrekt auf: relative Pfade gegen `pwd`, absolute Pfade direkt, `~`-Expansion, optional Glob-Patterns (`*.md`)
- [ ] **CLI-04**: Release-Pipeline via GitHub Actions: Tag pushen → Cross-Compile für macOS-arm64, macOS-amd64, Linux-amd64, FreeBSD-amd64
- [ ] **CLI-05**: Distribution: GitHub Releases (Binary-Download) und optional Homebrew-Tap
- [ ] **CLI-06**: CLI hat schöneres UX: farbiger Output (TTY-aware), klare Progress-Anzeige beim Upload, hilfreichere Fehlermeldungen, `--help` mit Subcommand-Struktur
- [ ] **CLI-07**: CLI prüft Server-Reachability + Token-Validität bevor sie Datei-Operationen startet (Fail-Fast statt halbe Uploads)

### Web-UI-Polish

- [ ] **UI-01**: UI hat sichtbares, kohärentes Visual-Design — eigener Charakter, gute Typografie, Spacing, Dark-Mode-tauglich
- [ ] **UI-02**: Detaillierte Fehler-Meldungen mit Action-Hints statt nur "Error: HTTP 413" (z.B. "Datei zu groß — max 500 MB. Komprimieren oder splitten.")
- [ ] **UI-03**: Manuelle Retry-Buttons bei fehlgeschlagenen Uploads — User kann einzelne oder alle gescheiterten Files erneut versuchen
- [ ] **UI-04**: Download-Progress mit Fortschrittsanzeige (statt blindem `<a>.click()`) via `fetch()` + streamed reader
- [ ] **UI-05**: Mobile-tauglich — Drag-Drop fällt sinnvoll auf File-Input zurück, Layout funktioniert auf Smartphone-Breiten

## v2 Requirements

Bewusst für später aufgehoben — wichtig, aber nicht in dieser Milestone.

### Performance

- **PERF-01**: Manifest-Caching — Hashes werden bei Upload/Delete invalidiert, nicht bei jedem Request neu berechnet
- **PERF-02**: Streaming-ZIP-Download — kein in-memory Buffer für große Downloads

### Robustness

- **ROB-01**: SSE-Heartbeat alle 30s + automatische Reconnect-Logik im Browser
- **ROB-02**: Rate-Limiting pro Token (z.B. 100 Requests/min)
- **ROB-03**: Path-Traversal-Schutz: `EvalSymlinks` zusätzlich zur `safePath`-Prüfung

### Quality

- **TEST-01**: Unit-Tests für `safePath`, `manifest`, Auth-Pfade (Go)
- **TEST-02**: Integration-Tests für Upload/Download-Round-Trip via `httptest`
- **TEST-03**: CLI-Test-Suite (Go testing)
- **TEST-04**: CI: `go test ./...` + `go vet` + `golangci-lint` als GitHub-Action

## Out of Scope

| Feature | Reason |
|---------|--------|
| Multi-Tenancy / >2 Kanäle | Tool ist 2-Endpunkt-Bridge; nicht im Produkt-Scope |
| User-Accounts / OAuth | Single-shared-Token reicht; Multi-User würde Storage-/Audit-Layer erfordern |
| Mobile-Native-App | Web-UI auf Mobile reicht |
| End-to-End-Encryption | TLS via Caddy reicht; E2E würde Browser-Crypto-UX bringen |
| File-Versioning / History | Sync-Tool, kein Git |
| Echtzeit-Chat | `text.txt` reicht für quick exchange |
| Cloud-Backup-Integration | Bewusst self-hosted |
| Per-Device-Tokens | Würde Multi-User-Pfade erzwingen |
| Komplette Server-Rewrite | Punktuelle Härtung, kein Architektur-Umbau |

## Traceability

| Requirement | Phase | Status |
|-------------|-------|--------|
| UPLOAD-01 | Phase 1 | Pending |
| UPLOAD-02 | Phase 1 | Pending |
| UPLOAD-03 | Phase 1 | Pending |
| UPLOAD-04 | Phase 1 | Pending |
| UPLOAD-05 | Phase 1 | Pending |
| UPLOAD-06 | Phase 1 | Pending |
| UPLOAD-07 | Phase 1 | Pending |
| CLI-01 | Phase 2 | Pending |
| CLI-02 | Phase 2 | Pending |
| CLI-03 | Phase 2 | Pending |
| CLI-04 | Phase 3 | Pending |
| CLI-05 | Phase 3 | Pending |
| CLI-06 | Phase 3 | Pending |
| CLI-07 | Phase 2 | Pending |
| UI-01 | Phase 4 | Pending |
| UI-02 | Phase 4 | Pending |
| UI-03 | Phase 4 | Pending |
| UI-04 | Phase 4 | Pending |
| UI-05 | Phase 4 | Pending |

**Coverage:**
- v1 requirements: 19 total
- Mapped to phases: 19
- Unmapped: 0 ✓

---
*Requirements defined: 2026-05-11*
*Last updated: 2026-05-11 — traceability filled by roadmapper (M1 "robust")*
