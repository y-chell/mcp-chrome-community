import { createErrorResponse, ToolResult } from '@/common/tool-handler';
import { BaseBrowserToolExecutor } from '../base-browser';
import { TOOL_NAMES } from 'chrome-mcp-shared';
import { networkCaptureStartTool, networkCaptureStopTool } from './network-capture-web-request';
import { networkDebuggerStartTool, networkDebuggerStopTool } from './network-capture-debugger';

type NetworkCaptureBackend = 'webRequest' | 'debugger';

interface NetworkCaptureToolParams {
  action: 'start' | 'stop';
  needResponseBody?: boolean;
  url?: string;
  maxCaptureTime?: number;
  inactivityTimeout?: number;
  includeStatic?: boolean;
}

export interface WaitForCapturedRequestOptions {
  tabId: number;
  urlPattern?: string;
  method?: string;
  status?: number;
  timeoutMs: number;
  startedAfter?: number;
  includeStatic?: boolean;
}

/**
 * Extract text content from ToolResult
 */
function getFirstText(result: ToolResult): string | undefined {
  const first = result.content?.[0];
  return first && first.type === 'text' ? first.text : undefined;
}

/**
 * Decorate JSON result with additional fields
 */
function decorateJsonResult(result: ToolResult, extra: Record<string, unknown>): ToolResult {
  const text = getFirstText(result);
  if (typeof text !== 'string') return result;

  try {
    const parsed = JSON.parse(text);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return {
        ...result,
        content: [{ type: 'text', text: JSON.stringify({ ...parsed, ...extra }) }],
      };
    }
  } catch {
    // If the underlying tool didn't return JSON, keep it as-is
  }
  return result;
}

/**
 * Check if debugger-based capture is active
 */
function isDebuggerCaptureActive(): boolean {
  const captureData = (
    networkDebuggerStartTool as unknown as { captureData?: Map<number, unknown> }
  ).captureData;
  return captureData instanceof Map && captureData.size > 0;
}

/**
 * Check if webRequest-based capture is active
 */
function isWebRequestCaptureActive(): boolean {
  return networkCaptureStartTool.captureData.size > 0;
}

function getDebuggerCaptureMap(): Map<number, any> {
  const captureData = (
    networkDebuggerStartTool as unknown as { captureData?: Map<number, unknown> }
  ).captureData;
  return captureData instanceof Map ? captureData : new Map();
}

function getDebuggerCaptureInfo(tabId: number): any | undefined {
  return getDebuggerCaptureMap().get(tabId);
}

function getWebRequestCaptureInfo(tabId: number): any | undefined {
  return networkCaptureStartTool.captureData.get(tabId);
}

function getLatestCompletedDebuggerCapture(): { completedAt: number } | undefined {
  return (
    networkDebuggerStartTool as unknown as {
      peekLatestCompletedCapture?: () => { completedAt: number } | undefined;
    }
  ).peekLatestCompletedCapture?.();
}

function getLatestCompletedWebRequestCapture(): { completedAt: number } | undefined {
  return networkCaptureStartTool.peekLatestCompletedCapture?.();
}

function listCapturedRequests(captureInfo: any): any[] {
  if (!captureInfo || typeof captureInfo !== 'object') return [];
  const requests = captureInfo.requests;
  if (!requests || typeof requests !== 'object') return [];
  return Object.values(requests);
}

function isCompletedRequest(request: any): boolean {
  if (!request || typeof request !== 'object') return false;
  if (request.status === 'complete' || request.status === 'error') return true;
  if (typeof request.status === 'number') return true;
  if (typeof request.statusCode === 'number') return true;
  if (typeof request.responseTime === 'number') return true;
  if (typeof request.errorText === 'string' && request.errorText.trim()) return true;
  return false;
}

function matchesCapturedRequest(request: any, opts: WaitForCapturedRequestOptions): boolean {
  if (!request || typeof request !== 'object') return false;
  if (typeof opts.startedAfter === 'number' && Number.isFinite(opts.startedAfter)) {
    const requestTime =
      typeof request.requestTime === 'number'
        ? request.requestTime
        : typeof request.responseTime === 'number'
          ? request.responseTime
          : undefined;
    if (typeof requestTime === 'number' && requestTime < opts.startedAfter) {
      return false;
    }
  }
  if (opts.urlPattern) {
    const haystack = String(request.url || '').toLowerCase();
    if (!haystack.includes(opts.urlPattern.toLowerCase())) return false;
  }
  if (opts.method) {
    if (String(request.method || '').toUpperCase() !== opts.method.toUpperCase()) return false;
  }
  if (typeof opts.status === 'number') {
    const statusValue =
      typeof request.status === 'number'
        ? request.status
        : typeof request.statusCode === 'number'
          ? request.statusCode
          : undefined;
    if (statusValue !== opts.status) return false;
  }
  return true;
}

