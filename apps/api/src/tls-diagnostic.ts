import { checkServerIdentity, connect as tlsConnect, type ConnectionOptions, type PeerCertificate, type TLSSocket } from "node:tls";
import { isIP } from "node:net";
import type { CertificateSummary, TlsDiagnosticResult } from "@netpulse/contracts";

type ValidatedTarget = { url: string; address: string };
type ConnectTls = (options: ConnectionOptions) => TLSSocket;

function firstName(value: string | string[] | undefined) {
  const selected = Array.isArray(value) ? value[0] : value;
  return selected ? selected.slice(0, 512) : null;
}

function safeAuthorizationError(value: Error | string | null) {
  if (!value) return null;
  if (typeof value === "string") return value.slice(0, 128);
  const code = (value as Error & { code?: string }).code;
  return code ?? "CERTIFICATE_NOT_AUTHORIZED";
}

function certificateSummary(certificate: PeerCertificate, currentTimeMs: number) {
  if (!certificate.valid_from || !certificate.valid_to) {
    throw new Error("TLS peer did not provide a complete certificate");
  }
  const validTo = new Date(certificate.valid_to);
  const validFrom = new Date(certificate.valid_from);
  if (Number.isNaN(validFrom.getTime()) || Number.isNaN(validTo.getTime())) {
    throw new Error("TLS peer provided invalid certificate dates");
  }
  const subjectAltNames = (certificate.subjectaltname ?? "")
    .split(/,\s*/)
    .filter(Boolean)
    .map((name) => name.slice(0, 512))
    .slice(0, 100);
  const validityStatus: CertificateSummary["validityStatus"] = currentTimeMs < validFrom.getTime()
    ? "NOT_YET_VALID"
    : currentTimeMs > validTo.getTime() ? "EXPIRED" : "VALID";
  return {
    subjectCommonName: firstName(certificate.subject?.CN),
    issuerCommonName: firstName(certificate.issuer?.CN),
    subjectAltNames,
    validFrom: validFrom.toISOString(),
    validTo: validTo.toISOString(),
    daysRemaining: Math.floor((validTo.getTime() - currentTimeMs) / 86_400_000),
    validityStatus,
    fingerprint256: certificate.fingerprint256?.slice(0, 128) ?? null,
    serialNumber: certificate.serialNumber?.slice(0, 128) ?? null,
  };
}

export async function diagnoseTls(
  target: ValidatedTarget,
  dnsLookupMs: number,
  timeoutMs: number,
  options: { signal?: AbortSignal; connect?: ConnectTls; now?: () => number; currentTime?: () => number } = {},
): Promise<{ result: TlsDiagnosticResult; durationMs: number }> {
  const url = new URL(target.url);
  if (url.protocol !== "https:") throw new Error("TLS diagnostics require an HTTPS monitor");
  const hostname = url.hostname.replace(/^\[|\]$/g, "");
  const port = url.port ? Number(url.port) : 443;
  const now = options.now ?? (() => performance.now());
  const started = now();
  const connectTls = options.connect ?? tlsConnect;

  return new Promise((resolve, reject) => {
    let tcpConnectedAt: number | null = null;
    let settled = false;
    const socket = connectTls({
      host: target.address,
      port,
      servername: isIP(hostname) ? undefined : hostname,
      rejectUnauthorized: false,
    });
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      options.signal?.removeEventListener("abort", abort);
      if (!socket.destroyed) socket.destroy();
      if (error) reject(error);
    };
    const abort = () => finish(new Error("TLS diagnostic cancelled"));
    const timer = setTimeout(() => finish(new Error("TLS diagnostic timed out")), timeoutMs);
    options.signal?.addEventListener("abort", abort, { once: true });
    if (options.signal?.aborted) {
      abort();
      return;
    }
    socket.once("connect", () => { tcpConnectedAt = now(); });
    socket.once("secureConnect", () => {
      if (settled) return;
      try {
        const completed = now();
        const peerCertificate = socket.getPeerCertificate();
        const certificate = certificateSummary(peerCertificate, (options.currentTime ?? Date.now)());
        const hostnameError = checkServerIdentity(hostname, peerCertificate);
        settled = true;
        clearTimeout(timer);
        options.signal?.removeEventListener("abort", abort);
        const cipher = socket.getCipher();
        if (!socket.destroyed) socket.destroy();
        resolve({
          result: {
            kind: "TLS",
            hostname,
            port,
            authorized: socket.authorized,
            authorizationError: safeAuthorizationError(socket.authorizationError),
            hostnameMatched: !hostnameError,
            hostnameError: safeAuthorizationError(hostnameError ?? null),
            protocol: socket.getProtocol(),
            cipher: cipher?.name ?? null,
            alpnProtocol: socket.alpnProtocol || null,
            certificate,
            timings: {
              dnsLookupMs,
              tcpConnectMs: Math.max(0, Math.round((tcpConnectedAt ?? completed) - started)),
              tlsHandshakeMs: Math.max(0, Math.round(completed - (tcpConnectedAt ?? started))),
              totalMs: Math.max(0, Math.round(dnsLookupMs + completed - started)),
            },
          },
          durationMs: Math.max(0, Math.round(dnsLookupMs + completed - started)),
        });
      } catch (error) {
        finish(error instanceof Error ? error : new Error("TLS certificate inspection failed"));
      }
    });
    socket.once("error", () => finish(new Error("TLS connection could not be established")));
  });
}
