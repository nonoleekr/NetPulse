# NetPulse

Local-first network monitoring for developers who want to understand the reliability of the services they depend on.

> **Current status:** Milestones 1 through 4 are complete. NetPulse monitors HTTP(S), TCP, and ICMP targets, stores real measurements in SQLite, tracks outages, and shows selectable history through REST plus WebSocket-triggered refreshes. Alerts and advanced analytics are planned.

## Project Overview

NetPulse is a portfolio project for measuring network reachability from a local Windows machine. It periodically performs real HTTP, TCP, or ICMP checks against configured targets, records whether each probe succeeded, measures latency, and keeps the results in a local SQLite database.

The project is intended to make common monitoring questions easy to answer:

- Is a service reachable right now?
- How long does the latest request take?
- How often have completed checks failed?
- Did the API restart without losing previous measurements?
- Can a monitoring target be configured without accidentally probing private or local services?

NetPulse is designed for:

- Students learning full-stack TypeScript and networking fundamentals.
- Developers building a small personal or portfolio monitoring tool.
- Anyone who wants a transparent, local alternative to a hosted monitoring service during development.

It is currently a single-user application intended to run on `localhost`. It does not provide hosted monitoring or remote agents.

## Planned Features

The long-term vision is a practical network monitoring dashboard with multiple probe types, historical analysis, outage detection, and real-time updates.

| Area | Current implementation | Planned |
| --- | --- | --- |
| HTTP monitoring | Real HTTP(S) probes with latency, status, timeout, and response-size limits | More detailed HTTP history and configurable policies |
| Storage | SQLite via Prisma | Retention jobs and larger-scale storage options |
| Dashboard | React dashboard with latest result, history windows, and compact measurement charts | Richer analytics and visualizations |
| Probe types | HTTP(S), TCP connect, and ICMP | Additional probe policies and richer diagnostics |
| Updates | REST is authoritative; WebSocket notifications trigger targeted reloads and reconnect sync | Broader real-time event coverage |
| Reliability | Per-monitor scheduling, one in-flight probe, and persisted outage transitions | Maintenance windows and alert policies |
| Operations | Local Windows development workflow | CI, Docker, and deployment documentation |
| Notifications | Not available | Alerting and notification channels |

Only the current implementation described below should be treated as available.

## Current Status: Milestone 4

Milestone 1 delivers the smallest runnable HTTP monitoring vertical slice:

- React/Vite frontend with a minimal monitor form and status cards.
- Express/TypeScript API bound to `127.0.0.1:4000`.
- Real HTTP(S) requests using Node's HTTP/HTTPS client APIs.
- Immediate probing after monitor creation, followed by a 30-second schedule.
- One in-flight probe per monitor to avoid overlapping requests.
- SQLite persistence through Prisma migrations.
- Latest latency, HTTP status, success/failure, and probe error information.
- Sampled availability and packet-loss statistics:
  - **Packet loss:** failed completed probes divided by completed probes.
  - **Sampled availability:** successful completed probes divided by completed probes.
  - Missing measurements and paused periods are not counted as downtime.
- Input validation for monitor names, URL syntax, supported schemes, ports, credentials, URL length, intervals, and timeouts.
- SSRF protections that block loopback, private, link-local, multicast, reserved, and unsafe IPv6 targets by default.
- Explicit development/test-only loopback support for local fixtures through `NETPULSE_ALLOW_LOCAL_TARGETS=true`.
- DNS validation and connection using the validated address to reduce DNS-rebinding risk.
- Hard probe timeouts and response-body size limits.

The current automated verification includes target-validation tests, IPv6 and DNS-rebinding regression tests, timeout tests, response-size tests, redirect behavior, failed HTTP status handling, API health tests, TypeScript checks, and production builds.

Milestone 2 adds:

- A local `/ws` WebSocket endpoint integrated with the API HTTP server.
- Typed `connection.ready` and `measurement.completed` event contracts.
- Events broadcast only after the measurement has been persisted in SQLite.
- Origin checks, connection limits, and WebSocket payload limits.
- A browser client with Live, Reconnecting, and Offline status.
- Bounded exponential reconnection backoff.
- REST synchronization on initial connection, reconnect, and measurement notifications.

Milestone 3 adds:

- TCP connectivity checks using Node's `net` socket API.
- Configurable TCP ports with monotonic connection latency measurement.
- TCP DNS, refusal, timeout, and connection-error classification.
- ICMP checks using the operating system `ping` utility without shell interpolation.
- Windows-compatible `ping.exe` arguments and graceful unsupported/permission/unreachable errors.
- HTTP, TCP, and ICMP monitors sharing the same scheduler, measurement storage, sampled statistics, and WebSocket notifications.
- Monitor creation fields that change based on the selected probe type.

Milestone 4 adds:

