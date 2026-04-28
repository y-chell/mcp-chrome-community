import { createErrorResponse, type ToolResult } from '@/common/tool-handler';
import { BaseBrowserToolExecutor } from '../base-browser';
import { TOOL_NAMES } from 'chrome-mcp-shared';

type DownloadChromeState = 'in_progress' | 'complete' | 'interrupted';
type DownloadStatus = 'pending' | 'in_progress' | 'completed' | 'failed';

interface HandleDownloadParams {
  action?: 'wait' | 'status' | 'list';
  id?: number;
  filenameContains?: string;
  timeoutMs?: number;
  waitForComplete?: boolean;
  startedAfter?: number;
  allowInterrupted?: boolean;
  state?: DownloadChromeState;
  status?: DownloadStatus;
  limit?: number;
}

interface DownloadQueryOptions {
  id?: number;
  filenameContains?: string;
  startedAfter?: number;
  state?: DownloadChromeState;
  status?: DownloadStatus;
  limit?: number;
}

function basename(filePath: string | undefined): string | undefined {
  if (!filePath) return undefined;
  return filePath.split(/[/\\]/).pop() || undefined;
}

function toTimestamp(value: string | undefined): number {
  if (!value) return 0;
  const ts = Date.parse(value);
  return Number.isFinite(ts) ? ts : 0;
}

function getDownloadStatus(item: chrome.downloads.DownloadItem): DownloadStatus {
  if (item.state === 'complete') return 'completed';
  if (item.state === 'interrupted') return 'failed';

  const received = typeof item.bytesReceived === 'number' ? item.bytesReceived : 0;
  return received > 0 ? 'in_progress' : 'pending';
}

export function serializeDownloadItem(item: chrome.downloads.DownloadItem) {
  const fullPath = item.filename || undefined;
  const name = basename(fullPath);
  const totalBytes =
    typeof item.totalBytes === 'number' && item.totalBytes >= 0
      ? item.totalBytes
      : typeof item.fileSize === 'number' && item.fileSize >= 0
        ? item.fileSize
        : undefined;
  const receivedBytes =
    typeof item.bytesReceived === 'number' && item.bytesReceived >= 0
      ? item.bytesReceived
      : undefined;
  const progressPct =
    typeof totalBytes === 'number' && totalBytes > 0 && typeof receivedBytes === 'number'
      ? Math.max(0, Math.min(100, Math.round((receivedBytes / totalBytes) * 100)))
      : item.state === 'complete'
        ? 100
        : 0;

  return {
    id: item.id,
    status: getDownloadStatus(item),
    state: item.state,
    chromeState: item.state,
    filename: name,
    fullPath,
    url: item.url,
    finalUrl: item.finalUrl || undefined,
    mimeType: (item as any).mime || undefined,
    totalBytes,
    receivedBytes,
    fileSize: typeof item.fileSize === 'number' && item.fileSize >= 0 ? item.fileSize : totalBytes,
    progressPct,
    exists: (item as any).exists,
    danger: item.danger,
    paused: item.paused,
    canResume: item.canResume,
    error: (item as any).error || undefined,
    startTime: item.startTime,
    endTime: (item as any).endTime || undefined,
  };
}

function getMatchedBy(item: chrome.downloads.DownloadItem, filenameContains?: string): string {
  if (!filenameContains) return 'any';
  const needle = filenameContains.toLowerCase();
  const name = basename(item.filename)?.toLowerCase() || '';
  if (name.includes(needle)) return 'filename';
  if (
    String(item.filename || '')
      .toLowerCase()
      .includes(needle)
  )
    return 'path';
  if (
    String(item.url || '')
      .toLowerCase()
      .includes(needle)
  )
    return 'url';
  if (
    String((item as any).finalUrl || '')
      .toLowerCase()
      .includes(needle)
  )
    return 'finalUrl';
  return 'unknown';
}

