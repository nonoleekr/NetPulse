import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import { config } from "./config.js";

export function hashSecret(secret: string) {
  return createHash("sha256").update(secret, "utf8").digest("hex");
}

export function createEnrollmentSecret() {
  return randomBytes(32).toString("base64url");
}

export function isLoopbackAddress(address: string | undefined) {
  if (!address) return false;
  const normalized = address.toLowerCase();
  return normalized === "127.0.0.1" || normalized === "::1" || normalized === "::ffff:127.0.0.1";
}

export function requireLoopback(request: Request, response: Response, next: NextFunction) {
  if (!isLoopbackAddress(request.socket.remoteAddress)) {
    response.status(403).json({ error: { code: "LOOPBACK_ONLY", message: "Remote agent administration requires a verified TLS deployment and is not enabled" } });
    return;
  }
  next();
}

export function requireAdmin(request: Request, response: Response, next: NextFunction) {
  if (!config.adminToken) {
    response.status(503).json({ error: { code: "ADMIN_DISABLED", message: "Agent administration is disabled until NETPULSE_ADMIN_TOKEN is configured" } });
    return;
  }
  const supplied = request.header("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  const expected = Buffer.from(config.adminToken);
  const actual = Buffer.from(supplied);
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
    response.status(401).json({ error: { code: "UNAUTHORIZED", message: "A valid administrator token is required" } });
    return;
  }
  next();
}
