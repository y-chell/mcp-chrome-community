import { createHash, timingSafeEqual } from 'node:crypto';
import { isIP } from 'node:net';
import type { FastifyReply, FastifyRequest } from 'fastify';

export const DEFAULT_CHROME_EXTENSION_ORIGIN =
  'chrome-extension://hbdgbgagpkpjffpklnamcljpakneikee';
export const DEFAULT_MCP_HTTP_RATE_LIMIT_PER_MINUTE = 120;
export const DEFAULT_MCP_HTTP_RATE_LIMIT_MAX_CLIENTS = 10_000;

export const MCP_HTTP_SECURITY_ENV = {
  AUTH_TOKEN: 'CHROME_MCP_AUTH_TOKEN',
  LEGACY_AUTH_TOKEN: 'MCP_HTTP_AUTH_TOKEN',
  ALLOWED_HOSTS: 'CHROME_MCP_ALLOWED_HOSTS',
  ALLOWED_ORIGINS: 'CHROME_MCP_ALLOWED_ORIGINS',
  EXTENSION_IDS: 'CHROME_EXTENSION_IDS',
  LEGACY_EXTENSION_ID: 'CHROME_EXTENSION_ID',
  RATE_LIMIT_PER_MINUTE: 'CHROME_MCP_RATE_LIMIT_PER_MINUTE',
  LEGACY_RATE_LIMIT_PER_MINUTE: 'MCP_HTTP_RATE_LIMIT_PER_MINUTE',
} as const;

const LOOPBACK_ALLOWED_HOSTS = ['localhost', '127.0.0.1', '[::1]'] as const;
const WILDCARD_LISTEN_HOSTS = new Set(['0.0.0.0', '[::]']);
const TOKEN_MIN_LENGTH_FOR_REMOTE_LISTENER = 16;
const RATE_LIMIT_WINDOW_MS = 60_000;

export interface McpHttpSecurityConfig {
  listenHost: string;
  isLoopbackListener: boolean;
  isWildcardListener: boolean;
  authToken?: string;
  allowedHosts: ReadonlySet<string>;
  allowedOrigins: ReadonlySet<string>;
  hasExplicitAllowedHosts: boolean;
  rateLimitPerMinute: number;
  rateLimitWindowMs: number;
  rateLimitMaxClients: number;
}

export interface ParseMcpHttpSecurityConfigOptions {
  listenHost: string;
  env?: Readonly<Record<string, string | undefined>>;
  rateLimitPerMinute?: number;
  rateLimitWindowMs?: number;
  rateLimitMaxClients?: number;
}

export interface RateLimitResult {
  allowed: boolean;
  retryAfterSeconds: number;
  remaining: number;
}

interface RateLimitEntry {
  count: number;
  windowStartedAt: number;
}

export class FixedWindowRateLimiter {
  private readonly entries = new Map<string, RateLimitEntry>();
  private nextCleanupAt = 0;

  constructor(
    private readonly limit: number,
    private readonly windowMs = RATE_LIMIT_WINDOW_MS,
    private readonly maxClients = DEFAULT_MCP_HTTP_RATE_LIMIT_MAX_CLIENTS,
  ) {
    assertPositiveInteger(limit, 'rate limit');
    assertPositiveInteger(windowMs, 'rate limit window');
    assertPositiveInteger(maxClients, 'rate limit client capacity');
  }

  public consume(key: string, now = Date.now()): RateLimitResult {
    if (now >= this.nextCleanupAt) {
      this.pruneExpired(now);
      this.nextCleanupAt = now + this.windowMs;
    }

    const existing = this.entries.get(key);
    if (existing && now - existing.windowStartedAt < this.windowMs) {
      if (existing.count >= this.limit) {
        return {
          allowed: false,
          retryAfterSeconds: Math.max(
            1,
            Math.ceil((existing.windowStartedAt + this.windowMs - now) / 1_000),
          ),
          remaining: 0,
        };
      }

      existing.count += 1;
      return {
        allowed: true,
        retryAfterSeconds: 0,
        remaining: this.limit - existing.count,
      };
    }

    if (existing) {
      this.entries.delete(key);
    }
    this.ensureCapacity(now);
    this.entries.set(key, { count: 1, windowStartedAt: now });

    return {
      allowed: true,
      retryAfterSeconds: 0,
      remaining: this.limit - 1,
    };
  }

