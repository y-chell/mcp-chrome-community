import { STORAGE_KEYS } from '@/common/constants';
import { type ToolResult } from '@/common/tool-handler';
import { BaseBrowserToolExecutor } from '../base-browser';
import { TOOL_SCHEMAS } from 'chrome-mcp-shared';

const HEALTH_TOOL_NAME = 'chrome_health';
const HEALTH_TOOL_SCHEMA = {
  name: HEALTH_TOOL_NAME,
  description:
    'Return extension/bridge health metadata, schema hash, tool count, extension ID, and current browser tab/window counts. Use this after upgrades to confirm the client is not using a stale tool list.',
  inputSchema: {
    type: 'object',
    properties: {},
    required: [],
  },
};

function jsonSuccess(payload: Record<string, unknown>): ToolResult {
  return {
    content: [{ type: 'text', text: JSON.stringify(payload) }],
    isError: false,
  };
}

function hashString(input: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

function buildSchemaSnapshot() {
  const schemaItems = TOOL_SCHEMAS.some((tool) => tool.name === HEALTH_TOOL_NAME)
    ? TOOL_SCHEMAS
    : [...TOOL_SCHEMAS, HEALTH_TOOL_SCHEMA];
  const toolNames = schemaItems.map((tool) => tool.name).sort();
  const schemaHash = hashString(
    JSON.stringify(
      schemaItems
        .map((tool) => ({
          name: tool.name,
          description: tool.description,
          inputSchema: tool.inputSchema,
        }))
        .sort((a, b) => a.name.localeCompare(b.name)),
    ),
  );

  return {
    toolCount: toolNames.length,
    toolNames,
    schemaHash,
  };
}

class HealthTool extends BaseBrowserToolExecutor {
  name = HEALTH_TOOL_NAME;

  async execute(): Promise<ToolResult> {
    const manifest = chrome.runtime.getManifest();
    const windows = await chrome.windows.getAll({ populate: true }).catch(() => []);
    const tabs = windows.flatMap((window) => window.tabs || []);
    const activeTab = tabs.find((tab) => tab.active);
    const storage = await chrome.storage.local
      .get([STORAGE_KEYS.SERVER_STATUS, STORAGE_KEYS.NATIVE_AUTO_CONNECT_ENABLED])
      .catch(() => ({}));

    return jsonSuccess({
      success: true,
      tool: this.name,
      checkedAt: Date.now(),
      extension: {
        id: chrome.runtime.id,
        name: manifest.name,
        version: manifest.version,
        manifestVersion: manifest.manifest_version,
      },
      schema: buildSchemaSnapshot(),
      browser: {
        windowCount: windows.length,
        tabCount: tabs.length,
        activeTab: activeTab
          ? {
              tabId: activeTab.id,
              windowId: activeTab.windowId,
              url: activeTab.url || '',
              title: activeTab.title || '',
            }
          : null,
      },
      nativeHost: {
        serverStatus: storage[STORAGE_KEYS.SERVER_STATUS] || null,
        autoConnectEnabled: storage[STORAGE_KEYS.NATIVE_AUTO_CONNECT_ENABLED],
      },
    });
  }
}

export const healthTool = new HealthTool();
