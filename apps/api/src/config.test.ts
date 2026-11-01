import { afterEach, describe, expect, it, vi } from "vitest";

const original = { ...process.env };

afterEach(() => {
  process.env = { ...original };
  vi.resetModules();
});

describe("configuration bounds", () => {
  it("binds to localhost by default", async () => {
    delete process.env.HOST;
    const { config } = await import("./config.js");
    expect(config.host).toBe("127.0.0.1");
  });

  it("uses safe fallbacks for invalid numeric environment values", async () => {
    process.env.PORT = "not-a-number";
    process.env.MAX_MONITORS = "NaN";
    process.env.RETENTION_DAYS = "Infinity";

    const { config } = await import("./config.js");

    expect(config.port).toBe(4000);
    expect(config.maxMonitors).toBe(100);
    expect(config.retentionDays).toBe(30);
  });
});