  public pruneExpired(now = Date.now()): number {
    let removed = 0;
    for (const [key, entry] of this.entries) {
      if (now - entry.windowStartedAt >= this.windowMs) {
        this.entries.delete(key);
        removed += 1;
      }
    }
    return removed;
  }

  public clear(): void {
    this.entries.clear();
    this.nextCleanupAt = 0;
  }

  public get size(): number {
    return this.entries.size;
  }

  private ensureCapacity(now: number): void {
    if (this.entries.size < this.maxClients) {
      return;
    }

    this.pruneExpired(now);
    while (this.entries.size >= this.maxClients) {
      const oldestKey = this.entries.keys().next().value as string | undefined;
      if (oldestKey === undefined) {
        return;
      }
      this.entries.delete(oldestKey);
    }
  }
}

export interface CreateMcpHttpSecurityGuardOptions {
  limiter?: FixedWindowRateLimiter;
  now?: () => number;
}

export type McpHttpSecurityGuard = (request: FastifyRequest, reply: FastifyReply) => Promise<void>;

const MCP_TRANSPORT_PATHS = new Set(['/mcp', '/sse', '/messages']);

export function isMcpTransportPath(url: string): boolean {
  const queryIndex = url.indexOf('?');
  const path = queryIndex === -1 ? url : url.slice(0, queryIndex);
  return MCP_TRANSPORT_PATHS.has(path);
}

export function isLoopbackRemoteAddress(address: string | undefined): boolean {
  if (!address) {
    return false;
  }
  const normalized = address.toLowerCase().split('%', 1)[0];
  if (normalized === '::1') {
    return true;
  }
  const ipv4 = normalized.startsWith('::ffff:') ? normalized.slice(7) : normalized;
  return isIP(ipv4) === 4 && ipv4.startsWith('127.');
}

