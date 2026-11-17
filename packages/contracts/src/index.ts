export const websocketEventTypes = [
  "connection.ready",
  "measurement.completed",
  "outage.started",
  "outage.recovered",
  "monitor.status_changed",
] as const;

export type MeasurementCompletedPayload = {
  monitorId: string;
  measurementId: string;
  completedAt: string;
  success: boolean;
};

export type OutagePayload = {
  monitorId: string;
  outageId: string;
  occurredAt: string;
  startedAt: string;
  endedAt: string | null;
  failureCount: number;
  reason: string | null;
};

export type MonitorStatusPayload = {
  monitorId: string;
  status: "UP" | "DOWN" | "PAUSED" | "UNKNOWN";
};

export type WebSocketEvent =
  | {
      type: "connection.ready";
      occurredAt: string;
      payload: { protocolVersion: 1 };
    }
  | {
      type: "measurement.completed";
      occurredAt: string;
      payload: MeasurementCompletedPayload;
    }
  | {
      type: "outage.started" | "outage.recovered";
      occurredAt: string;
      payload: OutagePayload;
    }
  | {
      type: "monitor.status_changed";
      occurredAt: string;
      payload: MonitorStatusPayload;
    };

export type DiagnosticKind = "DNS" | "ROUTE" | "TLS" | "HTTP";
export type DiagnosticStatus = "COMPLETED" | "FAILED" | "UNSUPPORTED" | "CANCELLED";

export type DnsDiagnosticResult = {
    kind: "DNS";
    hostname: string;
    records: {
      A: string[];
      AAAA: string[];
    };
    recordStatus: {
      A: "RESOLVED" | "ABSENT" | "FAILED";
      AAAA: "RESOLVED" | "ABSENT" | "FAILED";
    };
};

export type RouteHop = {
    hop: number;
    address: string | null;
    latencyMs: number | null;
    responsive: boolean;
};

export type RouteDiagnosticResult = {
    kind: "ROUTE";
    hostname: string;
    platform: string;
    command: "tracert" | "traceroute";
    hops: RouteHop[];
    reachedDestination: boolean;
};

export type CertificateSummary = {
    subjectCommonName: string | null;
    issuerCommonName: string | null;
    subjectAltNames: string[];
    validFrom: string;
    validTo: string;
    daysRemaining: number;
    validityStatus: "VALID" | "EXPIRED" | "NOT_YET_VALID";
    fingerprint256: string | null;
    serialNumber: string | null;
};

export type TlsDiagnosticResult = {
    kind: "TLS";
    hostname: string;
    port: number;
    authorized: boolean;
    authorizationError: string | null;
    hostnameMatched: boolean;
    hostnameError: string | null;
    protocol: string | null;
    cipher: string | null;
    alpnProtocol: string | null;
    certificate: CertificateSummary;
    timings: {
      dnsLookupMs: number;
      tcpConnectMs: number;
      tlsHandshakeMs: number;
      totalMs: number;
    };
};

export type HttpRedirect = {
    statusCode: number;
    from: string;
    to: string;
};

export type HttpDiagnosticResult = {
    kind: "HTTP";
    requestedUrl: string;
    finalUrl: string;
    method: "GET";
    statusCode: number;
    redirectCount: number;
    redirects: HttpRedirect[];
    responseBytes: number;
    responseTruncated: boolean;
    httpVersion: string;
    remoteAddress: string;
    timings: {
      dnsLookupMs: number;
      tcpConnectMs: number;
      tlsHandshakeMs: number | null;
      timeToFirstByteMs: number;
      totalMs: number;
    };
};

export type DiagnosticResult = DnsDiagnosticResult | RouteDiagnosticResult | TlsDiagnosticResult | HttpDiagnosticResult;

export type DiagnosticRun = {
    id: string;
    monitorId: string;
    kind: DiagnosticKind;
    status: DiagnosticStatus;
    startedAt: string;
    completedAt: string | null;
    durationMs: number | null;
    capability: string;
    result: DiagnosticResult | null;
    errorCode: string | null;
    errorMessage: string | null;
};

export const agentProtocolVersion = 1 as const;
export type AgentCapability = "HTTP" | "TCP" | "ICMP";
export type AgentLifecycleStatus = "ENROLLED" | "ONLINE" | "OFFLINE" | "SUSPENDED" | "REVOKED";

