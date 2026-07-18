import { describe, expect, test, afterAll, beforeAll } from '@jest/globals';
import supertest from 'supertest';
import { LATEST_PROTOCOL_VERSION } from '@modelcontextprotocol/sdk/types.js';
import { Server } from './index';

describe('服务器测试', () => {
  const server = new Server();

  // 启动服务器测试实例
  beforeAll(async () => {
    await server.getInstance().ready();
  });

  // 关闭服务器
  afterAll(async () => {
    await server.getInstance().close();
  });

  test('GET /ping 应返回正确响应', async () => {
    const response = await supertest(server.getInstance().server)
      .get('/ping')
      .expect(200)
      .expect('Content-Type', /json/);

    expect(response.body).toEqual({
      status: 'ok',
      message: 'pong',
    });
  });

  test('MCP 路由应拒绝 Host 和 Origin 前缀绕过', async () => {
    const invalidHost = await supertest(server.getInstance().server)
      .post('/mcp')
      .set('Host', 'localhost.evil.test')
      .send({ jsonrpc: '2.0', id: 1, method: 'ping' })
      .expect(403);
    const invalidOrigin = await supertest(server.getInstance().server)
      .post('/mcp')
      .set('Origin', 'chrome-extension://hbdgbgagpkpjffpklnamcljpakneikee.evil')
      .send({ jsonrpc: '2.0', id: 1, method: 'ping' })
      .expect(403);

    expect(invalidHost.body.error.message).toBe('Forbidden Host');
    expect(invalidOrigin.body.error.message).toBe('Forbidden Origin');
  });

  test('POST /mcp 应区分非法、未知和缺失的 session ID', async () => {
    await supertest(server.getInstance().server)
      .post('/mcp')
      .set('Mcp-Session-Id', 'contains whitespace')
      .send(createInitializeRequest())
      .expect(400);

    await supertest(server.getInstance().server)
      .post('/mcp')
      .set('Mcp-Session-Id', 'unknown-session')
      .send({ jsonrpc: '2.0', id: 2, method: 'ping' })
      .expect(404);
  });

  test('POST /mcp initialize 应返回 session 并避免重复写响应', async () => {
    const response = await supertest(server.getInstance().server)
      .post('/mcp')
      .set('Accept', 'application/json, text/event-stream')
      .set('Content-Type', 'application/json')
      .send(createInitializeRequest())
      .expect(200)
      .expect('Content-Type', /text\/event-stream/);

    const sessionId = response.headers['mcp-session-id'];
    expect(sessionId).toBeTruthy();
    expect(response.text).toContain('event: message');
    expect(response.text).toContain('"jsonrpc":"2.0"');
    expect(response.text).toContain('"protocolVersion"');

    await supertest(server.getInstance().server)
      .delete('/mcp')
      .set('Mcp-Session-Id', sessionId)
      .expect(200);
    await supertest(server.getInstance().server)
      .post('/mcp')
      .set('Mcp-Session-Id', sessionId)
      .send({ jsonrpc: '2.0', id: 2, method: 'ping' })
      .expect(404);
  });
});

test('非回环监听器应只向远程来源开放 MCP 传输路由', async () => {
  const previousEnv = {
    bindHost: process.env.CHROME_MCP_BIND_HOST,
    authToken: process.env.CHROME_MCP_AUTH_TOKEN,
    allowedHosts: process.env.CHROME_MCP_ALLOWED_HOSTS,
  };
  process.env.CHROME_MCP_BIND_HOST = '0.0.0.0';
  process.env.CHROME_MCP_AUTH_TOKEN = '0123456789abcdef';
  process.env.CHROME_MCP_ALLOWED_HOSTS = '192.0.2.10';

  let remoteServer: Server | undefined;
  try {
    remoteServer = new Server();
    await remoteServer.getInstance().ready();

    const nonMcpResponse = await remoteServer.getInstance().inject({
      method: 'GET',
      url: '/ping',
      remoteAddress: '192.0.2.20',
    });
    expect(nonMcpResponse.statusCode).toBe(403);
    expect(nonMcpResponse.json()).toEqual({
      error: 'Non-MCP HTTP routes are only available from the local machine.',
    });

    const mcpResponse = await remoteServer.getInstance().inject({
      method: 'POST',
      url: '/mcp',
      headers: {
        host: '192.0.2.10:12306',
        'content-type': 'application/json',
      },
      payload: { jsonrpc: '2.0', id: 1, method: 'ping' },
      remoteAddress: '192.0.2.20',
    });
    expect(mcpResponse.statusCode).toBe(401);

    const localResponse = await remoteServer.getInstance().inject({
      method: 'GET',
      url: '/ping',
      remoteAddress: '127.0.0.1',
    });
    expect(localResponse.statusCode).toBe(200);
  } finally {
    if (remoteServer) {
      await remoteServer.getInstance().close();
    }
    restoreEnv('CHROME_MCP_BIND_HOST', previousEnv.bindHost);
    restoreEnv('CHROME_MCP_AUTH_TOKEN', previousEnv.authToken);
    restoreEnv('CHROME_MCP_ALLOWED_HOSTS', previousEnv.allowedHosts);
  }
});

function createInitializeRequest() {
  return {
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: {
      protocolVersion: LATEST_PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: {
        name: 'jest-client',
        version: '1.0.0',
      },
    },
  };
}

function restoreEnv(name: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[name];
    return;
  }
  process.env[name] = value;
}
