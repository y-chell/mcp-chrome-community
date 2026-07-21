#!/usr/bin/env node

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import {
  CallToolRequestSchema,
  CallToolResult,
  ListToolsRequestSchema,
  ListResourcesRequestSchema,
  ListPromptsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { TOOL_SCHEMAS } from 'chrome-mcp-shared';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import * as fs from 'fs';
import * as path from 'path';
import {
  BRIDGE_VERSION,
  CHROME_MCP_HOST_ENV,
  CHROME_MCP_PORT_ENV,
  MCP_HTTP_HOST_ENV,
  MCP_HTTP_PORT_ENV,
  getChromeMcpAuthHeaders,
  getChromeMcpHost,
  getChromeMcpPort,
} from '../constant';
import {
  getExposedToolSchemas,
  handleProfileMetaTool,
  resolveToolProfile,
  type ChromeMcpToolProfile,
} from './tool-profile.js';

let stdioMcpServer: Server | null = null;
let mcpClient: Client | null = null;
const toolProfileResolution = resolveToolProfile();
const toolProfile = toolProfileResolution.profile;
const exposedToolSchemas = getExposedToolSchemas(toolProfile);

type ProxyCallExecution = {
  signal?: AbortSignal;
  onProgress?: (progress: { progress: number; total?: number; message?: string }) => void;
};

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

if (toolProfileResolution.invalidValue) {
  console.error(
    `Invalid CHROME_MCP_TOOL_PROFILE="${toolProfileResolution.invalidValue}"; using "full". Expected full, core, or search.`,
  );
}

// Read configuration from stdio-config.json
const loadConfig = () => {
  try {
    const configPath = path.join(__dirname, 'stdio-config.json');
    const configData = fs.readFileSync(configPath, 'utf8');
    return JSON.parse(configData);
  } catch (error) {
    console.error('Failed to load stdio-config.json:', error);
    throw new Error('Configuration file stdio-config.json not found or invalid');
  }
};

const resolveMcpServerUrl = (): URL => {
  const config = loadConfig();
  const url = new URL(config.url);
  const hasHostOverride =
    typeof process.env[CHROME_MCP_HOST_ENV] === 'string' ||
    typeof process.env[MCP_HTTP_HOST_ENV] === 'string';
  const hasPortOverride =
    typeof process.env[CHROME_MCP_PORT_ENV] === 'string' ||
    typeof process.env[MCP_HTTP_PORT_ENV] === 'string';

  if (hasHostOverride) {
    url.hostname = getChromeMcpHost();
  }
  if (hasPortOverride) {
    url.port = String(getChromeMcpPort());
  }

  return url;
};

export const getStdioMcpServer = () => {
  if (stdioMcpServer) {
    return stdioMcpServer;
  }
  stdioMcpServer = new Server(
    {
      name: 'mcp-chrome-community-stdio-server',
      version: BRIDGE_VERSION,
    },
    {
      capabilities: {
        tools: {},
        resources: {},
        prompts: {},
      },
    },
  );

  setupTools(stdioMcpServer);
  return stdioMcpServer;
};

export const ensureMcpClient = async () => {
  try {
    if (mcpClient) {
      const pingResult = await mcpClient.ping();
      if (pingResult) {
        return mcpClient;
      }
    }

    mcpClient = new Client(
      { name: 'mcp-chrome-community-proxy', version: BRIDGE_VERSION },
      { capabilities: {} },
    );
    const transport = new StreamableHTTPClientTransport(resolveMcpServerUrl(), {
      requestInit: { headers: getChromeMcpAuthHeaders() },
    });
    await mcpClient.connect(transport);
    return mcpClient;
  } catch (error) {
    mcpClient?.close();
    mcpClient = null;
    console.error('Failed to connect to MCP server:', error);
  }
};

export const setupTools = (server: Server) => {
  // List tools handler
  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: exposedToolSchemas }));

  // Call tool handler
  server.setRequestHandler(CallToolRequestSchema, async (request, extra) => {
    const progressToken = extra._meta?.progressToken;
    let lastProgress = 0;
    let notificationQueue = Promise.resolve();
    const onProgress =
      progressToken === undefined
        ? undefined
        : (progress: { progress: number; total?: number; message?: string }) => {
            const total =
              Number.isFinite(progress.total) && progress.total! > 0 ? progress.total! : 100;
            const value = Number.isFinite(progress.progress) ? progress.progress : 0;
            const normalized = Math.max(
              lastProgress,
              Math.max(0, Math.min(100, (value / total) * 100)),
            );
            lastProgress = normalized;
            notificationQueue = notificationQueue
              .then(() =>
                extra.sendNotification({
                  method: 'notifications/progress',
                  params: {
                    progressToken,
                    progress: normalized,
                    total: 100,
                    ...(progress.message ? { message: progress.message } : {}),
                  },
                }),
              )
              .catch(() => undefined);
          };

    const result = await handleToolCall(request.params.name, request.params.arguments || {}, {
      signal: extra.signal,
      onProgress,
    });
    await notificationQueue;
    return result;
  });

  // List resources handler - REQUIRED BY MCP PROTOCOL
  server.setRequestHandler(ListResourcesRequestSchema, async () => ({ resources: [] }));

  // List prompts handler - REQUIRED BY MCP PROTOCOL
  server.setRequestHandler(ListPromptsRequestSchema, async () => ({ prompts: [] }));
};