export function parseMcpHttpSecurityConfig(
  options: ParseMcpHttpSecurityConfigOptions,
): McpHttpSecurityConfig {
  const env = options.env ?? process.env;
  const listenHost = normalizeListenHost(options.listenHost);
  const canonicalListenHost = normalizeConfiguredHost(listenHost, 'listen host');
  const explicitAllowedHostValues = parseCommaSeparatedEnv(
    env[MCP_HTTP_SECURITY_ENV.ALLOWED_HOSTS],
    'allowed host',
  );
  const allowedHosts = new Set<string>(LOOPBACK_ALLOWED_HOSTS);

  if (!WILDCARD_LISTEN_HOSTS.has(canonicalListenHost)) {
    allowedHosts.add(canonicalListenHost);
  }
  for (const host of explicitAllowedHostValues) {
    allowedHosts.add(normalizeConfiguredHost(host, 'allowed host'));
  }

  const allowedOrigins = new Set<string>([DEFAULT_CHROME_EXTENSION_ORIGIN]);
  for (const extensionId of parseCommaSeparatedEnv(
    env[MCP_HTTP_SECURITY_ENV.EXTENSION_IDS] ?? env[MCP_HTTP_SECURITY_ENV.LEGACY_EXTENSION_ID],
    'extension ID',
  )) {
    if (!/^[a-p]{32}$/.test(extensionId)) {
      throw new Error(`Invalid Chrome extension ID: ${extensionId}`);
    }
    allowedOrigins.add(`chrome-extension://${extensionId}`);
  }
  for (const origin of parseCommaSeparatedEnv(
    env[MCP_HTTP_SECURITY_ENV.ALLOWED_ORIGINS],
    'allowed origin',
  )) {
    allowedOrigins.add(origin);
  }

  const authToken = firstNonEmptyEnvValue(
    env,
    MCP_HTTP_SECURITY_ENV.AUTH_TOKEN,
    MCP_HTTP_SECURITY_ENV.LEGACY_AUTH_TOKEN,
  );
  const configuredRateLimit = firstNonEmptyEnvValue(
    env,
    MCP_HTTP_SECURITY_ENV.RATE_LIMIT_PER_MINUTE,
    MCP_HTTP_SECURITY_ENV.LEGACY_RATE_LIMIT_PER_MINUTE,
  );
  const rateLimitPerMinute =
    options.rateLimitPerMinute ??
    (configuredRateLimit === undefined
      ? DEFAULT_MCP_HTTP_RATE_LIMIT_PER_MINUTE
      : parsePositiveInteger(configuredRateLimit, 'MCP HTTP rate limit'));
  const rateLimitWindowMs = options.rateLimitWindowMs ?? RATE_LIMIT_WINDOW_MS;
  const rateLimitMaxClients =
    options.rateLimitMaxClients ?? DEFAULT_MCP_HTTP_RATE_LIMIT_MAX_CLIENTS;

  assertPositiveInteger(rateLimitPerMinute, 'MCP HTTP rate limit');
  assertPositiveInteger(rateLimitWindowMs, 'MCP HTTP rate limit window');
  assertPositiveInteger(rateLimitMaxClients, 'MCP HTTP rate limit client capacity');

  return {
    listenHost,
    isLoopbackListener: isLoopbackHost(canonicalListenHost),
    isWildcardListener: WILDCARD_LISTEN_HOSTS.has(canonicalListenHost),
    authToken,
    allowedHosts,
    allowedOrigins,
    hasExplicitAllowedHosts: explicitAllowedHostValues.length > 0,
    rateLimitPerMinute,
    rateLimitWindowMs,
    rateLimitMaxClients,
  };
}

/** Throws before listen() when the HTTP exposure would be unsafe. */
export function validateMcpHttpSecurityConfig(config: McpHttpSecurityConfig): void {
  if (config.isWildcardListener && !config.hasExplicitAllowedHosts) {
    throw new Error(
      `Listening on ${config.listenHost} requires explicit CHROME_MCP_ALLOWED_HOSTS.`,
    );
  }

  if (!config.isLoopbackListener) {
    if (!config.authToken) {
      throw new Error(
        'Non-loopback MCP HTTP listeners require CHROME_MCP_AUTH_TOKEN (or MCP_HTTP_AUTH_TOKEN).',
      );
    }
    if (config.authToken.length < TOKEN_MIN_LENGTH_FOR_REMOTE_LISTENER) {
      throw new Error(
        `Non-loopback MCP HTTP auth tokens must be at least ${TOKEN_MIN_LENGTH_FOR_REMOTE_LISTENER} characters.`,
      );
    }
  }

  if (config.authToken && /\s/.test(config.authToken)) {
    throw new Error('MCP HTTP auth tokens must not contain whitespace.');
  }
  if (config.allowedHosts.size === 0) {
    throw new Error('At least one MCP HTTP Host must be allowed.');
  }
  for (const host of config.allowedHosts) {
    if (host.includes('*') || WILDCARD_LISTEN_HOSTS.has(host)) {
      throw new Error('MCP HTTP allowed hosts must be concrete hostnames without wildcards.');
    }
  }
  for (const origin of config.allowedOrigins) {
    if (origin.includes('*')) {
      throw new Error('MCP HTTP allowed origins do not support wildcards.');
    }
  }

  assertPositiveInteger(config.rateLimitPerMinute, 'MCP HTTP rate limit');
  assertPositiveInteger(config.rateLimitWindowMs, 'MCP HTTP rate limit window');
  assertPositiveInteger(config.rateLimitMaxClients, 'MCP HTTP rate limit client capacity');
}

