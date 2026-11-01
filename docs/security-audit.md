# NetPulse Security Audit

## Scope and assessment

This review covers the Milestone 1-5 implementation on the local development
branch. It was performed against the source, tests, configuration, Git
metadata, CI workflow, and the Milestone 5 audit report. No public deployment
or external target scanning was performed.

**Release assessment:** suitable for local development after the documented
checks pass; **not approved for public deployment**. There are no known
Critical vulnerabilities in the reviewed application code. A High-severity
production dependency advisory remains unresolved because its automated fix
requires a Prisma 7 major upgrade.

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
| SEC-001 | High | Open release blocker | `npm audit --omit=dev --audit-level=moderate` reports three High advisories through `deepmerge-ts` in the Prisma 6 toolchain. `npm audit fix --force` proposes Prisma 7.10.1, a breaking upgrade that was not applied without compatibility testing. |
| SEC-002 | Medium | Accepted limitation | The API has no authentication or authorization and is intended to bind to localhost only. A public deployment would allow anyone who can reach the API to create monitors and consume probing resources. |
| SEC-003 | Medium | Accepted limitation | TLS, reverse-proxy policy, multi-user isolation, and distributed rate limiting are not implemented. Do not expose the development server directly to the Internet. |
| SEC-004 | Low | Accepted limitation | Browser component and Playwright end-to-end security tests are not configured. API/probe/WebSocket regression tests are deterministic and run in CI. |

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

No dependency upgrade was made because the available fix is a Prisma major
upgrade and requires a separate compatibility milestone.

## Remaining risks and release blockers

1. **Release blocker:** resolve and retest the Prisma/deepmerge-ts advisory
   before any public release.
2. Keep the API bound to `127.0.0.1`, use a firewall, and do not enable local
   targets in production.
3. Do not treat the current rate limiter as a substitute for authenticated,
   distributed abuse prevention.
4. Add browser/E2E coverage and a public deployment threat model before
   hosting outside the local machine.
5. Continue testing DNS rebinding and redirect behavior with controlled local
   fixtures only.

## Local versus public deployment

Local development is the supported operating mode. It uses localhost binding,
explicit local-fixture opt-in, SQLite, and a single-user trust model. Public
hosting is out of scope until authentication, TLS/reverse-proxy controls,
dependency remediation, stronger abuse prevention, operational monitoring,
and browser/E2E coverage are implemented and independently reviewed.
