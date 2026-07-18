# CLI MCP Configuration Guide

This guide explains how to configure Codex CLI and Claude Code to connect to mcp-chrome-community.

## Overview

mcp-chrome-community exposes Streamable HTTP at `http://127.0.0.1:12306/mcp` by default. The
default listener is loopback-only and does not require a bearer token, preserving existing local
client configurations.

`CHROME_MCP_BIND_HOST` controls the actual listen address. `CHROME_MCP_HOST` controls the address
generated for internal clients. Keep them separate when listening on a wildcard address.

## Codex CLI Configuration

### Local Streamable HTTP (Recommended)

```bash
codex mcp add mcp-chrome-community --url http://127.0.0.1:12306/mcp
```

Equivalent `~/.codex/config.toml`:

```toml
[mcp_servers.mcp-chrome-community]
url = "http://127.0.0.1:12306/mcp"
```

For a protected endpoint, keep the token in an environment variable and configure Codex with the
environment variable name rather than the token value:

```powershell
$env:CHROME_MCP_AUTH_TOKEN = '<at-least-16-random-characters>'
codex mcp add mcp-chrome-community --url http://192.168.1.20:12306/mcp --bearer-token-env-var CHROME_MCP_AUTH_TOKEN
```

## Claude Code Configuration

### Local Streamable HTTP

```bash
claude mcp add --transport http --scope user mcp-chrome-community http://127.0.0.1:12306/mcp
```

Claude Code also supports `--header` for a protected HTTP endpoint. Be aware that a literal
`Authorization` header may be persisted in Claude's MCP configuration; use a client-supported
secret or environment substitution mechanism when available.

### Stdio Server (Alternative)

If you prefer stdio-based MCP communication:

```json
{
  "mcpServers": {
    "mcp-chrome-community": {
      "command": "node",
      "args": ["/path/to/mcp-chrome-community-bridge/dist/mcp/mcp-server-stdio.js"],
      "env": {
        "CHROME_MCP_TOOL_PROFILE": "core"
      }
    }
  }
}
```

The stdio proxy automatically forwards `CHROME_MCP_AUTH_TOKEN` or the legacy
`MCP_HTTP_AUTH_TOKEN` when the underlying HTTP endpoint is protected.

## Protected or Remote Listener

Remote listening is opt-in. A non-loopback listener requires a bearer token of at least 16
characters. A wildcard listener also requires explicit allowed Host values.

PowerShell example for a LAN-only listener:

```powershell
$env:CHROME_MCP_BIND_HOST = '0.0.0.0'
$env:CHROME_MCP_AUTH_TOKEN = '<at-least-16-random-characters>'
$env:CHROME_MCP_ALLOWED_HOSTS = '192.168.1.20'
```

Keep `CHROME_MCP_HOST` at its loopback default for the local extension and internal agents. Remote
MCP clients should use `http://192.168.1.20:12306/mcp` in their own configuration. The shared
listener rejects remote access to Agent and extension HTTP routes; only `/mcp`, `/sse`, and
`/messages` can accept remote clients.

The built-in server is plain HTTP. Do not expose it directly to the public internet or an
untrusted network; use a TLS reverse proxy if traffic leaves a trusted machine or LAN. Configure
that proxy to publish only `/mcp`, `/sse`, and `/messages`: a local reverse proxy connects from a
loopback address, so the native server cannot distinguish its forwarded requests from other local
traffic.

## Verifying Connection

After configuration, the CLI tools should be able to see and use browser tools from mcp-chrome-community such as:

- `chrome_get_windows_and_tabs` - Get browser window and tab information
- `chrome_navigate` - Navigate to a URL
- `chrome_click_element` - Click on page elements
- `chrome_get_web_content` - Get page content
- And more...

## Troubleshooting

### Connection Refused

If you get "connection refused" errors:

1. Ensure the Chrome extension is installed and the native server is running
2. Check that the port matches (default: 12306)
3. If authentication is enabled, confirm the client receives the same token environment variable
4. For remote listeners, confirm `CHROME_MCP_ALLOWED_HOSTS` contains the hostname or IP used in the URL
5. Verify no firewall is blocking the selected interface
6. Run `mcp-chrome-community doctor` to diagnose issues

### Tools Not Appearing

If MCP tools don't appear in the CLI:

1. Restart the CLI tool after configuration changes
2. Check the active client's configuration syntax (for example TOML for Codex or JSON for stdio clients)
3. Ensure the MCP server URL is accessible

### Port Conflicts

If port 12306 is already in use:

1. Set a custom port in the extension settings
2. Update the CLI configuration to match the new port
3. Run `mcp-chrome-community update-port <new-port>` to update the stdio config

## Environment Variables

| Variable                           | Description                                                        | Default                                  |
| ---------------------------------- | ------------------------------------------------------------------ | ---------------------------------------- |
| `CHROME_MCP_BIND_HOST`             | Actual Fastify listen address                                      | `127.0.0.1`                              |
| `CHROME_MCP_HOST`                  | Preferred client-facing MCP host                                   | `127.0.0.1`                              |
| `MCP_HTTP_HOST`                    | Backward-compatible client-facing host                             | `127.0.0.1`                              |
| `CHROME_MCP_PORT`                  | Preferred MCP HTTP port                                            | `12306`                                  |
| `MCP_HTTP_PORT`                    | Backward-compatible MCP HTTP port                                  | `12306`                                  |
| `CHROME_MCP_AUTH_TOKEN`            | Preferred optional bearer token                                    | (none; required for non-loopback listen) |
| `MCP_HTTP_AUTH_TOKEN`              | Backward-compatible bearer token                                   | (none)                                   |
| `CHROME_MCP_ALLOWED_HOSTS`         | Comma-separated exact Host allowlist; required for wildcard listen | loopback hosts plus concrete bind host   |
| `CHROME_MCP_ALLOWED_ORIGINS`       | Additional comma-separated exact browser origins                   | published Chrome extension origin        |
| `CHROME_EXTENSION_IDS`             | Additional comma-separated Chrome extension IDs                    | (none)                                   |
| `CHROME_MCP_RATE_LIMIT_PER_MINUTE` | Per-token or per-IP MCP route limit                                | `120`                                    |
| `CHROME_MCP_MAX_SESSIONS`          | Maximum combined Streamable HTTP and legacy SSE sessions           | `64`                                     |
| `CHROME_MCP_SESSION_IDLE_TTL_MS`   | Idle session lifetime before cleanup                               | `1800000`                                |
| `MCP_ALLOWED_WORKSPACE_BASE`       | Additional allowed workspace directory                             | (none)                                   |
| `CHROME_MCP_NODE_PATH`             | Override Node.js executable path                                   | (auto)                                   |