export function createMcpHttpSecurityGuard(
  config: McpHttpSecurityConfig,
  options: CreateMcpHttpSecurityGuardOptions = {},
): McpHttpSecurityGuard {
  validateMcpHttpSecurityConfig(config);
  const limiter =
    options.limiter ??
    new FixedWindowRateLimiter(
      config.rateLimitPerMinute,
      config.rateLimitWindowMs,
      config.rateLimitMaxClients,
    );
  const now = options.now ?? Date.now;
  const authenticatedRateLimitKey = config.authToken
    ? `token:${createHash('sha256').update(config.authToken, 'utf8').digest('hex')}`
    : undefined;

  return async (request, reply): Promise<void> => {
    if (request.method.toUpperCase() === 'OPTIONS') {
      return;
    }

    const host = getRequestHost(request);
    if (!host || !config.allowedHosts.has(host)) {
      sendJsonRpcError(reply, 403, -32003, 'Forbidden Host');
      return;
    }

    const origin = getSingleHeader(request.headers.origin);
    if (origin === null || (origin !== undefined && !config.allowedOrigins.has(origin))) {
      sendJsonRpcError(reply, 403, -32003, 'Forbidden Origin');
      return;
    }

    if (config.authToken) {
      const authorization = getSingleHeader(request.headers.authorization);
      const suppliedToken = authorization?.match(/^Bearer ([^\s]+)$/)?.[1];
      if (!suppliedToken || !tokensEqual(config.authToken, suppliedToken)) {
        reply.header('WWW-Authenticate', 'Bearer');
        sendJsonRpcError(reply, 401, -32001, 'Unauthorized');
        return;
      }
    }

    const rateLimitResult = limiter.consume(authenticatedRateLimitKey ?? request.ip, now());
    if (!rateLimitResult.allowed) {
      reply.header('Retry-After', String(rateLimitResult.retryAfterSeconds));
      sendJsonRpcError(reply, 429, -32029, 'Too Many Requests');
    }
  };
}

/** Returns a canonical hostname while ignoring an optional Host header port. */
export function parseMcpHostHeader(value: string): string | null {
  const raw = value.trim();
  if (!raw || /[\s/@\\?#]/.test(raw)) {
    return null;
  }

  if (raw.startsWith('[')) {
    const match = raw.match(/^\[([^\]]+)](?::(\d{1,5}))?$/);
    if (!match || isIP(match[1]) !== 6 || !isValidOptionalPort(match[2])) {
      return null;
    }
    return canonicalizeIpv6(match[1]);
  }

  const colonIndex = raw.lastIndexOf(':');
  if (colonIndex !== -1) {
    if (raw.indexOf(':') !== colonIndex) {
      return null;
    }
    const port = raw.slice(colonIndex + 1);
    if (!isValidOptionalPort(port)) {
      return null;
    }
    return normalizeNonIpv6Hostname(raw.slice(0, colonIndex));
  }

  return normalizeNonIpv6Hostname(raw);
}

function getRequestHost(request: FastifyRequest): string | null {
  const hostHeader = getSingleHeader(request.headers.host);
  if (hostHeader === null) {
    return null;
  }
  if (hostHeader !== undefined) {
    return parseMcpHostHeader(hostHeader);
  }

  const authority = getSingleHeader(request.headers[':authority']);
  return authority === undefined || authority === null ? null : parseMcpHostHeader(authority);
}

function getSingleHeader(value: string | string[] | undefined): string | null | undefined {
  return Array.isArray(value) ? null : value;
}

function sendJsonRpcError(
  reply: FastifyReply,
  statusCode: number,
  code: number,
  message: string,
): void {
  reply.code(statusCode).send({
    jsonrpc: '2.0',
    id: null,
    error: { code, message },
  });
}

