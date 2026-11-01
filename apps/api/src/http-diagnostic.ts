import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import type { IncomingMessage } from "node:http";
import type { Socket } from "node:net";
import { isIP } from "node:net";
import type { TLSSocket } from "node:tls";
import type { HttpDiagnosticResult, HttpRedirect } from "@netpulse/contracts";
import type { ResolveTarget } from "./target.js";
import { pinnedLookup, validateHttpTarget } from "./target.js";

type ValidatedTarget = Awaited<ReturnType<ResolveTarget>>;
type Exchange = {
  statusCode: number;
  location: string | null;
  responseBytes: number;
  responseTruncated: boolean;
  httpVersion: string;
  remoteAddress: string;
  tcpConnectMs: number;
  tlsHandshakeMs: number | null;
  timeToFirstByteMs: number;
  totalMs: number;
};
type ExecuteRequest = (target: ValidatedTarget, timeoutMs: number, maxResponseBytes: number, signal?: AbortSignal) => Promise<Exchange>;

async function validateWithinDeadline(validate: ResolveTarget, url: string, timeoutMs: number, signal?: AbortSignal) {
  return new Promise<ValidatedTarget>((resolve, reject) => {
    let settled = false;
    const finish = (error?: Error, target?: ValidatedTarget) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
      if (error) reject(error);
      else if (target) resolve(target);
    };
    const abort = () => finish(new Error("HTTP diagnostic cancelled"));
    const timer = setTimeout(() => finish(new Error("HTTP diagnostic timed out")), timeoutMs);
    signal?.addEventListener("abort", abort, { once: true });
    if (signal?.aborted) {
      abort();
      return;
    }
    validate(url).then((target) => finish(undefined, target), (error) => finish(error instanceof Error ? error : new Error("HTTP target validation failed")));
  });
}

function consume(response: IncomingMessage, maxResponseBytes: number, signal?: AbortSignal) {
  return new Promise<{ bytes: number; truncated: boolean }>((resolve, reject) => {
    let bytes = 0;
    let settled = false;
    const abort = () => response.destroy(new Error("HTTP diagnostic cancelled"));
    signal?.addEventListener("abort", abort, { once: true });
    const finish = (error?: Error, truncated = false) => {
      if (settled) return;
      settled = true;
      signal?.removeEventListener("abort", abort);
      if (error) reject(error);
      else resolve({ bytes, truncated });
    };
    response.on("data", (chunk: Buffer) => {
      bytes += chunk.length;
      if (bytes > maxResponseBytes) {
        response.destroy();
        finish(undefined, true);
      }
    });
    response.once("end", () => finish());
    response.once("error", (error) => finish(error));
  });
}

export async function executeHttpRequest(
  target: ValidatedTarget,
  timeoutMs: number,
  maxResponseBytes: number,
  signal?: AbortSignal,
  tlsOptions: { ca?: string | Buffer } = {},
): Promise<Exchange> {
  const url = new URL(target.url);
  const hostname = url.hostname.replace(/^\[|\]$/g, "");
  const request = url.protocol === "https:" ? httpsRequest : httpRequest;
  const started = performance.now();
  let tcpConnectedAt: number | null = null;
  let tlsConnectedAt: number | null = null;
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (error?: Error, value?: Exchange) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
      if (error) reject(error);
      else if (value) resolve(value);
    };
    const client = request({
      protocol: url.protocol,
      hostname,
      port: url.port || undefined,
      path: `${url.pathname}${url.search}`,
      method: "GET",
      headers: { host: url.host, "user-agent": "NetPulse-Diagnostic/1.0", accept: "*/*" },
      servername: isIP(hostname) ? undefined : hostname,
      ca: tlsOptions.ca,
      timeout: timeoutMs,
      lookup: pinnedLookup(target.address),
    }, async (response) => {
      const firstByteAt = performance.now();
      try {
        const body = await consume(response, maxResponseBytes, signal);
        const completed = performance.now();
        finish(undefined, {
          statusCode: response.statusCode ?? 0,
          location: typeof response.headers.location === "string" ? response.headers.location : null,
          responseBytes: Math.min(body.bytes, maxResponseBytes),
          responseTruncated: body.truncated,
          httpVersion: response.httpVersion,
          remoteAddress: target.address,
          tcpConnectMs: Math.max(0, Math.round((tcpConnectedAt ?? firstByteAt) - started)),
          tlsHandshakeMs: url.protocol === "https:" ? Math.max(0, Math.round((tlsConnectedAt ?? firstByteAt) - (tcpConnectedAt ?? started))) : null,
          timeToFirstByteMs: Math.max(0, Math.round(firstByteAt - started)),
          totalMs: Math.max(0, Math.round(completed - started)),
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : "";
        finish(new Error(message.includes("cancelled") ? "HTTP diagnostic cancelled" : "HTTP response could not be read"));
      }
    });
    const abort = () => client.destroy(new Error("HTTP diagnostic cancelled"));
    const timer = setTimeout(() => client.destroy(new Error("HTTP diagnostic timed out")), timeoutMs);
    signal?.addEventListener("abort", abort, { once: true });
    client.once("socket", (socket: Socket) => {
      socket.once("connect", () => { tcpConnectedAt = performance.now(); });
      if (url.protocol === "https:") (socket as TLSSocket).once("secureConnect", () => { tlsConnectedAt = performance.now(); });
    });
    client.once("error", (error) => {
      const message = error.message;
      finish(new Error(message.includes("cancelled")
        ? "HTTP diagnostic cancelled"
        : message.includes("timed out")
          ? "HTTP diagnostic timed out"
          : "HTTP connection could not be established"));
    });
    if (signal?.aborted) {
      abort();
      return;
    }
    client.end();
  });
}

