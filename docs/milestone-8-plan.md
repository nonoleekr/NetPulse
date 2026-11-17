# Milestone 8: Advanced Diagnostics Foundation

Milestone 8 begins after the local-only `v0.1.0` release. It remains
deterministic and does not add public deployment or AI-generated decisions.

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
   - Completed in Milestone 8.2 with address pinning, per-redirect validation,
     bounded response reads, and deterministic coverage.
   - Acceptance verification covers certificate validity, trust and hostname
     matching; DNS/TCP/TLS/TTFB/total timing; SSRF and DNS rebinding defenses;
     cancellation and cleanup; and real local dashboard workflows.
4. **Agent boundary**
   - Completed in Milestone 8.3 as a versioned, signed, least-privilege protocol with a standalone outbound agent and capability registry.
   - Short-lived hashed enrollment tokens, Ed25519 challenge authentication, credential rotation/revocation, heartbeat state, task correlation, and source attribution are implemented.
   - The verified scope is loopback only. The coordinator and agent both reject cross-device plaintext traffic; authenticated TLS transport remains a prerequisite for cross-device support.
5. **Analysis assistance**
   - Completed in Milestone 8.4 with deterministic, evidence-linked findings,
     bounded read-only queries, explicit thresholds, confidence labels, and an
     accessible Analysis dashboard.
   - AI assistance remains disabled. A provider-independent interface and
     redaction prerequisite are present, but no model invocation or paid
     service was added without a separate privacy and security review.

## Finalization status

Milestone 8.4 is the final planned milestone. Development is temporarily
paused after its verification; future items are recorded in
`docs/future-roadmap.md` and require explicit approval to resume.

## Guardrails

- No public deployment or unauthenticated remote agents.
- No probing of external systems in automated tests.
- No AI-generated remediation without evidence and explicit user review.
- Every diagnostic has a timeout, output bound, cancellation path, and
  capability/error status.
