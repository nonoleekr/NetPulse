import { describe, expect, it } from "vitest";
import { validateHttpTarget } from "./target.js";

describe("HTTP target validation", () => {
  it("allows a public target", async () => {
    await expect(validateHttpTarget("https://example.com")).resolves.toMatchObject({ url: "https://example.com/" });
  });

  it("rejects loopback by default", async () => {
    await expect(validateHttpTarget("http://127.0.0.1:4001")).rejects.toThrow("blocked");
  });

  it.each(["::", "::1", "::ffff:127.0.0.1", "ff02::1"])("rejects unsafe IPv6 address %s", async (address) => {
    await expect(validateHttpTarget(`http://[${address}]:4001`)).rejects.toThrow("blocked");
  });

  it("uses one validated address, preventing a DNS rebinding result from being used by the caller", async () => {
    let calls = 0;
    const resolve = async () => {
      calls += 1;
      return [{ address: calls === 1 ? "93.184.216.34" : "127.0.0.1", family: 4 }];
    };
    const target = await validateHttpTarget("https://rebind.example", resolve);
    expect(target.address).toBe("93.184.216.34");
    expect(calls).toBe(1);
  });

  it("does not allow the local override when NODE_ENV is unset", async () => {
    const original = process.env.NODE_ENV;
    const flag = process.env.NETPULSE_ALLOW_LOCAL_TARGETS;
    delete process.env.NODE_ENV;
    process.env.NETPULSE_ALLOW_LOCAL_TARGETS = "true";
    await expect(validateHttpTarget("http://127.0.0.1:4001")).rejects.toThrow("blocked");
    if (original === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = original;
    if (flag === undefined) delete process.env.NETPULSE_ALLOW_LOCAL_TARGETS;
    else process.env.NETPULSE_ALLOW_LOCAL_TARGETS = flag;
  });
});
