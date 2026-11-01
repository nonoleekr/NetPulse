import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

export function isPrivateOrReserved(address: string) {
  const normalized = address.toLowerCase();
  if (normalized.includes(":")) {
    if (normalized.startsWith("::ffff:")) {
      const suffix = normalized.slice(7);
      if (suffix.includes(".")) return isPrivateOrReserved(suffix);
      const words = suffix.split(":");
      if (words.length !== 2 || words.some((word) => !/^[0-9a-f]{1,4}$/.test(word))) return true;
      const value = Number.parseInt(words[0], 16) * 0x10000 + Number.parseInt(words[1], 16);
      return isPrivateOrReserved(`${value >>> 24}.${(value >>> 16) & 0xff}.${(value >>> 8) & 0xff}.${value & 0xff}`);
    }
    return normalized === "::" || normalized === "::1" || normalized.startsWith("fc") || normalized.startsWith("fd") || normalized.startsWith("ff") || /^fe[89ab]/.test(normalized);
  }
  const octets = normalized.split(".").map(Number);
  if (octets.length !== 4 || octets.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return true;
  const [first, second] = octets;
  return first === 0 || first === 10 || first === 127 || (first === 100 && second >= 64 && second <= 127) || (first === 169 && second === 254) || (first === 172 && second >= 16 && second <= 31) || (first === 192 && (second === 0 || second === 168)) || (first === 198 && (second === 18 || second === 19)) || first >= 224;
}

export async function validateHost(host: string, allowLoopback = false) {
  const clean = host.replace(/^\[|\]$/g, "");
  const addresses = isIP(clean) ? [{ address: clean, family: clean.includes(":") ? 6 : 4 }] : await lookup(clean, { all: true, verbatim: true });
  if (!addresses.length) throw new Error("Target hostname did not resolve");
  for (const { address } of addresses) {
    if (allowLoopback && ["127.0.0.1", "::1"].includes(address)) continue;
    if (isPrivateOrReserved(address)) throw new Error("Private, loopback, and reserved targets are blocked");
  }
  return addresses[0];
}

export async function validateHttpTarget(raw: string, allowLoopback = false) {
  const url = new URL(raw);
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) throw new Error("Only credential-free HTTP(S) targets are supported");
  if (url.pathname.length > 1024 || url.search.length > 1024) throw new Error("Target URL is too long");
  return { url, address: (await validateHost(url.hostname, allowLoopback)).address };
}