export async function waitForCapturedRequest(opts: WaitForCapturedRequestOptions) {
  const startTime = Date.now();
  const timeoutMs = Math.max(1000, Math.min(Number(opts.timeoutMs || 10000), 120000));
  const pollIntervalMs = 100;
  const activeDebugger = getDebuggerCaptureInfo(opts.tabId);
  const activeWebRequest = getWebRequestCaptureInfo(opts.tabId);
  const useActiveDebugger = !!activeDebugger;
  const useActiveWebRequest = !!activeWebRequest;
  let tempCaptureStarted = false;

  if (!useActiveDebugger && !useActiveWebRequest) {
    await networkCaptureStartTool.startCaptureForTab(opts.tabId, {
      maxCaptureTime: timeoutMs + 1000,
      inactivityTimeout: timeoutMs + 1000,
      includeStatic: opts.includeStatic === true,
    });
    tempCaptureStarted = true;
  }

  try {
    while (Date.now() - startTime <= timeoutMs) {
      const backend = getDebuggerCaptureInfo(opts.tabId) ? 'debugger' : 'webRequest';
      const captureInfo =
        backend === 'debugger'
          ? getDebuggerCaptureInfo(opts.tabId)
          : getWebRequestCaptureInfo(opts.tabId);
      const matched = listCapturedRequests(captureInfo)
        .filter((request) => matchesCapturedRequest(request, opts))
        .find((request) => isCompletedRequest(request));

      if (matched) {
        return {
          backend,
          request: matched,
          tookMs: Date.now() - startTime,
        };
      }

      await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
    }

    throw new Error('Network wait timed out');
  } finally {
    if (tempCaptureStarted) {
      await networkCaptureStartTool.stopCapture(opts.tabId).catch(() => undefined);
    }
  }
}

/**
 * Unified Network Capture Tool
 *
 * Provides a single entry point for network capture, automatically selecting
 * the appropriate backend based on the `needResponseBody` parameter:
 * - needResponseBody=false (default): uses webRequest API (lightweight, no debugger conflict)
 * - needResponseBody=true: uses Debugger API (captures response body, may conflict with DevTools)
 */
class NetworkCaptureTool extends BaseBrowserToolExecutor {
  name = TOOL_NAMES.BROWSER.NETWORK_CAPTURE;

  async execute(args: NetworkCaptureToolParams): Promise<ToolResult> {
    const action = args?.action;
    if (action !== 'start' && action !== 'stop') {
      return createErrorResponse('Parameter [action] is required and must be one of: start, stop');
    }

    const wantBody = args?.needResponseBody === true;
    const debuggerActive = isDebuggerCaptureActive();
    const webActive = isWebRequestCaptureActive();

    if (action === 'start') {
      return this.handleStart(args, wantBody, debuggerActive, webActive);
    }

    return this.handleStop(args, debuggerActive, webActive);
  }

  private async handleStart(
    args: NetworkCaptureToolParams,
    wantBody: boolean,
    debuggerActive: boolean,
    webActive: boolean,
  ): Promise<ToolResult> {
    // Prevent any capture conflict (cross-mode or same-mode)
    if (debuggerActive || webActive) {
      const activeMode = debuggerActive ? 'debugger' : 'webRequest';
      return createErrorResponse(
        `Network capture is already active in ${activeMode} mode. Stop it before starting a new capture.`,
      );
    }

    const delegate = wantBody ? networkDebuggerStartTool : networkCaptureStartTool;
    const backend: NetworkCaptureBackend = wantBody ? 'debugger' : 'webRequest';

    const result = await delegate.execute({
      url: args.url,
      maxCaptureTime: args.maxCaptureTime,
      inactivityTimeout: args.inactivityTimeout,
      includeStatic: args.includeStatic,
    });

    return decorateJsonResult(result, { backend, needResponseBody: wantBody });
  }

  private async handleStop(
    args: NetworkCaptureToolParams,
    debuggerActive: boolean,
    webActive: boolean,
  ): Promise<ToolResult> {
    // Determine which backend to stop
    let backendToStop: NetworkCaptureBackend | null = null;

    // If user explicitly specified needResponseBody, try to stop that specific backend
    if (args?.needResponseBody === true) {
      backendToStop = debuggerActive ? 'debugger' : null;
    } else if (args?.needResponseBody === false) {
      backendToStop = webActive ? 'webRequest' : null;
    }

    // If no explicit preference or the specified backend isn't active, auto-detect
    if (!backendToStop) {
      if (debuggerActive) {
        backendToStop = 'debugger';
      } else if (webActive) {
        backendToStop = 'webRequest';
      } else if (args?.needResponseBody === true && getLatestCompletedDebuggerCapture()) {
        backendToStop = 'debugger';
      } else if (args?.needResponseBody === false && getLatestCompletedWebRequestCapture()) {
        backendToStop = 'webRequest';
      } else {
        const latestDebugger = getLatestCompletedDebuggerCapture();
        const latestWebRequest = getLatestCompletedWebRequestCapture();
        if (latestDebugger || latestWebRequest) {
          backendToStop =
            (latestDebugger?.completedAt || 0) >= (latestWebRequest?.completedAt || 0)
              ? 'debugger'
              : 'webRequest';
        }
      }
    }

    if (!backendToStop) {
      return createErrorResponse('No active network captures found in any tab.');
    }

    const delegateStop =
      backendToStop === 'debugger' ? networkDebuggerStopTool : networkCaptureStopTool;
    const result = await delegateStop.execute();

    return decorateJsonResult(result, {
      backend: backendToStop,
      needResponseBody: backendToStop === 'debugger',
    });
  }
}

export const networkCaptureTool = new NetworkCaptureTool();
