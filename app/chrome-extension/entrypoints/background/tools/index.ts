import { createErrorResponse } from '@/common/tool-handler';
import { ERROR_MESSAGES } from '@/common/constants';
import { TOOL_NAMES } from 'chrome-mcp-shared';
import * as browserTools from './browser';
import { flowRunTool, listPublishedFlowsTool } from './record-replay';
import {
  runBrowserToolCallWithIsolation,
  type BrowserToolCallContext,
} from './browser-session-context';

type ToolExecutor = {
  name: string;
  execute: (args: any) => Promise<any>;
};

function isToolExecutor(value: unknown): value is ToolExecutor {
  return (
    typeof value === 'object' &&
    value !== null &&
    'name' in value &&
    'execute' in value &&
    typeof (value as ToolExecutor).name === 'string' &&
    typeof (value as ToolExecutor).execute === 'function'
  );
}

const eagerTools = [...Object.values(browserTools), flowRunTool, listPublishedFlowsTool].filter(
  isToolExecutor,
);

const toolsMap = new Map(eagerTools.map((tool) => [tool.name, tool] as const));

const lazyToolLoaders = new Map<string, () => Promise<ToolExecutor>>([
  [TOOL_NAMES.BROWSER.SEARCH_TABS_CONTENT, browserTools.loadSearchTabsContentTool],
]);

async function resolveTool(name: string): Promise<ToolExecutor | undefined> {
  const eagerTool = toolsMap.get(name);
  if (eagerTool) return eagerTool;

  const loader = lazyToolLoaders.get(name);
  if (!loader) return undefined;

  const loadedTool = await loader();
  toolsMap.set(loadedTool.name, loadedTool);
  return loadedTool;
}

/**
 * Tool call parameter interface
 */
export interface ToolCallParam {
  name: string;
  args: any;
  context?: BrowserToolCallContext;
}

/**
 * Handle tool execution
 */
export const handleCallTool = async (param: ToolCallParam) => {
  const tool = await resolveTool(param.name);
  if (!tool) {
    return createErrorResponse(`Tool ${param.name} not found`);
  }

  try {
    return await runBrowserToolCallWithIsolation(param.name, param.args, param.context, (args) =>
      tool.execute(args),
    );
  } catch (error) {
    console.error(`Tool execution failed for ${param.name}:`, error);
    return createErrorResponse(
      error instanceof Error ? error.message : ERROR_MESSAGES.TOOL_EXECUTION_FAILED,
    );
  }
};
