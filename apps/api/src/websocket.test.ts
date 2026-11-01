import { createServer } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import WebSocket from "ws";
import { app } from "./app.js";
import { emitMeasurementCompleted, emitMonitoringEvent } from "./measurement-events.js";
import { createWebSocketServer } from "./websocket.js";

const activeServers: Array<{
  httpServer: ReturnType<typeof createServer>;
  websocket: ReturnType<typeof createWebSocketServer>;
}> = [];

async function startServer() {
  const httpServer = createServer(app);
  const websocket = createWebSocketServer(httpServer);
  activeServers.push({ httpServer, websocket });
  await new Promise<void>((resolve) => httpServer.listen(0, "127.0.0.1", resolve));
  const address = httpServer.address();
  if (!address || typeof address === "string") throw new Error("Server did not start");
  return { url: `ws://127.0.0.1:${address.port}/ws`, httpServer, websocket };
}

function waitForOpen(client: WebSocket) {
  return new Promise<void>((resolve, reject) => {
    client.once("open", () => resolve());
    client.once("error", reject);
  });
}

function waitForMessage(client: WebSocket) {
  return new Promise<unknown>((resolve) => client.once("message", (message) => resolve(JSON.parse(message.toString()))));
}

afterEach(async () => {
  for (const { httpServer, websocket } of activeServers.splice(0)) {
    websocket.close();
    await new Promise<void>((resolve) => httpServer.close(() => resolve()));
  }
});

describe("WebSocket updates", () => {
  it("connects and delivers persisted measurement events to multiple clients", async () => {
    const server = await startServer();
    const first = new WebSocket(server.url, { origin: "http://localhost:5173" });
    const second = new WebSocket(server.url, { origin: "http://localhost:5173" });
    const firstReady = waitForMessage(first);
    const secondReady = waitForMessage(second);
    await Promise.all([waitForOpen(first), waitForOpen(second), firstReady, secondReady]);
    const firstEventPromise = waitForMessage(first);
    const secondEventPromise = waitForMessage(second);
    emitMeasurementCompleted({
      type: "measurement.completed",
      occurredAt: "2026-11-01T00:00:00.000Z",
      payload: {
        monitorId: "monitor-1",
        measurementId: "measurement-1",
        completedAt: "2026-11-01T00:00:00.000Z",
        success: true,
      },
    });

    const [firstEvent, secondEvent] = await Promise.all([firstEventPromise, secondEventPromise]);
    expect(firstEvent).toMatchObject({ type: "measurement.completed", payload: { monitorId: "monitor-1" } });
    expect(secondEvent).toMatchObject({ type: "measurement.completed", payload: { measurementId: "measurement-1" } });
    first.close();
    second.close();
  });

  it("rejects an unapproved browser origin", async () => {
    const server = await startServer();
    const client = new WebSocket(server.url, { origin: "http://evil.example" });
    const rejected = new Promise<void>((resolve) => {
      client.once("error", () => resolve());
      client.once("close", () => resolve());
    });
    await expect(rejected).resolves.toBeUndefined();
  });

  it("delivers outage and status transition events", async () => {
    const server = await startServer();
    const client = new WebSocket(server.url, { origin: "http://localhost:5173" });
    const ready = waitForMessage(client);
    await Promise.all([waitForOpen(client), ready]);
    const eventPromise = waitForMessage(client);
    emitMonitoringEvent({
      type: "outage.started",
      occurredAt: "2026-11-01T00:00:00.000Z",
      payload: {
        monitorId: "monitor-1",
        outageId: "outage-1",
        occurredAt: "2026-11-01T00:00:00.000Z",
        startedAt: "2026-11-01T00:00:00.000Z",
        endedAt: null,
        failureCount: 3,
        reason: "TIMEOUT",
      },
    });
    await expect(eventPromise).resolves.toMatchObject({ type: "outage.started" });
    client.close();
  });
});
