import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import http, { type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import path from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { resolvePreferredNodeExecPath } from './utils';

type JsonRpcMessage = {
  jsonrpc?: string;
  id?: number | string;
  method?: string;
  params?: unknown;
  result?: any;
  error?: { code?: number; message?: string; data?: unknown };
};

type SmokeOptions = {
  serverPath: string;
  timeoutMs: number;
  profile: 'full' | 'core' | 'search';
  callHealth: boolean;
  realBrowser: boolean;
  verbose: boolean;
  requiredTools: string[];
};

let verboseLogging = false;

function logProgress(message: string) {
  if (verboseLogging) console.error(`[stdio-smoke] ${message}`);
}

const DEFAULT_REQUIRED_TOOLS = [
  'chrome_health',
  'chrome_navigate',
  'chrome_read_page',
  'chrome_computer',
  'chrome_fill_or_select',
  'chrome_click_element',
  'chrome_javascript',
  'chrome_clipboard',
  'chrome_collect_debug_evidence',
  'chrome_wait_for',
  'chrome_wait_for_tab',
  'chrome_screenshot',
  'chrome_close_tabs',
  'chrome_tab_group',
];

const REQUIRED_TOOLS_BY_PROFILE: Record<SmokeOptions['profile'], string[]> = {
  full: DEFAULT_REQUIRED_TOOLS,
  core: [
    'chrome_search_tools',
    'chrome_describe_tool',
    'chrome_call_tool',
    'chrome_health',
    'chrome_navigate',
    'chrome_read_page',
    'chrome_javascript',
    'chrome_wait_for',
  ],
  search: [
    'chrome_search_tools',
    'chrome_describe_tool',
    'chrome_call_tool',
    'chrome_health',
    'get_windows_and_tabs',
  ],
};

function parseArgs(argv: string[]): SmokeOptions {
  const defaultServerPath = path.resolve(__dirname, '..', 'mcp', 'mcp-server-stdio.js');
  let requiredToolsOverridden = false;
  const options: SmokeOptions = {
    serverPath: defaultServerPath,
    timeoutMs: 10000,
    profile: 'full',
    callHealth: false,
    realBrowser: false,
    verbose: false,
    requiredTools: [...DEFAULT_REQUIRED_TOOLS],
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--') {
      continue;
    } else if (arg === '--server') {
      const value = argv[index + 1];
      if (!value) throw new Error('--server requires a path');
      options.serverPath = path.resolve(value);
      index += 1;
    } else if (arg === '--timeout-ms') {
      const value = Number(argv[index + 1]);
      if (!Number.isFinite(value) || value <= 0) throw new Error('--timeout-ms must be positive');
      options.timeoutMs = value;
      index += 1;
    } else if (arg === '--profile') {
      const value = argv[index + 1];
      if (value !== 'full' && value !== 'core' && value !== 'search') {
        throw new Error('--profile must be full, core, or search');
      }
      options.profile = value;
      index += 1;
    } else if (arg === '--call-health') {
      options.callHealth = true;
    } else if (arg === '--real-browser') {
      options.realBrowser = true;
      options.callHealth = true;
      options.verbose = true;
    } else if (arg === '--verbose') {
      options.verbose = true;
    } else if (arg === '--require-tools') {
      const value = argv[index + 1];
      if (!value) throw new Error('--require-tools requires a comma-separated list');
      options.requiredTools = value
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean);
      requiredToolsOverridden = true;
      index += 1;
    } else if (arg === '--help' || arg === '-h') {
      printHelp();
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (!requiredToolsOverridden) {
    options.requiredTools = [...REQUIRED_TOOLS_BY_PROFILE[options.profile]];
  }

  return options;
}

function printHelp() {
  console.log(`Usage: node dist/scripts/mcp-stdio-smoke.js [options]

Options:
  --server <path>          Path to mcp-server-stdio.js. Defaults to built dist server.
  --timeout-ms <ms>        Per-request timeout. Default: 10000.
  --profile <name>         Tool profile: full, core, or search. Default: full.
  --require-tools <list>   Comma-separated tool names required in tools/list.
  --call-health            Also call chrome_health through the real extension/native bridge.
  --real-browser           Run a reversible real-browser fixture flow through MCP tools. Implies --verbose.
  --verbose                Print progress logs to stderr.
  -h, --help               Show this help.
`);
}

class StdioMcpClient {
  private nextId = 1;
  private stdoutBuffer = '';
  private pending = new Map<
    number,
    {
      resolve: (message: JsonRpcMessage) => void;
      reject: (error: Error) => void;
      timeout: NodeJS.Timeout;
    }
  >();

  readonly child: ChildProcessWithoutNullStreams;
  stderr = '';

  constructor(serverPath: string, profile: SmokeOptions['profile']) {
    const nodeExecPath = resolvePreferredNodeExecPath(process.execPath);
    this.child = spawn(nodeExecPath, [serverPath], {
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
      env: {
        ...process.env,
        CHROME_MCP_TOOL_PROFILE: profile,
      },
    });

    this.child.stdout.on('data', (chunk: Buffer) => {
      this.stdoutBuffer += chunk.toString('utf8');
      this.drainStdout();
    });

    this.child.stderr.on('data', (chunk: Buffer) => {
      this.stderr += chunk.toString('utf8');
    });

    this.child.on('error', (error) => {
      for (const pending of this.pending.values()) {
        clearTimeout(pending.timeout);
        pending.reject(error);
      }
      this.pending.clear();
    });

    this.child.on('exit', (code, signal) => {
      const error = new Error(`stdio server exited before response: code=${code} signal=${signal}`);
      for (const pending of this.pending.values()) {
        clearTimeout(pending.timeout);
        pending.reject(error);
      }
      this.pending.clear();
    });
  }

  request(method: string, params: unknown, timeoutMs: number): Promise<JsonRpcMessage> {
    const id = this.nextId;
    this.nextId += 1;

    const message: JsonRpcMessage = {
      jsonrpc: '2.0',
      id,
      method,
      params,
    };

    const response = new Promise<JsonRpcMessage>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Timed out waiting for ${method}`));
      }, timeoutMs);

      this.pending.set(id, { resolve, reject, timeout });
    });

    this.write(message);
    return response;
  }

  notify(method: string, params: unknown = {}) {
    this.write({ jsonrpc: '2.0', method, params });
  }

  close() {
    if (this.child.killed || this.child.exitCode !== null) return;
    try {
      this.child.kill();
    } catch {
      // Best effort cleanup. Preserve the real smoke failure instead of masking it.
    }
  }

  private write(message: JsonRpcMessage) {
    this.child.stdin.write(`${JSON.stringify(message)}\n`);
  }

  private drainStdout() {
    let newlineIndex = this.stdoutBuffer.indexOf('\n');
    while (newlineIndex >= 0) {
      const line = this.stdoutBuffer.slice(0, newlineIndex).trim();
      this.stdoutBuffer = this.stdoutBuffer.slice(newlineIndex + 1);
      if (line) this.handleLine(line);
      newlineIndex = this.stdoutBuffer.indexOf('\n');
    }
  }

  private handleLine(line: string) {
    let message: JsonRpcMessage;
    try {
      message = JSON.parse(line) as JsonRpcMessage;
    } catch {
      return;
    }

    if (typeof message.id !== 'number') return;
    const pending = this.pending.get(message.id);
    if (!pending) return;
    this.pending.delete(message.id);
    clearTimeout(pending.timeout);
    pending.resolve(message);
  }
}

function assertNoRpcError(response: JsonRpcMessage, label: string) {
  if (response.error) {
    throw new Error(`${label} failed: ${response.error.message || JSON.stringify(response.error)}`);
  }
}

function parseToolText(response: JsonRpcMessage): any {
  const text = response.result?.content?.[0]?.text;
  if (typeof text !== 'string') return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function verifyStructuredCompatibility(result: any, label: string) {
  if (!isPlainObject(result?.structuredContent)) {
    throw new Error(`${label} did not return structuredContent`);
  }

  const text = result?.content?.find?.((item: any) => item?.type === 'text')?.text;
  if (typeof text !== 'string') {
    throw new Error(`${label} did not preserve legacy text content`);
  }

  let legacyPayload: unknown;
  try {
    legacyPayload = JSON.parse(text);
  } catch {
    throw new Error(`${label} legacy text content is not JSON`);
  }

  if (JSON.stringify(legacyPayload) !== JSON.stringify(result.structuredContent)) {
    throw new Error(`${label} text content and structuredContent differ`);
  }

  return {
    legacyContent: true,
    structuredContent: true,
    contentMatchesStructured: true,
  };
}

async function verifyModernSdkCompatibility(options: SmokeOptions) {
  const nodeExecPath = resolvePreferredNodeExecPath(process.execPath);
  const env = Object.fromEntries(
    Object.entries(process.env).filter(
      (entry): entry is [string, string] => entry[1] !== undefined,
    ),
  );
  env.CHROME_MCP_TOOL_PROFILE = options.profile;

  const transport = new StdioClientTransport({
    command: nodeExecPath,
    args: [options.serverPath],
    cwd: process.cwd(),
    env,
    stderr: 'pipe',
  });
  const client = new Client(
    { name: 'mcp-chrome-community-sdk-compat-smoke', version: '0.0.0' },
    { capabilities: {} },
  );

  try {
    await client.connect(transport);
    const listed = await client.listTools();
    const healthTool = listed.tools.find((tool) => tool.name === 'chrome_health');
    if (!healthTool?.outputSchema) {
      throw new Error('Modern SDK tools/list did not expose chrome_health.outputSchema');
    }

    const result = await client.callTool({ name: 'chrome_health', arguments: {} });
    if (result.isError) {
      throw new Error(`Modern SDK chrome_health returned isError: ${JSON.stringify(result)}`);
    }

    return {
      client: '@modelcontextprotocol/sdk',
      outputSchemaAdvertised: true,
      outputSchemaValidated: true,
      ...verifyStructuredCompatibility(result, 'Modern SDK chrome_health'),
    };
  } finally {
    await client.close().catch(() => undefined);
  }
}

async function callMcpTool(
  client: StdioMcpClient,
  name: string,
  args: Record<string, unknown>,
  timeoutMs: number,
): Promise<any> {
  logProgress(`call ${name}`);
  const response = await client.request('tools/call', { name, arguments: args }, timeoutMs);
  assertNoRpcError(response, name);
  if (response.result?.isError) {
    throw new Error(`${name} returned isError: ${JSON.stringify(response.result)}`);
  }
  const parsed = parseToolText(response);
  logProgress(`ok ${name}`);
  return parsed;
}

function createFixtureServer(): Promise<{
  server: Server;
  baseUrl: string;
}> {
  const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>MCP Chrome Real Browser Fixture</title>
  <style>
    body { font-family: system-ui, sans-serif; max-width: 840px; margin: 32px auto; }
    label, button, textarea, input, [contenteditable] { display: block; margin: 12px 0; }
    textarea, input, [contenteditable] { width: 100%; box-sizing: border-box; padding: 8px; }
    [contenteditable] { min-height: 48px; border: 1px solid #888; }
    .row { display: flex; align-items: center; gap: 16px; margin: 12px 0; }
    #hover-target, #drag-source, #drop-target {
      width: 160px;
      min-height: 48px;
      border: 1px solid #555;
      border-radius: 8px;
      display: flex;
      align-items: center;
      justify-content: center;
      user-select: none;
    }
    #hover-target { background: #eef6ff; }
    #hover-target.hovered { background: #c7e7ff; }
    #drag-source { background: #fff0c2; cursor: grab; }
    #drop-target { background: #f4f4f5; border-style: dashed; }
    #drop-target.over { background: #dcfce7; border-style: solid; }
  </style>
</head>
<body>
  <h1>MCP Chrome Real Browser Fixture</h1>
  <p id="status">ready</p>
  <div class="row">
    <div id="hover-target">Hover target</div>
    <span id="hover-status">hover pending</span>
  </div>
  <div class="row" id="drag-row">
    <div id="drag-source">Drag source</div>
    <div id="drop-target">Drop target</div>
    <span id="drag-status">drag pending</span>
  </div>
  <label>Name <input id="name" value="" placeholder="name" /></label>
  <label>Message <textarea id="message" rows="3"></textarea></label>
  <div id="editor" contenteditable="true">editable start</div>
  <textarea id="copy-source" rows="2">fixture copy text</textarea>
  <input id="paste-target" value="" placeholder="paste target" />
  <button id="async-button">Async update</button>
  <button id="console-button">Emit console logs</button>
  <a id="new-tab-link" href="/new-tab.html" target="_blank">Open new tab</a>
  <script>
    const status = document.querySelector('#status');
    const hoverTarget = document.querySelector('#hover-target');
    const hoverStatus = document.querySelector('#hover-status');
    const dragSource = document.querySelector('#drag-source');
    const dropTarget = document.querySelector('#drop-target');
    const dragStatus = document.querySelector('#drag-status');
    let dragging = false;

    const markHovered = () => {
      hoverTarget.classList.add('hovered');
      hoverTarget.dataset.hovered = 'true';
      hoverStatus.textContent = 'hovered';
    };
    hoverTarget.addEventListener('mouseenter', markHovered);
    hoverTarget.addEventListener('mousemove', markHovered);

    dragSource.addEventListener('mousedown', (event) => {
      dragging = true;
      dragSource.dataset.dragging = 'true';
      dragStatus.textContent = 'dragging';
      event.preventDefault();
    });
    document.addEventListener('mousemove', (event) => {
      if (!dragging) return;
      const target = document.elementFromPoint(event.clientX, event.clientY);
      const overDropTarget = target === dropTarget || dropTarget.contains(target);
      dropTarget.classList.toggle('over', overDropTarget);
      if (overDropTarget) dragStatus.textContent = 'drag over';
    });
    document.addEventListener('mouseup', (event) => {
      if (!dragging) return;
      dragging = false;
      dragSource.dataset.dragging = 'false';
      const target = document.elementFromPoint(event.clientX, event.clientY);
      const dropped = target === dropTarget || dropTarget.contains(target);
      dropTarget.classList.toggle('over', dropped);
      if (dropped) {
        dropTarget.dataset.dropped = 'true';
        dropTarget.textContent = 'Dropped';
        dragStatus.textContent = 'drag dropped';
      } else {
        dragStatus.textContent = 'drag missed';
      }
    });

    document.querySelector('#async-button').addEventListener('click', () => {
      status.textContent = 'waiting';
      setTimeout(() => { status.textContent = 'async done'; }, 150);
    });
    document.querySelector('#console-button').addEventListener('click', () => {
      console.log('fixture page log');
      console.error('fixture page error');
    });
  </script>
</body>
</html>`;

  const newTabHtml = `<!doctype html>
<html lang="en">
<head><meta charset="utf-8" /><title>MCP Chrome New Tab Fixture</title></head>
<body><h1>new tab ready</h1></body>
</html>`;

  const server = http.createServer((request, response) => {
    if (request.url?.startsWith('/new-tab.html')) {
      response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      response.end(newTabHtml);
      return;
    }
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    response.end(html);
  });

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address() as AddressInfo;
      resolve({ server, baseUrl: `http://127.0.0.1:${address.port}` });
    });
  });
}

