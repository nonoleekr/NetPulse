import { createHash, createPublicKey, randomUUID, verify } from "node:crypto";
import type { Server as HttpServer, IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";
import { WebSocket, WebSocketServer } from "ws";
import { z } from "zod";
import { agentAuthenticationPayload, agentProtocolVersion, type AgentCapability, type AgentCoordinatorMessage, type AgentProbeTask, type CoordinatorAgentMessage } from "@netpulse/contracts";
import { prisma } from "./db.js";
import { config } from "./config.js";
import { isLoopbackAddress } from "./agent-auth.js";
import { emitMeasurementCompleted } from "./measurement-events.js";
import { updateOutageState } from "./outages.js";
import { logger } from "./logger.js";

const capabilities = ["HTTP", "TCP", "ICMP"] as const;
const authenticateSchema = z.object({ type: z.literal("agent.authenticate"), protocolVersion: z.literal(1), agentId: z.string().min(1).max(80), nonce: z.string().min(20).max(200), signedAt: z.string().datetime(), signature: z.string().min(20).max(1024) }).strict();
const heartbeatSchema = z.object({ type: z.literal("agent.heartbeat"), protocolVersion: z.literal(1), agentId: z.string(), sessionId: z.string(), sequence: z.number().int().nonnegative(), occurredAt: z.string().datetime(), health: z.enum(["OK", "DEGRADED"]) }).strict();
const resultSchema = z.object({
  type: z.literal("agent.result"), protocolVersion: z.literal(1), agentId: z.string(), sessionId: z.string(), taskId: z.string(),
  startedAt: z.string().datetime(), completedAt: z.string().datetime(),
  result: z.object({ success: z.boolean(), latencyMs: z.number().int().nonnegative().nullable(), statusCode: z.number().int().min(100).max(599).optional(), errorCode: z.string().max(80).optional(), errorMessage: z.string().max(500).optional() }).strict(),
}).strict();

type Session = { socket: WebSocket; sessionId: string; generation: number; capabilities: Set<AgentCapability>; lastSequence: number };
const sessions = new Map<string, Session>();
const pending = new Map<string, { resolve: (value: Awaited<ReturnType<typeof prisma.measurement.create>> | null) => void; timer: NodeJS.Timeout }>();

function send(socket: WebSocket, message: CoordinatorAgentMessage) {
  if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message));
}

export function parseCapabilities(value: string): AgentCapability[] {
  try {
    const parsed = z.array(z.enum(capabilities)).max(capabilities.length).parse(JSON.parse(value));
    return [...new Set(parsed)];
  } catch {
    return [];
  }
}

async function acceptResult(message: z.infer<typeof resultSchema>, session: Session) {
  const completedAt = new Date(message.completedAt);
  const startedAt = new Date(message.startedAt);
  if (completedAt < startedAt || completedAt.getTime() > Date.now() + 30_000) return;
  const task = await prisma.agentTask.findUnique({ where: { id: message.taskId }, include: { monitor: true } });
  if (!task || task.agentId !== message.agentId || task.monitor.agentId !== message.agentId || task.sessionGeneration !== session.generation || task.status !== "DISPATCHED" || task.expiresAt < new Date()) return;
  if (startedAt.getTime() < task.issuedAt.getTime() - 5_000 || completedAt.getTime() > task.expiresAt.getTime() + 5_000) return;
  const resultHash = createHash("sha256").update(JSON.stringify(message.result)).digest("hex");
  const measurement = await prisma.$transaction(async (transaction) => {
    const claimed = await transaction.agentTask.updateMany({ where: { id: task.id, status: "DISPATCHED" }, data: { status: "COMPLETED", completedAt, resultHash } });
    if (!claimed.count) return null;
    return transaction.measurement.create({ data: {
      monitorId: task.monitorId, startedAt, completedAt, success: message.result.success,
      latencyMs: message.result.latencyMs, statusCode: message.result.statusCode,
      errorCode: message.result.errorCode, errorMessage: message.result.errorMessage,
      source: "AGENT", agentId: message.agentId, agentTaskId: task.id, agentStartedAt: startedAt,
    } });
  });
  if (!measurement) return;
  await updateOutageState(task.monitorId, measurement.completedAt, measurement.success, measurement.errorMessage);
  emitMeasurementCompleted({ type: "measurement.completed", occurredAt: measurement.completedAt.toISOString(), payload: { monitorId: measurement.monitorId, measurementId: measurement.id, completedAt: measurement.completedAt.toISOString(), success: measurement.success } });
  const waiter = pending.get(task.id);
  if (waiter) { clearTimeout(waiter.timer); pending.delete(task.id); waiter.resolve(measurement); }
}

