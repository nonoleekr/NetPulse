import { spawn } from "node:child_process";
import type { ProbeResult } from "./probe-types.js";

function commandForPlatform() {
  if (process.platform === "win32") return { command: "ping.exe", args: (host: string, timeoutMs: number) => ["-n", "1", "-w", String(timeoutMs), host] };
  return { command: "ping", args: (host: string) => ["-c", "1", "-W", "1", host] };
}

export function parseIcmpLatency(output: string) {
  const match = output.match(/(?:time[=<]\s*|Average = )(\d+(?:\.\d+)?)/i);
  return match ? Math.round(Number(match[1])) : null;
}

export function probeIcmp(host: string, timeoutMs: number): Promise<ProbeResult> {
  const started = performance.now();
  const { command, args } = commandForPlatform();
  return new Promise((resolve) => {
    const child = spawn(command, args(host, timeoutMs), { shell: false, windowsHide: true });
    let output = "";
    let settled = false;
    const timer = setTimeout(() => {
      child.kill();
      finish({ success: false, latencyMs: null, errorCode: "TIMEOUT", errorMessage: `Timed out after ${timeoutMs}ms` });
    }, timeoutMs + 250);
    const finish = (result: ProbeResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };
    child.stdout.on("data", (chunk: Buffer) => { output += chunk.toString(); });
    child.stderr.on("data", (chunk: Buffer) => { output += chunk.toString(); });
    child.once("error", (error) => finish({
      success: false,
      latencyMs: null,
      errorCode: error.message.includes("ENOENT") ? "UNSUPPORTED" : "PERMISSION",
      errorMessage: error.message.includes("ENOENT") ? "The system ping utility is unavailable" : "ICMP probing is not permitted",
    }));
    child.once("close", (code) => {
      if (code === 0) {
        finish({ success: true, latencyMs: parseIcmpLatency(output) ?? Math.max(0, Math.round(performance.now() - started)) });
      } else {
        finish({ success: false, latencyMs: null, errorCode: "UNREACHABLE", errorMessage: "The host did not respond to ICMP" });
      }
    });
  });
}