const handleToolCall = async (
  name: string,
  args: any,
  execution: ProxyCallExecution = {},
): Promise<CallToolResult> => {
  const invokeBrowserTool = (toolName: string, toolArgs: Record<string, unknown>) =>
    callBrowserTool(toolName, toolArgs, execution);
  const metaResult = await handleProfileMetaTool(name, args, toolProfile, invokeBrowserTool);
  if (metaResult) return metaResult;
  return invokeBrowserTool(name, args);
};

const appendStdioProfileMetadata = (
  result: CallToolResult,
  profile: ChromeMcpToolProfile,
): CallToolResult => {
  if (result.isError) return result;
  const basePayload = isPlainObject(result.structuredContent) ? result.structuredContent : null;
  const first = result.content?.[0];
  const firstText =
    first && first.type === 'text' && typeof first.text === 'string' ? first : undefined;
  if (!basePayload && !firstText) return result;

  try {
    const parsed = basePayload ?? (firstText ? JSON.parse(firstText.text) : null);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return result;
    const enriched = {
      ...parsed,
      stdio: {
        profile,
        exposedToolCount: exposedToolSchemas.length,
        catalogToolCount: TOOL_SCHEMAS.length,
      },
    };

    return {
      ...result,
      structuredContent: enriched,
      content: [
        {
          ...(firstText ?? { type: 'text' as const }),
          text: JSON.stringify(enriched),
        },
        ...(result.content || []).slice(1),
      ],
    };
  } catch {
    return result;
  }
};

const callBrowserTool = async (
  name: string,
  args: Record<string, unknown>,
  execution: ProxyCallExecution = {},
): Promise<CallToolResult> => {
  try {
    const client = await ensureMcpClient();
    if (!client) {
      throw new Error('Failed to connect to MCP server');
    }
    // Use a sane default of 2 minutes; the previous value mistakenly used 2*6*1000 (12s)
    const DEFAULT_CALL_TIMEOUT_MS = 2 * 60 * 1000;
    const result = await client.callTool({ name, arguments: args }, undefined, {
      timeout: DEFAULT_CALL_TIMEOUT_MS,
      signal: execution.signal,
      onprogress: execution.onProgress,
      resetTimeoutOnProgress: true,
      maxTotalTimeout: DEFAULT_CALL_TIMEOUT_MS,
    });
    const callResult = result as CallToolResult;
    return name === 'chrome_health'
      ? appendStdioProfileMetadata(callResult, toolProfile)
      : callResult;
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

async function main() {
  const transport = new StdioServerTransport();
  await getStdioMcpServer().connect(transport);
}

main().catch((error) => {
  console.error('Fatal error mcp-chrome-community main():', error);
  process.exit(1);
});
