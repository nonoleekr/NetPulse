import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import request from "supertest";
import WebSocket from "ws";
import { afterEach, describe, expect, it } from "vitest";
import { agentAuthenticationPayload, type CoordinatorAgentMessage } from "@netpulse/contracts";
import { app } from "./app.js";
import { createAgentGateway, dispatchAgentProbe, reconcileAgentState } from "./agents.js";
import { hashSecret } from "./agent-auth.js";
import { prisma } from "./db.js";
import { config } from "./config.js";

const createdAgents: string[] = [];
const createdMonitors: string[] = [];
const createdTokenHashes: string[] = [];

afterEach(async () => {
  if (createdMonitors.length) await prisma.monitor.deleteMany({ where: { id: { in: createdMonitors.splice(0) } } });
  if (createdAgents.length) await prisma.agent.deleteMany({ where: { id: { in: createdAgents.splice(0) } } });
  if (createdTokenHashes.length) await prisma.agentEnrollmentToken.deleteMany({ where: { tokenHash: { in: createdTokenHashes.splice(0) } } });
});

function keys() {
  const pair = generateKeyPairSync("ed25519");
  return {
    privateKey: pair.privateKey,
    publicKey: pair.publicKey.export({ type: "spki", format: "pem" }).toString(),
    fingerprint: createHash("sha256").update(pair.publicKey.export({ type: "spki", format: "der" })).digest("hex"),
  };
}

function nextMessage(socket: WebSocket) {
  return new Promise<CoordinatorAgentMessage>((resolve) => socket.once("message", (data) => resolve(JSON.parse(data.toString()) as CoordinatorAgentMessage)));
}

function within<T>(promise: Promise<T>, label: string) {
  return Promise.race([promise, new Promise<T>((_resolve, reject) => setTimeout(() => reject(new Error(`Timed out: ${label}`)), 2_000))]);
}

async function authenticate(socket: WebSocket, agentId: string, privateKey: ReturnType<typeof keys>["privateKey"], challengePromise = nextMessage(socket)) {
  const challenge = await challengePromise;
  if (challenge.type !== "coordinator.challenge") throw new Error("Expected challenge");
  const signedAt = new Date().toISOString();
  socket.send(JSON.stringify({ type: "agent.authenticate", protocolVersion: 1, agentId, nonce: challenge.nonce, signedAt, signature: sign(null, Buffer.from(agentAuthenticationPayload(agentId, challenge.nonce, signedAt)), privateKey).toString("base64") }));
  const authenticated = await nextMessage(socket);
  if (authenticated.type !== "coordinator.authenticated") throw new Error("Expected authentication");
  return authenticated;
}

