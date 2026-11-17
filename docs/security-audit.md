# NetPulse Security Audit

## Scope and assessment

This review covers the Milestone 1-5 implementation on the local development
branch. It was performed against the source, tests, configuration, Git
metadata, CI workflow, and the Milestone 5 audit report. No public deployment
or external target scanning was performed.

**Release assessment:** suitable for local development after the documented
checks pass; **not approved for public deployment**. There are no known
Critical vulnerabilities in the reviewed application code. The previously
reported Prisma/deepmerge-ts advisory was remediated by a compatibility-tested
Prisma 7.10.1 upgrade.

## Controls reviewed

- HTTP, TCP, and ICMP probes use bounded timeouts and real measurements.
- Target validation blocks loopback, private, link-local, multicast, reserved,
  unsafe IPv6, IPv4-mapped IPv6, and metadata-style addresses by default.
- DNS results are validated before connection; HTTP uses the validated address
  and does not follow redirects.
- Local targets require `NETPULSE_ALLOW_LOCAL_TARGETS=true` and
  `NODE_ENV=development` or `test`; production configuration cannot enable it.
- ICMP uses argument arrays with `shell: false`.
- Zod request validation, bounded pagination/history windows, JSON body limits,
  monitor limits, probe limits, and in-process API rate limiting are enabled.
- CORS and WebSocket Origin checks, security headers, request IDs, structured
  redacted logging, graceful shutdown, and WebSocket heartbeat cleanup are
  implemented.
- Prisma uses parameterized client operations and indexed SQLite queries.
- `.gitignore` excludes environment files, databases, logs, coverage, caches,
  and generated artifacts.
- REST is authoritative for state; WebSocket messages are emitted after
  persistence and the frontend resynchronizes after reconnects.

## Findings

| ID | Severity | Status | Finding |
| --- | --- | --- | --- |
| SEC-001 | High | Remediated | Prisma 6.19.3 pulled `deepmerge-ts@7.1.5` through `@prisma/config`; Prisma 7.10.1 upgrades `deepmerge-ts` to 8.0.2 and `npm audit --omit=dev --audit-level=high` reports zero vulnerabilities. |
| SEC-002 | Medium | Accepted limitation | The API has no authentication or authorization and is intended to bind to localhost only. A public deployment would allow anyone who can reach the API to create monitors and consume probing resources. |
| SEC-003 | Medium | Accepted limitation | TLS, reverse-proxy policy, multi-user isolation, and distributed rate limiting are not implemented. Do not expose the development server directly to the Internet. |
| SEC-004 | Low | Accepted limitation | Browser component security tests are not configured. Deterministic Playwright workflow coverage is present. |

The independent security review found no additional vulnerabilities in the
reviewed changes. No Critical finding is known.

## Regression coverage

Executed successfully:

- `npm test` — 33 tests passed across 9 test files.
- SSRF, DNS rebinding, unsafe IPv6, production local-target restrictions,
  timeout, response-size, redirect, and malformed-target tests.
- TCP refusal/timeout/network classification and safe ICMP invocation tests.
- API validation, security-header, request-ID, history-bound, and structured
  error tests.
- WebSocket origin rejection, multi-client delivery, outage events, and
  reconnect-related behavior.
- Outage, scheduler, persistence ordering, and configuration-bound tests.
- `npm run lint` and `npm run build`.
- Clean Prisma migration verification and `npm run db:generate`.

The hexadecimal IPv4-mapped IPv6 form `::ffff:7f00:1` is explicitly covered
by the target validation regression suite.

## Remediation performed

The target validator now normalizes hexadecimal IPv4-mapped IPv6 literals
before applying IPv4 private/reserved-range checks. This closes a bypass form
without changing the secure default or local fixture policy.

Prisma was upgraded to 7.10.1 with the required `prisma-client` generated
client, `prisma.config.ts`, and `@prisma/adapter-better-sqlite3`. SQLite
migrations remained unchanged; existing data is preserved by `migrate deploy`.

## Remaining risks and release blockers

1. Keep the API bound to `127.0.0.1`, use a firewall, and do not enable local
   targets in production.
2. Do not treat the current rate limiter as a substitute for authenticated,
   distributed abuse prevention.
3. Add a public deployment threat model before
   hosting outside the local machine.
4. Continue testing DNS rebinding and redirect behavior with controlled local
   fixtures only.

## Local versus public deployment

Local development is the supported operating mode. It uses localhost binding,
explicit local-fixture opt-in, SQLite, and a single-user trust model. Public
hosting is out of scope until authentication, TLS/reverse-proxy controls,
dependency remediation, stronger abuse prevention, operational monitoring,
and browser/E2E coverage are implemented and independently reviewed.

## Milestone 8.3 agent boundary addendum

Milestone 8.3 introduces a deliberately loopback-only remote-execution prototype. Agent administrative routes require `NETPULSE_ADMIN_TOKEN`; general monitor routes remain unauthenticated and therefore remain localhost-only. Enrollment secrets are generated with a cryptographic RNG, stored only as SHA-256 hashes, expire quickly, and are atomically consumed once. Each agent creates its own Ed25519 key pair; only its public key and fingerprint are stored by the coordinator.

WebSocket authentication signs a fresh coordinator nonce plus agent identity and timestamp. The coordinator rejects stale signatures, inactive identities, oversized payloads, unsupported capabilities, stale session generations, expired tasks, and duplicate task results. A newer authenticated session replaces the older session. Agent probes independently re-resolve and validate targets, pin HTTP/TCP connections to the validated address, use argument-array ICMP invocation, and enforce timeouts and concurrency bounds.

Cross-device transport is not approved in this milestone. Both enrollment and agent WebSocket upgrades require a loopback peer, and the agent accepts only a loopback `http://` coordinator. This is a security control, not a deployment inconvenience: TLS certificate policy and broader coordinator authentication have not been implemented or verified. Do not use port forwarding, proxies, address rewriting, or modified builds to bypass it.

## Milestone 8.4 analysis and privacy addendum

The analysis endpoint is read-only and queries bounded stored windows. It has no path to the scheduler, diagnostic execution, agent dispatch, filesystem, or command execution. Findings include record identifiers and sanitized summaries rather than target URLs, credentials, raw diagnostic bodies, agent keys, or enrollment secrets. Malformed stored diagnostic JSON is ignored by structural guards.

AI assistance is disabled by default and no provider, API key, model dependency, or outbound model request exists. The provider-independent interface cannot execute commands or remediation. A bounded redaction helper covers common credential labels, URLs, private IPv4 ranges, unique-local IPv6 prefixes, and control characters, but it is not sufficient by itself to authorize a future model integration. Explicit consent, payload preview, prompt-injection analysis, structured-output validation, and provider privacy review remain mandatory future controls.

The general unauthenticated API and cross-device agent transport remain the primary security blockers. Deterministic analysis does not change the local-only deployment approval.
