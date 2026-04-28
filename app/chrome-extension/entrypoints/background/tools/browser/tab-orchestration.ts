import { createErrorResponse, type ToolResult } from '@/common/tool-handler';
import { BaseBrowserToolExecutor } from '../base-browser';
import { TOOL_NAMES } from 'chrome-mcp-shared';

type MatchMode = 'contains' | 'equals' | 'regex';
type TabWaitStatus = 'any' | 'loading' | 'complete';

interface ListFramesParams {
  tabId?: number;
  windowId?: number;
  includeDetails?: boolean;
}

interface WaitForTabParams {
  openerTabId?: number;
  windowId?: number;
  urlPattern?: string;
  titlePattern?: string;
  match?: MatchMode;
  status?: TabWaitStatus;
  active?: boolean;
  includeExisting?: boolean;
  timeoutMs?: number;
}

interface FrameRuntimeDetails {
  title?: string;
  readyState?: string;
  interactiveElementCount?: number;
  hasInteractiveElements?: boolean;
}

function matchValue(observed: string, expected: string, mode: MatchMode): boolean {
  switch (mode) {
    case 'equals':
      return observed === expected;
    case 'regex':
      return new RegExp(expected).test(observed);
    case 'contains':
    default:
      return observed.includes(expected);
  }
}

function buildFrameDepth(
  frameId: number,
  parents: Map<number, number>,
  cache = new Map<number, number>(),
): number {
  if (cache.has(frameId)) return cache.get(frameId)!;
  const parentFrameId = parents.get(frameId);
  if (typeof parentFrameId !== 'number' || parentFrameId < 0 || parentFrameId === frameId) {
    cache.set(frameId, 0);
    return 0;
  }
  const depth = 1 + buildFrameDepth(parentFrameId, parents, cache);
  cache.set(frameId, depth);
  return depth;
}

class ListFramesTool extends BaseBrowserToolExecutor {
  name = TOOL_NAMES.BROWSER.LIST_FRAMES;

  private createJsonSuccess(payload: Record<string, unknown>): ToolResult {
    return {
      content: [{ type: 'text', text: JSON.stringify(payload) }],
      isError: false,
    };
  }

