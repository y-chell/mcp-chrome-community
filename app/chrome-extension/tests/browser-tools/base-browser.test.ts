import { beforeEach, describe, expect, it, vi } from 'vitest';

import { BaseBrowserToolExecutor } from '@/entrypoints/background/tools/base-browser';
import { clearRefTargetsForTab, rememberRefTarget } from '@/utils/ref-target-store';

class TestBrowserTool extends BaseBrowserToolExecutor {
  name = 'test_browser_tool';

  async execute() {
    return { content: [], isError: false };
  }

  async send(tabId: number, message: any, frameId?: number) {
    return this.sendMessageToTab(tabId, message, frameId);
  }
}

describe('BaseBrowserToolExecutor ref frame routing', () => {
  const tabId = 321;
  const sendMessageMock = vi.fn();

  beforeEach(() => {
    clearRefTargetsForTab(tabId);
    sendMessageMock.mockReset();
    sendMessageMock.mockResolvedValue({ success: true });
    (
      chrome.tabs as typeof chrome.tabs & {
        sendMessage: typeof sendMessageMock;
      }
    ).sendMessage = sendMessageMock;
  });

  it('routes ref messages to the remembered frame', async () => {
    rememberRefTarget(tabId, 'ref_1', 7);
    const tool = new TestBrowserTool();

    await tool.send(tabId, { action: 'focusByRef', ref: 'ref_1' });

    expect(sendMessageMock).toHaveBeenCalledWith(
      tabId,
      { action: 'focusByRef', ref: 'ref_1' },
      { frameId: 7 },
    );
  });

  it('also resolves frame ids from refId payloads', async () => {
    rememberRefTarget(tabId, 'ref_2', 9);
    const tool = new TestBrowserTool();

    await tool.send(tabId, { action: 'generateAccessibilityTree', refId: 'ref_2' });

    expect(sendMessageMock).toHaveBeenCalledWith(
      tabId,
      { action: 'generateAccessibilityTree', refId: 'ref_2' },
      { frameId: 9 },
    );
  });

  it('keeps explicit frameId when caller provides one', async () => {
    rememberRefTarget(tabId, 'ref_3', 4);
    const tool = new TestBrowserTool();

    await tool.send(tabId, { action: 'focusByRef', ref: 'ref_3' }, 12);

    expect(sendMessageMock).toHaveBeenCalledWith(
      tabId,
      { action: 'focusByRef', ref: 'ref_3' },
      { frameId: 12 },
    );
  });
});

describe('BaseBrowserToolExecutor content script injection', () => {
  class InjectingTool extends BaseBrowserToolExecutor {
    name = 'chrome_read_page';

    async execute() {
      return { content: [], isError: false };
    }

    async inject(files: string[], frameIds?: number[]) {
      return (
        this as unknown as {
          injectContentScript: (
            tabId: number,
            files: string[],
            injectImmediately: boolean,
            world: 'ISOLATED',
            allFrames: boolean,
            frameIds?: number[],
          ) => Promise<void>;
        }
      ).injectContentScript(654, files, false, 'ISOLATED', false, frameIds);
    }
  }

  it('injects a second helper even when the tool ping is already answered', async () => {
    const executeScriptMock = vi.fn().mockResolvedValue([]);
    // A previously injected helper (for example accessibility-tree-helper) answers the ping of
    // the tool that is calling now. Injection must still happen: this call may need a different
    // helper file than the one already in the page.
    const sendMessageMock = vi.fn().mockResolvedValue({ status: 'pong' });
    (globalThis.chrome as any).scripting = { executeScript: executeScriptMock };
    (chrome.tabs as any).sendMessage = sendMessageMock;

    await new InjectingTool().inject(['inject-scripts/interactive-elements-helper.js']);

    expect(executeScriptMock).toHaveBeenCalledTimes(1);
    expect(executeScriptMock.mock.calls[0][0]).toMatchObject({
      files: ['inject-scripts/interactive-elements-helper.js'],
      world: 'ISOLATED',
    });
    expect(sendMessageMock).not.toHaveBeenCalled();
  });
});
