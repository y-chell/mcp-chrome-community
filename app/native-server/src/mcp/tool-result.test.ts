import { describe, expect, test } from '@jest/globals';
import { compactStructuredToolResult } from './tool-result';

describe('compactStructuredToolResult', () => {
  test('replaces duplicate JSON text with a concise status and keeps structured data intact', () => {
    const payload = { success: true, message: 'Clicked submit', page: { title: 'Checkout' } };
    const result = compactStructuredToolResult({
      content: [{ type: 'text', text: JSON.stringify(payload) }],
      structuredContent: payload,
    });

    expect(result.structuredContent).toBe(payload);
    expect(result.content).toEqual([
      { type: 'text', text: 'success: Clicked submit. Full data is in structuredContent.' },
    ]);
  });

  test('keeps non-duplicate content blocks after the summary', () => {
    const result = compactStructuredToolResult({
      content: [
        { type: 'text', text: '{"success":true,"count":1}' },
        { type: 'text', text: 'Additional execution note' },
      ],
      structuredContent: { success: true, count: 1 },
    });

    expect(result.content).toEqual([
      { type: 'text', text: 'success. Full data is in structuredContent.' },
      { type: 'text', text: 'Additional execution note' },
    ]);
  });

  test.each([
    ['errors', { isError: true, content: [{ type: 'text', text: '{"error":"failed"}' }] }],
    ['plain text', { content: [{ type: 'text', text: 'completed' }] }],
    ['array text', { content: [{ type: 'text', text: '[1,2]' }] }],
    ['images', { content: [{ type: 'image', data: 'aGVsbG8=', mimeType: 'image/png' }] }],
  ])('leaves %s unchanged', (_label, result) => {
    const withStructuredContent = {
      ...result,
      structuredContent: { success: true },
    } as any;

    expect(compactStructuredToolResult(withStructuredContent)).toEqual(withStructuredContent);
  });
});
