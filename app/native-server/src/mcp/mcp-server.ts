import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { BRIDGE_VERSION } from '../constant';
import { setupTools } from './register-tools';
import type { ChromeMcpToolProfile } from './tool-profile';

export interface McpServerContext {
  sessionId?: string;
  transport?: 'streamable-http' | 'sse';
  /** Tool profile advertised by tools/list. Defaults to CHROME_MCP_TOOL_PROFILE (or `core`). */
  toolProfile?: ChromeMcpToolProfile;
}

export const createMcpServer = (context: McpServerContext = {}) => {
  const server = new Server(
    {
      name: 'mcp-chrome-community-server',
      version: BRIDGE_VERSION,
    },
    {
      capabilities: {
        tools: {},
      },
    },
  );

  setupTools(server, context);
  return server;
};
