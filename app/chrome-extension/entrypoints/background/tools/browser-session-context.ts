import type { ToolResult } from '@/common/tool-handler';

export interface BrowserToolCallContext {
  sessionId?: string;
  requestId?: string;
  transport?: string;
  nativeRequestId?: string;
}

interface BrowserSessionBinding {
  tabId?: number;
  windowId?: number;
  updatedAt: number;
  source?: string;
}

interface PreparedToolCall {
  args: any;
  initialTarget?: BrowserSessionBinding;
  bindingBeforeCall?: BrowserSessionBinding;
}

const sessionBindings = new Map<string, BrowserSessionBinding>();
const isolationQueues = new Map<string, Promise<void>>();

const NAVIGATE_TOOL = 'chrome_navigate';
const CLOSE_TABS_TOOL = 'chrome_close_tabs';
const SWITCH_TAB_TOOL = 'chrome_switch_tab';

const SESSION_AWARE_TOOLS = new Set([
  NAVIGATE_TOOL,
  CLOSE_TABS_TOOL,
  SWITCH_TAB_TOOL,
  'chrome_list_frames',
  'chrome_read_page',
  'chrome_query_elements',
  'chrome_get_element_html',
  'chrome_computer',
  'chrome_click_element',
  'chrome_fill_or_select',
  'chrome_keyboard',
  'chrome_screenshot',
  'chrome_console',
  'chrome_collect_debug_evidence',
  'chrome_javascript',
  'chrome_get_web_content',
  'chrome_upload_file',
  'chrome_get_upload_status',
  'chrome_wait_for',
  'chrome_assert',
  'chrome_inject_script',
  'chrome_send_command_to_inject_script',
  'chrome_gif_recorder',
]);

const PIN_INITIAL_ACTIVE_TOOLS = new Set([
  'chrome_list_frames',
  'chrome_read_page',
  'chrome_query_elements',
  'chrome_get_element_html',
  'chrome_computer',
  'chrome_click_element',
  'chrome_fill_or_select',
  'chrome_keyboard',
  'chrome_screenshot',
  'chrome_console',
  'chrome_collect_debug_evidence',
  'chrome_javascript',
  'chrome_get_web_content',
  'chrome_upload_file',
  'chrome_get_upload_status',
  'chrome_wait_for',
  'chrome_assert',
  'chrome_inject_script',
  'chrome_send_command_to_inject_script',
  'chrome_gif_recorder',
]);

function normalizeSessionId(context?: BrowserToolCallContext): string | undefined {
  const raw = context?.sessionId;
  if (typeof raw !== 'string') return undefined;
  const value = raw.trim();
  return value || undefined;
}

function isPlainObject(value: unknown): value is Record<string, any> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asFiniteNumber(value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined;
  return value;
}

async function getTab(tabId?: number): Promise<chrome.tabs.Tab | null> {
  if (typeof tabId !== 'number') return null;
  try {
    return await chrome.tabs.get(tabId);
  } catch {
    return null;
  }
}

async function getWindow(windowId?: number): Promise<chrome.windows.Window | null> {
  if (typeof windowId !== 'number' || !chrome.windows?.get) return null;
  try {
    return await chrome.windows.get(windowId, { populate: false });
  } catch {
    return null;
  }
}

async function getActiveTab(windowId?: number): Promise<chrome.tabs.Tab | null> {
  try {
    if (typeof windowId === 'number') {
      const tabs = await chrome.tabs.query({ active: true, windowId });
      return tabs[0] || null;
    }

    const currentWindowTabs = await chrome.tabs.query({ active: true, currentWindow: true });
    if (currentWindowTabs[0]) return currentWindowTabs[0];

    if (chrome.windows?.getLastFocused) {
      const focusedWindow = await chrome.windows.getLastFocused({ populate: false });
      if (typeof focusedWindow?.id === 'number') {
        const tabs = await chrome.tabs.query({ active: true, windowId: focusedWindow.id });
        if (tabs[0]) return tabs[0];
      }
    }

    const activeTabs = await chrome.tabs.query({ active: true });
    return activeTabs[0] || null;
  } catch {
    return null;
  }
}

async function validateBinding(
  binding?: BrowserSessionBinding,
): Promise<BrowserSessionBinding | null> {
  if (!binding) return null;

  const tab = await getTab(binding.tabId);
  if (tab?.id) {
    return {
      tabId: tab.id,
      windowId: tab.windowId,
      updatedAt: binding.updatedAt,
      source: binding.source,
    };
  }

  const window = await getWindow(binding.windowId);
  if (window?.id) {
    return {
      windowId: window.id,
      updatedAt: binding.updatedAt,
      source: binding.source,
    };
  }

  return null;
}

