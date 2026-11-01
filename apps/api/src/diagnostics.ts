import type { DiagnosticKind, DiagnosticRun, DiagnosticResult, DiagnosticStatus } from "@netpulse/contracts";
import { prisma } from "./db.js";
import { config } from "./config.js";
import { validateHost } from "./target.js";
import { diagnoseDns } from "./dns-diagnostic.js";
import { diagnoseRoute } from "./route-diagnostic.js";

const active = new Set<string>();

export async function runDiagnostic(
  monitorId: string,
  kind: DiagnosticKind,
  signal?: AbortSignal,
): Promise<DiagnosticRun> {
  if (active.size >= config.maxDiagnostics) throw new Error("Diagnostic capacity is busy");
  const monitor = await prisma.monitor.findUnique({ where: { id: monitorId } });
  if (!monitor) throw new Error("Monitor not found");
  const hostname = monitor.kind === "HTTP" ? new URL(monitor.url).hostname : monitor.host;
  if (!hostname) throw new Error("Monitor has no diagnostic hostname");
  const startedAt = new Date();
  const run = await prisma.diagnosticRun.create({ data: { monitorId, kind, status: "RUNNING", startedAt, capability: "pending" } });
  active.add(run.id);
  try {
    if (signal?.aborted) throw new Error("Diagnostic cancelled");
    await validateHost(hostname);
    const execution = kind === "DNS"
      ? await diagnoseDns(hostname, config.diagnosticTimeoutMs, { signal })
      : await diagnoseRoute(hostname, { maxHops: config.diagnosticMaxHops, timeoutMs: config.diagnosticTimeoutMs, signal });
    const completedAt = new Date();
    const updated = await prisma.diagnosticRun.update({
      where: { id: run.id },
      data: { status: "COMPLETED", completedAt, durationMs: execution.durationMs, capability: "supported", resultJson: JSON.stringify(execution.result) },
    });
    return toDiagnosticRun(updated);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Diagnostic failed";
    const status: DiagnosticStatus = message.includes("cancelled") ? "CANCELLED" : message.includes("unsupported") || message.includes("ENOENT") ? "UNSUPPORTED" : "FAILED";
    const updated = await prisma.diagnosticRun.update({ where: { id: run.id }, data: { status, completedAt: new Date(), capability: status === "UNSUPPORTED" ? "unsupported" : "supported", errorCode: status, errorMessage: message } });
    return toDiagnosticRun(updated);
  } finally {
    active.delete(run.id);
  }
}

function toDiagnosticRun(run: {
  id: string; monitorId: string; kind: string; status: string; startedAt: Date; completedAt: Date | null; durationMs: number | null; capability: string; resultJson: string | null; errorCode: string | null; errorMessage: string | null;
}): DiagnosticRun {
  return { id: run.id, monitorId: run.monitorId, kind: run.kind as DiagnosticKind, status: run.status as DiagnosticStatus, startedAt: run.startedAt.toISOString(), completedAt: run.completedAt?.toISOString() ?? null, durationMs: run.durationMs, capability: run.capability, result: run.resultJson ? JSON.parse(run.resultJson) as DiagnosticResult : null, errorCode: run.errorCode, errorMessage: run.errorMessage };
}
