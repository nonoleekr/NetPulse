# NetPulse

Milestone 01 is a local HTTP reachability monitor. It stores real probe results in SQLite and displays the latest result in a React dashboard.

## Requirements

- Node.js 20+
- npm 10+

## Run on Windows PowerShell

```powershell
npm install
Copy-Item apps/api/.env.example apps/api/.env
npm run db:generate
npm run db:migrate
npm run dev
```

Open http://localhost:5173. The API is available at http://localhost:4000/api/health.

## Verification

```powershell
npm test
npm run lint
npm run build
```

Create a monitor with an HTTP(S) URL. The API immediately runs a real request and continues probing every 30 seconds. Measurements are stored in `apps/api/prisma/dev.db`.

By default, loopback, private, link-local, multicast, and reserved targets are blocked. For a local HTTP fixture only, set `NODE_ENV=development` and `NETPULSE_ALLOW_LOCAL_TARGETS=true` in `apps/api/.env`; this flag is rejected outside development/test environments and still permits only loopback addresses. Packet loss is failed completed probes divided by completed probes, and availability is labeled sampled availability. Missing measurements are not counted as downtime.
