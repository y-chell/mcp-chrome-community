import { beforeEach, describe, expect, it, vi } from 'vitest';

import { closeTabsTool } from '@/entrypoints/background/tools/browser/common';
import {
  listFramesTool,
  waitForTabTool,
} from '@/entrypoints/background/tools/browser/tab-orchestration';

function parseJsonResult(result: { content?: Array<{ type: string; text?: string }> }) {
  const text = result.content?.[0]?.text;
  return JSON.parse(String(text || '{}'));
}

describe('tab / frame orchestration tools', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('lists frames with hierarchy and runtime details', async () => {
    (chrome.tabs.get as any) = vi.fn().mockResolvedValue({
      id: 9,
      windowId: 1,
      url: 'https://example.com',
      title: 'Main',
    });
    (chrome.tabs.query as any) = vi
      .fn()
      .mockResolvedValue([
        { id: 9, windowId: 1, url: 'https://example.com', title: 'Main', active: true },
      ]);
    (chrome.webNavigation.getAllFrames as any) = vi.fn().mockResolvedValue([
      { frameId: 0, parentFrameId: -1, url: 'https://example.com' },
      { frameId: 5, parentFrameId: 0, url: 'https://pay.example.com/frame' },
    ]);
    (globalThis.chrome as any).scripting = {
      executeScript: vi.fn().mockImplementation(async ({ target }: any) => {
        const frameId = target.frameIds[0];
        if (frameId === 0) {
          return [
            {
              result: {
                title: 'Main',
                readyState: 'complete',
                interactiveElementCount: 3,
                hasInteractiveElements: true,
              },
            },
          ];
        }
        return [
          {
            result: {
              title: 'Checkout iframe',
              readyState: 'interactive',
              interactiveElementCount: 1,
              hasInteractiveElements: true,
            },
          },
        ];
      }),
    };

    const result = await listFramesTool.execute({ tabId: 9 } as any);

    expect(result.isError).toBe(false);
    expect(parseJsonResult(result)).toMatchObject({
      success: true,
      tool: 'chrome_list_frames',
      tabId: 9,
      frameCount: 2,
      frames: [
        {
          frameId: 0,
          parentFrameId: -1,
          depth: 0,
          isTopFrame: true,
          title: 'Main',
        },
        {
          frameId: 5,
          parentFrameId: 0,
          depth: 1,
          title: 'Checkout iframe',
          readyState: 'interactive',
          interactiveElementCount: 1,
        },
      ],
    });
  });

  it('returns an already-open opener-matched tab immediately', async () => {
    (chrome.tabs.query as any) = vi.fn().mockResolvedValue([
      {
        id: 31,
        windowId: 1,
        openerTabId: 9,
        url: 'https://auth.example.com/start',
        title: 'OAuth',
        status: 'complete',
        active: true,
        index: 1,
      },
    ]);

    const result = await waitForTabTool.execute({
      openerTabId: 9,
      urlPattern: 'auth.example.com',
      timeoutMs: 500,
    } as any);

    expect(result.isError).toBe(false);
    expect(parseJsonResult(result)).toMatchObject({
      success: true,
      tool: 'chrome_wait_for_tab',
      waitedMs: 0,
      tab: {
        tabId: 31,
        openerTabId: 9,
        matchedBy: 'existing',
        openedAfterStart: false,
      },
    });
  });

  it('waits for a newly created tab to finish loading', async () => {
    let createdListener: ((tab: chrome.tabs.Tab) => void) | undefined;
    let updatedListener:
      | ((tabId: number, changeInfo: chrome.tabs.TabChangeInfo, tab: chrome.tabs.Tab) => void)
      | undefined;

    (chrome.tabs.query as any) = vi
      .fn()
      .mockResolvedValue([
        { id: 9, windowId: 1, url: 'https://example.com', title: 'Source', active: true },
      ]);
    (chrome.tabs.get as any) = vi.fn().mockImplementation(async (tabId: number) => {
      if (tabId === 44) {
        return {
          id: 44,
          windowId: 2,
          openerTabId: 9,
          url: 'https://auth.example.com/callback',
          title: 'OAuth Callback',
          status: 'complete',
          active: true,
          index: 0,
        };
      }
      return { id: tabId, windowId: 1, status: 'complete' };
    });
    (chrome.tabs.onCreated.addListener as any) = vi.fn((cb: any) => {
      createdListener = cb;
    });
    (chrome.tabs.onUpdated.addListener as any) = vi.fn((cb: any) => {
      updatedListener = cb;
    });

    const pending = waitForTabTool.execute({
      openerTabId: 9,
      urlPattern: 'auth.example.com',
      timeoutMs: 1000,
    } as any);

    await new Promise((resolve) => setTimeout(resolve, 0));
    createdListener?.({
      id: 44,
      windowId: 2,
      openerTabId: 9,
      url: 'about:blank',
      title: '',
      status: 'loading',
      active: true,
      index: 0,
    } as chrome.tabs.Tab);
    updatedListener?.(44, { status: 'complete' }, {
      id: 44,
      windowId: 2,
      openerTabId: 9,
      url: 'https://auth.example.com/callback',
      title: 'OAuth Callback',
      status: 'complete',
      active: true,
      index: 0,
    } as chrome.tabs.Tab);

    const result = await pending;

    expect(result.isError).toBe(false);
    expect(parseJsonResult(result)).toMatchObject({
      success: true,
      tool: 'chrome_wait_for_tab',
      tab: {
        tabId: 44,
        windowId: 2,
        matchedBy: 'updated',
        openedAfterStart: true,
      },
    });
  });

  it('returns the next active tab after closing the current one', async () => {
    (chrome.tabs.query as any) = vi.fn().mockImplementation(async (query: any) => {
      if (query?.active === true && query?.currentWindow === true) {
        return [
          { id: 10, windowId: 1, active: true, url: 'https://example.com/a', title: 'A', index: 0 },
        ];
      }
      if (query?.active === true && query?.windowId === 1) {
        return [
          { id: 11, windowId: 1, active: true, url: 'https://example.com/b', title: 'B', index: 0 },
        ];
      }
      return [];
    });
    (chrome.tabs.remove as any) = vi.fn().mockResolvedValue(undefined);

    const result = await closeTabsTool.execute({} as any);

    expect(result.isError).toBe(false);
    expect(parseJsonResult(result)).toMatchObject({
      success: true,
      closedTabIds: [10],
      activeContextAfterClose: {
        tabId: 11,
        windowId: 1,
        url: 'https://example.com/b',
      },
      affectedWindowIds: [1],
    });
  });
});
