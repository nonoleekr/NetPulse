import express from "express";
import cors from "cors";
import { z } from "zod";
import { prisma } from "./db.js";
import { config } from "./config.js";
import { clearSchedule, runProbe, scheduleMonitor } from "./scheduler.js";
import { validateHttpTarget } from "./target.js";

const monitorInput = z.object({
  name: z.string().trim().min(1).max(80),
  url: z.string().url().max(2048),
  intervalSeconds: z.number().int().min(10).max(86400).default(60),
  timeoutMs: z.number().int().min(250).max(30000).default(5000),
});

export const app = express();
app.use(cors({ origin: config.webOrigin }));
app.use(express.json({ limit: "16kb" }));

app.get("/api/health", async (_request, response) => {
  await prisma.$queryRaw`SELECT 1`;
  response.json({ data: { status: "ok" } });
});

app.get("/api/monitors", async (_request, response) => {
  const monitors = await prisma.monitor.findMany({
    orderBy: { createdAt: "desc" },
    include: { measurements: { orderBy: { completedAt: "desc" }, take: 1 } },
  });
  const data = await Promise.all(monitors.map(async (monitor) => {
    const [completedProbes, failedProbes] = await Promise.all([
      prisma.measurement.count({ where: { monitorId: monitor.id } }),
      prisma.measurement.count({ where: { monitorId: monitor.id, success: false } }),
    ]);
    return {
      ...monitor,
      completedProbes,
      failedProbes,
      packetLossPercent: completedProbes ? Math.round((failedProbes / completedProbes) * 10000) / 100 : null,
      sampledAvailabilityPercent: completedProbes ? Math.round(((completedProbes - failedProbes) / completedProbes) * 10000) / 100 : null,
    };
  }));
  response.json({ data });
});

app.post("/api/monitors", async (request, response) => {
  const parsed = monitorInput.safeParse(request.body);
  if (!parsed.success) {
    response.status(400).json({ error: { code: "VALIDATION_ERROR", message: parsed.error.issues[0]?.message ?? "Invalid monitor" } });
    return;
  }
  if (config.maxMonitors < 1 || await prisma.monitor.count() >= config.maxMonitors) {
    response.status(429).json({ error: { code: "MONITOR_LIMIT", message: "The monitor limit has been reached" } });
    return;
  }
  let url: string;
  try {
    url = (await validateHttpTarget(parsed.data.url)).url;
  } catch (error) {
    response.status(400).json({ error: { code: "UNSAFE_TARGET", message: error instanceof Error ? error.message : "Target is not allowed" } });
    return;
  }
  const monitor = await prisma.monitor.create({ data: { ...parsed.data, url } });
  void scheduleMonitor(monitor.id);
  response.status(201).json({ data: monitor });
});

app.post("/api/monitors/:id/probe", async (request, response) => {
  const measurement = await runProbe(request.params.id);
  if (!measurement) {
    response.status(404).json({ error: { code: "MONITOR_NOT_FOUND", message: "Monitor not found or probe already running" } });
    return;
  }
  response.status(201).json({ data: measurement });
});

app.delete("/api/monitors/:id", async (request, response) => {
  clearSchedule(request.params.id);
  const deleted = await prisma.monitor.deleteMany({ where: { id: request.params.id } });
  if (!deleted.count) {
    response.status(404).json({ error: { code: "MONITOR_NOT_FOUND", message: "Monitor not found" } });
    return;
  }
  response.status(204).send();
});
