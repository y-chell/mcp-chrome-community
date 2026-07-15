import type { CallToolResult, Tool } from '@modelcontextprotocol/sdk/types.js';
import { TOOL_NAMES, TOOL_SCHEMAS } from 'chrome-mcp-shared';

export const CHROME_MCP_TOOL_PROFILE_ENV = 'CHROME_MCP_TOOL_PROFILE';

export type ChromeMcpToolProfile = 'full' | 'core' | 'search';
export type BrowserToolInvoker = (
  name: string,
  args: Record<string, unknown>,
) => Promise<CallToolResult>;

export const META_TOOL_NAMES = {
  SEARCH: 'chrome_search_tools',
  DESCRIBE: 'chrome_describe_tool',
  CALL: 'chrome_call_tool',
} as const;

const CORE_TOOL_NAMES = new Set<string>([
  TOOL_NAMES.BROWSER.HEALTH,
  TOOL_NAMES.BROWSER.GET_WINDOWS_AND_TABS,
  TOOL_NAMES.BROWSER.SCAN_COMPACT,
  TOOL_NAMES.BROWSER.READ_PAGE,
  TOOL_NAMES.BROWSER.NAVIGATE,
  TOOL_NAMES.BROWSER.CLICK,
  TOOL_NAMES.BROWSER.FILL,
  TOOL_NAMES.BROWSER.KEYBOARD,
  TOOL_NAMES.BROWSER.WAIT_FOR,
  TOOL_NAMES.BROWSER.JAVASCRIPT,
  TOOL_NAMES.BROWSER.NETWORK_REQUEST,
  TOOL_NAMES.BROWSER.SCREENSHOT,
]);

const SEARCH_TOOL_NAMES = new Set<string>([
  TOOL_NAMES.BROWSER.HEALTH,
  TOOL_NAMES.BROWSER.GET_WINDOWS_AND_TABS,
]);

const TOOL_BY_NAME = new Map(TOOL_SCHEMAS.map((tool) => [tool.name, tool]));
const META_TOOL_NAME_SET = new Set<string>(Object.values(META_TOOL_NAMES));

export const META_TOOL_SCHEMAS: Tool[] = [
  {
    name: META_TOOL_NAMES.SEARCH,
    description:
      'Search the complete mcp-chrome tool catalog, including tools hidden by the current profile. Use concise English capability keywords such as "network capture", "clipboard", or "tab group".',
    inputSchema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Capability or tool-name keywords to search for.',
        },
        limit: {
          type: 'number',
          description: 'Maximum results to return (default 8, maximum 20).',
          minimum: 1,
          maximum: 20,
        },
      },
      required: ['query'],
    },
  },
  {
    name: META_TOOL_NAMES.DESCRIBE,
    description:
      'Return the full description and input schema for one known mcp-chrome tool, including tools hidden by the current profile.',
    inputSchema: {
      type: 'object',
      properties: {
        name: {
          type: 'string',
          description: 'Exact tool name returned by chrome_search_tools.',
        },
      },
      required: ['name'],
    },
  },
  {
    name: META_TOOL_NAMES.CALL,
    description:
      'Invoke one known mcp-chrome browser tool by exact name. Use this for tools hidden by the current core or search profile.',
    inputSchema: {
      type: 'object',
      properties: {
        name: {
          type: 'string',
          description: 'Exact browser tool name.',
        },
        args: {
          type: 'object',
          description: 'Arguments passed to the browser tool.',
          additionalProperties: true,
        },
      },
      required: ['name'],
    },
  },
];

export type ToolProfileResolution = {
  profile: ChromeMcpToolProfile;
  invalidValue?: string;
};

export function resolveToolProfile(
  value = process.env[CHROME_MCP_TOOL_PROFILE_ENV],
): ToolProfileResolution {
  const normalized = value?.trim().toLowerCase();
  if (!normalized) return { profile: 'full' };
  if (normalized === 'full' || normalized === 'core' || normalized === 'search') {
    return { profile: normalized };
  }
  return { profile: 'full', invalidValue: value };
}

export function getExposedToolSchemas(profile: ChromeMcpToolProfile): Tool[] {
  if (profile === 'full') return [...TOOL_SCHEMAS];

  const exposedNames = profile === 'core' ? CORE_TOOL_NAMES : SEARCH_TOOL_NAMES;
  const browserTools = TOOL_SCHEMAS.filter((tool) => exposedNames.has(tool.name));
  return [...META_TOOL_SCHEMAS, ...browserTools];
}