async function authenticate(socket: WebSocket, challenge: { nonce: string; issuedAt: Date }, raw: unknown) {
  const parsed = authenticateSchema.safeParse(raw);
  if (!parsed.success || parsed.data.nonce !== challenge.nonce || Math.abs(Date.now() - new Date(parsed.data.signedAt).getTime()) > 30_000) return null;
  const agent = await prisma.agent.findUnique({ where: { id: parsed.data.agentId } });
  if (!agent || agent.status === "SUSPENDED" || agent.status === "REVOKED") return null;
  let authenticated = false;
  try {
    authenticated = verify(null, Buffer.from(agentAuthenticationPayload(agent.id, challenge.nonce, parsed.data.signedAt)), createPublicKey(agent.publicKey), Buffer.from(parsed.data.signature, "base64"));
  } catch { authenticated = false; }
  if (!authenticated) return null;
  const previous = sessions.get(agent.id);
  if (previous) { send(previous.socket, { type: "coordinator.error", protocolVersion: 1, code: "SESSION_REPLACED", message: "A newer authenticated session replaced this connection" }); previous.socket.close(4001, "Session replaced"); }
  const updated = await prisma.agent.update({ where: { id: agent.id }, data: { status: "ONLINE", lastConnectedAt: new Date(), lastHeartbeatAt: new Date(), sessionGeneration: { increment: 1 } } });
  const session = { socket, sessionId: randomUUID(), generation: updated.sessionGeneration, capabilities: new Set(parseCapabilities(agent.capabilitiesJson)), lastSequence: -1 };
  sessions.set(agent.id, session);
  send(socket, { type: "coordinator.authenticated", protocolVersion: 1, agentId: agent.id, sessionId: session.sessionId, sessionGeneration: session.generation, heartbeatIntervalMs: config.agentHeartbeatIntervalMs });
  return { agentId: agent.id, session };
}

export function createAgentGateway(server: HttpServer) {
  const websocketServer = new WebSocketServer({ noServer: true, maxPayload: config.maxAgentPayloadBytes });
  const upgrade = (request: IncomingMessage, socket: Duplex, head: Buffer) => {
    const path = new URL(request.url ?? "/", "http://localhost").pathname;
    if (path !== "/agent/ws") return;
    if (!isLoopbackAddress(request.socket.remoteAddress) || sessions.size >= config.maxAgentConnections) { socket.destroy(); return; }
    websocketServer.handleUpgrade(request, socket, head, (client) => websocketServer.emit("connection", client, request));
  };
  server.on("upgrade", upgrade);
  websocketServer.on("connection", (socket) => {
    const challenge = { nonce: randomUUID() + randomUUID(), issuedAt: new Date() };
    send(socket, { type: "coordinator.challenge", protocolVersion: 1, nonce: challenge.nonce, issuedAt: challenge.issuedAt.toISOString() });
    let identity: { agentId: string; session: Session } | null = null;
    const authTimer = setTimeout(() => socket.close(4003, "Authentication timeout"), 10_000);
    socket.on("message", async (data) => {
      let message: unknown;
      try { message = JSON.parse(data.toString()); } catch { socket.close(4002, "Malformed message"); return; }
      if (!identity) {
        identity = await authenticate(socket, challenge, message);
        if (!identity) socket.close(4003, "Authentication failed"); else clearTimeout(authTimer);
        return;
      }
      const heartbeat = heartbeatSchema.safeParse(message);
      if (heartbeat.success) {
        if (heartbeat.data.agentId !== identity.agentId || heartbeat.data.sessionId !== identity.session.sessionId || heartbeat.data.sequence <= identity.session.lastSequence) return;
        identity.session.lastSequence = heartbeat.data.sequence;
        await prisma.agent.updateMany({ where: { id: identity.agentId, sessionGeneration: identity.session.generation, status: "ONLINE" }, data: { lastHeartbeatAt: new Date() } });
        return;
      }
      const result = resultSchema.safeParse(message);
      if (result.success && result.data.agentId === identity.agentId && result.data.sessionId === identity.session.sessionId) await acceptResult(result.data, identity.session);
    });
    const disconnected = async () => {
      clearTimeout(authTimer);
      if (identity && sessions.get(identity.agentId) === identity.session) {
        sessions.delete(identity.agentId);
        await prisma.agent.updateMany({ where: { id: identity.agentId, sessionGeneration: identity.session.generation, status: "ONLINE" }, data: { status: "OFFLINE" } });
      }
    };
    socket.once("close", () => void disconnected());
    socket.once("error", () => void disconnected());
  });
  const offlineTimer = setInterval(async () => {
    const cutoff = new Date(Date.now() - config.agentOfflineAfterMs);
    const stale = await prisma.agent.findMany({ where: { status: "ONLINE", lastHeartbeatAt: { lt: cutoff } }, select: { id: true } });
    for (const agent of stale) { sessions.get(agent.id)?.socket.terminate(); sessions.delete(agent.id); }
    if (stale.length) await prisma.agent.updateMany({ where: { id: { in: stale.map(({ id }) => id) }, status: "ONLINE" }, data: { status: "OFFLINE" } });
  }, config.agentHeartbeatIntervalMs);
  return { close: async () => { server.off("upgrade", upgrade); clearInterval(offlineTimer); for (const session of sessions.values()) session.socket.terminate(); sessions.clear(); await new Promise<void>((resolve) => websocketServer.close(() => resolve())); } };
}