export async function diagnoseHttp(
  rawUrl: string,
  options: { timeoutMs: number; maxRedirects: number; maxResponseBytes: number; signal?: AbortSignal },
  dependencies: { validate?: ResolveTarget; execute?: ExecuteRequest; now?: () => number } = {},
): Promise<{ result: HttpDiagnosticResult; durationMs: number }> {
  const validate = dependencies.validate ?? validateHttpTarget;
  const execute = dependencies.execute ?? executeHttpRequest;
  const now = dependencies.now ?? (() => performance.now());
  const started = now();
  const deadline = started + options.timeoutMs;
  let currentUrl = rawUrl;
  let totalDnsMs = 0;
  const redirects: HttpRedirect[] = [];

  for (;;) {
    if (options.signal?.aborted) throw new Error("HTTP diagnostic cancelled");
    const validationStarted = now();
    const validationRemainingMs = Math.max(1, Math.round(deadline - now()));
    if (validationRemainingMs <= 1) throw new Error("HTTP diagnostic timed out");
    const target = await validateWithinDeadline(validate, currentUrl, validationRemainingMs, options.signal);
    totalDnsMs += Math.max(0, Math.round(now() - validationStarted));
    const remainingMs = Math.max(1, Math.round(deadline - now()));
    if (remainingMs <= 1) throw new Error("HTTP diagnostic timed out");
    const exchange = await execute(target, remainingMs, options.maxResponseBytes, options.signal);
    const isRedirect = exchange.statusCode >= 300 && exchange.statusCode < 400 && exchange.location;
    if (!isRedirect) {
      const durationMs = Math.max(0, Math.round(now() - started));
      return {
        result: {
          kind: "HTTP",
          requestedUrl: rawUrl,
          finalUrl: target.url,
          method: "GET",
          statusCode: exchange.statusCode,
          redirectCount: redirects.length,
          redirects,
          responseBytes: exchange.responseBytes,
          responseTruncated: exchange.responseTruncated,
          httpVersion: exchange.httpVersion,
          remoteAddress: exchange.remoteAddress,
          timings: {
            dnsLookupMs: totalDnsMs,
            tcpConnectMs: exchange.tcpConnectMs,
            tlsHandshakeMs: exchange.tlsHandshakeMs,
            timeToFirstByteMs: exchange.timeToFirstByteMs,
            totalMs: durationMs,
          },
        },
        durationMs,
      };
    }
    if (redirects.length >= options.maxRedirects) throw new Error("HTTP redirect limit exceeded");
    const nextUrl = new URL(exchange.location!, target.url).toString();
    redirects.push({ statusCode: exchange.statusCode, from: target.url, to: nextUrl });
    currentUrl = nextUrl;
  }
}
