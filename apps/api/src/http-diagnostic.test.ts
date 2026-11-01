import { createServer as createHttpServer, type RequestListener, type Server } from "node:http";
import { createServer as createHttpsServer } from "node:https";
import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { diagnoseHttp, executeHttpRequest } from "./http-diagnostic.js";

const certificate = readFileSync(new URL("../test-fixtures/localhost-cert.pem", import.meta.url));
const privateKey = readFileSync(new URL("../test-fixtures/localhost-key.pem", import.meta.url));
const servers: Server[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => {
    server.close(() => resolve());
    server.closeAllConnections();
  })));
});

async function listen(server: Server) {
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("HTTP fixture did not start");
  return address.port;
}

async function startHttpServer(handler: RequestListener) {
  const server = createHttpServer(handler);
  return { server, port: await listen(server) };
}

const baseExchange = {
  statusCode: 200,
  location: null,
  responseBytes: 42,
  responseTruncated: false,
  httpVersion: "1.1",
  remoteAddress: "192.0.2.20",
  tcpConnectMs: 2,
  tlsHandshakeMs: 3,
  timeToFirstByteMs: 8,
  totalMs: 9,
};

describe("HTTP diagnostics", () => {
  it("revalidates and repins every redirect target", async () => {
    const validate = vi.fn(async (url: string) => ({
      url,
      address: url.includes("second") ? "192.0.2.20" : "192.0.2.10",
    }));
    const execute = vi.fn()
      .mockResolvedValueOnce({ ...baseExchange, statusCode: 302, location: "https://second.test/final", remoteAddress: "192.0.2.10" })
      .mockResolvedValueOnce(baseExchange);
    let clock = 0;
    const diagnostic = await diagnoseHttp("https://first.test/start", {
      timeoutMs: 1000,
      maxRedirects: 3,
      maxResponseBytes: 1024,
    }, { validate, execute, now: () => clock++ });

    expect(validate).toHaveBeenNthCalledWith(1, "https://first.test/start");
    expect(validate).toHaveBeenNthCalledWith(2, "https://second.test/final");
    expect(execute.mock.calls[0][0].address).toBe("192.0.2.10");
    expect(execute.mock.calls[1][0].address).toBe("192.0.2.20");
    expect(diagnostic.result.redirects).toEqual([{
      statusCode: 302,
      from: "https://first.test/start",
      to: "https://second.test/final",
    }]);
    expect(diagnostic.result.statusCode).toBe(200);
  });

  it("stops before requesting a redirect target that fails validation", async () => {
    const validate = vi.fn(async (url: string) => {
      if (url.includes("blocked")) throw new Error("Private, loopback, and reserved targets are blocked");
      return { url, address: "192.0.2.10" };
    });
    const execute = vi.fn().mockResolvedValue({ ...baseExchange, statusCode: 301, location: "http://blocked.test/" });

    await expect(diagnoseHttp("https://first.test/", {
      timeoutMs: 1000,
      maxRedirects: 3,
      maxResponseBytes: 1024,
    }, { validate, execute })).rejects.toThrow("reserved targets are blocked");
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it("enforces the configured redirect limit", async () => {
    const execute = vi.fn().mockResolvedValue({ ...baseExchange, statusCode: 302, location: "/again" });
    await expect(diagnoseHttp("https://loop.test/", {
      timeoutMs: 1000,
      maxRedirects: 1,
      maxResponseBytes: 1024,
    }, { validate: async (url) => ({ url, address: "192.0.2.10" }), execute })).rejects.toThrow("redirect limit");
    expect(execute).toHaveBeenCalledTimes(2);
  });

  it("cancels while target validation is in flight", async () => {
    const controller = new AbortController();
    const execute = vi.fn();
    const diagnostic = diagnoseHttp("https://slow.test/", {
      timeoutMs: 1000,
      maxRedirects: 1,
      maxResponseBytes: 1024,
      signal: controller.signal,
    }, { validate: () => new Promise(() => undefined), execute });

    controller.abort();
    await expect(diagnostic).rejects.toThrow("cancelled");
    expect(execute).not.toHaveBeenCalled();
  });

  it("measures real local DNS, TCP, first-byte, and total phases", async () => {
    let receivedHost = "";
    const { port } = await startHttpServer((request, response) => {
      receivedHost = request.headers.host ?? "";
      setTimeout(() => response.end("timed fixture"), 25);
    });
    const rawUrl = `http://timing.test:${port}/diagnostic`;
    const diagnostic = await diagnoseHttp(rawUrl, {
      timeoutMs: 1000,
      maxRedirects: 0,
      maxResponseBytes: 1024,
    }, {
      validate: async (url) => {
        await new Promise((resolve) => setTimeout(resolve, 15));
        return { url, address: "127.0.0.1" };
      },
    });

    expect(diagnostic.result).toMatchObject({
      statusCode: 200,
      responseBytes: Buffer.byteLength("timed fixture"),
      responseTruncated: false,
      remoteAddress: "127.0.0.1",
    });
    expect(receivedHost).toBe(`timing.test:${port}`);
    expect(diagnostic.result.timings.dnsLookupMs).toBeGreaterThanOrEqual(10);
    expect(diagnostic.result.timings.tcpConnectMs).toBeGreaterThanOrEqual(0);
    expect(diagnostic.result.timings.tlsHandshakeMs).toBeNull();
    expect(diagnostic.result.timings.timeToFirstByteMs).toBeGreaterThanOrEqual(15);
    expect(diagnostic.result.timings.totalMs).toBeGreaterThanOrEqual(diagnostic.result.timings.timeToFirstByteMs);
  });

  it("measures a trusted local HTTPS handshake and rejects it without the test CA", async () => {
    const server = createHttpsServer({ cert: certificate, key: privateKey }, (_request, response) => response.end("secure fixture"));
    const port = await listen(server);
    const target = { url: `https://localhost:${port}/`, address: "127.0.0.1" };

    await expect(executeHttpRequest(target, 1000, 1024)).rejects.toThrow("could not be established");
    const exchange = await executeHttpRequest(target, 1000, 1024, undefined, { ca: certificate });
    expect(exchange.statusCode).toBe(200);
    expect(exchange.tlsHandshakeMs).toBeGreaterThanOrEqual(0);
    expect(exchange.timeToFirstByteMs).toBeGreaterThanOrEqual(exchange.tcpConnectMs);
    expect(exchange.totalMs).toBeGreaterThanOrEqual(exchange.timeToFirstByteMs);
  });

  it("bounds response reads and closes a truncated response", async () => {
    let socketClosed = false;
    const { port } = await startHttpServer((request, response) => {
      request.socket.once("close", () => { socketClosed = true; });
      response.end("x".repeat(4096));
    });
    const exchange = await executeHttpRequest({ url: `http://fixture.test:${port}/`, address: "127.0.0.1" }, 1000, 32);

    expect(exchange).toMatchObject({ responseBytes: 32, responseTruncated: true });
    await vi.waitFor(() => expect(socketClosed).toBe(true));
  });

  it("times out a real local response and releases the connection", async () => {
    let socketClosed = false;
    const { port } = await startHttpServer((request, response) => {
      request.socket.once("close", () => { socketClosed = true; });
      setTimeout(() => response.end("late"), 100);
    });

    await expect(executeHttpRequest({ url: `http://fixture.test:${port}/`, address: "127.0.0.1" }, 20, 1024)).rejects.toThrow("timed out");
    await vi.waitFor(() => expect(socketClosed).toBe(true));
  });
});
