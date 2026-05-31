import { createErrorResponse, type ToolResult } from '@/common/tool-handler';
import { BaseBrowserToolExecutor } from '../base-browser';
import { TOOL_NAMES } from 'chrome-mcp-shared';
import { cdpSessionManager } from '@/utils/cdp-session-manager';
import {
  DEFAULT_MAX_OUTPUT_BYTES,
  sanitizeAndLimitOutput,
  sanitizeText,
} from '@/utils/output-sanitizer';

const DEFAULT_TIMEOUT_MS = 15_000;
const MAX_TIMEOUT_MS = 120_000;
const MAX_BATCH_COMMANDS = 50;

interface CdpCommandParams {
  method?: string;
  params?: Record<string, unknown>;
  tabId?: number;
  windowId?: number;
  bringToFront?: boolean;
  timeoutMs?: number;
  maxOutputBytes?: number;
  sanitizeOutput?: boolean;
}

interface CdpBatchItem {
  method?: string;
  params?: Record<string, unknown>;
  label?: string;
  continueOnError?: boolean;
}

interface CdpBatchParams {
  commands?: CdpBatchItem[];
  tabId?: number;
  windowId?: number;
  bringToFront?: boolean;
  timeoutMs?: number;
  maxOutputBytes?: number;
  sanitizeOutput?: boolean;
}

interface SerializedResult {
  result?: unknown;
  resultText?: string;
  truncated?: boolean;
  redacted?: boolean;
  originalBytes?: number;
}

function clampInt(value: unknown, fallback: number, min: number, max: number): number {
  const num = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(num)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(num)));
}

function normalizeMethod(method: unknown): string {
  return typeof method === 'string' ? method.trim() : '';
}

function isPlainParams(value: unknown): value is Record<string, unknown> {
  return (
    value === undefined || (typeof value === 'object' && value !== null && !Array.isArray(value))
  );
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`CDP command timed out after ${timeoutMs}ms`)),
      timeoutMs,
    );
    promise
      .then(resolve)
      .catch(reject)
      .finally(() => clearTimeout(timer));
  });
}

function safeJsonStringify(value: unknown): string {
  try {
    const text = JSON.stringify(value);
    return typeof text === 'string' ? text : String(value);
  } catch {
    return String(value);
  }
}

function byteLength(text: string): number {
  return new TextEncoder().encode(text).length;
}

function truncateTextByBytes(
  text: string,
  maxBytes: number,
): { text: string; truncated: boolean; originalBytes: number } {
  const originalBytes = byteLength(text);
  if (originalBytes <= maxBytes) return { text, truncated: false, originalBytes };

  const encoder = new TextEncoder();
  let out = '';
  let used = 0;
  for (const char of text) {
    const len = encoder.encode(char).length;
    if (used + len > maxBytes) break;
    out += char;
    used += len;
  }
  return {
    text: `${out}... [truncated ${originalBytes - used} bytes]`,
    truncated: true,
    originalBytes,
  };
}

function maybeParseJson(text: string): { parsed: boolean; value?: unknown } {
  const trimmed = text.trim();
  if (!trimmed || !['{', '[', '"'].includes(trimmed[0])) return { parsed: false };
  try {
    return { parsed: true, value: JSON.parse(trimmed) };
  } catch {
    return { parsed: false };
  }
}

function serializeResult(
  value: unknown,
  options: { maxOutputBytes: number; sanitizeOutput: boolean },
): SerializedResult {
  if (options.sanitizeOutput) {
    const sanitized = sanitizeAndLimitOutput(value, { maxBytes: options.maxOutputBytes });
    const parsed = sanitized.truncated ? { parsed: false } : maybeParseJson(sanitized.text);
    return {
      ...(parsed.parsed ? { result: parsed.value } : { resultText: sanitized.text }),
      truncated: sanitized.truncated || undefined,
      redacted: sanitized.redacted || undefined,
      originalBytes: sanitized.originalBytes,
    };
  }

  const raw = safeJsonStringify(value);
  const limited = truncateTextByBytes(raw, options.maxOutputBytes);
  const parsed = limited.truncated ? { parsed: false } : maybeParseJson(limited.text);
  return {
    ...(parsed.parsed ? { result: parsed.value } : { resultText: limited.text }),
    truncated: limited.truncated || undefined,
    redacted: false,
    originalBytes: limited.originalBytes,
  };
}

function serializeError(error: unknown): { message: string } {
  const raw = error instanceof Error ? error.message : String(error);
  return { message: sanitizeText(raw).text };
}

abstract class CdpBaseTool extends BaseBrowserToolExecutor {
  protected createJsonSuccess(payload: Record<string, unknown>): ToolResult {
    return {
      content: [{ type: 'text', text: JSON.stringify(payload) }],
      isError: false,
    };
  }

  protected async resolveTargetTab(args: { tabId?: number; windowId?: number }) {
    const explicit = await this.tryGetTab(args.tabId);
    return explicit || (await this.getActiveTabOrThrowInWindow(args.windowId));
  }

