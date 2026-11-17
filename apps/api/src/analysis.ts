import type { AnalysisEvidence, AnalysisFinding, AnalysisHealth, AnalysisSeverity, DiagnosticResult, MonitorAnalysis, NetworkAnalysis } from "@netpulse/contracts";

export type AnalysisMeasurementInput = {
  id: string;
  completedAt: Date;
  success: boolean;
  latencyMs: number | null;
  statusCode: number | null;
  errorCode: string | null;
  source: string;
};

export type AnalysisOutageInput = { id: string; startedAt: Date; endedAt: Date | null; failureCount: number; reason: string | null };
export type AnalysisDiagnosticInput = { id: string; kind: string; status: string; startedAt: Date; resultJson: string | null; errorCode: string | null };
export type AnalysisMonitorInput = {
  id: string;
  name: string;
  kind: string;
  measurements: AnalysisMeasurementInput[];
  outages: AnalysisOutageInput[];
  diagnostics: AnalysisDiagnosticInput[];
  evidenceWindowTruncated?: boolean;
};

export const analysisLimits = {
  minimumAvailabilitySamples: 5,
  minimumBaselineSamples: 20,
  maximumEvidencePerFinding: 5,
  maximumFindings: 100,
} as const;

const severityOrder: Record<AnalysisSeverity, number> = { CRITICAL: 0, WARNING: 1, INFO: 2 };
const round = (value: number) => Math.round(value * 100) / 100;
const average = (values: number[]) => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;

