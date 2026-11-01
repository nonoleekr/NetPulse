import express from "express";
import cors from "cors";
import { z } from "zod";
import { prisma } from "./db.js";
import { config } from "./config.js";
import { clearSchedule, runProbe, scheduleMonitor } from "./scheduler.js";
import { validateHost, validateHttpTarget } from "./target.js";
import { emitMonitoringEvent } from "./measurement-events.js";
import { randomUUID } from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import { logger } from "./logger.js";
import { runDiagnostic } from "./diagnostics.js";

const commonInput = {
  name: z.string().trim().min(1).max(80),
  intervalSeconds: z.number().int().min(10).max(86400).default(60),
  timeoutMs: z.number().int().min(250).max(30000).default(5000),
};
const monitorInput = z.discriminatedUnion("kind", [
  z.object({ ...commonInput, kind: z.literal("HTTP"), url: z.string().url().max(2048) }),
  z.object({ ...commonInput, kind: z.literal("TCP"), host: z.string().trim().min(1).max(253), port: z.number().int().min(1).max(65535) }),
  z.object({ ...commonInput, kind: z.literal("ICMP"), host: z.string().trim().min(1).max(253) }),
]);
const historyQuery = z.object({
  hours: z.coerce.number().int().min(1).max(24 * 30).default(24),
  page: z.coerce.number().int().min(1).max(10000).default(1),
  pageSize: z.coerce.number().int().min(1).max(500).default(200),
});

export const app = express();
const rateBuckets = new Map<string, { startedAt: number; count: number }>();

app.disable("x-powered-by");
app.use((request: Request, response: Response, next: NextFunction) => {
  const requestId = request.header("x-request-id")?.slice(0, 80) || randomUUID();
  const startedAt = performance.now();
  response.setHeader("x-request-id", requestId);
  response.on("finish", () => logger.info("request.completed", {
    requestId,
    method: request.method,
    path: request.path,
    statusCode: response.statusCode,
    durationMs: Math.round((performance.now() - startedAt) * 100) / 100,
  }));
  next();
});
app.use((_request, response, next) => {
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.setHeader("X-Frame-Options", "DENY");
  response.setHeader("Referrer-Policy", "no-referrer");
  response.setHeader("Content-Security-Policy", "default-src 'self'; connect-src 'self' http://localhost:4000 ws://localhost:4000");
  next();
});
app.use((request, response, next) => {
  const now = Date.now();
  const key = request.ip || request.socket.remoteAddress || "unknown";
  const bucket = rateBuckets.get(key);
  for (const [bucketKey, value] of rateBuckets) {
    if (now - value.startedAt >= config.apiRateWindowMs) rateBuckets.delete(bucketKey);
  }
  if (!bucket || now - bucket.startedAt >= config.apiRateWindowMs) {
    rateBuckets.set(key, { startedAt: now, count: 1 });
    next();
    return;
  }
  bucket.count += 1;
  if (bucket.count > config.apiRateLimit) {
    response.setHeader("Retry-After", "60");
    response.status(429).json({ error: { code: "RATE_LIMITED", message: "Too many requests" } });
    return;
  }
  next();
});
app.use(cors({ origin: config.webOrigin }));
app.use(express.json({ limit: "16kb" }));

app.get("/api/health", async (_request, response) => {
  await prisma.$queryRaw`SELECT 1`;
  response.json({ data: { status: "ok" } });
});

app.get("/api/monitors/:id/diagnostics", async (request, response) => {
  const data = await prisma.diagnosticRun.findMany({ where: { monitorId: request.params.id }, orderBy: { startedAt: "desc" }, take: 20 });
  response.json({ data: data.map((run) => ({ ...run, result: run.resultJson ? JSON.parse(run.resultJson) : null })) });
});

app.post("/api/monitors/:id/diagnostics", async (request, response) => {
  const parsed = z.object({ kind: z.enum(["DNS", "ROUTE"]) }).safeParse(request.body);
  if (!parsed.success) {
    response.status(400).json({ error: { code: "VALIDATION_ERROR", message: "kind must be DNS or ROUTE" } });
    return;
  }
  const controller = new AbortController();
  request.once("aborted", () => controller.abort());
  try {
    const data = await runDiagnostic(request.params.id, parsed.data.kind, controller.signal);
    response.status(data.status === "COMPLETED" ? 201 : 200).json({ data });
  } catch (error) {
    response.status(404).json({ error: { code: "DIAGNOSTIC_FAILED", message: error instanceof Error ? error.message : "Diagnostic failed" } });
  }
});

app.get("/api/monitors", async (_request, response) => {
  const monitors = await prisma.monitor.findMany({
    orderBy: { createdAt: "desc" },
    include: { measurements: { orderBy: { completedAt: "desc" }, take: 1 } },
  });
  const data = await Promise.all(monitors.map(async (monitor) => {
    return getMonitorSummary(monitor);
  }));
  response.json({ data });
});

