import { describe, expect, test, afterAll, beforeAll } from '@jest/globals';
import supertest from 'supertest';
import { LATEST_PROTOCOL_VERSION } from '@modelcontextprotocol/sdk/types.js';
import Server from './index';

describe('服务器测试', () => {
  // 启动服务器测试实例
  beforeAll(async () => {
    await Server.getInstance().ready();
  });

  // 关闭服务器
  afterAll(async () => {
    await Server.stop();
  });

  test('GET /ping 应返回正确响应', async () => {
    const response = await supertest(Server.getInstance().server)
      .get('/ping')
      .expect(200)
      .expect('Content-Type', /json/);

    expect(response.body).toEqual({
      status: 'ok',
      message: 'pong',
    });
  });

  test('POST /mcp initialize 应返回 session 并避免重复写响应', async () => {
    const response = await supertest(Server.getInstance().server)
      .post('/mcp')
      .set('Accept', 'application/json, text/event-stream')
      .set('Content-Type', 'application/json')
      .send({
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
      })
      .expect(200)
      .expect('Content-Type', /text\/event-stream/);

    expect(response.headers['mcp-session-id']).toBeTruthy();
    expect(response.text).toContain('event: message');
    expect(response.text).toContain('"jsonrpc":"2.0"');
    expect(response.text).toContain('"protocolVersion"');
  });
});
