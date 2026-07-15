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
