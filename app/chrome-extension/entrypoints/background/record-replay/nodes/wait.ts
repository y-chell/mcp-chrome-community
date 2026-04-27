import { handleCallTool } from '@/entrypoints/background/tools';
import { TOOL_NAMES } from 'chrome-mcp-shared';
import type { StepWait } from '../types';
import { expandTemplatesDeep, waitForNavigation, waitForNetworkIdle } from '../rr-utils';
import type { ExecCtx, ExecResult, NodeRuntime } from './types';

function getToolText(result: unknown): string | undefined {
  const first = (result as { content?: Array<{ type?: string; text?: string }> })?.content?.[0];
  return first?.type === 'text' ? first.text : undefined;
}

async function waitViaComputer(ctx: ExecCtx, params: Record<string, unknown>, timeoutMs: number) {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  const tabId = tabs?.[0]?.id;
  if (typeof tabId !== 'number') throw new Error('Active tab not found');

  const result = await handleCallTool({
    name: TOOL_NAMES.BROWSER.COMPUTER,
    args: {
      action: 'wait',
      tabId,
      frameId: ctx.frameId,
      timeout: timeoutMs,
      ...params,
    },
  });

  if ((result as { isError?: boolean })?.isError) {
    throw new Error(getToolText(result) || 'wait tool failed');
  }
}

export const waitNode: NodeRuntime<StepWait> = {
  validate: (step) => {
    const ok = !!(step as any).condition;
    return ok ? { ok } : { ok, errors: ['缺少等待条件'] };
  },
  run: async (ctx: ExecCtx, step: StepWait) => {
    const s = expandTemplatesDeep(step as StepWait, ctx.vars);
    const cond = (s as StepWait).condition as
      | { selector: string; visible?: boolean; selectorType?: 'css' | 'xpath'; clickable?: boolean }
      | { ref: string; clickable: true; selectorType?: 'css' | 'xpath' }
      | { text: string; appear?: boolean }
      | { navigation: true }
      | { networkIdle: true }
      | { download: true; filenameContains?: string; waitForComplete?: boolean }
      | {
          network: true;
          urlPattern?: string;
          method?: string;
          status?: number;
          includeStatic?: boolean;
        }
      | { sleep: number };

    if ('text' in cond) {
      await waitViaComputer(
        ctx,
        { text: cond.text, appear: (cond as { appear?: boolean }).appear !== false },
        Math.max(0, Math.min((s as any).timeoutMs || 10000, 120000)),
      );
    } else if ('networkIdle' in cond) {
      const total = Math.min(Math.max(1000, (s as any).timeoutMs || 5000), 120000);
      const idle = Math.min(1500, Math.max(500, Math.floor(total / 3)));
      await waitForNetworkIdle(total, idle);
    } else if ('navigation' in cond) {
      await waitForNavigation((s as any).timeoutMs);
    } else if ('sleep' in cond) {
      const ms = Math.max(0, Number(cond.sleep ?? 0));
      await new Promise((r) => setTimeout(r, ms));
    } else if ('ref' in cond && cond.clickable === true) {
      await waitViaComputer(
        ctx,
        { ref: cond.ref, clickable: true, selectorType: cond.selectorType || 'css' },
        Math.max(0, Math.min((s as any).timeoutMs || 10000, 120000)),
      );
    } else if ('selector' in cond) {
      const timeoutMs = Math.max(0, Math.min((s as any).timeoutMs || 10000, 120000));
      if (cond.clickable === true) {
        await waitViaComputer(
          ctx,
          { selector: cond.selector, clickable: true, selectorType: cond.selectorType || 'css' },
          timeoutMs,
        );
      } else {
        await waitViaComputer(
          ctx,
          {
            selector: cond.selector,
            selectorType: cond.selectorType || 'css',
            visible: (cond as { visible?: boolean }).visible !== false,
          },
          timeoutMs,
        );
      }
    } else if ('download' in cond) {
      await waitViaComputer(
        ctx,
        {
          download: true,
          filenameContains: cond.filenameContains,
          waitForComplete: cond.waitForComplete !== false,
        },
        Math.max(1000, Math.min((s as any).timeoutMs || 10000, 120000)),
      );
    } else if ('network' in cond) {
      await waitViaComputer(
        ctx,
        {
          network: true,
          urlPattern: cond.urlPattern,
          method: cond.method,
          status: cond.status,
          includeStatic: cond.includeStatic === true,
        },
        Math.max(1000, Math.min((s as any).timeoutMs || 10000, 120000)),
      );
    }
    return {} as ExecResult;
  },
};
