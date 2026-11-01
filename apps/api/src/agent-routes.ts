import { createHash, createPublicKey } from "node:crypto";
import { Router } from "express";
import { z } from "zod";
import { prisma } from "./db.js";
import { config } from "./config.js";
import { createEnrollmentSecret, hashSecret, requireAdmin, requireLoopback } from "./agent-auth.js";
import { disconnectAgent, parseCapabilities } from "./agents.js";

const router = Router();
const capabilitySchema = z.array(z.enum(["HTTP", "TCP", "ICMP"])).min(1).max(3).transform((items) => [...new Set(items)]);
const enrollmentSchema = z.object({ token: z.string().min(20).max(200), name: z.string().trim().min(1).max(80), platform: z.string().trim().min(1).max(120), version: z.string().trim().min(1).max(40), capabilities: capabilitySchema, publicKey: z.string().min(40).max(2000) }).strict();

function publicAgent(agent: { id: string; name: string; status: string; platform: string; version: string; capabilitiesJson: string; publicKeyFingerprint: string; credentialVersion: number; lastHeartbeatAt: Date | null; lastConnectedAt: Date | null; createdAt: Date; updatedAt: Date }) {
  return { id: agent.id, name: agent.name, status: agent.status, platform: agent.platform, version: agent.version, capabilities: parseCapabilities(agent.capabilitiesJson), publicKeyFingerprint: agent.publicKeyFingerprint, credentialVersion: agent.credentialVersion, lastHeartbeatAt: agent.lastHeartbeatAt, lastConnectedAt: agent.lastConnectedAt, createdAt: agent.createdAt, updatedAt: agent.updatedAt };
}

router.use(requireLoopback);

router.post("/api/agent-enrollment", async (request, response) => {
  const parsed = enrollmentSchema.safeParse(request.body);
  if (!parsed.success) { response.status(400).json({ error: { code: "VALIDATION_ERROR", message: parsed.error.issues[0]?.message ?? "Invalid enrollment request" } }); return; }
  let canonicalKey: string;
  let fingerprint: string;
  try {
    const key = createPublicKey(parsed.data.publicKey);
    if (key.asymmetricKeyType !== "ed25519") throw new Error("Agent keys must use Ed25519");
    canonicalKey = key.export({ type: "spki", format: "pem" }).toString();
    fingerprint = createHash("sha256").update(key.export({ type: "spki", format: "der" })).digest("hex");
  } catch (error) { response.status(400).json({ error: { code: "INVALID_PUBLIC_KEY", message: error instanceof Error ? error.message : "Invalid public key" } }); return; }
  const now = new Date();
  try {
    const agent = await prisma.$transaction(async (transaction) => {
      const token = await transaction.agentEnrollmentToken.findUnique({ where: { tokenHash: hashSecret(parsed.data.token) } });
      if (!token || token.usedAt || token.expiresAt <= now) throw new Error("TOKEN_INVALID");
      const used = await transaction.agentEnrollmentToken.updateMany({ where: { id: token.id, usedAt: null, expiresAt: { gt: now } }, data: { usedAt: now } });
      if (!used.count) throw new Error("TOKEN_INVALID");
      if (token.purpose === "ROTATE" && token.agentId) {
        const updated = await transaction.agent.update({ where: { id: token.agentId }, data: { publicKey: canonicalKey, publicKeyFingerprint: fingerprint, credentialVersion: { increment: 1 }, name: parsed.data.name, platform: parsed.data.platform, version: parsed.data.version, capabilitiesJson: JSON.stringify(parsed.data.capabilities), status: "ENROLLED", revokedAt: null, suspendedAt: null } });
        return updated;
      }
      if (token.purpose !== "ENROLL") throw new Error("TOKEN_INVALID");
      const created = await transaction.agent.create({ data: { name: parsed.data.name, platform: parsed.data.platform, version: parsed.data.version, capabilitiesJson: JSON.stringify(parsed.data.capabilities), publicKey: canonicalKey, publicKeyFingerprint: fingerprint } });
      await transaction.agentEnrollmentToken.update({ where: { id: token.id }, data: { agentId: created.id } });
      return created;
    });
    response.status(201).json({ data: publicAgent(agent) });
  } catch (error) {
    if (error instanceof Error && error.message === "TOKEN_INVALID") { response.status(401).json({ error: { code: "TOKEN_INVALID", message: "Enrollment token is invalid, expired, or already used" } }); return; }
    throw error;
  }
});

