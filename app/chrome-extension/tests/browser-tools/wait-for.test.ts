import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { assertTool, waitForTool } from '@/entrypoints/background/tools/browser/wait-for';
import { computerTool } from '@/entrypoints/background/tools/browser/computer';

function parseJsonResult(result: { content?: Array<{ type: string; text?: string }> }) {
  const text = result.content?.[0]?.text;
  return JSON.parse(String(text || '{}'));
}

describe('wait_for and assert tools', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    (globalThis.chrome as any).scripting = {
      executeScript: vi.fn(),
    };

    (chrome.tabs.get as any) = vi.fn().mockResolvedValue({
      id: 21,
      url: 'https://example.com/dashboard',
      title: 'Example Dashboard',
      windowId: 1,
    });
    (chrome.tabs.query as any) = vi.fn().mockResolvedValue([
      {
        id: 21,
        url: 'https://example.com/dashboard',
        title: 'Example Dashboard',
        windowId: 1,
        active: true,
      },
    ]);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('delegates element visibility waits to chrome_computer', async () => {
    const computerSpy = vi.spyOn(computerTool, 'execute').mockResolvedValue({
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            success: true,
            kind: 'selector',
            matched: { ref: 'ref_1' },
            matchedFrameId: 3,
            tookMs: 45,
          }),
        },
      ],
      isError: false,
    } as any);

    const result = await waitForTool.execute({
      tabId: 21,
      timeoutMs: 4321,
      frameId: 3,
      condition: {
        kind: 'element',
        selector: '#submit',
        state: 'visible',
      },
    } as any);

    expect(result.isError).toBe(false);
    expect(computerSpy).toHaveBeenCalledWith({
      action: 'wait',
      tabId: 21,
      frameId: 3,
      ref: undefined,
      selector: '#submit',
      selectorType: undefined,
      clickable: false,
      visible: true,
      timeout: 4321,
    });
    expect(parseJsonResult(result)).toMatchObject({
      success: true,
      tool: 'chrome_wait_for',
      kind: 'element',
      state: 'visible',
      matchedFrameId: 3,
    });
  });

  it('waits for url matches without ad-hoc js', async () => {
    const result = await waitForTool.execute({
      tabId: 21,
      timeoutMs: 0,
      condition: {
        kind: 'url',
        value: '/dashboard',
        match: 'contains',
      },
    } as any);

    expect(result.isError).toBe(false);
    expect(parseJsonResult(result)).toMatchObject({
      success: true,
      tool: 'chrome_wait_for',
      kind: 'url',
      match: 'contains',
      observed: 'https://example.com/dashboard',
    });
  });

  it('waits for javascript predicates in page context', async () => {
    (chrome.scripting.executeScript as any).mockResolvedValue([
      {
        result: {
          success: true,
          value: { ready: true, count: 2 },
        },
      },
    ]);

    const result = await waitForTool.execute({
      tabId: 21,
      timeoutMs: 0,
      condition: {
        kind: 'javascript',
        predicate: '(() => ({ ready: true, count: 2 }))',
      },
    } as any);

    expect(result.isError).toBe(false);
    expect(parseJsonResult(result)).toMatchObject({
      success: true,
      tool: 'chrome_wait_for',
      kind: 'javascript',
      observed: { ready: true, count: 2 },
    });
  });

  it('returns a clear assertion failure', async () => {
    const result = await assertTool.execute({
      tabId: 21,
      timeoutMs: 0,
      condition: {
        kind: 'title',
        value: 'Wrong Title',
        match: 'equals',
      },
    } as any);

    expect(result.isError).toBe(true);
    expect(result.content?.[0]?.text).toContain('assert failed:');
    expect(result.content?.[0]?.text).toContain('title');
  });

  it('rejects sleep assertions', async () => {
    const result = await assertTool.execute({
      tabId: 21,
      condition: {
        kind: 'sleep',
        durationMs: 10,
      },
    } as any);

    expect(result.isError).toBe(true);
    expect(result.content?.[0]?.text).toContain('does not support');
  });

  it('cancels sleep waits with AbortError and clears the active timer', async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const pending = waitForTool.execute(
      {
        tabId: 21,
        condition: { kind: 'sleep', durationMs: 5000 },
      } as any,
      { signal: controller.signal } as any,
    );

    await vi.advanceTimersByTimeAsync(0);
    controller.abort();

    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    expect(vi.getTimerCount()).toBe(0);
  });

  it('reports monotonic sleep progress and finishes at 100', async () => {
    vi.useFakeTimers();
    const progress: number[] = [];
    const pending = waitForTool.execute(
      {
        tabId: 21,
        condition: { kind: 'sleep', durationMs: 1000 },
      } as any,
      {
        reportProgress: vi.fn(async (update) => progress.push(update.progress)),
      } as any,
    );

    await vi.runAllTimersAsync();
    const result = await pending;

    expect(result.isError).toBe(false);
    expect(progress.at(-1)).toBe(100);
    expect(progress.every((value, index) => index === 0 || value >= progress[index - 1])).toBe(
      true,
    );
    expect(progress.length).toBeLessThanOrEqual(6);
  });

  it('does not fail when progress delivery is unavailable', async () => {
    vi.useFakeTimers();
    const pending = waitForTool.execute(
      {
        tabId: 21,
        condition: { kind: 'sleep', durationMs: 500 },
      } as any,
      {
        reportProgress: vi.fn(async () => {
          throw new Error('progress channel closed');
        }),
      } as any,
    );

    await vi.runAllTimersAsync();
    await expect(pending).resolves.toMatchObject({ isError: false });
  });
});
