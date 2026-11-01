import { spawn, type ChildProcess } from "node:child_process";
import process from "node:process";
import type { RouteDiagnosticResult, RouteHop } from "@netpulse/contracts";

const maxOutputBytes = 64 * 1024;
const hopPattern = /^\s*(\d+)\s+(?:(\d+)\s*ms\s+)?(?:(<\d+)\s*ms\s+)?([0-9a-f:.]+)?/i;

function parseHops(output: string): RouteHop[] {
  return output.split(/\r?\n/).flatMap((line) => {
    const match = line.match(hopPattern);
    if (!match) return [];
    const latency = match[2] ?? match[3]?.slice(1);
    const address = match[4] ?? null;
    return [{
      hop: Number(match[1]),
      address,
      latencyMs: latency ? Number(latency) : null,
      responsive: Boolean(address || latency),
    }];
  });
}

export function routeCommand(platform: string = process.platform) {
  if (platform === "win32") return { command: "tracert", args: (host: string, maxHops: number, timeoutMs: number) => ["-d", "-h", String(maxHops), "-w", String(timeoutMs), host] };
  return { command: "traceroute", args: (host: string, maxHops: number, timeoutMs: number) => ["-n", "-m", String(maxHops), "-w", String(Math.ceil(timeoutMs / 1000)), host] };
}

function closeProcess(child: ChildProcess) {
  if (!child.killed) child.kill();
}

export async function diagnoseRoute(
  hostname: string,
  options: { maxHops: number; timeoutMs: number; signal?: AbortSignal; platform?: string } ,
  spawnProcess = spawn,
): Promise<{ result: RouteDiagnosticResult; durationMs: number }> {
  const started = performance.now();
  const platform = options.platform ?? process.platform;
  const selected = routeCommand(platform);
  if (platform !== "win32" && platform !== "linux" && platform !== "darwin") {
    throw new Error("Route diagnostic unsupported on this platform");
  }
  const child = spawnProcess(selected.command, selected.args(hostname, options.maxHops, options.timeoutMs), { shell: false, windowsHide: true });
  let output = "";
  let bytes = 0;
  let outputLimitExceeded = false;
  const append = (chunk: Buffer | string) => {
    bytes += Buffer.byteLength(chunk);
    if (bytes <= maxOutputBytes) output += chunk.toString();
    else {
      outputLimitExceeded = true;
      closeProcess(child);
    }
  };
  const abort = () => closeProcess(child);
  options.signal?.addEventListener("abort", abort, { once: true });
  try {
    const result = await new Promise<RouteDiagnosticResult>((resolve, reject) => {
      const timer = setTimeout(() => { closeProcess(child); reject(new Error("Route diagnostic timed out")); }, options.timeoutMs);
      child.stdout?.on("data", append);
      child.stderr?.on("data", append);
      child.once("error", reject);
      child.once("close", (code) => {
        clearTimeout(timer);
        if (options.signal?.aborted) reject(new Error("Route diagnostic cancelled"));
        else if (outputLimitExceeded) reject(new Error("Route diagnostic output exceeded the limit"));
        else if (code !== 0 && !output) reject(new Error("Route diagnostic failed"));
        else {
          const hops = parseHops(output);
          resolve({ kind: "ROUTE", hostname, platform, command: selected.command as "tracert" | "traceroute", hops, reachedDestination: hops.some((hop) => hop.address === hostname) });
        }
      });
    });
    return { result, durationMs: Math.round(performance.now() - started) };
  } finally {
    options.signal?.removeEventListener("abort", abort);
    closeProcess(child);
  }
}
