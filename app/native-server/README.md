# mcp-chrome-community Native Server

Native Server 是 Chrome 扩展与 MCP 客户端之间的本地桥接进程。它提供 Streamable HTTP、兼容 SSE、STDIO 代理、Native Messaging 和内置智能助手 API。

## 运行职责

- 在 `http://127.0.0.1:12306/mcp` 提供 Streamable HTTP MCP。
- 为旧客户端保留 `/sse` 和 `/messages`。
- 为每个 HTTP/SSE 会话创建独立 MCP Server 和 transport。
- 通过 Native Messaging 把工具调用、取消和进度消息转发到扩展。
- 托管仅允许本机访问的 `/agent/*` API、SQLite 会话和附件。
- 启动本机 Codex CLI 或 Claude Agent SDK，为侧边栏智能助手提供执行引擎。

完整架构见 [`docs/ARCHITECTURE_zh.md`](../../docs/ARCHITECTURE_zh.md)。

## 环境要求

- Node.js 20+
- pnpm 8.15.9（当前 lockfile 格式）
- Chrome/Chromium 和已加载的项目扩展
- 使用内置助手时，至少安装并登录一个本地引擎：`codex` 或 Claude Code

## 开发

从仓库根目录执行：

```bash
pnpm install
pnpm run build:shared
pnpm run dev:native
```

扩展开发进程另开终端：

```bash
pnpm run dev:extension
```

## 构建与验证

```bash
pnpm run build:native
pnpm run typecheck:native
pnpm --filter mcp-chrome-community-bridge test
pnpm smoke:stdio
```

连接真实扩展后可继续运行：

```bash
pnpm smoke:stdio -- --call-health --timeout-ms 30000
pnpm smoke:stdio -- --real-browser --timeout-ms 30000 --verbose
```

## 注册 Native Messaging Host

构建后自动检测已安装浏览器：

```bash
mcp-chrome-community register --detect
```

指定浏览器：

```bash
mcp-chrome-community register --browser chrome
mcp-chrome-community register --browser chromium
mcp-chrome-community register --browser all
```

Release 用户应安装 GitHub Release 中的 `mcp-chrome-community-bridge-v<version>.tgz`，不要依赖同名 npm registry 包。

## MCP 传输

### Streamable HTTP

默认地址：

```text
http://127.0.0.1:12306/mcp
```

本机回环监听兼容无 token 配置。非回环监听必须配置 `CHROME_MCP_AUTH_TOKEN`；通配监听还必须配置 `CHROME_MCP_ALLOWED_HOSTS`。详细变量和 Codex/Claude 配置见 [`docs/mcp-cli-config.md`](../../docs/mcp-cli-config.md)。

### STDIO

构建产物入口：

```text
dist/mcp/mcp-server-stdio.js
```

`CHROME_MCP_TOOL_PROFILE` 支持：

- `full`：全部 41 个静态工具。
- `core`：12 个高频工具和 3 个目录工具。
- `search`：健康检查、标签页列表和 3 个目录工具。

STDIO 进程代理到底层 HTTP MCP 服务，因此扩展仍需连接 Native Server。

## 内置智能助手

助手不单独保存第三方 API key：

- Codex 引擎执行本机 `codex exec --json`，沿用本地 Codex 登录、provider 和配置。
- Claude 引擎使用 `@anthropic-ai/claude-agent-sdk`，沿用本机 Claude Code 登录或环境变量。
- 模型留空时使用引擎自己的默认模型；Codex 模型通过 `codex debug models` 动态发现。
- 本地 Chrome MCP 地址只注入当前执行，不修改用户全局 MCP 配置。

检查本地引擎：

```bash
codex --version
codex login status
claude --version
claude auth status
```

## 常用环境变量

| 变量                                | 用途                    | 默认值                  |
| ----------------------------------- | ----------------------- | ----------------------- |
| `CHROME_MCP_PORT` / `MCP_HTTP_PORT` | HTTP 端口               | `12306`                 |
| `CHROME_MCP_BIND_HOST`              | 实际监听地址            | 回环地址                |
| `CHROME_MCP_HOST` / `MCP_HTTP_HOST` | 内部客户端连接地址      | `127.0.0.1`             |
| `CHROME_MCP_AUTH_TOKEN`             | MCP Bearer token        | 未设置                  |
| `CHROME_MCP_ALLOWED_HOSTS`          | 通配监听允许的 Host     | 未设置                  |
| `CHROME_MCP_MAX_SESSIONS`           | HTTP/SSE 最大会话数     | `64`                    |
| `CHROME_MCP_SESSION_IDLE_TTL_MS`    | 空闲会话清理时间        | `1800000`               |
| `CHROME_MCP_TOOL_PROFILE`           | STDIO 工具目录档位      | `full`                  |
| `CLAUDE_DEFAULT_MODEL`              | Claude 助手默认模型覆盖 | 使用 Claude Code 默认值 |

## Windows 注意事项

Native Server 会从用户级注册表读取 Native Messaging Host 清单。Release 扩展使用固定扩展 ID；源码构建未设置 `CHROME_EXTENSION_KEY` 时，Chrome 生成的新 ID 必须与清单 `allowed_origins` 一致。

如果 Node.js 升级后出现 `better-sqlite3` bindings 错误，应在当前 Node 版本下重新安装或重建依赖。不要从另一台机器复制 `node_modules`。

## 许可证

MIT
