import { describe, expect, jest, test } from '@jest/globals';
import {
  DEFAULT_MAX_MCP_SESSIONS,
  DEFAULT_MCP_SESSION_IDLE_TTL_MS,
  McpSessionAlreadyExistsError,
  McpSessionCapacityError,
  McpSessionRegistry,
  type McpSessionTransport,
} from './mcp-session-registry';

interface StreamableHttpTransport extends McpSessionTransport {
  handleRequest(): void;
}

interface SseTransport extends McpSessionTransport {
  handlePostMessage(): void;
}

type TestTransportMap = {
  'streamable-http': StreamableHttpTransport;
  sse: SseTransport;
};

function createStreamableHttpTransport(
  close: () => Promise<void> | void = jest.fn(async () => undefined),
): StreamableHttpTransport {
  return {
    close,
    handleRequest: jest.fn(),
  };
}

function createSseTransport(
  close: () => Promise<void> | void = jest.fn(async () => undefined),
): SseTransport {
  return {
    close,
    handlePostMessage: jest.fn(),
  };
}

describe('McpSessionRegistry', () => {
  test('uses the documented defaults', () => {
    const registry = new McpSessionRegistry();

    expect(registry.maxSessions).toBe(DEFAULT_MAX_MCP_SESSIONS);
    expect(registry.idleTtlMs).toBe(DEFAULT_MCP_SESSION_IDLE_TTL_MS);
  });

  test('isolates streamable HTTP and SSE sessions by kind', () => {
    const registry = new McpSessionRegistry<TestTransportMap>();
    const streamableTransport = createStreamableHttpTransport();
    const sseTransport = createSseTransport();

    registry.register('streamable-session', 'streamable-http', streamableTransport);
    registry.register('sse-session', 'sse', sseTransport);

    const streamableSession = registry.get('streamable-session', 'streamable-http');
    const sseSession = registry.get('sse-session', 'sse');

    expect(streamableSession?.transport).toBe(streamableTransport);
    expect(sseSession?.transport).toBe(sseTransport);
    expect(registry.get('streamable-session', 'sse')).toBeUndefined();
    expect(registry.get('sse-session', 'streamable-http')).toBeUndefined();
    expect(registry.touch('streamable-session', 'sse')).toBe(false);
  });

  test('rejects duplicate session IDs without replacing the original session', () => {
    const registry = new McpSessionRegistry<TestTransportMap>();
    const originalTransport = createSseTransport();

    registry.register('duplicate', 'sse', originalTransport);

    expect(() =>
      registry.register('duplicate', 'streamable-http', createStreamableHttpTransport()),
    ).toThrow(McpSessionAlreadyExistsError);
    expect(registry.get('duplicate', 'sse')?.transport).toBe(originalTransport);
    expect(registry.size).toBe(1);
  });

  test('enforces the session limit and reports whether capacity remains', () => {
    const registry = new McpSessionRegistry<TestTransportMap>({ maxSessions: 1 });

    expect(registry.canAcceptNewSession()).toBe(true);
    registry.register('first', 'sse', createSseTransport());
    expect(registry.canAcceptNewSession()).toBe(false);

    expect(() =>
      registry.register('second', 'streamable-http', createStreamableHttpTransport()),
    ).toThrow(McpSessionCapacityError);
    expect(registry.size).toBe(1);
  });

  test('touch extends the idle TTL', async () => {
    let now = 1_000;
    const close = jest.fn(async () => undefined);
    const registry = new McpSessionRegistry<TestTransportMap>({
      idleTtlMs: 100,
      clock: () => now,
    });

    registry.register('active', 'streamable-http', createStreamableHttpTransport(close));
    expect(registry.get('active', 'streamable-http')).toMatchObject({
      createdAt: 1_000,
      lastActivity: 1_000,
    });

    now = 1_090;
    expect(registry.touch('active', 'streamable-http')).toBe(true);
    expect(registry.get('active', 'streamable-http')?.lastActivity).toBe(1_090);

    now = 1_150;
    await expect(registry.closeExpired()).resolves.toEqual({
      removedCount: 0,
      closedCount: 0,
      closeFailures: [],
    });
    expect(close).not.toHaveBeenCalled();

    now = 1_190;
    await registry.closeExpired();
    expect(close).toHaveBeenCalledTimes(1);
    expect(registry.size).toBe(0);
  });

  test('closes expired sessions while retaining active sessions', async () => {
    let now = 0;
    const expiredClose = jest.fn(async () => undefined);
    const activeClose = jest.fn(async () => undefined);
    const registry = new McpSessionRegistry<TestTransportMap>({
      idleTtlMs: 50,
      clock: () => now,
    });

    registry.register('expired', 'sse', createSseTransport(expiredClose));
    now = 30;
    registry.register('active', 'streamable-http', createStreamableHttpTransport(activeClose));
    now = 50;

    await expect(registry.closeExpired()).resolves.toEqual({
      removedCount: 1,
      closedCount: 1,
      closeFailures: [],
    });
    expect(expiredClose).toHaveBeenCalledTimes(1);
    expect(activeClose).not.toHaveBeenCalled();
    expect(registry.get('expired', 'sse')).toBeUndefined();
    expect(registry.get('active', 'streamable-http')).toBeDefined();
  });

  test('continues closing expired sessions when one transport close fails', async () => {
    let now = 0;
    const closeError = new Error('close failed');
    const failingClose = jest.fn(async () => {
      throw closeError;
    });
    const successfulClose = jest.fn(async () => undefined);
    const registry = new McpSessionRegistry<TestTransportMap>({
      idleTtlMs: 10,
      clock: () => now,
    });

    registry.register('failing', 'sse', createSseTransport(failingClose));
    registry.register(
      'successful',
      'streamable-http',
      createStreamableHttpTransport(successfulClose),
    );
    now = 10;

    const result = await registry.closeExpired();

    expect(failingClose).toHaveBeenCalledTimes(1);
    expect(successfulClose).toHaveBeenCalledTimes(1);
    expect(result).toEqual({
      removedCount: 2,
      closedCount: 1,
      closeFailures: [{ id: 'failing', kind: 'sse', error: closeError }],
    });
    expect(registry.size).toBe(0);
  });

  test('remove can leave the transport open or close it after removing the session', async () => {
    const close = jest.fn(async () => undefined);
    const registry = new McpSessionRegistry<TestTransportMap>();

    registry.register('keep-open', 'sse', createSseTransport(close));
    await expect(registry.remove('keep-open', 'sse')).resolves.toBe(true);
    expect(close).not.toHaveBeenCalled();

    registry.register('close-it', 'sse', createSseTransport(close));
    await expect(registry.remove('close-it', 'sse', { closeTransport: true })).resolves.toBe(true);
    expect(close).toHaveBeenCalledTimes(1);
    expect(registry.size).toBe(0);
  });

  test('closeAll clears the registry and best-effort closes every transport', async () => {
    const closeError = new Error('sync close failed');
    const failingClose = jest.fn(() => {
      throw closeError;
    });
    const successfulClose = jest.fn(async () => undefined);
    const registry = new McpSessionRegistry<TestTransportMap>();

    registry.register('sse', 'sse', createSseTransport(failingClose));
    registry.register(
      'streamable',
      'streamable-http',
      createStreamableHttpTransport(successfulClose),
    );

    const result = await registry.closeAll();

    expect(registry.size).toBe(0);
    expect(failingClose).toHaveBeenCalledTimes(1);
    expect(successfulClose).toHaveBeenCalledTimes(1);
    expect(result).toEqual({
      removedCount: 2,
      closedCount: 1,
      closeFailures: [{ id: 'sse', kind: 'sse', error: closeError }],
    });
    await expect(registry.closeAll()).resolves.toEqual({
      removedCount: 0,
      closedCount: 0,
      closeFailures: [],
    });
  });
});
