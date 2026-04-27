/**
 * Wait Action Handler
 *
 * Handles various wait conditions:
 * - Sleep (fixed delay)
 * - Network idle
 * - Navigation complete
 * - Text appears/disappears
 * - Selector visible/hidden
 * - Clickable target
 * - Download completion
 * - Network request completion
 */

import { TOOL_MESSAGE_TYPES } from '@/common/message-types';
import { waitForDownload } from '@/entrypoints/background/tools/browser/download';
import { waitForCapturedRequest } from '@/entrypoints/background/tools/browser/network-capture';
import { getRefTargetFrameId } from '@/utils/ref-target-store';
import { ENGINE_CONSTANTS } from '../../engine/constants';
import { waitForNavigation, waitForNetworkIdle } from '../../rr-utils';
import { failed, invalid, ok, tryResolveNumber } from '../registry';
import type { ActionHandler } from '../types';
import { clampInt, resolveOptionalString, resolveString, sendMessageToTab } from './common';

type WaitHelperResponse = {
  success?: boolean;
  reason?: string;
  error?: string;
  matched?: unknown;
  tookMs?: number;
};

type FrameWaitResult = {
  success: boolean;
  frameId?: number;
  response?: WaitHelperResponse;
  reason?: string;
  error?: string;
};

async function getWaitFrameIds(
  tabId: number,
  preferredFrameId?: number,
  includeAllFrames: boolean = false,
): Promise<number[]> {
  if (typeof preferredFrameId === 'number') return [preferredFrameId];
  if (!includeAllFrames) return [0];

  try {
    const frames = await chrome.webNavigation.getAllFrames({ tabId });
    const frameIds = Array.from(
      new Set(
        (frames || [])
          .map((frame) => frame?.frameId)
          .filter((frameId): frameId is number => Number.isInteger(frameId) && frameId >= 0),
      ),
    ).sort((a, b) => a - b);

    return frameIds.length > 0 ? frameIds : [0];
  } catch {
    return [0];
  }
}

async function injectWaitHelper(tabId: number, frameIds: number[]): Promise<void> {
  const target: { tabId: number; allFrames?: boolean; frameIds?: number[] } = { tabId };

  if (frameIds.length > 1) {
    target.allFrames = true;
  } else {
    target.frameIds = frameIds;
  }

  await chrome.scripting.executeScript({
    target,
    files: ['inject-scripts/wait-helper.js'],
    world: 'ISOLATED',
  });
}

async function waitForAnyFrame(
  tabId: number,
  frameIds: number[],
  buildMessage: (frameId: number) => Record<string, unknown>,
): Promise<FrameWaitResult> {
  return await new Promise((resolve) => {
    let settled = 0;
    let resolved = false;
    let sawTimeout = false;
    let firstError: string | undefined;

    const finish = (result: FrameWaitResult) => {
      if (resolved) return;
      resolved = true;
      resolve(result);
    };

    for (const candidateFrameId of frameIds) {
      sendMessageToTab<WaitHelperResponse>(tabId, buildMessage(candidateFrameId), candidateFrameId)
        .then((response) => {
          if (resolved) return;
          if (response.ok && response.value?.success === true) {
            finish({ success: true, frameId: candidateFrameId, response: response.value });
            return;
          }

          settled += 1;
          const responseReason = response.ok ? response.value?.reason : undefined;
          if (responseReason === 'timeout') {
            sawTimeout = true;
          } else if (!firstError) {
            firstError = response.ok ? response.value?.error || responseReason : response.error;
          }

          if (settled === frameIds.length) {
            finish({
              success: false,
              reason: sawTimeout ? 'timeout' : 'error',
              error: firstError,
            });
          }
        })
        .catch((error) => {
          if (resolved) return;
          settled += 1;
          if (!firstError) {
            firstError = error instanceof Error ? error.message : String(error);
          }
          if (settled === frameIds.length) {
            finish({
              success: false,
              reason: sawTimeout ? 'timeout' : 'error',
              error: firstError,
            });
          }
        });
    }
  });
}

