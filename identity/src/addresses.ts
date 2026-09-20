import { isIPv4, isIPv6 } from "node:net";

/**
 * Directory registration makes the service fetch a URL an anonymous caller chose. Without a check
 * that is a probe into whatever network the service runs in, so every resolved address of a
 * candidate endpoint has to be a public unicast address before anything connects to it.
 */

export interface ResolvedAddress { address: string; family: number }
export type AddressLookup = (hostname: string) => Promise<readonly ResolvedAddress[]>;

function ipv4Private(octets: readonly number[]): boolean {
  const [a = 0, b = 0] = octets;
  return a === 0                                   // 0.0.0.0/8, including 0.0.0.0 itself
    || a === 10                                    // 10/8
    || a === 127                                   // loopback
    || (a === 100 && b >= 64 && b <= 127)          // 100.64/10 carrier grade NAT
    || (a === 169 && b === 254)                    // 169.254/16 link local
    || (a === 172 && b >= 16 && b <= 31)           // 172.16/12
    || (a === 192 && b === 168)                    // 192.168/16
    || a >= 224;                                   // multicast, reserved and broadcast
}

/** Expand any valid IPv6 text, including the `::ffff:10.0.0.1` forms, to eight groups. */
function ipv6Groups(value: string): number[] | null {
  let text = value.split("%")[0]!.toLowerCase();
  const embedded = /^(.*:)((?:\d{1,3}\.){3}\d{1,3})$/.exec(text);
  if (embedded) {
    const octets = embedded[2]!.split(".").map(Number);
    if (octets.some(part => !Number.isInteger(part) || part < 0 || part > 255)) return null;
    text = `${embedded[1]}${((octets[0]! << 8) | octets[1]!).toString(16)}:${((octets[2]! << 8) | octets[3]!).toString(16)}`;
  }
  const halves = text.split("::");
  if (halves.length > 2) return null;
  const groups = (part: string) => part ? part.split(":").map(group => /^[0-9a-f]{1,4}$/.test(group) ? parseInt(group, 16) : Number.NaN) : [];
  const head = groups(halves[0] ?? ""), tail = halves.length === 2 ? groups(halves[1] ?? "") : [];
  if ([...head, ...tail].some(Number.isNaN)) return null;
  const total = head.length + tail.length;
  if (halves.length === 2 ? total > 7 : total !== 8) return null;
  return [...head, ...Array.from({ length: 8 - total }, () => 0), ...tail];
}

/** True for anything that is not a routable public host: the whole refusal list in one place. */
export function privateAddress(address: string): boolean {
  if (isIPv4(address)) return ipv4Private(address.split(".").map(Number));
  if (!isIPv6(address)) return true;
  const groups = ipv6Groups(address);
  if (!groups) return true;
  const leadingZero = groups.slice(0, 5).every(group => group === 0);
  // ::ffff:a.b.c.d and the deprecated ::a.b.c.d both reach an IPv4 host, so judge them as IPv4.
  if (leadingZero && (groups[5] === 0xffff || groups[5] === 0)) {
    const mapped = [groups[6]! >> 8, groups[6]! & 0xff, groups[7]! >> 8, groups[7]! & 0xff];
    if (groups[5] === 0xffff) return ipv4Private(mapped);
    if (groups[6] === 0 && groups[7]! <= 1) return true;   // :: and ::1
    return ipv4Private(mapped);
  }
  const first = groups[0]!;
  return (first & 0xfe00) === 0xfc00       // fc00::/7 unique local
    || (first & 0xffc0) === 0xfe80         // fe80::/10 link local
    || (first & 0xff00) === 0xff00;        // ff00::/8 multicast
}

/**
 * Resolve a hostname and refuse the whole name when any address is private: a name with one
 * public and one internal address must not be usable to reach the internal one.
 */
export async function publicHost(hostname: string, lookup: AddressLookup): Promise<boolean> {
  const bare = hostname.startsWith("[") && hostname.endsWith("]") ? hostname.slice(1, -1) : hostname;
  let addresses: readonly ResolvedAddress[];
  try { addresses = await lookup(bare); } catch { return false; }
  return addresses.length > 0 && addresses.every(entry => !privateAddress(entry.address));
}
