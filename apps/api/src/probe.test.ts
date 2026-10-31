import { createServer, type RequestListener } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import { probeHttp } from "./probe.js";

const servers: ReturnType<typeof createServer>[] = [];

afterEach(() => {
  for (const server of servers.splice(0)) server.close();
});

const localTarget = async (url: string) => ({ url, address: "127.0.0.1" });

async function startServer(handler: RequestListener) {
  const server = createServer(handler);
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Server did not start");
  return `http://127.0.0.1:${address.port}/`;
}

describe("HTTP probe", () => {
  it("times out a slow response", async () => {
    const url = await startServer((_request, response) => {
      setTimeout(() => response.end("late"), 100);
    });
    const result = await probeHttp(url, 20, localTarget);
    expect(result).toMatchObject({ success: false, errorCode: "TIMEOUT" });
  });

  it("rejects responses over the configured limit", async () => {
    const url = await startServer((_request, response) => {
      response.end("x".repeat(1024 * 1024 + 1));
    });
    const result = await probeHttp(url, 1000, localTarget);
    expect(result).toMatchObject({ success: false, errorCode: "RESPONSE_TOO_LARGE" });
  });

  it("records failed HTTP status responses", async () => {
    const url = await startServer((_request, response) => {
      response.statusCode = 503;
      response.end("unavailable");
    });
    const result = await probeHttp(url, 1000, localTarget);
    expect(result).toMatchObject({ success: false, statusCode: 503, errorCode: "HTTP_STATUS" });
  });

  it("does not follow redirects", async () => {
    let redirected = false;
    const url = await startServer((_request, response) => {
      response.statusCode = 302;
      response.setHeader("location", "http://127.0.0.1:9/private");
      response.end();
    });
    const result = await probeHttp(url, 1000, async (target) => {
      redirected = target.includes("/private");
      return { url: target, address: "127.0.0.1" };
    });
    expect(result).toMatchObject({ success: true, statusCode: 302 });
    expect(redirected).toBe(false);
  });

  it("times out target validation before a slow DNS result completes", async () => {
    const validate = () => new Promise<{ url: string; address: string }>((resolve) => {
      setTimeout(() => resolve({ url: "http://127.0.0.1:9", address: "127.0.0.1" }), 100);
    });
    const result = await probeHttp("https://slow-dns.example", 20, validate);
    expect(result).toMatchObject({ success: false, errorCode: "TIMEOUT" });
  });
});
