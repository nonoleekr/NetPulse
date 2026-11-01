import "dotenv/config";

function boundedNumber(value: string | undefined, fallback: number, minimum: number, maximum: number) {
  const parsed = Number(value ?? fallback);
  return Number.isFinite(parsed) ? Math.min(maximum, Math.max(minimum, parsed)) : fallback;
}

export const config = {
  host: process.env.HOST ?? "127.0.0.1",
  port: boundedNumber(process.env.PORT, 4000, 1, 65535),
  webOrigin: process.env.WEB_ORIGIN ?? "http://localhost:5173",
  databaseUrl: process.env.DATABASE_URL ?? "file:./dev.db",
  environment: process.env.NODE_ENV ?? "production",
  allowLocalTargets: process.env.NETPULSE_ALLOW_LOCAL_TARGETS === "true"
    && ["development", "test"].includes(process.env.NODE_ENV ?? ""),
  maxMonitors: boundedNumber(process.env.MAX_MONITORS, 100, 1, 1000),
  maxResponseBytes: boundedNumber(process.env.MAX_RESPONSE_BYTES, 1024 * 1024, 1024, 10 * 1024 * 1024),
  maxWebSocketClients: boundedNumber(process.env.MAX_WEBSOCKET_CLIENTS, 25, 1, 1000),
  maxWebSocketPayloadBytes: boundedNumber(process.env.MAX_WEBSOCKET_PAYLOAD_BYTES, 16 * 1024, 1024, 1024 * 1024),
  retentionDays: boundedNumber(process.env.RETENTION_DAYS, 30, 1, 3650),
  outageFailureThreshold: boundedNumber(process.env.OUTAGE_FAILURE_THRESHOLD, 3, 2, 10),
  apiRateLimit: boundedNumber(process.env.API_RATE_LIMIT, 120, 10, 1000),
  apiRateWindowMs: 60_000,
  maxDiagnostics: boundedNumber(process.env.MAX_DIAGNOSTICS, 2, 1, 10),
  diagnosticTimeoutMs: boundedNumber(process.env.DIAGNOSTIC_TIMEOUT_MS, 10000, 1000, 30000),
  diagnosticMaxHops: boundedNumber(process.env.DIAGNOSTIC_MAX_HOPS, 12, 1, 30),
};
