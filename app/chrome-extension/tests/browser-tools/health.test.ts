import { beforeEach, describe, expect, it, vi } from 'vitest';

import { healthTool } from '@/entrypoints/background/tools/browser/health';

function parseJsonResult(result: { content?: Array<{ type: string; text?: string }> }) {
  const text = result.content?.[0]?.text;
  return JSON.parse(String(text || '{}'));
}

describe('health tool', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.clearAllMocks();

    (chrome.runtime as any).id = 'test-extension-id';
    (chrome.runtime as any).getManifest = vi.fn().mockReturnValue({
      name: 'mcp-chrome-community',
      version: '1.0.8',
      manifest_version: 3,
    });
    (chrome as any).windows = {
      getAll: vi.fn().mockResolvedValue([
        {
          id: 1,
          tabs: [
            {
              id: 7,
              windowId: 1,
              active: true,
              url: 'https://example.com/',
              title: 'Example',
            },
            {
              id: 8,
              windowId: 1,
              active: false,
              url: 'https://example.com/docs',
              title: 'Docs',
            },
          ],
        },
      ]),
    };
    (chrome.storage.local.get as any) = vi.fn().mockResolvedValue({
      serverStatus: { isRunning: true, port: 12306, lastUpdated: 100 },
      nativeAutoConnectEnabled: true,
    });
  });

  it('returns extension, schema, browser, and native-host status metadata', async () => {
    const result = await healthTool.execute();

    expect(result.isError).toBe(false);
    const parsed = parseJsonResult(result);

    expect(parsed).toMatchObject({
      success: true,
      tool: 'chrome_health',
      extension: {
        id: 'test-extension-id',
        name: 'mcp-chrome-community',
        version: '1.0.8',
        manifestVersion: 3,
      },
      browser: {
        windowCount: 1,
        tabCount: 2,
        activeTab: {
          tabId: 7,
          windowId: 1,
          url: 'https://example.com/',
        },
      },
      nativeHost: {
        serverStatus: { isRunning: true, port: 12306, lastUpdated: 100 },
        autoConnectEnabled: true,
      },
    });
    expect(parsed.schema.toolNames).toContain('chrome_health');
    expect(parsed.schema.toolCount).toBeGreaterThan(0);
    expect(parsed.schema.schemaHash).toMatch(/^[0-9a-f]{8}$/);
  });
});
