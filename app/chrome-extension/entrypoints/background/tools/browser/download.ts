import { createErrorResponse, ToolResult } from '@/common/tool-handler';
import { BaseBrowserToolExecutor } from '../base-browser';
import { TOOL_NAMES } from 'chrome-mcp-shared';

interface HandleDownloadParams {
  filenameContains?: string;
  timeoutMs?: number; // default 60000
  waitForComplete?: boolean; // default true
  startedAfter?: number;
  allowInterrupted?: boolean;
  state?: 'in_progress' | 'complete' | 'interrupted';
}

/**
 * Tool: wait for a download and return info
 */
class HandleDownloadTool extends BaseBrowserToolExecutor {
  name = TOOL_NAMES.BROWSER.HANDLE_DOWNLOAD as any;

  async execute(args: HandleDownloadParams): Promise<ToolResult> {
    const filenameContains = String(args?.filenameContains || '').trim();
    const waitForComplete = args?.waitForComplete !== false;
    const timeoutMs = Math.max(1000, Math.min(Number(args?.timeoutMs ?? 60000), 300000));
    const startedAfter =
      typeof args?.startedAfter === 'number' && Number.isFinite(args.startedAfter)
        ? args.startedAfter
        : undefined;
    const allowInterrupted = args?.allowInterrupted === true;
    const state =
      args?.state === 'in_progress' || args?.state === 'complete' || args?.state === 'interrupted'
        ? args.state
        : undefined;

    try {
      const result = await waitForDownload({
        filenameContains,
        waitForComplete,
        timeoutMs,
        startedAfter,
        allowInterrupted,
        state,
      });
      return {
        content: [{ type: 'text', text: JSON.stringify({ success: true, download: result }) }],
        isError: false,
      };
    } catch (e: any) {
      return createErrorResponse(`Handle download failed: ${e?.message || String(e)}`);
    }
  }
}

export async function waitForDownload(opts: {
  filenameContains?: string;
  waitForComplete: boolean;
  timeoutMs: number;
  startedAfter?: number;
  allowInterrupted?: boolean;
  state?: 'in_progress' | 'complete' | 'interrupted';
}) {
  const { filenameContains, waitForComplete, timeoutMs, startedAfter, allowInterrupted, state } =
    opts;
  return new Promise<any>((resolve, reject) => {
    let timer: any = null;
    const onError = (err: any) => {
      cleanup();
      reject(err instanceof Error ? err : new Error(String(err)));
    };
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
    const matches = (item: chrome.downloads.DownloadItem) => {
      if (!item) return false;
      if (typeof startedAfter === 'number' && Number.isFinite(startedAfter)) {
        const startTimeMs = item.startTime ? Date.parse(item.startTime) : NaN;
        if (!Number.isFinite(startTimeMs) || startTimeMs < startedAfter) {
          return false;
        }
      }
      if (!filenameContains) return true;
      const name = (item.filename || '').split(/[/\\]/).pop() || '';
      return name.includes(filenameContains) || (item.url || '').includes(filenameContains);
    };
    const matchesState = (item: chrome.downloads.DownloadItem) => {
      if (!item?.state) return false;
      if (state) return item.state === state;
      if (!waitForComplete) return true;
      if (item.state === 'complete') return true;
      return allowInterrupted === true && item.state === 'interrupted';
    };
    const matchedBy = (item: chrome.downloads.DownloadItem) => {
      if (!filenameContains) return 'any';
      const name = (item.filename || '').split(/[/\\]/).pop() || '';
      if (name.includes(filenameContains)) return 'filename';
      if ((item.url || '').includes(filenameContains)) return 'url';
      return 'unknown';
    };
    const fulfill = async (item: chrome.downloads.DownloadItem) => {
      // try to fill more details via downloads.search
      try {
        const [found] = await chrome.downloads.search({ id: item.id });
        const out = found || item;
        cleanup();
        resolve({
          id: out.id,
          filename: out.filename,
          url: out.url,
          mime: (out as any).mime || undefined,
          fileSize: out.fileSize ?? out.totalBytes ?? undefined,
          state: out.state,
          danger: out.danger,
          startTime: out.startTime,
          endTime: (out as any).endTime || undefined,
          exists: (out as any).exists,
          matchedBy: matchedBy(out),
        });
        return;
      } catch {
        cleanup();
        resolve({
          id: item.id,
          filename: item.filename,
          url: item.url,
          state: item.state,
          matchedBy: matchedBy(item),
        });
      }
    };
    const onCreated = (item: chrome.downloads.DownloadItem) => {
      try {
        if (!matches(item)) return;
        if (!waitForComplete || matchesState(item)) {
          fulfill(item);
        }
      } catch {}
    };
    const onChanged = (delta: chrome.downloads.DownloadDelta) => {
      try {
        if (!delta || typeof delta.id !== 'number') return;
        // pull item and check
        chrome.downloads
          .search({ id: delta.id })
          .then((arr) => {
            const item = arr && arr[0];
            if (!item) return;
            if (!matches(item)) return;
            if (matchesState(item)) fulfill(item);
          })
          .catch(() => {});
      } catch {}
    };
    chrome.downloads.onCreated.addListener(onCreated);
    chrome.downloads.onChanged.addListener(onChanged);
    timer = setTimeout(() => onError(new Error('Download wait timed out')), timeoutMs);
    // Try to find an already-running matching download
    chrome.downloads
      .search({})
      .then((arr) => {
        const matched = (arr || [])
          .filter((item) => matches(item) && matchesState(item))
          .sort((a, b) => {
            const aTime = a.startTime ? Date.parse(a.startTime) : 0;
            const bTime = b.startTime ? Date.parse(b.startTime) : 0;
            return bTime - aTime;
          });
        if (matched[0]) fulfill(matched[0]);
      })
      .catch(() => {});
  });
}

export const handleDownloadTool = new HandleDownloadTool();
