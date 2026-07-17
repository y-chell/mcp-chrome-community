import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import {
  CallToolRequestSchema,
  CallToolResult,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import nativeMessagingHostInstance, {
  type ExtensionRequestOptions,
  type NativeToolProgress,
} from '../native-messaging-host';
import { BRIDGE_VERSION } from '../constant';
import { NativeMessageType, TOOL_SCHEMAS } from 'chrome-mcp-shared';
import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import type { McpServerContext } from './mcp-server';

const HEALTH_TOOL_NAME = 'chrome_health';

type ToolCallContext = McpServerContext & {
  requestId?: string;
};

type ToolCallExecution = ExtensionRequestOptions & {
  reportProgress?: (progress: NativeToolProgress) => Promise<void>;
};

type DynamicFlowDirectoryEntry = {
  flowId: unknown;
  tool: Tool;
};

type DynamicFlowRefreshResult =
  | { success: true }
  | { success: false; error: unknown; invalidResponse: boolean };

class InvalidDynamicFlowDirectoryResponseError extends Error {}

async function fetchDynamicFlowDirectory(): Promise<DynamicFlowDirectoryEntry[]> {
  const response = await nativeMessagingHostInstance.sendRequestToExtensionAndWait(
    {},
    'rr_list_published_flows',
    20000,
  );
  if (!response || response.status !== 'success' || !Array.isArray(response.items)) {
    throw new InvalidDynamicFlowDirectoryResponseError('Failed to list published flows');
  }

  const entries: DynamicFlowDirectoryEntry[] = [];
  const seenToolNames = new Set<string>();
  for (const item of response.items) {
    if (!item || typeof item !== 'object') continue;

    const flow = item as Record<string, any>;
    if (typeof flow.slug !== 'string' || !flow.slug.trim() || flow.id == null) continue;

    const name = `flow.${flow.slug}`;
    if (seenToolNames.has(name)) continue;
    seenToolNames.add(name);

    const description =
      (flow.meta && flow.meta.tool && flow.meta.tool.description) ||
      flow.description ||
      'Recorded flow';
    const properties: Record<string, any> = {};
    const required: string[] = [];
    const variables = Array.isArray(flow.variables) ? flow.variables : [];
    for (const v of variables) {
      if (!v || typeof v !== 'object' || typeof v.key !== 'string' || !v.key) continue;

      const desc = v.label || v.key;
      const typ = (v.type || 'string').toLowerCase();
      const prop: any = { description: desc };
      if (typ === 'boolean') prop.type = 'boolean';
      else if (typ === 'number') prop.type = 'number';
      else if (typ === 'enum') {
        prop.type = 'string';
        if (v.rules && Array.isArray(v.rules.enum)) prop.enum = v.rules.enum;
      } else if (typ === 'array') {
        // Default to string items until recorded flows expose an item type.
        prop.type = 'array';
        prop.items = { type: 'string' };
      } else {
        prop.type = 'string';
      }
      if (v.default !== undefined) prop.default = v.default;
      if (v.rules && v.rules.required) required.push(v.key);
      properties[v.key] = prop;
    }
    properties['tabTarget'] = { type: 'string', enum: ['current', 'new'], default: 'current' };
    properties['refresh'] = { type: 'boolean', default: false };
    properties['captureNetwork'] = { type: 'boolean', default: false };
    properties['returnLogs'] = { type: 'boolean', default: false };
    properties['timeoutMs'] = { type: 'number', minimum: 0 };
    entries.push({
      flowId: flow.id,
      tool: {
        name,
        description,
        inputSchema: { type: 'object', properties, required, additionalProperties: false },
        annotations: {
          readOnlyHint: false,
          destructiveHint: true,
          idempotentHint: false,
          openWorldHint: true,
        },
      },
    });
  }
  return entries;
}

function directorySignature(entries: DynamicFlowDirectoryEntry[]) {
  return JSON.stringify(entries.map(({ flowId, tool }) => ({ flowId, tool })));
}

function createDynamicFlowDirectory(server: Server) {
  let entries: DynamicFlowDirectoryEntry[] = [];
  let entriesByName = new Map<string, DynamicFlowDirectoryEntry>();
  let signature = directorySignature(entries);
  let refreshPromise: Promise<DynamicFlowRefreshResult> | undefined;

  const refresh = (): Promise<DynamicFlowRefreshResult> => {
    if (refreshPromise) return refreshPromise;

    const currentRefresh = (async (): Promise<DynamicFlowRefreshResult> => {
      try {
        const nextEntries = await fetchDynamicFlowDirectory();
        const nextSignature = directorySignature(nextEntries);
        const changed = nextSignature !== signature;

        entries = nextEntries;
        entriesByName = new Map(nextEntries.map((entry) => [entry.tool.name, entry]));
        signature = nextSignature;

        if (changed) {
          try {
            await server.sendToolListChanged();
          } catch {
            // The cache remains valid if the client disconnects before the notification is sent.
          }
        }
        return { success: true };
      } catch (error) {
        return {
          success: false,
          error,
          invalidResponse: error instanceof InvalidDynamicFlowDirectoryResponseError,
        };
      }
    })().finally(() => {
      refreshPromise = undefined;
    });
    refreshPromise = currentRefresh;

    return currentRefresh;
  };

  return {
    listTools() {
      return entries.map((entry) => entry.tool);
    },
    refresh,
    async resolve(toolName: string) {
      const cached = entriesByName.get(toolName);
      if (cached) return cached;

      const refreshResult = await refresh();
      if (!refreshResult.success && !refreshResult.invalidResponse) {
        throw refreshResult.error;
      }
      return entriesByName.get(toolName);
    },
  };
}

function buildToolCallContext(
  baseContext: McpServerContext,
  extra: { sessionId?: string; requestId?: string | number },
): ToolCallContext {
  return {
    ...baseContext,
    sessionId: extra.sessionId || baseContext.sessionId,
    requestId:
      typeof extra.requestId === 'string' || typeof extra.requestId === 'number'
        ? String(extra.requestId)
        : undefined,
  };
}

function normalizeProgress(progress: NativeToolProgress): NativeToolProgress {
  const total = Number.isFinite(progress.total) && progress.total! > 0 ? progress.total! : 100;
  const value = Number.isFinite(progress.progress) ? progress.progress : 0;
  return {
    progress: Math.max(0, Math.min(100, (value / total) * 100)),
    total: 100,
    message: progress.message,
  };
}

function createProgressReporter(extra: {
  _meta?: { progressToken?: string | number };
  sendNotification?: (notification: any) => Promise<void>;
}): ToolCallExecution['reportProgress'] {
  const progressToken = extra._meta?.progressToken;
  if (progressToken === undefined || !extra.sendNotification) return undefined;

  let lastProgress = 0;
  let notificationQueue = Promise.resolve();
  return (progress) => {
    const normalized = normalizeProgress(progress);
    normalized.progress = Math.max(lastProgress, normalized.progress);
    lastProgress = normalized.progress;

    notificationQueue = notificationQueue
      .then(() =>
        extra.sendNotification!({
          method: 'notifications/progress',
          params: {
            progressToken,
            progress: normalized.progress,
            total: 100,
            ...(normalized.message ? { message: normalized.message } : {}),
          },
        }),
      )
      .catch(() => undefined);
    return notificationQueue;
  };
}

function throwIfAborted(signal?: AbortSignal): void {
  if (!signal?.aborted) return;
  const error = new Error('Request cancelled');
  error.name = 'AbortError';
  throw error;
}

async function waitWithSignal<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return promise;
  throwIfAborted(signal);

  return new Promise<T>((resolve, reject) => {
    const onAbort = () => {
      const error = new Error('Request cancelled');
      error.name = 'AbortError';
      reject(error);
    };
    signal.addEventListener('abort', onAbort, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener('abort', onAbort);
        resolve(value);
      },
      (error) => {
        signal.removeEventListener('abort', onAbort);
        reject(error);
      },
    );
  });
}

