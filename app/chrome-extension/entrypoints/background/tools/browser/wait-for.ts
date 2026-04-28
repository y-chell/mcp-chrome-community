import { createErrorResponse, type ToolResult } from '@/common/tool-handler';
import { BaseBrowserToolExecutor } from '../base-browser';
import { TOOL_NAMES } from 'chrome-mcp-shared';
import { computerTool } from './computer';
import { waitForNetworkIdle } from '@/entrypoints/background/record-replay/rr-utils';

const WAIT_FOR_TOOL_NAME = TOOL_NAMES.BROWSER.WAIT_FOR || 'chrome_wait_for';
const ASSERT_TOOL_NAME = TOOL_NAMES.BROWSER.ASSERT || 'chrome_assert';

type StringMatchMode = 'contains' | 'equals' | 'regex' | 'changed';
type ElementWaitState = 'exists' | 'visible' | 'hidden' | 'clickable';

type WaitCondition =
  | {
      kind: 'element';
      selector?: string;
      ref?: string;
      selectorType?: 'css' | 'xpath';
      state?: ElementWaitState;
    }
  | {
      kind: 'text';
      text: string;
      present?: boolean;
    }
  | {
      kind: 'url';
      value?: string;
      match?: StringMatchMode;
    }
  | {
      kind: 'title';
      value?: string;
      match?: StringMatchMode;
    }
  | {
      kind: 'javascript';
      predicate: string;
    }
  | {
      kind: 'network';
      urlPattern?: string;
      method?: string;
      status?: number;
    }
  | {
      kind: 'networkIdle';
      idleMs?: number;
    }
  | {
      kind: 'download';
      filenameContains?: string;
      waitForComplete?: boolean;
    }
  | {
      kind: 'sleep';
      durationMs: number;
    };

interface WaitForParams {
  condition: WaitCondition;
  timeoutMs?: number;
  pollIntervalMs?: number;
  includeStatic?: boolean;
  tabId?: number;
  windowId?: number;
  frameId?: number;
}

interface WaitEvaluation {
  kind: WaitCondition['kind'];
  tookMs: number;
  observed?: unknown;
  matched?: unknown;
  matchedFrameId?: number;
  match?: StringMatchMode;
  state?: ElementWaitState;
}

function getFirstText(result: ToolResult): string | undefined {
  const first = result.content?.[0];
  return first && first.type === 'text' ? first.text : undefined;
}

