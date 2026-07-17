import { afterEach, describe, expect, jest, test } from '@jest/globals';
import { NativeMessageType } from 'chrome-mcp-shared';
import { NativeMessagingHost } from './native-messaging-host';

function createHost() {
  const host = new NativeMessagingHost();
  const sendMessage = jest.spyOn(host, 'sendMessage').mockImplementation(() => undefined);
  return { host, sendMessage };
}

function getRequestId(sendMessage: jest.SpiedFunction<NativeMessagingHost['sendMessage']>) {
  return (sendMessage.mock.calls[0][0] as any).requestId as string;
}

afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

describe('NativeMessagingHost request lifecycle', () => {
  test('does not send a request when the signal is already aborted', async () => {
    const { host, sendMessage } = createHost();
    const controller = new AbortController();
    controller.abort();

    await expect(
      host.sendRequestToExtensionAndWait({}, NativeMessageType.CALL_TOOL, 1000, {
        signal: controller.signal,
      }),
    ).rejects.toMatchObject({ name: 'AbortError' });
    expect(sendMessage).not.toHaveBeenCalled();
  });

  test('cancels an in-flight request, removes its listener, and ignores a late response', async () => {
    const { host, sendMessage } = createHost();
    const controller = new AbortController();
    const removeListener = jest.spyOn(controller.signal, 'removeEventListener');
    const request = host.sendRequestToExtensionAndWait(
      { name: 'chrome_wait_for' },
      NativeMessageType.CALL_TOOL,
      1000,
      { signal: controller.signal },
    );
    const requestId = getRequestId(sendMessage);

    controller.abort();

    await expect(request).rejects.toMatchObject({ name: 'AbortError' });
    expect(removeListener).toHaveBeenCalledWith('abort', expect.any(Function));
    expect(sendMessage).toHaveBeenLastCalledWith({
      type: NativeMessageType.CALL_TOOL_CANCEL,
      requestId,
      payload: { requestId },
    });
    expect((host as any).pendingRequests.size).toBe(0);

    await (host as any).handleMessage({
      responseToRequestId: requestId,
      payload: { status: 'success' },
    });
    expect((host as any).pendingRequests.size).toBe(0);
  });

  test('dispatches progress without settling the request and cleans up on response', async () => {
    const { host, sendMessage } = createHost();
    const controller = new AbortController();
    const removeListener = jest.spyOn(controller.signal, 'removeEventListener');
    const onProgress = jest.fn<(progress: any) => void>();
    let settled = false;
    const request = host
      .sendRequestToExtensionAndWait({}, NativeMessageType.CALL_TOOL, 1000, {
        signal: controller.signal,
        onProgress,
      })
      .finally(() => {
        settled = true;
      });
    const requestId = getRequestId(sendMessage);

    await (host as any).handleMessage({
      type: NativeMessageType.CALL_TOOL_PROGRESS,
      requestId,
      payload: { progress: 25, total: 100, message: 'Waiting' },
    });
    await Promise.resolve();

    expect(onProgress).toHaveBeenCalledWith({ progress: 25, total: 100, message: 'Waiting' });
    expect(settled).toBe(false);
    expect((host as any).pendingRequests.size).toBe(1);

    await (host as any).handleMessage({
      responseToRequestId: requestId,
      payload: { status: 'success', data: 'done' },
    });

    await expect(request).resolves.toEqual({ status: 'success', data: 'done' });
    expect(removeListener).toHaveBeenCalledWith('abort', expect.any(Function));
    expect((host as any).pendingRequests.size).toBe(0);
  });

  test('timeout removes the abort listener and cancels extension work', async () => {
    jest.useFakeTimers();
    const { host, sendMessage } = createHost();
    const controller = new AbortController();
    const removeListener = jest.spyOn(controller.signal, 'removeEventListener');
    const request = host.sendRequestToExtensionAndWait({}, NativeMessageType.CALL_TOOL, 20, {
      signal: controller.signal,
    });
    const requestId = getRequestId(sendMessage);

    jest.advanceTimersByTime(20);

    await expect(request).rejects.toThrow('Request timed out after 20ms');
    expect(removeListener).toHaveBeenCalledWith('abort', expect.any(Function));
    expect(sendMessage).toHaveBeenLastCalledWith({
      type: NativeMessageType.CALL_TOOL_CANCEL,
      requestId,
      payload: { requestId },
    });
    expect((host as any).pendingRequests.size).toBe(0);
  });
});
