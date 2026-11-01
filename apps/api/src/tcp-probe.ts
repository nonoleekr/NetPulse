import { connect, type Socket } from "node:net";
import { validateHost } from "./target.js";
import type { ProbeResult } from "./probe-types.js";

export async function probeTcp(
  host: string,
  port: number,
  timeoutMs: number,
  resolveHost: typeof validateHost = validateHost,
): Promise<ProbeResult> {
  const started = performance.now();
  let addresses: Array<{ address: string; family: number }>;
  try {
    addresses = await resolveHost(host);
  } catch (error) {
    return {
      success: false,
      latencyMs: null,
      errorCode: "DNS_ERROR",
      errorMessage: error instanceof Error ? error.message : "The target could not be resolved",
    };
  }

  return new Promise((resolve) => {
    let settled = false;
    let socket: Socket | undefined;
    let sawNonRefusalError = false;
    const finish = (result: ProbeResult) => {
      if (settled) return;
      settled = true;
      socket?.destroy();
      resolve(result);
    };
    const timer = setTimeout(() => finish({
      success: false,
      latencyMs: null,
      errorCode: "TIMEOUT",
      errorMessage: `Timed out after ${timeoutMs}ms`,
    }), timeoutMs);

    const connectNext = (index: number) => {
      if (index >= addresses.length) {
        clearTimeout(timer);
        finish({
          success: false,
          latencyMs: null,
          errorCode: sawNonRefusalError ? "NETWORK_ERROR" : "REFUSED",
          errorMessage: sawNonRefusalError ? "The TCP connection failed" : "The TCP connection was refused",
        });
        return;
      }
      const target = addresses[index];
      socket = connect({ host: target.address, port, family: target.family });
      socket.once("connect", () => {
        clearTimeout(timer);
        finish({
          success: true,
          latencyMs: Math.max(0, Math.round(performance.now() - started)),
        });
      });
      socket.once("error", (error) => {
        if ((error as NodeJS.ErrnoException).code !== "ECONNREFUSED") sawNonRefusalError = true;
        socket?.destroy();
        connectNext(index + 1);
      });
      socket.setTimeout(timeoutMs, () => finish({
        success: false,
        latencyMs: null,
        errorCode: "TIMEOUT",
        errorMessage: `Timed out after ${timeoutMs}ms`,
      }));
    };
    connectNext(0);
  });
}
