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