type MonitorSummaryInput = Awaited<ReturnType<typeof prisma.monitor.findFirstOrThrow>> & {
  measurements?: Array<{ success: boolean }>;
};

async function getMonitorSummary(monitor: MonitorSummaryInput) {
    const [completedProbes, failedProbes, activeOutage] = await Promise.all([
      prisma.measurement.count({ where: { monitorId: monitor.id } }),
      prisma.measurement.count({ where: { monitorId: monitor.id, success: false } }),
      prisma.outage.findFirst({ where: { monitorId: monitor.id, endedAt: null }, orderBy: { startedAt: "desc" } }),
    ]);
    return {
      ...monitor,
      status: !monitor.enabled ? "PAUSED" : activeOutage ? "DOWN" : monitor.measurements?.[0] ? (monitor.measurements[0].success ? "UP" : "UNKNOWN") : "UNKNOWN",
      activeOutage,
      completedProbes,
      failedProbes,
      packetLossPercent: completedProbes ? Math.round((failedProbes / completedProbes) * 10000) / 100 : null,
      sampledAvailabilityPercent: completedProbes ? Math.round(((completedProbes - failedProbes) / completedProbes) * 10000) / 100 : null,
    };
}

app.get("/api/monitors/:id", async (request, response) => {
  const monitor = await prisma.monitor.findUnique({
    where: { id: request.params.id },
    include: { measurements: { orderBy: { completedAt: "desc" }, take: 1 } },
  });

  if (!monitor) {
    response.status(404).json({ error: { code: "MONITOR_NOT_FOUND", message: "Monitor not found" } });
    return;
  }
  response.json({ data: await getMonitorSummary(monitor) });
});

app.get("/api/monitors/:id/history", async (request, response) => {
    const parsed = historyQuery.safeParse(request.query);
    if (!parsed.success) {
      response.status(400).json({ error: { code: "VALIDATION_ERROR", message: "hours must be between 1 and 720" } });
      return;
    }
    const monitor = await prisma.monitor.findUnique({ where: { id: request.params.id } });
    if (!monitor) {
      response.status(404).json({ error: { code: "MONITOR_NOT_FOUND", message: "Monitor not found" } });
      return;
    }
    const to = new Date();
    const from = new Date(to.getTime() - parsed.data.hours * 60 * 60 * 1000);
    const skip = (parsed.data.page - 1) * parsed.data.pageSize;
    const [measurements, outages, totalMeasurements, failedMeasurements, latencyStatistics] = await Promise.all([
      prisma.measurement.findMany({
        where: { monitorId: monitor.id, completedAt: { gte: from } },
        orderBy: { completedAt: "asc" },
        skip,
        take: parsed.data.pageSize,
      }),
      prisma.outage.findMany({
        where: {
          monitorId: monitor.id,
          OR: [{ endedAt: null }, { endedAt: { gte: from } }],
        },
        orderBy: { startedAt: "asc" },
        take: 500,
      }),
      prisma.measurement.count({ where: { monitorId: monitor.id, completedAt: { gte: from } } }),
      prisma.measurement.count({ where: { monitorId: monitor.id, completedAt: { gte: from }, success: false } }),
      prisma.measurement.aggregate({
        where: { monitorId: monitor.id, completedAt: { gte: from }, success: true, latencyMs: { not: null } },
        _avg: { latencyMs: true },
        _min: { latencyMs: true },
        _max: { latencyMs: true },
      }),
    ]);
    const completedProbes = totalMeasurements;
    const failedProbes = failedMeasurements;
    const windowEnd = to;
    const windowMs = Math.max(1, windowEnd.getTime() - from.getTime());
    const downtimeMs = outages.reduce((total, outage) => {
      const start = Math.max(from.getTime(), outage.startedAt.getTime());
      const end = Math.min(windowEnd.getTime(), outage.endedAt?.getTime() ?? windowEnd.getTime());
      return total + Math.max(0, end - start);
    }, 0);
    response.json({
      data: {
        monitorId: monitor.id,
        from: from.toISOString(),
        to: windowEnd.toISOString(),
        measurements,
        outages,
        page: parsed.data.page,
        pageSize: parsed.data.pageSize,
        totalMeasurements,
        hasMore: skip + measurements.length < totalMeasurements,
        completedProbes,
        failedProbes,
        successfulProbes: completedProbes - failedProbes,
        averageLatencyMs: latencyStatistics._avg.latencyMs === null ? null : Math.round(latencyStatistics._avg.latencyMs * 100) / 100,
        minimumLatencyMs: latencyStatistics._min.latencyMs,
        maximumLatencyMs: latencyStatistics._max.latencyMs,
        outageCount: outages.length,
        packetLossPercent: completedProbes ? Math.round((failedProbes / completedProbes) * 10000) / 100 : null,
        sampledAvailabilityPercent: completedProbes ? Math.round(((completedProbes - failedProbes) / completedProbes) * 10000) / 100 : null,
        durationAvailabilityPercent: Math.max(0, Math.round((1 - downtimeMs / windowMs) * 10000) / 100),
      },
    });
});

