import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  fileUploadTool,
  uploadSessionStore,
  uploadStatusTool,
} from '@/entrypoints/background/tools/browser/file-upload';
import { cdpSessionManager } from '@/utils/cdp-session-manager';

function parseJsonResult(result: { content?: Array<{ type: string; text?: string }> }) {
  const text = result.content?.[0]?.text;
  return JSON.parse(String(text || '{}'));
}

describe('upload status tracking', () => {
  const tabId = 51;

  beforeEach(() => {
    vi.clearAllMocks();
    uploadSessionStore.clear();

    (chrome.tabs.get as any) = vi.fn().mockResolvedValue({
      id: tabId,
      url: 'https://example.com/upload',
      title: 'Upload',
      windowId: 1,
    });
    (chrome.tabs.query as any) = vi.fn().mockResolvedValue([
      {
        id: tabId,
        url: 'https://example.com/upload',
        title: 'Upload',
        windowId: 1,
        active: true,
      },
    ]);
    (chrome.runtime as any).onMessage = {
      addListener: vi.fn(),
      removeListener: vi.fn(),
    };
    (chrome.runtime.sendMessage as any) = vi.fn().mockResolvedValue(undefined);
    (globalThis.chrome as any).scripting = {
      executeScript: vi.fn(),
    };
  });

  it('returns uploadId and browser-side selection details after upload', async () => {
    vi.spyOn(cdpSessionManager, 'withSession').mockImplementation(async (_tabId, _owner, fn) =>
      fn(),
    );
    vi.spyOn(cdpSessionManager, 'sendCommand').mockImplementation(async (_tabId, method) => {
      if (method === 'DOM.getDocument') return { root: { nodeId: 1 } } as any;
      if (method === 'DOM.querySelector') return { nodeId: 2 } as any;
      if (method === 'DOM.describeNode') {
        return { node: { nodeName: 'INPUT', attributes: ['type', 'file'] } } as any;
      }
      return {} as any;
    });

    const selectedFileInput = {
      found: true,
      isFileInput: true,
      inputState: 'selected',
      fileCount: 1,
      files: [
        {
          name: 'report.csv',
          size: 123,
          type: 'text/csv',
          lastModified: 1,
        },
      ],
      accept: '.csv',
      disabled: false,
      multiple: false,
    };

    (chrome.scripting.executeScript as any)
      .mockResolvedValueOnce([
        {
          result: {
            found: true,
            isFileInput: true,
            inputState: 'empty',
            accept: '.csv',
            disabled: false,
            multiple: false,
          },
        },
      ])
      .mockResolvedValueOnce([
        {
          result: {
            found: true,
            dispatchedEvents: ['input', 'change', 'blur'],
          },
        },
      ])
      .mockResolvedValueOnce([{ result: selectedFileInput }])
      .mockResolvedValueOnce([{ result: selectedFileInput }]);

    const uploadResult = await fileUploadTool.execute({
      tabId,
      selector: '#file-input',
      filePath: 'C:\\tmp\\report.csv',
    } as any);

    expect(uploadResult.isError).toBe(false);
    const uploadPayload = parseJsonResult(uploadResult);
    expect(uploadPayload).toMatchObject({
      success: true,
      status: 'completed',
      selector: '#file-input',
      fileCount: 1,
      inputState: 'selected',
      selectedFiles: [{ name: 'report.csv' }],
      eventsDispatched: ['input', 'change', 'blur'],
      warnings: [],
    });
    expect(uploadPayload.uploadId).toEqual(expect.any(String));

    const statusResult = await uploadStatusTool.execute({
      uploadId: uploadPayload.uploadId,
    } as any);

    expect(statusResult.isError).toBe(false);
    expect(parseJsonResult(statusResult)).toMatchObject({
      success: true,
      uploadId: uploadPayload.uploadId,
      status: 'completed',
      selector: '#file-input',
      currentInputState: 'selected',
      currentFiles: [{ name: 'report.csv' }],
      eventsDispatched: ['input', 'change', 'blur'],
    });
  });

  it('fails before CDP upload when the file input is disabled', async () => {
    const withSessionSpy = vi.spyOn(cdpSessionManager, 'withSession');

    (chrome.scripting.executeScript as any).mockResolvedValue([
      {
        result: {
          found: true,
          isFileInput: true,
          inputState: 'empty',
          accept: '',
          disabled: true,
          multiple: false,
        },
      },
    ]);

    const uploadResult = await fileUploadTool.execute({
      tabId,
      selector: '#disabled-file-input',
      filePath: 'C:\\tmp\\report.csv',
    } as any);

    expect(uploadResult.isError).toBe(true);
    expect(uploadResult.content?.[0]?.text).toContain('disabled');
    expect(withSessionSpy).not.toHaveBeenCalled();
  });

  it('can click a trigger before setting a dynamically created file input', async () => {
    vi.spyOn(cdpSessionManager, 'withSession').mockImplementation(async (_tabId, _owner, fn) =>
      fn(),
    );
    vi.spyOn(cdpSessionManager, 'sendCommand').mockImplementation(async (_tabId, method) => {
      if (method === 'DOM.getDocument') return { root: { nodeId: 1 } } as any;
      if (method === 'DOM.querySelector') return { nodeId: 4 } as any;
      if (method === 'DOM.describeNode') {
        return { node: { nodeName: 'INPUT', attributes: ['type', 'file'] } } as any;
      }
      return {} as any;
    });

    const selectedFileInput = {
      found: true,
      isFileInput: true,
      inputState: 'selected',
      fileCount: 1,
      files: [{ name: 'dynamic.txt', size: 12, type: 'text/plain', lastModified: 3 }],
      accept: '',
      disabled: false,
      multiple: false,
    };

    (chrome.scripting.executeScript as any)
      .mockResolvedValueOnce([
        {
          result: {
            found: true,
            clicked: true,
            elapsedMs: 60,
          },
        },
      ])
      .mockResolvedValueOnce([
        {
          result: {
            found: true,
            isFileInput: true,
            inputState: 'empty',
            accept: '',
            disabled: false,
            multiple: false,
          },
        },
      ])
      .mockResolvedValueOnce([
        {
          result: {
            found: true,
            dispatchedEvents: ['input', 'change', 'blur'],
          },
        },
      ])
      .mockResolvedValueOnce([{ result: selectedFileInput }]);

    const uploadResult = await fileUploadTool.execute({
      tabId,
      selector: 'input[type=file]',
      triggerSelector: '#upload-button',
      filePath: 'C:\\tmp\\dynamic.txt',
    } as any);

    expect(uploadResult.isError).toBe(false);
    expect(parseJsonResult(uploadResult)).toMatchObject({
      success: true,
      mode: 'fileInput',
      triggerSelector: '#upload-button',
      triggerResult: { found: true, clicked: true },
      selectedFiles: [{ name: 'dynamic.txt' }],
    });
  });

  it('supports drag/drop upload mode by using a temporary file input', async () => {
    vi.spyOn(cdpSessionManager, 'withSession').mockImplementation(async (_tabId, _owner, fn) =>
      fn(),
    );
    const sendCommandSpy = vi
      .spyOn(cdpSessionManager, 'sendCommand')
      .mockImplementation(async (_tabId, method) => {
        if (method === 'DOM.getDocument') return { root: { nodeId: 1 } } as any;
        if (method === 'DOM.querySelector') return { nodeId: 9 } as any;
        return {} as any;
      });

    (chrome.scripting.executeScript as any)
      .mockResolvedValueOnce([{ result: { created: true } }])
      .mockResolvedValueOnce([
        {
          result: {
            found: true,
            dispatchedEvents: ['dragenter', 'dragover', 'drop'],
            dropAccepted: true,
            fileCount: 1,
            files: [
              {
                name: 'avatar.png',
                size: 456,
                type: 'image/png',
                lastModified: 2,
              },
            ],
          },
        },
      ])
      .mockResolvedValueOnce([{}]);

    const uploadResult = await fileUploadTool.execute({
      tabId,
      selector: '#drop-zone',
      mode: 'dragDrop',
      filePath: 'C:\\tmp\\avatar.png',
    } as any);

    expect(uploadResult.isError).toBe(false);
    expect(parseJsonResult(uploadResult)).toMatchObject({
      success: true,
      status: 'completed',
      mode: 'dragDrop',
      selector: '#drop-zone',
      fileCount: 1,
      selectedFiles: [{ name: 'avatar.png' }],
      eventsDispatched: ['dragenter', 'dragover', 'drop'],
      dropAccepted: true,
    });

    expect(sendCommandSpy).toHaveBeenCalledWith(tabId, 'DOM.setFileInputFiles', {
      nodeId: 9,
      files: ['C:\\tmp\\avatar.png'],
    });
  });

  it('stores failed uploads and exposes the error via status lookup', async () => {
    vi.spyOn(cdpSessionManager, 'withSession').mockImplementation(async (_tabId, _owner, fn) =>
      fn(),
    );
    vi.spyOn(cdpSessionManager, 'sendCommand').mockImplementation(async (_tabId, method) => {
      if (method === 'DOM.getDocument') return { root: { nodeId: 1 } } as any;
      if (method === 'DOM.querySelector') return { nodeId: 0 } as any;
      return {} as any;
    });

    (chrome.scripting.executeScript as any).mockResolvedValue([
      {
        result: {
          found: false,
          inputState: 'detached',
        },
      },
    ]);

    const uploadResult = await fileUploadTool.execute({
      tabId,
      selector: '#missing-file-input',
      filePath: 'C:\\tmp\\report.csv',
    } as any);

    expect(uploadResult.isError).toBe(true);
    expect(uploadResult.content?.[0]?.text).toContain('uploadId=');

    const statusResult = await uploadStatusTool.execute({
      tabId,
      selector: '#missing-file-input',
    } as any);

    expect(statusResult.isError).toBe(false);
    expect(parseJsonResult(statusResult)).toMatchObject({
      success: true,
      status: 'failed',
      selector: '#missing-file-input',
      currentInputState: 'detached',
      error: expect.stringContaining('not found'),
    });
  });
});
