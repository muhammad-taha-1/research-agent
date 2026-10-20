import { lookup } from "node:dns/promises";
import ipaddr from "ipaddr.js";

/** The URL is outside what the agent may fetch (as opposed to a network failure). */
export class UnsafeUrlError extends Error {
  name = "UnsafeUrlError";
}

// SSRF guard: the agent picks the URLs read_webpage fetches, and pages can
// carry text written to steer it toward localhost, Redis, or cloud metadata.
// Known gap: fetch resolves DNS again after this check (DNS rebinding) — fine
// for a learning project; production would connect to the checked IP.
export async function assertSafeUrl(raw: string): Promise<URL> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new UnsafeUrlError("Not a valid URL");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new UnsafeUrlError("Only http(s) URLs are allowed");
  }
  if (url.port && !["80", "443"].includes(url.port)) {
    throw new UnsafeUrlError("Non-standard ports are not allowed");
  }

  // IPv6 literals come back bracketed ("[::1]"); lookup wants them bare.
  const host = url.hostname.replace(/^\[(.*)\]$/, "$1");

  // Resolve the hostname and reject anything that isn't a public unicast address.
  // A DNS failure propagates as a normal error: the host is unreachable, not forbidden.
  const addresses = await lookup(host, { all: true });
  for (const { address } of addresses) {
    // process() unwraps IPv4-mapped IPv6 (::ffff:127.0.0.1) so it's judged as IPv4
    if (ipaddr.process(address).range() !== "unicast") {
      throw new UnsafeUrlError("URL resolves to a private or reserved address");
    }
  }
  return url;
}
