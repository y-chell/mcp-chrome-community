# 🚀 Installation and Connection Issues

## Quick Diagnosis

Run the diagnostic tool to identify common issues:

```bash
mcp-chrome-community doctor
```

To automatically fix common issues:

```bash
mcp-chrome-community doctor --fix
```

## Export Report for GitHub Issues

If you need to open an issue, export a diagnostic report:

```bash
# Print Markdown report to terminal (copy/paste into GitHub Issue)
mcp-chrome-community report

# Write to a file
mcp-chrome-community report --output mcp-report.md

# Copy directly to clipboard
mcp-chrome-community report --copy
```

By default, usernames, paths, and tokens are redacted. Use `--no-redact` if you're comfortable sharing full paths.

## If Connection Fails After Clicking the Connect Button on the Extension

1. **Run the diagnostic tool first**

```bash
mcp-chrome-community doctor
```

This will check installation, manifest, permissions, and Node.js path.

2. **Check if mcp-chrome-community-bridge is installed successfully**, ensure it's globally installed

```bash
mcp-chrome-community -V
```

<img width="612" alt="Screenshot 2025-06-11 15 09 57" src="https://github.com/user-attachments/assets/59458532-e6e1-457c-8c82-3756a5dbb28e" />

2. **Check if the manifest file is in the correct directory**

Windows path: C:\Users\xxx\AppData\Roaming\Google\Chrome\NativeMessagingHosts

Mac path: /Users/xxx/Library/Application\ Support/Google/Chrome/NativeMessagingHosts

If the npm package is installed correctly, a file named `com.chromemcp.nativehost.json` should be generated in this directory

If you installed the official GitHub Release extension asset, the unpacked extension ID should stay stable. If you built the extension yourself without `CHROME_EXTENSION_KEY`, Chrome will assign a different ID and `allowed_origins` in this manifest will no longer match.

3. **Check logs**
   Logs are now stored in user-writable directories:

- **macOS**: `~/Library/Logs/mcp-chrome-community/`
- **Windows**: `%LOCALAPPDATA%\mcp-chrome-community\logs\`
- **Linux**: `~/.local/state/mcp-chrome-community/logs/`

<img width="804" alt="Screenshot 2025-06-11 15 09 41" src="https://github.com/user-attachments/assets/ce7b7c94-7c84-409a-8210-c9317823aae1" />

4. **Check if you have execution permissions**
   You need to check your installation path (if unclear, open the manifest file in step 2, the path field shows the installation directory). For example, if the Mac installation path is as follows:

`xxx/node_modules/mcp-chrome-community-bridge/dist/run_host.sh`

Check if this script has execution permissions. Run to fix:

```bash
mcp-chrome-community fix-permissions
```

5. **Node.js not found**
   If you use a Node version manager (nvm, volta, asdf, fnm), the wrapper script may not find Node.js. Set the `CHROME_MCP_NODE_PATH` environment variable:

```bash
export CHROME_MCP_NODE_PATH=/path/to/your/node
```

Or run `mcp-chrome-community doctor --fix` to write the current Node path.

## Log Locations

Wrapper logs are now stored in user-writable locations:

- **macOS**: `~/Library/Logs/mcp-chrome-community/`
- **Windows**: `%LOCALAPPDATA%\mcp-chrome-community\logs\`
- **Linux**: `~/.local/state/mcp-chrome-community/logs/`

## Built-in Assistant

### Why there is no API-key field

The sidepanel assistant does not keep separate third-party credentials. The Codex engine inherits the local Codex CLI login and provider configuration. The Claude engine inherits the local Claude Code login or supported environment variables. Verify them in a terminal:

```bash
codex --version
codex login status
claude --version
claude auth status
```

These local engines are optional when the project is used only from an external MCP client.

### The model list looks stale

An empty model setting follows the local CLI default and is usually more reliable than a pinned model name. Codex suggestions come from `codex debug models`; restart the Native Server after upgrading Codex CLI to refresh them. Claude supports the current `fable`, `opus`, `sonnet`, and `haiku` aliases. Project and session settings also accept arbitrary full model IDs.

### The assistant reports `Could not locate the bindings file`

This means the native `better-sqlite3` module does not match the active Node.js ABI. It is not an MCP or model error. Reinstall the Release bridge under the active Node version. For a source checkout, run from the repository root:

```bash
npx --yes pnpm@8.15.9 rebuild better-sqlite3
```

Restart the Native Server afterward. Do not copy `node_modules` from another Node version or machine.

### Codex or Claude opens but messages fail

1. Run the corresponding CLI directly and confirm its login is still valid.
2. Clear the model field and test the CLI default model first.
3. Reload `/agent/engines` or reopen the sidepanel and confirm the Native Server detects the engine.
4. Inspect Native Server logs for `[CodexEngine]` or `[ClaudeEngine]` errors.
5. If Chrome MCP is enabled for the project, call `chrome_health` and compare extension, bridge, and schema versions.
