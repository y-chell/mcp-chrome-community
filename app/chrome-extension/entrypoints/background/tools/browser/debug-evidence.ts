import { createErrorResponse, ToolResult } from '@/common/tool-handler';
import { BaseBrowserToolExecutor } from '../base-browser';
import { TOOL_NAMES } from 'chrome-mcp-shared';
import { consoleTool } from './console';
import { consoleBuffer } from './console-buffer';
import { screenshotTool } from './screenshot';
import { networkCaptureStartTool } from './network-capture-web-request';
import { networkDebuggerStartTool } from './network-capture-debugger';

type DebugConsoleMode = 'auto' | 'buffer' | 'snapshot';
type NetworkBackend = 'webRequest' | 'debugger';
type NetworkSource = 'active' | 'completed';

interface DebugEvidenceToolParams {
  tabId?: number;
  windowId?: number;
  includeScreenshot?: boolean;
  background?: boolean;
  fullPage?: boolean;
  includeConsole?: boolean;
  consoleMode?: DebugConsoleMode;
  includeExceptions?: boolean;
  onlyErrors?: boolean;
  consoleLimit?: number;
  includeExtensionConsole?: boolean;
  clearConsole?: boolean;
  clearConsoleAfterRead?: boolean;
  includeNetworkSummary?: boolean;
  networkLimit?: number;
}

interface NetworkCaptureCandidate {
  backend: NetworkBackend;
  source: NetworkSource;
  active: boolean;
  tabId: number;
  completedAt?: number;
  reason?: string;
  payload: Record<string, unknown>;
}

function getFirstText(result: ToolResult): string {
  const first = result.content?.[0];
  return first && first.type === 'text' && typeof first.text === 'string' ? first.text : '';
}

function parseJsonToolResult(result: ToolResult): {
  ok: boolean;
  data?: Record<string, unknown>;
  error?: string;
} {
  const text = getFirstText(result);
  if (result.isError) {
    return { ok: false, error: text || 'Unknown tool error' };
  }

  try {
    const parsed = JSON.parse(text);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return { ok: true, data: parsed as Record<string, unknown> };
    }
    return { ok: false, error: 'Tool returned non-object JSON.' };
  } catch (error) {
    return {
      ok: false,
      error: `Tool returned invalid JSON: ${
        error instanceof Error ? error.message : String(error)
      }`,
    };
  }
}

function normalizeLimit(value: unknown, fallback: number, max: number): number {
  const numeric =
    typeof value === 'number' && Number.isFinite(value) ? Math.floor(value) : fallback;
  return Math.max(1, Math.min(numeric, max));
}

function isErrorLevel(level?: unknown): boolean {
  const normalized = typeof level === 'string' ? level.toLowerCase() : '';
  return normalized === 'error' || normalized === 'assert';
}

type ConsoleSourceKind = 'page' | 'extension' | 'third_party' | 'unknown';

function getEntrySourceUrl(entry: Record<string, unknown>): string {
  if (typeof entry.url === 'string' && entry.url.trim()) return entry.url.trim();

  const stackTrace = entry.stackTrace as Record<string, unknown> | undefined;
  const callFrames = stackTrace?.callFrames;
  if (Array.isArray(callFrames)) {
    const frame = callFrames.find(
      (item): item is Record<string, unknown> => !!item && typeof item === 'object',
    );
    if (typeof frame?.url === 'string' && frame.url.trim()) return frame.url.trim();
  }

  return '';
}

function classifyConsoleSource(sourceUrl: string, pageUrl: string): ConsoleSourceKind {
  if (!sourceUrl) return 'unknown';
  try {
    const parsedSource = new URL(sourceUrl);
    if (
      parsedSource.protocol === 'chrome-extension:' ||
      parsedSource.protocol === 'moz-extension:' ||
      parsedSource.protocol === 'safari-web-extension:'
    ) {
      return 'extension';
    }

    const parsedPage = new URL(pageUrl);
    return parsedSource.origin === parsedPage.origin ? 'page' : 'third_party';
  } catch {
    return 'unknown';
  }
}

function consoleSourceRank(kind: ConsoleSourceKind): number {
  switch (kind) {
    case 'page':
      return 0;
    case 'unknown':
      return 1;
    case 'third_party':
      return 2;
    case 'extension':
      return 3;
    default:
      return 4;
  }
}

