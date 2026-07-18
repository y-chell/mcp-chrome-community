/**
 * HTTP Server - Core server implementation.
 *
 * Responsibilities:
 * - Fastify instance management
 * - Plugin registration (CORS, etc.)
 * - Route delegation to specialized modules
 * - MCP transport handling
 * - Server lifecycle management
 */
import Fastify, { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import cors from '@fastify/cors';
import {
  NATIVE_SERVER_PORT,
  TIMEOUTS,
  SERVER_CONFIG,
  HTTP_STATUS,
  ERROR_MESSAGES,
  getChromeMcpBindHost,
} from '../constant';
import { NativeMessagingHost } from '../native-messaging-host';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { randomUUID } from 'node:crypto';
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js';
import { createMcpServer } from '../mcp/mcp-server';
import { AgentStreamManager } from '../agent/stream-manager';
import { AgentChatService } from '../agent/chat-service';
import { CodexEngine } from '../agent/engines/codex';
import { ClaudeEngine } from '../agent/engines/claude';
import { closeDb } from '../agent/db';
import { registerAgentRoutes } from './routes';
import {
  createMcpHttpSecurityGuard,
  isLoopbackRemoteAddress,
  isMcpTransportPath,
  parseMcpHttpSecurityConfig,
  type McpHttpSecurityConfig,
  type McpHttpSecurityGuard,
} from './mcp-http-security';
import {
  McpSessionCapacityError,
  McpSessionRegistry,
  type McpSessionTransportMap,
} from './mcp-session-registry';

// ============================================================
// Types
// ============================================================

interface ExtensionRequestPayload {
  data?: unknown;
}

interface ServerMcpTransports extends McpSessionTransportMap {
  'streamable-http': StreamableHTTPServerTransport;
  sse: SSEServerTransport;
}

const MCP_SESSION_SWEEP_INTERVAL_MS = 60_000;

function readPositiveIntegerEnv(name: string, fallback: number): number {
  const raw = process.env[name]?.trim();
  if (!raw) {
    return fallback;
  }
  if (!/^\d+$/.test(raw)) {
    throw new Error(`${name} must be a positive integer.`);
  }
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer.`);
  }
  return value;
}

function getSingleHeader(value: string | string[] | undefined): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function getMcpSessionId(request: FastifyRequest): string | undefined {
  const sessionId = getSingleHeader(request.headers['mcp-session-id']);
  return sessionId && /^[\x21-\x7e]{1,128}$/.test(sessionId) ? sessionId : undefined;
}

// ============================================================
// Server Class
// ============================================================

export class Server {
  private fastify: FastifyInstance;
  public isRunning = false;
  private nativeHost: NativeMessagingHost | null = null;
  private readonly mcpSecurityConfig: McpHttpSecurityConfig;
  private readonly mcpSecurityGuard: McpHttpSecurityGuard;
  private readonly mcpSessions: McpSessionRegistry<ServerMcpTransports>;
  private mcpSessionSweepTimer: NodeJS.Timeout | null = null;
  private mcpSessionSweepInProgress = false;
  private agentStreamManager: AgentStreamManager;
  private agentChatService: AgentChatService;

  constructor() {
    this.fastify = Fastify({ logger: SERVER_CONFIG.LOGGER_ENABLED });
    this.mcpSecurityConfig = parseMcpHttpSecurityConfig({ listenHost: getChromeMcpBindHost() });
    this.mcpSecurityGuard = createMcpHttpSecurityGuard(this.mcpSecurityConfig);
    this.mcpSessions = new McpSessionRegistry<ServerMcpTransports>({
      maxSessions: readPositiveIntegerEnv('CHROME_MCP_MAX_SESSIONS', 64),
      idleTtlMs: readPositiveIntegerEnv('CHROME_MCP_SESSION_IDLE_TTL_MS', 30 * 60 * 1000),
    });
    this.agentStreamManager = new AgentStreamManager();
    this.agentChatService = new AgentChatService({
      engines: [new CodexEngine(), new ClaudeEngine()],
      streamManager: this.agentStreamManager,
    });
    this.setupPlugins();
    this.setupRoutes();
  }

  /**
   * Associate NativeMessagingHost instance.
   */
  public setNativeHost(nativeHost: NativeMessagingHost): void {
    this.nativeHost = nativeHost;
  }

  private setupPlugins(): void {
    this.fastify.addHook('onRequest', async (request, reply) => {
      if (
        this.mcpSecurityConfig.isLoopbackListener ||
        isMcpTransportPath(request.raw.url ?? request.url) ||
        isLoopbackRemoteAddress(request.socket.remoteAddress)
      ) {
        return;
      }

      reply.code(HTTP_STATUS.FORBIDDEN).send({
        error: 'Non-MCP HTTP routes are only available from the local machine.',
      });
    });

    this.fastify.register(cors, {
      origin: (origin, cb) => {
        // Allow requests with no origin (e.g., curl, server-to-server)
        if (!origin) {
          return cb(null, true);
        }
        cb(null, this.mcpSecurityConfig.allowedOrigins.has(origin));
      },
      methods: ['GET', 'POST', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Authorization', 'Content-Type', 'Mcp-Session-Id', 'Last-Event-ID'],
      exposedHeaders: ['Mcp-Session-Id'],
      credentials: true,
    });
  }

  private setupRoutes(): void {
    // Health check
    this.setupHealthRoutes();

    // Extension communication
    this.setupExtensionRoutes();

    // Agent routes (delegated to separate module)
    registerAgentRoutes(this.fastify, {
      streamManager: this.agentStreamManager,
      chatService: this.agentChatService,
    });

    // MCP routes
    this.setupMcpRoutes();
  }

  private sendRawJson(reply: FastifyReply, statusCode: number, payload: unknown): void {
    if (reply.raw.destroyed || reply.raw.writableEnded) {
      return;
    }

    reply.raw.statusCode = statusCode;

    if (!reply.raw.headersSent) {
      reply.raw.setHeader('Content-Type', 'application/json; charset=utf-8');
    }

    reply.raw.end(JSON.stringify(payload));
  }

  private sendRawText(reply: FastifyReply, statusCode: number, payload: string): void {
    if (reply.raw.destroyed || reply.raw.writableEnded) {
      return;
    }

    reply.raw.statusCode = statusCode;

    if (!reply.raw.headersSent) {
      reply.raw.setHeader('Content-Type', 'text/plain; charset=utf-8');
    }

    reply.raw.end(payload);
  }

  // ============================================================
  // Health Routes
  // ============================================================

  private setupHealthRoutes(): void {
    this.fastify.get('/ping', async (_request: FastifyRequest, reply: FastifyReply) => {
      reply.status(HTTP_STATUS.OK).send({
        status: 'ok',
        message: 'pong',
      });
    });
  }

  // ============================================================
  // Extension Routes
  // ============================================================

  private setupExtensionRoutes(): void {
    this.fastify.get(
      '/ask-extension',
      async (request: FastifyRequest<{ Body: ExtensionRequestPayload }>, reply: FastifyReply) => {
        if (!this.nativeHost) {
          return reply
            .status(HTTP_STATUS.INTERNAL_SERVER_ERROR)
            .send({ error: ERROR_MESSAGES.NATIVE_HOST_NOT_AVAILABLE });
        }
        if (!this.isRunning) {
          return reply
            .status(HTTP_STATUS.INTERNAL_SERVER_ERROR)
            .send({ error: ERROR_MESSAGES.SERVER_NOT_RUNNING });
        }

        try {
          const extensionResponse = await this.nativeHost.sendRequestToExtensionAndWait(
            request.query,
            'process_data',
            TIMEOUTS.EXTENSION_REQUEST_TIMEOUT,
          );
          return reply.status(HTTP_STATUS.OK).send({ status: 'success', data: extensionResponse });
        } catch (error: unknown) {
          const err = error as Error;
          if (err.message.includes('timed out')) {
            return reply
              .status(HTTP_STATUS.GATEWAY_TIMEOUT)
              .send({ status: 'error', message: ERROR_MESSAGES.REQUEST_TIMEOUT });
          } else {
            return reply.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).send({
              status: 'error',
              message: `Failed to get response from extension: ${err.message}`,
            });
          }
        }
      },
    );
  }

  // ============================================================
  // MCP Routes
  // ============================================================

  private setupMcpRoutes(): void {
    // SSE endpoint
    this.fastify.get('/sse', { preHandler: this.mcpSecurityGuard }, async (_, reply) => {
      if (!this.mcpSessions.canAcceptNewSession()) {
        reply.code(HTTP_STATUS.TOO_MANY_REQUESTS).send({
          error: ERROR_MESSAGES.MCP_SESSION_LIMIT_REACHED,
        });
        return;
      }

      let transport: SSEServerTransport | undefined;
      try {
        reply.hijack();

        transport = new SSEServerTransport('/messages', reply.raw);
        this.mcpSessions.register(transport.sessionId, 'sse', transport);

        const removeSession = () => {
          void this.mcpSessions.remove(transport!.sessionId, 'sse');
        };
        transport.onclose = removeSession;
        reply.raw.once('close', removeSession);

        const server = createMcpServer({
          sessionId: transport.sessionId,
          transport: 'sse',
        });
        await server.connect(transport);
      } catch (error) {
        if (transport) {
          await this.mcpSessions
            .remove(transport.sessionId, 'sse', { closeTransport: true })
            .catch(() => undefined);
        }
        this.sendRawText(
          reply,
          HTTP_STATUS.INTERNAL_SERVER_ERROR,
          ERROR_MESSAGES.INTERNAL_SERVER_ERROR,
        );
      }
    });

    // SSE messages endpoint
    this.fastify.post('/messages', { preHandler: this.mcpSecurityGuard }, async (req, reply) => {
      try {
        const { sessionId } = req.query as { sessionId?: unknown };
        const normalizedSessionId =
          typeof sessionId === 'string' && /^[\x21-\x7e]{1,128}$/.test(sessionId)
            ? sessionId
            : undefined;
        const session = normalizedSessionId
          ? this.mcpSessions.get(normalizedSessionId, 'sse')
          : undefined;
        if (!normalizedSessionId || !session) {
          reply.code(HTTP_STATUS.BAD_REQUEST).send('No transport found for sessionId');
          return;
        }

        this.mcpSessions.touch(normalizedSessionId, 'sse');
        reply.hijack();
        await session.transport.handlePostMessage(req.raw, reply.raw, req.body);
      } catch (error) {
        this.sendRawText(
          reply,
          HTTP_STATUS.INTERNAL_SERVER_ERROR,
          ERROR_MESSAGES.INTERNAL_SERVER_ERROR,
        );
      }
    });

    // MCP POST endpoint
    this.fastify.post('/mcp', { preHandler: this.mcpSecurityGuard }, async (request, reply) => {
      const rawSessionId = request.headers['mcp-session-id'];
      const sessionId = getMcpSessionId(request);
      if (rawSessionId !== undefined && !sessionId) {
        reply.code(HTTP_STATUS.BAD_REQUEST).send({ error: ERROR_MESSAGES.INVALID_SESSION_ID });
        return;
      }
      let transport: StreamableHTTPServerTransport | undefined;
      let newSessionId: string | undefined;
      try {
        if (sessionId) {
          const session = this.mcpSessions.get(sessionId, 'streamable-http');
          if (!session) {
            reply.code(HTTP_STATUS.NOT_FOUND).send({ error: ERROR_MESSAGES.INVALID_SESSION_ID });
            return;
          }
          this.mcpSessions.touch(sessionId, 'streamable-http');
          transport = session.transport;
        } else if (isInitializeRequest(request.body)) {
          if (!this.mcpSessions.canAcceptNewSession()) {
            reply.code(HTTP_STATUS.TOO_MANY_REQUESTS).send({
              error: ERROR_MESSAGES.MCP_SESSION_LIMIT_REACHED,
            });
            return;
          }

          newSessionId = randomUUID();
          transport = new StreamableHTTPServerTransport({
            sessionIdGenerator: () => newSessionId!,
            onsessioninitialized: (initializedSessionId) => {
              if (transport && initializedSessionId === newSessionId) {
                this.mcpSessions.register(initializedSessionId, 'streamable-http', transport);
              }
            },
          });
          transport.onclose = () => {
            void this.mcpSessions.remove(newSessionId!, 'streamable-http');
          };
          await createMcpServer({
            sessionId: newSessionId,
            transport: 'streamable-http',
          }).connect(transport);
        } else {
          reply.code(HTTP_STATUS.BAD_REQUEST).send({ error: ERROR_MESSAGES.INVALID_MCP_REQUEST });
          return;
        }

        reply.hijack();
        await transport.handleRequest(request.raw, reply.raw, request.body);
      } catch (error) {
        if (newSessionId && transport) {
          const removed = await this.mcpSessions
            .remove(newSessionId, 'streamable-http', { closeTransport: true })
            .catch(() => false);
          if (!removed) {
            await transport.close().catch(() => undefined);
          }
        }
        if (error instanceof McpSessionCapacityError) {
          this.sendRawJson(reply, HTTP_STATUS.TOO_MANY_REQUESTS, {
            error: ERROR_MESSAGES.MCP_SESSION_LIMIT_REACHED,
          });
          return;
        }
        this.sendRawJson(reply, HTTP_STATUS.INTERNAL_SERVER_ERROR, {
          error: ERROR_MESSAGES.MCP_REQUEST_PROCESSING_ERROR,
        });
      }
    });

    // MCP GET endpoint (SSE stream)
    this.fastify.get('/mcp', { preHandler: this.mcpSecurityGuard }, async (request, reply) => {
      const sessionId = getMcpSessionId(request);
      if (!sessionId) {
        reply.code(HTTP_STATUS.BAD_REQUEST).send({ error: ERROR_MESSAGES.INVALID_SSE_SESSION });
        return;
      }
      const session = this.mcpSessions.get(sessionId, 'streamable-http');
      if (!session) {
        reply.code(HTTP_STATUS.NOT_FOUND).send({ error: ERROR_MESSAGES.INVALID_SSE_SESSION });
        return;
      }

      this.mcpSessions.touch(sessionId, 'streamable-http');
      reply.hijack();

      try {
        await session.transport.handleRequest(request.raw, reply.raw);
      } catch (error) {
        if (!reply.raw.writableEnded) {
          reply.raw.end();
        }
      }

      request.socket.on('close', () => {
        request.log.info(`SSE client disconnected for session: ${sessionId}`);
      });
    });

    // MCP DELETE endpoint
    this.fastify.delete('/mcp', { preHandler: this.mcpSecurityGuard }, async (request, reply) => {
      const sessionId = getMcpSessionId(request);
      if (!sessionId) {
        reply.code(HTTP_STATUS.BAD_REQUEST).send({ error: ERROR_MESSAGES.INVALID_SESSION_ID });
        return;
      }
      const session = this.mcpSessions.get(sessionId, 'streamable-http');
      if (!session) {
        reply.code(HTTP_STATUS.NOT_FOUND).send({ error: ERROR_MESSAGES.INVALID_SESSION_ID });
        return;
      }

      try {
        this.mcpSessions.touch(sessionId, 'streamable-http');
        reply.hijack();
        await session.transport.handleRequest(request.raw, reply.raw);
        await this.mcpSessions.remove(sessionId, 'streamable-http', { closeTransport: true });
        if (!reply.raw.writableEnded) {
          reply.raw.statusCode = HTTP_STATUS.NO_CONTENT;
          reply.raw.end();
        }
      } catch (error) {
        await this.mcpSessions
          .remove(sessionId, 'streamable-http', { closeTransport: true })
          .catch(() => undefined);
        this.sendRawJson(reply, HTTP_STATUS.INTERNAL_SERVER_ERROR, {
          error: ERROR_MESSAGES.MCP_SESSION_DELETION_ERROR,
        });
      }
    });
  }

  // ============================================================
  // Server Lifecycle
  // ============================================================

  private startMcpSessionSweep(): void {
    if (this.mcpSessionSweepTimer) {
      return;
    }
    this.mcpSessionSweepTimer = setInterval(() => {
      if (this.mcpSessionSweepInProgress) {
        return;
      }
      this.mcpSessionSweepInProgress = true;
      void this.mcpSessions
        .closeExpired()
        .then((result) => {
          for (const failure of result.closeFailures) {
            this.fastify.log.warn(
              { err: failure.error, sessionId: failure.id, transport: failure.kind },
              'Failed to close expired MCP session transport',
            );
          }
        })
        .finally(() => {
          this.mcpSessionSweepInProgress = false;
        });
    }, MCP_SESSION_SWEEP_INTERVAL_MS);
    this.mcpSessionSweepTimer.unref?.();
  }

  private stopMcpSessionSweep(): void {
    if (this.mcpSessionSweepTimer) {
      clearInterval(this.mcpSessionSweepTimer);
      this.mcpSessionSweepTimer = null;
    }
  }

  public async start(port = NATIVE_SERVER_PORT, nativeHost: NativeMessagingHost): Promise<void> {
    if (!this.nativeHost) {
      this.nativeHost = nativeHost;
    } else if (this.nativeHost !== nativeHost) {
      this.nativeHost = nativeHost;
    }

    if (this.isRunning) {
      return;
    }

    try {
      await this.fastify.listen({ port, host: this.mcpSecurityConfig.listenHost });

      // Set port environment variables after successful listen for Chrome MCP URL resolution
      process.env.CHROME_MCP_PORT = String(port);
      process.env.MCP_HTTP_PORT = String(port);

      this.isRunning = true;
      this.startMcpSessionSweep();
    } catch (err) {
      this.isRunning = false;
      throw err;
    }
  }

  public async stop(): Promise<void> {
    if (!this.isRunning) {
      return;
    }

    try {
      this.stopMcpSessionSweep();
      const cleanup = await this.mcpSessions.closeAll();
      for (const failure of cleanup.closeFailures) {
        this.fastify.log.warn(
          { err: failure.error, sessionId: failure.id, transport: failure.kind },
          'Failed to close MCP session transport during shutdown',
        );
      }

      await this.fastify.close();
      closeDb();
      this.isRunning = false;
    } catch (err) {
      this.stopMcpSessionSweep();
      this.isRunning = false;
      closeDb();
      throw err;
    }
  }

  public getInstance(): FastifyInstance {
    return this.fastify;
  }
}

const serverInstance = new Server();
export default serverInstance;
