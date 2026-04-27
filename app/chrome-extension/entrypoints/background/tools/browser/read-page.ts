import { createErrorResponse, ToolResult } from '@/common/tool-handler';
import { BaseBrowserToolExecutor } from '../base-browser';
import { TOOL_NAMES } from 'chrome-mcp-shared';
import { TOOL_MESSAGE_TYPES } from '@/common/message-types';
import { ERROR_MESSAGES } from '@/common/constants';
import { listMarkersForUrl } from '@/entrypoints/background/element-marker/element-marker-storage';
import { getRefTargetFrameId, rememberRefTargets } from '@/utils/ref-target-store';

interface ReadPageStats {
  processed: number;
  included: number;
  durationMs: number;
}

interface ReadPageViewport {
  width: number | null;
  height: number | null;
  dpr: number | null;
}

interface FrameTreeResult {
  frameId: number;
  url?: string;
  viewport: ReadPageViewport;
  pageContent: string;
  stats: ReadPageStats;
  refMap: Array<{ ref?: string; frameId?: number }>;
}

interface ReadPageParams {
  filter?: 'interactive'; // when omitted, return all visible elements
  depth?: number; // maximum DOM depth to traverse (0 = root only)
  refId?: string; // focus on subtree rooted at this refId
  tabId?: number; // target existing tab id
  windowId?: number; // when no tabId, pick active tab from this window
}

class ReadPageTool extends BaseBrowserToolExecutor {
  name = TOOL_NAMES.BROWSER.READ_PAGE;

  private async getReadableFrames(
    tabId: number,
  ): Promise<Array<{ frameId: number; url?: string }>> {
    try {
      const frames = await chrome.webNavigation.getAllFrames({ tabId });
      if (Array.isArray(frames) && frames.length > 0) {
        return frames
          .filter((frame) => Number.isInteger(frame.frameId) && frame.frameId >= 0)
          .map((frame) => ({ frameId: frame.frameId, url: frame.url }));
      }
    } catch (error) {
      console.warn('read_page: failed to enumerate frames, falling back to top frame only', error);
    }

    return [{ frameId: 0 }];
  }

  private formatFrameSection(
    frame: { frameId: number; url?: string },
    pageContent: string,
  ): string {
    const trimmed = pageContent.trim();
    if (!trimmed) return '';
    if (frame.frameId === 0) return trimmed;

    const suffix = frame.url ? ` ${frame.url}` : '';
    return `Frame ${frame.frameId}${suffix}\n${trimmed}`;
  }