function parseJsonResult(result: ToolResult): Record<string, unknown> | undefined {
  const text = getFirstText(result);
  if (typeof text !== 'string') return undefined;

  try {
    const parsed = JSON.parse(text);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function matchStringValue(
  observed: string,
  expected: string | undefined,
  matchMode: StringMatchMode,
  baseline?: string,
): boolean {
  switch (matchMode) {
    case 'equals':
      return typeof expected === 'string' && observed === expected;
    case 'regex':
      return typeof expected === 'string' && new RegExp(expected).test(observed);
    case 'changed':
      return typeof baseline === 'string' ? observed !== baseline : observed.length > 0;
    case 'contains':
    default:
      return typeof expected === 'string' && observed.includes(expected);
  }
}

abstract class WaitToolsBase extends BaseBrowserToolExecutor {
  protected createJsonSuccess(payload: Record<string, unknown>): ToolResult {
    return {
      content: [{ type: 'text', text: JSON.stringify(payload) }],
      isError: false,
    };
  }

  protected async resolveTargetTab(args: WaitForParams): Promise<chrome.tabs.Tab> {
    const explicit = await this.tryGetTab(args.tabId);
    return explicit || (await this.getActiveTabOrThrowInWindow(args.windowId));
  }

  protected getTimeoutMs(args: WaitForParams): number {
    return Math.max(0, Math.min(Number(args.timeoutMs ?? 10000), 120000));
  }

  protected getPollIntervalMs(args: WaitForParams): number {
    return Math.max(50, Math.min(Number(args.pollIntervalMs ?? 200), 2000));
  }

  protected async delegateComputerWait(
    args: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    const result = await computerTool.execute(args);
    if (result.isError) {
      throw new Error(getFirstText(result) || 'wait_for failed');
    }

    return parseJsonResult(result) || { success: true };
  }

  protected async pollUntil<T>(
    timeoutMs: number,
    pollIntervalMs: number,
    evaluate: () => Promise<{ matched: boolean; observed?: T; detail?: unknown; error?: string }>,
    describeTimeout: (lastObserved?: T) => string,
  ): Promise<{ tookMs: number; observed?: T; detail?: unknown }> {
    const startedAt = Date.now();
    let lastObserved: T | undefined;
    let lastDetail: unknown;
    let lastError: string | undefined;

    while (Date.now() - startedAt <= timeoutMs) {
      const result = await evaluate();
      lastObserved = result.observed;
      lastDetail = result.detail;
      lastError = result.error;

      if (result.matched) {
        return {
          tookMs: Date.now() - startedAt,
          observed: lastObserved,
          detail: lastDetail,
        };
      }

      if (Date.now() - startedAt >= timeoutMs) break;
      await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
    }

    const timeoutMessage = describeTimeout(lastObserved);
    throw new Error(lastError ? `${timeoutMessage}. Last error: ${lastError}` : timeoutMessage);
  }

  protected async waitForStringState(
    kind: 'url' | 'title',
    args: WaitForParams,
    tab: chrome.tabs.Tab,
  ): Promise<WaitEvaluation> {
    const condition = args.condition as Extract<WaitCondition, { kind: 'url' | 'title' }>;
    const timeoutMs = this.getTimeoutMs(args);
    const pollIntervalMs = this.getPollIntervalMs(args);
    const currentBaseline = kind === 'url' ? String(tab.url || '') : String(tab.title || '');
    const matchMode = condition.match || (condition.value ? 'contains' : 'changed');

    if (matchMode !== 'changed' && (!condition.value || !String(condition.value).trim())) {
      throw new Error(`${kind} wait requires a non-empty value unless match="changed"`);
    }

    const result = await this.pollUntil(
      timeoutMs,
      pollIntervalMs,
      async () => {
        const currentTab = await chrome.tabs.get(tab.id!);
        const observed = String(kind === 'url' ? currentTab.url || '' : currentTab.title || '');
        return {
          matched: matchStringValue(observed, condition.value, matchMode, currentBaseline),
          observed,
        };
      },
      (lastObserved) =>
        `wait_for timed out after ${timeoutMs}ms for ${kind} (${matchMode})` +
        (typeof lastObserved === 'string' ? `, last observed: ${lastObserved}` : ''),
    );

    return {
      kind,
      match: matchMode,
      observed: result.observed,
      tookMs: result.tookMs,
    };
  }

  protected async waitForJavascript(
    args: WaitForParams,
    tab: chrome.tabs.Tab,
  ): Promise<WaitEvaluation> {
    const condition = args.condition as Extract<WaitCondition, { kind: 'javascript' }>;
    const timeoutMs = this.getTimeoutMs(args);
    const pollIntervalMs = this.getPollIntervalMs(args);
    const frameIds = typeof args.frameId === 'number' ? [args.frameId] : undefined;

    const result = await this.pollUntil(
      timeoutMs,
      pollIntervalMs,
      async () => {
        const injected = await chrome.scripting.executeScript({
          target: { tabId: tab.id!, frameIds } as chrome.scripting.InjectionTarget,
          world: 'MAIN',
          func: async (predicate: string) => {
            try {
              const source = String(predicate || '').trim();
              let value: unknown;

              if (
                source.startsWith('function') ||
                source.startsWith('async function') ||
                source.startsWith('(') ||
                source.startsWith('async (')
              ) {
                const fn = window.eval(`(${source})`);
                value = typeof fn === 'function' ? fn() : fn;
              } else {
                value = new Function(`return (${source});`)();
              }

              if (value && typeof (value as Promise<unknown>).then === 'function') {
                value = await (value as Promise<unknown>);
              }

              return { success: true, value };
            } catch (error) {
              return {
                success: false,
                error: error instanceof Error ? error.message : String(error),
              };
            }
          },
          args: [condition.predicate],
        });

        const observed = Array.isArray(injected) ? injected[0]?.result : undefined;
        const success =
          observed && typeof observed === 'object' && (observed as any).success === true;
        if (!success) {
          return {
            matched: false,
            observed,
            error:
              observed && typeof observed === 'object'
                ? String((observed as any).error || 'predicate failed')
                : 'predicate failed',
          };
        }

        return {
          matched: !!(observed as any).value,
          observed: (observed as any).value,
        };
      },
      (lastObserved) =>
        `wait_for timed out after ${timeoutMs}ms for javascript predicate` +
        (lastObserved !== undefined ? `, last observed: ${JSON.stringify(lastObserved)}` : ''),
    );

    return {
      kind: 'javascript',
      observed: result.observed,
      tookMs: result.tookMs,
    };
  }

  protected async waitForElement(
    args: WaitForParams,
    tab: chrome.tabs.Tab,
  ): Promise<WaitEvaluation> {
    const condition = args.condition as Extract<WaitCondition, { kind: 'element' }>;
    const state = condition.state || 'visible';

    if (state === 'exists') {
      if (!condition.selector || !String(condition.selector).trim()) {
        throw new Error('element wait with state="exists" requires a selector');
      }

      const timeoutMs = this.getTimeoutMs(args);
      const pollIntervalMs = this.getPollIntervalMs(args);
      const selector = String(condition.selector).trim();
      const selectorType = condition.selectorType || 'css';
      const frameIds = typeof args.frameId === 'number' ? [args.frameId] : undefined;

      const result = await this.pollUntil(
        timeoutMs,
        pollIntervalMs,
        async () => {
          const injected = await chrome.scripting.executeScript({
            target: { tabId: tab.id!, frameIds } as chrome.scripting.InjectionTarget,
            world: 'MAIN',
            func: (nextSelector: string, nextSelectorType: 'css' | 'xpath') => {
              try {
                const element =
                  nextSelectorType === 'xpath'
                    ? document.evaluate(
                        nextSelector,
                        document,
                        null,
                        XPathResult.FIRST_ORDERED_NODE_TYPE,
                        null,
                      ).singleNodeValue
                    : document.querySelector(nextSelector);
                return {
                  success: true,
                  exists: !!element,
                };
              } catch (error) {
                return {
                  success: false,
                  error: error instanceof Error ? error.message : String(error),
                };
              }
            },
            args: [selector, selectorType],
          });

          const observed = Array.isArray(injected) ? injected[0]?.result : undefined;
          return {
            matched: !!(observed as any)?.exists,
            observed,
            error:
              observed && typeof observed === 'object' && (observed as any).success === false
                ? String((observed as any).error || 'selector check failed')
                : undefined,
          };
        },
        () => `wait_for timed out after ${timeoutMs}ms for element existence: ${selector}`,
      );

      return {
        kind: 'element',
        state,
        observed: result.observed,
        tookMs: result.tookMs,
      };
    }

    const delegated = await this.delegateComputerWait({
      action: 'wait',
      tabId: tab.id,
      frameId: args.frameId,
      ref: condition.ref,
      selector: condition.selector,
      selectorType: condition.selectorType,
      clickable: state === 'clickable',
      visible: state === 'hidden' ? false : true,
      timeout: this.getTimeoutMs(args),
    });

    return {
      kind: 'element',
      state,
      observed: delegated.matched,
      matched: delegated.matched,
      matchedFrameId:
        typeof delegated.matchedFrameId === 'number' ? delegated.matchedFrameId : undefined,
      tookMs: Number(delegated.tookMs || 0),
    };
  }

  protected async evaluateCondition(
    args: WaitForParams,
    tab: chrome.tabs.Tab,
  ): Promise<WaitEvaluation> {
    const condition = args.condition;

    switch (condition.kind) {
      case 'element':
        return await this.waitForElement(args, tab);
      case 'text': {
        const delegated = await this.delegateComputerWait({
          action: 'wait',
          tabId: tab.id,
          frameId: args.frameId,
          text: condition.text,
          appear: condition.present !== false,
          timeout: this.getTimeoutMs(args),
        });

        return {
          kind: 'text',
          observed: delegated.matched,
          matched: delegated.matched,
          tookMs: Number(delegated.tookMs || 0),
        };
      }
      case 'url':
      case 'title':
        return await this.waitForStringState(condition.kind, args, tab);
      case 'javascript':
        return await this.waitForJavascript(args, tab);
      case 'network': {
        const delegated = await this.delegateComputerWait({
          action: 'wait',
          tabId: tab.id,
          network: true,
          urlPattern: condition.urlPattern,
          method: condition.method,
          status: condition.status,
          includeStatic: args.includeStatic === true,
          timeout: this.getTimeoutMs(args),
        });

        return {
          kind: 'network',
          observed: delegated.request,
          matched: delegated.request,
          tookMs: Number(delegated.tookMs || 0),
        };
      }
      case 'networkIdle': {
        const timeoutMs = this.getTimeoutMs(args);
        const idleMs = Math.max(
          200,
          Math.min(Number(condition.idleMs ?? Math.max(500, Math.floor(timeoutMs / 3))), 5000),
        );
        const startedAt = Date.now();
        await waitForNetworkIdle(timeoutMs, idleMs);
        return {
          kind: 'networkIdle',
          observed: { idleMs },
          tookMs: Date.now() - startedAt,
        };
      }
      case 'download': {
        const delegated = await this.delegateComputerWait({
          action: 'wait',
          tabId: tab.id,
          download: true,
          filenameContains: condition.filenameContains,
          waitForComplete: condition.waitForComplete !== false,
          timeout: this.getTimeoutMs(args),
        });

        return {
          kind: 'download',
          observed: delegated.download,
          matched: delegated.download,
          tookMs: Number(delegated.tookMs || 0),
        };
      }
      case 'sleep': {
        const durationMs = Math.max(0, Math.min(Number(condition.durationMs || 0), 30000));
        const startedAt = Date.now();
        await new Promise((resolve) => setTimeout(resolve, durationMs));
        return {
          kind: 'sleep',
          observed: { durationMs },
          tookMs: Date.now() - startedAt,
        };
      }
      default:
        throw new Error(`Unsupported wait condition: ${(condition as WaitCondition).kind}`);
    }
  }
}

class WaitForTool extends WaitToolsBase {
  name = WAIT_FOR_TOOL_NAME;

  async execute(args: WaitForParams): Promise<ToolResult> {
    if (!args?.condition || typeof args.condition !== 'object') {
      return createErrorResponse('condition is required for chrome_wait_for');
    }

    try {
      const tab = await this.resolveTargetTab(args);
      const result = await this.evaluateCondition(args, tab);
      return this.createJsonSuccess({
        success: true,
        tool: this.name,
        tabId: tab.id,
        ...result,
      });
    } catch (error) {
      return createErrorResponse(error instanceof Error ? error.message : 'chrome_wait_for failed');
    }
  }
}

class AssertTool extends WaitToolsBase {
  name = ASSERT_TOOL_NAME;

  async execute(args: WaitForParams): Promise<ToolResult> {
    if (!args?.condition || typeof args.condition !== 'object') {
      return createErrorResponse('condition is required for chrome_assert');
    }

    if (args.condition.kind === 'sleep') {
      return createErrorResponse('chrome_assert does not support condition.kind="sleep"');
    }

    try {
      const tab = await this.resolveTargetTab(args);
      const result = await this.evaluateCondition(args, tab);
      return this.createJsonSuccess({
        success: true,
        tool: this.name,
        passed: true,
        tabId: tab.id,
        ...result,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'assert failed';
      return createErrorResponse(`assert failed: ${message}`);
    }
  }
}

export const waitForTool = new WaitForTool();
export const assertTool = new AssertTool();
