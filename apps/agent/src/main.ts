import { createPrivateKey, sign } from "node:crypto";
import { platform, release } from "node:os";
import WebSocket from "ws";
import { z } from "zod";
import { agentAuthenticationPayload, type CoordinatorAgentMessage } from "@netpulse/contracts";
import { agentConfig, assertLoopbackCoordinator } from "./config.js";
import { createKeyPair, loadCredentials, saveCredentials, type AgentCredentials } from "./credentials.js";
import { executeTask } from "./probes.js";
import { reconnectDelay } from "./reconnect.js";

const envelope = z.object({ type: z.string(), protocolVersion: z.literal(1) }).passthrough();
const controllers = new Map<string, AbortController>();
let stopping = false;

async function enroll(): Promise<AgentCredentials> {
  if (!agentConfig.enrollmentToken) throw new Error("NETPULSE_ENROLLMENT_TOKEN is required for first enrollment or credential rotation");
  const coordinator = assertLoopbackCoordinator(agentConfig.coordinatorUrl);
  const keys = createKeyPair();
  const response = await fetch(new URL("/api/agent-enrollment", coordinator), { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ token: agentConfig.enrollmentToken, name: agentConfig.name, platform: `${platform()} ${release()}`, version: "0.1.0", capabilities: ["HTTP", "TCP", "ICMP"], publicKey: keys.publicKey }) });
  const payload = await response.json() as { data?: { id: string; credentialVersion: number }; error?: { message: string } };
  if (!response.ok || !payload.data) throw new Error(payload.error?.message ?? "Enrollment failed");
  const credentials = { agentId: payload.data.id, privateKey: keys.privateKey, publicKey: keys.publicKey, credentialVersion: payload.data.credentialVersion };
  await saveCredentials(agentConfig.credentialPath, credentials);
  return credentials;
}

async function connect(credentials: AgentCredentials) {
  const coordinator = assertLoopbackCoordinator(agentConfig.coordinatorUrl);
  const wsUrl = new URL("/agent/ws", coordinator); wsUrl.protocol = "ws:";
  return new Promise<void>((resolve, reject) => {
    const socket = new WebSocket(wsUrl);
    let sessionId = "";
    let heartbeat: NodeJS.Timeout | undefined;
    let sequence = 0;
    socket.once("open", () => console.info("NetPulse agent connected to loopback coordinator"));
    socket.on("message", async (raw) => {
      let message: CoordinatorAgentMessage;
      try { const parsed = envelope.parse(JSON.parse(raw.toString())); message = parsed as CoordinatorAgentMessage; } catch { socket.close(4002, "Malformed coordinator message"); return; }
      if (message.type === "coordinator.challenge") {
        const signedAt = new Date().toISOString();
        const signature = sign(null, Buffer.from(agentAuthenticationPayload(credentials.agentId, message.nonce, signedAt)), createPrivateKey(credentials.privateKey)).toString("base64");
        socket.send(JSON.stringify({ type: "agent.authenticate", protocolVersion: 1, agentId: credentials.agentId, nonce: message.nonce, signedAt, signature }));
      } else if (message.type === "coordinator.authenticated") {
        sessionId = message.sessionId;
        heartbeat = setInterval(() => socket.send(JSON.stringify({ type: "agent.heartbeat", protocolVersion: 1, agentId: credentials.agentId, sessionId, sequence: sequence++, occurredAt: new Date().toISOString(), health: controllers.size < agentConfig.maxConcurrentProbes ? "OK" : "DEGRADED" })), message.heartbeatIntervalMs);
      } else if (message.type === "coordinator.task") {
        if (!sessionId || controllers.has(message.task.id)) return;
        if (controllers.size >= agentConfig.maxConcurrentProbes) {
          const occurredAt = new Date().toISOString();
          socket.send(JSON.stringify({ type: "agent.result", protocolVersion: 1, agentId: credentials.agentId, sessionId, taskId: message.task.id, startedAt: occurredAt, completedAt: occurredAt, result: { success: false, latencyMs: null, errorCode: "AGENT_BUSY", errorMessage: "Agent probe concurrency limit reached" } }));
          return;
        }
        const controller = new AbortController(); controllers.set(message.task.id, controller);
        const startedAt = new Date().toISOString();
        const result = await executeTask(message.task, controller.signal, agentConfig.allowLoopbackFixtures);
        controllers.delete(message.task.id);
        if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: "agent.result", protocolVersion: 1, agentId: credentials.agentId, sessionId, taskId: message.task.id, startedAt, completedAt: new Date().toISOString(), result }));
      } else if (message.type === "coordinator.cancel") controllers.get(message.taskId)?.abort();
    });
    socket.once("error", reject);
    socket.once("close", () => { if (heartbeat) clearInterval(heartbeat); for (const controller of controllers.values()) controller.abort(); controllers.clear(); resolve(); });
  });
}

async function main() {
  let credentials = await loadCredentials(agentConfig.credentialPath);
  if (!credentials || agentConfig.enrollmentToken) credentials = await enroll();
  for (let attempt = 0; !stopping && attempt < agentConfig.maxReconnectAttempts; attempt += 1) {
    try { await connect(credentials); attempt = 0; } catch (error) { console.error(error instanceof Error ? error.message : "Agent connection failed"); }
    if (!stopping) await new Promise((resolve) => setTimeout(resolve, reconnectDelay(attempt, agentConfig.maxReconnectDelayMs)));
  }
}

const shutdown = () => { stopping = true; for (const controller of controllers.values()) controller.abort(); };
process.once("SIGINT", shutdown); process.once("SIGTERM", shutdown);
void main().catch((error) => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; });
