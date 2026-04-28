import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  getElementHtmlTool,
  queryElementsTool,
} from '@/entrypoints/background/tools/browser/dom-query';
import {
  clearRefTargetsForTab,
  getRefTargetFrameId,
  rememberRefTarget,
} from '@/utils/ref-target-store';

function parseJsonResult(result: { content?: Array<{ type: string; text?: string }> }) {
  const text = result.content?.[0]?.text;
  return JSON.parse(String(text || '{}'));
}

describe('dom query tools', () => {
  const tabId = 21;

  beforeEach(() => {
    vi.clearAllMocks();
    clearRefTargetsForTab(tabId);

    (chrome.tabs.get as any) = vi.fn().mockResolvedValue({
      id: tabId,
      url: 'https://example.com/page',
      title: 'Example Page',
      windowId: 1,
    });
    (chrome.tabs.query as any) = vi.fn().mockResolvedValue([
      {
        id: tabId,
        url: 'https://example.com/page',
        title: 'Example Page',
        windowId: 1,
        active: true,
      },
    ]);
    (chrome.webNavigation.getAllFrames as any) = vi
      .fn()
      .mockResolvedValue([{ frameId: 0 }, { frameId: 7 }]);
  });

  it('queries elements across frames and remembers returned refs', async () => {
    vi.spyOn(queryElementsTool as any, 'injectContentScript').mockResolvedValue(undefined);
    vi.spyOn(queryElementsTool as any, 'sendMessageToTab').mockImplementation(
      async (_tabId: number, _message: any, frameId?: number) => {
        if (frameId === 0) {
          return {
            success: true,
            elements: [{ ref: 'ref_top', tagName: 'button', text: 'Save' }],
            refMap: [{ ref: 'ref_top' }],
            totalMatches: 1,
            truncated: false,
          };
        }
        return {
          success: true,
          elements: [{ ref: 'ref_child', tagName: 'input', text: 'Email' }],
          refMap: [{ ref: 'ref_child' }],
          totalMatches: 1,
          truncated: false,
        };
      },
    );

    const result = await queryElementsTool.execute({
      tabId,
      selector: '.field',
      includeHidden: true,
      limit: 10,
    } as any);

    expect(result.isError).toBe(false);
    expect(getRefTargetFrameId(tabId, 'ref_top')).toBe(0);
    expect(getRefTargetFrameId(tabId, 'ref_child')).toBe(7);
    expect(parseJsonResult(result)).toMatchObject({
      success: true,
      tool: 'chrome_query_elements',
      count: 2,
      matchedFrameIds: [0, 7],
      framesSearched: [0, 7],
      elements: [
        { ref: 'ref_top', frameId: 0, tagName: 'button' },
        { ref: 'ref_child', frameId: 7, tagName: 'input' },
      ],
    });
  });

  it('requires a known root ref for subtree queries', async () => {
    const result = await queryElementsTool.execute({
      tabId,
      selector: '.field',
      refId: 'ref_missing',
    } as any);

    expect(result.isError).toBe(true);
    expect(result.content?.[0]?.text).toContain('Unknown ref "ref_missing"');
  });

  it('routes get_element_html by ref to the remembered frame', async () => {
    rememberRefTarget(tabId, 'ref_html', 7);

    const injectSpy = vi
      .spyOn(getElementHtmlTool as any, 'injectContentScript')
      .mockResolvedValue(undefined);
    const sendSpy = vi.spyOn(getElementHtmlTool as any, 'sendMessageToTab').mockResolvedValue({
      success: true,
      element: {
        ref: 'ref_html',
        tagName: 'div',
        selectorHint: '#panel',
        html: '<div id="panel">Hello</div>',
        htmlLength: 27,
        truncated: false,
      },
      refMap: [{ ref: 'ref_html' }],
    });

    const result = await getElementHtmlTool.execute({
      tabId,
      ref: 'ref_html',
    } as any);

    expect(result.isError).toBe(false);
    expect(injectSpy).toHaveBeenCalledWith(
      tabId,
      ['inject-scripts/accessibility-tree-helper.js'],
      false,
      'ISOLATED',
      false,
      [7],
    );
    expect(sendSpy).toHaveBeenCalledWith(
      tabId,
      {
        action: 'getElementHtml',
        ref: 'ref_html',
        selector: undefined,
        isXPath: false,
        includeOuterHtml: true,
        maxLength: 20000,
      },
      7,
    );
    expect(parseJsonResult(result)).toMatchObject({
      success: true,
      frameId: 7,
      ref: 'ref_html',
      tagName: 'div',
      html: '<div id="panel">Hello</div>',
    });
  });

  it('fails clearly when a selector matches multiple frames', async () => {
    vi.spyOn(getElementHtmlTool as any, 'injectContentScript').mockResolvedValue(undefined);
    vi.spyOn(getElementHtmlTool as any, 'sendMessageToTab').mockImplementation(
      async (_tabId: number, _message: any, frameId?: number) => ({
        success: true,
        element: {
          ref: `ref_${frameId}`,
          tagName: 'button',
          html: '<button>Pay</button>',
          htmlLength: 20,
          truncated: false,
        },
        refMap: [{ ref: `ref_${frameId}` }],
      }),
    );

    const result = await getElementHtmlTool.execute({
      tabId,
      selector: '.pay-button',
    } as any);

    expect(result.isError).toBe(true);
    expect(result.content?.[0]?.text).toContain('matched multiple elements across frames');
  });
});
