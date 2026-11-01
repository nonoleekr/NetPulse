import "dotenv/config";

export const config = {
  port: Number(process.env.PORT ?? 4000),
  webOrigin: process.env.WEB_ORIGIN ?? "http://localhost:5173",
  databaseUrl: process.env.DATABASE_URL ?? "file:./dev.db",
  environment: process.env.NODE_ENV ?? "production",
  allowLocalTargets: process.env.NETPULSE_ALLOW_LOCAL_TARGETS === "true"
    && ["development", "test"].includes(process.env.NODE_ENV ?? ""),
  maxMonitors: Number(process.env.MAX_MONITORS ?? 100),
  maxResponseBytes: Number(process.env.MAX_RESPONSE_BYTES ?? 1024 * 1024),
  maxWebSocketClients: Number(process.env.MAX_WEBSOCKET_CLIENTS ?? 25),
  maxWebSocketPayloadBytes: Number(process.env.MAX_WEBSOCKET_PAYLOAD_BYTES ?? 16 * 1024),
  retentionDays: Math.min(3650, Math.max(1, Number(process.env.RETENTION_DAYS ?? 30))),
  outageFailureThreshold: Math.min(10, Math.max(2, Number(process.env.OUTAGE_FAILURE_THRESHOLD ?? 3))),
};
