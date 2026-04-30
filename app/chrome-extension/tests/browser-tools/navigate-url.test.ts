import { beforeEach, describe, expect, it, vi } from 'vitest';

import { buildUrlQueryPatterns, navigateTool } from '@/entrypoints/background/tools/browser/common';

function parseJsonResult(result: { content?: Array<{ type: string; text?: string }> }) {
  const text = result.content?.[0]?.text;
  return JSON.parse(String(text || '{}'));
}

describe('navigate URL handling', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.clearAllMocks();

    (chrome as any).windows = {
      getLastFocused: vi.fn().mockResolvedValue({ id: 1 }),
      update: vi.fn().mockResolvedValue({}),
      create: vi.fn().mockResolvedValue({
        id: 2,
        tabs: [{ id: 20, windowId: 2, url: 'about:blank' }],
      }),
    };
    (chrome.tabs.query as any) = vi.fn().mockResolvedValue([]);
    (chrome.tabs.create as any) = vi.fn().mockResolvedValue({
      id: 10,
      windowId: 1,
      url: 'about:blank',
    });
    (chrome.tabs.get as any) = vi.fn().mockImplementation(async (tabId: number) => ({
      id: tabId,
      windowId: 1,
      url: 'chrome://extensions/',
      title: 'Extensions',
      active: true,
      index: 0,
    }));
    (chrome.tabs.update as any) = vi.fn().mockResolvedValue({});
  });

  it('does not add www variants for localhost, IPv4, or IPv6 loopback URLs', () => {
    const loopbackPatterns = buildUrlQueryPatterns('http://127.0.0.1:8765/app?q=1#top').patterns;
    const localhostPatterns = buildUrlQueryPatterns('http://localhost:8765/app').patterns;
    const ipv6Patterns = buildUrlQueryPatterns('http://[::1]:8765/app').patterns;

    expect(loopbackPatterns).toContain('http://127.0.0.1:8765/*');
    expect(loopbackPatterns.some((pattern) => pattern.includes('www.127.0.0.1'))).toBe(false);
    expect(localhostPatterns).toContain('http://localhost:8765/*');
    expect(localhostPatterns.some((pattern) => pattern.includes('www.localhost'))).toBe(false);
    expect(ipv6Patterns).toContain('http://[::1]:8765/*');
    expect(ipv6Patterns.some((pattern) => pattern.includes('www.'))).toBe(false);
  });

  it('keeps www variants for normal web hostnames', () => {
    const patterns = buildUrlQueryPatterns('https://example.com/docs').patterns;

    expect(patterns).toContain('https://example.com/*');
    expect(patterns).toContain('https://www.example.com/*');
    expect(patterns).toContain('http://example.com/*');
    expect(patterns).toContain('http://www.example.com/*');
  });

  it('opens loopback URLs without malformed match patterns', async () => {
    const url = 'http://127.0.0.1:8765/app?q=1#top';

    const result = await navigateTool.execute({ url });

    expect(result.isError).toBe(false);
    const queryArg = (chrome.tabs.query as any).mock.calls[0][0];
    expect(queryArg.url.some((pattern: string) => pattern.includes('www.127.0.0.1'))).toBe(false);
    expect(chrome.tabs.create).toHaveBeenCalledWith({
      url,
      windowId: 1,
      active: true,
    });
    expect(parseJsonResult(result)).toMatchObject({
      success: true,
      tabId: 10,
      windowId: 1,
    });
  });

  it('scans tabs instead of building invalid patterns for chrome URLs', async () => {
    (chrome.tabs.query as any) = vi.fn().mockResolvedValue([
      {
        id: 7,
        windowId: 1,
        url: 'chrome://extensions/',
        title: 'Extensions',
        active: false,
        index: 0,
      },
    ]);

    const result = await navigateTool.execute({ url: 'chrome://extensions/' });

    expect(result.isError).toBe(false);
    expect(chrome.tabs.query).toHaveBeenCalledWith({});
    expect(chrome.tabs.create).not.toHaveBeenCalled();
    expect(chrome.windows.update).toHaveBeenCalledWith(1, { focused: true });
    expect(chrome.tabs.update).toHaveBeenCalledWith(7, { active: true });
    expect(parseJsonResult(result)).toMatchObject({
      success: true,
      message: 'Activated existing tab',
      tabId: 7,
    });
  });
});