async function rememberSessionTarget(
  sessionId: string,
  target: Partial<BrowserSessionBinding>,
  source: string,
): Promise<void> {
  const tab = await getTab(target.tabId);
  if (tab?.id) {
    sessionBindings.set(sessionId, {
      tabId: tab.id,
      windowId: tab.windowId,
      updatedAt: Date.now(),
      source,
    });
    return;
  }

  const window = await getWindow(target.windowId);
  if (window?.id) {
    sessionBindings.set(sessionId, {
      windowId: window.id,
      updatedAt: Date.now(),
      source,
    });
  }
}

function shouldPinInitialActiveTab(toolName: string, args: Record<string, any>): boolean {
  if (!PIN_INITIAL_ACTIVE_TOOLS.has(toolName)) return false;
  if (typeof args.url === 'string' && args.url.trim()) return false;
  return true;
}

async function getStoredBinding(sessionId: string): Promise<BrowserSessionBinding | null> {
  const existing = await validateBinding(sessionBindings.get(sessionId));
  if (!existing) {
    sessionBindings.delete(sessionId);
    return null;
  }
  sessionBindings.set(sessionId, existing);
  return existing;
}

async function prepareToolArgs(
  toolName: string,
  rawArgs: any,
  context?: BrowserToolCallContext,
): Promise<PreparedToolCall> {
  const args = isPlainObject(rawArgs) ? { ...rawArgs } : {};
  const sessionId = normalizeSessionId(context);
  if (!sessionId || !SESSION_AWARE_TOOLS.has(toolName)) {
    return { args };
  }

  const explicitTabId = asFiniteNumber(args.tabId);
  const explicitWindowId = asFiniteNumber(args.windowId);

  if (typeof explicitTabId === 'number') {
    await rememberSessionTarget(sessionId, { tabId: explicitTabId }, 'explicit-tab');
    return { args, bindingBeforeCall: (await getStoredBinding(sessionId)) ?? undefined };
  }

  if (typeof explicitWindowId === 'number') {
    await rememberSessionTarget(sessionId, { windowId: explicitWindowId }, 'explicit-window');
    return { args, bindingBeforeCall: (await getStoredBinding(sessionId)) ?? undefined };
  }

  const binding = await getStoredBinding(sessionId);

  if (toolName === CLOSE_TABS_TOOL) {
    if (!args.tabIds && !args.url && typeof binding?.tabId === 'number') {
      args.tabIds = [binding.tabId];
    }
    return { args, bindingBeforeCall: binding || undefined };
  }

  if (toolName === SWITCH_TAB_TOOL) {
    return { args, bindingBeforeCall: binding || undefined };
  }

  if (binding?.tabId) {
    args.tabId = binding.tabId;
    return { args, bindingBeforeCall: binding };
  }

  if (binding?.windowId) {
    args.windowId = binding.windowId;
    return { args, bindingBeforeCall: binding };
  }

  if (toolName !== NAVIGATE_TOOL && shouldPinInitialActiveTab(toolName, args)) {
    const activeTab = await getActiveTab();
    if (activeTab?.id) {
      args.tabId = activeTab.id;
      return {
        args,
        initialTarget: {
          tabId: activeTab.id,
          windowId: activeTab.windowId,
          updatedAt: Date.now(),
          source: 'initial-active-tab',
        },
      };
    }
  }

  return { args };
}

function parseJsonPayload(result: ToolResult): Record<string, any> | null {
  for (const item of result.content || []) {
    if (item.type !== 'text') continue;
    const text = item.text?.trim();
    if (!text || (!text.startsWith('{') && !text.startsWith('['))) continue;
    try {
      const parsed = JSON.parse(text);
      return isPlainObject(parsed) ? parsed : null;
    } catch {
      // Not every text response is JSON.
    }
  }
  return null;
}

function extractTargetFromPayload(
  payload: Record<string, any> | null,
): Partial<BrowserSessionBinding> | null {
  if (!payload) return null;

  const activeContext = isPlainObject(payload.activeContextAfterClose)
    ? payload.activeContextAfterClose
    : null;
  if (activeContext) {
    return {
      tabId: asFiniteNumber(activeContext.tabId),
      windowId: asFiniteNumber(activeContext.windowId),
    };
  }

  const tabId = asFiniteNumber(payload.tabId);
  const windowId = asFiniteNumber(payload.windowId);
  if (typeof tabId === 'number' || typeof windowId === 'number') {
    return { tabId, windowId };
  }

  if (Array.isArray(payload.tabs)) {
    const tab = payload.tabs.find(
      (item: unknown) => isPlainObject(item) && typeof item.tabId === 'number',
    );
    if (isPlainObject(tab)) {
      return {
        tabId: asFiniteNumber(tab.tabId),
        windowId: asFiniteNumber(tab.windowId) ?? windowId,
      };
    }
  }

  return null;
}

