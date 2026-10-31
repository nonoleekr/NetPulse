import { createServer } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { probeTcp } from "./tcp-probe.js";

const servers: ReturnType<typeof createServer>[] = [];

afterEach(() => {
  for (const server of servers.splice(0)) server.close();
});

async function listen() {
  const server = createServer();
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Server did not start");
  return address.port;
}

const localResolver = async () => [{ address: "127.0.0.1", family: 4 }];

describe("TCP probe", () => {
  it("measures a successful connection", async () => {
    const port = await listen();
    const result = await probeTcp("fixture.local", port, 500, localResolver);
    expect(result.success).toBe(true);
    expect(result.latencyMs).not.toBeNull();
  });

  it("reports connection refusal", async () => {
    const server = createServer();
    let port = 0;
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") throw new Error("Server did not start");
      port = address.port;
      server.close(() => resolve());
    }));
    const result = await probeTcp("fixture.local", port, 500, localResolver);
    expect(result).toMatchObject({ success: false, errorCode: "REFUSED" });
  });

  it("reports DNS failures before opening a socket", async () => {
    const result = await probeTcp("missing.local", 443, 500, async () => {
      throw new Error("Target hostname did not resolve");
    });
    expect(result).toMatchObject({ success: false, errorCode: "DNS_ERROR" });
  });
});
