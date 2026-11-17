# NetPulse Project Final Status

## Development state

NetPulse is temporarily paused after Milestone 8.4. It is not archived or discontinued. New feature development should remain stopped until the owner explicitly resumes the project.

- Current development branch: `feature/milestone-8.4-analysis`
- Stable pre-Milestone 8.4 baseline: `main` at `72ceb17`
- Recommended restart point: the reviewed Milestone 8.4 commit after it is explicitly committed and merged
- Published release: `v0.1.0` remains unchanged

## Current capabilities

NetPulse provides local HTTP(S), TCP, and ICMP monitoring; SQLite history; sampled availability, latency, packet-loss, and outage tracking; browser status updates; DNS/route/TLS/HTTP diagnostics; an authenticated loopback monitoring-agent prototype; and deterministic evidence-based analysis.

Analysis findings cite stored measurements, outages, and diagnostics. The system exposes insufficient-data states and separates observations, possible explanations, confirmed findings, and recommendations. AI assistance is disabled and no external model receives data.

## Milestone status

| Milestone | Status | Notes |
| --- | --- | --- |
| 1–7 | Complete | Local monitoring, persistence, realtime updates, outage/history UX, hardening, reliability, and local Docker packaging |
| 8.1 | Complete and verified | Bounded persisted DNS and route diagnostics |
| 8.2 | Complete and verified | TLS trust/hostname/expiry and advanced HTTP timing diagnostics |
| 8.3 | Partial original objective; verified secure fallback | Authenticated loopback agent architecture is implemented. Cross-device encrypted transport is deferred. |
| 8.4 | Complete deterministic foundation | Evidence-based analysis and finalization are implemented. Optional AI model integration is deferred by security/design choice. |

## Supported environments

- Windows with current Node.js/npm is the primary verified development environment.
- The API and dashboard have Docker packaging for trusted-host local deployment. Docker execution must be reverified on a machine with Docker Desktop.
- ICMP depends on the operating-system `ping` utility and permissions.
- Linux/macOS probe branches and cross-device agents are not claimed as verified by the current Windows run.

## Install and run

```powershell
git clone <repository-url>
Set-Location NetPulse
npm ci
npm run db:generate
npm run db:deploy
npm run dev
```

Open `http://localhost:5173`. The API defaults to `127.0.0.1:4000`. For the loopback-agent prototype, configure `NETPULSE_ADMIN_TOKEN`, create a one-time enrollment token in Agent Management, and follow the local-only README instructions.

## Security and privacy limitations

- The general API has no user authentication and must not be publicly exposed.
- Agent administration uses a bearer boundary, but agent transport is loopback-only and not a cross-device security solution.
- The process-local rate limiter and session registry do not support multi-replica deployment.
- The application stores monitoring targets and operational history in local SQLite; protect the database and backups.
- AI is disabled. Future model integration requires explicit consent, minimization, redaction, output validation, and provider review.
- Diagnostics and analysis are evidence tools, not automatic remediation or proof of root cause.

## Known issues and technical debt

1. All Windows Playwright assertions complete, but the managed web-server parent can hang during shutdown and require interruption; the command therefore lacks a clean final exit despite passing scenarios.
2. Docker build and health checks require execution on a Docker-enabled machine for the final M8.4 tree.
3. General API authentication and encrypted cross-device agent transport remain the highest security blockers.
4. Analysis thresholds are fixed and use bounded recent samples rather than seasonality or configurable SLOs.
5. Agent credentials request restrictive file modes, but Windows ACL hardening remains best-effort.
6. ICMP availability varies with platform tools, privileges, and firewalls.

## Verification status

The final M8.4 report records exact executed test, lint, build, audit, Playwright, migration, and Docker results. No unexecuted check should be inferred as passing.

## Deferred features

See [`future-roadmap.md`](./future-roadmap.md). No deferred item is authorized for implementation during the temporary pause.

## Resume development

After explicit owner approval:

```powershell
Set-Location D:\Coding_Projects\NetPulse
git status
git switch main
git log -5 --oneline
git switch -c feature/<approved-scope>
npm ci
npm run db:generate
npm run db:deploy
npm test
npm run lint
npm run build
```

Review this document, `docs/security-audit.md`, `docs/architecture.md`, and the latest milestone report before editing. Do not resume from `v0.1.0`; resume from the reviewed post-M8.4 main commit.

## Release recommendation

The accumulated diagnostics, loopback agent, and analysis changes are substantial enough to warrant a future `v0.2.0`, but only after M8.4 is merged by approval, Docker/CI checks pass on an enabled runner, the Playwright shutdown issue is understood, and release notes clearly preserve the localhost/cross-device limitations. No release is created by this milestone.
