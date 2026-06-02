import { beforeEach, describe, expect, it, vi } from 'vitest';

import { readPageTool } from '@/entrypoints/background/tools/browser/read-page';

function parseJsonResult(result: { content?: Array<{ type: string; text?: string }> }) {
  const text = result.content?.[0]?.text;
  return JSON.parse(String(text || '{}'));
}

describe('read_page tool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (chrome.tabs.get as any) = vi.fn().mockResolvedValue({
      id: 9,
      windowId: 1,
      url: 'https://example.com',
      title: 'Example',
    });
    (chrome.webNavigation.getAllFrames as any) = vi
      .fn()
      .mockResolvedValue([{ frameId: 0, parentFrameId: -1, url: 'https://example.com' }]);
    vi.spyOn(readPageTool as any, 'injectContentScript').mockResolvedValue(undefined);
    vi.spyOn(readPageTool as any, 'sendMessageToTab').mockResolvedValue({
      success: true,
      pageContent:
        '- document "Example" [ref=ref_1]\n  - heading "Example page" [ref=ref_2]\n  - button "Continue" [ref=ref_3]',
      viewport: { width: 800, height: 600, dpr: 1 },
      stats: { processed: 1, included: 1, durationMs: 1 },
      refMap: [{ ref: 'ref_1' }, { ref: 'ref_2' }, { ref: 'ref_3' }],
    });
  });

  it('treats an empty refId as omitted', async () => {
    const result = await readPageTool.execute({ tabId: 9, refId: '' } as any);

    expect(result.isError).toBe(false);
    expect((readPageTool as any).sendMessageToTab).toHaveBeenCalledWith(
      9,
      expect.objectContaining({ refId: undefined }),
      0,
    );
    expect(parseJsonResult(result)).toMatchObject({
      success: true,
    });
    expect(parseJsonResult(result).pageContent).toContain('Example page');
  });
});
