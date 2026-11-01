import { describe, expect, it } from "vitest";
import { diagnoseDns } from "./dns-diagnostic.js";

describe("DNS diagnostics", () => {
  it("reports IPv4, IPv6, and absent records separately", async () => {
    const result = await diagnoseDns("fixture.test", 100, {
      resolve4: async () => ["192.0.2.10"],
      resolve6: async () => [],
      now: (() => {
        let value = 10;
        return () => value++;
      })(),
    });
    expect(result.result.records).toEqual({ A: ["192.0.2.10"], AAAA: [] });
    expect(result.result.recordStatus).toEqual({ A: "RESOLVED", AAAA: "ABSENT" });
    expect(result.durationMs).toBe(1);
  });

  it("classifies failures and timeouts without throwing", async () => {
    const result = await diagnoseDns("fixture.test", 5, {
      resolve4: async () => { throw Object.assign(new Error("lookup failed"), { code: "SERVFAIL" }); },
      resolve6: () => new Promise<string[]>(() => undefined),
    });
    expect(result.result.recordStatus).toEqual({ A: "FAILED", AAAA: "FAILED" });
  });
});
