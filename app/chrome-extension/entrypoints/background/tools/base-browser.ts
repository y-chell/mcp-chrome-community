import { ToolExecutor } from '@/common/tool-handler';
import type { ToolResult } from '@/common/tool-handler';
import { TIMEOUTS, ERROR_MESSAGES } from '@/common/constants';
import { getRefTargetFrameId } from '@/utils/ref-target-store';

/**
 * Base class for browser tool executors
 */
export abstract class BaseBrowserToolExecutor implements ToolExecutor {
  abstract name: string;
  abstract execute(args: any): Promise<ToolResult>;

  /**
   * Inject content script into tab
   */
  protected async injectContentScript(
    tabId: number,
    files: string[],
    injectImmediately = false,
    world: 'MAIN' | 'ISOLATED' = 'ISOLATED',
    allFrames: boolean = false,
    frameIds?: number[],
  ): Promise<void> {
    console.log(`Injecting ${files.join(', ')} into tab ${tabId}`);

    // No "already injected?" probe: every helper carries its own __*_INITIALIZED__ guard, so
    // re-injecting a file is a no-op. The old probe keyed on `${this.name}_ping`, which made a
    // tool that needs a SECOND helper skip that injection whenever the first helper answered the
    // ping (chrome_read_page + interactive-elements-helper), and it also paid a 300ms race on
    // the first injection into a tab.
    try {
      const target: { tabId: number; allFrames?: boolean; frameIds?: number[] } = { tabId };
      if (frameIds && frameIds.length > 0) {
        target.frameIds = frameIds;
      } else if (allFrames) {
        target.allFrames = true;
      }
      await chrome.scripting.executeScript({
        target,
        files,
        injectImmediately,
        world,
      } as any);
      console.log(`'${files.join(', ')}' injection successful for tab ${tabId}`);
    } catch (injectionError) {
      const errorMessage =
        injectionError instanceof Error ? injectionError.message : String(injectionError);
      console.error(
        `Content script '${files.join(', ')}' injection failed for tab ${tabId}: ${errorMessage}`,
      );
      throw new Error(
        `${ERROR_MESSAGES.TOOL_EXECUTION_FAILED}: Failed to inject content script in tab ${tabId}: ${errorMessage}`,
      );
    }
  }

  /**
   * Send message to tab
   */
  protected async sendMessageToTab(tabId: number, message: any, frameId?: number): Promise<any> {
    try {
      const resolvedFrameId =
        typeof frameId === 'number' ? frameId : this.resolveFrameIdFromMessage(tabId, message);
      const response =
        typeof resolvedFrameId === 'number'
          ? await chrome.tabs.sendMessage(tabId, message, { frameId: resolvedFrameId })
          : await chrome.tabs.sendMessage(tabId, message);

      if (response && response.error) {
        throw new Error(String(response.error));
      }

      return response;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error(
        `Error sending message to tab ${tabId} for action ${message?.action || 'unknown'}: ${errorMessage}`,
      );

      if (error instanceof Error) {
        throw error;
      }
      throw new Error(errorMessage);
    }
  }

  protected resolveFrameIdForRef(
    tabId: number,
    ref?: string,
    explicitFrameId?: number,
  ): number | undefined {
    if (typeof explicitFrameId === 'number') return explicitFrameId;
    if (typeof ref !== 'string' || !ref.trim()) return undefined;
    return getRefTargetFrameId(tabId, ref);
  }

  private resolveFrameIdFromMessage(tabId: number, message: any): number | undefined {
    if (!message || typeof message !== 'object') return undefined;

    const candidateRef =
      typeof message.ref === 'string'
        ? message.ref
        : typeof message.refId === 'string'
          ? message.refId
          : undefined;

    return this.resolveFrameIdForRef(tabId, candidateRef);
  }

  /**
   * Try to get an existing tab by id. Returns null when not found.
   */
  protected async tryGetTab(tabId?: number): Promise<chrome.tabs.Tab | null> {
    if (typeof tabId !== 'number') return null;
    try {
      return await chrome.tabs.get(tabId);
    } catch {
      return null;
    }
  }

  /**
   * Get the active tab in the current window. Throws when not found.
   */
  protected async getActiveTabOrThrow(): Promise<chrome.tabs.Tab> {
    const [active] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!active || !active.id) throw new Error('Active tab not found');
    return active;
  }

  /**
   * Optionally focus window and/or activate tab. Defaults preserve current behavior
   * when caller sets activate/focus flags explicitly.
   */
  protected async ensureFocus(
    tab: chrome.tabs.Tab,
    options: { activate?: boolean; focusWindow?: boolean } = {},
  ): Promise<void> {
    const activate = options.activate === true;
    const focusWindow = options.focusWindow === true;
    if (focusWindow && typeof tab.windowId === 'number') {
      await chrome.windows.update(tab.windowId, { focused: true });
    }
    if (activate && typeof tab.id === 'number') {
      await chrome.tabs.update(tab.id, { active: true });
    }
  }

  /**
   * Get the active tab. When windowId provided, search within that window; otherwise currentWindow.
   */
  protected async getActiveTabInWindow(windowId?: number): Promise<chrome.tabs.Tab | null> {
    if (typeof windowId === 'number') {
      const tabs = await chrome.tabs.query({ active: true, windowId });
      return tabs && tabs[0] ? tabs[0] : null;
    }
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    return tabs && tabs[0] ? tabs[0] : null;
  }

  /**
   * Same as getActiveTabInWindow, but throws if not found.
   */
  protected async getActiveTabOrThrowInWindow(windowId?: number): Promise<chrome.tabs.Tab> {
    const tab = await this.getActiveTabInWindow(windowId);
    if (!tab || !tab.id) throw new Error('Active tab not found');
    return tab;
  }
}
