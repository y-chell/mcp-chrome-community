import { describe, expect, test } from '@jest/globals';
import Fastify from 'fastify';
import {
  DEFAULT_CHROME_EXTENSION_ORIGIN,
  DEFAULT_MCP_HTTP_RATE_LIMIT_PER_MINUTE,
  FixedWindowRateLimiter,
  createMcpHttpSecurityGuard,
  isLoopbackRemoteAddress,
  isMcpTransportPath,
  parseMcpHostHeader,
  parseMcpHttpSecurityConfig,
  validateMcpHttpSecurityConfig,
  type CreateMcpHttpSecurityGuardOptions,
  type McpHttpSecurityConfig,
} from './mcp-http-security';

const REMOTE_TOKEN = '0123456789abcdef';

describe('MCP HTTP security configuration', () => {
  test('identifies MCP paths and loopback clients for shared-listener isolation', () => {
    expect(isMcpTransportPath('/mcp')).toBe(true);
    expect(isMcpTransportPath('/messages?sessionId=abc')).toBe(true);
    expect(isMcpTransportPath('/agent/projects')).toBe(false);
    expect(isLoopbackRemoteAddress('127.0.0.1')).toBe(true);
    expect(isLoopbackRemoteAddress('::1')).toBe(true);
    expect(isLoopbackRemoteAddress('::ffff:127.0.0.1')).toBe(true);
    expect(isLoopbackRemoteAddress('192.168.1.25')).toBe(false);
  });

  test('keeps loopback listeners compatible without a token', () => {
    const config = parseMcpHttpSecurityConfig({ listenHost: '127.0.0.1', env: {} });

    expect(() => validateMcpHttpSecurityConfig(config)).not.toThrow();
    expect(config.authToken).toBeUndefined();
    expect(config.rateLimitPerMinute).toBe(DEFAULT_MCP_HTTP_RATE_LIMIT_PER_MINUTE);
    expect([...config.allowedHosts]).toEqual(
      expect.arrayContaining(['localhost', '127.0.0.1', '[::1]']),
    );
    expect([...config.allowedOrigins]).toContain(DEFAULT_CHROME_EXTENSION_ORIGIN);
  });

  test.each([
    ['::1', '::1'],
    ['[::1]', '::1'],
  ])('keeps IPv6 listen addresses unbracketed for Fastify: %s', (input, expected) => {
    const config = parseMcpHttpSecurityConfig({ listenHost: input, env: {} });

    expect(config.listenHost).toBe(expected);
    expect(config.isLoopbackListener).toBe(true);
    expect(config.allowedHosts.has('[::1]')).toBe(true);
    expect(() => validateMcpHttpSecurityConfig(config)).not.toThrow();
  });

  test('rejects remote listeners without a sufficiently long token', () => {
    const missingToken = parseMcpHttpSecurityConfig({
      listenHost: '192.168.10.20',
      env: {},
    });
    const shortToken = parseMcpHttpSecurityConfig({
      listenHost: '192.168.10.20',
      env: { CHROME_MCP_AUTH_TOKEN: 'too-short' },
    });

    expect(() => validateMcpHttpSecurityConfig(missingToken)).toThrow(/require.*AUTH_TOKEN/i);
    expect(() => validateMcpHttpSecurityConfig(shortToken)).toThrow(/at least 16/i);
  });

  test('supports legacy token and rate-limit environment variables', () => {
    const config = parseMcpHttpSecurityConfig({
      listenHost: '192.168.10.20',
      env: {
        MCP_HTTP_AUTH_TOKEN: REMOTE_TOKEN,
        MCP_HTTP_RATE_LIMIT_PER_MINUTE: '45',
      },
    });

    expect(() => validateMcpHttpSecurityConfig(config)).not.toThrow();
    expect(config.authToken).toBe(REMOTE_TOKEN);
    expect(config.rateLimitPerMinute).toBe(45);
    expect(config.allowedHosts.has('192.168.10.20')).toBe(true);
  });

  test('converts configured extension IDs into exact allowed origins', () => {
    const extensionId = 'abcdefghijklmnopabcdefghijklmnop';
    const legacyExtensionId = 'ponmlkjihgfedcbaponmlkjihgfedcba';
    const config = parseMcpHttpSecurityConfig({
      listenHost: '127.0.0.1',
      env: {
        CHROME_EXTENSION_IDS: extensionId,
        CHROME_EXTENSION_ID: legacyExtensionId,
      },
    });

    expect(config.allowedOrigins.has(`chrome-extension://${extensionId}`)).toBe(true);
    expect(config.allowedOrigins.has(`chrome-extension://${legacyExtensionId}`)).toBe(false);
    expect(() =>
      parseMcpHttpSecurityConfig({
        listenHost: '127.0.0.1',
        env: { CHROME_EXTENSION_IDS: 'not-an-extension-id' },
      }),
    ).toThrow(/Invalid Chrome extension ID/);
  });

  test.each(['0.0.0.0', '::'])(
    'requires explicit allowed hosts for wildcard listener %s',
    (host) => {
      const config = parseMcpHttpSecurityConfig({
        listenHost: host,
        env: { CHROME_MCP_AUTH_TOKEN: REMOTE_TOKEN },
      });

      expect(() => validateMcpHttpSecurityConfig(config)).toThrow(/ALLOWED_HOSTS/);
    },
  );

  test('normalizes bracketed IPv6 wildcard listeners for Fastify', () => {
    const config = parseMcpHttpSecurityConfig({
      listenHost: '[::]',
      env: {
        CHROME_MCP_AUTH_TOKEN: REMOTE_TOKEN,
        CHROME_MCP_ALLOWED_HOSTS: 'mcp.internal.example',
      },
    });

    expect(config.listenHost).toBe('::');
    expect(config.isWildcardListener).toBe(true);
    expect(() => validateMcpHttpSecurityConfig(config)).not.toThrow();
  });

  test('accepts wildcard listeners only with concrete explicit hosts and a token', () => {
    const config = parseMcpHttpSecurityConfig({
      listenHost: '0.0.0.0',
      env: {
        CHROME_MCP_AUTH_TOKEN: REMOTE_TOKEN,
        CHROME_MCP_ALLOWED_HOSTS: 'mcp.internal.example, 192.168.10.20:8765',
      },
    });

    expect(() => validateMcpHttpSecurityConfig(config)).not.toThrow();
    expect([...config.allowedHosts]).toEqual(
      expect.arrayContaining(['mcp.internal.example', '192.168.10.20']),
    );
  });

  test('rejects wildcard host and origin configuration', () => {
    expect(() =>
      parseMcpHttpSecurityConfig({
        listenHost: '127.0.0.1',
        env: { CHROME_MCP_ALLOWED_HOSTS: '*.example.com' },
      }),
    ).toThrow(/wildcards/);
    expect(() =>
      parseMcpHttpSecurityConfig({
        listenHost: '127.0.0.1',
        env: { CHROME_MCP_ALLOWED_ORIGINS: 'https://*.example.com' },
      }),
    ).toThrow(/wildcards/);
  });
});