router.use("/api/admin/agents", requireAdmin);

router.get("/api/admin/agents", async (_request, response) => {
  const agents = await prisma.agent.findMany({ orderBy: { createdAt: "desc" }, take: 200 });
  response.json({ data: agents.map(publicAgent) });
});

router.post("/api/admin/agents/enrollment-tokens", async (_request, response) => {
  const token = createEnrollmentSecret();
  const expiresAt = new Date(Date.now() + config.enrollmentTtlMs);
  await prisma.agentEnrollmentToken.create({ data: { tokenHash: hashSecret(token), expiresAt } });
  response.status(201).json({ data: { token, expiresAt, coordinatorUrl: `http://${config.host}:${config.port}` } });
});

router.post("/api/admin/agents/:id/rotation-tokens", async (request, response) => {
  const agent = await prisma.agent.findUnique({ where: { id: request.params.id } });
  if (!agent || agent.status === "REVOKED") { response.status(404).json({ error: { code: "AGENT_NOT_FOUND", message: "Active agent not found" } }); return; }
  const token = createEnrollmentSecret();
  const expiresAt = new Date(Date.now() + config.enrollmentTtlMs);
  await prisma.agentEnrollmentToken.create({ data: { tokenHash: hashSecret(token), expiresAt, purpose: "ROTATE", agentId: agent.id } });
  disconnectAgent(agent.id, "Credential rotation requested");
  response.status(201).json({ data: { token, expiresAt } });
});

router.patch("/api/admin/agents/:id", async (request, response) => {
  const parsed = z.object({ action: z.enum(["activate", "suspend", "revoke"]) }).strict().safeParse(request.body);
  if (!parsed.success) { response.status(400).json({ error: { code: "VALIDATION_ERROR", message: "action must be activate, suspend, or revoke" } }); return; }
  const existing = await prisma.agent.findUnique({ where: { id: request.params.id } });
  if (!existing) { response.status(404).json({ error: { code: "AGENT_NOT_FOUND", message: "Agent not found" } }); return; }
  if (existing.status === "REVOKED" && parsed.data.action !== "revoke") { response.status(409).json({ error: { code: "AGENT_REVOKED", message: "Revoked agents cannot be reactivated" } }); return; }
  const status = parsed.data.action === "activate" ? "ENROLLED" : parsed.data.action === "suspend" ? "SUSPENDED" : "REVOKED";
  const agent = await prisma.agent.update({ where: { id: existing.id }, data: { status, suspendedAt: status === "SUSPENDED" ? new Date() : null, revokedAt: status === "REVOKED" ? new Date() : null } });
  if (status !== "ENROLLED") { disconnectAgent(agent.id, `Agent ${status.toLowerCase()}`); await prisma.monitor.updateMany({ where: { agentId: agent.id }, data: { agentId: null } }); }
  response.json({ data: publicAgent(agent) });
});

router.put("/api/admin/agents/:id/monitors/:monitorId", async (request, response) => {
  const agent = await prisma.agent.findUnique({ where: { id: request.params.id } });
  const monitor = await prisma.monitor.findUnique({ where: { id: request.params.monitorId } });
  if (!agent || !monitor) { response.status(404).json({ error: { code: "NOT_FOUND", message: "Agent or monitor not found" } }); return; }
  if (["SUSPENDED", "REVOKED"].includes(agent.status) || !parseCapabilities(agent.capabilitiesJson).includes(monitor.kind as "HTTP" | "TCP" | "ICMP")) { response.status(409).json({ error: { code: "UNSUPPORTED_CAPABILITY", message: "Agent is inactive or does not support this monitor type" } }); return; }
  const updated = await prisma.monitor.update({ where: { id: monitor.id }, data: { agentId: agent.id } });
  response.json({ data: updated });
});

router.delete("/api/admin/agents/:id/monitors/:monitorId", async (request, response) => {
  const updated = await prisma.monitor.updateMany({ where: { id: request.params.monitorId, agentId: request.params.id }, data: { agentId: null } });
  if (!updated.count) { response.status(404).json({ error: { code: "ASSIGNMENT_NOT_FOUND", message: "Monitor assignment not found" } }); return; }
  response.status(204).send();
});

export const agentRouter = router;
