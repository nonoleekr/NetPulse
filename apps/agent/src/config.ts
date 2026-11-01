import { homedir } from "node:os";
import { join } from "node:path";

function bounded(value: string | undefined, fallback: number, min: number, max: number) {
  const parsed = Number(value ?? fallback);
  return Number.isFinite(parsed) ? Math.min(max, Math.max(min, parsed)) : fallback;
}

export const agentConfig = {
  coordinatorUrl: process.env.NETPULSE_COORDINATOR_URL ?? "http://127.0.0.1:4000",
  enrollmentToken: process.env.NETPULSE_ENROLLMENT_TOKEN ?? "",
  name: (process.env.NETPULSE_AGENT_NAME ?? `agent-${process.platform}`).slice(0, 80),
  credentialPath: process.env.NETPULSE_AGENT_CREDENTIALS ?? join(homedir(), ".netpulse", "agent-credentials.json"),
  maxReconnectAttempts: bounded(process.env.NETPULSE_AGENT_RECONNECT_ATTEMPTS, 20, 1, 100),
  maxReconnectDelayMs: bounded(process.env.NETPULSE_AGENT_RECONNECT_MAX_MS, 30_000, 1_000, 5 * 60_000),
  maxConcurrentProbes: bounded(process.env.NETPULSE_AGENT_MAX_PROBES, 2, 1, 10),
  allowLoopbackFixtures: process.env.NETPULSE_AGENT_ALLOW_LOOPBACK === "true" && process.env.NODE_ENV === "test",
};

export function assertLoopbackCoordinator(rawUrl: string) {
  const url = new URL(rawUrl);
  if (url.protocol !== "http:") throw new Error("This milestone supports plaintext coordinator transport on loopback only");
  if (!["localhost", "127.0.0.1", "[::1]", "::1"].includes(url.hostname)) throw new Error("Cross-device agents require verified TLS and are not supported in this milestone");
  return url;
}
