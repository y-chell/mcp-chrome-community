import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { BRIDGE_VERSION } from '../constant';
import { setupTools } from './register-tools';

export interface McpServerContext {
  sessionId?: string;
  transport?: 'streamable-http' | 'sse';
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