function safeDiagnosticResult(value: string | null): DiagnosticResult | null {
  if (!value || value.length > 256 * 1024) return null;
  try {
    const parsed = JSON.parse(value) as { kind?: unknown };
    return parsed && typeof parsed === "object" && typeof parsed.kind === "string" ? parsed as DiagnosticResult : null;
  } catch { return null; }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isDnsResult(result: DiagnosticResult | null): result is Extract<DiagnosticResult, { kind: "DNS" }> {
  return result?.kind === "DNS" && isRecord(result.recordStatus)
    && ["RESOLVED", "ABSENT", "FAILED"].includes(String(result.recordStatus.A))
    && ["RESOLVED", "ABSENT", "FAILED"].includes(String(result.recordStatus.AAAA));
}

function isHttpResult(result: DiagnosticResult | null): result is Extract<DiagnosticResult, { kind: "HTTP" }> {
  return result?.kind === "HTTP" && Number.isInteger(result.statusCode) && isRecord(result.timings)
    && typeof result.timings.timeToFirstByteMs === "number" && Number.isFinite(result.timings.timeToFirstByteMs);
}

function isTlsResult(result: DiagnosticResult | null): result is Extract<DiagnosticResult, { kind: "TLS" }> {
  return result?.kind === "TLS" && typeof result.authorized === "boolean" && typeof result.hostnameMatched === "boolean"
    && isRecord(result.certificate) && typeof result.certificate.daysRemaining === "number" && Number.isFinite(result.certificate.daysRemaining)
    && ["VALID", "EXPIRED", "NOT_YET_VALID"].includes(String(result.certificate.validityStatus));
}

function measurementEvidence(measurements: AnalysisMeasurementInput[]): AnalysisEvidence[] {
  return measurements.slice(-analysisLimits.maximumEvidencePerFinding).map((measurement) => ({
    kind: "MEASUREMENT",
    id: measurement.id,
    occurredAt: measurement.completedAt.toISOString(),
    summary: `${measurement.source === "AGENT" ? "Agent" : "Local"} ${measurement.success ? "successful" : "failed"} measurement${measurement.latencyMs === null ? "" : ` at ${measurement.latencyMs} ms`}${measurement.statusCode === null ? "" : ` with HTTP ${measurement.statusCode}`}${measurement.errorCode ? ` (${measurement.errorCode})` : ""}`,
  }));
}

function quality(sampleCount: number) {
  return sampleCount >= 30 ? "HIGH" as const : sampleCount >= 10 ? "MEDIUM" as const : "LOW" as const;
}

function finding(base: Omit<AnalysisFinding, "id">, discriminator: string): AnalysisFinding {
  return { id: `${base.monitorId}:${base.category.toLowerCase()}:${discriminator}`, ...base };
}

function monitorHealth(findings: AnalysisFinding[], measurementCount: number): AnalysisHealth {
  if (findings.some((item) => item.severity === "CRITICAL")) return "CRITICAL";
  if (findings.some((item) => item.severity === "WARNING")) return "DEGRADED";
  return measurementCount < analysisLimits.minimumAvailabilitySamples ? "INSUFFICIENT_DATA" : "HEALTHY";
}

export function analyzeMonitor(monitor: AnalysisMonitorInput, from: Date, to: Date): MonitorAnalysis {
  const measurements = monitor.measurements
    .filter((item) => Number.isFinite(item.completedAt.getTime()) && item.completedAt >= from && item.completedAt <= to && (item.latencyMs === null || item.latencyMs >= 0))
    .sort((left, right) => left.completedAt.getTime() - right.completedAt.getTime());
  const successful = measurements.filter((item) => item.success);
  const failed = measurements.filter((item) => !item.success);
  const latencies = successful.flatMap((item) => item.latencyMs === null ? [] : [item.latencyMs]);
  const findings: AnalysisFinding[] = [];
  const sampledAvailabilityPercent = measurements.length ? round((successful.length / measurements.length) * 100) : null;

  if (measurements.length < analysisLimits.minimumAvailabilitySamples) {
    findings.push(finding({
      monitorId: monitor.id, category: "DATA_QUALITY", severity: "INFO", confidence: "LOW", classification: "OBSERVATION",
      title: "Insufficient measurement history",
      observation: `Only ${measurements.length} valid measurements are available; at least ${analysisLimits.minimumAvailabilitySamples} are required for availability rules and ${analysisLimits.minimumBaselineSamples} for latency baseline comparison.`,
      possibleExplanations: [], recommendation: "Allow the monitor to collect more measurements before drawing performance conclusions.",
      evidence: measurementEvidence(measurements),
    }, "insufficient-samples"));
  } else if (sampledAvailabilityPercent !== null && sampledAvailabilityPercent < 99) {
    const severity = sampledAvailabilityPercent < 90 ? "CRITICAL" : "WARNING";
    findings.push(finding({
      monitorId: monitor.id, category: "AVAILABILITY", severity, confidence: quality(measurements.length), classification: "OBSERVATION",
      title: severity === "CRITICAL" ? "Low sampled availability" : "Reduced sampled availability",
      observation: `${successful.length} of ${measurements.length} measurements succeeded (${sampledAvailabilityPercent}% sampled availability).`,
      possibleExplanations: ["The target, network path, or probe environment may have been intermittently unavailable."],
      recommendation: "Review the cited failures and correlated outage windows before checking the target service and network path.",
      evidence: measurementEvidence(failed),
    }, "sampled-availability"));
  }

  let baseline: MonitorAnalysis["baseline"] = null;
  if (latencies.length >= analysisLimits.minimumBaselineSamples) {
    const split = Math.floor(latencies.length * 0.7);
    const baselineValues = latencies.slice(0, split);
    const recentValues = latencies.slice(split);
    const baselineAverage = average(baselineValues)!;
    const recentAverage = average(recentValues)!;
    const changePercent = baselineAverage > 0 ? ((recentAverage - baselineAverage) / baselineAverage) * 100 : 0;
    baseline = { baselineSampleCount: baselineValues.length, recentSampleCount: recentValues.length, baselineAverageLatencyMs: round(baselineAverage), recentAverageLatencyMs: round(recentAverage), changePercent: round(changePercent) };
    const difference = recentAverage - baselineAverage;
    if (baselineAverage > 0 && recentAverage >= baselineAverage * 1.5 && difference >= 50) {
      const severity = recentAverage >= baselineAverage * 2 && difference >= 100 ? "CRITICAL" : "WARNING";
      const recentMeasurements = successful.filter((item) => item.latencyMs !== null).slice(-recentValues.length);
      findings.push(finding({
        monitorId: monitor.id, category: "LATENCY", severity, confidence: quality(latencies.length), classification: "OBSERVATION",
        title: severity === "CRITICAL" ? "Large latency increase" : "Elevated recent latency",
        observation: `Recent successful probes averaged ${round(recentAverage)} ms versus a ${round(baselineAverage)} ms earlier baseline (${round(changePercent)}% change).`,
        possibleExplanations: ["The target or network path may be under increased load or experiencing additional delay."],
        recommendation: "Compare the cited recent probes with outage, route, DNS, and HTTP timing evidence before investigating capacity or routing.",
        evidence: measurementEvidence(recentMeasurements),
      }, "latency-baseline"));
    }
  }

  if (failed.length >= 3) {
    const counts = new Map<string, number>();
    for (const item of failed) counts.set(item.errorCode ?? "UNKNOWN", (counts.get(item.errorCode ?? "UNKNOWN") ?? 0) + 1);
    const [code, count] = [...counts].sort((left, right) => right[1] - left[1])[0];
    if (count >= 3) findings.push(finding({
      monitorId: monitor.id, category: "CONNECTION", severity: count >= 5 ? "CRITICAL" : "WARNING", confidence: quality(failed.length), classification: "OBSERVATION",
      title: "Repeated probe failures",
      observation: `${count} failed measurements reported ${code} during the selected window.`,
      possibleExplanations: ["A repeated target, DNS, transport, permission, or network-path condition may be present; the error code alone does not establish root cause."],
      recommendation: "Inspect the cited measurements and run the corresponding bounded diagnostic to narrow the failure stage.",
      evidence: measurementEvidence(failed.filter((item) => (item.errorCode ?? "UNKNOWN") === code)),
    }, `connection-${code}`));
  }

  const outages = monitor.outages.filter((item) => item.startedAt <= to && (item.endedAt === null || item.endedAt >= from)).sort((a, b) => a.startedAt.getTime() - b.startedAt.getTime());
  if (outages.length >= 2) findings.push(finding({
    monitorId: monitor.id, category: "OUTAGE", severity: outages.length >= 4 || outages.some((item) => item.endedAt === null) ? "CRITICAL" : "WARNING", confidence: outages.length >= 4 ? "HIGH" : "MEDIUM", classification: "CONFIRMED_FINDING",
    title: outages.some((item) => item.endedAt === null) ? "Active recurring outage" : "Recurring outages",
    observation: `${outages.length} persisted outage windows overlap the selected analysis period${outages.some((item) => item.endedAt === null) ? ", including an active outage" : ""}.`,
    possibleExplanations: ["The persisted windows confirm repeated failed probes but do not alone identify whether the target or network path caused them."],
    recommendation: "Compare each outage window with DNS, route, connection, and service diagnostics before assigning root cause.",
    evidence: outages.slice(-analysisLimits.maximumEvidencePerFinding).map((item) => ({ kind: "OUTAGE", id: item.id, occurredAt: item.startedAt.toISOString(), summary: `${item.endedAt ? "Recovered" : "Active"} outage after ${item.failureCount} consecutive failures` })),
  }, "recurring-outages"));

  const diagnostics = monitor.diagnostics.filter((item) => item.startedAt >= from && item.startedAt <= to).sort((a, b) => b.startedAt.getTime() - a.startedAt.getTime());
  for (const kind of ["DNS", "HTTP", "TLS"] as const) {
    const diagnostic = diagnostics.find((item) => item.kind === kind);
    if (!diagnostic) continue;
    const result = safeDiagnosticResult(diagnostic.resultJson);
    const evidence = [{ kind: "DIAGNOSTIC" as const, id: diagnostic.id, occurredAt: diagnostic.startedAt.toISOString(), summary: `${kind} diagnostic ${diagnostic.status.toLowerCase()}${diagnostic.errorCode ? ` (${diagnostic.errorCode})` : ""}` }];
    if (kind === "DNS" && (diagnostic.status === "FAILED" || (isDnsResult(result) && result.recordStatus.A === "FAILED" && result.recordStatus.AAAA === "FAILED"))) {
      findings.push(finding({ monitorId: monitor.id, category: "DNS", severity: "WARNING", confidence: "HIGH", classification: "CONFIRMED_FINDING", title: "DNS diagnostic failure", observation: "The latest stored DNS diagnostic in this window failed to resolve supported address records.", possibleExplanations: ["The resolver, hostname configuration, or network path to DNS may have failed at the diagnostic time."], recommendation: "Verify the hostname and resolver reachability, then repeat the bounded DNS diagnostic.", evidence }, diagnostic.id));
    }
    if (kind === "HTTP" && isHttpResult(result)) {
      if (result.statusCode >= 400) findings.push(finding({ monitorId: monitor.id, category: "HTTP", severity: result.statusCode >= 500 ? "CRITICAL" : "WARNING", confidence: "HIGH", classification: "CONFIRMED_FINDING", title: `HTTP ${result.statusCode} diagnostic response`, observation: `The latest stored HTTP diagnostic completed with status ${result.statusCode}.`, possibleExplanations: [result.statusCode >= 500 ? "The target service reported a server-side failure." : "The target rejected or could not satisfy the diagnostic request."], recommendation: "Review the target service logs and request policy for the cited diagnostic time.", evidence }, diagnostic.id));
      if (result.timings.timeToFirstByteMs >= 2_000) findings.push(finding({ monitorId: monitor.id, category: "HTTP", severity: "WARNING", confidence: "HIGH", classification: "OBSERVATION", title: "Slow HTTP first byte", observation: `The latest stored HTTP diagnostic measured ${result.timings.timeToFirstByteMs} ms to first byte.`, possibleExplanations: ["Server processing, connection establishment, or network delay may contribute; this timing alone does not isolate the cause."], recommendation: "Compare DNS, connect, TLS, and first-byte phases in the cited diagnostic before investigating the slowest phase.", evidence }, `${diagnostic.id}-ttfb`));
    }
    if (kind === "TLS" && isTlsResult(result)) {
      const certificate = result.certificate;
      const invalid = certificate.validityStatus !== "VALID" || !result.authorized || !result.hostnameMatched;
      if (invalid || certificate.daysRemaining <= 30) {
        const severity = invalid || certificate.daysRemaining <= 7 ? "CRITICAL" : "WARNING";
        findings.push(finding({ monitorId: monitor.id, category: "TLS", severity, confidence: "HIGH", classification: "CONFIRMED_FINDING", title: invalid ? "TLS certificate validation problem" : "TLS certificate expires soon", observation: `The latest stored TLS diagnostic reports ${certificate.validityStatus.toLowerCase()} validity, ${certificate.daysRemaining} days remaining, trust ${result.authorized ? "accepted" : "rejected"}, and hostname ${result.hostnameMatched ? "matched" : "mismatched"}.`, possibleExplanations: invalid ? ["The certificate may be expired, not yet valid, untrusted, or issued for another hostname."] : [], recommendation: invalid ? "Review the certificate chain, validity dates, and hostname before relying on this endpoint." : "Schedule certificate renewal and verify the replacement before expiry.", evidence }, diagnostic.id));
      }
    }
  }

  findings.sort((left, right) => severityOrder[left.severity] - severityOrder[right.severity] || left.title.localeCompare(right.title));
  const health = monitorHealth(findings, measurements.length);
  const summary = health === "CRITICAL" ? "Critical evidence requires review."
    : health === "DEGRADED" ? "One or more evidence-supported warnings require review."
      : health === "HEALTHY" ? "No warning or critical rule matched the available evidence."
        : "More valid measurements are required for a health conclusion.";
  return {
    monitorId: monitor.id, monitorName: monitor.name, monitorKind: (["HTTP", "TCP", "ICMP"].includes(monitor.kind) ? monitor.kind : "HTTP") as MonitorAnalysis["monitorKind"],
    health, summary, measurementCount: measurements.length, successfulCount: successful.length, failedCount: failed.length,
    sampledAvailabilityPercent, averageLatencyMs: average(latencies) === null ? null : round(average(latencies)!), baseline,
    sourceCounts: { local: measurements.filter((item) => item.source !== "AGENT").length, agent: measurements.filter((item) => item.source === "AGENT").length },
    evidenceWindowTruncated: monitor.evidenceWindowTruncated ?? false,
    findings,
  };
}

export function analyzeNetwork(monitors: AnalysisMonitorInput[], from: Date, to: Date, hours: number, limits: NetworkAnalysis["limits"] = { monitorsTruncated: false, maximumMonitors: monitors.length, maximumMeasurementsPerMonitor: 250, maximumOutagesPerMonitor: 100, maximumDiagnosticsPerMonitor: 50 }): NetworkAnalysis {
  const analyses = monitors.map((monitor) => analyzeMonitor(monitor, from, to));
  const findings = analyses.flatMap((monitor) => monitor.findings).sort((left, right) => severityOrder[left.severity] - severityOrder[right.severity] || left.title.localeCompare(right.title)).slice(0, analysisLimits.maximumFindings);
  const health: AnalysisHealth = analyses.some((item) => item.health === "CRITICAL") ? "CRITICAL"
    : analyses.some((item) => item.health === "DEGRADED") ? "DEGRADED"
      : !analyses.length || analyses.every((item) => item.health === "INSUFFICIENT_DATA") ? "INSUFFICIENT_DATA" : "HEALTHY";
  const summary = !analyses.length ? "No monitors are configured for analysis."
    : health === "CRITICAL" ? `${analyses.filter((item) => item.health === "CRITICAL").length} monitor(s) have critical evidence.`
      : health === "DEGRADED" ? `${analyses.filter((item) => item.health === "DEGRADED").length} monitor(s) have warning evidence.`
        : health === "HEALTHY" ? "No warning or critical rule matched the available evidence."
          : "The configured monitors do not yet have enough measurements for a health conclusion.";
  return { generatedAt: to.toISOString(), window: { from: from.toISOString(), to: to.toISOString(), hours }, health, summary, analyzedMonitorCount: analyses.length, limits, findings, monitors: analyses, assistance: { enabled: false, status: "DISABLED", provider: null, message: "AI assistance is disabled. All displayed conclusions come from deterministic rules and stored evidence." } };
}
