import { describe, expect, test } from '@jest/globals';
import { ToolSchema, type Tool } from '@modelcontextprotocol/sdk/types.js';
import { TOOL_SCHEMAS } from 'chrome-mcp-shared';
import { META_TOOL_SCHEMAS } from './tool-profile';

function expectDeclaredObjectsClosed(value: unknown) {
  if (Array.isArray(value)) {
    value.forEach(expectDeclaredObjectsClosed);
    return;
  }
  if (!value || typeof value !== 'object') return;

  const schema = value as Record<string, unknown>;
  if (schema.type === 'object' && Object.prototype.hasOwnProperty.call(schema, 'properties')) {
    expect(schema.additionalProperties).toBe(false);
  }
  Object.values(schema).forEach(expectDeclaredObjectsClosed);
}

function expectModernToolContract(tool: Tool) {
  expect(ToolSchema.safeParse(tool).success).toBe(true);
  expect(tool.annotations).toEqual({
    readOnlyHint: expect.any(Boolean),
    destructiveHint: expect.any(Boolean),
    idempotentHint: expect.any(Boolean),
    openWorldHint: expect.any(Boolean),
  });
  if (tool.outputSchema) {
    expect(tool.outputSchema.type).toBe('object');
    expect(tool.outputSchema).toHaveProperty('properties');
    expect(tool.outputSchema).toHaveProperty('required');
  }
  expectDeclaredObjectsClosed(tool.inputSchema);
}

describe('modern MCP tool contracts', () => {
  test('keeps the 41 browser tools unique and fully annotated', () => {
    expect(TOOL_SCHEMAS).toHaveLength(41);
    expect(new Set(TOOL_SCHEMAS.map((tool) => tool.name))).toHaveProperty('size', 41);
    TOOL_SCHEMAS.forEach(expectModernToolContract);
  });

  test('applies the same contract rules to profile meta tools', () => {
    expect(META_TOOL_SCHEMAS).toHaveLength(3);
    META_TOOL_SCHEMAS.forEach(expectModernToolContract);
  });

  test('declares output schemas only for stable structured-output tool families', () => {
    const structuredToolNames = TOOL_SCHEMAS.filter((tool) => tool.outputSchema).map(
      (tool) => tool.name,
    );

    expect(structuredToolNames).toEqual([
      'chrome_health',
      'get_windows_and_tabs',
      'chrome_list_frames',
      'chrome_scan_compact',
      'chrome_query_elements',
      'chrome_get_element_html',
      'chrome_clipboard',
      'chrome_wait_for_tab',
      'chrome_wait_for',
      'chrome_assert',
      'chrome_tab_group',
      'chrome_network_request',
      'chrome_history',
      'chrome_javascript',
      'chrome_cdp_command',
      'chrome_cdp_batch',
      'chrome_console',
      'chrome_collect_debug_evidence',
    ]);

    expect(TOOL_SCHEMAS.find((tool) => tool.name === 'chrome_health')?.outputSchema).toMatchObject({
      type: 'object',
      required: expect.arrayContaining(['success', 'schema', 'browser']),
    });
    expect(
      TOOL_SCHEMAS.find((tool) => tool.name === 'get_windows_and_tabs')?.outputSchema,
    ).toMatchObject({
      type: 'object',
      required: ['windowCount', 'tabCount', 'windows'],
    });
    expect(
      TOOL_SCHEMAS.find((tool) => tool.name === 'chrome_wait_for')?.outputSchema,
    ).toMatchObject({
      type: 'object',
      required: ['success'],
    });
    expect(TOOL_SCHEMAS.find((tool) => tool.name === 'chrome_screenshot')).not.toHaveProperty(
      'outputSchema',
    );
  });

  test('does not claim a fixed output schema for the arbitrary meta tool proxy', () => {
    expect(META_TOOL_SCHEMAS.find((tool) => tool.name === 'chrome_search_tools')).toHaveProperty(
      'outputSchema',
    );
    expect(META_TOOL_SCHEMAS.find((tool) => tool.name === 'chrome_describe_tool')).toHaveProperty(
      'outputSchema',
    );
    expect(META_TOOL_SCHEMAS.find((tool) => tool.name === 'chrome_call_tool')).not.toHaveProperty(
      'outputSchema',
    );
  });

  test('leaves intentional free-form maps open', () => {
    const networkRequest = TOOL_SCHEMAS.find((tool) => tool.name === 'chrome_network_request');
    const properties = networkRequest?.inputSchema.properties as Record<
      string,
      Record<string, unknown>
    >;

    expect(properties.headers).toMatchObject({ type: 'object' });
    expect(properties.headers).not.toHaveProperty('properties');
    expect(properties.headers).not.toHaveProperty('additionalProperties', false);
  });
});