export async function dispatchAgentProbe(monitor: { id: string; agentId: string | null; kind: string; url: string; host: string | null; port: number | null; timeoutMs: number }) {
  if (!monitor.agentId) return null;
  const session = sessions.get(monitor.agentId);
  if (!session || !session.capabilities.has(monitor.kind as AgentCapability)) return null;
  const now = new Date();
  const task = await prisma.agentTask.create({ data: { agentId: monitor.agentId, monitorId: monitor.id, sessionGeneration: session.generation, kind: monitor.kind, payloadJson: JSON.stringify({ url: monitor.url, host: monitor.host, port: monitor.port, timeoutMs: monitor.timeoutMs }), expiresAt: new Date(now.getTime() + config.agentTaskTimeoutMs) } });
  const outbound: AgentProbeTask = { id: task.id, monitorId: monitor.id, sessionGeneration: session.generation, kind: monitor.kind as AgentCapability, url: monitor.url, host: monitor.host, port: monitor.port, timeoutMs: Math.min(monitor.timeoutMs, config.agentTaskTimeoutMs), issuedAt: task.issuedAt.toISOString(), expiresAt: task.expiresAt.toISOString() };
  send(session.socket, { type: "coordinator.task", protocolVersion: agentProtocolVersion, task: outbound });
  return new Promise<Awaited<ReturnType<typeof prisma.measurement.create>> | null>((resolve) => {
    const timer = setTimeout(async () => { pending.delete(task.id); await prisma.agentTask.updateMany({ where: { id: task.id, status: "DISPATCHED" }, data: { status: "EXPIRED", errorCode: "AGENT_TIMEOUT" } }); resolve(null); }, config.agentTaskTimeoutMs + 100);
    pending.set(task.id, { resolve, timer });
  });
}

export function disconnectAgent(agentId: string, reason: string) {
  const session = sessions.get(agentId);
  if (session) { send(session.socket, { type: "coordinator.error", protocolVersion: 1, code: "AGENT_DISABLED", message: reason }); session.socket.close(4003, reason); sessions.delete(agentId); }
}

export async function reconcileAgentState() {
  await prisma.$transaction([
    prisma.agent.updateMany({ where: { status: "ONLINE" }, data: { status: "OFFLINE" } }),
    prisma.agentTask.updateMany({ where: { status: "DISPATCHED" }, data: { status: "EXPIRED", completedAt: new Date(), errorCode: "COORDINATOR_RESTARTED" } }),
  ]);
}
