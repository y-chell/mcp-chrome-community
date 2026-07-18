export const DEFAULT_MAX_MCP_SESSIONS = 64;
export const DEFAULT_MCP_SESSION_IDLE_TTL_MS = 30 * 60 * 1000;

export type McpSessionKind = 'streamable-http' | 'sse';

export interface McpSessionTransport {
  close(): Promise<void> | void;
}

export interface McpSessionTransportMap {
  'streamable-http': McpSessionTransport;
  sse: McpSessionTransport;
}

export interface McpSessionRegistryOptions {
  maxSessions?: number;
  idleTtlMs?: number;
  clock?: () => number;
}

export type McpSession<
  TTransports extends McpSessionTransportMap,
  TKind extends McpSessionKind,
> = Readonly<{
  id: string;
  kind: TKind;
  transport: TTransports[TKind];
  createdAt: number;
  lastActivity: number;
}>;

type AnyMcpSession<TTransports extends McpSessionTransportMap> = {
  [TKind in McpSessionKind]: McpSession<TTransports, TKind>;
}[McpSessionKind];

export interface McpSessionCloseFailure {
  id: string;
  kind: McpSessionKind;
  error: unknown;
}

export interface McpSessionCleanupResult {
  removedCount: number;
  closedCount: number;
  closeFailures: McpSessionCloseFailure[];
}

export interface RemoveMcpSessionOptions {
  closeTransport?: boolean;
}

export class McpSessionAlreadyExistsError extends Error {
  constructor(sessionId: string) {
    super(`MCP session already exists: ${sessionId}`);
    this.name = 'McpSessionAlreadyExistsError';
  }
}

export class McpSessionCapacityError extends Error {
  constructor(maxSessions: number) {
    super(`MCP session limit reached: ${maxSessions}`);
    this.name = 'McpSessionCapacityError';
  }
}

/**
 * Stores MCP transports without owning a sweep timer. The server is responsible
 * for calling closeExpired() on its preferred schedule.
 */
export class McpSessionRegistry<
  TTransports extends McpSessionTransportMap = McpSessionTransportMap,
> {
  public readonly maxSessions: number;
  public readonly idleTtlMs: number;

  private readonly clock: () => number;
  private readonly sessions = new Map<string, AnyMcpSession<TTransports>>();

  constructor(options: McpSessionRegistryOptions = {}) {
    this.maxSessions = options.maxSessions ?? DEFAULT_MAX_MCP_SESSIONS;
    this.idleTtlMs = options.idleTtlMs ?? DEFAULT_MCP_SESSION_IDLE_TTL_MS;
    this.clock = options.clock ?? Date.now;

    if (!Number.isInteger(this.maxSessions) || this.maxSessions <= 0) {
      throw new RangeError('maxSessions must be a positive integer');
    }
    if (!Number.isFinite(this.idleTtlMs) || this.idleTtlMs < 0) {
      throw new RangeError('idleTtlMs must be a non-negative finite number');
    }
  }

  get size(): number {
    return this.sessions.size;
  }

  canAcceptNewSession(): boolean {
    return this.size < this.maxSessions;
  }

  register<TKind extends McpSessionKind>(
    id: string,
    kind: TKind,
    transport: TTransports[TKind],
  ): McpSession<TTransports, TKind> {
    if (this.sessions.has(id)) {
      throw new McpSessionAlreadyExistsError(id);
    }
    if (!this.canAcceptNewSession()) {
      throw new McpSessionCapacityError(this.maxSessions);
    }

    const now = this.now();
    const session = Object.freeze({
      id,
      kind,
      transport,
      createdAt: now,
      lastActivity: now,
    }) as McpSession<TTransports, TKind>;

    this.sessions.set(id, session as AnyMcpSession<TTransports>);
    return session;
  }

  get<TKind extends McpSessionKind>(
    id: string,
    kind: TKind,
  ): McpSession<TTransports, TKind> | undefined {
    const session = this.sessions.get(id);
    if (!session || session.kind !== kind) {
      return undefined;
    }

    return session as McpSession<TTransports, TKind>;
  }

  touch(id: string, kind: McpSessionKind): boolean {
    const session = this.sessions.get(id);
    if (!session || session.kind !== kind) {
      return false;
    }

    const touchedSession = Object.freeze({
      ...session,
      lastActivity: this.now(),
    }) as AnyMcpSession<TTransports>;
    this.sessions.set(id, touchedSession);
    return true;
  }

  async remove(
    id: string,
    kind: McpSessionKind,
    options: RemoveMcpSessionOptions = {},
  ): Promise<boolean> {
    const session = this.sessions.get(id);
    if (!session || session.kind !== kind) {
      return false;
    }

    this.sessions.delete(id);
    if (options.closeTransport) {
      await session.transport.close();
    }
    return true;
  }

  async closeExpired(): Promise<McpSessionCleanupResult> {
    const now = this.now();
    const expiredSessions: AnyMcpSession<TTransports>[] = [];

    for (const session of this.sessions.values()) {
      if (now - session.lastActivity >= this.idleTtlMs) {
        expiredSessions.push(session);
        this.sessions.delete(session.id);
      }
    }

    return this.closeSessions(expiredSessions);
  }

  async closeAll(): Promise<McpSessionCleanupResult> {
    const sessions = Array.from(this.sessions.values());
    this.sessions.clear();
    return this.closeSessions(sessions);
  }

  private now(): number {
    const now = this.clock();
    if (!Number.isFinite(now)) {
      throw new TypeError('clock must return a finite timestamp');
    }
    return now;
  }

  private async closeSessions(
    sessions: AnyMcpSession<TTransports>[],
  ): Promise<McpSessionCleanupResult> {
    const results = await Promise.allSettled(
      sessions.map((session) => Promise.resolve().then(() => session.transport.close())),
    );
    const closeFailures: McpSessionCloseFailure[] = [];

    results.forEach((result, index) => {
      if (result.status === 'rejected') {
        const session = sessions[index];
        closeFailures.push({
          id: session.id,
          kind: session.kind,
          error: result.reason,
        });
      }
    });

    return {
      removedCount: sessions.length,
      closedCount: sessions.length - closeFailures.length,
      closeFailures,
    };
  }
}
