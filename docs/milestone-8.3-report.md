# Milestone 8.3 Report — Secure Monitoring Agent Boundary

## 1. Architecture and communication protocol

Milestone 8.3 adds `apps/agent`, an independent Node.js/TypeScript process. It initiates an outbound WebSocket connection to `/agent/ws`; the dashboard is not involved in agent lifecycle. Version 1 contracts in `@netpulse/contracts` define challenges, authentication, heartbeats, tasks, cancellation, results, and errors.

The coordinator sends a random nonce. The agent signs a canonical payload containing the protocol label, agent ID, nonce, and timestamp with Ed25519. A successful connection receives a random session ID and incremented persisted session generation. New sessions replace older sessions, and tasks/results must match the authenticated agent, session, generation, assignment, capability, and expiry.

## 2. Implemented agent functionality

- Outbound-only coordinator sessions with bounded exponential backoff and jitter.
- Platform, version, capability, health, and heartbeat reporting.
- Restricted HTTP(S), TCP, and ICMP probes; no shell, script, scan, or generic command message exists.
- Agent-side DNS resolution, private/reserved-address rejection, pinned HTTP/TCP destination, redirect revalidation, timeouts, cancellation, response draining, concurrency limits, and safe shutdown.
- Explicit unsupported, busy, and timeout errors rather than fabricated success measurements.

## 3. Enrollment and authentication design

An administrator authenticates with `NETPULSE_ADMIN_TOKEN` and creates a 256-bit enrollment secret. The database stores only its SHA-256 hash and expiry. Consumption uses an atomic conditional update, making tokens single-use under concurrent requests. The agent generates its private key locally and submits only the Ed25519 public key. Rotation uses another short-lived, agent-bound, single-use token and increments the credential version. Suspension and revocation disconnect the session and remove monitor assignments.

Private credentials are excluded from API responses and structured logs. The agent credential directory/file request modes `0700`/`0600`; administrators must also protect the Windows user profile and backups.

## 4. Security threat model and mitigations

| Threat | Mitigation |
| --- | --- |
| Enrollment token disclosure/replay | 256-bit random value, short expiry, hashed storage, atomic single use |
| Agent impersonation | Unique Ed25519 key and fresh signed nonce/timestamp challenge |
| Authentication replay | Per-connection nonce, 30-second timestamp window, nonce equality |
| Duplicate/stale agent sessions | Persisted session generation and replacement of the older socket |
| Unauthorized task/result | Capability and monitor assignment checks; agent/session/generation/task correlation |
| Duplicate/stale result | Atomic `DISPATCHED` claim, unique measurement task ID, task expiry |
| SSRF/DNS rebinding | Independent agent resolution and reserved-range checks; address-pinned connections; every redirect revalidated |
| Command injection | Closed task union; ICMP uses `execFile` arguments with no shell |
| Resource exhaustion | Payload, connection, task-time, probe-concurrency, URL, message, and reconnect bounds |
| Cross-device plaintext interception | Both sides reject non-loopback transport; cross-device operation is unsupported |

The existing general API remains unauthenticated and must remain bound to `127.0.0.1`. CORS and browser WebSocket origin checks are not treated as authentication.

## 5. Database and API changes

The additive `20261101170000_add_agents` migration creates `Agent`, `AgentEnrollmentToken`, and `AgentTask`, adds optional agent assignment to `Monitor`, and adds agent/task/source attribution to `Measurement`. Existing local rows receive `source = LOCAL`; no existing table or history is removed.

Loopback-only API routes support enrollment, bounded agent listing, enrollment/rotation tokens, activation/suspension/revocation, and capability-aware monitor assignment. Administrative routes require a bearer token and return no private credential or stored enrollment hash.

## 6. Files created or modified

The implementation touches the root workspace scripts and lockfile, shared contracts, Prisma schema/migration, API configuration/routes/gateway/scheduler/tests, the standalone agent application/tests, dashboard and styles, environment example, README, Milestone 8 plan, and security documentation.

## 7. Test and verification results

Verification results are recorded only for commands that were executed:

- `npm run db:deploy` — passed; all five migrations applied to a clean SQLite database.
- `npm run lint` — passed for contracts, API, agent, and web.
- `npm test` — passed: 61 API tests across 15 files and 5 agent tests across 2 files.
- Targeted agent protocol test repeated three times — passed each run; covers enrollment expiry/single-use/replay, Ed25519 authentication, duplicate-session replacement, heartbeat persistence, correlated result persistence, duplicate-result rejection, rotation, revocation, admin authentication, and restart reconciliation.
- `npm run build` — passed for contracts, generated Prisma client, API, agent, and production web bundle.
- `npm audit --omit=dev --audit-level=high` — passed with zero vulnerabilities after network-enabled execution.
- `npm audit --audit-level=high` — passed with zero vulnerabilities after network-enabled execution.
- Playwright — all 5 scenario assertions passed: monitor create/measurement, lifecycle controls, HTTP diagnostics, TLS diagnostics, and protected Agent Management enrollment. On Windows, the managed-webserver parent did not exit after the completed worker; it was manually interrupted, so `npm run e2e` itself did not return a zero exit code.
- Docker build/runtime check — not executed because `docker` is not installed on this machine. The Dockerfile was statically updated to copy the new agent workspace manifest before `npm ci`.

## 8. Platform limitations

The verified agent scope is one machine using loopback transport. Cross-device operation is explicitly unsupported because TLS enrollment/transport and certificate lifecycle have not been implemented and verified. ICMP still depends on the operating system `ping` executable and permissions. Credential file modes are best-effort on Windows ACLs.

## 9. Remaining risks and known issues

- The general API is unauthenticated and must not be exposed beyond localhost.
- Administrator authentication is a single configured bearer secret, not multi-user access control.
- Process-local connection, rate, and session state is not suitable for multiple coordinator replicas.
- Offline agents produce task timeout state but do not invent a network measurement.
- Cross-device TLS, proxy trust, certificate provisioning, and firewall guidance remain intentionally absent.

## 10. Next recommended steps

Stop after Milestone 8.3. Before any cross-device deployment, design and independently verify TLS certificate provisioning/rotation, full coordinator authentication, proxy/IP trust rules, protected installation and update procedures, and recovery behavior. Milestone 8.4 must not begin without explicit approval.
