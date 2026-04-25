# windows 安装指南 🔧

Chrome MCP Server 在windows电脑的详细安装和配置步骤

## 📋 安装

1. **从github上下载最新的chrome扩展**

下载地址：https://github.com/y-chell/mcp-chrome-community/releases

2. **安装原生宿主**

先确认你电脑上已经装了 Node.js。最低 Node.js 20，推荐 Node.js 22 或 24 LTS。

```bash
npm install -g .\mcp-chrome-bridge-v<version>.tgz
```

如果你用 pnpm：

```bash
pnpm add -g .\mcp-chrome-bridge-v<version>.tgz
mcp-chrome-bridge register
```

> 这个社区版建议直接安装 GitHub Release 里的 `.tgz`，不要直接跑 `npm install -g mcp-chrome-bridge`。

3. **加载 Chrome 扩展**
   - 先把 `mcp-chrome-community-extension-<version>.zip` 解压出来
   - 打开 Chrome 并访问 `chrome://extensions/`
   - 启用"开发者模式"
   - 点击"加载已解压的扩展程序"，选择解压后的扩展目录
   - 点击插件图标打开插件，点击连接即可看到mcp的配置

4. **在 CherryStudio 中使用**

类型选streamableHttp。默认 url 填 `http://127.0.0.1:12306/mcp`；如果你改过 host 或 port，就按实际值填。可用环境变量：`CHROME_MCP_HOST` / `MCP_HTTP_HOST`、`CHROME_MCP_PORT` / `MCP_HTTP_PORT`。

查看工具列表，如果能列出工具，说明已经可以使用了

```json
{
  "mcpServers": {
    "streamable-mcp-server": {
      "type": "streamable-http",
      "url": "http://127.0.0.1:12306/mcp"
    }
  }
}
```

## 🚀 安装和连接问题

### 快速诊断

如果遇到问题，运行诊断工具：

```bash
mcp-chrome-bridge doctor
```

自动修复常见问题：

```bash
mcp-chrome-bridge doctor --fix
```

### 点击扩展的连接按钮后如果没连接成功

1. **检查mcp-chrome-bridge是否安装成功**，确保是全局安装的

```bash
mcp-chrome-bridge -V
```

2. **检查清单文件是否已放在正确目录**

路径：C:\Users\xxx\AppData\Roaming\Google\Chrome\NativeMessagingHosts

3. **检查日志**

日志现在存储在用户目录：`%LOCALAPPDATA%\mcp-chrome-bridge\logs\`

例如：`C:\Users\xxx\AppData\Local\mcp-chrome-bridge\logs\`

4. **Node.js 路径问题**

如果使用 Node 版本管理器（nvm-windows、volta、fnm），可以设置环境变量：

```cmd
set CHROME_MCP_NODE_PATH=C:\path\to\your\node.exe
```

或者运行 `mcp-chrome-bridge doctor --fix` 自动写入当前 Node 路径。
