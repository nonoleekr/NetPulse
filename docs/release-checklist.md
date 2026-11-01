# NetPulse v0.1.0 Release Checklist

## Verification

- [x] `npm ci` installs from the lockfile.
- [x] Prisma client generation and non-destructive migrations pass.
- [x] `npm test` passes.
- [x] `npm run lint` passes.
- [x] `npm run build` passes.
- [x] Docker API and web images build on Docker Desktop Linux.
- [x] Docker Compose starts and the API reports healthy.
- [x] Container restart preserves the SQLite volume.
- [x] `npm audit --omit=dev --audit-level=high` is clean.
- [x] Deterministic Playwright E2E coverage is added and passes locally.
- [x] Docker REST, WebSocket, and real HTTP probe checks pass locally.

## Documentation

- [x] Windows local setup and troubleshooting are documented.
- [x] Docker Compose setup, logs, restart, and volume persistence are documented.
- [x] Security limitations and localhost defaults are documented.
- [x] Backup and restore commands are documented.
- [x] Changelog and recommended version are present.
- [x] GitHub release documents source-only installation; no binary or published
  container artifact is attached.
- [x] MIT license added for the local-first portfolio release.

## Approval gates

- [x] Resolve the Prisma/deepmerge-ts High advisory with Prisma 7.10.1 and
  compatibility-tested SQLite adapter changes.
- [x] MIT license selected for this release.
- [ ] Review Docker permissions and exposed ports for the intended host.
- [ ] Explicitly approve any tag, GitHub Release, image publication, or deploy.
