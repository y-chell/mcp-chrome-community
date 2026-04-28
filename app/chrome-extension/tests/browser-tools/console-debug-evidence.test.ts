import { beforeEach, describe, expect, it, vi } from 'vitest';

import { collectDebugEvidenceTool } from '@/entrypoints/background/tools/browser/debug-evidence';
import { consoleBuffer } from '@/entrypoints/background/tools/browser/console-buffer';
import { consoleTool } from '@/entrypoints/background/tools/browser/console';
import { screenshotTool } from '@/entrypoints/background/tools/browser/screenshot';
import { networkCaptureStartTool } from '@/entrypoints/background/tools/browser/network-capture-web-request';
import { networkDebuggerStartTool } from '@/entrypoints/background/tools/browser/network-capture-debugger';

function parseJsonResult(result: { content?: Array<{ type: string; text?: string }> }) {
  return JSON.parse(String(result.content?.[0]?.text || '{}'));
}

describe('console debugging tools', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.clearAllMocks();

    (chrome.tabs.get as any) = vi.fn().mockResolvedValue({
      id: 7,
      windowId: 3,
      url: 'https://example.com/checkout',
      title: 'Checkout',
      status: 'complete',
      active: true,
      index: 2,
    });
    (chrome.tabs.query as any) = vi.fn().mockResolvedValue([
      {
        id: 7,
        windowId: 3,
        url: 'https://example.com/checkout',
        title: 'Checkout',
        status: 'complete',
        active: true,
        index: 2,
      },
    ]);

    networkCaptureStartTool.captureData = new Map();
    (networkCaptureStartTool as any).completedCaptures = new Map();
    (networkDebuggerStartTool as any).captureData = new Map();
    (networkDebuggerStartTool as any).completedCaptures = new Map();
  });

  it('reads buffered console logs with clear-after-read support', async () => {
    vi.spyOn(consoleBuffer, 'ensureStarted').mockResolvedValue(undefined);
    vi.spyOn(consoleBuffer, 'read').mockReturnValue({
      tabId: 7,
      tabUrl: 'https://example.com/checkout',
      tabTitle: 'Checkout',
      captureStartTime: 100,
      captureEndTime: 250,
      totalDurationMs: 150,
      messages: [
        {
          timestamp: 110,
          level: 'error',
          text: 'Request failed',
        },
      ],
      exceptions: [
        {
          timestamp: 120,
          text: 'TypeError: boom',
          url: 'https://example.com/app.js',
          lineNumber: 10,
          columnNumber: 5,
        },
      ],
      totalBufferedMessages: 2,
      totalBufferedExceptions: 1,
      messageCount: 1,
      exceptionCount: 1,
      messageLimitReached: false,
      droppedMessageCount: 0,
      droppedExceptionCount: 0,
    } as any);
    vi.spyOn(consoleBuffer, 'clear').mockReturnValue({
      clearedMessages: 1,
      clearedExceptions: 1,
    });

    const result = await consoleTool.execute({
      tabId: 7,
      mode: 'buffer',
      onlyErrors: true,
      clearAfterRead: true,
      limit: 5,
    } as any);

    expect(result.isError).toBe(false);
    expect(consoleBuffer.ensureStarted).toHaveBeenCalledWith(7);
    expect(consoleBuffer.read).toHaveBeenCalledWith(
      7,
      expect.objectContaining({
        onlyErrors: true,
        limit: 5,
      }),
    );

    const parsed = parseJsonResult(result);
    expect(parsed.messageCount).toBe(1);
    expect(parsed.exceptionCount).toBe(1);
    expect(parsed.message).toContain('Cleared 1 messages and 1 exceptions after reading.');
  });

  it('collects a bundled debug evidence payload', async () => {
    vi.spyOn(consoleBuffer, 'isCapturing').mockReturnValue(true);
    vi.spyOn(consoleTool, 'execute').mockResolvedValue({
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            success: true,
            tabId: 7,
            tabUrl: 'https://example.com/checkout',
            tabTitle: 'Checkout',
            captureStartTime: 100,
            captureEndTime: 200,
            totalDurationMs: 100,
            messages: [
              { timestamp: 110, level: 'log', text: 'hello' },
              { timestamp: 120, level: 'error', text: 'Request failed' },
            ],
            exceptions: [
              {
                timestamp: 130,
                text: 'TypeError: boom',
                url: 'https://example.com/app.js',
                lineNumber: 10,
                columnNumber: 5,
              },
            ],
            messageCount: 2,
            exceptionCount: 1,
            messageLimitReached: false,
            droppedMessageCount: 0,
            droppedExceptionCount: 0,
          }),
        },
      ],
      isError: false,
    } as any);
    vi.spyOn(screenshotTool, 'execute').mockResolvedValue({
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            base64Data: 'abcd1234',
            mimeType: 'image/jpeg',
          }),
        },
      ],
      isError: false,
    } as any);

    networkCaptureStartTool.captureData = new Map([
      [
        7,
        {
          startTime: 50,
          requests: {
            req1: {
              url: 'https://api.example.com/orders',
              method: 'POST',
              status: 200,
              type: 'XHR',
              requestTime: 60,
              responseTime: 70,
              mimeType: 'application/json',
            },
            req2: {
              url: 'https://api.example.com/fail',
              method: 'GET',
              status: 500,
              type: 'XHR',
              requestTime: 80,
              responseTime: 90,
              mimeType: 'application/json',
              errorText: 'server error',
            },
          },
          ignoredRequests: {
            filteredByUrl: 1,
            filteredByMimeType: 0,
            overLimit: 0,
          },
        },
      ],
    ] as any);

    const result = await collectDebugEvidenceTool.execute({
      tabId: 7,
      consoleLimit: 10,
      networkLimit: 2,
    } as any);

    expect(result.isError).toBe(false);
    const parsed = parseJsonResult(result);

    expect(parsed).toMatchObject({
      success: true,
      tool: 'chrome_collect_debug_evidence',
      tab: {
        tabId: 7,
        windowId: 3,
        url: 'https://example.com/checkout',
        title: 'Checkout',
      },
      screenshot: {
        captured: true,
        mimeType: 'image/jpeg',
        base64Data: 'abcd1234',
      },
      console: {
        available: true,
        source: 'buffer',
        messageCount: 2,
        exceptionCount: 1,
        errorLevelMessageCount: 1,
      },
      network: {
        available: true,
        backend: 'webRequest',
        source: 'active',
        requestCount: 2,
        failedRequestCount: 1,
      },
    });
    expect(parsed.console.runtimeExceptionSummary).toMatchObject({
      total: 1,
      unique: 1,
    });
    expect(parsed.network.recentRequests).toHaveLength(2);
  });
});
