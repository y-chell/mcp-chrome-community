import { describe, expect, jest, test } from '@jest/globals';
import { TOOL_NAMES, TOOL_SCHEMAS } from 'chrome-mcp-shared';
import {
  getExposedToolSchemas,
  handleProfileMetaTool,
  META_TOOL_NAMES,
  resolveToolProfile,
  searchBrowserTools,
} from './tool-profile';

describe('tool profiles', () => {
  test('keeps the full catalog as the backward-compatible default', () => {
    expect(resolveToolProfile(undefined)).toEqual({ profile: 'full' });
    expect(getExposedToolSchemas('full')).toEqual(TOOL_SCHEMAS);
  });

  test('normalizes supported values and falls back on invalid values', () => {
    expect(resolveToolProfile(' CORE ')).toEqual({ profile: 'core' });
    expect(resolveToolProfile('search')).toEqual({ profile: 'search' });
    expect(resolveToolProfile('compact')).toEqual({
      profile: 'full',
      invalidValue: 'compact',
    });
  });

  test('core exposes common browser tools and the meta tools', () => {
    const names = getExposedToolSchemas('core').map((tool) => tool.name);

    expect(names).toHaveLength(15);
    expect(names).toEqual(
      expect.arrayContaining([
        META_TOOL_NAMES.SEARCH,
        META_TOOL_NAMES.DESCRIBE,
        META_TOOL_NAMES.CALL,
        TOOL_NAMES.BROWSER.HEALTH,
        TOOL_NAMES.BROWSER.READ_PAGE,
        TOOL_NAMES.BROWSER.NAVIGATE,
        TOOL_NAMES.BROWSER.JAVASCRIPT,
      ]),
    );
    expect(names).not.toContain(TOOL_NAMES.BROWSER.GIF_RECORDER);
  });

  test('search exposes only discovery, health, and tab listing', () => {
    const names = getExposedToolSchemas('search').map((tool) => tool.name);

    expect(names).toEqual([
      META_TOOL_NAMES.SEARCH,
      META_TOOL_NAMES.DESCRIBE,
      META_TOOL_NAMES.CALL,
      TOOL_NAMES.BROWSER.HEALTH,
      TOOL_NAMES.BROWSER.GET_WINDOWS_AND_TABS,
    ]);
  });
});

describe('tool catalog search', () => {
  test('ranks tool-name matches and reports whether a result is exposed', () => {
    const results = searchBrowserTools('gif recorder', 5, 'core');

    expect(results[0]).toMatchObject({
      name: TOOL_NAMES.BROWSER.GIF_RECORDER,
      exposed: false,
    });
    expect(results[0]?.parameterNames.length).toBeGreaterThan(0);
  });

  test('keeps English capability search behavior', () => {
    expect(searchBrowserTools('network request', 5, 'core')[0]?.name).toBe(
      TOOL_NAMES.BROWSER.NETWORK_REQUEST,
    );
    expect(searchBrowserTools('screenshot', 5, 'core')[0]?.name).toBe(
      TOOL_NAMES.BROWSER.SCREENSHOT,
    );
  });

  test.each([
    ['抓包', TOOL_NAMES.BROWSER.NETWORK_CAPTURE],
    ['网络请求', TOOL_NAMES.BROWSER.NETWORK_REQUEST],
    ['标签页', TOOL_NAMES.BROWSER.GET_WINDOWS_AND_TABS],
    ['截图', TOOL_NAMES.BROWSER.SCREENSHOT],
    ['下载', TOOL_NAMES.BROWSER.HANDLE_DOWNLOAD],
    ['控制台', TOOL_NAMES.BROWSER.CONSOLE],
    ['表单', TOOL_NAMES.BROWSER.FILL],
  ])('finds the expected tool for compact Chinese query %s', (query, expectedName) => {
    expect(searchBrowserTools(query, 5, 'core')[0]?.name).toBe(expectedName);
  });

  test.each([
    ['网络 请求', TOOL_NAMES.BROWSER.NETWORK_REQUEST],
    ['填写 表单', TOOL_NAMES.BROWSER.FILL],
    ['浏览器 标签页', TOOL_NAMES.BROWSER.GET_WINDOWS_AND_TABS],
  ])('finds the expected tool for spaced Chinese query %s', (query, expectedName) => {
    expect(searchBrowserTools(query, 5, 'search')[0]?.name).toBe(expectedName);
  });

  test('normalizes full-width Unicode text and preserves the requested result limit', () => {
    const results = searchBrowserTools('ＨＴＴＰ 请求', 1, 'core');

    expect(results).toHaveLength(1);
    expect(results[0]?.name).toBe(TOOL_NAMES.BROWSER.NETWORK_REQUEST);
  });
});

describe('profile meta tools', () => {
  test('describes hidden tools without calling the browser', async () => {
    const invoke = jest.fn(async () => ({ content: [] }));
    const result = await handleProfileMetaTool(
      META_TOOL_NAMES.DESCRIBE,
      { name: TOOL_NAMES.BROWSER.GIF_RECORDER },
      'core',
      invoke,
    );
    const payload = JSON.parse((result?.content[0] as { text: string }).text);

    expect(payload).toMatchObject({
      success: true,
      profile: 'core',
      exposed: false,
      tool: { name: TOOL_NAMES.BROWSER.GIF_RECORDER },
    });
    expect(result?.structuredContent).toEqual(payload);
    expect(invoke).not.toHaveBeenCalled();
  });

  test('proxies a known hidden tool with its arguments', async () => {
    const expected = { content: [{ type: 'text' as const, text: '{"success":true}' }] };
    const invoke = jest.fn(async () => expected);
    const result = await handleProfileMetaTool(
      META_TOOL_NAMES.CALL,
      { name: TOOL_NAMES.BROWSER.GIF_RECORDER, args: { action: 'status' } },
      'core',
      invoke,
    );

    expect(invoke).toHaveBeenCalledWith(TOOL_NAMES.BROWSER.GIF_RECORDER, {
      action: 'status',
    });
    expect(result).toBe(expected);
  });

  test('rejects unknown tools before proxying', async () => {
    const invoke = jest.fn(async () => ({ content: [] }));
    const result = await handleProfileMetaTool(
      META_TOOL_NAMES.CALL,
      { name: 'chrome_missing_tool' },
      'search',
      invoke,
    );
    const payload = JSON.parse((result?.content[0] as { text: string }).text);

    expect(result?.isError).toBe(true);
    expect(payload.error).toContain('Unknown browser tool');
    expect(invoke).not.toHaveBeenCalled();
  });

  test('returns null for ordinary browser tools', async () => {
    const invoke = jest.fn(async () => ({ content: [] }));
    await expect(
      handleProfileMetaTool(TOOL_NAMES.BROWSER.HEALTH, {}, 'core', invoke),
    ).resolves.toBeNull();
  });
});
