import { promises as dns } from "dns";
import { isIP } from "net";

// Alert rules let a caller register a URL that this server later calls on a timer
// (checkAlerts). Without this check, that's an SSRF primitive: an attacker can point
// webhook_url at an internal service or a cloud metadata endpoint and have the server
// make the request on their behalf. We block at both rule-creation time (fail fast)
// and right before each fetch (defense against DNS rebinding between the two).

const BLOCKED_HOSTNAMES = new Set(["localhost"]);

function isPrivateIPv4(ip: string): boolean {
  const parts = ip.split(".").map(Number);
  if (parts.length !== 4 || parts.some((p) => Number.isNaN(p))) return true;
  const [a, b] = parts;
  if (a === 10) return true;
  if (a === 127) return true;
  if (a === 169 && b === 254) return true; // link-local, includes cloud metadata IP
  if (a === 172 && b !== undefined && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 0) return true;
  return false;
}

function isPrivateIPv6(ip: string): boolean {
  const normalized = ip.toLowerCase();
  if (normalized === "::1") return true;
  if (normalized.startsWith("fc") || normalized.startsWith("fd")) return true; // unique local
  if (normalized.startsWith("fe80")) return true; // link-local
  if (normalized.startsWith("::ffff:")) return isPrivateIPv4(normalized.slice(7));
  return false;
}

export async function isSafeWebhookUrl(rawUrl: string): Promise<boolean> {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return false;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return false;
  if (BLOCKED_HOSTNAMES.has(parsed.hostname.toLowerCase())) return false;

  const version = isIP(parsed.hostname);
  if (version === 4) return !isPrivateIPv4(parsed.hostname);
  if (version === 6) return !isPrivateIPv6(parsed.hostname);

  try {
    const records = await dns.lookup(parsed.hostname, { all: true, verbatim: true });
    if (records.length === 0) return false;
    return records.every((r) =>
      r.family === 4 ? !isPrivateIPv4(r.address) : !isPrivateIPv6(r.address)
    );
  } catch {
    return false;
  }
}