describe('MCP HTTP security guard', () => {
  test('accepts an exact Bearer token and rejects missing or incorrect credentials', async () => {
    const config = parseMcpHttpSecurityConfig({
      listenHost: '127.0.0.1',
      env: { CHROME_MCP_AUTH_TOKEN: REMOTE_TOKEN },
    });

    const success = await injectGuard(config, {
      headers: { host: 'localhost:8765', authorization: `Bearer ${REMOTE_TOKEN}` },
    });
    const missing = await injectGuard(config, { headers: { host: 'localhost' } });
    const incorrect = await injectGuard(config, {
      headers: { host: 'localhost', authorization: 'Bearer 0123456789abcdeg' },
    });

    expect(success.statusCode).toBe(200);
    for (const response of [missing, incorrect]) {
      expect(response.statusCode).toBe(401);
      expect(response.headers['www-authenticate']).toBe('Bearer');
      expect(response.json()).toMatchObject({
        jsonrpc: '2.0',
        id: null,
        error: { code: -32001 },
      });
    }
  });

  test('parses Host ports without weakening exact hostname checks', async () => {
    const config = parseMcpHttpSecurityConfig({ listenHost: '127.0.0.1', env: {} });

    expect(parseMcpHostHeader('LOCALHOST:8765')).toBe('localhost');
    expect(parseMcpHostHeader('[0:0:0:0:0:0:0:1]:8765')).toBe('[::1]');
    expect(parseMcpHostHeader('localhost:invalid')).toBeNull();
    expect(parseMcpHostHeader('localhost:0')).toBeNull();
    expect(parseMcpHostHeader('localhost:65536')).toBeNull();

    const allowed = await injectGuard(config, { headers: { host: '127.0.0.1:8765' } });
    const bypass = await injectGuard(config, { headers: { host: 'localhost.evil:8765' } });

    expect(allowed.statusCode).toBe(200);
    expect(bypass.statusCode).toBe(403);
    expect(bypass.json().error.message).toBe('Forbidden Host');
  });

  test('allows missing Origin but requires exact matches when Origin is present', async () => {
    const customOrigin = 'https://console.example.test';
    const config = parseMcpHttpSecurityConfig({
      listenHost: '127.0.0.1',
      env: { CHROME_MCP_ALLOWED_ORIGINS: customOrigin },
    });

    const missing = await injectGuard(config, { headers: { host: 'localhost' } });
    const extension = await injectGuard(config, {
      headers: { host: 'localhost', origin: DEFAULT_CHROME_EXTENSION_ORIGIN },
    });
    const custom = await injectGuard(config, {
      headers: { host: 'localhost', origin: customOrigin },
    });
    const startsWithBypass = await injectGuard(config, {
      headers: { host: 'localhost', origin: `${customOrigin}.evil.test` },
    });

    expect(missing.statusCode).toBe(200);
    expect(extension.statusCode).toBe(200);
    expect(custom.statusCode).toBe(200);
    expect(startsWithBypass.statusCode).toBe(403);
    expect(startsWithBypass.json().error.message).toBe('Forbidden Origin');
  });

  test('returns 429 with Retry-After and resets after the fixed window', async () => {
    let now = 10_000;
    const config = parseMcpHttpSecurityConfig({
      listenHost: '127.0.0.1',
      env: {},
      rateLimitPerMinute: 2,
    });
    const app = Fastify();
    app.all(
      '/mcp',
      { preHandler: createMcpHttpSecurityGuard(config, { now: () => now }) },
      async () => ({ ok: true }),
    );

    const first = await app.inject({ method: 'POST', url: '/mcp', headers: { host: 'localhost' } });
    const second = await app.inject({
      method: 'POST',
      url: '/mcp',
      headers: { host: 'localhost' },
    });
    const limited = await app.inject({
      method: 'POST',
      url: '/mcp',
      headers: { host: 'localhost' },
    });
    now += 60_000;
    const reset = await app.inject({ method: 'POST', url: '/mcp', headers: { host: 'localhost' } });
    await app.close();

    expect(first.statusCode).toBe(200);
    expect(second.statusCode).toBe(200);
    expect(limited.statusCode).toBe(429);
    expect(limited.headers['retry-after']).toBe('60');
    expect(limited.json().error.code).toBe(-32029);
    expect(reset.statusCode).toBe(200);
  });

  test('does not let unauthorized requests consume the authenticated rate-limit bucket', async () => {
    const config = parseMcpHttpSecurityConfig({
      listenHost: '127.0.0.1',
      env: { CHROME_MCP_AUTH_TOKEN: REMOTE_TOKEN },
      rateLimitPerMinute: 1,
    });
    const app = Fastify();
    app.all('/mcp', { preHandler: createMcpHttpSecurityGuard(config) }, async () => ({ ok: true }));

    const unauthorized = await app.inject({
      method: 'POST',
      url: '/mcp',
      headers: { host: 'localhost', authorization: 'Bearer incorrect-token' },
    });
    const authorized = await app.inject({
      method: 'POST',
      url: '/mcp',
      headers: { host: 'localhost', authorization: `Bearer ${REMOTE_TOKEN}` },
    });
    const limited = await app.inject({
      method: 'POST',
      url: '/mcp',
      headers: { host: 'localhost', authorization: `Bearer ${REMOTE_TOKEN}` },
    });
    await app.close();

    expect(unauthorized.statusCode).toBe(401);
    expect(authorized.statusCode).toBe(200);
    expect(limited.statusCode).toBe(429);
  });

  test('skips all checks for OPTIONS requests', async () => {
    const config = parseMcpHttpSecurityConfig({
      listenHost: '127.0.0.1',
      env: { CHROME_MCP_AUTH_TOKEN: REMOTE_TOKEN },
    });
    const response = await injectGuard(config, {
      method: 'OPTIONS',
      headers: { host: 'evil.example', origin: 'https://evil.example' },
    });

    expect(response.statusCode).toBe(200);
  });
});

