import type { CallToolResult, TextContent, ImageContent } from '@modelcontextprotocol/sdk/types.js';

export interface ToolResult extends CallToolResult {
  content: (TextContent | ImageContent)[];
  isError: boolean;
}

export interface ToolExecutor {
  execute(args: any): Promise<ToolResult>;
}

export const createErrorResponse = (
  message: string = 'Unknown error, please try again',
): ToolResult => {
  return {
    content: [
      {
        type: 'text',
        text: message,
      },
    ],
    isError: true,
  };
};

export function createStructuredToolResult(
  payload: object,
  text = JSON.stringify(payload),
): ToolResult {
  return {
    content: [{ type: 'text', text }],
    structuredContent: payload as Record<string, unknown>,
    isError: false,
  };
}
