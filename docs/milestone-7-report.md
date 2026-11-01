# NetPulse Milestone 7 Report

## 1. Release readiness assessment

Milestones 1-6 were verified from the existing branch and preserved. The
application has real HTTP, TCP, and ICMP probes, SQLite history, outage
detection, WebSocket updates, retention cleanup, structured logs, safe local
defaults, and a production frontend build.

Remaining release blockers are known and explicit: no authentication/TLS for
public hosting.

## 2. Implemented deployment capabilities

- Added a secure `HOST` configuration with `127.0.0.1` as the default.
- Added same-origin production API and WebSocket routing for the static web
  container while preserving Vite localhost development behavior.
- Added multi-stage [`Dockerfile`](../Dockerfile) targets for API and web.
- Added non-root API runtime, persistent `/data` volume, startup migrations,
  Compose health checks, restart policies, and Nginx REST/WebSocket proxying.
- Added root `.env.example`, `.dockerignore`, backup/restore instructions,
  changelog, release checklist, and this report.
- Extended GitHub Actions with least-privilege permissions, Docker builds, and
  dependency audit gating. No image publishing or deployment was added.

## 3. Files created or modified

- [`Dockerfile`](../Dockerfile)
- [`docker-compose.yml`](../docker-compose.yml)
- [`docker/api-entrypoint.sh`](../docker/api-entrypoint.sh)
- [`docker/nginx.conf`](../docker/nginx.conf)
- [`.dockerignore`](../.dockerignore)
- [`.env.example`](../.env.example)
- [`apps/api/src/config.ts`](../apps/api/src/config.ts)
- [`apps/api/src/config.test.ts`](../apps/api/src/config.test.ts)
- [`apps/api/src/server.ts`](../apps/api/src/server.ts)
- [`apps/api/package.json`](../apps/api/package.json)
- [`package.json`](../package.json)
- [`apps/web/src/main.tsx`](../apps/web/src/main.tsx)
- [`.github/workflows/ci.yml`](../.github/workflows/ci.yml)
- [`README.md`](../README.md)
- [`CHANGELOG.md`](../CHANGELOG.md)
- [`docs/release-checklist.md`](./release-checklist.md)

## 4. Docker verification

The Docker Desktop Linux engine became available during remediation. Verified:

- `docker compose build` passes for both API and web targets.
- `docker compose up -d` starts both services and the API health check becomes
  healthy.
- REST health and the dashboard are reachable through Nginx.
- An authorized WebSocket handshake through Nginx receives
  `connection.ready`; unauthorized origins remain rejected by the API.
- A real HTTP monitor can be created in the container, executes a probe, and
  remains persisted after an API container restart.
- The SQLite data volume is preserved by restart and ordinary `down` (without
  `-v`).

The default host port `8080` was occupied by another local service, so these
checks used `NETPULSE_WEB_PORT=18080`. The Docker image now explicitly installs
OpenSSL, generates Prisma Client during the image build, and uses Unix line
endings for the entrypoint. ICMP remains environment-dependent and no
privileged container capability is granted.

## 5. CI/CD and test results

Passed locally:

- `npm test`: 72 tests across 18 files.
- `npm run lint`: contracts, API, and web passed.
- `npm run build`: API, contracts, and Vite production build passed.
- `npm run e2e`: 2 Playwright tests passed against an isolated SQLite database
  and deterministic localhost HTTP fixture. Coverage includes real monitor
  creation/measurement and pause/resume/delete workflows.
- `npm ci`: completed successfully; this workstation's npm script policy
  required the documented follow-up `npm run db:generate`.
- Prisma client generation and existing migration state passed previously and
  remain non-destructive.
- Vitest was upgraded to `4.1.12`; the previously reported development-only
  Vitest advisories are no longer present in the audit output.
- Prisma was upgraded to `7.10.1` with the required SQLite adapter and
  generated-client configuration. Production and full audits report zero
  vulnerabilities.

Not verified locally:

- Full GitHub Actions execution; workflow was updated but not pushed or
  executed remotely.

The full and production-only dependency audits pass with zero vulnerabilities.

## 6. Security and deployment restrictions

Local API binding remains `127.0.0.1` by default. Docker explicitly sets
`HOST=0.0.0.0` only inside the private Compose network and exposes Nginx on the
configured host port. Local-target overrides remain disabled in production.
The Docker image does not grant privileged ICMP access by default.

This is not a public deployment. The API has no authentication, TLS, or
distributed abuse prevention. Do not publish port 4000 or expose the Compose
stack directly to the Internet.

## 7. Installation verification

The documented Windows path uses `npm ci`, Prisma generation/migration, and
`npm run dev`. These commands were previously exercised in the repository
environment. The Docker path was verified with the Docker Desktop Linux engine. No
credentials or user database were deleted or reset.

## 8. Database persistence and migration safety

The API container runs `prisma migrate deploy` before starting. Migrations are
versioned and non-destructive; SQLite is stored at `/data` on the named
`netpulse-data` volume. Backup and restore commands are documented. Container
recreation without `down -v` preserves the volume. Migration rollback is not
automatic; restore a verified backup and deploy a forward-compatible version.

## 9. Remaining issues

1. Select and approve a software license; none was added without confirmation.
2. Add authentication, TLS, and public threat-model controls before hosting.

## 10. Recommended release version

The recommended initial semantic version is **`v0.1.0`**, reflecting a useful
local-first portfolio release that is not yet a public hosted service.

## 11. Final verdict

**Release preparation complete; release approval blocked.** NetPulse has
reproducible local installation instructions, passing local tests including
deterministic Playwright coverage, Docker/Compose packaging, CI gates,
persistent storage design, and release documentation. Do not tag, publish,
deploy, or call the project publicly release-ready until public-hosting
controls are implemented.