app.post("/api/monitors", async (request, response) => {
  const parsed = monitorInput.safeParse({ kind: request.body.kind ?? "HTTP", ...request.body });
  if (!parsed.success) {
    response.status(400).json({ error: { code: "VALIDATION_ERROR", message: parsed.error.issues[0]?.message ?? "Invalid monitor" } });
    return;
  }
  if (config.maxMonitors < 1 || await prisma.monitor.count() >= config.maxMonitors) {
    response.status(429).json({ error: { code: "MONITOR_LIMIT", message: "The monitor limit has been reached" } });
    return;
  }
  let url: string;
  let host: string | undefined;
  let port: number | undefined;
  try {
    if (parsed.data.kind === "HTTP") {
      url = (await validateHttpTarget(parsed.data.url)).url;
    } else {
      host = (await validateHost(parsed.data.host))[0].address;
      port = parsed.data.kind === "TCP" ? parsed.data.port : undefined;
      url = parsed.data.host;
    }
  } catch (error) {
    response.status(400).json({ error: { code: "UNSAFE_TARGET", message: error instanceof Error ? error.message : "Target is not allowed" } });
    return;
  }
  const monitor = await prisma.monitor.create({
    data: {
      name: parsed.data.name,
      url,
      kind: parsed.data.kind,
      host,
      port,
      intervalSeconds: parsed.data.intervalSeconds,
      timeoutMs: parsed.data.timeoutMs,
    },
  });
  void scheduleMonitor(monitor.id).catch((error) => logger.error("monitor.schedule_failed", {
    monitorId: monitor.id,
    error: error instanceof Error ? error.message : "Unknown error",
  }));
  response.status(201).json({ data: monitor });
});

app.post("/api/monitors/:id/probe", async (request, response) => {
  const measurement = await runProbe(request.params.id);
  if (!measurement) {
    response.status(404).json({ error: { code: "MONITOR_NOT_FOUND", message: "Monitor not found or probe already running" } });
    return;
  }
  response.status(201).json({ data: measurement });
});

app.patch("/api/monitors/:id", async (request, response) => {
  const parsed = z.object({ enabled: z.boolean().optional(), name: commonInput.name.optional() }).safeParse(request.body);
  if (!parsed.success || !Object.keys(parsed.data).length) {
    response.status(400).json({ error: { code: "VALIDATION_ERROR", message: "Provide enabled or name" } });
    return;
  }
  const existing = await prisma.monitor.findUnique({ where: { id: request.params.id } });
  if (!existing) {
    response.status(404).json({ error: { code: "MONITOR_NOT_FOUND", message: "Monitor not found" } });
    return;
  }
  if (parsed.data.enabled === false) clearSchedule(existing.id);
  const monitor = await prisma.monitor.update({ where: { id: existing.id }, data: parsed.data });
  if (parsed.data.enabled === true) {
    void scheduleMonitor(monitor.id).catch((error) => logger.error("monitor.schedule_failed", {
      monitorId: monitor.id,
      error: error instanceof Error ? error.message : "Unknown error",
    }));
  }
  if (parsed.data.enabled !== undefined) {
    emitMonitoringEvent({
      type: "monitor.status_changed",
      occurredAt: new Date().toISOString(),
      payload: { monitorId: monitor.id, status: monitor.enabled ? "UNKNOWN" : "PAUSED" },
    });
  }
  response.json({ data: monitor });
});

app.delete("/api/monitors/:id", async (request, response) => {
  clearSchedule(request.params.id);
  const deleted = await prisma.monitor.deleteMany({ where: { id: request.params.id } });
  if (!deleted.count) {
    response.status(404).json({ error: { code: "MONITOR_NOT_FOUND", message: "Monitor not found" } });
    return;
  }
  response.status(204).send();
});

app.use((_request, response) => {
  response.status(404).json({ error: { code: "NOT_FOUND", message: "Route not found" } });
});

app.use((error: unknown, request: Request, response: Response, _next: NextFunction) => {
  const requestId = response.getHeader("x-request-id");
  logger.error("request.failed", {
    requestId,
    method: request.method,
    path: request.path,
    error: error instanceof Error ? error.message : "Unknown error",
  });
  if (response.headersSent) return;
  const status = typeof error === "object" && error !== null && "status" in error && typeof error.status === "number"
    ? error.status
    : 500;
  const clientError = status >= 400 && status < 500;
  response.status(clientError ? status : 500).json({
    error: {
      code: clientError ? (status === 413 ? "PAYLOAD_TOO_LARGE" : "INVALID_REQUEST") : "INTERNAL_ERROR",
      message: clientError ? "Invalid request" : "An internal error occurred",
      requestId,
    },
  });
});
