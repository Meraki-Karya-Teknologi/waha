import axios from 'axios';
import * as dns from 'dns';
// @ts-ignore
import * as UserAgent from 'user-agents';

/**
 * Meraki patch (CVE-2026-6979, SSRF): reject fetches to internal/private
 * network ranges so a caller can't make the server proxy requests to
 * localhost, RFC1918 ranges, link-local, or cloud metadata endpoints.
 */
function isPrivateAddress(ip: string): boolean {
  if (ip === '::1' || ip.startsWith('fe80:') || ip.startsWith('fc') || ip.startsWith('fd')) {
    return true;
  }
  const parts = ip.split('.').map(Number);
  if (parts.length !== 4 || parts.some((p) => Number.isNaN(p))) {
    return false; // not IPv4, other IPv6 handled above/allowed
  }
  const [a, b] = parts;
  return (
    a === 127 || // loopback
    a === 10 || // 10.0.0.0/8
    (a === 172 && b >= 16 && b <= 31) || // 172.16.0.0/12
    (a === 192 && b === 168) || // 192.168.0.0/16
    (a === 169 && b === 254) || // 169.254.0.0/16 (incl. cloud metadata)
    a === 0
  );
}

async function assertPublicUrl(url: string): Promise<void> {
  const parsed = new URL(url);
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error(`Refusing to fetch non-http(s) URL: ${parsed.protocol}`);
  }
  const { address } = await dns.promises.lookup(parsed.hostname);
  if (isPrivateAddress(address)) {
    throw new Error(
      `Refusing to fetch URL that resolves to a private address: ${parsed.hostname} -> ${address}`,
    );
  }
  // ponytail: checked here, not pinned into the connection -> a DNS answer
  // that changes between this check and the actual request (rebinding)
  // could still slip through. Upgrade path: resolve once and connect to
  // the validated IP directly (custom `lookup`/agent) instead of re-resolving.
}

export async function fetchBuffer(url: string): Promise<Buffer> {
  await assertPublicUrl(url);
  const userAgent = new UserAgent();
  return axios
    .get(url, {
      responseType: 'arraybuffer',
      headers: {
        'User-Agent': userAgent.toString(),
      },
    })
    .then((res) => {
      return Buffer.from(res.data);
    });
}
