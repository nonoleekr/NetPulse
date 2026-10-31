import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import type { IncomingMessage } from "node:http";
import { validateHttpTarget } from "./target.js";
import { config } from "./config.js";
import type { ResolveTarget } from "./target.js";
import type { ProbeResult } from "./probe-types.js";
export type { ProbeResult } from "./probe-types.js";

function isTimeoutError(error: unknown) {
  return error instanceof Error && (error.name === "AbortError" || error.message === "Probe timed out");
}

function consumeResponse(response: IncomingMessage, timeoutMs: number) {
  return new Promise<{ statusCode: number; tooLarge: boolean }>((resolve, reject) => {
    let totalBytes = 0;
    let settled = false;
    const timer = setTimeout(() => {
      response.destroy(new Error("Probe timed out"));
    }, timeoutMs);

    response.on("data", (chunk: Buffer) => {
      totalBytes += chunk.length;
      if (totalBytes > config.maxResponseBytes) {
        response.destroy();
        settled = true;
        clearTimeout(timer);
        resolve({ statusCode: response.statusCode ?? 0, tooLarge: true });
      }
    });
    response.on("end", () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ statusCode: response.statusCode ?? 0, tooLarge: false });
    });
    response.on("error", (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(error);
    });
  });
}

async function requestValidatedUrl(
  target: { url: string; address: string },
  timeoutMs: number,
) {
  const url = new URL(target.url);
  const request = url.protocol === "https:" ? httpsRequest : httpRequest;
  const family = target.address.includes(":") ? 6 : 4;

  return new Promise<{ statusCode: number; tooLarge: boolean }>((resolve, reject) => {
    const timer = setTimeout(() => {
      client.destroy(new Error("Probe timed out"));
    }, timeoutMs);
    const client = request({
      protocol: url.protocol,
      hostname: url.hostname,
      port: url.port || undefined,
      path: `${url.pathname}${url.search}`,
      method: "GET",
      headers: { host: url.host },
      servername: url.hostname,
      timeout: timeoutMs,
      lookup: (_hostname, _options, callback) => callback(null, target.address, family),
    }, (response) => {
      consumeResponse(response, timeoutMs).then(resolve, reject);
    });
    client.once("error", reject);
    client.once("close", () => clearTimeout(timer));
    client.end();
  });
}

export async function probeHttp(
  url: string,
  timeoutMs: number,
  validate: ResolveTarget = validateHttpTarget,
): Promise<ProbeResult> {
  const started = performance.now();
  let validationTimer: NodeJS.Timeout | undefined;
  try {
    const target = await Promise.race([
      validate(url),
      new Promise<never>((_, reject) => {
        validationTimer = setTimeout(() => reject(new Error("Probe timed out")), timeoutMs);
      }),
    ]);
    if (validationTimer) clearTimeout(validationTimer);
    const result = await requestValidatedUrl(target, timeoutMs);
    const latencyMs = Math.max(0, Math.round(performance.now() - started));
    return {
      success: result.statusCode >= 200 && result.statusCode < 400 && !result.tooLarge,
      latencyMs,
      statusCode: result.statusCode,
      ...(result.tooLarge
        ? { errorCode: "RESPONSE_TOO_LARGE", errorMessage: "Response exceeded the configured size limit" }
        : result.statusCode >= 400
          ? { errorCode: "HTTP_STATUS", errorMessage: `HTTP ${result.statusCode}` }
          : {}),
    };
  } catch (error) {
    if (validationTimer) clearTimeout(validationTimer);
    const timeout = isTimeoutError(error);
    return {
      success: false,
      latencyMs: null,
      errorCode: timeout ? "TIMEOUT" : "NETWORK_ERROR",
      errorMessage: timeout ? `Timed out after ${timeoutMs}ms` : "The request could not be completed",
    };
  }
}
