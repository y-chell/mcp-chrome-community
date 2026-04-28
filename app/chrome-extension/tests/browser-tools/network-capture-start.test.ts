import { beforeEach, describe, expect, it, vi } from 'vitest';

import { networkCaptureTool } from '@/entrypoints/background/tools/browser/network-capture';
import { networkDebuggerStartTool } from '@/entrypoints/background/tools/browser/network-capture-debugger';
import {
  networkCaptureStartTool,
  networkCaptureStopTool,
} from '@/entrypoints/background/tools/browser/network-capture-web-request';

function parseJsonResult(result: { content?: Array<{ type: string; text?: string }> }) {
  const text = result.content?.[0]?.text;
  return JSON.parse(String(text || '{}'));
}

describe('network capture start behavior', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    networkCaptureStartTool.captureData.clear();
    (networkDebuggerStartTool as any).captureData?.clear?.();
    (networkCaptureStartTool as any).completedCaptures?.clear?.();
    (networkDebuggerStartTool as any).completedCaptures?.clear?.();
    (networkCaptureStartTool as any).listeners = {};
    (networkCaptureStartTool as any).requestCounters = new Map();
    (networkCaptureStartTool as any).captureTimers = new Map();
    (networkCaptureStartTool as any).inactivityTimers = new Map();
    (networkCaptureStartTool as any).lastActivityTime = new Map();

    (globalThis.chrome as any).windows = {
      update: vi.fn().mockResolvedValue(undefined),
    };

    (globalThis.chrome as any).webRequest = {
      onBeforeRequest: { addListener: vi.fn(), removeListener: vi.fn() },
      onSendHeaders: { addListener: vi.fn(), removeListener: vi.fn() },
      onHeadersReceived: { addListener: vi.fn(), removeListener: vi.fn() },
      onCompleted: { addListener: vi.fn(), removeListener: vi.fn() },
      onErrorOccurred: { addListener: vi.fn(), removeListener: vi.fn() },
    };

    (globalThis.chrome as any).debugger = {
      ...(globalThis.chrome as any).debugger,
      getTargets: vi.fn().mockResolvedValue([]),
    };

    (chrome.tabs.query as any) = vi.fn().mockResolvedValue([]);
    (chrome.tabs.create as any) = vi.fn();
    (chrome.tabs.update as any) = vi.fn();
    (chrome.tabs.get as any) = vi.fn().mockResolvedValue({
      id: 1,
      url: 'https://example.com',
      title: 'Example',
      windowId: 1,
    });
  });

  it('starts webRequest capture before navigating a concrete URL', async () => {
    (chrome.tabs.create as any).mockResolvedValue({ id: 42, url: 'about:blank', active: true });
    (chrome.tabs.update as any).mockResolvedValue({
      id: 42,
      url: 'https://example.com/demo',
      active: true,
    });

    const startSpy = vi.spyOn(networkCaptureStartTool, 'startCaptureForTab').mockResolvedValue();

    const result = await networkCaptureStartTool.execute({
      url: 'https://example.com/demo',
      maxCaptureTime: 1111,
      inactivityTimeout: 2222,
      includeStatic: true,
    });

    expect(result.isError).toBe(false);
    expect(chrome.tabs.create).toHaveBeenCalledWith({ url: 'about:blank', active: true });
    expect(startSpy).toHaveBeenCalledWith(42, {
      maxCaptureTime: 1111,
      inactivityTimeout: 2222,
      includeStatic: true,
    });
    expect(chrome.tabs.update).toHaveBeenCalledWith(42, {
      url: 'https://example.com/demo',
      active: true,
    });
    expect(startSpy.mock.invocationCallOrder[0]).toBeLessThan(
      (chrome.tabs.update as any).mock.invocationCallOrder[0],
    );
    expect(parseJsonResult(result)).toMatchObject({
      success: true,
      tabId: 42,
      url: 'https://example.com/demo',
    });
  });

  it('starts debugger capture before navigating a concrete URL', async () => {
    (chrome.tabs.create as any).mockResolvedValue({ id: 84, url: 'about:blank', active: true });
    (chrome.tabs.update as any).mockResolvedValue({
      id: 84,
      url: 'https://example.com/api',
      active: true,
    });

    const startSpy = vi
      .spyOn(networkDebuggerStartTool as any, 'startCaptureForTab')
      .mockResolvedValue(undefined);

    const result = await (networkDebuggerStartTool as any).execute({
      url: 'https://example.com/api',
      maxCaptureTime: 3333,
      inactivityTimeout: 4444,
      includeStatic: false,
    });

    expect(result.isError).toBe(false);
    expect(chrome.tabs.create).toHaveBeenCalledWith({ url: 'about:blank', active: true });
    expect(startSpy).toHaveBeenCalledWith(84, {
      maxCaptureTime: 3333,
      inactivityTimeout: 4444,
      includeStatic: false,
    });
    expect(chrome.tabs.update).toHaveBeenCalledWith(84, {
      url: 'https://example.com/api',
      active: true,
    });
    expect(startSpy.mock.invocationCallOrder[0]).toBeLessThan(
      (chrome.tabs.update as any).mock.invocationCallOrder[0],
    );
    expect(parseJsonResult(result)).toMatchObject({
      success: true,
      tabId: 84,
      url: 'https://example.com/api',
    });
  });

  it('returns a clear error when a URL pattern does not match an open tab', async () => {
    const startSpy = vi.spyOn(networkCaptureStartTool, 'startCaptureForTab').mockResolvedValue();

    const result = await networkCaptureStartTool.execute({
      url: 'https://example.com/*',
    });

    expect(result.isError).toBe(true);
    expect(chrome.tabs.create).not.toHaveBeenCalled();
    expect(startSpy).not.toHaveBeenCalled();
    expect(result.content?.[0]?.text).toContain('No open tab matched URL pattern');
  });

  it('returns cached webRequest results after an auto-stop', async () => {
    networkCaptureStartTool.captureData.set(7, {
      tabId: 7,
      tabUrl: 'https://example.com',
      tabTitle: 'Example',
      startTime: 100,
      requests: {},
      maxCaptureTime: 5000,
      inactivityTimeout: 3000,
      includeStatic: false,
      limitReached: false,
      ignoredRequests: { filteredByUrl: 0, filteredByMimeType: 0, overLimit: 0 },
    } as any);

    await networkCaptureStartTool.stopCapture(7, {
      reason: 'inactivity_timeout',
      cacheResult: true,
    });

    const result = await networkCaptureTool.execute({ action: 'stop' });

    expect(result.isError).toBe(false);
    expect(parseJsonResult(result)).toMatchObject({
      success: true,
      backend: 'webRequest',
      captureAlreadyStopped: true,
      stopReason: 'inactivity_timeout',
      requestCount: 0,
    });
  });

  it('returns cached debugger results after an auto-stop', async () => {
    (networkDebuggerStartTool as any).captureData.set(8, {
      startTime: 200,
      tabUrl: 'https://example.com/api',
      tabTitle: 'API',
      maxCaptureTime: 5000,
      inactivityTimeout: 3000,
      includeStatic: false,
      requests: {},
      limitReached: false,
      ignoredRequests: { filteredByUrl: 0, filteredByMimeType: 0, overLimit: 0 },
    });

    await (networkDebuggerStartTool as any).stopCapture(8, {
      reason: 'max_capture_time',
      cacheResult: true,
    });

    const result = await networkCaptureTool.execute({
      action: 'stop',
      needResponseBody: true,
    });

    expect(result.isError).toBe(false);
    expect(parseJsonResult(result)).toMatchObject({
      success: true,
      backend: 'debugger',
      needResponseBody: true,
      captureAlreadyStopped: true,
      stopReason: 'max_capture_time',
      requestCount: 0,
    });
  });

  it('returns stable summary fields for a no-request webRequest stop', async () => {
    networkCaptureStartTool.captureData.set(9, {
      tabId: 9,
      tabUrl: 'https://example.com/empty',
      tabTitle: 'Empty',
      startTime: 300,
      requests: {},
      maxCaptureTime: 5000,
      inactivityTimeout: 3000,
      includeStatic: false,
      limitReached: false,
      ignoredRequests: { filteredByUrl: 1, filteredByMimeType: 2, overLimit: 3 },
    } as any);
    (chrome.tabs.query as any).mockResolvedValue([{ id: 9, url: 'https://example.com/empty' }]);

    const result = await networkCaptureStopTool.execute();

    expect(result.isError).toBe(false);
    expect(parseJsonResult(result)).toMatchObject({
      success: true,
      captureAlreadyStopped: false,
      stopReason: 'user_request',
      matchedRequests: 0,
      ignoredRequestCount: 6,
      ignoredRequests: { filteredByUrl: 1, filteredByMimeType: 2, overLimit: 3 },
      summary: {
        matchedRequests: 0,
        ignoredRequestCount: 6,
        totalObservedRequests: 6,
        stopReason: 'user_request',
      },
    });
  });

  it('replaces an existing webRequest capture as a new session', async () => {
    networkCaptureStartTool.captureData.set(55, {
      tabId: 55,
      tabUrl: 'https://example.com/old',
      tabTitle: 'Old',
      startTime: 10,
      requests: {},
      maxCaptureTime: 1000,
      inactivityTimeout: 1000,
      includeStatic: false,
      limitReached: false,
      ignoredRequests: { filteredByUrl: 0, filteredByMimeType: 0, overLimit: 0 },
    } as any);

    const stopSpy = vi.spyOn(networkCaptureStartTool, 'stopCapture');

    await networkCaptureStartTool.startCaptureForTab(55, {
      maxCaptureTime: 4000,
      inactivityTimeout: 5000,
      includeStatic: true,
    });

    expect(stopSpy).toHaveBeenCalledWith(55, {
      reason: 'replaced_by_new_capture',
      cacheResult: false,
    });
  });

  it('keeps xhr html responses when includeStatic is false', async () => {
    await networkCaptureStartTool.startCaptureForTab(12, {
      maxCaptureTime: 0,
      inactivityTimeout: 0,
      includeStatic: false,
    });

    const listeners = (networkCaptureStartTool as any).listeners;
    listeners.onBeforeRequest({
      tabId: 12,
      requestId: 'xhr-html',
      url: 'https://example.com/?mcp_test=1',
      method: 'GET',
      type: 'xmlhttprequest',
      timeStamp: 1000,
    });
    listeners.onHeadersReceived({
      tabId: 12,
      requestId: 'xhr-html',
      statusCode: 200,
      statusLine: 'HTTP/1.1 200',
      timeStamp: 1100,
      responseHeaders: [{ name: 'Content-Type', value: 'text/html; charset=UTF-8' }],
    });

    const captureInfo = networkCaptureStartTool.captureData.get(12) as any;
    expect(captureInfo.requests['xhr-html']).toBeTruthy();
    expect(captureInfo.ignoredRequests.filteredByMimeType).toBe(0);

    await networkCaptureStartTool.stopCapture(12);
  });

  it('filters top-level html documents when includeStatic is false', async () => {
    await networkCaptureStartTool.startCaptureForTab(13, {
      maxCaptureTime: 0,
      inactivityTimeout: 0,
      includeStatic: false,
    });

    const listeners = (networkCaptureStartTool as any).listeners;
    listeners.onBeforeRequest({
      tabId: 13,
      requestId: 'doc-html',
      url: 'https://example.com/',
      method: 'GET',
      type: 'main_frame',
      timeStamp: 1000,
    });
    listeners.onHeadersReceived({
      tabId: 13,
      requestId: 'doc-html',
      statusCode: 200,
      statusLine: 'HTTP/1.1 200',
      timeStamp: 1100,
      responseHeaders: [{ name: 'Content-Type', value: 'text/html; charset=UTF-8' }],
    });

    const captureInfo = networkCaptureStartTool.captureData.get(13) as any;
    expect(captureInfo.requests['doc-html']).toBeUndefined();
    expect(captureInfo.ignoredRequests.filteredByMimeType).toBe(1);

    await networkCaptureStartTool.stopCapture(13);
  });
});