  protected normalizeOptions(args: {
    timeoutMs?: number;
    maxOutputBytes?: number;
    sanitizeOutput?: boolean;
  }) {
    return {
      timeoutMs: clampInt(args.timeoutMs, DEFAULT_TIMEOUT_MS, 100, MAX_TIMEOUT_MS),
      maxOutputBytes: clampInt(args.maxOutputBytes, DEFAULT_MAX_OUTPUT_BYTES, 100, 2_000_000),
      sanitizeOutput: args.sanitizeOutput !== false,
    };
  }

  protected async sendCdpCommand(
    tabId: number,
    method: string,
    params: Record<string, unknown> | undefined,
    options: { timeoutMs: number; maxOutputBytes: number; sanitizeOutput: boolean },
  ) {
    const startedAt = performance.now();
    try {
      const rawResult = await withTimeout(
        cdpSessionManager.sendCommand(tabId, method, params || {}),
        options.timeoutMs,
      );
      return {
        success: true,
        method,
        elapsedMs: Math.round(performance.now() - startedAt),
        ...serializeResult(rawResult, options),
      };
    } catch (error) {
      return {
        success: false,
        method,
        elapsedMs: Math.round(performance.now() - startedAt),
        error: serializeError(error),
      };
    }
  }
}

class CdpCommandTool extends CdpBaseTool {
  name = TOOL_NAMES.BROWSER.CDP_COMMAND;

  async execute(args: CdpCommandParams): Promise<ToolResult> {
    const method = normalizeMethod(args?.method);
    if (!method) return createErrorResponse('method is required');
    if (!isPlainParams(args?.params)) return createErrorResponse('params must be an object');

    try {
      const tab = await this.resolveTargetTab(args || {});
      if (!tab.id) return createErrorResponse('Active tab has no ID');

      const options = this.normalizeOptions(args || {});

      const result = await cdpSessionManager.withSession(tab.id, 'cdp-command', async () => {
        if (args?.bringToFront === true) {
          await cdpSessionManager.sendCommand(tab.id!, 'Page.bringToFront', {});
        }
        return await this.sendCdpCommand(tab.id!, method, args?.params, options);
      });

      return this.createJsonSuccess({
        tool: this.name,
        tabId: tab.id,
        windowId: tab.windowId,
        sanitizeOutput: options.sanitizeOutput,
        ...result,
      });
    } catch (error) {
      return createErrorResponse(
        `Error sending CDP command: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}

class CdpBatchTool extends CdpBaseTool {
  name = TOOL_NAMES.BROWSER.CDP_BATCH;

  async execute(args: CdpBatchParams): Promise<ToolResult> {
    const commands = Array.isArray(args?.commands)
      ? args.commands.slice(0, MAX_BATCH_COMMANDS)
      : [];
    if (commands.length === 0) return createErrorResponse('commands must be a non-empty array');
    if (Array.isArray(args?.commands) && args.commands.length > MAX_BATCH_COMMANDS) {
      return createErrorResponse(`commands exceeds max batch size ${MAX_BATCH_COMMANDS}`);
    }

    for (let index = 0; index < commands.length; index += 1) {
      const command = commands[index];
      if (!normalizeMethod(command?.method)) {
        return createErrorResponse(`commands[${index}].method is required`);
      }
      if (!isPlainParams(command?.params)) {
        return createErrorResponse(`commands[${index}].params must be an object`);
      }
    }

    try {
      const tab = await this.resolveTargetTab(args || {});
      if (!tab.id) return createErrorResponse('Active tab has no ID');

      const options = this.normalizeOptions(args || {});
      const results: Array<Record<string, unknown>> = [];
      let stoppedAt: number | undefined;

      await cdpSessionManager.withSession(tab.id, 'cdp-batch', async () => {
        if (args?.bringToFront === true) {
          await cdpSessionManager.sendCommand(tab.id!, 'Page.bringToFront', {});
        }

        for (let index = 0; index < commands.length; index += 1) {
          const command = commands[index];
          const method = normalizeMethod(command.method);
          const result = await this.sendCdpCommand(tab.id!, method, command.params, options);
          results.push({
            index,
            label: typeof command.label === 'string' && command.label ? command.label : undefined,
            ...result,
          });

          if (!result.success && command.continueOnError !== true) {
            stoppedAt = index;
            break;
          }
        }
      });

      const allSucceeded = results.every((result) => result.success === true);
      return this.createJsonSuccess({
        success: allSucceeded,
        tool: this.name,
        tabId: tab.id,
        windowId: tab.windowId,
        requestedCount: commands.length,
        executedCount: results.length,
        stoppedAt,
        sanitizeOutput: options.sanitizeOutput,
        results,
      });
    } catch (error) {
      return createErrorResponse(
        `Error sending CDP batch: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}

export const cdpCommandTool = new CdpCommandTool();
export const cdpBatchTool = new CdpBatchTool();
