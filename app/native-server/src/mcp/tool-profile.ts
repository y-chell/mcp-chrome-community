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

const TOOL_SEARCH_ALIASES: Readonly<Record<string, readonly string[]>> = {
  [TOOL_NAMES.BROWSER.GET_WINDOWS_AND_TABS]: ['标签页', '浏览器标签页', '选项卡', '页签', '窗口'],
  [TOOL_NAMES.BROWSER.LIST_FRAMES]: ['框架', '页面框架', 'iframe', '子页面'],
  [TOOL_NAMES.BROWSER.SCAN_COMPACT]: ['页面扫描', '页面概览', '交互元素', '表单控件'],
  [TOOL_NAMES.BROWSER.READ_PAGE]: ['读取页面', '页面内容', '无障碍树', '交互元素'],
  [TOOL_NAMES.BROWSER.NAVIGATE]: ['导航', '打开网页', '刷新页面', '前进后退'],
  [TOOL_NAMES.BROWSER.SCREENSHOT]: ['截图', '网页截图', '屏幕截图', '截屏'],
  [TOOL_NAMES.BROWSER.CLOSE_TABS]: ['关闭标签页', '关闭选项卡'],
  [TOOL_NAMES.BROWSER.SWITCH_TAB]: ['切换标签页', '切换选项卡'],
  [TOOL_NAMES.BROWSER.TAB_GROUP]: ['标签页分组', '选项卡分组', '标签组'],
  [TOOL_NAMES.BROWSER.CLICK]: ['点击', '单击', '双击', '点击元素'],
  [TOOL_NAMES.BROWSER.FILL]: ['表单', '填写表单', '输入框', '选择框', '勾选'],
  [TOOL_NAMES.BROWSER.NETWORK_CAPTURE]: ['抓包', '网络抓包', '网络捕获', '请求响应'],
  [TOOL_NAMES.BROWSER.NETWORK_REQUEST]: ['网络请求', 'HTTP请求', '发送请求', '接口请求'],
  [TOOL_NAMES.BROWSER.KEYBOARD]: ['键盘', '按键', '输入文字', '快捷键'],
  [TOOL_NAMES.BROWSER.JAVASCRIPT]: ['执行脚本', '运行脚本', 'JavaScript'],
  [TOOL_NAMES.BROWSER.CDP_COMMAND]: ['CDP命令', '开发者协议', '调试协议'],
  [TOOL_NAMES.BROWSER.CONSOLE]: ['控制台', '控制台日志', '浏览器日志', '日志'],
  [TOOL_NAMES.BROWSER.FILE_UPLOAD]: ['上传文件', '文件上传'],
  [TOOL_NAMES.BROWSER.CLIPBOARD]: ['剪贴板', '复制粘贴'],
  [TOOL_NAMES.BROWSER.WAIT_FOR_TAB]: ['等待标签页', '等待选项卡'],
  [TOOL_NAMES.BROWSER.WAIT_FOR]: ['等待元素', '等待文本', '等待网络', '等待下载'],
  [TOOL_NAMES.BROWSER.HANDLE_DIALOG]: ['对话框', '弹窗', '确认框'],
  [TOOL_NAMES.BROWSER.HANDLE_DOWNLOAD]: ['下载', '文件下载', '下载监听', '下载处理'],
  [TOOL_NAMES.BROWSER.GIF_RECORDER]: ['录屏', '动图录制', 'GIF录制'],
};

export const META_TOOL_SCHEMAS: Tool[] = [
  {
    name: META_TOOL_NAMES.SEARCH,
    description:
      'Search the complete mcp-chrome tool catalog, including tools hidden by the current profile. Use concise Chinese or English capability keywords such as "抓包", "network capture", "clipboard", or "tab group".',
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
      additionalProperties: false,
    },
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
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
      additionalProperties: false,
    },
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
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
      additionalProperties: false,
    },
    annotations: {
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
      openWorldHint: true,
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
    ...(!isError ? { structuredContent: payload } : {}),
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
  return normalizeSearchText(value).match(/[\p{L}\p{N}]+/gu) || [];
}

function normalizeSearchText(value: string): string {
  return value.normalize('NFKC').toLowerCase();
}

function compactSearchText(value: string): string {
  return tokenize(value).join('');
}

function scoreTool(tool: Tool, query: string, tokens: string[]): number {
  const name = normalizeSearchText(tool.name);
  const description = normalizeSearchText(tool.description || '');
  const aliases = (TOOL_SEARCH_ALIASES[tool.name] || []).map(normalizeSearchText);
  const normalizedQuery = normalizeSearchText(query.trim());
  const compactQuery = compactSearchText(normalizedQuery);
  let score = 0;

  if (normalizedQuery && name.includes(normalizedQuery)) score += 100;
  if (normalizedQuery && description.includes(normalizedQuery)) score += 30;
  if (normalizedQuery && aliases.some((alias) => alias === normalizedQuery)) score += 80;
  else if (normalizedQuery && aliases.some((alias) => alias.includes(normalizedQuery))) score += 40;
  if (
    compactQuery &&
    compactQuery !== normalizedQuery &&
    aliases.some((alias) => compactSearchText(alias).includes(compactQuery))
  ) {
    score += 60;
  }

  const nameParts = new Set(tokenize(name));
  for (const token of tokens) {
    if (nameParts.has(token)) score += 20;
    else if (name.includes(token)) score += 10;
    if (description.includes(token)) score += 3;
    if (aliases.some((alias) => tokenize(alias).includes(token))) score += 12;
    else if (aliases.some((alias) => alias.includes(token))) score += 8;
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