describe("agent enrollment and protocol", () => {
  it("consumes enrollment tokens once and rejects expired or replayed tokens", async () => {
    const token = `enroll-${crypto.randomUUID()}-${crypto.randomUUID()}`;
    createdTokenHashes.push(hashSecret(token));
    await prisma.agentEnrollmentToken.create({ data: { tokenHash: createdTokenHashes.at(-1)!, expiresAt: new Date(Date.now() + 60_000) } });
    const key = keys();
    const body = { token, name: "fixture-agent", platform: "test", version: "0.1.0", capabilities: ["HTTP", "TCP"], publicKey: key.publicKey };
    const enrolled = await request(app).post("/api/agent-enrollment").send(body);
    expect(enrolled.status).toBe(201);
    expect(enrolled.body.data).not.toHaveProperty("publicKey");
    createdAgents.push(enrolled.body.data.id);

    const replay = await request(app).post("/api/agent-enrollment").send(body);
    expect(replay.status).toBe(401);
    expect(replay.body.error.code).toBe("TOKEN_INVALID");

    const rotationToken = `rotate-${crypto.randomUUID()}-${crypto.randomUUID()}`;
    createdTokenHashes.push(hashSecret(rotationToken));
    await prisma.agentEnrollmentToken.create({ data: { tokenHash: createdTokenHashes.at(-1)!, expiresAt: new Date(Date.now() + 60_000), purpose: "ROTATE", agentId: enrolled.body.data.id } });
    const replacement = keys();
    const rotated = await request(app).post("/api/agent-enrollment").send({ ...body, token: rotationToken, publicKey: replacement.publicKey });
    expect(rotated.status).toBe(201);
    expect(rotated.body.data.credentialVersion).toBe(2);
    expect((await prisma.agent.findUniqueOrThrow({ where: { id: enrolled.body.data.id } })).publicKeyFingerprint).toBe(replacement.fingerprint);

    const expired = `expired-${crypto.randomUUID()}-${crypto.randomUUID()}`;
    createdTokenHashes.push(hashSecret(expired));
    await prisma.agentEnrollmentToken.create({ data: { tokenHash: createdTokenHashes.at(-1)!, expiresAt: new Date(Date.now() - 1) } });
    const expiredResponse = await request(app).post("/api/agent-enrollment").send({ ...body, token: expired });
    expect(expiredResponse.status).toBe(401);
  });

  it("authenticates an agent, replaces duplicate sessions, and accepts one correlated result", async () => {
    const key = keys();
    const agent = await prisma.agent.create({ data: { name: "protocol-agent", platform: "test", version: "0.1.0", capabilitiesJson: '["HTTP"]', publicKey: key.publicKey, publicKeyFingerprint: key.fingerprint } });
    createdAgents.push(agent.id);
    const monitor = await prisma.monitor.create({ data: { name: "remote fixture", url: "https://example.com", kind: "HTTP", timeoutMs: 2_000, agentId: agent.id } });
    createdMonitors.push(monitor.id);

    const server = createServer(app);
    const gateway = createAgentGateway(server);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const port = (server.address() as AddressInfo).port;
    const first = new WebSocket(`ws://127.0.0.1:${port}/agent/ws`);
    const firstChallenge = nextMessage(first);
    await within(new Promise<void>((resolve) => first.once("open", resolve)), "first open");
    await within(authenticate(first, agent.id, key.privateKey, firstChallenge), "first auth");

    const second = new WebSocket(`ws://127.0.0.1:${port}/agent/ws`);
    const secondChallenge = nextMessage(second);
    await within(new Promise<void>((resolve) => second.once("open", resolve)), "second open");
    const firstClosed = new Promise<number>((resolve) => first.once("close", resolve));
    const authenticated = await within(authenticate(second, agent.id, key.privateKey, secondChallenge), "second auth");
    const replaced = await within(firstClosed, "first replacement close");
    expect(replaced).toBe(4001);
    second.send(JSON.stringify({ type: "agent.heartbeat", protocolVersion: 1, agentId: agent.id, sessionId: authenticated.sessionId, sequence: 0, occurredAt: new Date().toISOString(), health: "OK" }));
    await new Promise((resolve) => setTimeout(resolve, 25));
    expect((await prisma.agent.findUniqueOrThrow({ where: { id: agent.id } })).lastHeartbeatAt).not.toBeNull();

    const taskMessage = nextMessage(second);
    const measurementPromise = dispatchAgentProbe(monitor);
    const outbound = await within(taskMessage, "task dispatch");
    expect(outbound.type).toBe("coordinator.task");
    if (outbound.type !== "coordinator.task") throw new Error("Expected task");
    const result = { type: "agent.result", protocolVersion: 1, agentId: agent.id, sessionId: authenticated.sessionId, taskId: outbound.task.id, startedAt: new Date().toISOString(), completedAt: new Date().toISOString(), result: { success: true, latencyMs: 12, statusCode: 204 } };
    second.send(JSON.stringify(result));
    const measurement = await within(measurementPromise, "measurement result");
    expect(measurement).toMatchObject({ source: "AGENT", agentId: agent.id, latencyMs: 12, statusCode: 204 });
    second.send(JSON.stringify(result));
    await new Promise((resolve) => setTimeout(resolve, 25));
    expect(await prisma.measurement.count({ where: { agentTaskId: outbound.task.id } })).toBe(1);

    const secondClosed = new Promise<void>((resolve) => second.once("close", () => resolve()));
    second.close();
    await within(secondClosed, "second close");

    await prisma.agent.update({ where: { id: agent.id }, data: { status: "REVOKED", revokedAt: new Date() } });
    const revoked = new WebSocket(`ws://127.0.0.1:${port}/agent/ws`);
    const revokedChallenge = nextMessage(revoked);
    const revokedClosed = new Promise<number>((resolve) => revoked.once("close", resolve));
    await within(new Promise<void>((resolve) => revoked.once("open", resolve)), "revoked open");
    const challenge = await within(revokedChallenge, "revoked challenge");
    if (challenge.type !== "coordinator.challenge") throw new Error("Expected challenge");
    const signedAt = new Date().toISOString();
    revoked.send(JSON.stringify({ type: "agent.authenticate", protocolVersion: 1, agentId: agent.id, nonce: challenge.nonce, signedAt, signature: sign(null, Buffer.from(agentAuthenticationPayload(agent.id, challenge.nonce, signedAt)), key.privateKey).toString("base64") }));
    expect(await within(revokedClosed, "revoked rejection")).toBe(4003);
    await within(gateway.close(), "gateway close");
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it("protects administration and reconciles persisted session state", async () => {
    const previous = config.adminToken;
    config.adminToken = "fixture-admin-secret";
    try {
      const denied = await request(app).post("/api/admin/agents/enrollment-tokens").set("authorization", "Bearer wrong");
      expect(denied.status).toBe(401);
      const created = await request(app).post("/api/admin/agents/enrollment-tokens").set("authorization", "Bearer fixture-admin-secret");
      expect(created.status).toBe(201);
      const tokenHash = hashSecret(created.body.data.token);
      createdTokenHashes.push(tokenHash);
      expect(await prisma.agentEnrollmentToken.findUnique({ where: { tokenHash } })).not.toBeNull();

      const key = keys();
      const agent = await prisma.agent.create({ data: { name: "restart-agent", status: "ONLINE", platform: "test", version: "0.1.0", capabilitiesJson: '["HTTP"]', publicKey: key.publicKey, publicKeyFingerprint: key.fingerprint } });
      createdAgents.push(agent.id);
      const monitor = await prisma.monitor.create({ data: { name: "restart monitor", url: "https://example.com", kind: "HTTP", agentId: agent.id } });
      createdMonitors.push(monitor.id);
      const task = await prisma.agentTask.create({ data: { agentId: agent.id, monitorId: monitor.id, sessionGeneration: 1, kind: "HTTP", payloadJson: "{}", expiresAt: new Date(Date.now() + 60_000) } });
      await reconcileAgentState();
      expect((await prisma.agent.findUniqueOrThrow({ where: { id: agent.id } })).status).toBe("OFFLINE");
      expect(await prisma.agentTask.findUnique({ where: { id: task.id } })).toMatchObject({ status: "EXPIRED", errorCode: "COORDINATOR_RESTARTED" });
    } finally { config.adminToken = previous; }
  });
});
