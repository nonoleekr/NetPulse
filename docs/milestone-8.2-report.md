# Milestone 8.2 Report — TLS and HTTP Diagnostics

## 1. Features implemented

- Added typed, persisted `TLS` and `HTTP` diagnostic results without changing
  scheduled measurements or outage state.
- Added HTTPS certificate inspection for trust status, validity dates, days
  remaining, explicit validity state, hostname matching, bounded subject
  alternative names, protocol, cipher, ALPN, and DNS/TCP/TLS timing.
- Added HTTP diagnostics for status, final URL, redirect history, HTTP version,
  bounded response size, and DNS/TCP/TLS/first-byte/total timing.
- Added dashboard actions and result states for configured HTTP(S) monitors.

## 2. Security and execution model

- Both diagnostics remain monitor-scoped, user-initiated, concurrency-limited,
  and persisted through the existing diagnostic runner.
- The initial target and every redirect target pass through the central SSRF
  validator. Each request connects to the validated address through a pinned
  lookup callback while retaining the original hostname for Host and SNI.
- Redirects, execution time, response bytes, certificate alternative names,
  and persisted error messages are bounded. Network errors are reduced to
  stable diagnostic messages rather than persisting raw socket details.
- TLS inspection permits the handshake to finish so an invalid or expired
  certificate can be reported; the result explicitly records `authorized` and
  a stable authorization error. Hostname matching is evaluated independently
  with Node's certificate identity verifier. HTTP diagnostics continue to
  enforce normal certificate verification.

## 3. Automated coverage

- Redirect destinations are revalidated and repinned before connection.
- Blocked redirect targets are rejected before a request is made.
- Redirect limits are enforced.
- TLS certificate metadata and handshake details are normalized and bounded.
- Non-HTTPS TLS diagnostic requests are rejected.
- Real local HTTP fixtures verify DNS, TCP, first-byte, total timing, pinned
  Host handling, timeout cleanup, and response truncation cleanup.
- A real local HTTPS fixture verifies strict rejection without trust, TLS
  timing with an explicit test CA, self-signed inspection, and dashboard output.
- Existing monitoring, outage, DNS, route, scheduler, and WebSocket tests run
  in the same source-only suite.

## 4. Verified defects fixed

- Node requests may invoke custom lookup callbacks with `all: true`. The prior
  callback returned a scalar address, causing hostname-based HTTP monitoring
  and diagnostics to fail with `ERR_INVALID_IP_ADDRESS`. A shared pinned lookup
  now returns the required address array without performing a second DNS query.
- TLS authorization errors can be strings at runtime; normalization previously
  reduced them to a generic value. Stable Node error codes are now preserved.
- TLS results did not distinguish authorization, hostname matching, and
  certificate validity. These states are now explicit in contracts and UI.
- Playwright fixtures left a monitor scheduled, preventing deterministic local
  fixture shutdown. Every browser scenario now deletes its monitor.
- API shutdown now awaits WebSocket closure, terminates upgraded clients, and
  closes remaining HTTP connections.

## 5. Verification

- PASS — 57 unique API/unit and local-integration tests across 14 source test files.
- PASS — TypeScript checks for contracts, API, and web workspaces.
- PASS — production build.
- PASS — four Playwright browser scenarios completed successfully, including
  real local HTTP and TLS diagnostic dashboard flows.
- PASS — production-only and full dependency audits, zero vulnerabilities.
- HARNESS NOTE — on this Windows host, Playwright's managed web-server parent
  still waits after the worker reports all four passes, even though application
  listeners have closed. The parent process was terminated manually, so the
  `playwright test` command did not return a clean zero exit in this environment.

## 6. Modified files

- Contracts and orchestration: `packages/contracts/src/index.ts`,
  `apps/api/src/diagnostics.ts`, `apps/api/src/app.ts`, `apps/api/src/config.ts`.
- Network implementation: `apps/api/src/tls-diagnostic.ts`,
  `apps/api/src/http-diagnostic.ts`, `apps/api/src/target.ts`,
  `apps/api/src/probe.ts`.
- UI and lifecycle: `apps/web/src/main.tsx`, `apps/api/src/server.ts`,
  `apps/api/src/websocket.ts`.
- Tests and fixtures: diagnostic/probe/WebSocket tests, `e2e/netpulse.spec.ts`,
  `e2e/start-api.mjs`, and the test-only localhost certificate/key.
- Configuration and documentation: environment examples, Compose, README,
  changelog, Milestone 8 plan, and this report.

## 7. Remaining limitations and recommendations

- Certificate inspection reports the leaf certificate only; it does not expose
  or persist the full chain or certificate body.
- Certificate revocation, OCSP, and certificate-transparency validation are not
  implemented. Do not describe `authorized` as revocation-aware.
- HTTP timings describe the final response exchange plus cumulative validated
  DNS time. Per-redirect phase timings are intentionally not persisted.
- Diagnostics remain local-only and unauthenticated. They must not be exposed
  directly to the public Internet.
- Resolve or isolate the Windows Playwright managed-web-server teardown issue
  before making the local `npm run e2e` command a release gate. Linux CI should
  continue to run the same four scenarios.
- Milestone 8.3 should remain a separate approved effort focused on the signed,
  least-privilege agent boundary; no agent protocol work is included here.
