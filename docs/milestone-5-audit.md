# NetPulse Milestone 5 Completion Audit

**Audit scope:** Milestones 1-5  
**Audit date:** 2026-11-01  
**Branch:** `feature/milestone-4-history-outage-analysis`  
**Audit result:** **PARTIAL / NOT RELEASE-READY FOR PUBLIC DEPLOYMENT**

The local-first application is functioning and the Milestone 5 hardening changes pass the repository verification suite. Public deployment is not approved because the application remains unauthenticated/local-only and `npm audit --omit=dev --audit-level=moderate` reports three high-severity Prisma-toolchain advisories whose automatic fix requires a breaking Prisma major upgrade.

## Status legend

- **PASS** — verified by code inspection and/or an executed deterministic test.
- **PARTIAL** — the core behavior works, but an acceptance or operational boundary remains.
- **FAIL** — a verified defect was found and fixed during this audit.
- **NOT IMPLEMENTED** — no repository implementation exists.
- **NOT VERIFIED** — the repository has no deterministic test or the check was not executable in this audit.

## 1. Project structure and code quality

| Check | Status | Evidence |
|---|---|---|
| Frontend/backend/workspace separation | PASS | `apps/web`, `apps/api`, and `packages/contracts`; root npm workspaces in `package.json`. |
| Shared WebSocket contracts | PASS | `packages/contracts/src/index.ts`; API and browser import the shared event types. |
| Type safety and production build | PASS | `npm run lint` and `npm run build` passed. |
| Environment defaults | PASS | `apps/api/src/config.ts` now rejects non-finite numeric values and clamps operational limits. |
| Secrets and local artifacts excluded | PASS | `.gitignore` excludes `.env.*` except `.env.example`, databases, logs, build output, coverage, and caches; `git check-ignore` verified representative paths. |
| Fresh install path | PARTIAL | `npm ci` is defined by the lockfile and CI; a clean checkout install was not repeated locally during this audit. |
| Dead code/duplicate logic | PARTIAL | No blocking unused dependency was found, but the frontend is intentionally a compact single component and has no component-test layer. |

## 2. HTTP, TCP, and ICMP monitoring

| Check | Status | Evidence |
|---|---|---|
| Real HTTP measurements | PASS | `apps/api/src/probe.ts`; timeout, response-size, status, redirect, and validation tests in `probe.test.ts`. |
| Real TCP measurements | PASS | `apps/api/src/tcp-probe.ts`; local deterministic success/refusal/DNS tests in `tcp-probe.test.ts`. |
| Real ICMP invocation | PASS | `apps/api/src/icmp-probe.ts` uses `spawn` with `shell: false`; parser tests in `icmp-probe.test.ts`. |
| Monotonic latency and resource cleanup | PASS | HTTP/TCP/ICMP use `performance.now()` and clear/destroy timers, sockets, requests, and child processes on completion paths. |
| DNS/private-address/redirect protections | PASS | `target.ts` validates all resolved addresses; HTTP connects to the validated address and does not follow redirects; IPv4/IPv6/rebinding tests passed. |
| Local override cannot enable production access | PASS | `config.ts` only enables the override in `development` or `test`; regression coverage exists in `target.test.ts`. |
| Error classification completeness | PASS | TCP now distinguishes DNS failures, timeouts, refusals, and non-refusal socket errors; deterministic refusal/DNS coverage passed. |

## 3. Scheduler and lifecycle

| Check | Status | Evidence |
|---|---|---|
| Enabled monitors start and restart | PASS | `startScheduler()` loads enabled monitors; `server.ts` starts it after API creation. |
| Disabled monitors do not start probes | PASS | `runProbe()` checks `monitor.enabled`; outage updates now also stop when a monitor is disabled. |
| One in-flight probe per monitor | PASS | Scheduler `active` set and scheduler persistence test. |
| Pause/resume/delete scheduling | PARTIAL | `PATCH` pause/resume and delete clear timers; no dedicated API integration test covers every lifecycle transition. |
| Interval changes reschedule safely | PARTIAL | The API does not currently expose interval/timeout edits, so this behavior is not available to verify. |
| Graceful shutdown | PASS | `server.ts` stops scheduler, closes WebSocket, awaits HTTP close, disconnects Prisma, and guards duplicate shutdown. |
| Unhandled scheduler failures | PASS | Creation/resume scheduling and periodic probe/retention tasks now attach error handlers and structured logs. |