async function finalizeToolCall(
  sessionId: string | undefined,
  toolName: string,
  prepared: PreparedToolCall,
  result: ToolResult,
): Promise<void> {
  if (!sessionId || !SESSION_AWARE_TOOLS.has(toolName)) return;

  const payload = parseJsonPayload(result);
  const closedTabIds = Array.isArray(payload?.closedTabIds)
    ? payload.closedTabIds.filter((id: unknown): id is number => typeof id === 'number')
    : [];
  const bindingBeforeCall = prepared.bindingBeforeCall || (await getStoredBinding(sessionId));

  if (
    toolName === CLOSE_TABS_TOOL &&
    typeof bindingBeforeCall?.tabId === 'number' &&
    closedTabIds.includes(bindingBeforeCall.tabId)
  ) {
    const target = extractTargetFromPayload(payload);
    if (target?.tabId || target?.windowId) {
      await rememberSessionTarget(sessionId, target, 'close-tabs-result');
    } else {
      sessionBindings.delete(sessionId);
    }
    return;
  }

  if (result.isError) return;

  const target = extractTargetFromPayload(payload);
  if (target?.tabId || target?.windowId) {
    await rememberSessionTarget(sessionId, target, 'tool-result');
    return;
  }

  if (prepared.initialTarget?.tabId || prepared.initialTarget?.windowId) {
    await rememberSessionTarget(sessionId, prepared.initialTarget, 'initial-target-success');
  }
}

async function enqueue<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const previous = isolationQueues.get(key) || Promise.resolve();
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const current = previous.catch(() => undefined).then(() => gate);
  isolationQueues.set(key, current);

  await previous.catch(() => undefined);
  try {
    return await fn();
  } finally {
    release();
    if (isolationQueues.get(key) === current) {
      isolationQueues.delete(key);
    }
  }
}

async function withQueues<T>(keys: string[], fn: () => Promise<T>): Promise<T> {
  const uniqueKeys = Array.from(new Set(keys)).sort();
  if (uniqueKeys.length === 0) return fn();

  let run = fn;
  for (const key of uniqueKeys.reverse()) {
    const next = run;
    run = () => enqueue(key, next);
  }
  return run();
}

function getTargetQueueKeys(args: any): string[] {
  if (!isPlainObject(args)) return [];

  const keys: string[] = [];
  const tabId = asFiniteNumber(args.tabId);
  if (typeof tabId === 'number') keys.push(`tab:${tabId}`);

  if (Array.isArray(args.tabIds)) {
    for (const id of args.tabIds) {
      const value = asFiniteNumber(id);
      if (typeof value === 'number') keys.push(`tab:${value}`);
    }
  }

  const windowId = asFiniteNumber(args.windowId);
  if (typeof windowId === 'number') keys.push(`window:${windowId}`);

  return keys;
}

export async function runBrowserToolCallWithIsolation(
  toolName: string,
  rawArgs: any,
  context: BrowserToolCallContext | undefined,
  execute: (preparedArgs: any) => Promise<ToolResult>,
): Promise<ToolResult> {
  const sessionId = normalizeSessionId(context);
  const run = async () => {
    const prepared = await prepareToolArgs(toolName, rawArgs, context);
    return withQueues(getTargetQueueKeys(prepared.args), async () => {
      const result = await execute(prepared.args);
      await finalizeToolCall(sessionId, toolName, prepared, result);
      return result;
    });
  };

  return sessionId ? enqueue(`session:${sessionId}`, run) : run();
}

export function getBrowserToolSessionBinding(sessionId: string): BrowserSessionBinding | undefined {
  return sessionBindings.get(sessionId);
}

export function clearBrowserToolSessionState(): void {
  sessionBindings.clear();
  isolationQueues.clear();
}

let listenersInstalled = false;

export function initBrowserToolSessionListeners(): void {
  if (listenersInstalled) return;
  listenersInstalled = true;

  chrome.tabs?.onRemoved?.addListener?.((tabId) => {
    for (const [sessionId, binding] of sessionBindings) {
      if (binding.tabId === tabId) {
        sessionBindings.delete(sessionId);
      }
    }
  });

  chrome.windows?.onRemoved?.addListener?.((windowId) => {
    for (const [sessionId, binding] of sessionBindings) {
      if (binding.windowId === windowId) {
        sessionBindings.delete(sessionId);
      }
    }
  });
}
