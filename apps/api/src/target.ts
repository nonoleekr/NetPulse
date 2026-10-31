import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { config } from "./config.js";

const localAddresses = new Set(["127.0.0.1", "::1"]);
type ResolveAll = (
  hostname: string,
  options: { all: true; verbatim: true },
) => Promise<Array<{ address: string; family: number }>>;
export type ResolveTarget = (rawUrl: string) => Promise<{ url: string; address: string }>;

function ipv4FromMappedIpv6(address: string) {
  const normalized = address.toLowerCase();
  if (!normalized.startsWith("::ffff:")) return null;
  const suffix = normalized.slice("::ffff:".length);
  if (!suffix.includes(".")) return null;
  return suffix;
}

function isPrivateOrReserved(address: string) {
  if (address.includes(":")) {
    const normalized = address.toLowerCase();
    const mappedIpv4 = ipv4FromMappedIpv6(normalized);
    if (mappedIpv4) return isPrivateOrReserved(mappedIpv4);
    return normalized === "::"
      || normalized === "::1"
      || normalized.startsWith("ff")
      || normalized.startsWith("fc")
      || normalized.startsWith("fd")
      || /^fe[89ab]/.test(normalized);
  }

  const octets = address.split(".").map(Number);
  const [first, second] = octets;
  return first === 0
    || first === 10
    || (first === 100 && second >= 64 && second <= 127)
    || first === 127
    || (first === 169 && second === 254)
    || (first === 172 && second >= 16 && second <= 31)
    || (first === 192 && second === 0)
    || (first === 192 && second === 168)
    || (first === 198 && (second === 18 || second === 19))
    || first >= 224;
}

export async function validateHttpTarget(
  rawUrl: string,
  resolve: ResolveAll = lookup,
) {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error("Target must be a valid URL");
  }

  if (!["http:", "https:"].includes(url.protocol)) {
    throw new Error("Only HTTP and HTTPS URLs are supported");
  }
  if (url.username || url.password) {
    throw new Error("Target credentials are not supported");
  }
  if (url.port && (Number(url.port) < 1 || Number(url.port) > 65535)) {
    throw new Error("Target port must be between 1 and 65535");
  }
  if (url.pathname.length > 1024 || url.search.length > 1024) {
    throw new Error("Target URL is too long");
  }

  const addresses = isIP(url.hostname)
    ? [{ address: url.hostname }]
    : await resolve(url.hostname, { all: true, verbatim: true });
  if (!addresses.length) {
    throw new Error("Target hostname did not resolve");
  }

  const onlyLocal = addresses.every(({ address }) => localAddresses.has(address));
  if (onlyLocal && config.allowLocalTargets) return { url: url.toString(), address: addresses[0].address };
  if (addresses.some(({ address }) => isPrivateOrReserved(address))) {
    throw new Error("Private, loopback, and reserved targets are blocked");
  }
  return { url: url.toString(), address: addresses[0].address };
}
