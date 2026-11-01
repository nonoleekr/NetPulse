# Milestone 8.1 Report — Advanced Diagnostics Foundation

## 1. Features implemented

- Added typed diagnostic contracts for DNS and route results, statuses, capabilities, errors, and timing.
- Added persisted `DiagnosticRun` records with a versioned SQLite migration.
- Added user-initiated `POST /api/monitors/:id/diagnostics` and bounded history retrieval.
- Added real DNS A/AAAA resolution with monotonic timing and distinct resolved, absent, and failed states.
- Added Windows-first `tracert` execution and platform-aware `traceroute` support without shell interpolation.
- Added timeout, cancellation, output-size, hop-count, and concurrent-diagnostic limits.
- Added a dashboard Diagnostics section with loading, error, empty, unsupported, timing, DNS, and route states.

## 2. Architecture and data flow

The API derives a hostname from an existing monitor, reuses the central target validator, creates a `DiagnosticRun`, executes one bounded diagnostic, and persists the structured result as JSON. The dashboard uses REST for the authoritative diagnostic result; diagnostics are not scheduled and do not affect monitoring measurements or outage state.

## 3. Modified files

- `packages/contracts/src/index.ts`
- `apps/api/src/dns-diagnostic.ts`
- `apps/api/src/route-diagnostic.ts`
- `apps/api/src/diagnostics.ts`
- `apps/api/src/app.ts`
- `apps/api/src/config.ts`
- `apps/api/src/prisma/schema.prisma`
- `apps/api/prisma/migrations/20261101130000_add_diagnostics/migration.sql`
- `apps/api/src/dns-diagnostic.test.ts`
- `apps/api/src/route-diagnostic.test.ts`
- `apps/web/src/main.tsx`
- `apps/web/src/style.css`
- `README.md`

## 4. Verification

- PASS — 83 API/unit tests, including DNS, route, and API validation tests.
- PASS — TypeScript checks and production build.
- PASS — 2 Playwright regression tests.
- PASS — Prisma migration applied to an isolated SQLite database.
- PASS — `npm audit --audit-level=high` (0 vulnerabilities).
- NOT VERIFIED — Docker runtime diagnostics and live Windows `tracert` output were not run in this pass.

## 5. Platform limitations

Route diagnostics use `tracert` on Windows and require the platform command to be available. Linux/macOS use `traceroute` when installed. Other platforms return an explicit unsupported result. Network policy, permissions, and non-responsive hops can produce incomplete routes; an unknown hop is not treated as an outage.

## 6. Security assessment

Diagnostics are monitor-scoped, local-first, rate-limited by the existing API controls, concurrency bounded, timeout bounded, output bounded, and use fixed subprocess argument arrays with `shell: false`. Existing SSRF validation is applied before DNS or route execution. The API remains unauthenticated and is not suitable for public exposure.

## 7. Remaining defects and risks

- Diagnostic records currently retain JSON results without a separate retention policy; future operations work should add bounded cleanup if history grows.
- DNS resolver promises cannot cancel an in-flight OS resolver call; the API timeout bounds the request and prevents follow-on network use.
- Route destination matching is conservative and may not mark a hostname as reached when tools emit only a numeric address.
- No TLS/HTTP diagnostics, remote agents, authentication redesign, or AI analysis are included.

## 8. Recommended next steps

Review this slice before Milestone 8.2. If diagnostics history is retained, add retention cleanup and API pagination. Do not expose the unauthenticated local API publicly.
