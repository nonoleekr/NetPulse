import { describe, expect, it } from "vitest";
import type { AnalysisMonitorInput } from "./analysis.js";
import { analyzeMonitor, analyzeNetwork } from "./analysis.js";

const to = new Date("2026-11-01T12:00:00.000Z");
const from = new Date("2026-10-31T12:00:00.000Z");

function fixture(overrides: Partial<AnalysisMonitorInput> = {}): AnalysisMonitorInput {
  return { id: "monitor-1", name: "Fixture", kind: "HTTP", measurements: [], outages: [], diagnostics: [], ...overrides };
}

function measurements(latencies: number[], failures = 0) {
  return [
    ...latencies.map((latencyMs, index) => ({ id: `success-${index}`, completedAt: new Date(from.getTime() + (index + 1) * 60_000), success: true, latencyMs, statusCode: 200, errorCode: null, source: index % 2 ? "AGENT" : "LOCAL" })),
    ...Array.from({ length: failures }, (_, index) => ({ id: `failure-${index}`, completedAt: new Date(from.getTime() + (latencies.length + index + 1) * 60_000), success: false, latencyMs: 10, statusCode: null, errorCode: "TIMEOUT", source: "LOCAL" })),
  ];
}

describe("deterministic network analysis", () => {
  it("reports explicit insufficient-data state without inventing a diagnosis", () => {
    const result = analyzeMonitor(fixture({ measurements: measurements([20, 30]) }), from, to);
    expect(result.health).toBe("INSUFFICIENT_DATA");
    expect(result.findings[0]).toMatchObject({ category: "DATA_QUALITY", severity: "INFO", confidence: "LOW", possibleExplanations: [] });
    expect(result.baseline).toBeNull();
  });

  it("calculates availability and attributes repeated failures to evidence IDs", () => {
    const result = analyzeMonitor(fixture({ measurements: measurements([20, 21, 22, 23, 24], 5) }), from, to);
    expect(result.sampledAvailabilityPercent).toBe(50);
    expect(result.health).toBe("CRITICAL");
    expect(result.findings.find((item) => item.category === "AVAILABILITY")?.evidence.map((item) => item.id)).toEqual(["failure-0", "failure-1", "failure-2", "failure-3", "failure-4"]);
    expect(result.sourceCounts).toEqual({ local: 8, agent: 2 });
  });

  it("compares latency only after the explicit sample threshold", () => {
    const result = analyzeMonitor(fixture({ measurements: measurements([...Array(14).fill(100), ...Array(6).fill(250)]) }), from, to);
    expect(result.baseline).toEqual({ baselineSampleCount: 14, recentSampleCount: 6, baselineAverageLatencyMs: 100, recentAverageLatencyMs: 250, changePercent: 150 });
    expect(result.findings.find((item) => item.category === "LATENCY")).toMatchObject({ severity: "CRITICAL", classification: "OBSERVATION" });
  });

  it("ignores invalid negative latency and contradictory failed samples in latency averages", () => {
    const result = analyzeMonitor(fixture({ measurements: [
      ...measurements([100, 200, 300, 400, 500]),
      { id: "negative", completedAt: new Date(from.getTime() + 10_000), success: true, latencyMs: -50, statusCode: 200, errorCode: null, source: "LOCAL" },
      { id: "failed-fast", completedAt: new Date(from.getTime() + 20_000), success: false, latencyMs: 1, statusCode: null, errorCode: "TIMEOUT", source: "LOCAL" },
    ] }), from, to);
    expect(result.measurementCount).toBe(6);
    expect(result.averageLatencyMs).toBe(300);
  });

  it("creates confirmed DNS and TLS findings from stored diagnostics", () => {
    const result = analyzeMonitor(fixture({ measurements: measurements([20, 21, 22, 23, 24]), diagnostics: [
      { id: "dns-1", kind: "DNS", status: "FAILED", startedAt: new Date(to.getTime() - 2_000), resultJson: null, errorCode: "DNS_FAILED" },
      { id: "tls-1", kind: "TLS", status: "COMPLETED", startedAt: new Date(to.getTime() - 1_000), errorCode: null, resultJson: JSON.stringify({ kind: "TLS", hostname: "redacted", port: 443, authorized: true, authorizationError: null, hostnameMatched: true, hostnameError: null, protocol: "TLSv1.3", cipher: "fixture", alpnProtocol: null, certificate: { subjectCommonName: null, issuerCommonName: null, subjectAltNames: [], validFrom: from.toISOString(), validTo: to.toISOString(), daysRemaining: 6, validityStatus: "VALID", fingerprint256: null, serialNumber: null }, timings: { dnsLookupMs: 1, tcpConnectMs: 2, tlsHandshakeMs: 3, totalMs: 6 } }) },
    ] }), from, to);
    expect(result.findings.find((item) => item.category === "DNS")).toMatchObject({ classification: "CONFIRMED_FINDING", confidence: "HIGH" });
    expect(result.findings.find((item) => item.category === "TLS")).toMatchObject({ severity: "CRITICAL", classification: "CONFIRMED_FINDING" });
  });

  it("ignores malformed stored diagnostic payloads instead of treating them as evidence", () => {
    const result = analyzeMonitor(fixture({ measurements: measurements([20, 21, 22, 23, 24]), diagnostics: [
      { id: "malformed-http", kind: "HTTP", status: "COMPLETED", startedAt: new Date(to.getTime() - 1_000), resultJson: '{"kind":"HTTP","timings":null}', errorCode: null },
      { id: "malformed-tls", kind: "TLS", status: "COMPLETED", startedAt: new Date(to.getTime() - 2_000), resultJson: '{"kind":"TLS","certificate":null}', errorCode: null },
    ] }), from, to);
    expect(result.health).toBe("HEALTHY");
    expect(result.findings).toEqual([]);
  });

  it("prioritizes critical evidence and preserves AI-disabled behavior", () => {
    const healthy = fixture({ id: "healthy", measurements: measurements([10, 10, 10, 10, 10]) });
    const failing = fixture({ id: "failing", measurements: measurements([10, 10, 10, 10, 10], 5) });
    const result = analyzeNetwork([healthy, failing], from, to, 24);
    expect(result.health).toBe("CRITICAL");
    expect(result.findings[0].severity).toBe("CRITICAL");
    expect(result.assistance).toMatchObject({ enabled: false, status: "DISABLED", provider: null });
  });
});
