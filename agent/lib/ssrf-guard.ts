/**
 * Hardened HTTPS-only SSRF guard with IPv4, IPv6, IPv4-mapped, NAT64, and DNS resolution checks.
 * Shared by `agent/extensions/media-reviewer.ts` and offline security regression tests.
 */

import dns from "node:dns/promises";
import net from "node:net";

function isPrivateOrReservedIpv4(ip: string): boolean {
  const parts = ip.split(".");
  if (parts.length !== 4) return true;
  const octets = parts.map((p) => Number(p));
  if (octets.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return true;
  const [a, b, c] = octets;
  if (a === 0) return true; // 0.0.0.0/8
  if (a === 10) return true; // 10.0.0.0/8
  if (a === 100 && b >= 64 && b <= 127) return true; // 100.64.0.0/10
  if (a === 127) return true; // 127.0.0.0/8
  if (a === 169 && b === 254) return true; // 169.254.0.0/16
  if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12
  if (a === 192 && b === 0 && c === 0) return true; // 192.0.0.0/24
  if (a === 192 && b === 0 && c === 2) return true; // 192.0.2.0/24
  if (a === 192 && b === 168) return true; // 192.168.0.0/16
  if (a === 198 && (b === 18 || b === 19)) return true; // 198.18.0.0/15
  if (a === 198 && b === 51 && c === 100) return true; // 198.51.100.0/24
  if (a === 203 && b === 0 && c === 113) return true; // 203.0.113.0/24
  if (a >= 224) return true; // 224.0.0.0/4 multicast + 240.0.0.0/4 reserved
  return false;
}

function parseIpv6Groups(rawIp: string): number[] | null {
  const noZone = rawIp.split("%")[0].toLowerCase();
  const halves = noZone.split("::");
  if (halves.length > 2) return null;

  const parseSide = (side: string): number[] | null => {
    if (!side) return [];
    const tokens = side.split(":");
    const out: number[] = [];
    for (let i = 0; i < tokens.length; i++) {
      const tok = tokens[i];
      if (!tok) return null;
      if (tok.includes(".")) {
        if (i !== tokens.length - 1) return null;
        const v4 = tok.split(".").map((p) => Number(p));
        if (v4.length !== 4 || v4.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return null;
        out.push((v4[0] << 8) | v4[1], (v4[2] << 8) | v4[3]);
      } else {
        if (!/^[0-9a-f]{1,4}$/.test(tok)) return null;
        out.push(Number.parseInt(tok, 16));
      }
    }
    return out;
  };

  const left = parseSide(halves[0]);
  if (!left) return null;
  if (halves.length === 1) {
    return left.length === 8 ? left : null;
  }
  const right = parseSide(halves[1]);
  if (!right) return null;
  const missing = 8 - (left.length + right.length);
  if (missing < 1) return null;
  return [...left, ...new Array<number>(missing).fill(0), ...right];
}

export function isPrivateOrReservedIp(ip: string): boolean {
  const clean = ip.trim().replace(/^\[|\]$/g, "").split("%")[0];
  const kind = net.isIP(clean);
  if (kind === 4) {
    return isPrivateOrReservedIpv4(clean);
  }
  if (kind === 6) {
    const g = parseIpv6Groups(clean);
    if (!g) return true;
    const isAllZeroPrefix = g[0] === 0 && g[1] === 0 && g[2] === 0 && g[3] === 0 && g[4] === 0;
    // Unspecified (::) and loopback (::1)
    if (isAllZeroPrefix && g[5] === 0 && g[6] === 0 && (g[7] === 0 || g[7] === 1)) return true;
    // IPv4-compatible (::/96)
    if (isAllZeroPrefix && g[5] === 0) return true;
    // IPv4-mapped (::ffff:0:0/96) -> validate embedded IPv4
    if (isAllZeroPrefix && g[5] === 0xffff) {
      const v4 = `${g[6] >> 8}.${g[6] & 0xff}.${g[7] >> 8}.${g[7] & 0xff}`;
      return isPrivateOrReservedIpv4(v4);
    }
    // NAT64 (64:ff9b::/96)
    if (g[0] === 0x0064 && g[1] === 0xff9b && g[2] === 0 && g[3] === 0 && g[4] === 0 && g[5] === 0) return true;
    // Unique local (fc00::/7)
    if ((g[0] & 0xfe00) === 0xfc00) return true;
    // Link-local (fe80::/10)
    if ((g[0] & 0xffc0) === 0xfe80) return true;
    // Site-local (fec0::/10)
    if ((g[0] & 0xffc0) === 0xfec0) return true;
    // Multicast (ff00::/8)
    if ((g[0] & 0xff00) === 0xff00) return true;
    // Documentation (2001:db8::/32)
    if (g[0] === 0x2001 && g[1] === 0x0db8) return true;
    return false;
  }
  return true;
}

export async function assertSafePublicHttpsUrl(
  rawUrl: string,
  lookupFn: (host: string) => Promise<Array<{ address: string }>> = (host) =>
    dns.lookup(host, { all: true, verbatim: true })
): Promise<URL> {
  const u = new URL(rawUrl);
  if (u.protocol !== "https:") {
    throw new Error("Thumbnail URL must use https://");
  }
  if (u.username || u.password) {
    throw new Error("Thumbnail URL must not include credentials");
  }
  const host = u.hostname.toLowerCase().replace(/^\[|\]$/g, "").replace(/\.+$/, "");
  if (
    !host ||
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host.endsWith(".local") ||
    host.endsWith(".internal")
  ) {
    throw new Error(`Refused private/internal thumbnail host: ${host || "(empty)"}`);
  }

  if (net.isIP(host) !== 0) {
    if (isPrivateOrReservedIp(host)) {
      throw new Error(`Refused private/reserved thumbnail IP: ${host}`);
    }
    return u;
  }

  const records = await lookupFn(host);
  if (!records || records.length === 0) {
    throw new Error(`Thumbnail host resolved to no addresses: ${host}`);
  }
  for (const rec of records) {
    if (isPrivateOrReservedIp(rec.address)) {
      throw new Error(`Refused private/reserved resolved IP (${rec.address}) for host ${host}`);
    }
  }
  return u;
}