function sourceGroupKey(sourceUrl: string, kind: ConsoleSourceKind): string {
  if (!sourceUrl) return `${kind}:`;
  try {
    const parsed = new URL(sourceUrl);
    return `${kind}:${parsed.origin}`;
  } catch {
    return `${kind}:${sourceUrl}`;
  }
}

function buildSourceGroupSummary(items: Array<Record<string, unknown>>) {
  const groups = new Map<
    string,
    {
      sourceKind: ConsoleSourceKind;
      sourceUrl: string;
      count: number;
      errorCount: number;
      lastSeenAt?: number;
    }
  >();

  for (const item of items) {
    const sourceKind =
      typeof item.sourceKind === 'string' ? (item.sourceKind as ConsoleSourceKind) : 'unknown';
    const sourceUrl = typeof item.sourceUrl === 'string' ? item.sourceUrl : '';
    const key = sourceGroupKey(sourceUrl, sourceKind);
    const timestamp =
      typeof item.timestamp === 'number' && Number.isFinite(item.timestamp)
        ? item.timestamp
        : undefined;
    const existing = groups.get(key);
    if (existing) {
      existing.count += 1;
      if (isErrorLevel(item.level)) existing.errorCount += 1;
      if ((timestamp || 0) >= (existing.lastSeenAt || 0)) {
        existing.lastSeenAt = timestamp;
      }
      continue;
    }

    groups.set(key, {
      sourceKind,
      sourceUrl,
      count: 1,
      errorCount: isErrorLevel(item.level) ? 1 : 0,
      lastSeenAt: timestamp,
    });
  }

  return Array.from(groups.values()).sort(
    (a, b) =>
      consoleSourceRank(a.sourceKind) - consoleSourceRank(b.sourceKind) ||
      b.errorCount - a.errorCount ||
      (b.lastSeenAt || 0) - (a.lastSeenAt || 0),
  );
}

function prioritizeConsoleItems<T extends Record<string, unknown>>(
  items: T[],
  pageUrl: string,
  includeExtensionConsole: boolean,
  options: { exception?: boolean } = {},
): {
  items: Array<T & { sourceUrl: string; sourceKind: ConsoleSourceKind }>;
  filteredOutExtensionCount: number;
} {
  const classified = items.map((item) => {
    const sourceUrl = getEntrySourceUrl(item);
    return {
      ...item,
      sourceUrl,
      sourceKind: classifyConsoleSource(sourceUrl, pageUrl),
    };
  });

  const filtered = includeExtensionConsole
    ? classified
    : classified.filter((item) => item.sourceKind !== 'extension');

  const sorted = [...filtered].sort((a, b) => {
    const sourceDelta = consoleSourceRank(a.sourceKind) - consoleSourceRank(b.sourceKind);
    if (sourceDelta !== 0) return sourceDelta;

    const aError = options.exception || isErrorLevel(a.level) ? 0 : 1;
    const bError = options.exception || isErrorLevel(b.level) ? 0 : 1;
    if (aError !== bError) return aError - bError;

    const aTime = typeof a.timestamp === 'number' && Number.isFinite(a.timestamp) ? a.timestamp : 0;
    const bTime = typeof b.timestamp === 'number' && Number.isFinite(b.timestamp) ? b.timestamp : 0;
    return bTime - aTime;
  });

  return {
    items: sorted,
    filteredOutExtensionCount: classified.length - filtered.length,
  };
}

