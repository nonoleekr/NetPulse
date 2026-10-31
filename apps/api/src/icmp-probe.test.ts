import { describe, expect, it } from "vitest";
import { parseIcmpLatency } from "./icmp-probe.js";

describe("ICMP result normalization", () => {
  it("parses Windows-style response latency", () => {
    expect(parseIcmpLatency("Reply from 127.0.0.1: bytes=32 time<1ms TTL=128")).toBe(1);
  });

  it("parses summary latency", () => {
    expect(parseIcmpLatency("Average = 12ms")).toBe(12);
  });

  it("returns null for an unreachable response", () => {
    expect(parseIcmpLatency("Request timed out.")).toBeNull();
  });
});
