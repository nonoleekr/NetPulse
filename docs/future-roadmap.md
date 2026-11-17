# NetPulse Future Roadmap

Development is temporarily paused. This roadmap is a prioritized backlog, not authorization to implement work.

## P0 — Security and reproducibility

1. Add general API authentication and authorization before any public or shared-host access.
2. Design and independently review TLS provisioning, certificate rotation, and mutual trust for cross-device agents.
3. Resolve the Windows Playwright managed-webserver shutdown hang and restore a clean zero-exit E2E command.
4. Re-run Docker image builds, Compose health checks, migrations, and non-root runtime validation on an enabled runner.
5. Define backup encryption and Windows ACL guidance for SQLite and agent credentials.

## P1 — Operational maturity

1. Configurable service-level objectives and analysis thresholds.
2. Maintenance windows, alert deduplication, and notification channels.
3. Structured export of findings and evidence for incident review.
4. Longer-term baselines with seasonality and explicit data-retention tradeoffs.
5. Authenticated multi-user administration only after a dedicated threat model.

## P2 — Optional intelligence

1. Evaluate a local-model adapter with no required paid service.
2. Require explicit opt-in, visible payload preview, redaction, hard limits, timeouts, and schema-validated output.
3. Verify every model claim against deterministic finding/evidence IDs.
4. Keep generated text advisory and prohibit command execution or automatic remediation.

## Explicitly deferred

- Public cloud deployment
- Multi-tenant operation
- Arbitrary remote commands or network scanning
- Automated AI remediation
- Changes to the published `v0.1.0` release

Resume only with an approved, narrowly scoped milestone and a fresh feature branch from the reviewed post-M8.4 main commit.
