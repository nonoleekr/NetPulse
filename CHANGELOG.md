# Changelog

All notable changes to NetPulse are documented here.

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