function summarizeExceptions(exceptions: Array<Record<string, unknown>>) {
  const groups = new Map<
    string,
    {
      message: string;
      count: number;
      lastSeenAt?: number;
      url?: string;
      lineNumber?: number;
      columnNumber?: number;
    }
  >();

  for (const exception of exceptions) {
    const message =
      typeof exception.text === 'string' && exception.text.trim()
        ? exception.text.trim()
        : 'Unknown exception';
    const key = message;
    const existing = groups.get(key);
    const timestamp =
      typeof exception.timestamp === 'number' && Number.isFinite(exception.timestamp)
        ? exception.timestamp
        : undefined;
    if (existing) {
      existing.count += 1;
      if ((timestamp || 0) >= (existing.lastSeenAt || 0)) {
        existing.lastSeenAt = timestamp;
        existing.url = typeof exception.url === 'string' ? exception.url : existing.url;
        existing.lineNumber =
          typeof exception.lineNumber === 'number' ? exception.lineNumber : existing.lineNumber;
        existing.columnNumber =
          typeof exception.columnNumber === 'number'
            ? exception.columnNumber
            : existing.columnNumber;
      }
    } else {
      groups.set(key, {
        message,
        count: 1,
        lastSeenAt: timestamp,
        url: typeof exception.url === 'string' ? exception.url : undefined,
        lineNumber: typeof exception.lineNumber === 'number' ? exception.lineNumber : undefined,
        columnNumber:
          typeof exception.columnNumber === 'number' ? exception.columnNumber : undefined,
      });
    }
  }

  return {
    total: exceptions.length,
    unique: groups.size,
    groups: Array.from(groups.values())
      .sort((a, b) => b.count - a.count || (b.lastSeenAt || 0) - (a.lastSeenAt || 0))
      .slice(0, 5),
  };
}

function normalizeRequest(request: Record<string, unknown>) {
  const statusValue =
    typeof request.statusCode === 'number'
      ? request.statusCode
      : typeof request.status === 'number'
        ? request.status
        : undefined;
  return {
    url: typeof request.url === 'string' ? request.url : '',
    method: typeof request.method === 'string' ? request.method : '',
    status: statusValue,
    state: typeof request.status === 'string' ? request.status : undefined,
    type: typeof request.type === 'string' ? request.type : '',
    mimeType: typeof request.mimeType === 'string' ? request.mimeType : undefined,
    requestTime:
      typeof request.requestTime === 'number' && Number.isFinite(request.requestTime)
        ? request.requestTime
        : undefined,
    responseTime:
      typeof request.responseTime === 'number' && Number.isFinite(request.responseTime)
        ? request.responseTime
        : undefined,
    errorText: typeof request.errorText === 'string' ? request.errorText : undefined,
  };
}

function sortRequestsByTime(requests: Array<Record<string, unknown>>) {
  return [...requests].sort((a, b) => {
    const aTime =
      (typeof a.responseTime === 'number' ? a.responseTime : undefined) ??
      (typeof a.requestTime === 'number' ? a.requestTime : undefined) ??
      0;
    const bTime =
      (typeof b.responseTime === 'number' ? b.responseTime : undefined) ??
      (typeof b.requestTime === 'number' ? b.requestTime : undefined) ??
      0;
    return aTime - bTime;
  });
}

function readActiveDebuggerCapture(tabId: number): Record<string, unknown> | undefined {
  const captureData = (
    networkDebuggerStartTool as unknown as { captureData?: Map<number, unknown> }
  ).captureData;
  if (!(captureData instanceof Map)) return undefined;
  const value = captureData.get(tabId);
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : undefined;
}

function readCompletedDebuggerCapture(
  tabId: number,
): { completedAt?: number; reason?: string; data?: Record<string, unknown> } | undefined {
  const completedCaptures = (
    networkDebuggerStartTool as unknown as {
      completedCaptures?: Map<number, { completedAt?: number; reason?: string; data?: unknown }>;
    }
  ).completedCaptures;
  if (!(completedCaptures instanceof Map)) return undefined;
  const value = completedCaptures.get(tabId);
  if (!value || typeof value !== 'object') return undefined;
  return {
    completedAt: value.completedAt,
    reason: value.reason,
    data:
      value.data && typeof value.data === 'object' ? (value.data as Record<string, unknown>) : {},
  };
}

function readCompletedWebRequestCapture(
  tabId: number,
): { completedAt?: number; reason?: string; data?: Record<string, unknown> } | undefined {
  const completedCaptures = (
    networkCaptureStartTool as unknown as {
      completedCaptures?: Map<number, { completedAt?: number; reason?: string; data?: unknown }>;
    }
  ).completedCaptures;
  if (!(completedCaptures instanceof Map)) return undefined;
  const value = completedCaptures.get(tabId);
  if (!value || typeof value !== 'object') return undefined;
  return {
    completedAt: value.completedAt,
    reason: value.reason,
    data:
      value.data && typeof value.data === 'object' ? (value.data as Record<string, unknown>) : {},
  };
}

