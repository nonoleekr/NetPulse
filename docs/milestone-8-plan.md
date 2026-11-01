# Milestone 8: Advanced Diagnostics Foundation

Milestone 8 begins after the local-only `v0.1.0` release. The first slice is
deliberately diagnostic and deterministic; it does not add public deployment,
AI-generated decisions, or distributed agents yet.

## Sequence

1. **Diagnostic data model and contracts**
   - Add typed diagnostic results separate from monitoring measurements.
   - Preserve target restrictions, bounded execution, redacted errors, and
     REST-authoritative persistence.
2. **Safe DNS and route diagnostics**
   - Add controlled DNS timing and address-family results.
   - Add platform-aware route/traceroute capability reporting without shell
     interpolation or unrestricted command execution.
3. **TLS and HTTP diagnostics**
   - Add certificate expiry and connection timing diagnostics for HTTPS targets.
   - Reuse the existing validated target and redirect policy.
4. **Agent boundary**
   - Define a signed, least-privilege agent protocol and capability registry.
   - Keep the local API as the only supported coordinator until authentication,
     enrollment, and transport security exist.
5. **Analysis assistance**
   - Export structured diagnostics for human review first.
   - Consider AI-assisted summaries only after privacy, provenance, redaction,
     and user-confirmation requirements are specified.

## Guardrails

- No public deployment or unauthenticated remote agents.
- No probing of external systems in automated tests.
- No AI-generated remediation without evidence and explicit user review.
- Every diagnostic has a timeout, output bound, cancellation path, and
  capability/error status.
