import { createErrorResponse, type ToolResult } from '@/common/tool-handler';
import { BaseBrowserToolExecutor } from '../base-browser';
import { TOOL_NAMES } from 'chrome-mcp-shared';
import { cdpSessionManager } from '@/utils/cdp-session-manager';

type UploadExecutionStatus = 'pending' | 'completed' | 'failed';
type UploadQueryStatus = UploadExecutionStatus | 'unknown';
type UploadInputState = 'selected' | 'empty' | 'detached' | 'not_file_input' | 'error';
type UploadMode = 'fileInput' | 'dragDrop';

interface FileUploadToolParams {
  selector: string;
  mode?: UploadMode;
  triggerSelector?: string;
  waitForInputMs?: number;
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

interface UploadEventDispatchResult {
  found: boolean;
  dispatchedEvents: string[];
  error?: string;
}

interface DragDropUploadResult extends UploadEventDispatchResult {
  fileCount?: number;
  files?: UploadStatusFile[];
  dropAccepted?: boolean;
}

interface FileInputTriggerResult {
  found: boolean;
  clicked: boolean;
  elapsedMs: number;
  error?: string;
}

interface UploadSessionRecord {
  uploadId: string;
  status: UploadExecutionStatus;
  mode: UploadMode;
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
  eventsDispatched?: string[];
  acceptMismatch?: boolean;
  warnings?: string[];
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

function getAttributeValue(attributes: string[], name: string): string | undefined {
  const normalizedName = name.toLowerCase();
  for (let index = 0; index < attributes.length; index += 2) {
    if (String(attributes[index] || '').toLowerCase() === normalizedName) {
      return attributes[index + 1] ?? '';
    }
  }
  return undefined;
}

function hasAttribute(attributes: string[], name: string): boolean {
  return getAttributeValue(attributes, name) !== undefined;
}

function getFileName(input: string): string {
  const trimmed = input.trim();
  const withoutQuery = trimmed.split(/[?#]/, 1)[0] || trimmed;
  const parts = withoutQuery.split(/[\\/]/);
  return parts[parts.length - 1] || withoutQuery;
}

function getFileExtension(input: string): string {
  const fileName = getFileName(input).toLowerCase();
  const dotIndex = fileName.lastIndexOf('.');
  return dotIndex >= 0 ? fileName.slice(dotIndex) : '';
}

function hasAcceptMismatch(files: string[], accept?: string): boolean {
  const extensionRules = String(accept || '')
    .split(',')
    .map((item) => item.trim().toLowerCase())
    .filter((item) => item.startsWith('.'));

  if (extensionRules.length === 0) return false;

  return files.some((file) => {
    const extension = getFileExtension(file);
    return extension !== '' && !extensionRules.includes(extension);
  });
}

async function dispatchFileInputEvents(
  tabId: number,
  selector: string,
): Promise<UploadEventDispatchResult> {
  const injected = await chrome.scripting.executeScript({
    target: { tabId } as chrome.scripting.InjectionTarget,
    world: 'MAIN',
    func: (querySelector: string) => {
      try {
        const element = document.querySelector(querySelector);
        if (!element) {
          return { found: false, dispatchedEvents: [] };
        }

        const dispatchedEvents: string[] = [];
        element.dispatchEvent(new Event('input', { bubbles: true }));
        dispatchedEvents.push('input');
        element.dispatchEvent(new Event('change', { bubbles: true }));
        dispatchedEvents.push('change');

        if (element instanceof HTMLElement) {
          element.blur();
          element.dispatchEvent(new Event('blur'));
          dispatchedEvents.push('blur');
        }

        return { found: true, dispatchedEvents };
      } catch (error) {
        return {
          found: false,
          dispatchedEvents: [],
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
      dispatchedEvents: [],
      error: 'Failed to dispatch upload input/change events',
    };
  }

  return result as UploadEventDispatchResult;
}

async function createTemporaryFileInput(
  tabId: number,
  uploadId: string,
  multiple: boolean,
): Promise<string> {
  const tempSelector = `[data-chrome-mcp-upload-id="${uploadId}"]`;

  const injected = await chrome.scripting.executeScript({
    target: { tabId } as chrome.scripting.InjectionTarget,
    world: 'MAIN',
    func: (id: string, allowMultiple: boolean) => {
      document
        .querySelectorAll(`input[data-chrome-mcp-upload-id="${id}"]`)
        .forEach((element) => element.remove());

      const input = document.createElement('input');
      input.type = 'file';
      input.multiple = allowMultiple;
      input.setAttribute('data-chrome-mcp-upload-id', id);
      input.style.position = 'fixed';
      input.style.left = '-10000px';
      input.style.top = '-10000px';
      input.style.width = '1px';
      input.style.height = '1px';
      input.style.opacity = '0';
      document.documentElement.appendChild(input);
      return { created: true };
    },
    args: [uploadId, multiple],
  });

  const result = Array.isArray(injected) ? injected[0]?.result : undefined;
  if (!result || typeof result !== 'object' || !(result as { created?: boolean }).created) {
    throw new Error('Failed to create temporary file input for drag/drop upload');
  }

  return tempSelector;
}

async function removeTemporaryFileInput(tabId: number, tempSelector: string): Promise<void> {
  await chrome.scripting
    .executeScript({
      target: { tabId } as chrome.scripting.InjectionTarget,
      world: 'MAIN',
      func: (selector: string) => {
        document.querySelector(selector)?.remove();
      },
      args: [tempSelector],
    })
    .catch(() => undefined);
}

async function setTemporaryInputFilesWithCdp(
  tabId: number,
  tempSelector: string,
  files: string[],
): Promise<void> {
  await cdpSessionManager.withSession(tabId, 'file-upload', async () => {
    await cdpSessionManager.sendCommand(tabId, 'DOM.enable', {});

    const { root } = (await cdpSessionManager.sendCommand(tabId, 'DOM.getDocument', {
      depth: -1,
      pierce: true,
    })) as { root: { nodeId: number } };

    const { nodeId } = (await cdpSessionManager.sendCommand(tabId, 'DOM.querySelector', {
      nodeId: root.nodeId,
      selector: tempSelector,
    })) as { nodeId: number };

    if (!nodeId || nodeId === 0) {
      throw new Error('Temporary file input not found');
    }

    await cdpSessionManager.sendCommand(tabId, 'DOM.setFileInputFiles', {
      nodeId,
      files,
    });
  });
}

async function dispatchDragDropUpload(
  tabId: number,
  dropSelector: string,
  tempInputSelector: string,
): Promise<DragDropUploadResult> {
  const injected = await chrome.scripting.executeScript({
    target: { tabId } as chrome.scripting.InjectionTarget,
    world: 'MAIN',
    func: (targetSelector: string, inputSelector: string) => {
      try {
        const target = document.querySelector(targetSelector);
        if (!target) {
          return { found: false, dispatchedEvents: [], error: 'Drop target not found' };
        }

        const input = document.querySelector(inputSelector);
        if (!(input instanceof HTMLInputElement)) {
          return { found: false, dispatchedEvents: [], error: 'Temporary file input not found' };
        }

        const files = Array.from(input.files || []);
        if (files.length === 0) {
          return { found: true, dispatchedEvents: [], fileCount: 0, files: [] };
        }

        const dataTransfer = new DataTransfer();
        for (const file of files) {
          dataTransfer.items.add(file);
        }
        dataTransfer.effectAllowed = 'all';
        dataTransfer.dropEffect = 'copy';

        const dispatchedEvents: string[] = [];
        let dropAccepted = false;

        const dispatchDragEvent = (type: string) => {
          let event: Event;
          try {
            event = new DragEvent(type, {
              bubbles: true,
              cancelable: true,
              composed: true,
              dataTransfer,
            });
          } catch {
            event = new Event(type, { bubbles: true, cancelable: true, composed: true });
            Object.defineProperty(event, 'dataTransfer', { value: dataTransfer });
          }

          const accepted = target.dispatchEvent(event);
          dispatchedEvents.push(type);
          if (type === 'drop') dropAccepted = accepted;
        };

        dispatchDragEvent('dragenter');
        dispatchDragEvent('dragover');
        dispatchDragEvent('drop');
        input.remove();

        return {
          found: true,
          dispatchedEvents,
          dropAccepted,
          fileCount: files.length,
          files: files.map((file) => ({
            name: file.name,
            size: file.size,
            type: file.type,
            lastModified: file.lastModified,
          })),
        };
      } catch (error) {
        return {
          found: false,
          dispatchedEvents: [],
          error: error instanceof Error ? error.message : String(error),
        };
      }
    },
    args: [dropSelector, tempInputSelector],
  });

  const result = Array.isArray(injected) ? injected[0]?.result : undefined;
  if (!result || typeof result !== 'object') {
    return {
      found: false,
      dispatchedEvents: [],
      error: 'Failed to dispatch drag/drop upload events',
    };
  }

  return result as DragDropUploadResult;
}

async function triggerAndWaitForFileInput(
  tabId: number,
  triggerSelector: string,
  inputSelector: string,
  timeoutMs: number,
): Promise<FileInputTriggerResult> {
  const injected = await chrome.scripting.executeScript({
    target: { tabId } as chrome.scripting.InjectionTarget,
    world: 'MAIN',
    func: async (buttonSelector: string, fileInputSelector: string, waitMs: number) => {
      const startedAt = Date.now();
      const trigger = document.querySelector(buttonSelector);
      if (!trigger) {
        return {
          found: false,
          clicked: false,
          elapsedMs: Date.now() - startedAt,
          error: `Trigger "${buttonSelector}" not found`,
        };
      }

      if (trigger instanceof HTMLElement) {
        trigger.click();
      } else {
        trigger.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
      }

      const isFileInput = (element: Element | null) =>
        element instanceof HTMLInputElement &&
        String(element.getAttribute('type') || element.type || '').toLowerCase() === 'file';

      while (Date.now() - startedAt <= waitMs) {
        if (isFileInput(document.querySelector(fileInputSelector))) {
          return {
            found: true,
            clicked: true,
            elapsedMs: Date.now() - startedAt,
          };
        }
        await new Promise((resolve) => setTimeout(resolve, 50));
      }

      return {
        found: false,
        clicked: true,
        elapsedMs: Date.now() - startedAt,
        error: `File input "${fileInputSelector}" did not appear within ${waitMs}ms`,
      };
    },
    args: [triggerSelector, inputSelector, timeoutMs],
  });

  const result = Array.isArray(injected) ? injected[0]?.result : undefined;
  if (!result || typeof result !== 'object') {
    return {
      found: false,
      clicked: false,
      elapsedMs: 0,
      error: 'Failed to trigger and wait for file input',
    };
  }

  return result as FileInputTriggerResult;
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
    const {
      selector,
      triggerSelector,
      waitForInputMs,
      filePath,
      fileUrl,
      base64Data,
      fileName,
      multiple = false,
    } = args;
    const mode: UploadMode = args.mode === 'dragDrop' ? 'dragDrop' : 'fileInput';

    console.log(`Starting file upload operation with options:`, args);

    if (!selector) {
      return createErrorResponse('Selector is required for file upload');
    }

    if (!filePath && !fileUrl && !base64Data) {
      return createErrorResponse('One of filePath, fileUrl, or base64Data must be provided');
    }

    const uploadId = `upload_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
    const startedAt = Date.now();
    let filesRequested: string[] = filePath ? [filePath] : [];

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
            mode,
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
      filesRequested = files;

      const warnings: string[] = [];
      let triggerResult: FileInputTriggerResult | undefined;

      if (mode === 'dragDrop') {
        rememberUploadSession({
          uploadId,
          status: 'pending',
          mode,
          tabId,
          selector,
          startedAt,
          filesRequested: files,
          multiple: multiple || files.length > 1,
        });

        const tempSelector = await createTemporaryFileInput(tabId, uploadId, true);
        let dropResult: DragDropUploadResult | undefined;

        try {
          await setTemporaryInputFilesWithCdp(tabId, tempSelector, files);
          dropResult = await dispatchDragDropUpload(tabId, selector, tempSelector);
        } finally {
          await removeTemporaryFileInput(tabId, tempSelector);
        }

        if (!dropResult || !dropResult.found || dropResult.error) {
          throw new Error(dropResult.error || `Drop target "${selector}" not found`);
        }

        if (!dropResult.fileCount) {
          warnings.push('Drop event dispatched, but no files were attached to DataTransfer');
        }

        const completedAt = Date.now();
        const inputState: UploadInputState = dropResult.fileCount ? 'selected' : 'empty';
        const session: UploadSessionRecord = {
          uploadId,
          status: 'completed',
          mode,
          tabId,
          selector,
          startedAt,
          completedAt,
          filesRequested: files,
          multiple: multiple || files.length > 1,
          selectedFiles: dropResult.files,
          fileCount: dropResult.fileCount,
          inputState,
          eventsDispatched: dropResult.dispatchedEvents,
          warnings,
        };
        rememberUploadSession(session);

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                success: true,
                message: 'File(s) drag-dropped successfully',
                uploadId,
                status: 'completed',
                mode,
                selector,
                tabId,
                filesRequested: files,
                fileCount: dropResult.fileCount ?? files.length,
                selectedFiles: dropResult.files || [],
                inputState,
                eventsDispatched: dropResult.dispatchedEvents,
                dropAccepted: dropResult.dropAccepted,
                warnings,
                startedAt,
                completedAt,
              }),
            },
          ],
          isError: false,
        };
      }

      if (triggerSelector) {
        const waitMs =
          typeof waitForInputMs === 'number' && Number.isFinite(waitForInputMs)
            ? Math.min(10_000, Math.max(100, Math.floor(waitForInputMs)))
            : 3000;

        triggerResult = await triggerAndWaitForFileInput(tabId, triggerSelector, selector, waitMs);
        if (!triggerResult.found) {
          throw new Error(triggerResult.error || `File input "${selector}" did not appear`);
        }
      }

      const preInspection = await inspectFileInputStatus(tabId, selector).catch(
        (error): UploadInspectionResult => ({
          found: false,
          inputState: 'error',
          error: error instanceof Error ? error.message : String(error),
        }),
      );

      if (preInspection.found && preInspection.isFileInput === false) {
        throw new Error(`Element with selector "${selector}" is not a file input`);
      }

      if (preInspection.found && preInspection.disabled === true) {
        throw new Error(`File input "${selector}" is disabled`);
      }

      if (files.length > 1 && preInspection.found && preInspection.multiple === false) {
        throw new Error(`File input "${selector}" does not accept multiple files`);
      }

      rememberUploadSession({
        uploadId,
        status: 'pending',
        mode,
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
        const inputType = String(getAttributeValue(attributes, 'type') || '').toLowerCase();
        const isFileInput = inputType === 'file';

        if (!isFileInput) {
          throw new Error(`Element with selector "${selector}" is not a file input (type="file")`);
        }

        if (hasAttribute(attributes, 'disabled')) {
          throw new Error(`File input "${selector}" is disabled`);
        }

        if (files.length > 1 && !hasAttribute(attributes, 'multiple')) {
          throw new Error(`File input "${selector}" does not accept multiple files`);
        }

        const accept = getAttributeValue(attributes, 'accept') || preInspection.accept || '';
        if (hasAcceptMismatch(files, accept)) {
          warnings.push(`File extension may not match accept="${accept}"`);
        }

        await cdpSessionManager.sendCommand(tabId, 'DOM.setFileInputFiles', {
          nodeId,
          files,
        });
      });

      const eventsResult = await dispatchFileInputEvents(tabId, selector);
      if (eventsResult.error) {
        warnings.push(eventsResult.error);
      }

      const inspection = await inspectFileInputStatus(tabId, selector);
      const completedAt = Date.now();
      const finalMultiple = inspection.multiple ?? preInspection.multiple ?? multiple;
      const finalAccept = inspection.accept ?? preInspection.accept;
      const finalDisabled = inspection.disabled ?? preInspection.disabled;
      const acceptMismatch = hasAcceptMismatch(files, finalAccept);

      if (acceptMismatch && !warnings.some((warning) => warning.includes('accept='))) {
        warnings.push(`File extension may not match accept="${finalAccept}"`);
      }

      if (inspection.found && inspection.isFileInput && inspection.inputState !== 'selected') {
        warnings.push(`File input state is "${inspection.inputState}" after upload`);
      }

      const session: UploadSessionRecord = {
        uploadId,
        status: 'completed',
        mode,
        tabId,
        selector,
        startedAt,
        completedAt,
        filesRequested: files,
        selectedFiles: inspection.files,
        fileCount: inspection.fileCount,
        inputState: inspection.inputState,
        accept: finalAccept,
        disabled: finalDisabled,
        multiple: finalMultiple,
        eventsDispatched: eventsResult.dispatchedEvents,
        acceptMismatch,
        warnings,
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
              mode,
              selector,
              triggerSelector,
              triggerResult,
              tabId,
              filesRequested: files,
              fileCount: inspection.fileCount ?? files.length,
              selectedFiles: inspection.files || [],
              inputState: inspection.inputState,
              accept: finalAccept,
              disabled: finalDisabled,
              multiple: finalMultiple,
              eventsDispatched: eventsResult.dispatchedEvents,
              acceptMismatch,
              warnings,
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
        mode,
        tabId,
        selector,
        startedAt,
        completedAt: Date.now(),
        filesRequested,
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

      const shouldLiveCheck = session?.mode !== 'dragDrop';

      if (shouldLiveCheck && typeof tabId === 'number' && tabId > 0 && targetSelector) {
        try {
          liveStatus = await inspectFileInputStatus(tabId, targetSelector);
        } catch (error) {
          liveCheckError = error instanceof Error ? error.message : String(error);
        }
      } else if (shouldLiveCheck && targetSelector) {
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
              mode: session?.mode,
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
              eventsDispatched: session?.eventsDispatched || [],
              acceptMismatch: session?.acceptMismatch,
              warnings: session?.warnings || [],
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
