# NetPulse Architecture

## System shape

```mermaid
flowchart LR
  Browser[React dashboard] -->|Bounded REST queries| API[Express coordinator]
  Browser <-->|Status events only| BrowserWS[/ws]
  API --> Scheduler[Per-monitor scheduler]
  Scheduler --> Local[Local HTTP / TCP / ICMP probes]
  Scheduler --> AgentWS[/agent/ws gateway]
  Agent[Loopback agent] -->|Outbound Ed25519-authenticated session| AgentWS
  AgentWS -->|Capability-scoped task| Agent
  Agent -->|Correlated result| AgentWS
  API --> Diagnostics[DNS / route / TLS / HTTP diagnostics]
  API --> Analysis[Deterministic read-only analysis]
  API --> DB[(SQLite)]
  Analysis -->|Stored evidence only| DB
```

The Express coordinator is the system of record. Prisma stores monitor configuration, measurements, outages, diagnostics, agent identity/state, and remote task correlation. REST is authoritative; browser WebSocket events prompt targeted refreshes but do not replace persistence.

## Monitoring and diagnostics

The scheduler permits one in-flight task per monitor. Local HTTP and TCP connections use validated, pinned addresses; ICMP invokes the platform utility with argument arrays and no shell. Consecutive failures create persisted outage windows. DNS, route, TLS, and HTTP diagnostics are user initiated, bounded, stored separately from scheduled measurements, and never silently change outage state.

## Agent boundary

The standalone agent initiates an outbound connection, authenticates a fresh coordinator nonce with its Ed25519 key, reports capabilities/heartbeats, and accepts only the closed HTTP/TCP/ICMP task union. Enrollment tokens are random, short-lived, hashed, and single-use. Task results must match the assigned monitor, agent, session generation, task ID, and expiry.

Milestone 8.3 transport is loopback-only. This is not a cross-device deployment architecture: the agent and coordinator reject non-loopback plaintext traffic until TLS provisioning and broader coordinator authentication are designed and verified.

## Analysis boundary

`GET /api/analysis` reads a bounded window of already-persisted measurements, outages, and diagnostics. The deterministic engine is a pure calculation layer separate from Prisma and Express. It does not run probes, execute diagnostics, change configuration, or remediate systems.

Every finding has a severity, evidence-quality label, classification, observation, possible explanation, recommendation, and supporting record IDs/timestamps. Baseline comparisons require explicit minimum sample counts. Malformed stored diagnostic JSON is ignored rather than trusted.

The AI interface is disabled by default and has no configured provider or network invocation. NetPulse remains fully functional without AI. A redaction/bounding helper exists only as a prerequisite for a future, separately approved provider implementation.

## Trust boundaries

- The general API remains unauthenticated and must bind to localhost or stay behind the trusted-host Docker boundary.
- Agent administrative routes additionally require a configured bearer token, but that does not make the rest of the API public-safe.
- CORS and WebSocket Origin validation are browser controls, not authentication.
- Monitoring targets and diagnostic output are untrusted input. React escaping, structured contracts, bounds, and target validation remain mandatory.
- No application component can execute arbitrary agent commands or AI-generated remediation.
