import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import http, { type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import path from 'node:path';

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
  callHealth: boolean;
  realBrowser: boolean;
  requiredTools: string[];
};

const DEFAULT_REQUIRED_TOOLS = [
  'chrome_health',
  'chrome_navigate',
  'chrome_read_page',
  'chrome_fill_or_select',
  'chrome_click_element',
  'chrome_javascript',
  'chrome_clipboard',
  'chrome_collect_debug_evidence',
  'chrome_wait_for',
  'chrome_wait_for_tab',
  'chrome_screenshot',
  'chrome_close_tabs',
];

function parseArgs(argv: string[]): SmokeOptions {
  const defaultServerPath = path.resolve(__dirname, '..', 'mcp', 'mcp-server-stdio.js');
  const options: SmokeOptions = {
    serverPath: defaultServerPath,
    timeoutMs: 10000,
    callHealth: false,
    realBrowser: false,
    requiredTools: [...DEFAULT_REQUIRED_TOOLS],
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--server') {
      const value = argv[index + 1];
      if (!value) throw new Error('--server requires a path');
      options.serverPath = path.resolve(value);
      index += 1;
    } else if (arg === '--timeout-ms') {
      const value = Number(argv[index + 1]);
      if (!Number.isFinite(value) || value <= 0) throw new Error('--timeout-ms must be positive');
      options.timeoutMs = value;
      index += 1;
    } else if (arg === '--call-health') {
      options.callHealth = true;
    } else if (arg === '--real-browser') {
      options.realBrowser = true;
      options.callHealth = true;
    } else if (arg === '--require-tools') {
      const value = argv[index + 1];
      if (!value) throw new Error('--require-tools requires a comma-separated list');
      options.requiredTools = value
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean);
      index += 1;
    } else if (arg === '--help' || arg === '-h') {
      printHelp();
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return options;
}

function printHelp() {
  console.log(`Usage: node dist/scripts/mcp-stdio-smoke.js [options]

Options:
  --server <path>          Path to mcp-server-stdio.js. Defaults to built dist server.
  --timeout-ms <ms>        Per-request timeout. Default: 10000.
  --require-tools <list>   Comma-separated tool names required in tools/list.
  --call-health            Also call chrome_health through the real extension/native bridge.
  --real-browser           Run a reversible real-browser fixture flow through MCP tools.
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

  constructor(serverPath: string) {
    this.child = spawn(process.execPath, [serverPath], {
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    });

    this.child.stdout.on('data', (chunk: Buffer) => {
      this.stdoutBuffer += chunk.toString('utf8');
      this.drainStdout();
    });

    this.child.stderr.on('data', (chunk: Buffer) => {
      this.stderr += chunk.toString('utf8');
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
    this.child.kill();
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

async function callMcpTool(
  client: StdioMcpClient,
  name: string,
  args: Record<string, unknown>,
  timeoutMs: number,
): Promise<any> {
  const response = await client.request('tools/call', { name, arguments: args }, timeoutMs);
  assertNoRpcError(response, name);
  if (response.result?.isError) {
    throw new Error(`${name} returned isError: ${JSON.stringify(response.result)}`);
  }
  return parseToolText(response);
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
  </style>
</head>
<body>
  <h1>MCP Chrome Real Browser Fixture</h1>
  <p id="status">ready</p>
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
  await new Promise<void>((resolve) => {
    server.close(() => resolve());
  });
}

async function runRealBrowserSmoke(
  client: StdioMcpClient,
  timeoutMs: number,
): Promise<Record<string, unknown>> {
  const { server, baseUrl } = await createFixtureServer();
  const openedTabIds = new Set<number>();
  let originalClipboard: string | null = null;

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

    return {
      baseUrl,
      tabIds: Array.from(openedTabIds),
      clipboardTransport: clipboardWrite.clipboardTransport,
      debugEvidence: {
        messageCount: evidence.console.messageCount,
        sourceGroups: evidence.console.sourceGroups,
      },
    };
  } finally {
    if (originalClipboard !== null) {
      await callMcpTool(
        client,
        'chrome_clipboard',
        { action: 'write_text', text: originalClipboard },
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
  }
}

async function run() {
  const options = parseArgs(process.argv.slice(2));
  const client = new StdioMcpClient(options.serverPath);

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

    let health: any = null;
    if (options.callHealth) {
      health = await callMcpTool(client, 'chrome_health', {}, options.timeoutMs);
      if (!health?.success) {
        throw new Error(`chrome_health returned unexpected payload: ${JSON.stringify(health)}`);
      }
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
            toolCount: toolNames.length,
            requiredTools: options.requiredTools,
            callHealth: options.callHealth,
            realBrowser: options.realBrowser,
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
              }
            : null,
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
