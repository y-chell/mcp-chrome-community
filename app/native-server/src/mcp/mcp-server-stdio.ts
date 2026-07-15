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
  CHROME_MCP_HOST_ENV,
  CHROME_MCP_PORT_ENV,
  MCP_HTTP_HOST_ENV,
  MCP_HTTP_PORT_ENV,
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
      version: '1.0.9',
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
      { name: 'mcp-chrome-community-proxy', version: '1.0.9' },
      { capabilities: {} },
    );
    const transport = new StreamableHTTPClientTransport(resolveMcpServerUrl(), {});
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
  server.setRequestHandler(CallToolRequestSchema, async (request) =>
    handleToolCall(request.params.name, request.params.arguments || {}),
  );

  // List resources handler - REQUIRED BY MCP PROTOCOL
  server.setRequestHandler(ListResourcesRequestSchema, async () => ({ resources: [] }));

  // List prompts handler - REQUIRED BY MCP PROTOCOL
  server.setRequestHandler(ListPromptsRequestSchema, async () => ({ prompts: [] }));
};

const handleToolCall = async (name: string, args: any): Promise<CallToolResult> => {
  const metaResult = await handleProfileMetaTool(name, args, toolProfile, callBrowserTool);
  if (metaResult) return metaResult;
  return callBrowserTool(name, args);
};

const appendStdioProfileMetadata = (
  result: CallToolResult,
  profile: ChromeMcpToolProfile,
): CallToolResult => {
  if (result.isError) return result;
  const first = result.content?.[0];
  if (!first || first.type !== 'text' || typeof first.text !== 'string') return result;

  try {
    const parsed = JSON.parse(first.text);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return result;
    return {
      ...result,
      content: [
        {
          ...first,
          text: JSON.stringify({
            ...parsed,
            stdio: {
              profile,
              exposedToolCount: exposedToolSchemas.length,
              catalogToolCount: TOOL_SCHEMAS.length,
            },
          }),
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
