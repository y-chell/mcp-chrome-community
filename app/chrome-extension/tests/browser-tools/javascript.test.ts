import { beforeEach, describe, expect, it, vi } from 'vitest';

import { javascriptTool } from '@/entrypoints/background/tools/browser/javascript';

function parseJsonResult(result: { content?: Array<{ type: string; text?: string }> }) {
  const text = result.content?.[0]?.text;
  return JSON.parse(String(text || '{}'));
}

describe('javascript tool', () => {
  const tabId = 71;

  beforeEach(() => {
    vi.clearAllMocks();

    (chrome.tabs.get as any) = vi.fn().mockResolvedValue({
      id: tabId,
      url: 'https://example.com/frame',
      title: 'Frame page',
      windowId: 1,
    });
    (chrome.tabs.query as any) = vi.fn().mockResolvedValue([
      {
        id: tabId,
        url: 'https://example.com/frame',
        title: 'Frame page',
        windowId: 1,
        active: true,
      },
    ]);
    (globalThis.chrome as any).scripting = {
      executeScript: vi.fn().mockResolvedValue([
        {
          frameId: 7,
          result: {
            ok: true,
            value: { from: 'child-frame' },
          },
        },
      ]),
    };
  });

  it('runs in a specific frame with chrome.scripting when frameId is provided', async () => {
    const result = await javascriptTool.execute({
      tabId,
      frameId: 7,
      code: 'return { from: "child-frame" }',
    });

    expect(result.isError).toBe(false);
    expect(chrome.scripting.executeScript).toHaveBeenCalledWith(
      expect.objectContaining({
        target: { tabId, frameIds: [7] },
        world: 'ISOLATED',
      }),
    );

    expect(parseJsonResult(result)).toMatchObject({
      success: true,
      tabId,
      frameId: 7,
      engine: 'scripting',
    });
  });
});
