import { prisma } from "./db.js";
import { config } from "./config.js";
import { emitMonitoringEvent } from "./measurement-events.js";
import type { WebSocketEvent } from "@netpulse/contracts";

export async function updateOutageState(
  monitorId: string,
  completedAt: Date,
  success: boolean,
  errorMessage?: string | null,
) {
  const recent = await prisma.measurement.findMany({
    where: { monitorId },
    orderBy: { completedAt: "desc" },
    take: config.outageFailureThreshold,
    select: { success: true, completedAt: true },
  });
  const consecutiveFailures = recent.every((measurement) => !measurement.success)
    ? recent.length
    : 0;
  const active = await prisma.outage.findFirst({
    where: { monitorId, endedAt: null },
    orderBy: { startedAt: "desc" },
  });

  if (!success && consecutiveFailures >= config.outageFailureThreshold && !active) {
    const firstFailure = recent[recent.length - 1];
    const outage = await prisma.outage.create({
      data: {
        monitorId,
        startedAt: firstFailure?.completedAt ?? completedAt,
        failureCount: consecutiveFailures,
        reason: errorMessage ?? "Consecutive probes failed",
      },
    });
    const event: WebSocketEvent = {
      type: "outage.started",
      occurredAt: completedAt.toISOString(),
      payload: {
        monitorId,
        outageId: outage.id,
        occurredAt: completedAt.toISOString(),
        startedAt: outage.startedAt.toISOString(),
        endedAt: null,
        failureCount: outage.failureCount,
        reason: outage.reason,
      },
    };
    emitMonitoringEvent(event);
    emitMonitoringEvent({
      type: "monitor.status_changed",
      occurredAt: completedAt.toISOString(),
      payload: { monitorId, status: "DOWN" },
    });
  } else if (success && active) {
    const outage = await prisma.outage.update({
      where: { id: active.id },
      data: { endedAt: completedAt, failureCount: consecutiveFailures || active.failureCount },
    });
    emitMonitoringEvent({
      type: "outage.recovered",
      occurredAt: completedAt.toISOString(),
      payload: {
        monitorId,
        outageId: outage.id,
        occurredAt: completedAt.toISOString(),
        startedAt: outage.startedAt.toISOString(),
        endedAt: outage.endedAt?.toISOString() ?? null,
        failureCount: outage.failureCount,
        reason: outage.reason,
      },
    });
    emitMonitoringEvent({
      type: "monitor.status_changed",
      occurredAt: completedAt.toISOString(),
      payload: { monitorId, status: "UP" },
    });
  } else if (!success && active) {
    await prisma.outage.update({
      where: { id: active.id },
      data: { failureCount: active.failureCount + 1 },
    });
  }
}
