import { describe, expect, it } from "vitest";
import { assertLoopbackCoordinator } from "./config.js";
import { isPrivateOrReserved, validateHttpTarget } from "./target.js";
import { reconnectDelay } from "./reconnect.js";

describe("agent security controls", () => {
  it("allows only loopback plaintext coordinators", () => {
    expect(assertLoopbackCoordinator("http://127.0.0.1:4000").hostname).toBe("127.0.0.1");
    expect(() => assertLoopbackCoordinator("http://192.168.1.2:4000")).toThrow(/Cross-device/);
    expect(() => assertLoopbackCoordinator("https://127.0.0.1:4000")).toThrow(/plaintext/);
  });

  it("recognizes private and reserved ranges", () => {
    expect(isPrivateOrReserved("127.0.0.1")).toBe(true);
    expect(isPrivateOrReserved("169.254.1.1")).toBe(true);
    expect(isPrivateOrReserved("192.168.1.2")).toBe(true);
    expect(isPrivateOrReserved("::ffff:7f00:1")).toBe(true);
    expect(isPrivateOrReserved("::ffff:192.168.1.2")).toBe(true);
    expect(isPrivateOrReserved("8.8.8.8")).toBe(false);
  });

  it("blocks loopback HTTP targets by default", async () => {
    await expect(validateHttpTarget("http://127.0.0.1:8080")).rejects.toThrow(/blocked/);
    await expect(validateHttpTarget("http://127.0.0.1:8080", true)).resolves.toMatchObject({ address: "127.0.0.1" });
  });

  it("bounds reconnect delay with deterministic jitter", () => {
    expect(reconnectDelay(0, 30_000, () => 0)).toBe(375);
    expect(reconnectDelay(20, 30_000, () => 1)).toBe(37_500);
  });
});