async function closeServer(server: Server): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error) reject(error);
      else resolve();
    });
    // Chrome keeps fixture responses alive; force-close them after stopping new accepts.
    server.closeAllConnections();
  });
}

async function runRealBrowserSmoke(
  client: StdioMcpClient,
  timeoutMs: number,
): Promise<Record<string, unknown>> {
  const { server, baseUrl } = await createFixtureServer();
  logProgress(`real-browser fixture started at ${baseUrl}`);
  const openedTabIds = new Set<number>();
  let originalClipboard: string | null = null;
  let createdGroupId: number | null = null;

  try {
    const startUrl = `${baseUrl}/index.html`;
    const navigate = await callMcpTool(client, 'chrome_navigate', { url: startUrl }, timeoutMs);
    if (typeof navigate?.tabId !== 'number') {
      throw new Error(`chrome_navigate did not return tabId: ${JSON.stringify(navigate)}`);
    }
    const tabId = navigate.tabId;
    openedTabIds.add(tabId);

    await callMcpTool(
      client,
      'chrome_wait_for',
      { tabId, condition: { kind: 'url', value: startUrl, match: 'contains' } },
      timeoutMs,
    );
    await callMcpTool(client, 'chrome_read_page', { tabId, depth: 6 }, timeoutMs);

    const hoverResult = await callMcpTool(
      client,
      'chrome_computer',
      { tabId, action: 'hover', selector: '#hover-target' },
      timeoutMs,
    );
    if (!hoverResult?.success) {
      throw new Error(`Hover action failed: ${JSON.stringify(hoverResult)}`);
    }
    await callMcpTool(
      client,
      'chrome_wait_for',
      { tabId, condition: { kind: 'text', text: 'hovered' } },
      timeoutMs,
    );

    const dragResult = await callMcpTool(
      client,
      'chrome_computer',
      {
        tabId,
        action: 'left_click_drag',
        startSelector: '#drag-source',
        endSelector: '#drop-target',
        dragSteps: 8,
        dragDurationMs: 160,
      },
      timeoutMs,
    );
    if (!dragResult?.success) {
      throw new Error(`Drag action failed: ${JSON.stringify(dragResult)}`);
    }
    await callMcpTool(
      client,
      'chrome_wait_for',
      { tabId, condition: { kind: 'text', text: 'drag dropped' } },
      timeoutMs,
    );

    await callMcpTool(
      client,
      'chrome_fill_or_select',
      { tabId, selector: '#name', value: 'Codex Real Browser' },
      timeoutMs,
    );
    await callMcpTool(
      client,
      'chrome_fill_or_select',
      { tabId, selector: '#message', value: 'hello from stdio smoke' },
      timeoutMs,
    );

    const formState = await callMcpTool(
      client,
      'chrome_javascript',
      {
        tabId,
        code: `return {
          name: document.querySelector('#name').value,
          message: document.querySelector('#message').value
        };`,
        timeoutMs: 5000,
      },
      timeoutMs,
    );
    const formResult = JSON.parse(formState.result || '{}');
    if (
      formResult.name !== 'Codex Real Browser' ||
      formResult.message !== 'hello from stdio smoke'
    ) {
      throw new Error(`Form verification failed: ${JSON.stringify(formResult)}`);
    }

    const beforeClipboard = await callMcpTool(
      client,
      'chrome_clipboard',
      { tabId, action: 'read_text' },
      timeoutMs,
    ).catch(() => null);
    if (typeof beforeClipboard?.text === 'string') originalClipboard = beforeClipboard.text;

    const clipboardWrite = await callMcpTool(
      client,
      'chrome_clipboard',
      { tabId, action: 'write_text', text: 'mcp stdio smoke clipboard' },
      timeoutMs,
    );
    const clipboardRead = await callMcpTool(
      client,
      'chrome_clipboard',
      { tabId, action: 'read_text' },
      timeoutMs,
    );
    if (clipboardRead.text !== 'mcp stdio smoke clipboard') {
      throw new Error(`Clipboard verification failed: ${JSON.stringify(clipboardRead)}`);
    }
    await callMcpTool(
      client,
      'chrome_clipboard',
      { tabId, action: 'paste_text', selector: '#paste-target', text: 'pasted by stdio smoke' },
      timeoutMs,
    );
    const copySelection = await callMcpTool(
      client,
      'chrome_clipboard',
      { tabId, action: 'copy_selection', selector: '#copy-source' },
      timeoutMs,
    );
    if (copySelection.text !== 'fixture copy text') {
      throw new Error(`copy_selection verification failed: ${JSON.stringify(copySelection)}`);
    }

    await callMcpTool(
      client,
      'chrome_click_element',
      { tabId, selector: '#async-button' },
      timeoutMs,
    );
    await callMcpTool(
      client,
      'chrome_wait_for',
      { tabId, condition: { kind: 'text', text: 'async done' } },
      timeoutMs,
    );

    await callMcpTool(
      client,
      'chrome_click_element',
      { tabId, selector: '#console-button' },
      timeoutMs,
    );
    const evidence = await callMcpTool(
      client,
      'chrome_collect_debug_evidence',
      {
        tabId,
        includeScreenshot: false,
        includeNetworkSummary: false,
        consoleMode: 'snapshot',
        includeExtensionConsole: false,
        consoleLimit: 20,
      },
      Math.max(timeoutMs, 12000),
    );
    if (!evidence?.console || evidence.console.messageCount < 2) {
      throw new Error(`Debug evidence verification failed: ${JSON.stringify(evidence)}`);
    }

    await callMcpTool(
      client,
      'chrome_screenshot',
      {
        tabId,
        storeBase64: true,
        savePng: false,
        fullPage: false,
        maxOutputWidth: 800,
        maxOutputHeight: 600,
        quality: 0.6,
      },
      timeoutMs,
    );

    await callMcpTool(
      client,
      'chrome_click_element',
      { tabId, selector: '#new-tab-link' },
      timeoutMs,
    );
    const newTab = await callMcpTool(
      client,
      'chrome_wait_for_tab',
      {
        openerTabId: tabId,
        urlPattern: 'new-tab.html',
        includeExisting: true,
        timeoutMs,
      },
      timeoutMs,
    );
    if (typeof newTab?.tab?.tabId === 'number') openedTabIds.add(newTab.tab.tabId);

    const newTabId = newTab?.tab?.tabId;
    const groupTabIds =
      typeof newTabId === 'number' && newTab?.tab?.windowId === navigate.windowId
        ? [tabId, newTabId]
        : [tabId];
    const tabGroup = await callMcpTool(
      client,
      'chrome_tab_group',
      {
        action: 'create',
        tabIds: groupTabIds,
        title: 'stdio smoke',
        color: 'blue',
        collapsed: false,
      },
      timeoutMs,
    );
    createdGroupId = tabGroup?.group?.groupId ?? null;
    if (!tabGroup?.success || typeof createdGroupId !== 'number') {
      throw new Error(`Tab group create verification failed: ${JSON.stringify(tabGroup)}`);
    }
    const listedGroup = await callMcpTool(
      client,
      'chrome_tab_group',
      { action: 'list', groupId: createdGroupId },
      timeoutMs,
    );
    if (
      !listedGroup?.success ||
      listedGroup.groupCount !== 1 ||
      listedGroup.groups?.[0]?.title !== 'stdio smoke'
    ) {
      throw new Error(`Tab group list verification failed: ${JSON.stringify(listedGroup)}`);
    }
    await callMcpTool(
      client,
      'chrome_tab_group',
      { action: 'ungroup', groupId: createdGroupId },
      timeoutMs,
    );
    createdGroupId = null;

    return {
      baseUrl,
      tabIds: Array.from(openedTabIds),
      hover: {
        coordinates: hoverResult.coordinates,
      },
      drag: {
        start: dragResult.start,
        end: dragResult.end,
        dragSteps: dragResult.dragSteps,
        dragDurationMs: dragResult.dragDurationMs,
      },
      tabGroup: {
        groupedTabIds: groupTabIds,
      },
      clipboardTransport: clipboardWrite.clipboardTransport,
      debugEvidence: {
        messageCount: evidence.console.messageCount,
        sourceGroups: evidence.console.sourceGroups,
      },
    };
  } finally {
    logProgress('real-browser cleanup started');
    if (originalClipboard !== null) {
      await callMcpTool(
        client,
        'chrome_clipboard',
        { action: 'write_text', text: originalClipboard },
        timeoutMs,
      ).catch(() => undefined);
    }
    if (createdGroupId !== null) {
      await callMcpTool(
        client,
        'chrome_tab_group',
        { action: 'ungroup', groupId: createdGroupId },
        timeoutMs,
      ).catch(() => undefined);
    }
    if (openedTabIds.size > 0) {
      await callMcpTool(
        client,
        'chrome_close_tabs',
        { tabIds: Array.from(openedTabIds) },
        timeoutMs,
      ).catch(() => undefined);
    }
    await closeServer(server);
    logProgress('real-browser cleanup completed');
  }
}