export function getKnownBrowserTool(name: string): Tool | undefined {
  return TOOL_BY_NAME.get(name);
}

function jsonResult(payload: Record<string, unknown>, isError = false): CallToolResult {
  return {
    content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }],
    ...(isError ? { isError: true } : {}),
  };
}

function getInputSummary(tool: Tool) {
  const schema = tool.inputSchema as {
    properties?: Record<string, unknown>;
    required?: string[];
  };
  return {
    parameterNames: Object.keys(schema.properties || {}),
    required: Array.isArray(schema.required) ? schema.required : [],
  };
}

function tokenize(value: string): string[] {
  return value.toLowerCase().match(/[a-z0-9]+/g) || [];
}

function scoreTool(tool: Tool, query: string, tokens: string[]): number {
  const name = tool.name.toLowerCase();
  const description = (tool.description || '').toLowerCase();
  const normalizedQuery = query.trim().toLowerCase();
  let score = 0;

  if (normalizedQuery && name.includes(normalizedQuery)) score += 100;
  if (normalizedQuery && description.includes(normalizedQuery)) score += 30;

  const nameParts = new Set(tokenize(name));
  for (const token of tokens) {
    if (nameParts.has(token)) score += 20;
    else if (name.includes(token)) score += 10;
    if (description.includes(token)) score += 3;
  }

  return score;
}

export function searchBrowserTools(query: string, limit: number, profile: ChromeMcpToolProfile) {
  const tokens = tokenize(query);
  const exposedNames = new Set(getExposedToolSchemas(profile).map((tool) => tool.name));

  return TOOL_SCHEMAS.map((tool) => ({ tool, score: scoreTool(tool, query, tokens) }))
    .filter((item) => item.score > 0)
    .sort(
      (left, right) => right.score - left.score || left.tool.name.localeCompare(right.tool.name),
    )
    .slice(0, limit)
    .map(({ tool, score }) => ({
      name: tool.name,
      description: tool.description,
      score,
      exposed: exposedNames.has(tool.name),
      ...getInputSummary(tool),
    }));
}

export async function handleProfileMetaTool(
  name: string,
  args: Record<string, unknown>,
  profile: ChromeMcpToolProfile,
  invokeBrowserTool: BrowserToolInvoker,
): Promise<CallToolResult | null> {
  if (!META_TOOL_NAME_SET.has(name)) return null;

  if (name === META_TOOL_NAMES.SEARCH) {
    const query = typeof args.query === 'string' ? args.query.trim() : '';
    if (!query)
      return jsonResult({ success: false, error: 'query must be a non-empty string' }, true);

    const requestedLimit = typeof args.limit === 'number' ? Math.trunc(args.limit) : 8;
    const limit = Math.min(20, Math.max(1, requestedLimit));
    const results = searchBrowserTools(query, limit, profile);
    return jsonResult({
      success: true,
      profile,
      query,
      totalKnownTools: TOOL_SCHEMAS.length,
      resultCount: results.length,
      results,
      hint: 'Call exposed tools directly. For hidden tools, inspect the schema with chrome_describe_tool, then invoke them with chrome_call_tool.',
    });
  }

  const targetName = typeof args.name === 'string' ? args.name.trim() : '';
  if (!targetName) {
    return jsonResult({ success: false, error: 'name must be a non-empty string' }, true);
  }

  const tool = getKnownBrowserTool(targetName);
  if (!tool) {
    return jsonResult({ success: false, error: `Unknown browser tool: ${targetName}` }, true);
  }

  if (name === META_TOOL_NAMES.DESCRIBE) {
    return jsonResult({
      success: true,
      profile,
      exposed: getExposedToolSchemas(profile).some((item) => item.name === targetName),
      tool,
    });
  }

  const toolArgs = args.args === undefined ? {} : args.args;
  if (!toolArgs || typeof toolArgs !== 'object' || Array.isArray(toolArgs)) {
    return jsonResult({ success: false, error: 'args must be an object when provided' }, true);
  }

  return invokeBrowserTool(targetName, toolArgs as Record<string, unknown>);
}