export type AgentIdentity = {
    id: string;
    name: string;
    status: AgentLifecycleStatus;
    platform: string;
    version: string;
    capabilities: AgentCapability[];
    lastHeartbeatAt: string | null;
    lastConnectedAt: string | null;
    credentialVersion: number;
};

export type AgentProbeTask = {
    id: string;
    monitorId: string;
    sessionGeneration: number;
    kind: AgentCapability;
    url: string;
    host: string | null;
    port: number | null;
    timeoutMs: number;
    issuedAt: string;
    expiresAt: string;
};

export type CoordinatorAgentMessage =
  | { type: "coordinator.challenge"; protocolVersion: 1; nonce: string; issuedAt: string }
  | { type: "coordinator.authenticated"; protocolVersion: 1; agentId: string; sessionId: string; sessionGeneration: number; heartbeatIntervalMs: number }
  | { type: "coordinator.task"; protocolVersion: 1; task: AgentProbeTask }
  | { type: "coordinator.cancel"; protocolVersion: 1; taskId: string; reason: string }
  | { type: "coordinator.error"; protocolVersion: 1; code: string; message: string };

export type AgentCoordinatorMessage =
  | { type: "agent.authenticate"; protocolVersion: 1; agentId: string; nonce: string; signedAt: string; signature: string }
  | { type: "agent.heartbeat"; protocolVersion: 1; agentId: string; sessionId: string; sequence: number; occurredAt: string; health: "OK" | "DEGRADED" }
  | { type: "agent.result"; protocolVersion: 1; agentId: string; sessionId: string; taskId: string; startedAt: string; completedAt: string; result: { success: boolean; latencyMs: number | null; statusCode?: number; errorCode?: string; errorMessage?: string } };

export function agentAuthenticationPayload(agentId: string, nonce: string, signedAt: string) {
  return `netpulse-agent-auth-v1\n${agentId}\n${nonce}\n${signedAt}`;
}

export type AnalysisHealth = "HEALTHY" | "DEGRADED" | "CRITICAL" | "INSUFFICIENT_DATA";
export type AnalysisSeverity = "INFO" | "WARNING" | "CRITICAL";
export type EvidenceQuality = "LOW" | "MEDIUM" | "HIGH";
export type FindingClassification = "OBSERVATION" | "CONFIRMED_FINDING";
export type AnalysisCategory = "DATA_QUALITY" | "LATENCY" | "AVAILABILITY" | "CONNECTION" | "OUTAGE" | "DNS" | "HTTP" | "TLS";

export type AnalysisEvidence = {
  kind: "MEASUREMENT" | "OUTAGE" | "DIAGNOSTIC";
  id: string;
  occurredAt: string;
  summary: string;
};

export type AnalysisFinding = {
  id: string;
  monitorId: string;
  category: AnalysisCategory;
  severity: AnalysisSeverity;
  confidence: EvidenceQuality;
  classification: FindingClassification;
  title: string;
  observation: string;
  possibleExplanations: string[];
  recommendation: string;
  evidence: AnalysisEvidence[];
};

export type MonitorAnalysis = {
  monitorId: string;
  monitorName: string;
  monitorKind: "HTTP" | "TCP" | "ICMP";
  health: AnalysisHealth;
  summary: string;
  measurementCount: number;
  successfulCount: number;
  failedCount: number;
  sampledAvailabilityPercent: number | null;
  averageLatencyMs: number | null;
  baseline: {
    baselineSampleCount: number;
    recentSampleCount: number;
    baselineAverageLatencyMs: number;
    recentAverageLatencyMs: number;
    changePercent: number;
  } | null;
  sourceCounts: { local: number; agent: number };
  evidenceWindowTruncated: boolean;
  findings: AnalysisFinding[];
};

export type NetworkAnalysis = {
  generatedAt: string;
  window: { from: string; to: string; hours: number };
  health: AnalysisHealth;
  summary: string;
  analyzedMonitorCount: number;
  limits: {
    monitorsTruncated: boolean;
    maximumMonitors: number;
    maximumMeasurementsPerMonitor: number;
    maximumOutagesPerMonitor: number;
    maximumDiagnosticsPerMonitor: number;
  };
  findings: AnalysisFinding[];
  monitors: MonitorAnalysis[];
  assistance: {
    enabled: false;
    status: "DISABLED";
    provider: null;
    message: string;
  };
};
