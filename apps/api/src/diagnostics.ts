import type { DiagnosticKind, DiagnosticRun, DiagnosticResult, DiagnosticStatus } from "@netpulse/contracts";
import { prisma } from "./db.js";
import { config } from "./config.js";
import { validateHost, validateHttpTarget } from "./target.js";
import { diagnoseDns } from "./dns-diagnostic.js";
import { diagnoseRoute } from "./route-diagnostic.js";
import { diagnoseTls } from "./tls-diagnostic.js";
import { diagnoseHttp } from "./http-diagnostic.js";

const active = new Set<symbol>();

async function validateTlsTarget(url: string, timeoutMs: number, signal?: AbortSignal) {
  return new Promise<Awaited<ReturnType<typeof validateHttpTarget>>>((resolve, reject) => {
    let settled = false;
    const finish = (error?: Error, target?: Awaited<ReturnType<typeof validateHttpTarget>>) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
      if (error) reject(error);
      else if (target) resolve(target);
    };
    const abort = () => finish(new Error("TLS diagnostic cancelled"));
    const timer = setTimeout(() => finish(new Error("TLS diagnostic timed out")), timeoutMs);
    signal?.addEventListener("abort", abort, { once: true });
    if (signal?.aborted) {
      abort();
      return;
    }
    validateHttpTarget(url).then((target) => finish(undefined, target), (error) => finish(error instanceof Error ? error : new Error("TLS target validation failed")));
  });
}

export async function runDiagnostic(
  monitorId: string,
  kind: DiagnosticKind,
  signal?: AbortSignal,
): Promise<DiagnosticRun> {
  if (active.size >= config.maxDiagnostics) throw new Error("Diagnostic capacity is busy");
  const reservation = Symbol("diagnostic-slot");
  active.add(reservation);
  try {
    const monitor = await prisma.monitor.findUnique({ where: { id: monitorId } });
    if (!monitor) throw new Error("Monitor not found");
    const hostname = monitor.kind === "HTTP" ? new URL(monitor.url).hostname.replace(/^\[|\]$/g, "") : monitor.host;
    if (!hostname) throw new Error("Monitor has no diagnostic hostname");
    const startedAt = new Date();
    const run = await prisma.diagnosticRun.create({ data: { monitorId, kind, status: "RUNNING", startedAt, capability: "pending" } });
    try {
      if (signal?.aborted) throw new Error("Diagnostic cancelled");
      let execution: { result: DiagnosticResult; durationMs: number };
      if (kind === "HTTP") {
        if (monitor.kind !== "HTTP") throw new Error("HTTP diagnostics require an HTTP monitor");
        execution = await diagnoseHttp(monitor.url, {
          timeoutMs: config.diagnosticTimeoutMs,
          maxRedirects: config.diagnosticMaxRedirects,
          maxResponseBytes: config.maxResponseBytes,
          signal,
        });
      } else if (kind === "TLS") {
        if (monitor.kind !== "HTTP" || new URL(monitor.url).protocol !== "https:") {
          throw new Error("TLS diagnostics require an HTTPS monitor");
        }
        const validationStarted = performance.now();
        const target = await validateTlsTarget(monitor.url, config.diagnosticTimeoutMs, signal);
        const dnsLookupMs = Math.max(0, Math.round(performance.now() - validationStarted));
        execution = await diagnoseTls(target, dnsLookupMs, Math.max(1, config.diagnosticTimeoutMs - dnsLookupMs), { signal });
      } else {
        await validateHost(hostname);
        execution = kind === "DNS"
          ? await diagnoseDns(hostname, config.diagnosticTimeoutMs, { signal })
          : await diagnoseRoute(hostname, { maxHops: config.diagnosticMaxHops, timeoutMs: config.diagnosticTimeoutMs, signal });
      }
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
    }
  } finally {
    active.delete(reservation);
  }
}

function toDiagnosticRun(run: {
  id: string; monitorId: string; kind: string; status: string; startedAt: Date; completedAt: Date | null; durationMs: number | null; capability: string; resultJson: string | null; errorCode: string | null; errorMessage: string | null;
}): DiagnosticRun {
  return { id: run.id, monitorId: run.monitorId, kind: run.kind as DiagnosticKind, status: run.status as DiagnosticStatus, startedAt: run.startedAt.toISOString(), completedAt: run.completedAt?.toISOString() ?? null, durationMs: run.durationMs, capability: run.capability, result: run.resultJson ? JSON.parse(run.resultJson) as DiagnosticResult : null, errorCode: run.errorCode, errorMessage: run.errorMessage };
}
