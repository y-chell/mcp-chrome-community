import { beforeEach, describe, expect, jest, test } from '@jest/globals';
import { NativeMessageType, TOOL_SCHEMAS } from 'chrome-mcp-shared';
import nativeMessagingHostInstance from '../native-messaging-host';
import { setupTools } from './register-tools';

jest.mock('../native-messaging-host', () => ({
  __esModule: true,
  default: {
    sendRequestToExtensionAndWait: jest.fn(),
  },
}));

type RequestHandler = (request?: any, extra?: any) => Promise<any>;

const sendRequest = nativeMessagingHostInstance.sendRequestToExtensionAndWait as jest.Mock;

function createServerHarness() {
  const handlers: RequestHandler[] = [];
  const server = {
    registerCapabilities: jest.fn(),
    setRequestHandler: jest.fn((_schema: unknown, handler: RequestHandler) => {
      handlers.push(handler);
    }),
    sendToolListChanged: jest.fn(async () => undefined),
  };

  setupTools(server as any);

  expect(server.registerCapabilities).toHaveBeenCalledWith({ tools: { listChanged: true } });

  return {
    server,
    listTools: handlers[0],
    callTool: handlers[1],
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

async function flushBackgroundWork() {
  await new Promise<void>((resolve) => setImmediate(resolve));
}

function publishedFlow(id: string, slug: string, description = 'Recorded flow') {
  return {
    id,
    slug,
    description,
    variables: [],
  };
}

beforeEach(() => {
  sendRequest.mockReset();
});

describe('structured tool results', () => {
  test('adds structuredContent for a successful JSON object without changing content', async () => {
    const content = [{ type: 'text', text: '{"ok":true,"count":2}' }];
    sendRequest.mockResolvedValueOnce({ status: 'success', data: { content } });
    const { callTool } = createServerHarness();

    const result = await callTool(
      { params: { name: 'chrome_get_web_content', arguments: {} } },
      {},
    );

    expect(result.content).toEqual(content);
    expect(result.structuredContent).toEqual({ ok: true, count: 2 });
  });

  test('preserves extension-provided structuredContent without reparsing legacy text', async () => {
    const content = [{ type: 'text', text: '{"ok":false,"source":"content"}' }];
    sendRequest.mockResolvedValueOnce({
      status: 'success',
      data: { content, structuredContent: { ok: true, source: 'extension' } },
    });
    const { callTool } = createServerHarness();

    const result = await callTool(
      { params: { name: 'chrome_get_web_content', arguments: {} } },
      {},
    );

    expect(result.content).toEqual(content);
    expect(result.structuredContent).toEqual({ ok: true, source: 'extension' });
  });

  test.each([
    ['array', '[1,2]'],
    ['number', '42'],
    ['null', 'null'],
    ['plain text', 'not json'],
  ])('does not add structuredContent for %s text', async (_label, text) => {
    sendRequest.mockResolvedValueOnce({
      status: 'success',
      data: { content: [{ type: 'text', text }] },
    });
    const { callTool } = createServerHarness();

    const result = await callTool(
      { params: { name: 'chrome_get_web_content', arguments: {} } },
      {},
    );

    expect(result).not.toHaveProperty('structuredContent');
  });

  test('does not add structuredContent to error results', async () => {
    const data = {
      content: [{ type: 'text', text: '{"error":"failed"}' }],
      isError: true,
    };
    sendRequest.mockResolvedValueOnce({ status: 'success', data });
    const { callTool } = createServerHarness();

    const result = await callTool(
      { params: { name: 'chrome_get_web_content', arguments: {} } },
      {},
    );

    expect(result).toEqual(data);
  });

  test('keeps health text and structuredContent metadata in sync', async () => {
    sendRequest.mockResolvedValueOnce({
      status: 'success',
      data: {
        content: [{ type: 'text', text: '{"status":"ok"}' }],
        structuredContent: { status: 'stale' },
      },
    });
    const { callTool } = createServerHarness();

    const result = await callTool(
      { params: { name: 'chrome_health', arguments: {} } },
      { sessionId: 'session-1', requestId: 7 },
    );
    const parsedText = JSON.parse(result.content[0].text);

    expect(result.structuredContent).toEqual(parsedText);
    expect(result.structuredContent).toMatchObject({
      status: 'stale',
      bridge: { sessionId: 'session-1', requestId: '7' },
    });
  });
});

describe('dynamic flow directory', () => {
  test('lists immediately and coalesces concurrent background refreshes', async () => {
    const pendingDirectory = deferred<any>();
    sendRequest.mockReturnValueOnce(pendingDirectory.promise);
    const { listTools, server } = createServerHarness();

    const first = await listTools();
    const second = await listTools();

    expect(first.tools).toHaveLength(TOOL_SCHEMAS.length);
    expect(second.tools).toHaveLength(TOOL_SCHEMAS.length);
    expect(sendRequest).toHaveBeenCalledTimes(1);

    pendingDirectory.resolve({ status: 'success', items: [publishedFlow('flow-1', 'checkout')] });
    await flushBackgroundWork();

    expect(server.sendToolListChanged).toHaveBeenCalledTimes(1);

    const refreshed = await listTools();
    const flowTool = refreshed.tools.find((tool: any) => tool.name === 'flow.checkout');
    expect(flowTool).toMatchObject({
      inputSchema: { additionalProperties: false },
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: true,
      },
    });
  });

  test('skips malformed and duplicate flow directory entries', async () => {
    sendRequest.mockResolvedValueOnce({
      status: 'success',
      items: [
        null,
        {},
        publishedFlow('flow-1', ''),
        publishedFlow('flow-1', 'checkout'),
        publishedFlow('flow-2', 'checkout'),
        {
          ...publishedFlow('flow-3', 'login'),
          variables: [null, {}, { key: 'email', type: 'string', rules: { required: true } }],
        },
      ],
    });
    const { listTools } = createServerHarness();

    await listTools();
    await flushBackgroundWork();
    const result = await listTools();

    const dynamicTools = result.tools.filter((tool: any) => tool.name.startsWith('flow.'));
    expect(dynamicTools.map((tool: any) => tool.name)).toEqual(['flow.checkout', 'flow.login']);
    expect(dynamicTools[1]).toMatchObject({
      inputSchema: {
        required: ['email'],
        properties: { email: { type: 'string' } },
      },
    });
  });

  test('retains the last successful cache when refresh fails', async () => {
    sendRequest.mockResolvedValueOnce({
      status: 'success',
      items: [publishedFlow('flow-1', 'checkout')],
    });
    const { listTools } = createServerHarness();

    await listTools();
    await flushBackgroundWork();

    sendRequest.mockRejectedValueOnce(new Error('extension unavailable'));
    const cached = await listTools();
    await flushBackgroundWork();
    sendRequest.mockRejectedValueOnce(new Error('extension still unavailable'));
    const afterFailure = await listTools();
    await flushBackgroundWork();

    expect(cached.tools.map((tool: any) => tool.name)).toContain('flow.checkout');
    expect(afterFailure.tools.map((tool: any) => tool.name)).toContain('flow.checkout');
  });

  test('notifies only when the successful directory actually changes', async () => {
    const checkout = publishedFlow('flow-1', 'checkout');
    sendRequest
      .mockResolvedValueOnce({ status: 'success', items: [checkout] })
      .mockResolvedValueOnce({ status: 'success', items: [checkout] })
      .mockResolvedValueOnce({
        status: 'success',
        items: [checkout, publishedFlow('flow-2', 'login')],
      });
    const { listTools, server } = createServerHarness();

    await listTools();
    await flushBackgroundWork();
    expect(server.sendToolListChanged).toHaveBeenCalledTimes(1);

    await listTools();
    await flushBackgroundWork();
    expect(server.sendToolListChanged).toHaveBeenCalledTimes(1);

    await listTools();
    await flushBackgroundWork();
    expect(server.sendToolListChanged).toHaveBeenCalledTimes(2);
  });

  test('uses the cached flow id for dynamic calls without relisting', async () => {
    sendRequest.mockResolvedValueOnce({
      status: 'success',
      items: [publishedFlow('flow-1', 'checkout')],
    });
    const { listTools, callTool } = createServerHarness();
    await listTools();
    await flushBackgroundWork();

    sendRequest.mockResolvedValueOnce({
      status: 'success',
      data: { content: [{ type: 'text', text: '{"run":true}' }] },
    });
    const result = await callTool(
      { params: { name: 'flow.checkout', arguments: { email: 'a@example.test' } } },
      {},
    );

    expect(sendRequest).toHaveBeenCalledTimes(2);
    expect(sendRequest).toHaveBeenLastCalledWith(
      {
        name: 'record_replay_flow_run',
        args: { flowId: 'flow-1', args: { email: 'a@example.test' } },
        context: {},
      },
      NativeMessageType.CALL_TOOL,
      120000,
      { signal: undefined, reportProgress: undefined, onProgress: undefined },
    );
    expect(result.structuredContent).toEqual({ run: true });
  });

  test('performs one controlled refresh when a dynamic call is not cached', async () => {
    sendRequest
      .mockResolvedValueOnce({
        status: 'success',
        items: [publishedFlow('flow-1', 'checkout')],
      })
      .mockResolvedValueOnce({
        status: 'success',
        data: { content: [{ type: 'text', text: 'completed' }] },
      });
    const { callTool } = createServerHarness();

    const result = await callTool(
      { params: { name: 'flow.checkout', arguments: { retry: false } } },
      {},
    );

    expect(sendRequest).toHaveBeenNthCalledWith(1, {}, 'rr_list_published_flows', 20000);
    expect(sendRequest).toHaveBeenNthCalledWith(
      2,
      {
        name: 'record_replay_flow_run',
        args: { flowId: 'flow-1', args: { retry: false } },
        context: {},
      },
      NativeMessageType.CALL_TOOL,
      120000,
      { signal: undefined, reportProgress: undefined, onProgress: undefined },
    );
    expect(result.content).toEqual([{ type: 'text', text: 'completed' }]);
  });

  test('preserves extension errors while resolving an uncached dynamic flow', async () => {
    sendRequest.mockRejectedValueOnce(new Error('native messaging disconnected'));
    const { callTool } = createServerHarness();

    const result = await callTool({ params: { name: 'flow.checkout', arguments: {} } }, {});

    expect(result).toEqual({
      content: [
        {
          type: 'text',
          text: 'Error resolving dynamic flow tool: native messaging disconnected',
        },
      ],
      isError: true,
    });
  });
});

describe('tool cancellation and progress forwarding', () => {
  test('passes the MCP abort signal to the native messaging request', async () => {
    sendRequest.mockResolvedValueOnce({
      status: 'success',
      data: { content: [{ type: 'text', text: 'done' }] },
    });
    const { callTool } = createServerHarness();
    const controller = new AbortController();

    await callTool(
      { params: { name: 'chrome_wait_for', arguments: {} } },
      { signal: controller.signal },
    );

    expect(sendRequest).toHaveBeenCalledWith(
      expect.any(Object),
      NativeMessageType.CALL_TOOL,
      120000,
      expect.objectContaining({ signal: controller.signal }),
    );
  });

  test('normalizes extension progress and forwards the outer progress token', async () => {
    const sendNotification = jest.fn(async () => undefined);
    sendRequest.mockImplementationOnce(async (_payload, _type, _timeout, options) => {
      await options.onProgress({ progress: 1, total: 4, message: 'Quarter complete' });
      return {
        status: 'success',
        data: { content: [{ type: 'text', text: 'done' }] },
      };
    });
    const { callTool } = createServerHarness();

    const result = await callTool(
      { params: { name: 'chrome_wait_for', arguments: {} } },
      { _meta: { progressToken: 'outer-token' }, sendNotification },
    );

    expect(result.isError).not.toBe(true);
    expect(sendNotification.mock.calls.map(([notification]) => notification)).toEqual([
      {
        method: 'notifications/progress',
        params: {
          progressToken: 'outer-token',
          progress: 0,
          total: 100,
          message: 'Dispatching browser tool',
        },
      },
      {
        method: 'notifications/progress',
        params: {
          progressToken: 'outer-token',
          progress: 25,
          total: 100,
          message: 'Quarter complete',
        },
      },
      {
        method: 'notifications/progress',
        params: {
          progressToken: 'outer-token',
          progress: 100,
          total: 100,
          message: 'Browser tool completed',
        },
      },
    ]);
  });

  test('does not fail a tool call when progress notifications fail', async () => {
    const sendNotification = jest.fn(async () => {
      throw new Error('client disconnected');
    });
    sendRequest.mockImplementationOnce(async (_payload, _type, _timeout, options) => {
      await options.onProgress({ progress: 50, total: 100 });
      return {
        status: 'success',
        data: { content: [{ type: 'text', text: 'done' }] },
      };
    });
    const { callTool } = createServerHarness();

    const result = await callTool(
      { params: { name: 'chrome_wait_for', arguments: {} } },
      { _meta: { progressToken: 9 }, sendNotification },
    );

    expect(result).toEqual({ content: [{ type: 'text', text: 'done' }] });
    expect(sendNotification).toHaveBeenCalledTimes(3);
  });
});
