import { describe, expect, test } from '@jest/globals';
import {
  FAST_TOOL_CALL_TIMEOUT_MS,
  LONG_TOOL_CALL_TIMEOUT_MS,
  MEDIUM_TOOL_CALL_TIMEOUT_MS,
  getToolCallTimeoutMs,
} from './tool-timeouts';

describe('getToolCallTimeoutMs', () => {
  test('gives interactive tools a short budget', () => {
    expect(getToolCallTimeoutMs('chrome_click_element', {})).toBe(FAST_TOOL_CALL_TIMEOUT_MS);
    expect(getToolCallTimeoutMs('chrome_read_page', undefined)).toBe(FAST_TOOL_CALL_TIMEOUT_MS);
  });

  test('keeps navigation/screenshot at a medium budget', () => {
    expect(getToolCallTimeoutMs('chrome_navigate', {})).toBe(MEDIUM_TOOL_CALL_TIMEOUT_MS);
  });

  test('keeps long-running and unknown tools at 120s', () => {
    expect(getToolCallTimeoutMs('chrome_wait_for', {})).toBe(LONG_TOOL_CALL_TIMEOUT_MS);
    expect(getToolCallTimeoutMs('performance_stop_trace', {})).toBe(LONG_TOOL_CALL_TIMEOUT_MS);
    expect(getToolCallTimeoutMs('flow.checkout', {})).toBe(LONG_TOOL_CALL_TIMEOUT_MS);
  });

  test('extends the budget for an explicit timeout argument, capped at 120s', () => {
    expect(getToolCallTimeoutMs('chrome_click_element', { timeout: 45_000 })).toBe(55_000);
    expect(getToolCallTimeoutMs('chrome_click_element', { timeoutMs: 5_000 })).toBe(
      FAST_TOOL_CALL_TIMEOUT_MS,
    );
    expect(getToolCallTimeoutMs('chrome_click_element', { timeoutMs: 500_000 })).toBe(
      LONG_TOOL_CALL_TIMEOUT_MS,
    );
    expect(getToolCallTimeoutMs('chrome_click_element', { timeoutMs: 'soon' })).toBe(
      FAST_TOOL_CALL_TIMEOUT_MS,
    );
  });
});
