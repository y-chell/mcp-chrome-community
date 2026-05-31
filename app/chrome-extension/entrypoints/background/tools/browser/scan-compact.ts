import { createErrorResponse, type ToolResult } from '@/common/tool-handler';
import { ERROR_MESSAGES } from '@/common/constants';
import { TOOL_MESSAGE_TYPES } from '@/common/message-types';
import { rememberRefTargets } from '@/utils/ref-target-store';
import { BaseBrowserToolExecutor } from '../base-browser';
import { TOOL_NAMES } from 'chrome-mcp-shared';

interface ScanCompactParams {
  tabId?: number;
  windowId?: number;
  frameId?: number;
  maxElements?: number;
  maxTextBlocks?: number;
  includeTextBlocks?: boolean;
  includeIframes?: boolean;
  includeCoordinates?: boolean;
}

interface FrameDescriptor {
  frameId: number;
  url?: string;
}

interface ScanCompactResponse {
  success: boolean;
  error?: string;
  title?: string;
  url?: string;
  readyState?: string;
  viewport?: Record<string, unknown>;
  counts?: Record<string, number>;
  elements?: unknown[];
  forms?: unknown[];
  overlays?: unknown[];
  iframes?: unknown[];
  textBlocks?: unknown[];
  truncated?: Record<string, boolean>;
  refMap?: Array<{ ref?: string; selector?: string; rect?: unknown; frameId?: number }>;
}

class ScanCompactTool extends BaseBrowserToolExecutor {
  name = TOOL_NAMES.BROWSER.SCAN_COMPACT;

  private createJsonSuccess(payload: Record<string, unknown>): ToolResult {
    return {
      content: [{ type: 'text', text: JSON.stringify(payload) }],
      isError: false,
    };
  }

  private clampInt(value: unknown, fallback: number, min: number, max: number): number {
    const num = typeof value === 'number' ? value : Number(value);
    if (!Number.isFinite(num)) return fallback;
    return Math.max(min, Math.min(max, Math.floor(num)));
  }

  private async getReadableFrames(tabId: number): Promise<FrameDescriptor[]> {
    try {
      const frames = await chrome.webNavigation.getAllFrames({ tabId });
      if (Array.isArray(frames) && frames.length > 0) {
        return frames
          .filter((frame) => Number.isInteger(frame.frameId) && frame.frameId >= 0)
          .map((frame) => ({ frameId: frame.frameId, url: frame.url }));
      }
    } catch (error) {
      console.warn('scan_compact: failed to enumerate frames, falling back to top frame', error);
    }

    return [{ frameId: 0 }];
  }

  private mergeCounts(frames: Array<{ counts?: Record<string, number> }>): Record<string, number> {
    const total: Record<string, number> = {};
    for (const frame of frames) {
      for (const [key, value] of Object.entries(frame.counts || {})) {
        if (typeof value === 'number' && Number.isFinite(value)) {
          total[key] = (total[key] || 0) + value;
        }
      }
    }
    return total;
  }

  async execute(args: ScanCompactParams): Promise<ToolResult> {
    const maxElements = this.clampInt(args?.maxElements ?? 80, 80, 1, 200);
    const maxTextBlocks = this.clampInt(args?.maxTextBlocks ?? 20, 20, 0, 80);
    const includeTextBlocks = args?.includeTextBlocks !== false;
    const includeIframes = args?.includeIframes !== false;
    const includeCoordinates = args?.includeCoordinates !== false;

    const requestedFrameId =
      args?.frameId === undefined ? undefined : this.clampInt(args.frameId, -1, 0, 1_000_000);
    if (typeof requestedFrameId === 'number' && requestedFrameId < 0) {
      return createErrorResponse(
        `${ERROR_MESSAGES.INVALID_PARAMETERS}: frameId must be a non-negative integer`,
      );
    }

    try {
      const explicit = await this.tryGetTab(args?.tabId);
      const tab = explicit || (await this.getActiveTabOrThrowInWindow(args?.windowId));
      if (!tab.id) {
        return createErrorResponse(ERROR_MESSAGES.TAB_NOT_FOUND + ': Active tab has no ID');
      }

      const allFrames = await this.getReadableFrames(tab.id);
      const frames =
        typeof requestedFrameId === 'number'
          ? allFrames.filter((frame) => frame.frameId === requestedFrameId)
          : allFrames;
      const framesToScan =
        frames.length > 0
          ? frames
          : typeof requestedFrameId === 'number'
            ? [{ frameId: requestedFrameId }]
            : [{ frameId: 0, url: tab.url }];
      const frameIds = framesToScan.map((frame) => frame.frameId);

      await this.injectContentScript(
        tab.id,
        ['inject-scripts/accessibility-tree-helper.js'],
        false,
        'ISOLATED',
        typeof requestedFrameId !== 'number',
        typeof requestedFrameId === 'number' ? [requestedFrameId] : undefined,
      );

      const scannedFrames: Array<Record<string, unknown> & { counts?: Record<string, number> }> =
        [];
      const errors: string[] = [];

      for (const frame of framesToScan) {
        try {
          const response = (await this.sendMessageToTab(
            tab.id,
            {
              action: TOOL_MESSAGE_TYPES.SCAN_COMPACT,
              maxElements,
              maxTextBlocks,
              includeTextBlocks,
              includeIframes,
              includeCoordinates,
            },
            frame.frameId,
          )) as ScanCompactResponse;

          if (!response?.success) {
            errors.push(`frame ${frame.frameId}: ${response?.error || 'scan failed'}`);
            continue;
          }

          const refMap = Array.isArray(response.refMap)
            ? response.refMap.map((entry) => ({ ...entry, frameId: frame.frameId }))
            : [];
          if (refMap.length > 0) {
            rememberRefTargets(tab.id, refMap);
          }

          scannedFrames.push({
            frameId: frame.frameId,
            isTopFrame: frame.frameId === 0,
            frameUrl: frame.url || response.url || '',
            title: response.title || '',
            url: response.url || frame.url || '',
            readyState: response.readyState || 'unknown',
            viewport: response.viewport || null,
            counts: response.counts || {},
            elements: response.elements || [],
            forms: response.forms || [],
            overlays: response.overlays || [],
            iframes: response.iframes || [],
            textBlocks: response.textBlocks || [],
            truncated: response.truncated || {},
            refMapCount: refMap.length,
          });
        } catch (error) {
          errors.push(
            `frame ${frame.frameId}: ${error instanceof Error ? error.message : String(error)}`,
          );
        }
      }

      if (scannedFrames.length === 0) {
        return createErrorResponse(errors[0] || 'No readable frames could be scanned');
      }

      const topFrame = scannedFrames.find((frame) => frame.isTopFrame) || scannedFrames[0];

      return this.createJsonSuccess({
        success: true,
        tool: this.name,
        tabId: tab.id,
        windowId: tab.windowId,
        title: topFrame.title || tab.title || '',
        url: topFrame.url || tab.url || '',
        viewport: topFrame.viewport || null,
        frameCount: frameIds.length,
        framesScanned: scannedFrames.length,
        counts: this.mergeCounts(scannedFrames),
        limits: {
          maxElements,
          maxTextBlocks,
          includeTextBlocks,
          includeIframes,
          includeCoordinates,
        },
        frames: scannedFrames,
        errors,
        tips: 'Use returned ref values with chrome_click_element/chrome_fill_or_select/chrome_computer. If the target is missing, try chrome_read_page or chrome_screenshot.',
      });
    } catch (error) {
      return createErrorResponse(
        `Error scanning page compactly: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}

export const scanCompactTool = new ScanCompactTool();