- Selectable 1-hour, 6-hour, 24-hour, 7-day, and 30-day history windows.
- Historical measurement and outage REST data for each monitor.
- Compact dashboard history charts showing successful and failed samples.
- Consecutive-failure outage detection with persisted start, end, failure count, and reason.
- Duration-based availability when an outage record exists, alongside clearly labeled sampled availability.
- Configurable bounded retention pruning for old measurements and closed outages.
- REST history pagination and server-side latency, probe, loss, availability, and outage statistics.
- WebSocket outage-start, outage-recovery, and monitor-status events after persistence.

## Tech Stack

| Technology | Purpose |
| --- | --- |
| Node.js | Runtime for the API, scheduler, and network probes |
| TypeScript | Strict typing across the API and frontend |
| React | Dashboard UI |
| Vite | Frontend development server and production bundler |
| Express | REST API and local HTTP server |
| Prisma | Type-safe database access and migrations |
| SQLite | Local, file-based measurement storage |
| Zod | Request validation and input constraints |
| Vitest | Unit and probe regression tests |
| Supertest | API health endpoint testing |
| npm workspaces | Monorepo dependency and script management |
| `node:http`, `node:https`, `node:dns/promises` | Bounded HTTP probing and target resolution |
| `node:net` | TCP connection probing |
| `node:child_process` | Safe, argument-array invocation of the system ping utility |
| Concurrently | Runs the API and frontend development servers together |

Tailwind CSS and Recharts are part of the longer-term architecture but are not dependencies in the current repository. The current UI uses a small custom stylesheet to keep the MVP dependency-light.

## Installation & First-Time Setup

### Requirements

- Windows with PowerShell.
- Node.js 20 or newer.
- npm 10 or newer.
- A network connection for probing public HTTP(S) targets.

Check your versions:

```powershell
node --version
npm --version
```

### Clone and install

Replace the placeholder URL with the repository URL when cloning from GitHub:

```powershell
git clone <repository-url> NetPulse
Set-Location NetPulse
npm install
```

### Configure the API

Create the local environment file from the checked-in template:

```powershell
Copy-Item apps/api/.env.example apps/api/.env
```

The default configuration runs the API on port `4000`, serves the frontend from port `5173`, and stores SQLite data in `apps/api/prisma/dev.db`.

For normal use, keep this setting disabled:

```dotenv
NETPULSE_ALLOW_LOCAL_TARGETS=false
```

Only enable local loopback targets when running a local HTTP, TCP, or ICMP fixture for development or tests:

```dotenv
NODE_ENV=development
NETPULSE_ALLOW_LOCAL_TARGETS=true
```

The application ignores this override in production and test-target validation remains restricted to loopback addresses when the override is active. Never expose this unauthenticated local application publicly.

### Initialize SQLite

Generate the Prisma client and apply the initial migration:

```powershell
npm run db:generate
npm run db:migrate
```

### Start NetPulse

Run both development servers:

```powershell
npm run dev
```

Then open:

- Dashboard: <http://localhost:5173>
- API health check: <http://localhost:4000/api/health>

To run either process separately:

```powershell
npm run dev:api
npm run dev:web
```

## Usage Guide

1. Open <http://localhost:5173>.
2. Enter a monitor name, such as `Example`.
3. Choose `HTTP(S)`, `TCP`, or `ICMP`.
4. Enter the configuration for that probe:
   - HTTP(S): a URL such as `https://example.com`.
   - TCP: a hostname/IP and port such as `example.com` and `443`.
   - ICMP: a hostname/IP such as `example.com`.
5. Select **Start monitoring**.
6. NetPulse performs a real probe immediately, saves the measurement, and repeats the check every 30 seconds.
7. Review the monitor card for the latest status, latency, sampled availability, packet loss, and check time.

### Understanding the dashboard

- **ONLINE** means the latest completed probe succeeded. HTTP requires a `2xx`/`3xx` response, TCP requires a connection, and ICMP requires a ping reply.
- **DOWN** means the latest completed probe failed, timed out, was refused, was unreachable, or exceeded the HTTP response-size limit.
- **WAITING** means no completed measurement is available yet.
- **Latest latency** is measured for the most recent completed request.
- **Sampled availability** is the percentage of completed probes that succeeded. It is not duration-based uptime.
- **Packet loss** is the percentage of completed probes that failed.
- **Duration availability** subtracts persisted outage duration from the selected window; an ongoing outage is bounded at query time.
- **UP**, **DOWN**, **PAUSED**, and **UNKNOWN** are distinct monitor states. Paused monitors do not run probes or create outage records.
- A monitor with no completed probes displays `—` rather than treating missing data as downtime.

### Windows ICMP notes

NetPulse invokes `ping.exe` with an argument array and does not execute a shell command. ICMP availability depends on the local Windows network, firewall, and permissions. A failed or unsupported ICMP probe is stored as a real failed measurement; NetPulse never substitutes simulated latency.

Measurements and completed outages remain in the SQLite database when the API restarts. The dashboard can query a selected history window; retention pruning defaults to 30 days and is bounded to a safe 1-3650 day range.

### History API

