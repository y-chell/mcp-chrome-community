# windows 安装指南 🔧

mcp-chrome-community 在windows电脑的详细安装和配置步骤

## 📋 安装

1. **从github上下载最新的chrome扩展**

下载地址：https://github.com/y-chell/mcp-chrome-community/releases

2. **安装原生宿主**

先确认你电脑上已经装了 Node.js。最低 Node.js 20，推荐 Node.js 22 或 24 LTS。

```bash
npm install -g .\mcp-chrome-community-bridge-v<version>.tgz
```

如果你用 pnpm：

```bash
pnpm add -g .\mcp-chrome-community-bridge-v<version>.tgz
mcp-chrome-community register
```

> 这个社区版建议直接安装 GitHub Release 里的 `.tgz`，不要直接跑 `npm install -g mcp-chrome-community-bridge`。

3. **加载 Chrome 扩展**
   - 先把 `mcp-chrome-community-extension-<version>.zip` 解压出来
   - 打开 Chrome 并访问 `chrome://extensions/`
   - 启用"开发者模式"
   - 点击"加载已解压的扩展程序"，选择解压后的扩展目录
   - 点击插件图标打开插件，点击连接即可看到mcp的配置

正常使用 GitHub Release 的扩展包，不需要再手动改 `allowed_origins`。如果你是自己从源码构建扩展但没设置 `CHROME_EXTENSION_KEY`，Chrome 会生成新的扩展 ID，Native Messaging 默认清单就会连不上。

<img width="420" alt="mcp-chrome-community 扩展弹窗连接成功后显示 MCP 配置" src="./images/readme-extension-connect.png" />

4. **在 CherryStudio 中使用**

类型选streamableHttp。默认 url 填 `http://127.0.0.1:12306/mcp`；如果你改过 host 或 port，就按实际值填。可用环境变量：`CHROME_MCP_HOST` / `MCP_HTTP_HOST`、`CHROME_MCP_PORT` / `MCP_HTTP_PORT`。

<img width="675" alt="截屏2025-06-11 15 00 29" src="https://github.com/user-attachments/assets/6631e9e4-57f9-477e-b708-6a285cc0d881" />

查看工具列表，如果能列出工具，说明已经可以使用了

<img width="672" alt="截屏2025-06-11 15 14 55" src="https://github.com/user-attachments/assets/d08b7e51-3466-4ab7-87fa-3f1d7be9d112" />

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
mcp-chrome-community doctor
```

自动修复常见问题：

```bash
mcp-chrome-community doctor --fix
```

### 点击扩展的连接按钮后如果没连接成功

1. **检查 mcp-chrome-community-bridge 是否安装成功**，确保是全局安装的

```bash
mcp-chrome-community -V
```

<img width="612" alt="截屏2025-06-11 15 09 57" src="https://github.com/user-attachments/assets/59458532-e6e1-457c-8c82-3756a5dbb28e" />

2. **检查清单文件是否已放在正确目录**

路径：C:\Users\xxx\AppData\Roaming\Google\Chrome\NativeMessagingHosts

3. **检查日志**

日志现在存储在用户目录：`%LOCALAPPDATA%\mcp-chrome-community\logs\`

例如：`C:\Users\xxx\AppData\Local\mcp-chrome-community\logs\`

<img width="804" alt="截屏2025-06-11 15 09 41" src="https://github.com/user-attachments/assets/ce7b7c94-7c84-409a-8210-c9317823aae1" />

4. **Node.js 路径问题**

如果使用 Node 版本管理器（nvm-windows、volta、fnm），可以设置环境变量：

```cmd
set CHROME_MCP_NODE_PATH=C:\path\to\your\node.exe
```

或者运行 `mcp-chrome-community doctor --fix` 自动写入当前 Node 路径。

5. **扩展 ID 对不上**

如果你不是用 GitHub Release 的扩展包，而是自己构建了一个未打包扩展，先确认构建时有没有设置 `CHROME_EXTENSION_KEY`。没有的话，Chrome 会给这个扩展分配一个新的 ID，点击 Connect 时就会像“没反应”一样，因为 Native Messaging 清单默认只认发布版的固定 ID。