function matchesDownload(item: chrome.downloads.DownloadItem, opts: DownloadQueryOptions): boolean {
  if (!item) return false;

  if (typeof opts.id === 'number' && item.id !== opts.id) {
    return false;
  }

  if (typeof opts.startedAfter === 'number' && Number.isFinite(opts.startedAfter)) {
    const startedAt = toTimestamp(item.startTime);
    if (!startedAt || startedAt < opts.startedAfter) {
      return false;
    }
  }

  if (opts.filenameContains) {
    const needle = opts.filenameContains;
    const name = basename(item.filename)?.toLowerCase() || '';
    const fullPath = String(item.filename || '').toLowerCase();
    const url = String(item.url || '').toLowerCase();
    const finalUrl = String((item as any).finalUrl || '').toLowerCase();
    if (
      !name.includes(needle) &&
      !fullPath.includes(needle) &&
      !url.includes(needle) &&
      !finalUrl.includes(needle)
    ) {
      return false;
    }
  }

  if (opts.state && item.state !== opts.state) {
    return false;
  }

  if (opts.status && getDownloadStatus(item) !== opts.status) {
    return false;
  }

  return true;
}

export async function listDownloads(opts: DownloadQueryOptions) {
  const limit = Math.max(1, Math.min(Number(opts.limit ?? 20), 200));
  const searchQuery = typeof opts.id === 'number' ? { id: opts.id } : {};
  const items = await chrome.downloads.search(searchQuery);

  return (items || [])
    .filter((item) => matchesDownload(item, opts))
    .sort((a, b) => toTimestamp(b.startTime) - toTimestamp(a.startTime))
    .slice(0, limit)
    .map((item) => serializeDownloadItem(item));
}

export async function getLatestDownload(opts: DownloadQueryOptions) {
  const [download] = await listDownloads({ ...opts, limit: 1 });
  return download;
}

/**
 * Tool: wait for a download and return info
 */
class HandleDownloadTool extends BaseBrowserToolExecutor {
  name = TOOL_NAMES.BROWSER.HANDLE_DOWNLOAD as any;

  async execute(args: HandleDownloadParams): Promise<ToolResult> {
    const action = args?.action || 'wait';
    const filenameContains = String(args?.filenameContains || '')
      .trim()
      .toLowerCase();
    const startedAfter =
      typeof args?.startedAfter === 'number' && Number.isFinite(args.startedAfter)
        ? args.startedAfter
        : undefined;
    const state =
      args?.state === 'in_progress' || args?.state === 'complete' || args?.state === 'interrupted'
        ? args.state
        : undefined;
    const status =
      args?.status === 'pending' ||
      args?.status === 'in_progress' ||
      args?.status === 'completed' ||
      args?.status === 'failed'
        ? args.status
        : undefined;
    const downloadId = typeof args?.id === 'number' ? args.id : undefined;
    const limit = Math.max(1, Math.min(Number(args?.limit ?? 20), 200));

    try {
      if (action === 'status') {
        const download = await getLatestDownload({
          id: downloadId,
          filenameContains,
          startedAfter,
          state,
          status,
          limit: 1,
        });

        if (!download) {
          return createErrorResponse('No matching downloads found');
        }

        return {
          content: [{ type: 'text', text: JSON.stringify({ success: true, action, download }) }],
          isError: false,
        };
      }

      if (action === 'list') {
        const downloads = await listDownloads({
          id: downloadId,
          filenameContains,
          startedAfter,
          state,
          status,
          limit,
        });

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                success: true,
                action,
                count: downloads.length,
                downloads,
              }),
            },
          ],
          isError: false,
        };
      }

      const waitForComplete = args?.waitForComplete !== false;
      const timeoutMs = Math.max(1000, Math.min(Number(args?.timeoutMs ?? 60000), 300000));
      const allowInterrupted = args?.allowInterrupted === true;

      const result = await waitForDownload({
        id: downloadId,
        filenameContains,
        waitForComplete,
        timeoutMs,
        startedAfter,
        allowInterrupted,
        state,
        status,
      });
      return {
        content: [
          { type: 'text', text: JSON.stringify({ success: true, action, download: result }) },
        ],
        isError: false,
      };
    } catch (e: any) {
      return createErrorResponse(`Handle download failed: ${e?.message || String(e)}`);
    }
  }
}

