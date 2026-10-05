/**
 * Per-tool timeout budget for browser tool calls forwarded to the extension.
 *
 * A single 120s timeout meant that when the extension service worker died or a page hung,
 * the agent waited two minutes before learning anything. Interactive tools normally finish
 * in well under a second, so they get a short budget; long-running tools keep 120s.
 * An explicit `timeout`/`timeoutMs` argument always gets enough room (plus a grace period).
 */
export const LONG_TOOL_CALL_TIMEOUT_MS = 120_000;
export const MEDIUM_TOOL_CALL_TIMEOUT_MS = 60_000;
export const FAST_TOOL_CALL_TIMEOUT_MS = 30_000;
const TOOL_TIMEOUT_GRACE_MS = 10_000;

const FAST_TOOLS = new Set([
  'chrome_health',
  'get_windows_and_tabs',
  'chrome_list_frames',
  'chrome_switch_tab',
  'chrome_close_tabs',
  'chrome_tab_group',
  'chrome_click_element',
  'chrome_fill_or_select',
  'chrome_keyboard',
  'chrome_read_page',
  'chrome_scan_compact',
  'chrome_query_elements',
  'chrome_get_element_html',
  'chrome_get_interactive_elements',
  'chrome_clipboard',
  'chrome_handle_dialog',
  'chrome_history',
  'chrome_bookmark_search',
  'chrome_bookmark_add',
  'chrome_bookmark_delete',
]);

const MEDIUM_TOOLS = new Set(['chrome_navigate', 'chrome_screenshot']);

export function getToolCallTimeoutMs(name: string, args: unknown): number {
  const base = FAST_TOOLS.has(name)
    ? FAST_TOOL_CALL_TIMEOUT_MS
    : MEDIUM_TOOLS.has(name)
      ? MEDIUM_TOOL_CALL_TIMEOUT_MS
      : LONG_TOOL_CALL_TIMEOUT_MS;

  const requested = getRequestedTimeoutMs(args);
  if (requested === undefined) return base;
  return Math.min(LONG_TOOL_CALL_TIMEOUT_MS, Math.max(base, requested + TOOL_TIMEOUT_GRACE_MS));
}

function getRequestedTimeoutMs(args: unknown): number | undefined {
  if (!args || typeof args !== 'object' || Array.isArray(args)) return undefined;
  const record = args as Record<string, unknown>;
  const values = [record.timeoutMs, record.timeout].filter(
    (value): value is number => typeof value === 'number' && Number.isFinite(value) && value > 0,
  );
  return values.length > 0 ? Math.max(...values) : undefined;
}
