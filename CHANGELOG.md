# Changelog

All notable changes to NetPulse are documented here.

## [Unreleased]

### Added

- Deterministic evidence-based analysis for latency baselines, sampled
  availability, repeated failures, outages, DNS, HTTP, TLS, and local/agent
  measurement attribution.
- Read-only bounded analysis API and dashboard with severity, evidence quality,
  supporting record IDs, insufficient-data states, and troubleshooting steps.
- Provider-independent AI boundary that is disabled by default, plus bounded
  sensitive-data redaction for any future explicitly approved integration.
- Authenticated loopback monitoring agent with single-use enrollment, Ed25519
  sessions, heartbeats, capability-scoped HTTP/TCP/ICMP tasks, and source
  attribution.
- On-demand TLS certificate inspection with trust, expiry, protocol, cipher,
  hostname matching, validity state, and connection timing details for HTTPS
  monitors.
- Advanced HTTP diagnostics with DNS, TCP, TLS, first-byte, and total timing;
  bounded response reads; and SSRF-safe redirect revalidation and address pinning.

### Fixed

- Prevented revoked agent state from being overwritten during asynchronous
  socket cleanup and added coordinator-restart reconciliation.
- Blocked hexadecimal IPv4-mapped IPv6 private targets in the agent validator
  and enforced one overall agent task deadline.
- Ignored malformed stored diagnostic JSON during analysis instead of treating
  it as trusted evidence.
- Serialized API test files that share the SQLite fixture, preventing
  nondeterministic database-lock timeouts under parallel Vitest workers.
- Updated pinned HTTP address lookup for Node runtimes that request all DNS
  results, preserving DNS-rebinding protection for monitoring and diagnostics.
- Closed WebSocket and HTTP resources deterministically during API shutdown.

### Project status

- Development is temporarily paused after Milestone 8.4. The published
  `v0.1.0` release remains unchanged; the accumulated work is a candidate for a
  future `v0.2.0` after final approval and release verification.

## [0.1.0] - 2026-11-01

### Added

- Real HTTP(S), TCP, and ICMP monitoring with SQLite persistence.
- Consecutive-failure outage detection, recovery tracking, history, retention,
  sampled availability, and packet-loss statistics.
- REST API with WebSocket notifications and reconnect synchronization.
- Local security controls for SSRF, DNS rebinding, request validation, bounds,
  rate limiting, structured logs, and safe shutdown.
- Responsive dashboard with pause/resume/delete controls and accessible
  loading, error, empty, and connection states.
- Multi-stage Dockerfile, Compose deployment, persistent database volume,
  migration-on-startup, health checks, and GitHub Actions verification.

### Known limitations

- The application has no authentication and is not approved for direct public
  Internet exposure.
- ICMP behavior depends on platform permissions; containers do not receive
  privileged ICMP access by default.
- Prisma 7.10.1 with the better-sqlite3 adapter is required; existing migration
  history is preserved, but back up valuable databases before upgrading.
- Browser component tests are not included; deterministic Playwright workflow
  coverage is included.

This release is for local installation and trusted-host Docker use only.
The GitHub release is source-only: no binary or published container image is
provided; Docker images are built locally from the tagged source.
Unauthenticated public deployment is unsupported.