export async function waitForDownload(opts: {
  id?: number;
  filenameContains?: string;
  waitForComplete: boolean;
  timeoutMs: number;
  startedAfter?: number;
  allowInterrupted?: boolean;
  state?: DownloadChromeState;
  status?: DownloadStatus;
}) {
  const {
    id,
    filenameContains,
    waitForComplete,
    timeoutMs,
    startedAfter,
    allowInterrupted,
    state,
    status,
  } = opts;

  return new Promise<any>((resolve, reject) => {
    let timer: any = null;
    let settled = false;

    const cleanup = () => {
      try {
        if (timer) clearTimeout(timer);
      } catch {}
      try {
        chrome.downloads.onCreated.removeListener(onCreated);
      } catch {}
      try {
        chrome.downloads.onChanged.removeListener(onChanged);
      } catch {}
    };

    const finishResolve = (item: chrome.downloads.DownloadItem) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve({
        ...serializeDownloadItem(item),
        matchedBy: getMatchedBy(item, filenameContains),
      });
    };

    const finishReject = (err: unknown) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(err instanceof Error ? err : new Error(String(err)));
    };

    const matches = (item: chrome.downloads.DownloadItem) =>
      matchesDownload(item, {
        id,
        filenameContains,
        startedAfter,
        state,
        status,
      });

    const matchesWaitCondition = (item: chrome.downloads.DownloadItem) => {
      if (!item?.state) return false;
      if (state || status) return true;
      if (!waitForComplete) return true;
      if (item.state === 'complete') return true;
      return allowInterrupted === true && item.state === 'interrupted';
    };

    const inspectAndMaybeFinish = async (itemId: number) => {
      const [item] = await chrome.downloads.search({ id: itemId });
      if (!item) return;
      if (!matches(item)) return;

      if (!matchesWaitCondition(item)) return;

      if (
        !state &&
        !status &&
        waitForComplete &&
        item.state === 'interrupted' &&
        allowInterrupted !== true
      ) {
        finishReject(new Error((item as any).error || 'Download was interrupted'));
        return;
      }

      finishResolve(item);
    };

    const onCreated = (item: chrome.downloads.DownloadItem) => {
      try {
        if (!matches(item)) return;
        if (matchesWaitCondition(item)) {
          void inspectAndMaybeFinish(item.id);
        }
      } catch (error) {
        finishReject(error);
      }
    };

    const onChanged = (delta: chrome.downloads.DownloadDelta) => {
      try {
        if (!delta || typeof delta.id !== 'number') return;
        void inspectAndMaybeFinish(delta.id).catch(() => {});
      } catch {}
    };

    chrome.downloads.onCreated.addListener(onCreated);
    chrome.downloads.onChanged.addListener(onChanged);
    timer = setTimeout(() => finishReject(new Error('Download wait timed out')), timeoutMs);

    chrome.downloads
      .search(typeof id === 'number' ? { id } : {})
      .then((items) => {
        const matched = (items || [])
          .filter((item) => matches(item) && matchesWaitCondition(item))
          .sort((a, b) => toTimestamp(b.startTime) - toTimestamp(a.startTime));
        if (matched[0]) {
          if (
            !state &&
            !status &&
            waitForComplete &&
            matched[0].state === 'interrupted' &&
            allowInterrupted !== true
          ) {
            finishReject(new Error((matched[0] as any).error || 'Download was interrupted'));
            return;
          }
          finishResolve(matched[0]);
        }
      })
      .catch(() => {});
  });
}

export const handleDownloadTool = new HandleDownloadTool();
