import { EventEmitter } from "node:events";
import { readFileSync } from "node:fs";
import { createServer as createTlsServer, type Server as TlsServer } from "node:tls";
import { afterEach, describe, expect, it } from "vitest";
import { diagnoseTls } from "./tls-diagnostic.js";

const certificate = readFileSync(new URL("../test-fixtures/localhost-cert.pem", import.meta.url));
const privateKey = readFileSync(new URL("../test-fixtures/localhost-key.pem", import.meta.url));
const servers: TlsServer[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve()))));
});

async function startTlsServer() {
  const server = createTlsServer({ cert: certificate, key: privateKey }, (socket) => socket.end());
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("TLS fixture did not start");
  return address.port;
}

describe("TLS diagnostics", () => {
  it("reports bounded certificate metadata and handshake details", async () => {
    const socket = Object.assign(new EventEmitter(), {
      destroyed: false,
      authorized: true,
      authorizationError: null,
      alpnProtocol: "h2",
      destroy() { this.destroyed = true; return this; },
      getProtocol: () => "TLSv1.3",
      getCipher: () => ({ name: "TLS_AES_256_GCM_SHA384" }),
      getPeerCertificate: () => ({
        subject: { CN: "example.test" },
        issuer: { CN: "Fixture CA" },
        subjectaltname: "DNS:example.test, DNS:www.example.test",
        valid_from: "Oct 01 00:00:00 2026 GMT",
        valid_to: "Dec 01 00:00:00 2026 GMT",
        fingerprint256: "AA:BB",
        serialNumber: "01",
      }),
    });
    let clock = 10;
    const promise = diagnoseTls({ url: "https://example.test/", address: "192.0.2.10" }, 4, 1000, {
      connect: (() => socket) as never,
      now: () => clock++,
      currentTime: () => Date.parse("2026-11-01T00:00:00.000Z"),
    });
    socket.emit("connect");
    socket.emit("secureConnect");
    const diagnostic = await promise;

    expect(diagnostic.result).toMatchObject({
      kind: "TLS",
      hostname: "example.test",
      authorized: true,
      hostnameMatched: true,
      protocol: "TLSv1.3",
      cipher: "TLS_AES_256_GCM_SHA384",
      certificate: {
        subjectCommonName: "example.test",
        issuerCommonName: "Fixture CA",
        subjectAltNames: ["DNS:example.test", "DNS:www.example.test"],
        validityStatus: "VALID",
        daysRemaining: 30,
      },
    });
    expect(socket.destroyed).toBe(true);
  });

  it("rejects non-HTTPS targets before opening a socket", async () => {
    await expect(diagnoseTls({ url: "http://example.test/", address: "192.0.2.10" }, 1, 1000)).rejects.toThrow("HTTPS monitor");
  });

  it("destroys the socket when cancelled", async () => {
    const socket = Object.assign(new EventEmitter(), {
      destroyed: false,
      destroy() { this.destroyed = true; return this; },
    });
    const controller = new AbortController();
    const diagnostic = diagnoseTls({ url: "https://example.test/", address: "192.0.2.10" }, 1, 1000, {
      signal: controller.signal,
      connect: (() => socket) as never,
    });

    controller.abort();
    await expect(diagnostic).rejects.toThrow("cancelled");
    expect(socket.destroyed).toBe(true);
  });

  it("reports expiration and hostname mismatch independently", async () => {
    const authorizationError = Object.assign(new Error("hostname mismatch"), { code: "ERR_TLS_CERT_ALTNAME_INVALID" });
    const socket = Object.assign(new EventEmitter(), {
      destroyed: false,
      authorized: false,
      authorizationError,
      alpnProtocol: false,
      destroy() { this.destroyed = true; return this; },
      getProtocol: () => "TLSv1.2",
      getCipher: () => ({ name: "TEST_CIPHER" }),
      getPeerCertificate: () => ({
        subject: { CN: "example.test" },
        issuer: { CN: "Fixture CA" },
        subjectaltname: "DNS:example.test",
        valid_from: "Oct 01 00:00:00 2026 GMT",
        valid_to: "Dec 01 00:00:00 2026 GMT",
        fingerprint256: "AA:BB",
        serialNumber: "01",
      }),
    });
    const promise = diagnoseTls({ url: "https://wrong.test/", address: "192.0.2.10" }, 1, 1000, {
      connect: (() => socket) as never,
      currentTime: () => Date.parse("2027-01-01T00:00:00.000Z"),
    });
    socket.emit("connect");
    socket.emit("secureConnect");

    const diagnostic = await promise;
    expect(diagnostic.result).toMatchObject({
      authorized: false,
      authorizationError: "ERR_TLS_CERT_ALTNAME_INVALID",
      hostnameMatched: false,
      hostnameError: "ERR_TLS_CERT_ALTNAME_INVALID",
      certificate: { validityStatus: "EXPIRED", daysRemaining: -31 },
    });
  });

  it("inspects a real local TLS handshake without trusting a self-signed certificate", async () => {
    const port = await startTlsServer();
    const diagnostic = await diagnoseTls({
      url: `https://localhost:${port}/`,
      address: "127.0.0.1",
    }, 2, 1000);

    expect(diagnostic.result).toMatchObject({
      hostname: "localhost",
      port,
      authorized: false,
      authorizationError: "DEPTH_ZERO_SELF_SIGNED_CERT",
      hostnameMatched: true,
      hostnameError: null,
      certificate: { subjectCommonName: "localhost", validityStatus: "VALID" },
    });
    expect(diagnostic.result.timings.tcpConnectMs).toBeGreaterThanOrEqual(0);
    expect(diagnostic.result.timings.tlsHandshakeMs).toBeGreaterThanOrEqual(0);
    expect(diagnostic.result.timings.totalMs).toBeGreaterThanOrEqual(2);
  });
});
