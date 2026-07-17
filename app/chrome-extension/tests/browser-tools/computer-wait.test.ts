import { beforeEach, describe, expect, it, vi } from 'vitest';

import { TOOL_MESSAGE_TYPES } from '@/common/message-types';
import { waitForDownload } from '@/entrypoints/background/tools/browser/download';
import { waitForCapturedRequest } from '@/entrypoints/background/tools/browser/network-capture';
import { networkCaptureStartTool } from '@/entrypoints/background/tools/browser/network-capture-web-request';
import { computerTool } from '@/entrypoints/background/tools/browser/computer';

function parseJsonResult(result: { content?: Array<{ type: string; text?: string }> }) {
  const text = result.content?.[0]?.text;
  return JSON.parse(String(text || '{}'));
}

describe('computer wait enhancements', () => {
  const tabId = 77;

  beforeEach(() => {
    vi.clearAllMocks();
    networkCaptureStartTool.captureData.clear();

    (chrome.tabs.query as any) = vi
      .fn()
      .mockResolvedValue([{ id: tabId, url: 'https://example.com' }]);
    (chrome.tabs.get as any) = vi
      .fn()
      .mockResolvedValue({ id: tabId, url: 'https://example.com', windowId: 1 });

    (chrome.downloads as any) = {
      search: vi.fn().mockResolvedValue([]),
      onCreated: { addListener: vi.fn(), removeListener: vi.fn() },
      onChanged: { addListener: vi.fn(), removeListener: vi.fn() },
    };

    (chrome.webNavigation.getAllFrames as any) = vi
      .fn()
      .mockResolvedValue([{ frameId: 0 }, { frameId: 5 }]);
  });

  it('uses selector wait for xpath selectors', async () => {
    const injectSpy = vi
      .spyOn(computerTool as any, 'injectContentScript')
      .mockResolvedValue(undefined);
    const sendSpy = vi.spyOn(computerTool as any, 'sendMessageToTab').mockResolvedValue({
      success: true,
      matched: { ref: 'ref_9', center: { x: 10, y: 20 } },
      tookMs: 12,
    });

    const result = await computerTool.execute({
      action: 'wait',
      tabId,
      selector: '//button[@type="submit"]',
      selectorType: 'xpath',
      timeout: 3456,
    } as any);

    expect(result.isError).toBe(false);
    expect(injectSpy).toHaveBeenCalled();
    expect(sendSpy).toHaveBeenNthCalledWith(
      1,
      tabId,
      {
        action: TOOL_MESSAGE_TYPES.WAIT_FOR_SELECTOR,
        selector: '//button[@type="submit"]',
        isXPath: true,
        visible: true,
        timeout: 3456,
      },
      0,
    );
    expect(sendSpy).toHaveBeenNthCalledWith(
      2,
      tabId,
      {
        action: TOOL_MESSAGE_TYPES.WAIT_FOR_SELECTOR,
        selector: '//button[@type="submit"]',
        isXPath: true,
        visible: true,
        timeout: 3456,
      },
      5,
    );

    expect(parseJsonResult(result)).toMatchObject({
      success: true,
      action: 'wait',
      kind: 'selector',
      selector: '//button[@type="submit"]',
      selectorType: 'xpath',
    });
  });

  it('filters old downloads when waiting from computer tool baseline', async () => {
    const baseline = Date.now();
    const oldItem = {
      id: 1,
      filename: 'C:\\Downloads\\old-report.csv',
      url: 'https://example.com/old-report.csv',
      state: 'complete',
      startTime: new Date(baseline - 5000).toISOString(),
    };
    const newItem = {
      id: 2,
      filename: 'C:\\Downloads\\new-report.csv',
      url: 'https://example.com/new-report.csv',
      state: 'complete',
      startTime: new Date(baseline + 5).toISOString(),
    };
    (chrome.downloads.search as any).mockImplementation((query: { id?: number }) => {
      if (query?.id === oldItem.id) return Promise.resolve([oldItem]);
      if (query?.id === newItem.id) return Promise.resolve([newItem]);
      return Promise.resolve([oldItem, newItem]);
    });

    const result = await waitForDownload({
      filenameContains: 'report',
      waitForComplete: true,
      timeoutMs: 2000,
      startedAfter: baseline,
    });

    expect(result).toMatchObject({
      id: 2,
      state: 'complete',
      matchedBy: 'filename',
    });
  });

  it('cancels download waits and removes all registered resources', async () => {
    const controller = new AbortController();
    const pending = waitForDownload({
      filenameContains: 'report',
      waitForComplete: true,
      timeoutMs: 2000,
      signal: controller.signal,
    });
    const createdListener = (chrome.downloads.onCreated.addListener as any).mock.calls[0][0];
    const changedListener = (chrome.downloads.onChanged.addListener as any).mock.calls[0][0];

    controller.abort();

    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    expect(chrome.downloads.onCreated.removeListener).toHaveBeenCalledWith(createdListener);
    expect(chrome.downloads.onChanged.removeListener).toHaveBeenCalledWith(changedListener);
  });

  it('reports real download progress monotonically and completes at 100', async () => {
    let currentItem = {
      id: 8,
      filename: 'C:\\Downloads\\report.csv',
      url: 'https://example.com/report.csv',
      state: 'in_progress',
      bytesReceived: 25,
      totalBytes: 100,
      startTime: new Date().toISOString(),
    } as chrome.downloads.DownloadItem;
    (chrome.downloads.search as any).mockImplementation((query: { id?: number }) =>
      Promise.resolve(typeof query?.id === 'number' ? [currentItem] : []),
    );
    const progress: number[] = [];
    const pending = waitForDownload({
      filenameContains: 'report',
      waitForComplete: true,
      timeoutMs: 2000,
      reportProgress: vi.fn(async (update) => progress.push(update.progress)),
    });
    const onCreated = (chrome.downloads.onCreated.addListener as any).mock.calls[0][0];
    const onChanged = (chrome.downloads.onChanged.addListener as any).mock.calls[0][0];

    onCreated(currentItem);
    await vi.waitFor(() => expect(progress).toContain(25));
    currentItem = {
      ...currentItem,
      state: 'complete',
      bytesReceived: 100,
    } as chrome.downloads.DownloadItem;
    onChanged({ id: currentItem.id, state: { current: 'complete' } });

    const result = await pending;
    expect(result).toMatchObject({ id: 8, state: 'complete', progressPct: 100 });
    expect(progress.at(-1)).toBe(100);
    expect(progress.every((value, index) => index === 0 || value >= progress[index - 1])).toBe(
      true,
    );
  });

  it('keeps download results successful when progress delivery fails', async () => {
    const item = {
      id: 9,
      filename: 'C:\\Downloads\\report.csv',
      url: 'https://example.com/report.csv',
      state: 'complete',
      bytesReceived: 100,
      totalBytes: 100,
      startTime: new Date().toISOString(),
    } as chrome.downloads.DownloadItem;
    (chrome.downloads.search as any).mockResolvedValue([item]);

    await expect(
      waitForDownload({
        filenameContains: 'report',
        waitForComplete: true,
        timeoutMs: 2000,
        reportProgress: vi.fn(async () => {
          throw new Error('progress channel closed');
        }),
      }),
    ).resolves.toMatchObject({ id: 9, state: 'complete' });
  });

  it('matches completed network requests from active capture data', async () => {
    const startedAfter = Date.now() - 100;
    networkCaptureStartTool.captureData.set(tabId, {
      requests: {
        req_1: {
          url: 'https://example.com/api/items',
          method: 'POST',
          status: 200,
          requestTime: Date.now(),
        },
      },
    } as any);

    const result = await waitForCapturedRequest({
      tabId,
      urlPattern: '/api/items',
      method: 'POST',
      status: 200,
      timeoutMs: 1000,
      startedAfter,
    });

    expect(result.backend).toBe('webRequest');
    expect(result.request).toMatchObject({
      url: 'https://example.com/api/items',
      method: 'POST',
      status: 200,
    });
  });

  it('cancels temporary network waits and stops their capture', async () => {
    const startSpy = vi
      .spyOn(networkCaptureStartTool, 'startCaptureForTab')
      .mockImplementation(async (targetTabId) => {
        networkCaptureStartTool.captureData.set(targetTabId, { requests: {} } as any);
      });
    const stopSpy = vi
      .spyOn(networkCaptureStartTool, 'stopCapture')
      .mockImplementation(async (targetTabId) => {
        networkCaptureStartTool.captureData.delete(targetTabId);
      });
    const controller = new AbortController();
    const pending = waitForCapturedRequest({
      tabId,
      timeoutMs: 2000,
      signal: controller.signal,
      reportProgress: vi.fn(async () => {
        throw new Error('progress channel closed');
      }),
    });

    await vi.waitFor(() => expect(startSpy).toHaveBeenCalledWith(tabId, expect.any(Object)));
    controller.abort();

    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    expect(stopSpy).toHaveBeenCalledWith(tabId);
    expect(networkCaptureStartTool.captureData.has(tabId)).toBe(false);
  });

  it('finds selector waits in child frames without explicit frameId', async () => {
    const injectSpy = vi
      .spyOn(computerTool as any, 'injectContentScript')
      .mockResolvedValue(undefined);
    const sendSpy = vi
      .spyOn(computerTool as any, 'sendMessageToTab')
      .mockImplementation(async (_tabId: number, _message: any, frameId?: number) => {
        if (frameId === 0) {
          return { success: false, reason: 'timeout' };
        }
        return {
          success: true,
          matched: { ref: 'ref_iframe', center: { x: 20, y: 30 } },
          tookMs: 44,
        };
      });

    const result = await computerTool.execute({
      action: 'wait',
      tabId,
      selector: '.pay-button',
      timeout: 2222,
    } as any);

    expect(result.isError).toBe(false);
    expect(injectSpy).toHaveBeenCalledWith(
      tabId,
      ['inject-scripts/wait-helper.js'],
      false,
      'ISOLATED',
      false,
      [0, 5],
    );
    expect(sendSpy).toHaveBeenCalledWith(
      tabId,
      {
        action: TOOL_MESSAGE_TYPES.WAIT_FOR_SELECTOR,
        selector: '.pay-button',
        isXPath: false,
        visible: true,
        timeout: 2222,
      },
      5,
    );
    expect(parseJsonResult(result)).toMatchObject({
      success: true,
      kind: 'selector',
      selector: '.pay-button',
      matchedFrameId: 5,
    });
  });

  it('requires selector to be hidden in every frame when visible=false', async () => {
    vi.spyOn(computerTool as any, 'injectContentScript').mockResolvedValue(undefined);
    vi.spyOn(computerTool as any, 'sendMessageToTab').mockImplementation(
      async (_tabId: number, _message: any, frameId?: number) => {
        if (frameId === 0) {
          return { success: true, matched: null, tookMs: 12 };
        }
        return { success: false, reason: 'timeout' };
      },
    );

    const result = await computerTool.execute({
      action: 'wait',
      tabId,
      selector: '.modal',
      visible: false,
      timeout: 1111,
    } as any);

    expect(result.isError).toBe(true);
    expect(result.content?.[0]?.text).toContain('timed out');
  });
});
