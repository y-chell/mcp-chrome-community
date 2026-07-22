## 🚀 安装和连接问题

### 快速诊断

运行诊断工具来识别常见问题：

```bash
mcp-chrome-community doctor
```

自动修复常见问题：

```bash
mcp-chrome-community doctor --fix
```

### 导出诊断报告

如果需要提交 Issue，可以导出诊断报告：

```bash
# 打印 Markdown 报告到终端（复制粘贴到 GitHub Issue）
mcp-chrome-community report

# 写入到文件
mcp-chrome-community report --output mcp-report.md

# 直接复制到剪贴板
mcp-chrome-community report --copy
```

默认情况下，用户名、路径和令牌会被脱敏。如果你需要提供完整路径，可以使用 `--no-redact`。

### 常见问题

#### 连接成功，但是服务启动失败

启动失败基本上都是**权限问题**或者用包管理工具安装的**node**导致的启动脚本找不到对应的node。

**推荐先运行诊断工具：**

```bash
mcp-chrome-community doctor
```

核心排查流程

1. npm包全局安装后，确认清单文件com.chromemcp.nativehost.json的位置，里面有一个**path**字段，指向的是一个启动脚本:

1.1 **检查 mcp-chrome-community-bridge 是否安装成功**，确保是**全局安装**的

```bash
mcp-chrome-community -V
```

<img width="612" alt="截屏2025-06-11 15 09 57" src="https://github.com/user-attachments/assets/59458532-e6e1-457c-8c82-3756a5dbb28e" />

1.2 **检查清单文件是否已放在正确目录**

windows路径：C:\Users\xxx\AppData\Roaming\Google\Chrome\NativeMessagingHosts

mac路径： /Users/xxx/Library/Application\ Support/Google/Chrome/NativeMessagingHosts

如果npm包安装正常的话，这个目录下会生成一个`com.chromemcp.nativehost.json`

```json
{
  "name": "com.chromemcp.nativehost",
  "description": "Native Messaging host for mcp-chrome-community",
  "path": "/Users/xxx/Library/pnpm/global/5/.pnpm/mcp-chrome-community-bridge@1.0.7/node_modules/mcp-chrome-community-bridge/dist/run_host.sh",
  "type": "stdio",
  "allowed_origins": ["chrome-extension://hbdgbgagpkpjffpklnamcljpakneikee/"]
}
```

> 如果发现没有此清单文件，可以尝试命令行执行：`mcp-chrome-community register`

> 如果你装的是 GitHub Release 里的扩展包，扩展 ID 应该会保持固定。只有你自己从源码构建、并且没设置 `CHROME_EXTENSION_KEY` 时，Chrome 才会生成新的扩展 ID，导致这里的 `allowed_origins` 对不上。

2. **检查日志**

日志现在存储在用户可写目录：

- **macOS**: `~/Library/Logs/mcp-chrome-community/`
- **Windows**: `%LOCALAPPDATA%\mcp-chrome-community\logs\`（例如 `C:\Users\xxx\AppData\Local\mcp-chrome-community\logs\`）
- **Linux**: `~/.local/state/mcp-chrome-community/logs/`

<img width="804" alt="截屏2025-06-11 15 09 41" src="https://github.com/user-attachments/assets/ce7b7c94-7c84-409a-8210-c9317823aae1" />

3. 一般失败的原因就是两种

3.1. run_host.sh(windows是run_host.bat)没有执行权限：运行以下命令修复：

```bash
mcp-chrome-community fix-permissions
```

3.2. 脚本找不到node：如果你使用 Node 版本管理工具（nvm、volta、asdf、fnm），可以设置 `CHROME_MCP_NODE_PATH` 环境变量：

```bash
export CHROME_MCP_NODE_PATH=/path/to/your/node
```

或者运行 `mcp-chrome-community doctor --fix` 来写入当前 Node 路径。

3.3 如果排除了以上两种原因都不行，则查看日志目录的日志，然后提issue

3.4 如果点击 Connect 完全没反应，再看一下是不是扩展 ID 变了。官方 release 现在会固定扩展 ID；源码自建如果没带 `CHROME_EXTENSION_KEY`，默认 Native Messaging 清单不会认这个新 ID。

### 日志位置

包装器日志现在存储在用户可写的位置：

- **macOS**: `~/Library/Logs/mcp-chrome-community/`
- **Windows**: `%LOCALAPPDATA%\mcp-chrome-community\logs\`
- **Linux**: `~/.local/state/mcp-chrome-community/logs/`

#### 工具执行超时

有可能长时间连接的时候session会超时，这个时候重新连接即可

#### 效果问题

不同的agent，不同的模型使用工具的效果是不一样的，这些都需要你自行尝试，我更推荐用聪明的agent，比如augment，claude code等等...

### 内置智能助手

#### 为什么没有 API key 输入框

侧边栏助手不维护独立的第三方凭据。Codex 引擎读取本机 Codex CLI 的登录和 provider 配置，Claude 引擎读取本机 Claude Code 登录或它支持的环境变量。先在终端确认：

```bash
codex --version
codex login status
claude --version
claude auth status
```

只使用外部 MCP 客户端时，不需要配置这两个本地助手引擎。

#### 模型列表不是最新的

模型留空会跟随本机 CLI 默认值，通常比固定型号更可靠。Codex 列表来自 `codex debug models`，升级 Codex CLI 后重启 Native Server 即可刷新；Claude 建议使用 `fable`、`opus`、`sonnet`、`haiku` 最新别名。项目和会话设置也允许直接填写任意完整模型 ID。

#### 助手报 `Could not locate the bindings file`

这是 `better-sqlite3` 原生模块与当前 Node.js ABI 不匹配，不是模型或 MCP 协议错误。升级 Node 后应在当前 Node 版本下重新安装 Release bridge；源码开发环境可在仓库根目录执行：

```bash
npx --yes pnpm@8.15.9 rebuild better-sqlite3
```

随后重启 Native Server。不要复制其他 Node 版本或其他机器生成的 `node_modules`。

#### Codex 或 Claude 能打开，但发送消息失败

1. 在终端直接运行对应 CLI，确认登录没有过期。
2. 模型改为空，先验证 CLI 默认模型。
3. 调用 `/agent/engines` 或重新打开侧边栏，确认 Native Server 能发现本地引擎。
4. 查看 Native Server 日志中的 `[CodexEngine]` 或 `[ClaudeEngine]` 错误。
5. 如果项目启用了 Chrome MCP，调用 `chrome_health` 检查扩展、bridge 和 Schema 版本是否一致。
