import { describe, expect, jest, test } from '@jest/globals';
import { createMcpServer } from './mcp-server';

describe('createMcpServer', () => {
  test('returns a fresh server instance for each connection', async () => {
    const firstTransport = {
      start: jest.fn(async () => undefined),
      send: jest.fn(async () => undefined),
      close: jest.fn(async () => undefined),
      onclose: undefined,
      onerror: undefined,
      onmessage: undefined,
    };
    const secondTransport = {
      start: jest.fn(async () => undefined),
      send: jest.fn(async () => undefined),
      close: jest.fn(async () => undefined),
      onclose: undefined,
      onerror: undefined,
      onmessage: undefined,
    };

    const firstServer = createMcpServer();
    const secondServer = createMcpServer();

    expect(firstServer).not.toBe(secondServer);

    await expect(firstServer.connect(firstTransport as any)).resolves.toBeUndefined();
    await expect(secondServer.connect(secondTransport as any)).resolves.toBeUndefined();

    expect(firstTransport.start).toHaveBeenCalledTimes(1);
    expect(secondTransport.start).toHaveBeenCalledTimes(1);
  });
});
