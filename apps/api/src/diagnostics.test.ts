import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  findUnique: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
}));

vi.mock("./db.js", () => ({
  prisma: {
    monitor: { findUnique: mocks.findUnique },
    diagnosticRun: { create: mocks.create, update: mocks.update },
  },
}));

vi.mock("./config.js", () => ({
  config: {
    maxDiagnostics: 2,
    diagnosticTimeoutMs: 1000,
    diagnosticMaxHops: 3,
    diagnosticMaxRedirects: 1,
    maxResponseBytes: 1024,
  },
}));

import { runDiagnostic } from "./diagnostics.js";

describe("diagnostic orchestration", () => {
  beforeEach(() => vi.clearAllMocks());

  it("reserves capacity before asynchronous monitor lookup and releases it on failure", async () => {
    const pending: Array<(value: null) => void> = [];
    mocks.findUnique.mockImplementation(() => new Promise<null>((resolve) => pending.push(resolve)));

    const first = runDiagnostic("one", "DNS");
    const second = runDiagnostic("two", "DNS");
    await expect(runDiagnostic("three", "DNS")).rejects.toThrow("capacity is busy");

    pending.splice(0).forEach((resolve) => resolve(null));
    await expect(first).rejects.toThrow("Monitor not found");
    await expect(second).rejects.toThrow("Monitor not found");

    mocks.findUnique.mockResolvedValueOnce(null);
    await expect(runDiagnostic("four", "DNS")).rejects.toThrow("Monitor not found");
  });
});