async function waitForAllFrames(
  tabId: number,
  frameIds: number[],
  buildMessage: (frameId: number) => Record<string, unknown>,
): Promise<FrameWaitResult> {
  const results = await Promise.all(
    frameIds.map(async (candidateFrameId) => {
      try {
        const response = await sendMessageToTab<WaitHelperResponse>(
          tabId,
          buildMessage(candidateFrameId),
          candidateFrameId,
        );
        return { frameId: candidateFrameId, response };
      } catch (error) {
        return {
          frameId: candidateFrameId,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    }),
  );

  let sawTimeout = false;
  let firstError: string | undefined;
  let lastSuccessFrameId: number | undefined;
  let lastSuccessResponse: WaitHelperResponse | undefined;

  for (const result of results) {
    if (result.response?.ok && result.response.value?.success === true) {
      lastSuccessFrameId = result.frameId;
      lastSuccessResponse = result.response.value;
      continue;
    }

    if (result.response?.ok && result.response.value?.reason === 'timeout') {
      sawTimeout = true;
      continue;
    }

    if (!firstError) {
      firstError =
        result.error ||
        (result.response?.ok
          ? result.response.value?.error || result.response.value?.reason
          : undefined) ||
        (!result.response?.ok ? result.response.error : undefined) ||
        'unknown error';
    }
  }

  if (firstError) {
    return { success: false, reason: 'error', error: firstError };
  }
  if (sawTimeout) {
    return { success: false, reason: 'timeout' };
  }

  return {
    success: true,
    frameId: lastSuccessFrameId,
    response: lastSuccessResponse,
  };
}

export const waitHandler: ActionHandler<'wait'> = {
  type: 'wait',

  validate: (action) => {
    const condition = action.params.condition;
    if (!condition || typeof condition !== 'object') {
      return invalid('Missing condition parameter');
    }
    if (!('kind' in condition)) {
      return invalid('Condition must have a kind property');
    }
    return ok();
  },

  describe: (action) => {
    const condition = action.params.condition;
    if (!condition) return 'Wait';

    switch (condition.kind) {
      case 'sleep': {
        const ms = typeof condition.sleep === 'number' ? condition.sleep : '(dynamic)';
        return `Wait ${ms}ms`;
      }
      case 'networkIdle':
        return 'Wait for network idle';
      case 'navigation':
        return 'Wait for navigation';
      case 'text': {
        const appear = condition.appear !== false;
        const text = typeof condition.text === 'string' ? condition.text : '(dynamic)';
        const displayText = text.length > 20 ? text.slice(0, 20) + '...' : text;
        return `Wait for text "${displayText}" to ${appear ? 'appear' : 'disappear'}`;
      }
      case 'selector': {
        const visible = condition.visible !== false;
        return `Wait for selector to be ${visible ? 'visible' : 'hidden'}`;
      }
      case 'clickable':
        return 'Wait for target to become clickable';
      case 'download':
        return 'Wait for download to complete';
      case 'network':
        return 'Wait for network request to complete';
      default:
        return 'Wait';
    }
  },

  run: async (ctx, action) => {
    const vars = ctx.vars;
    const tabId = ctx.tabId;

    if (typeof tabId !== 'number') {
      return failed('TAB_NOT_FOUND', 'No active tab found');
    }

    const timeoutMs = action.policy?.timeout?.ms;
    const condition = action.params.condition;

    if (condition.kind === 'sleep') {
      const msResolved = tryResolveNumber(condition.sleep, vars);
      if (!msResolved.ok) {
        return failed('VALIDATION_ERROR', msResolved.error);
      }
      const ms = Math.max(0, Number(msResolved.value ?? 0));
      await new Promise((resolve) => setTimeout(resolve, ms));
      return { status: 'success' };
    }

    if (condition.kind === 'networkIdle') {
      const totalMs = clampInt(timeoutMs ?? 5000, 1000, ENGINE_CONSTANTS.MAX_WAIT_MS);
      let idleMs: number;

      if (condition.idleMs !== undefined) {
        const idleResolved = tryResolveNumber(condition.idleMs, vars);
        idleMs = idleResolved.ok
          ? clampInt(idleResolved.value, 200, 5000)
          : Math.min(1500, Math.max(500, Math.floor(totalMs / 3)));
      } else {
        idleMs = Math.min(1500, Math.max(500, Math.floor(totalMs / 3)));
      }

      await waitForNetworkIdle(totalMs, idleMs);
      return { status: 'success' };
    }

    if (condition.kind === 'navigation') {
      const timeout = timeoutMs === undefined ? undefined : Math.max(0, Number(timeoutMs));
      await waitForNavigation(timeout);
      return { status: 'success' };
    }

    if (condition.kind === 'text') {
      const textResolved = resolveString(condition.text, vars);
      if (!textResolved.ok) {
        return failed('VALIDATION_ERROR', textResolved.error);
      }

      const appear = condition.appear !== false;
      const timeout = clampInt(timeoutMs ?? 10000, 0, ENGINE_CONSTANTS.MAX_WAIT_MS);
      const frameIds = await getWaitFrameIds(tabId, ctx.frameId, typeof ctx.frameId !== 'number');

      try {
        await injectWaitHelper(tabId, frameIds);
      } catch (e) {
        return failed('SCRIPT_FAILED', `Failed to inject wait helper: ${(e as Error).message}`);
      }

      const waitResult =
        !appear && frameIds.length > 1
          ? await waitForAllFrames(tabId, frameIds, () => ({
              action: TOOL_MESSAGE_TYPES.WAIT_FOR_TEXT,
              text: textResolved.value,
              appear,
              timeout,
            }))
          : await waitForAnyFrame(tabId, frameIds, () => ({
              action: TOOL_MESSAGE_TYPES.WAIT_FOR_TEXT,
              text: textResolved.value,
              appear,
              timeout,
            }));

      if (!waitResult.success) {
        if (waitResult.reason === 'timeout') {
          return failed(
            'TIMEOUT',
            `Text "${textResolved.value}" did not ${appear ? 'appear' : 'disappear'} within timeout`,
          );
        }
        return failed('TIMEOUT', `Wait for text failed: ${waitResult.error || 'unknown error'}`);
      }

      return { status: 'success' };
    }

    if (condition.kind === 'selector') {
      const selectorResolved = resolveString(condition.selector, vars);
      if (!selectorResolved.ok) {
        return failed('VALIDATION_ERROR', selectorResolved.error);
      }

      const visible = condition.visible !== false;
      const selectorType = condition.selectorType || 'css';
      const timeout = clampInt(timeoutMs ?? 10000, 0, ENGINE_CONSTANTS.MAX_WAIT_MS);
      const frameIds = await getWaitFrameIds(tabId, ctx.frameId, typeof ctx.frameId !== 'number');

      try {
        await injectWaitHelper(tabId, frameIds);
      } catch (e) {
        return failed('SCRIPT_FAILED', `Failed to inject wait helper: ${(e as Error).message}`);
      }

      const waitResult =
        !visible && frameIds.length > 1
          ? await waitForAllFrames(tabId, frameIds, () => ({
              action: TOOL_MESSAGE_TYPES.WAIT_FOR_SELECTOR,
              selector: selectorResolved.value,
              isXPath: selectorType === 'xpath',
              visible,
              timeout,
            }))
          : await waitForAnyFrame(tabId, frameIds, () => ({
              action: TOOL_MESSAGE_TYPES.WAIT_FOR_SELECTOR,
              selector: selectorResolved.value,
              isXPath: selectorType === 'xpath',
              visible,
              timeout,
            }));

      if (!waitResult.success) {
        if (waitResult.reason === 'timeout') {
          return failed(
            'TIMEOUT',
            `Selector "${selectorResolved.value}" did not become ${visible ? 'visible' : 'hidden'} within timeout`,
          );
        }
        return failed(
          'TIMEOUT',
          `Wait for selector failed: ${waitResult.error || 'unknown error'}`,
        );
      }

      return { status: 'success' };
    }

    if (condition.kind === 'clickable') {
      const selector = resolveOptionalString(condition.selector, vars);
      const ref = resolveOptionalString(condition.ref, vars);
      if (!selector && !ref) {
        return failed('VALIDATION_ERROR', 'Clickable wait requires selector or ref');
      }

      const selectorType = condition.selectorType || 'css';
      const timeout = clampInt(timeoutMs ?? 10000, 0, ENGINE_CONSTANTS.MAX_WAIT_MS);
      const routedFrameId =
        typeof ctx.frameId === 'number'
          ? ctx.frameId
          : ref
            ? getRefTargetFrameId(tabId, ref)
            : undefined;
      const frameIds = await getWaitFrameIds(
        tabId,
        routedFrameId,
        typeof routedFrameId !== 'number' && !ref,
      );

      try {
        await injectWaitHelper(tabId, frameIds);
      } catch (e) {
        return failed('SCRIPT_FAILED', `Failed to inject wait helper: ${(e as Error).message}`);
      }

      const waitResult = await waitForAnyFrame(tabId, frameIds, () => ({
        action: TOOL_MESSAGE_TYPES.WAIT_FOR_CLICKABLE,
        ref,
        selector,
        isXPath: selectorType === 'xpath',
        timeout,
      }));

      if (!waitResult.success) {
        const target = ref || selector || 'target';
        if (waitResult.reason === 'timeout') {
          return failed(
            'TIMEOUT',
            `Clickable target "${target}" did not become clickable within timeout`,
          );
        }
        return failed(
          'TIMEOUT',
          `Wait for clickable target failed: ${waitResult.error || 'unknown error'}`,
        );
      }

      return { status: 'success' };
    }

    if (condition.kind === 'download') {
      const timeout = clampInt(timeoutMs ?? 10000, 1000, ENGINE_CONSTANTS.MAX_WAIT_MS);
      const filenameContains = resolveOptionalString(condition.filenameContains, vars);

      try {
        await waitForDownload({
          filenameContains,
          waitForComplete: condition.waitForComplete !== false,
          timeoutMs: timeout,
          startedAfter: Date.now(),
        });
        return { status: 'success' };
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        return failed(
          message.toLowerCase().includes('timed out') ? 'TIMEOUT' : 'DOWNLOAD_FAILED',
          `Wait for download failed: ${message}`,
        );
      }
    }

    if (condition.kind === 'network') {
      const timeout = clampInt(timeoutMs ?? 10000, 1000, ENGINE_CONSTANTS.MAX_WAIT_MS);
      const urlPattern = resolveOptionalString(condition.urlPattern, vars);
      const method = resolveOptionalString(condition.method, vars);
      let status: number | undefined;

      if (condition.status !== undefined) {
        const statusResolved = tryResolveNumber(condition.status, vars);
        if (!statusResolved.ok) {
          return failed('VALIDATION_ERROR', statusResolved.error);
        }
        status = Number(statusResolved.value);
      }

      try {
        await waitForCapturedRequest({
          tabId,
          urlPattern,
          method,
          status,
          timeoutMs: timeout,
          startedAfter: Date.now(),
          includeStatic: condition.includeStatic === true,
        });
        return { status: 'success' };
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        return failed(
          message.toLowerCase().includes('timed out') ? 'TIMEOUT' : 'NETWORK_REQUEST_FAILED',
          `Wait for network request failed: ${message}`,
        );
      }
    }

    return failed(
      'VALIDATION_ERROR',
      `Unsupported wait condition kind: ${(condition as { kind: string }).kind}`,
    );
  },
};
