import { createErrorResponse, type ToolResult } from '@/common/tool-handler';
import { ERROR_MESSAGES } from '@/common/constants';
import { TOOL_MESSAGE_TYPES } from '@/common/message-types';
import { rememberRefTargets } from '@/utils/ref-target-store';
import { BaseBrowserToolExecutor } from '../base-browser';
import { TOOL_NAMES } from 'chrome-mcp-shared';

type SelectorType = 'css' | 'xpath';

interface QueryElementsParams {
  selector?: string;
  selectorType?: SelectorType;
  refId?: string;
  tabId?: number;
  windowId?: number;
  frameId?: number;
  includeHidden?: boolean;
  limit?: number;
}

interface GetElementHtmlParams {
  ref?: string;
  refId?: string;
  selector?: string;
  selectorType?: SelectorType;
  tabId?: number;
  windowId?: number;
  frameId?: number;
  includeOuterHtml?: boolean;
  maxLength?: number;
}

interface FrameDescriptor {
  frameId: number;
  url?: string;
}

interface DomToolResponse {
  success: boolean;
  error?: string;
  elements?: Array<Record<string, unknown>>;
  element?: Record<string, unknown>;
  refMap?: Array<{ ref?: string; frameId?: number }>;
  truncated?: boolean;
  totalMatches?: number;
}

abstract class DomQueryBaseTool extends BaseBrowserToolExecutor {
  protected createJsonSuccess(payload: Record<string, unknown>): ToolResult {
    return {
      content: [{ type: 'text', text: JSON.stringify(payload) }],
      isError: false,
    };
  }

  protected clampInt(value: unknown, fallback: number, min: number, max: number): number {
    const num = typeof value === 'number' ? value : Number(value);
    if (!Number.isFinite(num)) return fallback;
    return Math.max(min, Math.min(max, Math.floor(num)));
  }

  protected async resolveTargetTab(args: { tabId?: number; windowId?: number }) {
    const explicit = await this.tryGetTab(args.tabId);
    return explicit || (await this.getActiveTabOrThrowInWindow(args.windowId));
  }

  protected async getReadableFrames(tabId: number): Promise<FrameDescriptor[]> {
    try {
      const frames = await chrome.webNavigation.getAllFrames({ tabId });
      if (Array.isArray(frames) && frames.length > 0) {
        return frames
          .filter((frame) => Number.isInteger(frame.frameId) && frame.frameId >= 0)
          .map((frame) => ({ frameId: frame.frameId, url: frame.url }));
      }
    } catch (error) {
      console.warn('dom-query: failed to enumerate frames, falling back to top frame only', error);
    }

    return [{ frameId: 0 }];
  }

  protected async injectAccessibilityHelper(tabId: number, frameIds?: number[]): Promise<void> {
    await this.injectContentScript(
      tabId,
      ['inject-scripts/accessibility-tree-helper.js'],
      false,
      'ISOLATED',
      !frameIds || frameIds.length === 0,
      frameIds,
    );
  }

  protected rememberFrameRefs(
    tabId: number,
    frameId: number,
    refMap: Array<{ ref?: string; frameId?: number }> | undefined,
  ): void {
    if (!Array.isArray(refMap) || refMap.length === 0) return;
    rememberRefTargets(
      tabId,
      refMap.map((entry) => ({
        ...entry,
        frameId,
      })),
    );
  }
}

class QueryElementsTool extends DomQueryBaseTool {
  name = TOOL_NAMES.BROWSER.QUERY_ELEMENTS;

