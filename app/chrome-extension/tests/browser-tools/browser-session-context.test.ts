import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  clearBrowserToolSessionState,
  getBrowserToolSessionBinding,
  runBrowserToolCallWithIsolation,
} from '@/entrypoints/background/tools/browser-session-context';

function textResult(payload: Record<string, unknown>) {
  return {
    content: [{ type: 'text' as const, text: JSON.stringify(payload) }],
    isError: false,
  };
}

describe('browser tool session context', () => {
  const tabsById = new Map<number, chrome.tabs.Tab>();

  beforeEach(() => {
    clearBrowserToolSessionState();
    tabsById.clear();

    (chrome.tabs.get as any) = vi.fn(async (tabId: number) => {
      const tab = tabsById.get(tabId);
      if (!tab) throw new Error(`No tab: ${tabId}`);
      return tab;
    });

    (chrome.tabs.query as any) = vi.fn(async () => []);

    (globalThis.chrome as any).windows = {
      get: vi.fn(async (windowId: number) => ({ id: windowId })),
      getLastFocused: vi.fn(async () => ({ id: 1 })),
      onRemoved: { addListener: vi.fn(), removeListener: vi.fn() },
    };
  });

  it('binds a session to the tab returned by navigate and reuses it later', async () => {
    tabsById.set(10, { id: 10, windowId: 1 } as chrome.tabs.Tab);
    const seenArgs: any[] = [];

    await runBrowserToolCallWithIsolation(
      'chrome_navigate',
      { url: 'https://example.test/' },
      { sessionId: 's1' },
      async (args) => {
        seenArgs.push(args);
        return textResult({ success: true, tabId: 10, windowId: 1 });
      },
    );

    await runBrowserToolCallWithIsolation(
      'chrome_read_page',
      {},
      { sessionId: 's1' },
      async (args) => {
        seenArgs.push(args);
        return textResult({ success: true });
      },
    );

    expect(seenArgs[0]).toEqual({ url: 'https://example.test/' });
    expect(seenArgs[1]).toEqual({ tabId: 10 });
    expect(getBrowserToolSessionBinding('s1')).toMatchObject({ tabId: 10, windowId: 1 });
  });

  it('closes the bound tab when close_tabs has no explicit target', async () => {
    tabsById.set(10, { id: 10, windowId: 1 } as chrome.tabs.Tab);
    tabsById.set(11, { id: 11, windowId: 1 } as chrome.tabs.Tab);
    let closeArgs: any;

    await runBrowserToolCallWithIsolation('chrome_navigate', {}, { sessionId: 's1' }, async () =>
      textResult({ success: true, tabId: 10, windowId: 1 }),
    );

    await runBrowserToolCallWithIsolation(
      'chrome_close_tabs',
      {},
      { sessionId: 's1' },
      async (args) => {
        closeArgs = args;
        return textResult({
          success: true,
          closedTabIds: [10],
          activeContextAfterClose: { tabId: 11, windowId: 1 },
        });
      },
    );

    expect(closeArgs).toEqual({ tabIds: [10] });
    expect(getBrowserToolSessionBinding('s1')).toMatchObject({ tabId: 11, windowId: 1 });
  });

  it('pins first tab-scoped calls to the active tab for that call', async () => {
    tabsById.set(22, { id: 22, windowId: 3 } as chrome.tabs.Tab);
    (chrome.tabs.query as any) = vi.fn(async () => [{ id: 22, windowId: 3 }]);
    let readArgs: any;

    await runBrowserToolCallWithIsolation(
      'chrome_read_page',
      {},
      { sessionId: 's2' },
      async (args) => {
        readArgs = args;
        return textResult({ success: true });
      },
    );

    expect(readArgs).toEqual({ tabId: 22 });
    expect(getBrowserToolSessionBinding('s2')).toMatchObject({ tabId: 22, windowId: 3 });
  });

  it('serializes calls from the same MCP session', async () => {
    const events: string[] = [];
    let releaseFirst!: () => void;

    const first = runBrowserToolCallWithIsolation(
      'chrome_navigate',
      {},
      { sessionId: 'same-session' },
      async () => {
        events.push('first-start');
        await new Promise<void>((resolve) => {
          releaseFirst = resolve;
        });
        events.push('first-end');
        return textResult({ success: true });
      },
    );

    const second = runBrowserToolCallWithIsolation(
      'chrome_navigate',
      {},
      { sessionId: 'same-session' },
      async () => {
        events.push('second-start');
        return textResult({ success: true });
      },
    );

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(events).toEqual(['first-start']);

    releaseFirst();
    await Promise.all([first, second]);

    expect(events).toEqual(['first-start', 'first-end', 'second-start']);
  });
});
