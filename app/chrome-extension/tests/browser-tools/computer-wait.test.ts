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
