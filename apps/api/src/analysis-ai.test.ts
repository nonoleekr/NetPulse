import { describe, expect, it } from "vitest";
import { disabledAnalysisAssistant, redactForAnalysisAssistant } from "./analysis-ai.js";

describe("analysis assistant boundary", () => {
  it("is disabled by default", async () => {
    expect(disabledAnalysisAssistant.enabled).toBe(false);
    await expect(disabledAnalysisAssistant.summarize({ deterministicSummary: "healthy", evidence: [] }, new AbortController().signal)).rejects.toThrow(/disabled/);
  });

  it("redacts secrets, URLs, and private addresses and bounds content", () => {
    const input = "token=super-secret https://user:pass@example.test/path 192.168.1.10 10.0.0.2 prompt text";
    const redacted = redactForAnalysisAssistant(input, 200);
    expect(redacted).not.toContain("super-secret");
    expect(redacted).not.toContain("example.test");
    expect(redacted).not.toContain("192.168.1.10");
    expect(redacted).not.toContain("10.0.0.2");
    expect(redactForAnalysisAssistant("x".repeat(5_000))).toHaveLength(4_000);
  });
});