function tokensEqual(expected: string, supplied: string): boolean {
  const expectedDigest = createHash('sha256').update(expected, 'utf8').digest();
  const suppliedDigest = createHash('sha256').update(supplied, 'utf8').digest();
  return timingSafeEqual(expectedDigest, suppliedDigest);
}

function normalizeListenHost(value: string): string {
  const raw = value.trim();
  if (!raw || raw.includes('*')) {
    throw new Error(`Invalid listen host: ${value}`);
  }

  const bracketedIpv6 = raw.match(/^\[([^\]]+)]$/);
  if (bracketedIpv6) {
    if (isIP(bracketedIpv6[1]) !== 6) {
      throw new Error(`Invalid listen host: ${value}`);
    }
    return canonicalizeIpv6(bracketedIpv6[1]).slice(1, -1);
  }
  if (isIP(raw) === 6) {
    return canonicalizeIpv6(raw).slice(1, -1);
  }
  if (isIP(raw) === 4) {
    return raw;
  }

  const hostname = normalizeNonIpv6Hostname(raw);
  if (!hostname) {
    throw new Error(`Invalid listen host: ${value}`);
  }
  return hostname;
}

function normalizeConfiguredHost(value: string, label: string): string {
  const raw = value.trim();
  if (raw.includes('*')) {
    throw new Error(`${label} must not contain wildcards.`);
  }
  if (isIP(raw) === 6) {
    return canonicalizeIpv6(raw);
  }

  const normalized = parseMcpHostHeader(raw);
  if (!normalized) {
    throw new Error(`Invalid ${label}: ${value}`);
  }
  return normalized;
}

function normalizeNonIpv6Hostname(value: string): string | null {
  const hostname = value.toLowerCase().replace(/\.$/, '');
  if (!hostname || hostname.length > 253) {
    return null;
  }
  if (isIP(hostname) === 4) {
    return hostname;
  }
  if (/^[\d.]+$/.test(hostname)) {
    return null;
  }

  const labels = hostname.split('.');
  if (
    labels.some(
      (label) =>
        !label ||
        label.length > 63 ||
        !/^[a-z0-9-]+$/.test(label) ||
        label.startsWith('-') ||
        label.endsWith('-'),
    )
  ) {
    return null;
  }
  return hostname;
}

function canonicalizeIpv6(value: string): string {
  return new URL(`http://[${value}]`).hostname.toLowerCase();
}

function isValidOptionalPort(value: string | undefined): boolean {
  if (value === undefined) {
    return true;
  }
  if (!/^\d+$/.test(value)) {
    return false;
  }
  const port = Number(value);
  return Number.isInteger(port) && port >= 1 && port <= 65_535;
}

function isLoopbackHost(host: string): boolean {
  if (host === 'localhost' || host === '[::1]') {
    return true;
  }
  return isIP(host) === 4 && host.startsWith('127.');
}

function parseCommaSeparatedEnv(value: string | undefined, label: string): string[] {
  if (!value?.trim()) {
    return [];
  }
  const entries = value
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
  if (entries.some((entry) => entry.includes('*'))) {
    throw new Error(`${label} entries must not contain wildcards.`);
  }
  return entries;
}

function firstNonEmptyEnvValue(
  env: Readonly<Record<string, string | undefined>>,
  preferredName: string,
  legacyName: string,
): string | undefined {
  const preferred = env[preferredName]?.trim();
  if (preferred) {
    return preferred;
  }
  const legacy = env[legacyName]?.trim();
  return legacy || undefined;
}

function parsePositiveInteger(value: string, label: string): number {
  if (!/^\d+$/.test(value)) {
    throw new Error(`${label} must be a positive integer.`);
  }
  const parsed = Number(value);
  assertPositiveInteger(parsed, label);
  return parsed;
}

function assertPositiveInteger(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${label} must be a positive integer.`);
  }
}
