import { prisma } from "./db.js";
import { probeHttp } from "./probe.js";
import { emitMeasurementCompleted } from "./measurement-events.js";
import type { WebSocketEvent } from "@netpulse/contracts";
import type { ProbeResult } from "./probe.js";
import { probeTcp } from "./tcp-probe.js";
import { probeIcmp } from "./icmp-probe.js";
import type { ProbeTarget } from "./probe-types.js";
import { updateOutageState } from "./outages.js";
import { config } from "./config.js";
import { logger } from "./logger.js";

const timers = new Map<string, NodeJS.Timeout>();
const active = new Set<string>();
let retentionTimer: NodeJS.Timeout | undefined;

async function runProbeSafely(monitorId: string) {
  try {
    await runProbe(monitorId);
  } catch (error) {
    logger.error("probe.failed_unhandled", { monitorId, error: error instanceof Error ? error.message : "Unknown error" });
  }
}

async function executeProbe(target: ProbeTarget, timeoutMs: number) {
  if (target.kind === "TCP") return probeTcp(target.host ?? target.url, target.port ?? 0, timeoutMs);
  if (target.kind === "ICMP") return probeIcmp(target.host ?? target.url, timeoutMs);
  return probeHttp(target.url, timeoutMs);
}

export async function runProbe(
  monitorId: string,
  probe: (target: ProbeTarget, timeoutMs: number) => Promise<ProbeResult> = executeProbe,
) {
  if (active.has(monitorId)) return null;
  const monitor = await prisma.monitor.findUnique({ where: { id: monitorId } });
  if (!monitor || !monitor.enabled) return null;

  active.add(monitorId);
  const startedAt = new Date();
  try {
    const result = await probe({
      kind: (monitor.kind || "HTTP") as ProbeTarget["kind"],
      url: monitor.url,
      host: monitor.host ?? undefined,
      port: monitor.port ?? undefined,
    }, monitor.timeoutMs);
    const currentMonitor = await prisma.monitor.findUnique({ where: { id: monitorId } });
    if (!currentMonitor) return null;
    const measurement = await prisma.measurement.create({
      data: {
        monitorId,
        startedAt,
        completedAt: new Date(),
        success: result.success,
        latencyMs: result.latencyMs,
        statusCode: result.statusCode,
        errorCode: result.errorCode,
        errorMessage: result.errorMessage,
      },
    });
    await updateOutageState(monitorId, measurement.completedAt, measurement.success, measurement.errorMessage);
    const event: WebSocketEvent = {
      type: "measurement.completed",
      occurredAt: measurement.completedAt.toISOString(),
      payload: {
        monitorId: measurement.monitorId,
        measurementId: measurement.id,
        completedAt: measurement.completedAt.toISOString(),
        success: measurement.success,
      },
    };
    emitMeasurementCompleted(event);
    return measurement;
  } finally {
    active.delete(monitorId);
  }
}

export async function scheduleMonitor(monitorId: string) {
  clearSchedule(monitorId);
  await runProbe(monitorId);
  const monitor = await prisma.monitor.findUnique({ where: { id: monitorId } });
  if (!monitor?.enabled) return;
  const timer = setInterval(() => void runProbeSafely(monitorId), monitor.intervalSeconds * 1000);
  timers.set(monitorId, timer);
}

export function clearSchedule(monitorId: string) {
  const timer = timers.get(monitorId);
  if (timer) clearInterval(timer);
  timers.delete(monitorId);
}

export async function startScheduler() {
  const monitors = await prisma.monitor.findMany({ where: { enabled: true } });
  for (const monitor of monitors) void scheduleMonitor(monitor.id).catch((error) => logger.error("monitor.schedule_failed", { monitorId: monitor.id, error: error instanceof Error ? error.message : "Unknown error" }));
  await pruneHistory();
  retentionTimer = setInterval(() => void pruneHistory().catch((error) => logger.error("retention.cleanup_failed", { error: error instanceof Error ? error.message : "Unknown error" })), 60 * 60 * 1000);
}

export function stopScheduler() {
  for (const monitorId of timers.keys()) clearSchedule(monitorId);
  if (retentionTimer) clearInterval(retentionTimer);
  retentionTimer = undefined;
}

export async function pruneHistory(now = new Date()) {
  const cutoff = new Date(now.getTime() - config.retentionDays * 24 * 60 * 60 * 1000);
  await prisma.measurement.deleteMany({ where: { completedAt: { lt: cutoff } } });
  await prisma.outage.deleteMany({ where: { endedAt: { not: null, lt: cutoff } } });
}
