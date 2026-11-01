import { resolve4, resolve6 } from "node:dns/promises";
import type { DnsDiagnosticResult } from "@netpulse/contracts";

type Resolver = (hostname: string) => Promise<string[]>;
type Clock = () => number;

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, signal?: AbortSignal) {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) => setTimeout(() => reject(new Error("DNS lookup timed out")), timeoutMs)),
    ...(signal ? [new Promise<never>((_, reject) => signal.addEventListener("abort", () => reject(new Error("DNS diagnostic cancelled")), { once: true }))] : []),
  ]);
}

async function lookupRecord(
  hostname: string,
  resolver: Resolver,
  timeoutMs: number,
  signal?: AbortSignal,
) {
  try {
    const records = await withTimeout(resolver(hostname), timeoutMs, signal);
    return records.length ? { status: "RESOLVED" as const, records } : { status: "ABSENT" as const, records: [] };
  } catch (error) {
    if (error instanceof Error && (error as Error & { code?: string }).code === "ENODATA") return { status: "ABSENT" as const, records: [] };
    return { status: "FAILED" as const, records: [] };
  }
}

export async function diagnoseDns(
  hostname: string,
  timeoutMs: number,
  dependencies: {
    resolve4?: Resolver;
    resolve6?: Resolver;
    now?: Clock;
    signal?: AbortSignal;
  } = {},
): Promise<{ result: DnsDiagnosticResult; durationMs: number }> {
  const now = dependencies.now ?? (() => performance.now());
  const started = now();
  const [ipv4, ipv6] = await Promise.all([
    lookupRecord(hostname, dependencies.resolve4 ?? resolve4, timeoutMs, dependencies.signal),
    lookupRecord(hostname, dependencies.resolve6 ?? resolve6, timeoutMs, dependencies.signal),
  ]);
  return {
    result: {
      kind: "DNS",
      hostname,
      records: { A: ipv4.records, AAAA: ipv6.records },
      recordStatus: { A: ipv4.status, AAAA: ipv6.status },
    },
    durationMs: Math.max(0, Math.round(now() - started)),
  };
}
