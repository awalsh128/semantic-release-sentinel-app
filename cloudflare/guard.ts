// Checks the Worker runs on a webhook before it wakes the container.
import { verify } from "@octokit/webhooks-methods";
import ipaddr from "ipaddr.js";

const decoder = new TextDecoder();

/**
 * Whether `header` is the valid `sha256=` HMAC of `body` under `secret`. GitHub signs the raw
 * body, so verify the same bytes that are then forwarded. Anything malformed is just invalid.
 */
export async function validSignature(
  secret: string,
  body: ArrayBuffer,
  header: string | null,
): Promise<boolean> {
  if (!header) return false;
  try {
    return await verify(secret, decoder.decode(body), header);
  } catch {
    return false; // the library throws on a malformed header or an empty body
  }
}

/** Whether `ip` (IPv4 or IPv6) is inside any of the CIDR `ranges`. Malformed input never matches. */
export function ipInRanges(ip: string, ranges: readonly string[]): boolean {
  if (!ipaddr.isValid(ip)) return false;
  const address = ipaddr.process(ip); // unwraps IPv4-mapped IPv6 such as ::ffff:1.2.3.4
  return ranges.some((range) => {
    try {
      const [base, bits] = ipaddr.parseCIDR(range);
      return base.kind() === address.kind() && address.match(base, bits);
    } catch {
      return false; // a malformed range
    }
  });
}
