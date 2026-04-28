import { createErrorResponse, type ToolResult } from '@/common/tool-handler';
import { BaseBrowserToolExecutor } from '../base-browser';
import { TOOL_NAMES } from 'chrome-mcp-shared';
import { cdpSessionManager } from '@/utils/cdp-session-manager';

type UploadExecutionStatus = 'pending' | 'completed' | 'failed';
type UploadQueryStatus = UploadExecutionStatus | 'unknown';
type UploadInputState = 'selected' | 'empty' | 'detached' | 'not_file_input' | 'error';

interface FileUploadToolParams {
  selector: string;
  filePath?: string;
  fileUrl?: string;
  base64Data?: string;
  fileName?: string;
  multiple?: boolean;
  tabId?: number;
  windowId?: number;
}

interface GetUploadStatusParams {
  uploadId?: string;
  selector?: string;
  tabId?: number;
  windowId?: number;
}

interface UploadStatusFile {
  name: string;
  size: number;
  type: string;
  lastModified: number;
}

interface UploadInspectionResult {
  found: boolean;
  isFileInput?: boolean;
  inputState: UploadInputState;
  files?: UploadStatusFile[];
  fileCount?: number;
  accept?: string;
  disabled?: boolean;
  multiple?: boolean;
  tagName?: string;
  inputType?: string;
  error?: string;
}

interface UploadSessionRecord {
  uploadId: string;
  status: UploadExecutionStatus;
  tabId: number;
  selector: string;
  startedAt: number;
  completedAt?: number;
  filesRequested: string[];
  multiple: boolean;
  selectedFiles?: UploadStatusFile[];
  fileCount?: number;
  inputState?: UploadInputState;
  accept?: string;
  disabled?: boolean;
  error?: string;
}

const MAX_UPLOAD_SESSIONS = 100;
const uploadSessions = new Map<string, UploadSessionRecord>();
const uploadSessionOrder: string[] = [];

function rememberUploadSession(session: UploadSessionRecord) {
  uploadSessions.set(session.uploadId, session);
  const existingIndex = uploadSessionOrder.indexOf(session.uploadId);
  if (existingIndex >= 0) uploadSessionOrder.splice(existingIndex, 1);
  uploadSessionOrder.push(session.uploadId);

  while (uploadSessionOrder.length > MAX_UPLOAD_SESSIONS) {
    const oldest = uploadSessionOrder.shift();
    if (oldest) uploadSessions.delete(oldest);
  }
}

function findLatestUploadSession(opts: {
  uploadId?: string;
  tabId?: number;
  selector?: string;
}): UploadSessionRecord | undefined {
  if (opts.uploadId) {
    return uploadSessions.get(opts.uploadId);
  }

  for (let i = uploadSessionOrder.length - 1; i >= 0; i--) {
    const uploadId = uploadSessionOrder[i];
    const session = uploadSessions.get(uploadId);
    if (!session) continue;
    if (typeof opts.tabId === 'number' && session.tabId !== opts.tabId) continue;
    if (opts.selector && session.selector !== opts.selector) continue;
    return session;
  }

  return undefined;
}

async function inspectFileInputStatus(
  tabId: number,
  selector: string,
): Promise<UploadInspectionResult> {
  const injected = await chrome.scripting.executeScript({
    target: { tabId } as chrome.scripting.InjectionTarget,
    world: 'MAIN',
    func: (querySelector: string) => {
      try {
        const element = document.querySelector(querySelector);
        if (!element) {
          return { found: false, inputState: 'detached' };
        }
        if (!(element instanceof HTMLInputElement)) {
          return {
            found: true,
            isFileInput: false,
            inputState: 'not_file_input',
            tagName: element.tagName.toLowerCase(),
          };
        }

        const inputType = String(element.getAttribute('type') || element.type || '').toLowerCase();
        if (inputType !== 'file') {
          return {
            found: true,
            isFileInput: false,
            inputState: 'not_file_input',
            tagName: 'input',
            inputType,
          };
        }

        const files = Array.from(element.files || []).map((file) => ({
          name: file.name,
          size: file.size,
          type: file.type,
          lastModified: file.lastModified,
        }));

        return {
          found: true,
          isFileInput: true,
          inputState: files.length > 0 ? 'selected' : 'empty',
          files,
          fileCount: files.length,
          accept: element.accept || '',
          disabled: element.disabled === true,
          multiple: element.multiple === true,
          tagName: 'input',
          inputType,
        };
      } catch (error) {
        return {
          found: false,
          inputState: 'error',
          error: error instanceof Error ? error.message : String(error),
        };
      }
    },
    args: [selector],
  });

  const result = Array.isArray(injected) ? injected[0]?.result : undefined;
  if (!result || typeof result !== 'object') {
    return {
      found: false,
      inputState: 'error',
      error: 'Failed to inspect file input',
    };
  }

  return result as UploadInspectionResult;
}