## 4. Database and history

| Check | Status | Evidence |
|---|---|---|
| Prisma relationships/indexes/migrations | PASS | `schema.prisma` and migrations for monitors, measurements, and outages; `npm run db:migrate` reported in sync. |
| Restart persistence | PASS | SQLite migration path and persisted models are present; historical API queries read from SQLite. A full stop/start data replay was not repeated in this audit. |
| UTC timestamps | PASS | Prisma `DateTime` values are serialized as ISO timestamps; browser formats them locally. |
| Bounded historical queries | PASS | History API clamps `hours`, `page`, and `pageSize`; measurement and outage queries are bounded. |
| Retention and active outage preservation | PASS | `pruneHistory()` deletes old measurements and only closed outages; active outages use `endedAt: null` and are preserved. |
| Database failure responses | PARTIAL | Express 5 routes reach the structured error middleware, but database fault injection tests are not present. |

## 5. Outage detection and statistics

| Check | Status | Evidence |
|---|---|---|
| Three-failure threshold and recovery | PASS | `outages.test.ts`; configurable threshold is clamped to 2-10 and defaults to 3. |
| Duplicate outage prevention | PARTIAL | Active outage lookup prevents a second record in the single API process; no partial unique database constraint exists for multi-process deployment. |
| Restart-safe active outages | PASS | Active outage state is queried from SQLite on summary/history reads. |
| Pause does not create new outages | PASS | `updateOutageState()` now verifies the monitor remains enabled before changing outage state. |
| Packet loss and sampled availability | PASS | History API computes failed/completed and successful/completed; empty windows return `null`. |
| Latency statistics | PASS | Server-side aggregate computes average/minimum/maximum only for successful non-null latency samples. |
| Duration boundaries | PASS | Ongoing outages are bounded to query time and completed outages are clipped to the selected window. |
| API/dashboard consistency | PASS | Dashboard consumes history statistics returned by the API; no duplicate client formulas are used. |

## 6. WebSocket reliability

| Check | Status | Evidence |
|---|---|---|
| Post-persistence measurement events | PASS | Scheduler creates the measurement before emitting; scheduler test verifies persistence ordering. |
| Outage/recovery/status events | PASS | Shared contracts, `outages.ts`, and WebSocket integration test cover event delivery. |
| Multiple clients/origin limits | PASS | `websocket.test.ts`; origin and client-count checks in `websocket.ts`. |
| Reconnection and REST synchronization | PASS | Browser reconnect/backoff logic reloads monitors; measurement/status events trigger targeted REST reloads. |
| Heartbeat/listener cleanup | PASS | WebSocket heartbeat timer and event subscriptions are removed by `close()`. |
| Incoming event validation | PARTIAL | The server does not accept application messages, so `maxPayload` limits unsolicited frames, but there is no schema validation layer for client messages. |

## 7. Frontend and UX

| Check | Status | Evidence |
|---|---|---|
| HTTP/TCP/ICMP forms | PASS | `apps/web/src/main.tsx` has labeled probe-specific fields. |
| Real history and outage views | PASS | Dashboard renders latency-scaled real measurements and outage/recovery timestamps from REST. |
| Time filters/statistics | PASS | 1h/6h/24h/7d/30d controls call the bounded history endpoint. |
| Loading/error/empty states | PARTIAL | Empty and creation errors exist; history fetch failures and initial loading indicators are not explicit. |
| Mobile layout/accessibility basics | PARTIAL | Responsive grid, labels, status text, and contrast styles exist; no automated browser/accessibility test is configured. |
| Sensitive information exposure | PASS | UI displays configured targets and operational statuses only; no credentials or response bodies are returned. |

## 8. Security hardening

