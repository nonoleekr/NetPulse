import { beforeEach, describe, expect, it, vi } from "vitest";

const state = {
  recent: [] as { success: boolean }[],
  active: null as { id: string; failureCount: number } | null,
};
const create = vi.fn().mockImplementation(async ({ data }) => ({
  id: "outage-1",
  ...data,
  endedAt: data.endedAt ?? null,
}));
const update = vi.fn().mockImplementation(async ({ where, data }) => ({
  id: where.id,
  monitorId: "monitor-1",
  startedAt: new Date("2026-11-01T00:00:00Z"),
  reason: "TIMEOUT",
  ...data,
}));

vi.mock("./db.js", () => ({
  prisma: {
    measurement: { findMany: vi.fn(() => Promise.resolve(state.recent)) },
    outage: {
      findFirst: vi.fn(() => Promise.resolve(state.active)),
      create,
      update,
    },
  },
}));

describe("outage state transitions", () => {
  beforeEach(() => {
    state.recent = [];
    state.active = null;
    create.mockClear();
    update.mockClear();
  });

  it("opens an outage after the configured consecutive failure threshold", async () => {
    state.recent = [{ success: false }, { success: false }, { success: false }];
    const { updateOutageState } = await import("./outages.js");

    await updateOutageState("monitor-1", new Date("2026-11-01T00:00:00Z"), false, "TIMEOUT");

    expect(create).toHaveBeenCalledWith({
      data: {
        monitorId: "monitor-1",
        startedAt: new Date("2026-11-01T00:00:00Z"),
        failureCount: 3,
        reason: "TIMEOUT",
      },
    });
  });

  it("closes an active outage after a successful measurement", async () => {
    state.recent = [{ success: true }];
    state.active = { id: "outage-1", failureCount: 3 };
    const { updateOutageState } = await import("./outages.js");

    await updateOutageState("monitor-1", new Date("2026-11-01T00:01:00Z"), true);

    expect(update).toHaveBeenCalledWith({
      where: { id: "outage-1" },
      data: { endedAt: new Date("2026-11-01T00:01:00Z"), failureCount: 3 },
    });
  });
});
