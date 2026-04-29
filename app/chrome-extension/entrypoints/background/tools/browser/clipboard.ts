import { createErrorResponse, type ToolResult } from '@/common/tool-handler';
import { MessageTarget, OFFSCREEN_MESSAGE_TYPES } from '@/common/message-types';
import { BaseBrowserToolExecutor } from '../base-browser';
import { offscreenManager } from '@/utils/offscreen-manager';
import { TOOL_NAMES } from 'chrome-mcp-shared';

type ClipboardAction = 'read_text' | 'write_text' | 'paste_text' | 'copy_selection';
type SelectorType = 'css' | 'xpath';

interface ClipboardToolParams {
  action: ClipboardAction;
  text?: string;
  ref?: string;
  selector?: string;
  selectorType?: SelectorType;
  tabId?: number;
  windowId?: number;
  frameId?: number;
}

interface ClipboardOffscreenResponse {
  success?: boolean;
  text?: string;
  error?: string;
}

function jsonSuccess(payload: Record<string, unknown>): ToolResult {
  return {
    content: [{ type: 'text', text: JSON.stringify(payload) }],
    isError: false,
  };
}

async function sendClipboardMessage(
  type:
    | typeof OFFSCREEN_MESSAGE_TYPES.CLIPBOARD_READ_TEXT
    | typeof OFFSCREEN_MESSAGE_TYPES.CLIPBOARD_WRITE_TEXT,
  payload: Record<string, unknown> = {},
): Promise<ClipboardOffscreenResponse> {
  await offscreenManager.ensureOffscreenDocument();
  const response = (await chrome.runtime.sendMessage({
    target: MessageTarget.Offscreen,
    type,
    ...payload,
  })) as ClipboardOffscreenResponse | undefined;
  if (!response) return { success: false, error: 'No response from offscreen clipboard handler' };
  return response;
}

function pickFrameIds(frameId?: number): number[] | undefined {
  return typeof frameId === 'number' ? [frameId] : undefined;
}

function buildInjectionTarget(tabId: number, frameId?: number): chrome.scripting.InjectionTarget {
  const target: chrome.scripting.InjectionTarget = { tabId };
  const frameIds = pickFrameIds(frameId);
  if (frameIds) target.frameIds = frameIds;
  return target;
}

class ClipboardTool extends BaseBrowserToolExecutor {
  name = TOOL_NAMES.BROWSER.CLIPBOARD;

  private async getTargetTab(args: ClipboardToolParams): Promise<chrome.tabs.Tab> {
    const explicit = await this.tryGetTab(args.tabId);
    return explicit || (await this.getActiveTabOrThrowInWindow(args.windowId));
  }

  private async focusTargetByRef(tabId: number, args: ClipboardToolParams): Promise<void> {
    if (!args.ref) return;
    const frameIds = pickFrameIds(args.frameId);
    await this.injectContentScript(
      tabId,
      ['inject-scripts/accessibility-tree-helper.js'],
      false,
      'ISOLATED',
      false,
      frameIds,
    );
    const response = await this.sendMessageToTab(
      tabId,
      { action: 'focusByRef', ref: args.ref },
      args.frameId,
    );
    if (!response || response.success !== true) {
      throw new Error(response?.error || `Failed to focus ref ${args.ref}`);
    }
  }

  private async writeText(text: string): Promise<'offscreen' | 'page-fallback'> {
    const response = await sendClipboardMessage(OFFSCREEN_MESSAGE_TYPES.CLIPBOARD_WRITE_TEXT, {
      text,
    });
    if (response.success) return 'offscreen';
    throw new Error(response.error || 'Clipboard write failed');
  }

  private async readText(): Promise<string> {
    const response = await sendClipboardMessage(OFFSCREEN_MESSAGE_TYPES.CLIPBOARD_READ_TEXT);
    if (!response.success) throw new Error(response.error || 'Clipboard read failed');
    return String(response.text ?? '');
  }

