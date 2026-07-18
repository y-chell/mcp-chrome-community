import { afterEach, describe, expect, test } from '@jest/globals';
import {
  BRIDGE_VERSION,
  CHROME_MCP_BIND_HOST_ENV,
  CHROME_MCP_HOST_ENV,
  CHROME_MCP_AUTH_TOKEN_ENV,
  CHROME_MCP_PORT_ENV,
  MCP_HTTP_HOST_ENV,
  MCP_HTTP_AUTH_TOKEN_ENV,
  MCP_HTTP_PORT_ENV,
  getChromeMcpAuthHeaders,
  getChromeMcpAuthToken,
  getChromeMcpAuthTokenEnvName,
  getChromeMcpBindHost,
  getChromeMcpHost,
  getChromeMcpPort,
  getChromeMcpUrl,
} from './index';

const ORIGINAL_ENV = { ...process.env };

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

describe('mcp-chrome-community endpoint config', () => {
  test('reports the native package version', () => {
    expect(BRIDGE_VERSION).toBe(require('../../package.json').version);
  });

  test('prefers CHROME_MCP_HOST and CHROME_MCP_PORT when building url', () => {
    process.env[CHROME_MCP_HOST_ENV] = '192.168.1.20';
    process.env[CHROME_MCP_PORT_ENV] = '4567';

    expect(getChromeMcpHost()).toBe('192.168.1.20');
    expect(getChromeMcpPort()).toBe(4567);
    expect(getChromeMcpUrl()).toBe('http://192.168.1.20:4567/mcp');
  });

  test('falls back to legacy MCP_HTTP_HOST and MCP_HTTP_PORT env vars', () => {
    process.env[MCP_HTTP_HOST_ENV] = 'localhost';
    process.env[MCP_HTTP_PORT_ENV] = '2345';

    expect(getChromeMcpHost()).toBe('localhost');
    expect(getChromeMcpPort()).toBe(2345);
    expect(getChromeMcpUrl()).toBe('http://localhost:2345/mcp');
  });

  test('reads the preferred bearer token and builds IPv6 URLs safely', () => {
    process.env[CHROME_MCP_HOST_ENV] = '::1';
    process.env[CHROME_MCP_AUTH_TOKEN_ENV] = 'preferred-token';
    process.env[MCP_HTTP_AUTH_TOKEN_ENV] = 'legacy-token';

    expect(getChromeMcpAuthToken()).toBe('preferred-token');
    expect(getChromeMcpAuthTokenEnvName()).toBe(CHROME_MCP_AUTH_TOKEN_ENV);
    expect(getChromeMcpAuthHeaders()).toEqual({ Authorization: 'Bearer preferred-token' });
    expect(getChromeMcpUrl()).toBe('http://[::1]:12306/mcp');
  });

  test('keeps the listen address separate from the client-facing host', () => {
    process.env[CHROME_MCP_BIND_HOST_ENV] = '0.0.0.0';
    process.env[CHROME_MCP_HOST_ENV] = '192.168.1.20';

    expect(getChromeMcpBindHost()).toBe('0.0.0.0');
    expect(getChromeMcpUrl()).toBe('http://192.168.1.20:12306/mcp');
  });
});
