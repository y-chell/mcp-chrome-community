import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function summarizePayload(payload: Record<string, unknown>): string {
  const parts: string[] = [];
  const succeeded =
    typeof payload.success === 'boolean'
      ? payload.success
      : typeof payload.ok === 'boolean'
        ? payload.ok
        : undefined;
  if (succeeded !== undefined) {
    parts.push(succeeded ? 'success' : 'failed');
  }
  for (const key of ['message', 'error']) {
    const value = payload[key];
    if (typeof value === 'string' && value.trim()) {
      parts.push(value.trim().slice(0, 160));
    }
  }

  const status = parts.length ? parts.join(': ') : 'Result available';
  return `${status}. Full data is in structuredContent.`;
}

export function compactStructuredToolResult(result: CallToolResult): CallToolResult {
  if (result.isError || !isPlainObject(result.structuredContent)) return result;

  let compacted = false;
  const content = (result.content || []).flatMap((item) => {
    if (item.type !== 'text' || typeof item.text !== 'string') return [item];
    try {
      const parsed = JSON.parse(item.text);
      if (!isPlainObject(parsed)) return [item];
      if (compacted) return [item];
      compacted = true;
      return [
        { ...item, text: summarizePayload(result.structuredContent as Record<string, unknown>) },
      ];
    } catch {
      return [item];
    }
  });

  return compacted ? { ...result, content } : result;
}