  private async writeTextWithPageFallback(args: ClipboardToolParams, text: string) {
    try {
      const source = await this.writeText(text);
      return { source };
    } catch (offscreenError) {
      const tab = await this.getTargetTab(args);
      if (!tab.id) throw offscreenError;
      const [result] = await chrome.scripting.executeScript({
        target: buildInjectionTarget(tab.id, args.frameId),
        world: 'MAIN',
        func: (value: string) => {
          const textarea = document.createElement('textarea');
          textarea.value = value;
          textarea.style.position = 'fixed';
          textarea.style.left = '-9999px';
          textarea.style.top = '-9999px';
          document.body.appendChild(textarea);
          textarea.focus();
          textarea.select();
          try {
            const copied = document.execCommand('copy');
            return {
              success: copied,
              error: copied ? undefined : 'document.execCommand("copy") returned false',
            };
          } finally {
            textarea.remove();
          }
        },
        args: [text],
      });
      const payload = result?.result as { success?: boolean; error?: string } | undefined;
      if (!payload?.success) {
        throw new Error(payload?.error || 'Clipboard page fallback failed');
      }
      return { source: 'page-fallback' as const };
    }
  }

  private async pasteText(args: ClipboardToolParams, text: string): Promise<ToolResult> {
    const tab = await this.getTargetTab(args);
    if (!tab.id) return createErrorResponse('Target tab has no ID');
    if (args.ref) await this.focusTargetByRef(tab.id, args);

    const [result] = await chrome.scripting.executeScript({
      target: buildInjectionTarget(tab.id, args.frameId),
      world: 'MAIN',
      func: (options: { text: string; selector?: string; selectorType?: SelectorType }) => {
        const findByXPath = (xpath: string): Element | null => {
          const found = document.evaluate(
            xpath,
            document,
            null,
            XPathResult.FIRST_ORDERED_NODE_TYPE,
            null,
          );
          return found.singleNodeValue instanceof Element ? found.singleNodeValue : null;
        };
        const target =
          options.selector && options.selectorType === 'xpath'
            ? findByXPath(options.selector)
            : options.selector
              ? document.querySelector(options.selector)
              : document.activeElement;

        if (!target) return { success: false, error: 'No paste target found' };
        const element = target as HTMLElement;
        element.focus?.();

        let dataTransfer: DataTransfer | undefined;
        try {
          dataTransfer = new DataTransfer();
          dataTransfer.setData('text/plain', options.text);
        } catch {
          dataTransfer = undefined;
        }

        try {
          const pasteEvent = new ClipboardEvent('paste', {
            bubbles: true,
            cancelable: true,
            clipboardData: dataTransfer,
          });
          const notCancelled = element.dispatchEvent(pasteEvent);
          if (!notCancelled) {
            return { success: true, inserted: false, handledBy: 'paste-event' };
          }
        } catch {
          // Some pages/browsers restrict synthetic ClipboardEvent construction.
        }

        const active = document.activeElement as HTMLElement | null;
        const editable = active && active.isContentEditable;
        const inputLike =
          active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement;

        if (inputLike) {
          const start = active.selectionStart ?? active.value.length;
          const end = active.selectionEnd ?? active.value.length;
          active.setRangeText(options.text, start, end, 'end');
          active.dispatchEvent(new InputEvent('input', { bubbles: true, data: options.text }));
          active.dispatchEvent(new Event('change', { bubbles: true }));
          return {
            success: true,
            inserted: true,
            target: active.tagName.toLowerCase(),
            method: 'setRangeText',
          };
        }

        if (editable) {
          const selection = window.getSelection();
          if (selection && selection.rangeCount > 0) {
            selection.deleteFromDocument();
            selection.getRangeAt(0).insertNode(document.createTextNode(options.text));
            selection.collapseToEnd();
          } else {
            active!.appendChild(document.createTextNode(options.text));
          }
          active!.dispatchEvent(new InputEvent('input', { bubbles: true, data: options.text }));
          return {
            success: true,
            inserted: true,
            target: active!.tagName.toLowerCase(),
            method: 'contenteditable',
          };
        }

        return {
          success: true,
          inserted: false,
          target: element.tagName.toLowerCase(),
          method: 'paste-event-only',
        };
      },
      args: [
        {
          text,
          selector: args.selector,
          selectorType: args.selectorType || 'css',
        },
      ],
    });

    const payload = result?.result as
      | { success?: boolean; error?: string; inserted?: boolean; target?: string; method?: string }
      | undefined;
    if (!payload?.success) return createErrorResponse(payload?.error || 'paste_text failed');
    return jsonSuccess({
      success: true,
      action: 'paste_text',
      length: text.length,
      inserted: payload.inserted === true,
      target: payload.target,
      method: payload.method,
    });
  }