  async execute(args: QueryElementsParams): Promise<ToolResult> {
    const selector = typeof args.selector === 'string' ? args.selector.trim() : '';
    if (!selector) {
      return createErrorResponse(`${ERROR_MESSAGES.INVALID_PARAMETERS}: selector is required`);
    }

    const selectorType: SelectorType = args.selectorType === 'xpath' ? 'xpath' : 'css';
    const rootRefId = typeof args.refId === 'string' ? args.refId.trim() : '';
    const includeHidden = args.includeHidden === true;
    const limit = this.clampInt(args.limit ?? 25, 25, 1, 200);

    try {
      const tab = await this.resolveTargetTab(args);
      if (!tab.id) {
        return createErrorResponse(ERROR_MESSAGES.TAB_NOT_FOUND + ': Active tab has no ID');
      }

      const rootFrameId = rootRefId
        ? this.resolveFrameIdForRef(tab.id, rootRefId, args.frameId)
        : args.frameId;
      if (rootRefId && typeof rootFrameId !== 'number') {
        return createErrorResponse(
          `Unknown ref "${rootRefId}". Run chrome_read_page or chrome_query_elements again to refresh refs.`,
        );
      }

      const frames =
        typeof rootFrameId === 'number'
          ? [{ frameId: rootFrameId }]
          : await this.getReadableFrames(tab.id);
      const frameIds = frames.map((frame) => frame.frameId);

      await this.injectAccessibilityHelper(tab.id, frameIds.length > 0 ? frameIds : undefined);

      const elements: Array<Record<string, unknown>> = [];
      const matchedFrameIds = new Set<number>();
      const errors: string[] = [];
      let truncated = false;
      let totalMatches = 0;

      for (const frame of frames) {
        const remaining = limit - elements.length;
        if (remaining <= 0) {
          truncated = true;
          break;
        }

        try {
          const response = (await this.sendMessageToTab(
            tab.id,
            {
              action: TOOL_MESSAGE_TYPES.QUERY_ELEMENTS,
              selector,
              isXPath: selectorType === 'xpath',
              refId: rootRefId || undefined,
              includeHidden,
              limit: remaining,
            },
            frame.frameId,
          )) as DomToolResponse;

          if (!response?.success) {
            if (response?.error) errors.push(`frame ${frame.frameId}: ${response.error}`);
            continue;
          }

          this.rememberFrameRefs(tab.id, frame.frameId, response.refMap);

          const frameElements = Array.isArray(response.elements) ? response.elements : [];
          totalMatches += this.clampInt(
            response.totalMatches ?? frameElements.length,
            frameElements.length,
            0,
            1_000_000,
          );

          if (frameElements.length > 0) {
            matchedFrameIds.add(frame.frameId);
            for (const element of frameElements) {
              elements.push({
                ...element,
                frameId: frame.frameId,
              });
              if (elements.length >= limit) break;
            }
          }

          if (response.truncated === true) {
            truncated = true;
          }
        } catch (error) {
          errors.push(
            `frame ${frame.frameId}: ${error instanceof Error ? error.message : String(error)}`,
          );
        }
      }

      return this.createJsonSuccess({
        success: true,
        tool: this.name,
        tabId: tab.id,
        selector,
        selectorType,
        refId: rootRefId || undefined,
        includeHidden,
        count: elements.length,
        totalMatches,
        truncated,
        framesSearched: frameIds,
        matchedFrameIds: Array.from(matchedFrameIds),
        elements,
        errors,
      });
    } catch (error) {
      return createErrorResponse(
        `Error querying elements: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}

class GetElementHtmlTool extends DomQueryBaseTool {
  name = TOOL_NAMES.BROWSER.GET_ELEMENT_HTML;

  async execute(args: GetElementHtmlParams): Promise<ToolResult> {
    const ref = typeof args.ref === 'string' ? args.ref.trim() : '';
    const refId = typeof args.refId === 'string' ? args.refId.trim() : '';
    if (ref && refId && ref !== refId) {
      return createErrorResponse(
        `${ERROR_MESSAGES.INVALID_PARAMETERS}: ref and refId must match when both are provided`,
      );
    }

    const finalRef = ref || refId;
    const selector = typeof args.selector === 'string' ? args.selector.trim() : '';
    if (!finalRef && !selector) {
      return createErrorResponse(
        `${ERROR_MESSAGES.INVALID_PARAMETERS}: provide ref/refId or selector`,
      );
    }

    const selectorType: SelectorType = args.selectorType === 'xpath' ? 'xpath' : 'css';
    const includeOuterHtml = args.includeOuterHtml !== false;
    const maxLength = this.clampInt(args.maxLength ?? 20_000, 20_000, 100, 200_000);

    try {
      const tab = await this.resolveTargetTab(args);
      if (!tab.id) {
        return createErrorResponse(ERROR_MESSAGES.TAB_NOT_FOUND + ': Active tab has no ID');
      }

      const resolvedFrameId = finalRef
        ? this.resolveFrameIdForRef(tab.id, finalRef, args.frameId)
        : args.frameId;
      if (finalRef && typeof resolvedFrameId !== 'number') {
        return createErrorResponse(
          `Unknown ref "${finalRef}". Run chrome_read_page or chrome_query_elements again to refresh refs.`,
        );
      }

      const frames =
        typeof resolvedFrameId === 'number'
          ? [{ frameId: resolvedFrameId }]
          : await this.getReadableFrames(tab.id);
      const frameIds = frames.map((frame) => frame.frameId);

      await this.injectAccessibilityHelper(tab.id, frameIds.length > 0 ? frameIds : undefined);

      const matches: Array<{ frameId: number; element: Record<string, unknown> }> = [];
      const errors: string[] = [];

      for (const frame of frames) {
        try {
          const response = (await this.sendMessageToTab(
            tab.id,
            {
              action: TOOL_MESSAGE_TYPES.GET_ELEMENT_HTML,
              ref: finalRef || undefined,
              selector: selector || undefined,
              isXPath: selectorType === 'xpath',
              includeOuterHtml,
              maxLength,
            },
            frame.frameId,
          )) as DomToolResponse;

          if (!response?.success) {
            if (response?.error) errors.push(`frame ${frame.frameId}: ${response.error}`);
            continue;
          }

          this.rememberFrameRefs(tab.id, frame.frameId, response.refMap);

          if (response.element && typeof response.element === 'object') {
            matches.push({
              frameId: frame.frameId,
              element: response.element,
            });
          }
        } catch (error) {
          errors.push(
            `frame ${frame.frameId}: ${error instanceof Error ? error.message : String(error)}`,
          );
        }
      }

      if (matches.length === 0) {
        const target = finalRef || selector;
        return createErrorResponse(
          errors[0] ||
            `Element not found for ${finalRef ? `ref "${target}"` : `selector "${target}"`}`,
        );
      }

      if (!finalRef && matches.length > 1) {
        return createErrorResponse(
          `Selector "${selector}" matched multiple elements across frames. Provide frameId or refine the selector.`,
        );
      }

      const match = matches[0];
      return this.createJsonSuccess({
        success: true,
        tool: this.name,
        tabId: tab.id,
        frameId: match.frameId,
        ref: match.element.ref,
        selector,
        selectorType: selector ? selectorType : undefined,
        includeOuterHtml,
        maxLength,
        ...match.element,
        errors,
      });
    } catch (error) {
      return createErrorResponse(
        `Error getting element HTML: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}

export const queryElementsTool = new QueryElementsTool();
export const getElementHtmlTool = new GetElementHtmlTool();