function appendNativeHealthMetadata(result: CallToolResult, context: ToolCallContext) {
  if (result.isError) return result;
  const first = result.content?.[0];
  if (!first || first.type !== 'text' || typeof first.text !== 'string') return result;

  try {
    const parsed = JSON.parse(first.text);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return result;

    const enriched = {
      ...parsed,
      bridge: {
        name: 'mcp-chrome-community-bridge',
        version: BRIDGE_VERSION,
        transport: context.transport,
        sessionId: context.sessionId,
        requestId: context.requestId,
      },
    };

    return {
      ...result,
      structuredContent: enriched,
      content: [
        {
          ...first,
          text: JSON.stringify(enriched),
        },
        ...(result.content || []).slice(1),
      ],
    };
  } catch {
    return result;
  }
}

function appendStructuredContent(result: CallToolResult): CallToolResult {
  if (result.isError || result.structuredContent !== undefined) return result;
  const first = result.content?.[0];
  if (!first || first.type !== 'text' || typeof first.text !== 'string') return result;

  try {
    const parsed = JSON.parse(first.text);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return result;
    return { ...result, structuredContent: parsed };
  } catch {
    return result;
  }
}

export const setupTools = (server: Server, context: McpServerContext = {}) => {
  server.registerCapabilities({ tools: { listChanged: true } });
  const dynamicFlowDirectory = createDynamicFlowDirectory(server);

  server.setRequestHandler(ListToolsRequestSchema, async () => {
    void dynamicFlowDirectory.refresh();
    return { tools: [...TOOL_SCHEMAS, ...dynamicFlowDirectory.listTools()] };
  });

  server.setRequestHandler(CallToolRequestSchema, async (request, extra) => {
    const reportProgress = createProgressReporter(extra);
    const execution: ToolCallExecution = {
      signal: extra.signal,
      reportProgress,
      onProgress: reportProgress,
    };

    await reportProgress?.({ progress: 0, total: 100, message: 'Dispatching browser tool' });
    const result = await handleToolCall(
      request.params.name,
      request.params.arguments || {},
      buildToolCallContext(context, extra),
      dynamicFlowDirectory.resolve,
      execution,
    );
    if (!result.isError) {
      await reportProgress?.({ progress: 100, total: 100, message: 'Browser tool completed' });
    }
    return result;
  });
};

