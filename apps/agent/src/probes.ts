import { execFile } from "node:child_process";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { connect } from "node:net";
import type { AgentProbeTask } from "@netpulse/contracts";
import { validateHost, validateHttpTarget } from "./target.js";

export type AgentProbeResult = { success: boolean; latencyMs: number | null; statusCode?: number; errorCode?: string; errorMessage?: string };
const elapsed = (started: number) => Math.max(0, Math.round(performance.now() - started));

async function probeHttp(task: AgentProbeTask, signal: AbortSignal, allowLoopback: boolean, redirects = 0): Promise<AgentProbeResult> {
  const target = await validateHttpTarget(task.url, allowLoopback);
  const started = performance.now();
  return new Promise((resolve) => {
    const request = (target.url.protocol === "https:" ? httpsRequest : httpRequest)(target.url, {
      method: "GET", signal, timeout: task.timeoutMs,
      lookup: (_hostname, options, callback) => {
        const family = target.address.includes(":") ? 6 : 4;
        if (typeof options === "object" && options.all) callback(null, [{ address: target.address, family }]);
        else callback(null, target.address, family);
      },
      headers: { "user-agent": "NetPulse-Agent/0.1", accept: "*/*" },
    }, (response) => {
      const status = response.statusCode ?? 0;
      const location = response.headers.location;
      response.resume();
      if (location && [301, 302, 303, 307, 308].includes(status) && redirects < 3) {
        void probeHttp({ ...task, url: new URL(location, target.url).toString() }, signal, allowLoopback, redirects + 1).then(resolve).catch((error) => resolve(failure(error, started)));
        return;
      }
      resolve({ success: status >= 200 && status < 400, latencyMs: elapsed(started), statusCode: status, ...(status >= 400 ? { errorCode: "HTTP_STATUS", errorMessage: `HTTP ${status}` } : {}) });
    });
    request.once("timeout", () => request.destroy(new Error("Probe timed out")));
    request.once("error", (error) => resolve(failure(error, started)));
    request.end();
  });
}

function failure(error: unknown, started: number): AgentProbeResult {
  const message = error instanceof Error ? error.message : "Probe failed";
  return { success: false, latencyMs: elapsed(started), errorCode: error instanceof Error && error.name === "AbortError" ? "CANCELLED" : /timed out/i.test(message) ? "TIMEOUT" : "PROBE_FAILED", errorMessage: message.slice(0, 500) };
}

async function probeTcp(task: AgentProbeTask, signal: AbortSignal, allowLoopback: boolean): Promise<AgentProbeResult> {
  const host = task.host ?? task.url;
  const port = task.port ?? 0;
  const target = await validateHost(host, allowLoopback);
  const started = performance.now();
  return new Promise((resolve) => {
    const socket = connect({ host: target.address, port, timeout: task.timeoutMs, signal });
    socket.once("connect", () => { socket.destroy(); resolve({ success: true, latencyMs: elapsed(started) }); });
    socket.once("timeout", () => socket.destroy(new Error("Probe timed out")));
    socket.once("error", (error) => resolve(failure(error, started)));
  });
}

async function probeIcmp(task: AgentProbeTask, signal: AbortSignal, allowLoopback: boolean): Promise<AgentProbeResult> {
  const host = task.host ?? task.url;
  await validateHost(host, allowLoopback);
  const started = performance.now();
  const timeoutSeconds = Math.max(1, Math.ceil(task.timeoutMs / 1000));
  const args = process.platform === "win32" ? ["-n", "1", "-w", String(task.timeoutMs), host] : ["-c", "1", "-W", String(timeoutSeconds), host];
  return new Promise((resolve) => execFile("ping", args, { timeout: task.timeoutMs + 500, signal, windowsHide: true }, (error) => resolve(error ? failure(error, started) : { success: true, latencyMs: elapsed(started) })));
}

export async function executeTask(task: AgentProbeTask, signal: AbortSignal, allowLoopback = false) {
  if (new Date(task.expiresAt).getTime() <= Date.now()) return { success: false, latencyMs: null, errorCode: "TASK_EXPIRED", errorMessage: "Task expired before execution" };
  const controller = new AbortController();
  const cancel = () => controller.abort();
  if (signal.aborted) cancel();
  else signal.addEventListener("abort", cancel, { once: true });
  const timeout = new Promise<AgentProbeResult>((resolve) => {
    const timer = setTimeout(() => {
      controller.abort();
      resolve({ success: false, latencyMs: task.timeoutMs, errorCode: "TIMEOUT", errorMessage: "Probe timed out" });
    }, task.timeoutMs);
    controller.signal.addEventListener("abort", () => clearTimeout(timer), { once: true });
  });
  try {
    const execution = task.kind === "HTTP" ? probeHttp(task, controller.signal, allowLoopback)
      : task.kind === "TCP" ? probeTcp(task, controller.signal, allowLoopback)
        : task.kind === "ICMP" ? probeIcmp(task, controller.signal, allowLoopback)
          : Promise.resolve({ success: false, latencyMs: null, errorCode: "UNSUPPORTED_CAPABILITY", errorMessage: "Unsupported task kind" } satisfies AgentProbeResult);
    return await Promise.race([execution, timeout]);
  } catch (error) { return failure(error, performance.now()); }
  finally { controller.abort(); signal.removeEventListener("abort", cancel); }
}