  // Execute read page
  async execute(args: ReadPageParams): Promise<ToolResult> {
    const { filter, depth, refId } = args || {};

    // Validate refId parameter
    const focusRefId = typeof refId === 'string' ? refId.trim() : '';
    if (refId !== undefined && !focusRefId) {
      return createErrorResponse(
        `${ERROR_MESSAGES.INVALID_PARAMETERS}: refId must be a non-empty string`,
      );
    }

    // Validate depth parameter
    const requestedDepth = depth === undefined ? undefined : Number(depth);
    if (requestedDepth !== undefined && (!Number.isInteger(requestedDepth) || requestedDepth < 0)) {
      return createErrorResponse(
        `${ERROR_MESSAGES.INVALID_PARAMETERS}: depth must be a non-negative integer`,
      );
    }

    // Track if user explicitly controlled the output (skip sparse heuristics)
    const userControlled = requestedDepth !== undefined || !!focusRefId;

    try {
      // Tip text returned to callers to guide next action
      const standardTips =
        "If the specific element you need is missing from the returned data, use the 'screenshot' tool to capture the current viewport and confirm the element's on-screen coordinates. Also note: 'markedElements' are user-marked elements and have the highest priority when choosing targets.";

      const explicit = await this.tryGetTab(args?.tabId);
      const tab = explicit || (await this.getActiveTabOrThrowInWindow(args?.windowId));
      if (!tab.id)
        return createErrorResponse(ERROR_MESSAGES.TAB_NOT_FOUND + ': Active tab has no ID');

      // Load any user-marked elements for this URL (priority hints)
      const currentUrl = String(tab.url || '');
      const userMarkers = currentUrl ? await listMarkersForUrl(currentUrl) : [];

      // Inject helper in ISOLATED world to enable chrome.runtime messaging
      // Inject into all frames to support same-origin iframe operations
      await this.injectContentScript(
        tab.id,
        ['inject-scripts/accessibility-tree-helper.js'],
        false,
        'ISOLATED',
        true,
      );

      const frames = await this.getReadableFrames(tab.id);
      const rememberedFocusFrameId = focusRefId
        ? getRefTargetFrameId(tab.id, focusRefId)
        : undefined;
      const targetFrames =
        typeof rememberedFocusFrameId === 'number'
          ? frames.filter((frame) => frame.frameId === rememberedFocusFrameId)
          : frames;
      const framesToQuery =
        targetFrames.length > 0
          ? targetFrames
          : typeof rememberedFocusFrameId === 'number'
            ? [{ frameId: rememberedFocusFrameId }]
            : frames;

      const frameResults: FrameTreeResult[] = [];
      const frameErrors: string[] = [];

      for (const frame of framesToQuery) {
        try {
          const resp = await this.sendMessageToTab(
            tab.id,
            {
              action: TOOL_MESSAGE_TYPES.GENERATE_ACCESSIBILITY_TREE,
              filter: filter || null,
              depth: requestedDepth,
              refId: focusRefId || undefined,
            },
            frame.frameId,
          );

          if (!resp || resp.success !== true) {
            if (resp?.error) frameErrors.push(`frame ${frame.frameId}: ${resp.error}`);
            continue;
          }

          const refMap = Array.isArray(resp.refMap)
            ? resp.refMap.map((entry: any) => ({
                ...entry,
                frameId: frame.frameId,
              }))
            : [];
          if (refMap.length > 0) {
            rememberRefTargets(tab.id, refMap);
          }

          frameResults.push({
            frameId: frame.frameId,
            url: 'url' in frame ? frame.url : undefined,
            viewport: {
              width: resp.viewport?.width ?? null,
              height: resp.viewport?.height ?? null,
              dpr: resp.viewport?.dpr ?? null,
            },
            pageContent: typeof resp.pageContent === 'string' ? resp.pageContent : '',
            stats: {
              processed: resp.stats?.processed ?? 0,
              included: resp.stats?.included ?? 0,
              durationMs: resp.stats?.durationMs ?? 0,
            },
            refMap,
          });
        } catch (error) {
          frameErrors.push(
            `frame ${frame.frameId}: ${error instanceof Error ? error.message : String(error)}`,
          );
        }
      }

      const treeOk = frameResults.length > 0;
      const pageContent = frameResults
        .map((result) => {
          const frame = frames.find((item) => item.frameId === result.frameId) || {
            frameId: result.frameId,
            url: result.url,
          };
          return this.formatFrameSection(frame, result.pageContent);
        })
        .filter((section) => section.length > 0)
        .join('\n\n');

      const stats: ReadPageStats | null =
        frameResults.length > 0
          ? frameResults.reduce(
              (acc, result) => ({
                processed: acc.processed + result.stats.processed,
                included: acc.included + result.stats.included,
                durationMs: acc.durationMs + result.stats.durationMs,
              }),
              { processed: 0, included: 0, durationMs: 0 },
            )
          : null;

      const viewport: ReadPageViewport = frameResults.find((result) => result.frameId === 0)
        ?.viewport ||
        frameResults[0]?.viewport || { width: null, height: null, dpr: null };

      const lines = pageContent
        ? pageContent.split('\n').filter((l: string) => l.trim().length > 0).length
        : 0;
      const refCount = frameResults.reduce((sum, result) => sum + result.refMap.length, 0);

      // Skip sparse heuristics when user explicitly controls output
      const isSparse = !userControlled && lines < 10 && refCount < 3;

      // Build user-marked elements for inclusion
      const markedElements = userMarkers.map((m) => ({
        name: m.name,
        selector: m.selector,
        selectorType: m.selectorType || 'css',
        urlMatch: { type: m.matchType, origin: m.origin, path: m.path },
        source: 'marker',
        priority: 'highest',
      }));

      // Helper to convert elements array to pageContent format
      const formatElementsAsPageContent = (elements: any[]): string => {
        const out: string[] = [];
        for (const e of elements || []) {
          const type = typeof e?.type === 'string' && e.type ? e.type : 'element';
          const rawText = typeof e?.text === 'string' ? e.text.trim() : '';
          const text =
            rawText.length > 0
              ? ` "${rawText.replace(/\s+/g, ' ').slice(0, 100).replace(/"/g, '\\"')}"`
              : '';
          const selector =
            typeof e?.selector === 'string' && e.selector ? ` selector="${e.selector}"` : '';
          const coords =
            e?.coordinates && Number.isFinite(e.coordinates.x) && Number.isFinite(e.coordinates.y)
              ? ` (x=${Math.round(e.coordinates.x)},y=${Math.round(e.coordinates.y)})`
              : '';
          out.push(`- ${type}${text}${selector}${coords}`);
          if (out.length >= 150) break;
        }
        return out.join('\n');
      };

      // Unified base payload structure - consistent keys for stable contract
      const basePayload: Record<string, any> = {
        success: true,
        filter: filter || 'all',
        pageContent,
        tips: standardTips,
        viewport: treeOk ? viewport : { width: null, height: null, dpr: null },
        stats: stats || { processed: 0, included: 0, durationMs: 0 },
        refMapCount: refCount,
        sparse: treeOk ? isSparse : false,
        depth: requestedDepth ?? null,
        focus: focusRefId ? { refId: focusRefId, found: treeOk } : null,
        markedElements,
        elements: [],
        count: 0,
        fallbackUsed: false,
        fallbackSource: null,
        reason: null,
      };

      // Normal path: return tree
      if (treeOk && !isSparse) {
        return {
          content: [{ type: 'text', text: JSON.stringify(basePayload) }],
          isError: false,
        };
      }

      // When refId is explicitly provided, do not fallback (refs are frame-local and may expire)
      if (focusRefId) {
        return createErrorResponse(frameErrors[0] || `refId "${focusRefId}" not found or expired`);
      }

      // When user explicitly controls depth, do not override with fallback heuristics
      if (requestedDepth !== undefined) {
        return createErrorResponse(frameErrors[0] || 'Failed to generate accessibility tree');
      }

      // Fallback path: try get_interactive_elements once
      try {
        await this.injectContentScript(tab.id, ['inject-scripts/interactive-elements-helper.js']);
        const fallback = await this.sendMessageToTab(tab.id, {
          action: TOOL_MESSAGE_TYPES.GET_INTERACTIVE_ELEMENTS,
          includeCoordinates: true,
        });

        if (fallback && fallback.success && Array.isArray(fallback.elements)) {
          const limited = fallback.elements.slice(0, 150);
          // Merge user markers at the front, de-duplicated by selector
          const markerEls = userMarkers.map((m) => ({
            type: 'marker',
            selector: m.selector,
            text: m.name,
            selectorType: m.selectorType || 'css',
            isInteractive: true,
            source: 'marker',
            priority: 'highest',
          }));
          const seen = new Set(markerEls.map((e) => e.selector));
          const merged = [...markerEls, ...limited.filter((e: any) => !seen.has(e.selector))];

          basePayload.fallbackUsed = true;
          basePayload.fallbackSource = 'get_interactive_elements';
          basePayload.reason = treeOk ? 'sparse_tree' : frameErrors[0] || 'tree_failed';
          basePayload.elements = merged;
          basePayload.count = fallback.elements.length;
          if (!basePayload.pageContent) {
            basePayload.pageContent = formatElementsAsPageContent(merged);
          }

          return {
            content: [{ type: 'text', text: JSON.stringify(basePayload) }],
            isError: false,
          };
        }
      } catch (fallbackErr) {
        console.warn('read_page fallback failed:', fallbackErr);
      }

      // If we reach here, both tree (usable) and fallback failed
      return createErrorResponse(
        treeOk
          ? 'Accessibility tree is too sparse and fallback failed'
          : frameErrors[0] || 'Failed to generate accessibility tree and fallback failed',
      );
    } catch (error) {
      console.error('Error in read page tool:', error);
      return createErrorResponse(
        `Error generating accessibility tree: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}

export const readPageTool = new ReadPageTool();