  private async copySelection(args: ClipboardToolParams): Promise<ToolResult> {
    const tab = await this.getTargetTab(args);
    if (!tab.id) return createErrorResponse('Target tab has no ID');
    if (args.ref) await this.focusTargetByRef(tab.id, args);

    const [result] = await chrome.scripting.executeScript({
      target: buildInjectionTarget(tab.id, args.frameId),
      world: 'MAIN',
      func: (options: { selector?: string; selectorType?: SelectorType }) => {
        const findByXPath = (xpath: string): Element | null => {
          const found = document.evaluate(
            xpath,
            document,
            null,
            XPathResult.FIRST_ORDERED_NODE_TYPE,
            null,
          );
          return found.singleNodeValue instanceof Element ? found.singleNodeValue : null;
        };
        const target =
          options.selector && options.selectorType === 'xpath'
            ? findByXPath(options.selector)
            : options.selector
              ? document.querySelector(options.selector)
              : document.activeElement;

        if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) {
          const start = target.selectionStart ?? 0;
          const end = target.selectionEnd ?? target.value.length;
          const text = start === end ? target.value : target.value.slice(start, end);
          return { success: true, text, source: 'input' };
        }

        const selectionText = String(window.getSelection()?.toString() || '');
        if (selectionText) return { success: true, text: selectionText, source: 'selection' };
        if (target) return { success: true, text: target.textContent || '', source: 'target' };
        return { success: false, error: 'No selection or target text found' };
      },
      args: [{ selector: args.selector, selectorType: args.selectorType || 'css' }],
    });

    const payload = result?.result as
      | { success?: boolean; error?: string; text?: string; source?: string }
      | undefined;
    if (!payload?.success) return createErrorResponse(payload?.error || 'copy_selection failed');

    const text = String(payload.text || '');
    const write = await this.writeTextWithPageFallback(args, text);
    return jsonSuccess({
      success: true,
      action: 'copy_selection',
      text,
      length: text.length,
      source: payload.source,
      clipboardTransport: write.source,
    });
  }

  async execute(args: ClipboardToolParams): Promise<ToolResult> {
    const action = args?.action;
    if (!action) return createErrorResponse('action is required');

    try {
      switch (action) {
        case 'read_text': {
          const text = await this.readText();
          return jsonSuccess({ success: true, action, text, length: text.length });
        }
        case 'write_text': {
          if (typeof args.text !== 'string') return createErrorResponse('text is required');
          const write = await this.writeTextWithPageFallback(args, args.text);
          return jsonSuccess({
            success: true,
            action,
            length: args.text.length,
            clipboardTransport: write.source,
          });
        }
        case 'paste_text': {
          const text = typeof args.text === 'string' ? args.text : await this.readText();
          if (typeof args.text === 'string') {
            await this.writeTextWithPageFallback(args, text).catch(() => undefined);
          }
          return await this.pasteText(args, text);
        }
        case 'copy_selection':
          return await this.copySelection(args);
        default:
          return createErrorResponse(`Unsupported clipboard action: ${action}`);
      }
    } catch (error) {
      return createErrorResponse(
        `Clipboard ${action} failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}

export const clipboardTool = new ClipboardTool();