function pickNetworkCandidate(tabId: number): NetworkCaptureCandidate | null {
  const activeDebugger = readActiveDebuggerCapture(tabId);
  if (activeDebugger) {
    return {
      backend: 'debugger',
      source: 'active',
      active: true,
      tabId,
      payload: activeDebugger,
    };
  }

  const activeWebRequest = networkCaptureStartTool.captureData.get(tabId);
  if (activeWebRequest && typeof activeWebRequest === 'object') {
    return {
      backend: 'webRequest',
      source: 'active',
      active: true,
      tabId,
      payload: activeWebRequest as unknown as Record<string, unknown>,
    };
  }

  const completedDebugger = readCompletedDebuggerCapture(tabId);
  const completedWebRequest = readCompletedWebRequestCapture(tabId);

  if (!completedDebugger && !completedWebRequest) return null;

  if (!completedWebRequest) {
    return {
      backend: 'debugger',
      source: 'completed',
      active: false,
      tabId,
      completedAt: completedDebugger?.completedAt,
      reason: completedDebugger?.reason,
      payload: completedDebugger?.data || {},
    };
  }

  if (!completedDebugger) {
    return {
      backend: 'webRequest',
      source: 'completed',
      active: false,
      tabId,
      completedAt: completedWebRequest?.completedAt,
      reason: completedWebRequest?.reason,
      payload: completedWebRequest?.data || {},
    };
  }

  return (completedDebugger.completedAt || 0) >= (completedWebRequest.completedAt || 0)
    ? {
        backend: 'debugger',
        source: 'completed',
        active: false,
        tabId,
        completedAt: completedDebugger.completedAt,
        reason: completedDebugger.reason,
        payload: completedDebugger.data || {},
      }
    : {
        backend: 'webRequest',
        source: 'completed',
        active: false,
        tabId,
        completedAt: completedWebRequest.completedAt,
        reason: completedWebRequest.reason,
        payload: completedWebRequest.data || {},
      };
}

function buildNetworkSummary(tabId: number, limit: number) {
  const candidate = pickNetworkCandidate(tabId);
  if (!candidate) {
    return {
      available: false,
      message: 'No active or recent network capture found for this tab.',
    };
  }

  const rawRequests = candidate.payload.requests;
  const requestList = Array.isArray(rawRequests)
    ? rawRequests
    : rawRequests && typeof rawRequests === 'object'
      ? Object.values(rawRequests)
      : [];
  const normalizedRequests = sortRequestsByTime(
    requestList.filter(
      (item): item is Record<string, unknown> => !!item && typeof item === 'object',
    ),
  ).map(normalizeRequest);

  const recentRequests = normalizedRequests.slice(Math.max(0, normalizedRequests.length - limit));
  const failedRequestCount = normalizedRequests.filter((request) =>
    typeof request.status === 'number'
      ? request.status >= 400
      : typeof request.errorText === 'string' && request.errorText.trim().length > 0,
  ).length;

  const matchedRequests =
    typeof candidate.payload.matchedRequests === 'number'
      ? candidate.payload.matchedRequests
      : typeof candidate.payload.requestCount === 'number'
        ? candidate.payload.requestCount
        : normalizedRequests.length;

  const ignoredRequests =
    candidate.payload.ignoredRequests &&
    typeof candidate.payload.ignoredRequests === 'object' &&
    !Array.isArray(candidate.payload.ignoredRequests)
      ? candidate.payload.ignoredRequests
      : undefined;

  const startedAt =
    typeof candidate.payload.startTime === 'number'
      ? candidate.payload.startTime
      : typeof candidate.payload.captureStartTime === 'number'
        ? candidate.payload.captureStartTime
        : undefined;

  return {
    available: true,
    backend: candidate.backend,
    source: candidate.source,
    active: candidate.active,
    tabId: candidate.tabId,
    startedAt,
    completedAt: candidate.completedAt,
    stopReason:
      candidate.reason ||
      (typeof candidate.payload.stopReason === 'string' ? candidate.payload.stopReason : undefined),
    requestCount: normalizedRequests.length,
    matchedRequests,
    failedRequestCount,
    ignoredRequests,
    recentRequests,
  };
}

