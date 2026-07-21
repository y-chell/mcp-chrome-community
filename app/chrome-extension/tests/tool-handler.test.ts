import { describe, expect, it } from 'vitest';

import { createStructuredToolResult } from '@/common/tool-handler';

describe('createStructuredToolResult', () => {
  it('keeps legacy text content and structured content aligned', () => {
    const payload = { success: true, count: 2 };
    const result = createStructuredToolResult(payload);

    expect(result).toEqual({
      content: [{ type: 'text', text: JSON.stringify(payload) }],
      structuredContent: payload,
      isError: false,
    });
  });

  it('allows tools to preserve a formatted legacy text representation', () => {
    const payload = { items: [], totalCount: 0 };
    const formatted = JSON.stringify(payload, null, 2);
    const result = createStructuredToolResult(payload, formatted);

    expect(result.content).toEqual([{ type: 'text', text: formatted }]);
    expect(result.structuredContent).toBe(payload);
  });
});