describe('FixedWindowRateLimiter cleanup', () => {
  test('removes expired entries and enforces a hard client capacity', () => {
    const limiter = new FixedWindowRateLimiter(1, 1_000, 2);

    limiter.consume('client-a', 0);
    limiter.consume('client-b', 100);
    limiter.consume('client-c', 200);
    expect(limiter.size).toBe(2);

    expect(limiter.pruneExpired(1_200)).toBe(2);
    expect(limiter.size).toBe(0);
  });

  test('cleans expired clients during normal consumption', () => {
    const limiter = new FixedWindowRateLimiter(1, 1_000, 10);

    limiter.consume('expired-client', 0);
    limiter.consume('current-client', 1_000);

    expect(limiter.size).toBe(1);
    expect(limiter.consume('current-client', 1_001).allowed).toBe(false);
  });
});

interface InjectGuardOptions {
  method?: 'GET' | 'POST' | 'OPTIONS';
  headers?: Record<string, string>;
  guardOptions?: CreateMcpHttpSecurityGuardOptions;
}

async function injectGuard(config: McpHttpSecurityConfig, options: InjectGuardOptions = {}) {
  const app = Fastify();
  app.all(
    '/mcp',
    { preHandler: createMcpHttpSecurityGuard(config, options.guardOptions) },
    async () => ({ ok: true }),
  );
  const response = await app.inject({
    method: options.method ?? 'POST',
    url: '/mcp',
    headers: options.headers,
  });
  await app.close();
  return response;
}
