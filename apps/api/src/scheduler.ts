import { prisma } from "./db.js";
import { probeHttp } from "./probe.js";

const timers = new Map<string, NodeJS.Timeout>();
const active = new Set<string>();

export async function runProbe(monitorId: string) {
  if (active.has(monitorId)) return null;
  const monitor = await prisma.monitor.findUnique({ where: { id: monitorId } });
  if (!monitor || !monitor.enabled) return null;

  active.add(monitorId);
  const startedAt = new Date();
  try {
    const result = await probeHttp(monitor.url, monitor.timeoutMs);
    return await prisma.measurement.create({
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
  } finally {
    active.delete(monitorId);
  }
}

export async function scheduleMonitor(monitorId: string) {
  clearSchedule(monitorId);
  await runProbe(monitorId);
  const monitor = await prisma.monitor.findUnique({ where: { id: monitorId } });
  if (!monitor?.enabled) return;
  const timer = setInterval(() => void runProbe(monitorId), monitor.intervalSeconds * 1000);
  timers.set(monitorId, timer);
}

export function clearSchedule(monitorId: string) {
  const timer = timers.get(monitorId);
  if (timer) clearInterval(timer);
  timers.delete(monitorId);
}

export async function startScheduler() {
  const monitors = await prisma.monitor.findMany({ where: { enabled: true } });
  for (const monitor of monitors) void scheduleMonitor(monitor.id);
}

export function stopScheduler() {
  for (const monitorId of timers.keys()) clearSchedule(monitorId);
}
