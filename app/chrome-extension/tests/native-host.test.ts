import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { NativeMessageType } from 'chrome-mcp-shared';

const mocks = vi.hoisted(() => ({
  handleCallTool: vi.fn(),
}));

vi.mock('@/entrypoints/background/tools', () => ({
  handleCallTool: mocks.handleCallTool,
}));

vi.mock('@/entrypoints/background/record-replay/flow-store', () => ({
  getFlow: vi.fn(),
  listPublished: vi.fn().mockResolvedValue([]),
}));

vi.mock('@/entrypoints/background/keepalive-manager', () => ({
  acquireKeepalive: vi.fn(() => vi.fn()),
}));

type MessageListener = (message: any) => Promise<void> | void;
type DisconnectListener = () => void;

function createNativePort() {
  let messageListener: MessageListener | undefined;
  let disconnectListener: DisconnectListener | undefined;
  const port = {
    onMessage: {
      addListener: vi.fn((listener: MessageListener) => {
        messageListener = listener;
      }),
    },
    onDisconnect: {
      addListener: vi.fn((listener: DisconnectListener) => {
        disconnectListener = listener;
      }),
    },
    postMessage: vi.fn(),
    disconnect: vi.fn(),
  } as unknown as chrome.runtime.Port;

  return {
    port,
    getMessageListener: () => messageListener,
    getDisconnectListener: () => disconnectListener,
  };
}

async function connectTestPort() {
  const testPort = createNativePort();
  (chrome.runtime.connectNative as any) = vi.fn(() => testPort.port);
  const { connectNativeHost } = await import('@/entrypoints/background/native-host');
  expect(connectNativeHost()).toBe(true);
  testPort.port.postMessage = vi.fn();
  return testPort;
}

describe('native host tool call bridge', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.useFakeTimers();
    mocks.handleCallTool.mockReset();
    (chrome.runtime as any).lastError = undefined;
    (chrome.runtime.sendMessage as any) = vi.fn().mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it('forwards progress with requestId without settling the request', async () => {
    const testPort = await connectTestPort();
    mocks.handleCallTool.mockImplementation(async ({ executionContext }) => {
      await executionContext.reportProgress({ progress: 25, total: 100, message: 'Working' });
      return { content: [{ type: 'text', text: 'done' }] };
    });

    await testPort.getMessageListener()?.({
      type: NativeMessageType.CALL_TOOL,
      requestId: 'request-1',
      payload: { name: 'chrome_test', args: {} },
    });

    expect(testPort.port.postMessage).toHaveBeenNthCalledWith(1, {
      type: NativeMessageType.CALL_TOOL_PROGRESS,
      requestId: 'request-1',
      payload: { progress: 25, total: 100, message: 'Working' },
    });
    expect(testPort.port.postMessage).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ responseToRequestId: 'request-1' }),
    );
    expect(testPort.port.postMessage).not.toHaveBeenCalledWith(
      expect.objectContaining({
        type: NativeMessageType.CALL_TOOL_PROGRESS,
        responseToRequestId: expect.anything(),
      }),
    );
  });

  it('aborts an active call on cancel and suppresses its final response', async () => {
    const testPort = await connectTestPort();
    let observedSignal: AbortSignal | undefined;
    mocks.handleCallTool.mockImplementation(
      ({ executionContext }) =>
        new Promise((resolve) => {
          observedSignal = executionContext.signal;
          executionContext.signal.addEventListener('abort', () => {
            resolve({ content: [{ type: 'text', text: 'cancelled' }], isError: true });
          });
        }),
    );

    const callPromise = testPort.getMessageListener()?.({
      type: NativeMessageType.CALL_TOOL,
      requestId: 'request-2',
      payload: { name: 'chrome_test', args: {} },
    });
    await Promise.resolve();
    await testPort.getMessageListener()?.({
      type: NativeMessageType.CALL_TOOL_CANCEL,
      payload: { requestId: 'request-2' },
    });
    await callPromise;

    expect(observedSignal?.aborted).toBe(true);
    expect(testPort.port.postMessage).not.toHaveBeenCalledWith(
      expect.objectContaining({ responseToRequestId: 'request-2' }),
    );
  });

  it('aborts all active calls when the native port disconnects', async () => {
    const testPort = await connectTestPort();
    const signals: AbortSignal[] = [];
    mocks.handleCallTool.mockImplementation(
      ({ executionContext }) =>
        new Promise((resolve) => {
          signals.push(executionContext.signal);
          executionContext.signal.addEventListener('abort', () => resolve({ isError: true }));
        }),
    );

    const first = testPort.getMessageListener()?.({
      type: NativeMessageType.CALL_TOOL,
      requestId: 'request-3',
      payload: { name: 'chrome_test', args: {} },
    });
    const second = testPort.getMessageListener()?.({
      type: NativeMessageType.CALL_TOOL,
      requestId: 'request-4',
      payload: { name: 'chrome_test', args: {} },
    });
    await Promise.resolve();
    testPort.getDisconnectListener()?.();
    await Promise.all([first, second]);

    expect(signals).toHaveLength(2);
    expect(signals.every((signal) => signal.aborted)).toBe(true);
    expect(testPort.port.postMessage).not.toHaveBeenCalledWith(
      expect.objectContaining({ responseToRequestId: expect.any(String) }),
    );
  });
});
