import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { setupTools } from './register-tools';

export const createMcpServer = () => {
  const server = new Server(
    {
      name: 'mcp-chrome-community-server',
      version: '1.0.2',
    },
    {
      capabilities: {
        tools: {},
      },
    },
  );

  setupTools(server);
  return server;
};
