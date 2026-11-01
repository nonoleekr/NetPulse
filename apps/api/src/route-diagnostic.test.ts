import { EventEmitter } from "node:events";
import { describe, expect, it } from "vitest";
import { diagnoseRoute, routeCommand } from "./route-diagnostic.js";

describe("route diagnostics", () => {
  it("builds fixed, non-shell command arguments", () => {
    expect(routeCommand("win32").args("example.com;whoami", 8, 1000)).toEqual(["-d", "-h", "8", "-w", "1000", "example.com;whoami"]);
  });

  it("parses responsive and unknown hops", async () => {
    const child = Object.assign(new EventEmitter(), {
      killed: false,
      kill() { this.killed = true; return true; },
      stdout: new EventEmitter(),
      stderr: new EventEmitter(),
    });
    const promise = diagnoseRoute("example.com", { maxHops: 3, timeoutMs: 1000, platform: "win32" }, (() => child) as never);
    child.stdout.emit("data", "  1    2 ms  192.0.2.1\r\n  2     *     *     Request timed out.\r\n");
    child.emit("close", 0);
    const result = await promise;
    expect(result.result.hops).toEqual([{ hop: 1, address: "192.0.2.1", latencyMs: 2, responsive: true }, { hop: 2, address: null, latencyMs: null, responsive: false }]);
    expect(child.killed).toBe(true);
  });

  it("returns an explicit unsupported error", async () => {
    await expect(diagnoseRoute("example.com", { maxHops: 3, timeoutMs: 1000, platform: "aix" })).rejects.toThrow("unsupported");
  });
});
