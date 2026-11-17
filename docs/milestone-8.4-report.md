# Milestone 8.4 Report — Evidence-Based Analysis and Finalization

## Scope decision

Milestone 8.4 implements deterministic, evidence-linked network analysis and final project documentation. It does not invoke an AI model. No safe, no-cost provider was required to meet the analysis objective, and adding an unverified model integration would introduce privacy and prompt-injection risk without improving the deterministic evidence foundation.

## Implemented analysis

The engine analyzes bounded stored windows of:

- successful and failed local or agent measurements;
- latency, sampled availability, and repeated error codes;
- persisted outage windows;
- DNS diagnostic failures;
- HTTP response status and time-to-first-byte evidence; and
- TLS trust, hostname, validity, and expiration evidence.

Rules distinguish observations from confirmed stored findings. Possible explanations are explicitly non-authoritative and are separated from observations. Each finding includes source record IDs, timestamps, severity, evidence quality, and a recommendation scoped to the cited evidence.

## Deterministic rules

| Rule | Minimum evidence | Classification |
| --- | --- | --- |
| Sampled availability | 5 valid measurements | Warning below 99%; critical below 90% |
| Latency baseline | 20 successful latency samples | Compare earliest 70% with recent 30%; warning at 1.5x and +50 ms; critical at 2x and +100 ms |
| Repeated connection failure | 3 matching error codes | Warning at 3; critical at 5 |
| Recurring outage | 2 overlapping persisted outages | Warning; critical at 4 or when one is active |
| DNS failure | Latest stored DNS diagnostic in window | Confirmed warning |
| HTTP response | Latest valid stored HTTP diagnostic | Warning for 4xx; critical for 5xx |
| HTTP first byte | Latest valid stored HTTP diagnostic | Warning at 2,000 ms |
| TLS validation/expiry | Latest valid stored TLS diagnostic | Critical for invalid trust/hostname/validity or 7 days; warning at 30 days |

Evidence quality is high at 30 or more samples, medium at 10, and low below 10. Diagnostic validation and persisted outage findings use high or explicitly rule-defined quality because they cite a specific stored event. These labels describe evidence quantity/specificity, not probability of a root cause.

## API and dashboard

`GET /api/analysis` accepts a 1–720 hour window and optional bounded monitor ID. Queries are capped at 100 monitors, 250 measurements, 100 outages, and 50 diagnostics per monitor. The endpoint is read-only and does not call the scheduler or diagnostics engine.

The dashboard shows overall health, prioritized findings, observation/explanation separation, recommended next steps, evidence IDs/times, baseline comparisons, local/agent sample counts, and explicit insufficient-data and AI-disabled states.

## Privacy and AI boundary

The provider-independent `AnalysisAssistant` interface is disabled and throws if called. No API key, model dependency, paid service, or outbound model request exists. A bounded redaction helper removes common secret labels, URLs, and private addresses for possible future use. Before any future integration, the implementation still requires explicit consent, a prompt-injection threat model, structured-output validation, provider privacy review, and deterministic evidence verification.

## Security review

- Analysis reads stored data only and cannot launch probes or commands.
- Query windows and relation sizes are bounded.
- Raw target URLs, credentials, agent keys, enrollment tokens, and diagnostic payloads are not returned in analysis findings.
- Malformed diagnostic JSON is ignored by type guards.
- User-controlled names render through React escaping.
- Findings never claim a root cause from latency or failure codes alone.
- Existing SSRF, loopback, agent authorization, and local-only controls are unchanged.

## Verification

Executed results:

- `npm ci` — passed using the documented lifecycle-enabled install; 397 packages installed and zero vulnerabilities reported. An exploratory `--ignore-scripts` run was rejected as invalid for this project because it omits the required native SQLite binding.
- `npm run db:generate` — passed after the clean install.
- Clean SQLite `npm run db:deploy` — passed with all five additive migrations using the repository's Windows `RUST_LOG=info` engine-startup workaround; the temporary database was removed.
- `npm test` — passed: 73 API tests across 18 files and 5 agent tests across 2 files. API files are serialized because they intentionally share one SQLite fixture; the full API suite passed three consecutive runs after this harness correction.
- `npm run lint` — passed for contracts, API, agent, and web.
- `npm run build` — passed for contracts, generated Prisma client, API, agent, and production web bundle.
- `npm audit --omit=dev --audit-level=high` — passed with zero vulnerabilities.
- `npm audit --audit-level=high` — passed with zero vulnerabilities.
- Playwright — all 6 assertions passed, including deterministic analysis rendering and all prior monitoring/diagnostic/agent-management workflows. On this Windows host, the managed web-server parent still did not exit after the worker completed and was manually interrupted; therefore the command itself did not return a clean zero exit code.
- Docker — not executed because Docker is unavailable on this machine.
- Repository hygiene — no tracked environment secrets, SQLite databases/journals, or agent credential files; generated Playwright results and the isolated E2E database were removed.

Analysis-specific coverage includes statistical thresholds, evidence IDs, source attribution, insufficient data, contradictory measurements, malformed diagnostics, DNS/TLS rules, API bounds/read-only behavior, redaction, and AI-disabled behavior.

## Limitations

- Analysis uses bounded recent samples, not an unbounded long-term statistical model.
- Fixed thresholds are transparent but not user-configurable service-level objectives.
- Findings are advisory and cannot prove root cause without corroborating evidence.
- AI-generated summaries are not implemented.
- The general API remains localhost-only and unauthenticated.
- Cross-device agent transport remains unsupported.

## Files

Shared contracts, API analysis/AI boundary/service/tests, the React dashboard, Playwright coverage, README, changelog, architecture, security, milestone plan, final-status document, and future roadmap are included in this milestone. No database migration or new runtime dependency is required.
