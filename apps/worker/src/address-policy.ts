import { isIP } from "node:net";

function parseIpv4(address: string): number[] | null {
  if (isIP(address) !== 4) return null;
  const octets = address.split(".").map(Number);
  return octets.length === 4 ? octets : null;
}

function parseIpv6(address: string): number[] | null {
  if (isIP(address) !== 6 || address.includes("%")) return null;
  let normalized = address.toLowerCase();
  const dottedTail = /(?:^|:)(\d+\.\d+\.\d+\.\d+)$/.exec(normalized)?.[1];
  if (dottedTail !== undefined) {
    const octets = parseIpv4(dottedTail);
    if (octets === null) return null;
    const high = ((octets[0] ?? 0) << 8) | (octets[1] ?? 0);
    const low = ((octets[2] ?? 0) << 8) | (octets[3] ?? 0);
    normalized = `${normalized.slice(0, -dottedTail.length)}${high.toString(16)}:${low.toString(16)}`;
  }

  const halves = normalized.split("::");
  if (halves.length > 2) return null;
  const left = halves[0] === "" ? [] : halves[0]?.split(":") ?? [];
  const right = halves.length === 1 || halves[1] === "" ? [] : halves[1]?.split(":") ?? [];
  const missing = 8 - left.length - right.length;
  if ((halves.length === 1 && missing !== 0) || (halves.length === 2 && missing < 1)) {
    return null;
  }
  const groups = [...left, ...Array.from({ length: missing }, () => "0"), ...right];
  if (groups.length !== 8) return null;
  const bytes: number[] = [];
  for (const group of groups) {
    if (!/^[0-9a-f]{1,4}$/.test(group)) return null;
    const value = Number.parseInt(group, 16);
    bytes.push(value >>> 8, value & 0xff);
  }
  return bytes;
}

function isAllowedIpv4(address: string): boolean {
  const octets = parseIpv4(address);
  if (octets === null) return false;
  const [a = 0, b = 0] = octets;
  if (a === 0 || a === 10 || a === 127) return false;
  if (a === 100 && b >= 64 && b <= 127) return false;
  if (a === 169 && b === 254) return false;
  if (a === 172 && b >= 16 && b <= 31) return false;
  if (a === 192 && b === 168) return false;
  if (a === 192 && b === 0 && (octets[2] ?? 0) === 0) return false;
  if (a === 198 && (b === 18 || b === 19)) return false;
  return a < 224;
}

function isAllowedIpv6(address: string): boolean {
  const bytes = parseIpv6(address);
  if (bytes === null) return false;
  const isUnspecified = bytes.every((value) => value === 0);
  const isLoopback = bytes.slice(0, 15).every((value) => value === 0) && bytes[15] === 1;
  if (isUnspecified || isLoopback) return false;
  const first = bytes[0] ?? 0;
  const second = bytes[1] ?? 0;
  if (first === 0xff) return false;
  if ((first & 0xfe) === 0xfc) return false;
  if (first === 0xfe && (second & 0xc0) !== 0) return false;

  const isIpv4Mapped =
    bytes.slice(0, 10).every((value) => value === 0) &&
    bytes[10] === 0xff &&
    bytes[11] === 0xff;
  if (isIpv4Mapped) {
    return isAllowedIpv4(bytes.slice(12).join("."));
  }
  return true;
}

export function isAllowedAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 4) return isAllowedIpv4(address);
  if (family === 6) return isAllowedIpv6(address);
  return false;
}
