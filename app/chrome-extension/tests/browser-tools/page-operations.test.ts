import { beforeEach, describe, expect, it, vi } from 'vitest';

import { OFFSCREEN_MESSAGE_TYPES, MessageTarget } from '@/common/message-types';
import { computerTool } from '@/entrypoints/background/tools/browser/computer';
import { clipboardTool } from '@/entrypoints/background/tools/browser/clipboard';
import { fillTool } from '@/entrypoints/background/tools/browser/interaction';
import { tabGroupTool } from '@/entrypoints/background/tools/browser/tab-group';
import { offscreenManager } from '@/utils/offscreen-manager';

function parseJsonResult(result: { content?: Array<{ type: string; text?: string }> }) {
  const text = result.content?.[0]?.text;
  return JSON.parse(String(text || '{}'));
}

describe('high-value page operation tools', () => {
  const tabId = 9;

  beforeEach(() => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
    offscreenManager.reset();
    delete (chrome as any).scripting;
    (chrome as any).windows = {
      update: vi.fn().mockResolvedValue({}),
    };

    (chrome.tabs.query as any) = vi.fn().mockResolvedValue([
      {
        id: tabId,
        windowId: 1,
        url: 'https://example.com/form',
        title: 'Example',
        active: true,
        pinned: false,
        index: 0,
      },
    ]);
    (chrome.tabs.get as any) = vi.fn().mockResolvedValue({
      id: tabId,
      windowId: 1,
      url: 'https://example.com/form',
      title: 'Example',
      active: true,
      pinned: false,
      index: 0,
    });
  });

  it('writes clipboard text through the focused page when available', async () => {
    (chrome.runtime.sendMessage as any) = vi.fn().mockResolvedValue({ success: true });
    (chrome as any).scripting = {
      executeScript: vi.fn().mockResolvedValue([
        {
          result: {
            success: true,
            focused: true,
          },
        },
      ]),
    };

    const result = await clipboardTool.execute({
      action: 'write_text',
      text: 'hello clipboard',
      tabId,
    });

    expect(result.isError).toBe(false);
    expect(chrome.windows.update).toHaveBeenCalledWith(1, { focused: true });
    expect(chrome.tabs.update).toHaveBeenCalledWith(tabId, { active: true });
    expect(chrome.scripting.executeScript).toHaveBeenCalledWith(
      expect.objectContaining({
        target: { tabId },
        world: 'MAIN',
        args: ['hello clipboard'],
      }),
    );
    expect(chrome.runtime.sendMessage).not.toHaveBeenCalled();
    expect(parseJsonResult(result)).toMatchObject({
      success: true,
      action: 'write_text',
      length: 15,
      clipboardTransport: 'page-navigator',
    });
  });

  it('falls back to the offscreen document when page clipboard is unavailable', async () => {
    (chrome.runtime as any).getContexts = vi.fn().mockResolvedValue([]);
    (chrome as any).offscreen = {
      createDocument: vi.fn().mockResolvedValue(undefined),
    };
    (chrome.runtime.sendMessage as any) = vi.fn().mockResolvedValue({ success: true });

    const result = await clipboardTool.execute({
      action: 'write_text',
      text: 'hello clipboard',
      tabId,
    });

    expect(result.isError).toBe(false);
    expect(chrome.runtime.sendMessage).toHaveBeenCalledWith({
      target: MessageTarget.Offscreen,
      type: OFFSCREEN_MESSAGE_TYPES.CLIPBOARD_WRITE_TEXT,
      text: 'hello clipboard',
    });
    expect(parseJsonResult(result)).toMatchObject({
      success: true,
      action: 'write_text',
      length: 15,
      clipboardTransport: 'offscreen',
    });
  });

  it('returns selected text as partial success when clipboard write fails', async () => {
    (chrome.runtime as any).getContexts = vi.fn().mockResolvedValue([{ contextId: 'offscreen' }]);
    (chrome as any).offscreen = {
      createDocument: vi.fn().mockResolvedValue(undefined),
    };
    (chrome.runtime.sendMessage as any) = vi.fn().mockResolvedValue({
      success: false,
      error: 'offscreen denied',
    });
    (chrome as any).scripting = {
      executeScript: vi
        .fn()
        .mockResolvedValueOnce([
          {
            result: {
              success: true,
              text: 'selected text',
              source: 'selection',
            },
          },
        ])
        .mockResolvedValueOnce([
          {
            result: {
              success: false,
              error: 'page denied',
            },
          },
        ])
        .mockResolvedValueOnce([
          {
            result: {
              success: false,
              error: 'execCommand returned false',
            },
          },
        ]),
    };

    const result = await clipboardTool.execute({
      action: 'copy_selection',
      tabId,
    });

    expect(result.isError).toBe(false);
    expect(parseJsonResult(result)).toMatchObject({
      success: true,
      partialSuccess: true,
      action: 'copy_selection',
      text: 'selected text',
      length: 13,
      source: 'selection',
      clipboardWritten: false,
    });
  });

  it('pastes text into a targeted frame', async () => {
    (chrome.runtime as any).getContexts = vi.fn().mockResolvedValue([{ contextId: 'offscreen' }]);
    (chrome as any).offscreen = {
      createDocument: vi.fn().mockResolvedValue(undefined),
    };
    (chrome.runtime.sendMessage as any) = vi.fn().mockResolvedValue({ success: true });
    (chrome as any).scripting = {
      executeScript: vi.fn().mockResolvedValue([
        {
          result: {
            success: true,
            inserted: true,
            target: 'textarea',
            method: 'setRangeText',
          },
        },
      ]),
    };

    const result = await clipboardTool.execute({
      action: 'paste_text',
      text: 'hello',
      selector: '#message',
      frameId: 5,
      tabId,
    });

    expect(result.isError).toBe(false);
    expect(chrome.scripting.executeScript).toHaveBeenCalledWith(
      expect.objectContaining({
        target: { tabId, frameIds: [5] },
        args: [
          {
            text: 'hello',
            selector: '#message',
            selectorType: 'css',
          },
        ],
      }),
    );
    expect(parseJsonResult(result)).toMatchObject({
      success: true,
      action: 'paste_text',
      inserted: true,
      method: 'setRangeText',
    });
  });

  it('creates a tab group and returns grouped tabs', async () => {
    const group = {
      id: 4,
      windowId: 1,
      title: 'Research',
      color: 'blue',
      collapsed: false,
    };
    (chrome.tabs as any).group = vi.fn().mockResolvedValue(4);
    (chrome.tabs.query as any) = vi.fn().mockResolvedValue([
      {
        id: 10,
        windowId: 1,
        url: 'https://example.com/a',
        title: 'A',
        active: false,
        pinned: false,
        index: 0,
      },
      {
        id: 11,
        windowId: 1,
        url: 'https://example.com/b',
        title: 'B',
        active: true,
        pinned: false,
        index: 1,
      },
    ]);
    (chrome as any).tabGroups = {
      update: vi.fn().mockResolvedValue(group),
      get: vi.fn().mockResolvedValue(group),
      query: vi.fn().mockResolvedValue([group]),
      move: vi.fn(),
    };

    const result = await tabGroupTool.execute({
      action: 'create',
      tabIds: [10, 11],
      title: 'Research',
      color: 'blue',
    });

    expect(result.isError).toBe(false);
    expect(chrome.tabs.group).toHaveBeenCalledWith({
      tabIds: [10, 11],
    });
    expect(chrome.tabGroups.update).toHaveBeenCalledWith(4, {
      title: 'Research',
      color: 'blue',
    });
    expect(parseJsonResult(result)).toMatchObject({
      success: true,
      action: 'create',
      group: {
        groupId: 4,
        title: 'Research',
        tabCount: 2,
        tabIds: [10, 11],
      },
    });
  });

  it('fills complex forms by selector and keeps the target tab', async () => {
    const fillSpy = vi.spyOn(fillTool, 'execute').mockResolvedValue({
      content: [{ type: 'text', text: '{"success":true}' }],
      isError: false,
    });

    const result = await computerTool.execute({
      action: 'fill_form',
      tabId,
      elements: [
        { selector: '#email', value: 'a@example.com', frameId: 2 },
        { ref: 'ref_7', value: true },
      ],
    } as any);

    expect(result.isError).toBe(false);
    expect(fillSpy).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        tabId,
        selector: '#email',
        value: 'a@example.com',
        frameId: 2,
      }),
    );
    expect(fillSpy).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        tabId,
        ref: 'ref_7',
        value: true,
      }),
    );
    expect(parseJsonResult(result)).toMatchObject({
      success: true,
      action: 'fill_form',
      filled: 2,
      total: 2,
      attempted: 2,
    });
  });

  it('drags between selectors with interpolated mouse moves', async () => {
    vi.spyOn(computerTool as any, 'injectContentScript').mockResolvedValue(undefined);
    vi.spyOn(computerTool as any, 'sendMessageToTab').mockImplementation(
      async (_tabId: number, message: any) => {
        if (message.selector === '#source') {
          return { success: true, center: { x: 10, y: 20 } };
        }
        return { success: true, center: { x: 110, y: 220 } };
      },
    );
    (chrome.debugger as any).getTargets = vi.fn().mockResolvedValue([]);
    (chrome.debugger.attach as any) = vi.fn().mockResolvedValue(undefined);
    (chrome.debugger.detach as any) = vi.fn().mockResolvedValue(undefined);
    (chrome.debugger.sendCommand as any) = vi.fn().mockResolvedValue({});

    const result = await computerTool.execute({
      action: 'left_click_drag',
      tabId,
      startSelector: '#source',
      endSelector: '#target',
      dragSteps: 4,
      dragDurationMs: 0,
    } as any);

    expect(result.isError).toBe(false);
    const mouseMoves = (chrome.debugger.sendCommand as any).mock.calls.filter(
      (_call: unknown[]) =>
        _call[1] === 'Input.dispatchMouseEvent' && _call[2]?.type === 'mouseMoved',
    );
    expect(mouseMoves).toHaveLength(5);
    expect(parseJsonResult(result)).toMatchObject({
      success: true,
      action: 'left_click_drag',
      dragSteps: 4,
      dragDurationMs: 0,
    });
  });
});
