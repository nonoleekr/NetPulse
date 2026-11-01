import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import type { AgentProbeTask } from "@netpulse/contracts";
import { executeTask } from "./probes.js";

const servers: ReturnType<typeof createServer>[] = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve, reject) => {
    server.closeAllConnections();
    server.close((error) => error ? reject(error) : resolve());
  })));
});

describe("agent probe execution bounds", () => {
  it("enforces one overall HTTP task deadline with a local fixture", async () => {
    const server = createServer((_request, response) => setTimeout(() => response.end("late"), 250));
    servers.push(server);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const port = (server.address() as AddressInfo).port;
    const task: AgentProbeTask = {
      id: "task-timeout", monitorId: "monitor-timeout", sessionGeneration: 1, kind: "HTTP",
      url: `http://127.0.0.1:${port}/`, host: null, port: null, timeoutMs: 20,
      issuedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 1_000).toISOString(),
    };
    const started = performance.now();
    const result = await executeTask(task, new AbortController().signal, true);
    expect(result).toMatchObject({ success: false, errorCode: "TIMEOUT" });
    expect(performance.now() - started).toBeLessThan(200);
  });
});