class CollectDebugEvidenceTool extends BaseBrowserToolExecutor {
  name = TOOL_NAMES.BROWSER.COLLECT_DEBUG_EVIDENCE;

  private createJsonSuccess(payload: Record<string, unknown>): ToolResult {
    return {
      content: [{ type: 'text', text: JSON.stringify(payload) }],
      isError: false,
    };
  }

  private async collectScreenshot(
    tabId: number,
    windowId: number,
    args: DebugEvidenceToolParams,
  ): Promise<Record<string, unknown>> {
    const result = await screenshotTool.execute({
      name: 'debug-evidence',
      tabId,
      windowId,
      background: args.background !== false,
      fullPage: args.fullPage === true,
      storeBase64: true,
      savePng: false,
    });
    const parsed = parseJsonToolResult(result);
    if (!parsed.ok || !parsed.data) {
      return {
        captured: false,
        error: parsed.error || 'Failed to capture screenshot.',
      };
    }

    const base64Data =
      typeof parsed.data.base64Data === 'string'
        ? parsed.data.base64Data
        : typeof parsed.data.base64 === 'string'
          ? parsed.data.base64
          : '';

    return {
      captured: true,
      mimeType: typeof parsed.data.mimeType === 'string' ? parsed.data.mimeType : 'image/jpeg',
      base64Data,
      base64Length: base64Data.length,
    };
  }

  private async collectConsole(
    tabId: number,
    args: DebugEvidenceToolParams,
    fallbackPageUrl: string,
  ): Promise<Record<string, unknown>> {
    const consoleMode: DebugConsoleMode = args.consoleMode || 'auto';
    const includeExceptions = args.includeExceptions !== false;
    const onlyErrors = args.onlyErrors === true;
    const limit = normalizeLimit(args.consoleLimit, 20, 200);
    const bufferWasActive = consoleBuffer.isCapturing(tabId);

    const buildConsolePayload = (
      data: Record<string, unknown>,
      source: 'buffer' | 'buffer_started_now' | 'snapshot',
      historyAvailable: boolean,
      fallbackNote?: string,
    ) => {
      const messages = Array.isArray(data.messages)
        ? data.messages.filter(
            (item): item is Record<string, unknown> => !!item && typeof item === 'object',
          )
        : [];
      const exceptions = Array.isArray(data.exceptions)
        ? data.exceptions.filter(
            (item): item is Record<string, unknown> => !!item && typeof item === 'object',
          )
        : [];
      const pageUrl = typeof data.tabUrl === 'string' ? data.tabUrl : fallbackPageUrl;
      const includeExtensionConsole = args.includeExtensionConsole === true;
      const prioritizedMessages = prioritizeConsoleItems(
        messages,
        pageUrl,
        includeExtensionConsole,
      );
      const prioritizedExceptions = prioritizeConsoleItems(
        exceptions,
        pageUrl,
        includeExtensionConsole,
        { exception: true },
      );
      const visibleItems = [...prioritizedMessages.items, ...prioritizedExceptions.items];

      return {
        available: true,
        source,
        historyAvailable,
        includeExceptions,
        onlyErrors,
        includeExtensionConsole,
        messageCount: prioritizedMessages.items.length,
        exceptionCount: prioritizedExceptions.items.length,
        rawMessageCount:
          typeof data.messageCount === 'number' ? data.messageCount : messages.length,
        rawExceptionCount:
          typeof data.exceptionCount === 'number' ? data.exceptionCount : exceptions.length,
        filteredOutExtensionMessageCount: prioritizedMessages.filteredOutExtensionCount,
        filteredOutExtensionExceptionCount: prioritizedExceptions.filteredOutExtensionCount,
        errorLevelMessageCount: prioritizedMessages.items.filter((message) =>
          isErrorLevel(message.level),
        ).length,
        captureStartTime:
          typeof data.captureStartTime === 'number' ? data.captureStartTime : undefined,
        captureEndTime: typeof data.captureEndTime === 'number' ? data.captureEndTime : undefined,
        totalDurationMs:
          typeof data.totalDurationMs === 'number' ? data.totalDurationMs : undefined,
        messageLimitReached:
          typeof data.messageLimitReached === 'boolean' ? data.messageLimitReached : false,
        droppedMessageCount:
          typeof data.droppedMessageCount === 'number' ? data.droppedMessageCount : 0,
        droppedExceptionCount:
          typeof data.droppedExceptionCount === 'number' ? data.droppedExceptionCount : 0,
        sourceGroups: buildSourceGroupSummary(visibleItems),
        recentMessages: prioritizedMessages.items,
        recentExceptions: prioritizedExceptions.items,
        runtimeExceptionSummary: summarizeExceptions(prioritizedExceptions.items),
        note: fallbackNote,
      };
    };

    let bufferError: string | undefined;

    if (consoleMode !== 'snapshot') {
      const bufferResult = await consoleTool.execute({
        tabId,
        mode: 'buffer',
        includeExceptions,
        onlyErrors,
        limit,
        clear: args.clearConsole === true,
        clearAfterRead: args.clearConsoleAfterRead === true,
      });
      const parsed = parseJsonToolResult(bufferResult);
      if (parsed.ok && parsed.data) {
        const payload = buildConsolePayload(
          parsed.data,
          bufferWasActive ? 'buffer' : 'buffer_started_now',
          bufferWasActive,
        );
        const hasData =
          typeof payload.messageCount === 'number' &&
          typeof payload.exceptionCount === 'number' &&
          (payload.messageCount > 0 || payload.exceptionCount > 0);
        if (consoleMode === 'buffer' || hasData) {
          return payload;
        }
        bufferError =
          'Buffer was started just now, so no historical console entries were available yet.';
      } else {
        bufferError = parsed.error || 'Failed to read console buffer.';
        if (consoleMode === 'buffer') {
          return {
            available: false,
            source: 'buffer',
            historyAvailable: bufferWasActive,
            error: bufferError,
          };
        }
      }
    }

    const snapshotResult = await consoleTool.execute({
      tabId,
      mode: 'snapshot',
      includeExceptions,
      onlyErrors,
      limit,
    });
    const parsedSnapshot = parseJsonToolResult(snapshotResult);
    if (parsedSnapshot.ok && parsedSnapshot.data) {
      return buildConsolePayload(parsedSnapshot.data, 'snapshot', false, bufferError);
    }

    return {
      available: false,
      source: consoleMode === 'buffer' ? 'buffer' : 'snapshot',
      historyAvailable: bufferWasActive,
      error:
        parsedSnapshot.error ||
        bufferError ||
        'Failed to collect console and runtime exception data.',
    };
  }

