import * as dns from 'dns';

jest.mock('dns', () => ({
  promises: { lookup: jest.fn() },
}));

// re-import after mocking so fetchBuffer picks up the mocked dns module
import { fetchBuffer } from './fetch';

describe('fetchBuffer SSRF guard (CVE-2026-6979)', () => {
  const lookup = dns.promises.lookup as jest.Mock;

  afterEach(() => jest.clearAllMocks());

  it('rejects URLs resolving to private/internal addresses', async () => {
    lookup.mockResolvedValue({ address: '169.254.169.254' });
    await expect(fetchBuffer('http://metadata.example/')).rejects.toThrow(
      /private address/,
    );
  });

  it('rejects loopback', async () => {
    lookup.mockResolvedValue({ address: '127.0.0.1' });
    await expect(fetchBuffer('http://localhost:3000/')).rejects.toThrow(
      /private address/,
    );
  });

  it('rejects non-http(s) protocols before any DNS lookup', async () => {
    await expect(fetchBuffer('file:///etc/passwd')).rejects.toThrow(
      /non-http/,
    );
    expect(lookup).not.toHaveBeenCalled();
  });
});
