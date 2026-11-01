# Changelog

All notable changes to NetPulse are documented here.

## [0.1.0] - Unreleased

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
- The Prisma/deepmerge-ts production dependency advisory remains a release
  blocker until a compatible upgrade is validated.
- Browser component and Playwright end-to-end tests are not configured.