| Check | Status | Evidence |
|---|---|---|
| SSRF/redirect/DNS protections | PASS | Target and HTTP probe tests passed. |
| Input/query/body/response limits | PASS | Zod schemas, 16 KiB JSON limit, response byte limit, monitor limit, history bounds, and WebSocket max payload. |
| CORS and security headers | PASS | Exact configured CORS origin plus `nosniff`, `DENY`, referrer policy, and CSP headers; API tests assert headers. |
| Abuse prevention | PARTIAL | In-process per-client rate limit now exists; it is not distributed and manual probes do not have a separate quota. |
| Localhost-only binding | PASS | `server.ts` binds to `127.0.0.1`. |
| Dependency vulnerabilities | FAIL / BLOCKER | `npm audit --omit=dev --audit-level=moderate` reported 3 high-severity `deepmerge-ts` advisories through Prisma tooling; `npm audit fix --force` proposes Prisma 7.10.1 and a breaking change. |
| Public deployment security | NOT IMPLEMENTED | No authentication, CSRF model for public hosting, TLS termination, secrets manager, or multi-user controls. |

## 9. Automated testing and CI

| Check | Status | Evidence |
|---|---|---|
| Backend/probe/WebSocket tests | PASS | `npm test`: 33 tests passed across 9 files. |
| Lint/type checking | PASS | `npm run lint` passed. |
| Production build | PASS | `npm run build` passed. |
| CI configuration | PASS | `.github/workflows/ci.yml` runs `npm ci`, database generation/migration, tests, lint, and build. |
| Frontend component tests | NOT IMPLEMENTED | No component test runner or frontend test files exist. |
| Browser end-to-end tests | NOT IMPLEMENTED | No Playwright dependency or workflow exists. |
| Deterministic test fixtures | PASS | Probe and WebSocket tests use local servers/mocks; no public network is required by the suite. |

## 10. Documentation and release readiness

| Check | Status | Evidence |
|---|---|---|
| README reflects Milestones 1-5 | PASS | README now identifies Milestone 5 hardening and documents local-only limits. |
| Windows setup commands | PASS | README commands map to root npm scripts and Prisma migration scripts. |
| Environment variables/safe defaults | PASS | `.env.example`, README, and bounded config values document core settings. |
| Known limitations and roadmap | PASS | README separates implemented local monitoring from future browser E2E, Docker, alerts, and public deployment. |
| Clean checkout artifacts | PASS | Git ignore checks passed; no tracked secrets/databases/build output found. |

## Defects corrected during this audit

1. Added `.env.*`, log, coverage, and Vite cache exclusions while preserving `.env.example`.
2. Hardened numeric environment parsing so invalid values cannot become `NaN` limits or timer values.
3. Added error handling for monitor creation/resume scheduler promises.
4. Prevented a probe completing after pause from opening or extending an outage.
5. Updated README and implementation plan status to Milestone 5.

## Verification run

| Command | Result |
|---|---|
| `npm test` | **PASS — 33 tests, 9 files** |
| `npm run lint` | **PASS** |
| `npm run build` | **PASS** |
| `npm run db:generate` | **PASS after stopping stale dev-server processes that held the Prisma Windows engine lock** |
| `npm run db:migrate` | **PASS / schema synchronized** |
| `git diff --check` | **PASS** |
| API health smoke test | **PASS** |
| Invalid history-window smoke test | **PASS — HTTP 400** |
| `npm audit --omit=dev --audit-level=moderate` | **FAIL — 3 high-severity Prisma-toolchain advisories** |
| Frontend component/E2E tests | **NOT RUN — not configured** |

## Remaining risks ranked

1. **High — dependency advisory:** Prisma's dependency tree reports high-severity `deepmerge-ts` advisories. Resolve with a reviewed Prisma upgrade or accepted risk decision before public deployment.
2. **High — no authentication/public threat model:** the API is safe only as a loopback single-user application. Do not bind it publicly.
3. **Medium — in-process coordination:** outage uniqueness, rate limiting, scheduler state, and SQLite writes are not designed for multiple API processes.
4. **Medium — incomplete automated UI coverage:** frontend and browser behavior has no component or Playwright regression suite.
5. **Low — TCP diagnostics:** non-refusal socket errors are currently reported as `REFUSED` rather than a more precise network error.

## Milestone 6 readiness

**Conditionally ready for Milestone 6 development, not public release.** The current local Milestones 1-5 functionality is verified by the deterministic suite and production build. Before any public deployment or claiming production readiness, resolve the dependency advisory, add browser-level coverage, and define authentication/CSRF/TLS/operational controls.