  async execute(args: DebugEvidenceToolParams): Promise<ToolResult> {
    try {
      const explicit = await this.tryGetTab(args?.tabId);
      const tab = explicit || (await this.getActiveTabOrThrowInWindow(args?.windowId));
      if (!tab.id) return createErrorResponse('Active tab has no ID');

      const tabId = tab.id;
      const windowId = typeof tab.windowId === 'number' ? tab.windowId : 0;
      const screenshotIncluded = args.includeScreenshot !== false;
      const consoleIncluded = args.includeConsole !== false;
      const networkIncluded = args.includeNetworkSummary !== false;
      const networkLimit = normalizeLimit(args.networkLimit, 10, 50);

      const screenshot = screenshotIncluded
        ? await this.collectScreenshot(tabId, windowId, args)
        : { included: false };
      const consoleData = consoleIncluded
        ? await this.collectConsole(tabId, args, tab.url || '')
        : { included: false };
      const network = networkIncluded
        ? buildNetworkSummary(tabId, networkLimit)
        : { included: false };

      return this.createJsonSuccess({
        success: true,
        tool: this.name,
        capturedAt: Date.now(),
        tab: {
          tabId,
          windowId,
          url: tab.url || '',
          title: tab.title || '',
          status: tab.status || 'unknown',
          active: tab.active || false,
          index: tab.index,
        },
        screenshot,
        console: consoleData,
        network,
      });
    } catch (error) {
      return createErrorResponse(
        `Error collecting debug evidence: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}

export const collectDebugEvidenceTool = new CollectDebugEvidenceTool();
