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
  expect(tool).not.toHaveProperty('outputSchema');
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
