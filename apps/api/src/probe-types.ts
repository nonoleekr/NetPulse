export type ProbeKind = "HTTP" | "TCP" | "ICMP";

export type ProbeResult = {
  success: boolean;
  latencyMs: number | null;
  statusCode?: number;
  errorCode?: string;
  errorMessage?: string;
};

export type ProbeTarget = {
  kind: ProbeKind;
  url: string;
  host?: string;
  port?: number;
};