async function dispatchFileInputChange(tabId: number, selector: string): Promise<void> {
  await chrome.scripting.executeScript({
    target: { tabId } as chrome.scripting.InjectionTarget,
    world: 'MAIN',
    func: (querySelector: string) => {
      const element = document.querySelector(querySelector);
      if (element) {
        element.dispatchEvent(new Event('change', { bubbles: true }));
      }
    },
    args: [selector],
  });
}

export const uploadSessionStore = {
  clear() {
    uploadSessions.clear();
    uploadSessionOrder.length = 0;
  },
  get(uploadId: string) {
    return uploadSessions.get(uploadId);
  },
};

/**
 * Tool for uploading files to web forms using Chrome DevTools Protocol
 * Similar to Playwright's setInputFiles implementation
 */
class FileUploadTool extends BaseBrowserToolExecutor {
  name = TOOL_NAMES.BROWSER.FILE_UPLOAD;

  async execute(args: FileUploadToolParams): Promise<ToolResult> {
    const { selector, filePath, fileUrl, base64Data, fileName, multiple = false } = args;

    console.log(`Starting file upload operation with options:`, args);

    if (!selector) {
      return createErrorResponse('Selector is required for file upload');
    }

    if (!filePath && !fileUrl && !base64Data) {
      return createErrorResponse('One of filePath, fileUrl, or base64Data must be provided');
    }

    const uploadId = `upload_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
    const startedAt = Date.now();

    try {
      const explicit = await this.tryGetTab(args.tabId);
      const tab = explicit || (await this.getActiveTabOrThrowInWindow(args.windowId));
      if (!tab.id) return createErrorResponse('No active tab found');
      const tabId = tab.id;

      let files: string[] = [];

      if (filePath) {
        files = [filePath];
      } else if (fileUrl || base64Data) {
        const tempFilePath = await this.prepareFileFromRemote({
          fileUrl,
          base64Data,
          fileName: fileName || 'uploaded-file',
        });
        if (!tempFilePath) {
          const session: UploadSessionRecord = {
            uploadId,
            status: 'failed',
            tabId,
            selector,
            startedAt,
            completedAt: Date.now(),
            filesRequested: [],
            multiple,
            error: 'Failed to prepare file for upload',
          };
          rememberUploadSession(session);
          return createErrorResponse(
            `Error uploading file [uploadId=${uploadId}]: Failed to prepare file for upload`,
          );
        }
        files = [tempFilePath];
      }

      rememberUploadSession({
        uploadId,
        status: 'pending',
        tabId,
        selector,
        startedAt,
        filesRequested: files,
        multiple,
      });

      await cdpSessionManager.withSession(tabId, 'file-upload', async () => {
        await cdpSessionManager.sendCommand(tabId, 'DOM.enable', {});
        await cdpSessionManager.sendCommand(tabId, 'Runtime.enable', {});

        const { root } = (await cdpSessionManager.sendCommand(tabId, 'DOM.getDocument', {
          depth: -1,
          pierce: true,
        })) as { root: { nodeId: number } };

        const { nodeId } = (await cdpSessionManager.sendCommand(tabId, 'DOM.querySelector', {
          nodeId: root.nodeId,
          selector,
        })) as { nodeId: number };

        if (!nodeId || nodeId === 0) {
          throw new Error(`Element with selector "${selector}" not found`);
        }

        const { node } = (await cdpSessionManager.sendCommand(tabId, 'DOM.describeNode', {
          nodeId,
        })) as { node: { nodeName: string; attributes?: string[] } };

        if (node.nodeName !== 'INPUT') {
          throw new Error(`Element with selector "${selector}" is not an input element`);
        }

        const attributes = node.attributes || [];
        let isFileInput = false;
        for (let i = 0; i < attributes.length; i += 2) {
          if (attributes[i] === 'type' && attributes[i + 1] === 'file') {
            isFileInput = true;
            break;
          }
        }

        if (!isFileInput) {
          throw new Error(`Element with selector "${selector}" is not a file input (type="file")`);
        }

        await cdpSessionManager.sendCommand(tabId, 'DOM.setFileInputFiles', {
          nodeId,
          files,
        });
      });

      await dispatchFileInputChange(tabId, selector);
      const inspection = await inspectFileInputStatus(tabId, selector);
      const completedAt = Date.now();

      const session: UploadSessionRecord = {
        uploadId,
        status: 'completed',
        tabId,
        selector,
        startedAt,
        completedAt,
        filesRequested: files,
        multiple,
        selectedFiles: inspection.files,
        fileCount: inspection.fileCount,
        inputState: inspection.inputState,
        accept: inspection.accept,
        disabled: inspection.disabled,
      };
      rememberUploadSession(session);

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              success: true,
              message: 'File(s) uploaded successfully',
              uploadId,
              status: 'completed',
              selector,
              tabId,
              filesRequested: files,
              fileCount: inspection.fileCount ?? files.length,
              selectedFiles: inspection.files || [],
              inputState: inspection.inputState,
              accept: inspection.accept,
              disabled: inspection.disabled,
              startedAt,
              completedAt,
            }),
          },
        ],
        isError: false,
      };
    } catch (error) {
      console.error('Error in file upload operation:', error);

      const tabId =
        typeof args.tabId === 'number'
          ? args.tabId
          : (await this.getActiveTabInWindow(args.windowId))?.id || 0;
      rememberUploadSession({
        uploadId,
        status: 'failed',
        tabId,
        selector,
        startedAt,
        completedAt: Date.now(),
        filesRequested: filePath ? [filePath] : [],
        multiple,
        error: error instanceof Error ? error.message : String(error),
      });

      return createErrorResponse(
        `Error uploading file [uploadId=${uploadId}]: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  private async prepareFileFromRemote(options: {
    fileUrl?: string;
    base64Data?: string;
    fileName: string;
  }): Promise<string | null> {
    const { fileUrl, base64Data, fileName } = options;

    return new Promise((resolve) => {
      const requestId = `file-upload-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
      const timeout = setTimeout(() => {
        console.error('File preparation request timed out');
        resolve(null);
      }, 30000);

      const handleMessage = (message: any) => {
        if (
          message.type === 'file_operation_response' &&
          message.responseToRequestId === requestId
        ) {
          clearTimeout(timeout);
          chrome.runtime.onMessage.removeListener(handleMessage);

          if (message.payload?.success && message.payload?.filePath) {
            resolve(message.payload.filePath);
          } else {
            console.error(
              'Native host failed to prepare file:',
              message.error || message.payload?.error,
            );
            resolve(null);
          }
        }
      };

      chrome.runtime.onMessage.addListener(handleMessage);

      chrome.runtime
        .sendMessage({
          type: 'forward_to_native',
          message: {
            type: 'file_operation',
            requestId,
            payload: {
              action: 'prepareFile',
              fileUrl,
              base64Data,
              fileName,
            },
          },
        })
        .catch((error) => {
          console.error('Error sending message to background:', error);
          clearTimeout(timeout);
          chrome.runtime.onMessage.removeListener(handleMessage);
          resolve(null);
        });
    });
  }
}

class UploadStatusTool extends BaseBrowserToolExecutor {
  name = TOOL_NAMES.BROWSER.GET_UPLOAD_STATUS as any;

  async execute(args: GetUploadStatusParams): Promise<ToolResult> {
    const uploadId = typeof args?.uploadId === 'string' ? args.uploadId.trim() : '';
    const selector = typeof args?.selector === 'string' ? args.selector.trim() : '';

    try {
      let tabId = typeof args?.tabId === 'number' ? args.tabId : undefined;
      const session = findLatestUploadSession({ uploadId: uploadId || undefined, tabId, selector });

      if (typeof tabId !== 'number' && typeof session?.tabId === 'number' && session.tabId > 0) {
        tabId = session.tabId;
      }

      if (typeof tabId !== 'number') {
        const explicit = await this.tryGetTab(args?.tabId);
        const tab = explicit || (await this.getActiveTabInWindow(args?.windowId));
        tabId = tab?.id;
      }

      const targetSelector = selector || session?.selector || '';
      let liveStatus: UploadInspectionResult | undefined;
      let liveCheckError: string | undefined;

      if (typeof tabId === 'number' && tabId > 0 && targetSelector) {
        try {
          liveStatus = await inspectFileInputStatus(tabId, targetSelector);
        } catch (error) {
          liveCheckError = error instanceof Error ? error.message : String(error);
        }
      } else if (targetSelector) {
        liveCheckError = 'Target tab not found for live upload status check';
      }

      if (!session && !liveStatus) {
        return createErrorResponse('No matching upload status found');
      }

      const status: UploadQueryStatus =
        session?.status || (liveStatus?.inputState === 'selected' ? 'completed' : 'unknown');

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              success: true,
              uploadId: session?.uploadId || uploadId || undefined,
              status,
              selector: targetSelector || undefined,
              tabId,
              startedAt: session?.startedAt,
              completedAt: session?.completedAt,
              filesRequested: session?.filesRequested || [],
              selectedFiles: session?.selectedFiles || [],
              fileCount: session?.fileCount,
              currentInputState: liveStatus?.inputState,
              currentFiles: liveStatus?.files || [],
              currentFileCount: liveStatus?.fileCount,
              accept: liveStatus?.accept ?? session?.accept,
              disabled: liveStatus?.disabled ?? session?.disabled,
              multiple: liveStatus?.multiple ?? session?.multiple,
              liveCheckError,
              error: session?.error || liveStatus?.error,
            }),
          },
        ],
        isError: false,
      };
    } catch (error) {
      return createErrorResponse(
        `Get upload status failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}

export const fileUploadTool = new FileUploadTool();
export const uploadStatusTool = new UploadStatusTool();
