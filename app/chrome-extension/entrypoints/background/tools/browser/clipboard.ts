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

type ClipboardReadSource = 'page-navigator' | 'offscreen';
type ClipboardWriteSource = 'page-navigator' | 'offscreen' | 'page-exec-command';

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

function isScriptablePageUrl(url?: string): boolean {
  if (!url) return false;
  try {
    const parsed = new URL(url);
    return (
      parsed.protocol === 'http:' || parsed.protocol === 'https:' || parsed.protocol === 'file:'
    );
  } catch {
    return false;
  }
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

  private async tryGetTargetTab(args: ClipboardToolParams): Promise<chrome.tabs.Tab | null> {
    try {
      return await this.getTargetTab(args);
    } catch {
      return null;
    }
  }

  private async writeTextViaOffscreen(text: string): Promise<'offscreen'> {
    const response = await sendClipboardMessage(OFFSCREEN_MESSAGE_TYPES.CLIPBOARD_WRITE_TEXT, {
      text,
    });
    if (response.success) return 'offscreen';
    throw new Error(response.error || 'Clipboard write failed');
  }

  private async readTextViaOffscreen(): Promise<{ text: string; source: 'offscreen' }> {
    const response = await sendClipboardMessage(OFFSCREEN_MESSAGE_TYPES.CLIPBOARD_READ_TEXT);
    if (!response.success) throw new Error(response.error || 'Clipboard read failed');
    return { text: String(response.text ?? ''), source: 'offscreen' };
  }

  private async readTextViaFocusedPage(
    args: ClipboardToolParams,
  ): Promise<{ text: string; source: 'page-navigator' }> {
    const tab = await this.tryGetTargetTab(args);
    if (!tab?.id) throw new Error('No scriptable target tab found for page clipboard read');
    if (!isScriptablePageUrl(tab.url)) {
      throw new Error(`Page clipboard read is not supported on this URL: ${tab.url || 'unknown'}`);
    }

    await this.ensureFocus(tab, { activate: true, focusWindow: true });

    const [result] = await chrome.scripting.executeScript({
      target: buildInjectionTarget(tab.id),
      world: 'MAIN',
      func: async () => {
        if (!navigator.clipboard?.readText) {
          return {
            success: false,
            error: 'navigator.clipboard.readText is unavailable in this page context',
          };
        }

        try {
          const text = await navigator.clipboard.readText();
          return {
            success: true,
            text,
            focused: document.hasFocus(),
          };
        } catch (error) {
          return {
            success: false,
            error: error instanceof Error ? error.message : String(error),
            focused: document.hasFocus(),
          };
        }
      },
    });

    const payload = result?.result as
      | { success?: boolean; text?: string; error?: string; focused?: boolean }
      | undefined;
    if (!payload?.success) {
      throw new Error(payload?.error || 'Page clipboard read failed');
    }
    return { text: String(payload.text ?? ''), source: 'page-navigator' };
  }

  private async writeTextViaFocusedPage(
    args: ClipboardToolParams,
    text: string,
  ): Promise<'page-navigator'> {
    const tab = await this.tryGetTargetTab(args);
    if (!tab?.id) throw new Error('No scriptable target tab found for page clipboard write');
    if (!isScriptablePageUrl(tab.url)) {
      throw new Error(`Page clipboard write is not supported on this URL: ${tab.url || 'unknown'}`);
    }

    await this.ensureFocus(tab, { activate: true, focusWindow: true });

    const [result] = await chrome.scripting.executeScript({
      target: buildInjectionTarget(tab.id),
      world: 'MAIN',
      func: async (value: string) => {
        if (!navigator.clipboard?.writeText) {
          return {
            success: false,
            error: 'navigator.clipboard.writeText is unavailable in this page context',
          };
        }

        try {
          await navigator.clipboard.writeText(value);
          return {
            success: true,
            focused: document.hasFocus(),
          };
        } catch (error) {
          return {
            success: false,
            error: error instanceof Error ? error.message : String(error),
            focused: document.hasFocus(),
          };
        }
      },
      args: [text],
    });

    const payload = result?.result as { success?: boolean; error?: string } | undefined;
    if (!payload?.success) {
      throw new Error(payload?.error || 'Page clipboard write failed');
    }
    return 'page-navigator';
  }

  private async writeTextViaExecCommand(
    args: ClipboardToolParams,
    text: string,
  ): Promise<'page-exec-command'> {
    const tab = await this.getTargetTab(args);
    if (!tab.id) throw new Error('Target tab has no ID');
    if (!isScriptablePageUrl(tab.url)) {
      throw new Error(
        `execCommand clipboard fallback is not supported on this URL: ${tab.url || 'unknown'}`,
      );
    }

    await this.ensureFocus(tab, { activate: true, focusWindow: true });

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
            focused: document.hasFocus(),
          };
        } finally {
          textarea.remove();
        }
      },
      args: [text],
    });
    const payload = result?.result as { success?: boolean; error?: string } | undefined;
    if (!payload?.success) {
      throw new Error(payload?.error || 'Clipboard page execCommand fallback failed');
    }
    return 'page-exec-command';
  }

  private async readText(args: ClipboardToolParams): Promise<{
    text: string;
    source: ClipboardReadSource;
    fallbackError?: string;
  }> {
    try {
      return await this.readTextViaFocusedPage(args);
    } catch (pageError) {
      const pageErrorMessage = pageError instanceof Error ? pageError.message : String(pageError);
      try {
        const offscreen = await this.readTextViaOffscreen();
        return { ...offscreen, fallbackError: pageErrorMessage };
      } catch (offscreenError) {
        const offscreenErrorMessage =
          offscreenError instanceof Error ? offscreenError.message : String(offscreenError);
        throw new Error(
          `Clipboard read failed: page=${pageErrorMessage}; offscreen=${offscreenErrorMessage}`,
        );
      }
    }
  }

  private async writeTextWithFallback(
    args: ClipboardToolParams,
    text: string,
  ): Promise<{
    source: ClipboardWriteSource;
    fallbackErrors: string[];
  }> {
    const fallbackErrors: string[] = [];

    try {
      const source = await this.writeTextViaFocusedPage(args, text);
      return { source, fallbackErrors };
    } catch (error) {
      fallbackErrors.push(error instanceof Error ? error.message : String(error));
    }

    try {
      const source = await this.writeTextViaOffscreen(text);
      return { source, fallbackErrors };
    } catch (error) {
      fallbackErrors.push(error instanceof Error ? error.message : String(error));
    }

    try {
      const source = await this.writeTextViaExecCommand(args, text);
      return { source, fallbackErrors };
    } catch (error) {
      fallbackErrors.push(error instanceof Error ? error.message : String(error));
    }

    throw new Error(`Clipboard write failed: ${fallbackErrors.join('; ')}`);
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
    try {
      const write = await this.writeTextWithFallback(args, text);
      return jsonSuccess({
        success: true,
        action: 'copy_selection',
        text,
        length: text.length,
        source: payload.source,
        clipboardWritten: true,
        clipboardTransport: write.source,
        clipboardFallbackErrors: write.fallbackErrors,
      });
    } catch (error) {
      return jsonSuccess({
        success: true,
        partialSuccess: true,
        action: 'copy_selection',
        text,
        length: text.length,
        source: payload.source,
        clipboardWritten: false,
        clipboardError: error instanceof Error ? error.message : String(error),
      });
    }
  }

  async execute(args: ClipboardToolParams): Promise<ToolResult> {
    const action = args?.action;
    if (!action) return createErrorResponse('action is required');

    try {
      switch (action) {
        case 'read_text': {
          const read = await this.readText(args);
          return jsonSuccess({
            success: true,
            action,
            text: read.text,
            length: read.text.length,
            clipboardTransport: read.source,
            clipboardFallbackError: read.fallbackError,
          });
        }
        case 'write_text': {
          if (typeof args.text !== 'string') return createErrorResponse('text is required');
          const write = await this.writeTextWithFallback(args, args.text);
          return jsonSuccess({
            success: true,
            action,
            length: args.text.length,
            clipboardTransport: write.source,
            clipboardFallbackErrors: write.fallbackErrors,
          });
        }
        case 'paste_text': {
          const read = typeof args.text === 'string' ? undefined : await this.readText(args);
          const text = typeof args.text === 'string' ? args.text : read!.text;
          if (typeof args.text === 'string') {
            await this.writeTextWithFallback(args, text).catch(() => undefined);
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