async function run() {
  const options = parseArgs(process.argv.slice(2));
  verboseLogging = options.verbose;
  const client = new StdioMcpClient(options.serverPath, options.profile);

  try {
    const init = await client.request(
      'initialize',
      {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: 'mcp-chrome-community-stdio-smoke', version: '0.0.0' },
      },
      options.timeoutMs,
    );
    assertNoRpcError(init, 'initialize');
    client.notify('notifications/initialized');

    const toolsResponse = await client.request('tools/list', {}, options.timeoutMs);
    assertNoRpcError(toolsResponse, 'tools/list');

    const tools = toolsResponse.result?.tools || [];
    const toolNames = tools.map((tool: { name?: string }) => tool.name).filter(Boolean);
    const missingTools = options.requiredTools.filter((name) => !toolNames.includes(name));
    if (missingTools.length > 0) {
      throw new Error(`Missing required tools: ${missingTools.join(', ')}`);
    }

    let profileCatalog: any = null;
    if (options.profile !== 'full') {
      const searchResult = await callMcpTool(
        client,
        'chrome_search_tools',
        { query: 'gif recorder', limit: 5 },
        options.timeoutMs,
      );
      const gifResult = searchResult?.results?.find(
        (item: { name?: string }) => item.name === 'chrome_gif_recorder',
      );
      if (!gifResult) {
        throw new Error(`chrome_search_tools did not find chrome_gif_recorder`);
      }

      const describeResult = await callMcpTool(
        client,
        'chrome_describe_tool',
        { name: 'chrome_gif_recorder' },
        options.timeoutMs,
      );
      if (describeResult?.tool?.name !== 'chrome_gif_recorder') {
        throw new Error(`chrome_describe_tool returned an unexpected payload`);
      }

      profileCatalog = {
        searchResult: gifResult,
        describedTool: describeResult.tool.name,
      };
    }

    let health: any = null;
    let compatibility: Record<string, unknown> | null = null;
    if (options.callHealth) {
      const directHealthResponse = await client.request(
        'tools/call',
        { name: 'chrome_health', arguments: {} },
        options.timeoutMs,
      );
      assertNoRpcError(directHealthResponse, 'chrome_health');
      if (directHealthResponse.result?.isError) {
        throw new Error(
          `chrome_health returned isError: ${JSON.stringify(directHealthResponse.result)}`,
        );
      }
      health = parseToolText(directHealthResponse);
      if (!health?.success) {
        throw new Error(`chrome_health returned unexpected payload: ${JSON.stringify(health)}`);
      }
      if (health.stdio?.profile !== options.profile) {
        throw new Error(
          `chrome_health reported unexpected STDIO profile: ${JSON.stringify(health.stdio)}`,
        );
      }
      compatibility = {
        legacyJsonRpc: {
          protocolVersion: '2024-11-05',
          ...verifyStructuredCompatibility(
            directHealthResponse.result,
            'Legacy JSON-RPC chrome_health',
          ),
        },
        modernSdk: await verifyModernSdkCompatibility(options),
      };
    }

    const realBrowser = options.realBrowser
      ? await runRealBrowserSmoke(client, Math.max(options.timeoutMs, 12000))
      : null;

    console.log(
      JSON.stringify(
        {
          success: true,
          checked: {
            serverPath: options.serverPath,
            profile: options.profile,
            toolCount: toolNames.length,
            requiredTools: options.requiredTools,
            callHealth: options.callHealth,
            realBrowser: options.realBrowser,
            compatibilityMatrix: compatibility !== null,
          },
          health: health
            ? {
                extension: health.extension,
                bridge: health.bridge,
                schema: {
                  toolCount: health.schema?.toolCount,
                  schemaHash: health.schema?.schemaHash,
                },
                browser: health.browser,
                nativeHost: health.nativeHost,
                stdio: health.stdio,
              }
            : null,
          profileCatalog,
          compatibility,
          realBrowser,
        },
        null,
        2,
      ),
    );
  } finally {
    client.close();
  }
}

run().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
