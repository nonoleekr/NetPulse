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
