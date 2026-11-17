export type AnalysisAssistantRequest = {
  deterministicSummary: string;
  evidence: Array<{ category: string; severity: string; summary: string }>;
};

export type AnalysisAssistantResponse = {
  advisoryText: string;
  uncertainty: string;
};

export interface AnalysisAssistant {
  readonly enabled: boolean;
  summarize(request: AnalysisAssistantRequest, signal: AbortSignal): Promise<AnalysisAssistantResponse>;
}

export const disabledAnalysisAssistant: AnalysisAssistant = {
  enabled: false,
  async summarize() {
    throw new Error("AI assistance is disabled; deterministic analysis remains available");
  },
};

const sensitivePatterns = [
  /\b(?:bearer|token|password|secret|api[_-]?key)\s*[:=]?\s*[^\s,;]+/gi,
  /https?:\/\/[^\s]+/gi,
  /\b(?:10|127)\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/g,
  /\b192\.168\.\d{1,3}\.\d{1,3}\b/g,
  /\b172\.(?:1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}\b/g,
  /\b169\.254\.\d{1,3}\.\d{1,3}\b/g,
  /\b(?:fc|fd)[0-9a-f:]+\b/gi,
];

export function redactForAnalysisAssistant(value: string, maximumLength = 4_000) {
  let redacted = value.slice(0, Math.max(0, maximumLength));
  for (const pattern of sensitivePatterns) redacted = redacted.replace(pattern, "[REDACTED]");
  return redacted.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "");
}