  async execute(args: ListFramesParams): Promise<ToolResult> {
    try {
      const explicit = await this.tryGetTab(args?.tabId);
      const tab = explicit || (await this.getActiveTabOrThrowInWindow(args?.windowId));
      if (!tab.id) return createErrorResponse('Active tab has no ID');

      let frames = await chrome.webNavigation.getAllFrames({ tabId: tab.id }).catch(() => []);
      if (!Array.isArray(frames) || frames.length === 0) {
        frames = [{ frameId: 0, parentFrameId: -1, url: tab.url || '' }] as any;
      }

      const includeDetails = args?.includeDetails !== false;
      const detailsByFrame = new Map<number, FrameRuntimeDetails>();

      if (includeDetails) {
        for (const frame of frames) {
          if (typeof frame.frameId !== 'number' || frame.frameId < 0) continue;
          try {
            const injected = await chrome.scripting.executeScript({
              target: {
                tabId: tab.id,
                frameIds: [frame.frameId],
              } as chrome.scripting.InjectionTarget,
              world: 'MAIN',
              func: () => {
                const interactiveCount = document.querySelectorAll(
                  'a[href], button, input, select, textarea, [role="button"], [role="link"], [role="textbox"], [tabindex]:not([tabindex="-1"])',
                ).length;
                return {
                  title: document.title || '',
                  readyState: document.readyState || 'unknown',
                  interactiveElementCount: interactiveCount,
                  hasInteractiveElements: interactiveCount > 0,
                };
              },
            });
            const result = Array.isArray(injected) ? injected[0]?.result : undefined;
            if (result && typeof result === 'object') {
              detailsByFrame.set(frame.frameId, result as FrameRuntimeDetails);
            }
          } catch {
            detailsByFrame.set(frame.frameId, {
              title: '',
              readyState: 'unavailable',
              interactiveElementCount: 0,
              hasInteractiveElements: false,
            });
          }
        }
      }

      const parentMap = new Map<number, number>();
      for (const frame of frames) {
        if (typeof frame.frameId === 'number') {
          parentMap.set(
            frame.frameId,
            typeof frame.parentFrameId === 'number' ? frame.parentFrameId : -1,
          );
        }
      }
      const depthCache = new Map<number, number>();

      const normalizedFrames = frames
        .filter((frame) => typeof frame.frameId === 'number' && frame.frameId >= 0)
        .map((frame) => {
          const frameId = frame.frameId;
          const details = detailsByFrame.get(frameId) || {};
          return {
            frameId,
            parentFrameId: typeof frame.parentFrameId === 'number' ? frame.parentFrameId : -1,
            depth: buildFrameDepth(frameId, parentMap, depthCache),
            isTopFrame: frameId === 0,
            url: frame.url || '',
            title: details.title || '',
            readyState: details.readyState || undefined,
            interactiveElementCount:
              typeof details.interactiveElementCount === 'number'
                ? details.interactiveElementCount
                : undefined,
            hasInteractiveElements: details.hasInteractiveElements ?? undefined,
          };
        })
        .sort((a, b) => a.depth - b.depth || a.frameId - b.frameId);

      return this.createJsonSuccess({
        success: true,
        tool: this.name,
        tabId: tab.id,
        windowId: tab.windowId,
        frameCount: normalizedFrames.length,
        frames: normalizedFrames,
      });
    } catch (error) {
      return createErrorResponse(
        `Error listing frames: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}

class WaitForTabTool extends BaseBrowserToolExecutor {
  name = TOOL_NAMES.BROWSER.WAIT_FOR_TAB;

  private createJsonSuccess(payload: Record<string, unknown>): ToolResult {
    return {
      content: [{ type: 'text', text: JSON.stringify(payload) }],
      isError: false,
    };
  }

  private getTimeoutMs(args: WaitForTabParams): number {
    return Math.max(100, Math.min(Number(args?.timeoutMs ?? 10000), 120000));
  }

  private matchesBasic(tab: chrome.tabs.Tab, args: WaitForTabParams): boolean {
    if (typeof args.windowId === 'number' && tab.windowId !== args.windowId) return false;
    if (typeof args.openerTabId === 'number' && tab.openerTabId !== args.openerTabId) return false;
    if (typeof args.active === 'boolean' && tab.active !== args.active) return false;
    return true;
  }

  private matchesFull(tab: chrome.tabs.Tab, args: WaitForTabParams): boolean {
    if (!this.matchesBasic(tab, args)) return false;

    const mode: MatchMode = args.match || 'contains';
    const urlPattern = typeof args.urlPattern === 'string' ? args.urlPattern.trim() : '';
    const titlePattern = typeof args.titlePattern === 'string' ? args.titlePattern.trim() : '';
    const desiredStatus: TabWaitStatus = args.status || 'complete';

    if (urlPattern) {
      const observedUrl = String(tab.url || '');
      if (!matchValue(observedUrl, urlPattern, mode)) return false;
    }

    if (titlePattern) {
      const observedTitle = String(tab.title || '');
      if (!matchValue(observedTitle, titlePattern, mode)) return false;
    }

    if (desiredStatus !== 'any' && tab.status !== desiredStatus) return false;

    return true;
  }

  private serializeTab(tab: chrome.tabs.Tab, matchedBy: string, openedAfterStart: boolean) {
    return {
      tabId: tab.id,
      windowId: tab.windowId,
      openerTabId: tab.openerTabId,
      url: tab.url,
      title: tab.title,
      status: tab.status,
      active: tab.active,
      index: tab.index,
      matchedBy,
      openedAfterStart,
    };
  }

  async execute(args: WaitForTabParams): Promise<ToolResult> {
    const timeoutMs = this.getTimeoutMs(args || {});

    try {
      const startedAt = Date.now();
      const baselineTabs = await chrome.tabs.query({});
      const trackedTabIds = new Set<number>();
      const includeExisting = args?.includeExisting === true;
      const hasMatcher =
        typeof args?.openerTabId === 'number' ||
        (typeof args?.urlPattern === 'string' && args.urlPattern.trim().length > 0) ||
        (typeof args?.titlePattern === 'string' && args.titlePattern.trim().length > 0) ||
        typeof args?.windowId === 'number' ||
        typeof args?.active === 'boolean';
      const allowImmediateExisting =
        typeof args?.openerTabId === 'number' || (includeExisting && hasMatcher);

      const existingBasicMatches = baselineTabs.filter((tab) => this.matchesBasic(tab, args || {}));
      for (const tab of existingBasicMatches) {
        if (typeof tab.id === 'number') trackedTabIds.add(tab.id);
      }

      if (allowImmediateExisting) {
        const existingFullMatch = existingBasicMatches.find((tab) =>
          this.matchesFull(tab, args || {}),
        );
        if (existingFullMatch?.id !== undefined) {
          return this.createJsonSuccess({
            success: true,
            tool: this.name,
            waitedMs: 0,
            tab: this.serializeTab(existingFullMatch, 'existing', false),
          });
        }
      }

      return await new Promise<ToolResult>((resolve) => {
        const timeoutHandle = setTimeout(() => {
          finishError(`wait_for_tab timed out after ${timeoutMs}ms`);
        }, timeoutMs);

        const cleanup = () => {
          if (timeoutHandle) clearTimeout(timeoutHandle);
          try {
            chrome.tabs.onCreated.removeListener(onCreated);
          } catch {}
          try {
            chrome.tabs.onUpdated.removeListener(onUpdated);
          } catch {}
        };

        const finishSuccess = (tab: chrome.tabs.Tab, matchedBy: 'created' | 'updated') => {
          cleanup();
          resolve(
            this.createJsonSuccess({
              success: true,
              tool: this.name,
              waitedMs: Date.now() - startedAt,
              tab: this.serializeTab(tab, matchedBy, true),
            }),
          );
        };

        const finishError = (message: string) => {
          cleanup();
          resolve(createErrorResponse(message));
        };

        const maybeResolve = async (
          tabId: number,
          fallbackTab: chrome.tabs.Tab | undefined,
          matchedBy: 'created' | 'updated',
        ) => {
          try {
            const tab = fallbackTab?.id === tabId ? fallbackTab : await chrome.tabs.get(tabId);
            if (this.matchesFull(tab, args || {})) {
              finishSuccess(tab, matchedBy);
            }
          } catch {
            // ignore transient tab lookup failures
          }
        };

        const onCreated = (tab: chrome.tabs.Tab) => {
          if (typeof tab.id !== 'number') return;
          if (!this.matchesBasic(tab, args || {})) return;
          trackedTabIds.add(tab.id);
          void maybeResolve(tab.id, tab, 'created');
        };

        const onUpdated = (
          _tabId: number,
          _changeInfo: chrome.tabs.TabChangeInfo,
          tab: chrome.tabs.Tab,
        ) => {
          if (typeof tab.id !== 'number') return;
          if (!trackedTabIds.has(tab.id)) return;
          void maybeResolve(tab.id, tab, 'updated');
        };

        chrome.tabs.onCreated.addListener(onCreated);
        chrome.tabs.onUpdated.addListener(onUpdated);
      });
    } catch (error) {
      return createErrorResponse(
        `Error waiting for tab: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}

export const listFramesTool = new ListFramesTool();
export const waitForTabTool = new WaitForTabTool();
