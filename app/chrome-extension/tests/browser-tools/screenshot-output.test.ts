import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/utils/image-utils', () => ({
  canvasToDataURL: vi.fn(),
  createImageBitmapFromUrl: vi.fn(),
  cropAndResizeImage: vi.fn(),
  stitchImages: vi.fn(),
  compressImage: vi.fn(),
}));

import { screenshotTool } from '@/entrypoints/background/tools/browser/screenshot';
import { TOOL_MESSAGE_TYPES } from '@/common/message-types';
import { compressImage } from '@/utils/image-utils';

function parseJsonResult(result: { content?: Array<{ type: string; text?: string }> }) {
  return JSON.parse(String(result.content?.[0]?.text || '{}'));
}

describe('screenshot output defaults', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.clearAllMocks();

    (chrome.tabs.query as any) = vi.fn().mockResolvedValue([
      {
        id: 21,
        windowId: 4,
        url: 'https://example.com/page',
        title: 'Example',
        active: true,
      },
    ]);
    (chrome.tabs.captureVisibleTab as any) = vi.fn().mockResolvedValue('data:image/png;base64,raw');
    (globalThis.chrome as any).downloads = {
      download: vi.fn().mockResolvedValue(88),
      search: vi.fn().mockResolvedValue([{ id: 88, filename: 'C:\\Downloads\\shot.png' }]),
    };

    vi.spyOn(screenshotTool as any, 'injectContentScript').mockResolvedValue(undefined);
    vi.spyOn(screenshotTool as any, 'sendMessageToTab').mockImplementation(
      async (_tabId: number, message: Record<string, unknown>) => {
        if (message.action === TOOL_MESSAGE_TYPES.SCREENSHOT_PREPARE_PAGE_FOR_CAPTURE) {
          return { success: true };
        }
        if (message.action === TOOL_MESSAGE_TYPES.SCREENSHOT_GET_PAGE_DETAILS) {
          return {
            totalWidth: 1600,
            totalHeight: 3200,
            viewportWidth: 1280,
            viewportHeight: 720,
            devicePixelRatio: 1,
            currentScrollX: 0,
            currentScrollY: 0,
          };
        }
        if (message.action === TOOL_MESSAGE_TYPES.SCREENSHOT_RESET_PAGE_AFTER_CAPTURE) {
          return { success: true };
        }
        return { success: true };
      },
    );

    (compressImage as any).mockResolvedValue({
      dataUrl: 'data:image/jpeg;base64,small',
      mimeType: 'image/jpeg',
      width: 1000,
      height: 600,
      originalWidth: 1600,
      originalHeight: 900,
    });
  });

  it('does not save a file by default when inline base64 output is requested', async () => {
    const result = await screenshotTool.execute({
      storeBase64: true,
    } as any);

    expect(result.isError).toBe(false);
    expect(chrome.downloads.download).not.toHaveBeenCalled();
    expect(compressImage).toHaveBeenCalledWith(
      'data:image/png;base64,raw',
      expect.objectContaining({
        format: 'image/jpeg',
        maxWidth: 1400,
        maxHeight: 1400,
        quality: 0.78,
      }),
    );

    const parsed = parseJsonResult(result);
    expect(parsed).toMatchObject({
      success: true,
      base64Data: 'small',
      mimeType: 'image/jpeg',
      base64Length: 5,
      outputDimensions: {
        width: 1000,
        height: 600,
      },
      originalDimensions: {
        width: 1600,
        height: 900,
      },
      fileSaved: false,
      captureKind: 'viewport',
    });
  });

  it('can return both inline data and a saved file when savePng is explicitly true', async () => {
    vi.spyOn(screenshotTool as any, '_captureFullPage').mockResolvedValue(
      'data:image/png;base64,full',
    );

    const result = await screenshotTool.execute({
      storeBase64: true,
      savePng: true,
      fullPage: true,
      name: 'full-shot',
    } as any);

    expect(result.isError).toBe(false);
    expect(chrome.downloads.download).toHaveBeenCalledTimes(1);
    expect(compressImage).toHaveBeenCalledWith(
      'data:image/png;base64,full',
      expect.objectContaining({
        format: 'image/jpeg',
        maxWidth: 1280,
        maxHeight: 2400,
        quality: 0.72,
      }),
    );

    const parsed = parseJsonResult(result);
    expect(parsed).toMatchObject({
      success: true,
      fileSaved: true,
      downloadId: 88,
      filename: expect.stringMatching(/^full-shot_/),
      fullPath: 'C:\\Downloads\\shot.png',
      base64Data: 'small',
      captureKind: 'fullPage',
    });
  });
});
