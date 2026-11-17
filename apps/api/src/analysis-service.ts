import { prisma } from "./db.js";
import { analyzeNetwork, type AnalysisMonitorInput } from "./analysis.js";

export const analysisQueryLimits = {
  maximumMonitors: 100,
  maximumMeasurementsPerMonitor: 250,
  maximumOutagesPerMonitor: 100,
  maximumDiagnosticsPerMonitor: 50,
} as const;

export async function getNetworkAnalysis(hours: number, monitorId?: string, now = new Date()) {
  const from = new Date(now.getTime() - hours * 60 * 60 * 1_000);
  const monitors = await prisma.monitor.findMany({
    where: monitorId ? { id: monitorId } : undefined,
    orderBy: { createdAt: "desc" },
    take: analysisQueryLimits.maximumMonitors + 1,
    include: {
      measurements: { where: { completedAt: { gte: from, lte: now } }, orderBy: { completedAt: "desc" }, take: analysisQueryLimits.maximumMeasurementsPerMonitor + 1 },
      outages: { where: { startedAt: { lte: now }, OR: [{ endedAt: null }, { endedAt: { gte: from } }] }, orderBy: { startedAt: "desc" }, take: analysisQueryLimits.maximumOutagesPerMonitor + 1 },
      diagnostics: { where: { startedAt: { gte: from, lte: now }, kind: { in: ["DNS", "HTTP", "TLS"] } }, orderBy: { startedAt: "desc" }, take: analysisQueryLimits.maximumDiagnosticsPerMonitor + 1 },
    },
  });
  if (monitorId && !monitors.length) return null;
  const monitorsTruncated = monitors.length > analysisQueryLimits.maximumMonitors;
  const input: AnalysisMonitorInput[] = monitors.slice(0, analysisQueryLimits.maximumMonitors).map((monitor) => ({
    id: monitor.id,
    name: monitor.name,
    kind: monitor.kind,
    measurements: monitor.measurements.slice(0, analysisQueryLimits.maximumMeasurementsPerMonitor).map((measurement) => ({
      id: measurement.id,
      completedAt: measurement.completedAt,
      success: measurement.success,
      latencyMs: measurement.latencyMs,
      statusCode: measurement.statusCode,
      errorCode: measurement.errorCode,
      source: measurement.source,
    })),
    outages: monitor.outages.slice(0, analysisQueryLimits.maximumOutagesPerMonitor).map((outage) => ({ id: outage.id, startedAt: outage.startedAt, endedAt: outage.endedAt, failureCount: outage.failureCount, reason: outage.reason })),
    diagnostics: monitor.diagnostics.slice(0, analysisQueryLimits.maximumDiagnosticsPerMonitor).map((diagnostic) => ({ id: diagnostic.id, kind: diagnostic.kind, status: diagnostic.status, startedAt: diagnostic.startedAt, resultJson: diagnostic.resultJson, errorCode: diagnostic.errorCode })),
    evidenceWindowTruncated: monitor.measurements.length > analysisQueryLimits.maximumMeasurementsPerMonitor || monitor.outages.length > analysisQueryLimits.maximumOutagesPerMonitor || monitor.diagnostics.length > analysisQueryLimits.maximumDiagnosticsPerMonitor,
  }));
  return analyzeNetwork(input, from, now, hours, { monitorsTruncated, ...analysisQueryLimits });
}