const handleToolCall = async (
  name: string,
  args: any,
  context: ToolCallContext,
  resolveDynamicFlow: (toolName: string) => Promise<DynamicFlowDirectoryEntry | undefined>,
  execution: ToolCallExecution,
): Promise<CallToolResult> => {
  try {
    throwIfAborted(execution.signal);
    if (name && name.startsWith('flow.')) {
      try {
        const match = await waitWithSignal(resolveDynamicFlow(name), execution.signal);
        if (!match) throw new Error(`Flow not found for tool ${name}`);
        const flowArgs = { flowId: match.flowId, args };
        const proxyRes = await nativeMessagingHostInstance.sendRequestToExtensionAndWait(
          { name: 'record_replay_flow_run', args: flowArgs, context },
          NativeMessageType.CALL_TOOL,
          120000,
          execution,
        );
        if (proxyRes.status === 'success') return appendStructuredContent(proxyRes.data);
        return {
          content: [{ type: 'text', text: `Error calling dynamic flow tool: ${proxyRes.error}` }],
          isError: true,
        };
      } catch (err: any) {
        return {
          content: [
            {
              type: 'text',
              text: `Error resolving dynamic flow tool: ${err?.message || String(err)}`,
            },
          ],
          isError: true,
        };
      }
    }
    const response = await nativeMessagingHostInstance.sendRequestToExtensionAndWait(
      {
        name,
        args,
        context,
      },
      NativeMessageType.CALL_TOOL,
      120000, // 延长到 120 秒，避免性能分析等长任务超时
      execution,
    );
    if (response.status === 'success') {
      let result = response.data;
      if (name === HEALTH_TOOL_NAME) {
        result = appendNativeHealthMetadata(result, context);
      }
      return appendStructuredContent(result);
    } else {
      return {
        content: [
          {
            type: 'text',
            text: `Error calling tool: ${response.error}`,
          },
        ],
        isError: true,
      };
    }
  } catch (error: any) {
    return {
      content: [
        {
          type: 'text',
          text: `Error calling tool: ${error.message}`,
        },
      ],
      isError: true,
    };
  }
};