`GET /api/monitors/:id/history?hours=24&page=1&pageSize=200` returns bounded measurements, outage records, pagination metadata, and window statistics. `hours` accepts 1-720 and `pageSize` accepts 1-500. API timestamps are UTC ISO-8601 strings and are rendered in the browser's local timezone.

## Development Roadmap

- [x] **Milestone 1 — Secure HTTP monitoring MVP**
  - [x] React/Vite dashboard
  - [x] Express API and SQLite/Prisma persistence
  - [x] Real scheduled HTTP(S) measurements
  - [x] Sampled availability and packet-loss statistics
  - [x] Baseline URL, SSRF, timeout, response-size, and resource validation
  - [x] Unit tests, API test, type checks, and production build
- [x] **Milestone 2 — Reliable real-time updates**
  - [x] WebSocket notifications for completed measurements
  - [x] REST remains authoritative after disconnects and reconnects
  - [x] Client reloads current state to recover missed events
- [x] **Milestone 3 — TCP and ICMP monitoring**
  - [x] TCP connect probing with configurable ports
  - [x] Windows-aware ICMP probing and capability/error reporting
  - [x] Shared scheduling, persistence, statistics, and WebSocket updates
- [x] **Milestone 4 — History and outage analysis**
  - [x] Selectable measurement windows and charts
  - [x] Consecutive-failure outage detection
  - [x] Duration-based availability when outage duration is measured
  - [x] Retention management
- [ ] **Milestone 5 — Operational hardening**
  - [ ] Additional security headers, rate limits, and structured logging
  - [ ] CI workflow and browser tests
  - [ ] Optional Docker packaging
- [ ] **Future — Alerts and scale**
  - [ ] Notifications, maintenance windows, and escalation
  - [ ] Remote probe agents and multi-region monitoring
  - [ ] Larger-scale storage and authenticated deployments

## Project Structure

```text
.
├── apps
│   ├── api
│   │   ├── prisma
│   │   │   ├── migrations/       SQLite migration history
│   │   │   └── schema.prisma     Database schema
│   │   └── src
│   │       ├── app.ts            Express routes and validation
│   │       ├── config.ts         Environment configuration
│   │       ├── db.ts             Prisma client
│   │       ├── probe.ts          HTTP probe implementation
│   │       ├── tcp-probe.ts      TCP connection probe
│   │       ├── icmp-probe.ts     System ping integration
│   │       ├── probe-types.ts    Shared probe result types
│   │       ├── scheduler.ts      Scheduled monitor execution
│   │       ├── target.ts         URL, DNS, and SSRF validation
│   │       └── server.ts         API startup and shutdown
│   └── web
│       └── src
│           ├── main.tsx          React dashboard
│           └── style.css         Dashboard styling
├── package.json                  Root workspace scripts
├── package-lock.json             Locked npm dependencies
└── tsconfig.base.json            Shared TypeScript settings
```

## Verification Commands

Run these from the repository root:

```powershell
npm test
npm run lint
npm run build
```

The current suite includes 30 passing API, target-validation, HTTP/TCP/ICMP probe, outage-state, scheduler-ordering, and WebSocket tests. The production build creates the API output in `apps/api/dist` and the frontend output in `apps/web/dist`.

## Known Limitations

- Probe behavior depends on the target network: firewalls can block TCP or ICMP even when HTTP works.
- The application is local-only and has no authentication or multi-user support.
- WebSocket notifications are implemented, but REST remains authoritative and is used to recover missed updates.
- The dashboard history chart is intentionally compact and not a full analytics/charting suite.
- Sampled availability remains the default probe-based statistic; duration availability begins when a persisted outage is detected.
- Outages require the configured consecutive-failure threshold (three by default), so isolated failures do not create outage duration.
- DNS-specific, UDP, traceroute, TLS-expiry, and browser-journey checks are not implemented.
- Duration-based availability only reflects persisted outages after the failure threshold; it is not a full SLO or maintenance-aware calculation.
- The scheduler runs in the API process and is not designed for horizontal scaling.
- SQLite is suitable for this single-user local MVP, not for concurrent multi-instance production monitoring.
- Public deployments require additional authentication, origin/CSRF review, rate limiting, secret management, and operational hardening.
- Closed measurements and outages older than `RETENTION_DAYS` (30 by default) are removed hourly; active outages are preserved until recovery.

### Troubleshooting

- **TCP shows `DNS_ERROR`:** verify the hostname resolves from the machine running NetPulse.
- **TCP shows `REFUSED`:** the host is reachable but no service accepted the configured port.
- **TCP or ICMP shows `TIMEOUT`/`UNREACHABLE`:** check firewalls, VPNs, routing, and whether the target permits that protocol.
- **ICMP shows `UNSUPPORTED` or `PERMISSION`:** verify that `ping.exe` is available and permitted by Windows security policy.
- **A local fixture is blocked:** set `NODE_ENV=development` and `NETPULSE_ALLOW_LOCAL_TARGETS=true`; this override is intentionally not accepted in production.

## License

No license has been selected yet. Add a license before distributing NetPulse as an open-source project.
