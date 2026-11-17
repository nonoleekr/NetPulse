import request from "supertest";
import { afterEach, describe, expect, it } from "vitest";
import { app } from "./app.js";
import { prisma } from "./db.js";

const monitorIds: string[] = [];
afterEach(async () => {
  if (monitorIds.length) await prisma.monitor.deleteMany({ where: { id: { in: monitorIds.splice(0) } } });
});

describe("analysis API", () => {
  it("rejects unbounded windows before querying analysis data", async () => {
    const response = await request(app).get("/api/analysis?hours=721");
    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe("VALIDATION_ERROR");
  });

  it("returns a deterministic, read-only analysis contract", async () => {
    const monitor = await prisma.monitor.create({ data: { name: "Analysis fixture", kind: "HTTP", url: "https://example.test" } });
    monitorIds.push(monitor.id);
    await prisma.measurement.createMany({ data: Array.from({ length: 251 }, (_, index) => ({ monitorId: monitor.id, startedAt: new Date(Date.now() - (index + 1) * 1_000), completedAt: new Date(Date.now() - (index + 1) * 900), success: true, latencyMs: 20 + index, statusCode: 200, source: index === 0 ? "AGENT" : "LOCAL" })) });
    const before = await prisma.measurement.count({ where: { monitorId: monitor.id } });
    const response = await request(app).get(`/api/analysis?hours=24&monitorId=${monitor.id}`);
    expect(response.status).toBe(200);
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(response.body.data).toMatchObject({ health: "HEALTHY", analyzedMonitorCount: 1, limits: { monitorsTruncated: false, maximumMeasurementsPerMonitor: 250 }, assistance: { enabled: false, status: "DISABLED", provider: null } });
    expect(response.body.data.monitors[0]).toMatchObject({ monitorId: monitor.id, measurementCount: 250, sourceCounts: { local: 249, agent: 1 }, evidenceWindowTruncated: true });
    expect(await prisma.measurement.count({ where: { monitorId: monitor.id } })).toBe(before);
  });

  it("returns not found for an unknown monitor filter", async () => {
    const response = await request(app).get("/api/analysis?monitorId=missing-monitor");
    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe("MONITOR_NOT_FOUND");
  });
});
