import { afterEach, describe, expect, it, vi } from "vitest";

const persisted: { value: boolean } = { value: false };
const monitor = {
  id: "monitor-1",
  url: "https://example.com/",
  timeoutMs: 1000,
  enabled: true,
};

vi.mock("./db.js", () => ({
  prisma: {
    monitor: {
      findUnique: vi.fn().mockResolvedValue(monitor),
    },
    measurement: {
      create: vi.fn().mockImplementation(async () => {
        persisted.value = true;
        return {
          id: "measurement-1",
          monitorId: monitor.id,
          completedAt: new Date("2026-11-01T00:00:00.000Z"),
          success: true,
          startedAt: new Date("2026-11-01T00:00:00.000Z"),
          latencyMs: 10,
          statusCode: 200,
          errorCode: null,
          errorMessage: null,
        };
      }),
    },
  },
}));

describe("measurement persistence and events", () => {
  afterEach(() => {
    persisted.value = false;
  });

  it("emits only after the measurement is persisted", async () => {
    const { measurementEvents } = await import("./measurement-events.js");
    const { runProbe } = await import("./scheduler.js");
    let observedPersisted = false;
    const listener = () => {
      observedPersisted = persisted.value;
    };
    measurementEvents.on("measurement.completed", listener);

    await runProbe(monitor.id, async () => ({
      success: true,
      latencyMs: 10,
      statusCode: 200,
    }));

    measurementEvents.off("measurement.completed", listener);
    expect(observedPersisted).toBe(true);
  });
});
