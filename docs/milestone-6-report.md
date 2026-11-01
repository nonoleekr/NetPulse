# NetPulse Milestone 6 Completion Report

## 1. Initial assessment

Milestones 1-5 were present and functional on the existing development branch.
The API already had local-only binding, structured JSON logging, bounded probes,
outage persistence, retention, WebSocket reconnection, and REST synchronization.
The frontend had the core monitor form and history display, but it treated
network failures as unhandled promises and did not expose the existing
pause/resume/delete lifecycle operations.

The most important reliability risk was a race in which an in-flight probe could
finish after its monitor had been deleted and attempt to persist a measurement.
The dashboard also lacked explicit loading, empty, unavailable, and action
feedback states. No new dependency or architectural rewrite was justified.

## 2. Issues discovered

| Severity | Issue | Status |
| --- | --- | --- |
| High | In-flight probe could persist after monitor deletion | Fixed with a post-probe monitor existence check and regression test |
| Medium | Dashboard fetch failures could become unhandled promise rejections | Fixed with a shared request helper and visible error states |
| Medium | Pause/resume/delete API existed but was not available in the dashboard | Fixed with guarded controls and delete confirmation |
| Low | Startup scheduler failure could reject after the HTTP server had already started | Fixed with startup logging and orderly shutdown |
| Low | Responsive and keyboard states were under-specified | Fixed with responsive layout, focus-visible styling, status text, and reduced motion |

## 3. Improvements implemented

- `runProbe()` rechecks monitor existence after the network operation and before
  measurement persistence. Deleted monitors no longer receive late measurements.
- API startup now logs `server.startup_failed` and closes the WebSocket server,
  scheduler, HTTP listener, and Prisma client if scheduler initialization fails.
- The dashboard uses a bounded request helper with actionable API-unavailable
  errors, loading and empty states, history error states, disabled action
  controls, and status announcements.
- Added pause/resume actions and a confirmation before deleting a monitor and
  its history.
- Refined the existing visual system without adding dependencies: clearer
  hierarchy, labels, responsive cards/forms, high-visibility focus rings,
  status text plus color, compact action controls, and reduced-motion support.

## 4. Files changed

- [`apps/api/src/scheduler.ts`](../apps/api/src/scheduler.ts)
- [`apps/api/src/server.ts`](../apps/api/src/server.ts)
- [`apps/api/src/scheduler.test.ts`](../apps/api/src/scheduler.test.ts)
- [`apps/web/src/main.tsx`](../apps/web/src/main.tsx)
- [`apps/web/src/style.css`](../apps/web/src/style.css)
- [`README.md`](../README.md)
- [`docs/milestone-6-report.md`](./milestone-6-report.md)

Earlier uncommitted Milestone 5 security/audit changes remain preserved and are
not discarded by this milestone.

## 5. Verification

| Command/check | Result |
| --- | --- |
| `npm test` | 36 tests passed across 9 files |
| `npm run lint` | Passed for contracts, API, and web |
| `npm run build` | Passed; Vite production bundle generated |
| API live smoke test | Passed: `GET /api/health` returned `{"data":{"status":"ok"}}` |
| `git diff --check` | Passed before final documentation edits |
| Browser component/E2E tests | Not configured in this repository |
| Dependency audit | Existing High Prisma/deepmerge-ts advisory remains documented in `docs/security-audit.md` |

No public network targets were scanned and no monitoring data was reset or
deleted by this work.

## 6. Performance observations

No speculative optimization or new dependency was introduced. Historical
queries remain bounded by the existing `pageSize <= 500` and selected-window
limits, scheduler probes remain one-in-flight per monitor, and the dashboard
renders at most the latest 30 chart points per monitor. The production build
completed successfully and generated a 231.78 kB JavaScript bundle and 5.27 kB
CSS bundle before compression in the final build output.

No formal profiling baseline was available, so no latency improvement claim is
made. The live health smoke test verified startup and request handling, not
load capacity.

## 7. Outstanding defects and technical debt

- Prisma's production dependency audit still reports three High advisories
  through `deepmerge-ts`; the available automated fix is a breaking Prisma 7
  upgrade.
- There is no authentication, TLS, distributed rate limiting, or public
  deployment threat model. The supported mode remains localhost.
- Browser component and Playwright E2E tests are not configured.
- The frontend still uses a compact custom chart rather than a full charting
  library; this is intentional to avoid unnecessary dependencies.
- API lifecycle, database fault-injection, and full stop/start persistence
  integration tests remain opportunities for a future milestone.

## 8. Deployment readiness

Milestone 6 is complete for local development and portfolio demonstration.
NetPulse is **not ready for public deployment** because the security audit's
dependency blocker and public-hosting controls remain unresolved. Keep the API
bound to `127.0.0.1`, use the documented local fixture override only in
development/test, and do not expose the development server directly.

## 9. Recommended Milestone 7 priorities

1. Resolve and compatibility-test the Prisma dependency advisory.
2. Add browser component and Playwright E2E coverage for lifecycle, error, and
   accessibility flows.
3. Add database fault-injection and full restart integration tests.
4. Define authentication, TLS/reverse-proxy, and abuse-prevention requirements
   before considering any hosted deployment.
5. Add measured profiling only after representative local datasets and usage
   scenarios are available.
