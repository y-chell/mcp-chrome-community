import { afterEach, describe, expect, test } from '@jest/globals';
import {
  CHROME_MCP_HOST_ENV,
  CHROME_MCP_PORT_ENV,
  MCP_HTTP_HOST_ENV,
  MCP_HTTP_PORT_ENV,
  getChromeMcpHost,
  getChromeMcpPort,
  getChromeMcpUrl,
} from './index';

const ORIGINAL_ENV = { ...process.env };

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

describe('mcp-chrome-community endpoint config', () => {
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
});
