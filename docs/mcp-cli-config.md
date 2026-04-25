# CLI MCP Configuration Guide

This guide explains how to configure Codex CLI and Claude Code to connect to the mcp-chrome-community.

## Overview

The mcp-chrome-community exposes its MCP interface at `http://127.0.0.1:12306/mcp` by default.
If you override host or port, use the actual address in your client config.
Both Codex CLI and Claude Code can connect to this endpoint to use Chrome browser control tools.

## Codex CLI Configuration

### Option 1: HTTP MCP Server (Recommended)

Add the following to your `~/.codex/config.json`:

```json
{
  "mcpServers": {
    "mcp-chrome-community": {
      "url": "http://127.0.0.1:12306/mcp"
    }
  }
}
```

### Option 2: Via Environment Variable

Set the MCP host or port before running codex:

```bash
export CHROME_MCP_HOST=127.0.0.1
export MCP_HTTP_PORT=12306
```

## Claude Code Configuration

### Option 1: HTTP MCP Server

Add the following to your `~/.claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "mcp-chrome-community": {
      "url": "http://127.0.0.1:12306/mcp"
    }
  }
}
```

### Option 2: Stdio Server (Alternative)

If you prefer stdio-based MCP communication:

```json
{
  "mcpServers": {
    "mcp-chrome-community": {
      "command": "node",
      "args": ["/path/to/mcp-chrome-community-bridge/dist/mcp/mcp-server-stdio.js"]
    }
  }
}
```

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
3. Verify no firewall is blocking localhost connections
4. Run `mcp-chrome-community doctor` to diagnose issues

### Tools Not Appearing

If MCP tools don't appear in the CLI:

1. Restart the CLI tool after configuration changes
2. Check the configuration file syntax (valid JSON)
3. Ensure the MCP server URL is accessible

### Port Conflicts

If port 12306 is already in use:

1. Set a custom port in the extension settings
2. Update the CLI configuration to match the new port
3. Run `mcp-chrome-community update-port <new-port>` to update the stdio config

## Environment Variables

| Variable                     | Description                                 | Default     |
| ---------------------------- | ------------------------------------------- | ----------- |
| `CHROME_MCP_HOST`            | Preferred host override for MCP HTTP server | `127.0.0.1` |
| `MCP_HTTP_HOST`              | Backward-compatible host override           | `127.0.0.1` |
| `CHROME_MCP_PORT`            | Preferred port override for MCP HTTP server | `12306`     |
| `MCP_HTTP_PORT`              | Backward-compatible port override           | `12306`     |
| `MCP_ALLOWED_WORKSPACE_BASE` | Additional allowed workspace directory      | (none)      |
| `CHROME_MCP_NODE_PATH`       | Override Node.js executable path            | (auto)      |
