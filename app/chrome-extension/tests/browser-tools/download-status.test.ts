import { beforeEach, describe, expect, it, vi } from 'vitest';

import { handleDownloadTool } from '@/entrypoints/background/tools/browser/download';

function parseJsonResult(result: { content?: Array<{ type: string; text?: string }> }) {
  const text = result.content?.[0]?.text;
  return JSON.parse(String(text || '{}'));
}

describe('download status queries', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    (chrome.downloads as any) = {
      search: vi.fn(),
      onCreated: { addListener: vi.fn(), removeListener: vi.fn() },
      onChanged: { addListener: vi.fn(), removeListener: vi.fn() },
    };
  });

  it('returns the latest matching download with normalized status fields', async () => {
    (chrome.downloads.search as any).mockResolvedValue([
      {
        id: 1,
        filename: 'C:\\Downloads\\old-report.csv',
        url: 'https://example.com/old-report.csv',
        state: 'in_progress',
        bytesReceived: 0,
        totalBytes: 100,
        startTime: '2026-04-28T08:00:00.000Z',
      },
      {
        id: 2,
        filename: 'C:\\Downloads\\new-report.csv',
        url: 'https://example.com/new-report.csv',
        finalUrl: 'https://cdn.example.com/new-report.csv',
        state: 'complete',
        bytesReceived: 240,
        totalBytes: 240,
        fileSize: 240,
        startTime: '2026-04-28T09:00:00.000Z',
        danger: 'safe',
      },
    ]);

    const result = await handleDownloadTool.execute({
      action: 'status',
      filenameContains: 'report',
    } as any);

    expect(result.isError).toBe(false);
    expect(parseJsonResult(result)).toMatchObject({
      success: true,
      action: 'status',
      download: {
        id: 2,
        status: 'completed',
        chromeState: 'complete',
        filename: 'new-report.csv',
        fullPath: 'C:\\Downloads\\new-report.csv',
        finalUrl: 'https://cdn.example.com/new-report.csv',
        totalBytes: 240,
        receivedBytes: 240,
        progressPct: 100,
      },
    });
  });

  it('lists downloads filtered by normalized status', async () => {
    (chrome.downloads.search as any).mockResolvedValue([
      {
        id: 11,
        filename: 'C:\\Downloads\\queued.zip',
        url: 'https://example.com/queued.zip',
        state: 'in_progress',
        bytesReceived: 0,
        totalBytes: 50,
        startTime: '2026-04-28T09:30:00.000Z',
      },
      {
        id: 12,
        filename: 'C:\\Downloads\\active.zip',
        url: 'https://example.com/active.zip',
        state: 'in_progress',
        bytesReceived: 25,
        totalBytes: 50,
        startTime: '2026-04-28T09:31:00.000Z',
      },
    ]);

    const result = await handleDownloadTool.execute({
      action: 'list',
      status: 'pending',
    } as any);

    expect(result.isError).toBe(false);
    expect(parseJsonResult(result)).toMatchObject({
      success: true,
      action: 'list',
      count: 1,
      downloads: [
        {
          id: 11,
          status: 'pending',
          filename: 'queued.zip',
        },
      ],
    });
  });

  it('wait mode returns normalized download details for an already completed match', async () => {
    (chrome.downloads.search as any).mockResolvedValue([
      {
        id: 21,
        filename: 'C:\\Downloads\\invoice.pdf',
        url: 'https://example.com/invoice.pdf',
        state: 'complete',
        bytesReceived: 90,
        totalBytes: 90,
        startTime: '2026-04-28T10:00:00.000Z',
      },
    ]);

    const result = await handleDownloadTool.execute({
      action: 'wait',
      filenameContains: 'invoice',
      timeoutMs: 1000,
    } as any);

    expect(result.isError).toBe(false);
    expect(parseJsonResult(result)).toMatchObject({
      success: true,
      action: 'wait',
      download: {
        id: 21,
        status: 'completed',
        filename: 'invoice.pdf',
        progressPct: 100,
      },
    });
  });
});
