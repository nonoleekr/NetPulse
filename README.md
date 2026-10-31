# NetPulse

Local-first network monitoring for developers who want to understand the reliability of the services they depend on.

> **Current status:** Milestones 1 and 2 are complete. NetPulse monitors HTTP(S) targets, stores real measurements in SQLite, and updates the React dashboard through REST plus WebSocket notifications. TCP, ICMP, alerts, and historical charts are planned but not implemented yet.

## Project Overview

NetPulse is a portfolio project for measuring network reachability from a local Windows machine. It periodically sends real HTTP requests to configured public targets, records whether each request succeeded, measures latency, and keeps the results in a local SQLite database.

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
| Dashboard | React dashboard with latest result and sampled statistics | Charts, time windows, richer status views |
| Probe types | HTTP(S) only | TCP connect and ICMP probes |
| Updates | REST is authoritative; WebSocket notifications trigger targeted reloads and reconnect sync | Broader real-time event coverage |
| Reliability | Per-monitor scheduling and one in-flight probe | Outage state transitions and recovery tracking |
| Operations | Local Windows development workflow | CI, Docker, and deployment documentation |
| Notifications | Not available | Alerting and notification channels |

Only the current implementation described below should be treated as available.

## Current Status: Milestone 2

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
| Concurrently | Runs the API and frontend development servers together |

Tailwind CSS and Recharts are part of the longer-term architecture but are not dependencies in the current repository. TCP and ICMP probing remain planned.

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

Only enable local loopback targets when running a local HTTP fixture for development or tests:

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
3. Enter a public HTTP(S) URL, such as `https://example.com`.
4. Select **Start monitoring**.
5. NetPulse performs a real request immediately, saves the measurement, and repeats the check every 30 seconds.
6. Review the monitor card for the latest status, latency, sampled availability, packet loss, and check time.

### Understanding the dashboard

- **ONLINE** means the latest completed HTTP request returned a `2xx` or `3xx` response.
- **DOWN** means the latest completed request failed, timed out, exceeded the response-size limit, or returned a `4xx`/`5xx` status.
- **WAITING** means no completed measurement is available yet.
- **Latest latency** is measured for the most recent completed request.
- **Sampled availability** is the percentage of completed probes that succeeded. It is not duration-based uptime because the current milestone does not measure the length of outages.
- **Packet loss** is the percentage of completed probes that failed.
- A monitor with no completed probes displays `—` rather than treating missing data as downtime.

Measurements remain in the SQLite database when the API restarts. The current dashboard summarizes all retained measurements; selectable history windows and retention automation are planned.

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
- [ ] **Milestone 3 — Additional probe types**
  - [ ] TCP connect probing
  - [ ] Windows-aware ICMP probing and capability reporting
- [ ] **Milestone 4 — History and outage analysis**
  - [ ] Selectable measurement windows and charts
  - [ ] Consecutive-failure outage detection
  - [ ] Duration-based availability when outage duration is measured
  - [ ] Retention management
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

The current suite includes 20 passing API, target-validation, HTTP-probe, scheduler-ordering, and WebSocket tests. The production build creates the API output in `apps/api/dist` and the frontend output in `apps/web/dist`.

## Known Limitations

- HTTP(S) is the only implemented probe type.
- The application is local-only and has no authentication or multi-user support.
- REST polling/refresh is used; WebSocket updates are not implemented yet.
- The dashboard shows the latest measurement and all-retained-measurement summary, not selectable historical charts.
- Availability is sampled availability, not duration-based uptime.
- Outage detection, recovery events, and notifications are not implemented.
- TCP, ICMP, DNS-specific, UDP, traceroute, TLS-expiry, and browser-journey checks are not implemented.
- The scheduler runs in the API process and is not designed for horizontal scaling.
- SQLite is suitable for this single-user local MVP, not for concurrent multi-instance production monitoring.
- Public deployments require additional authentication, origin/CSRF review, rate limiting, secret management, and operational hardening.

## License

No license has been selected yet. Add a license before distributing NetPulse as an open-source project.
