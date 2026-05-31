# mcp-chrome-community 🚀

[![许可证: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.8+-blue.svg)](https://www.typescriptlang.org/)
[![Chrome 扩展](https://img.shields.io/badge/Chrome-Extension-green.svg)](https://developer.chrome.com/docs/extensions/)

> 🌟 **让chrome浏览器变成你的智能助手** - 让AI接管你的浏览器，将您的浏览器转变为强大的 AI 控制自动化工具。

> 社区维护 fork： https://github.com/y-chell/mcp-chrome-community
>
> 原上游仓库： https://github.com/hangwin/mcp-chrome
>
> 做这个 fork 的原因很直接：原作者疑似已经不怎么维护了，当时已经 4 个多月没更新。很多问题和可以继续优化的点不能一直等上游，所以这个仓库会独立往前做，优先解决实际问题和社区里已经有人在用的需求。

**📖 文档**: [English](README.md) | [中文](README_zh.md)

> 这个社区版现在是持续维护状态，当前重点是稳定性修复、浏览器兼容性更新，以及把浏览器自动化能力继续做强。

---

## 🎯 什么是 mcp-chrome-community？

mcp-chrome-community 是一个基于chrome插件的 **模型上下文协议 (MCP) 服务器**，它将您的 Chrome 浏览器功能暴露给 Claude 等 AI 助手，实现复杂的浏览器自动化、内容分析和语义搜索等。与传统的浏览器自动化工具（如playwright）不同，**mcp-chrome-community**直接使用您日常使用的chrome浏览器，基于现有的用户习惯和配置、登录态，让各种大模型或者各种chatbot都可以接管你的浏览器，真正成为你的日常助手

## ✨ 功能亮点补充

- **让Claude Code/Codex也能使用的可视化编辑器**, 更多详情请看: [VisualEditor](docs/VisualEditor_zh.md)
- **真实浏览器 Agent 工具集**：已支持页面读取、元素查询、JS 执行、CDP 驱动输入、截图、网络抓包、console 调试证据、上传下载状态查询等能力。
- **更稳的多标签页和多窗口控制**：支持 frame 枚举、新标签等待、标签组管理、后台截图、同一客户端复用上次确认过的 tab，以及 `chrome_health` 版本检查。
- **更适合 Claude Code / Codex 使用**：提供 `wait_for` / `assert`、`read_page`、`query_elements`、`computer`、`clipboard`、`record/replay` 等工具，减少临时写 JS 和反复试错。

## ✨ 核心特性

- 😁 **chatbot/模型无关**：让任意你喜欢的llm或chatbot客户端或agent来自动化操作你的浏览器
- ⭐️ **使用你原本的浏览器**：无缝集成用户本身的浏览器环境（你的配置、登录态等）
- 💻 **完全本地运行**：纯本地运行的mcp server，保证用户隐私
- 🚄 **Streamable http**：Streamable http的连接方式
- 🏎 **跨标签页** 跨标签页的上下文
- 🧠 **语义搜索**：内置向量数据库和本地小模型，智能发现浏览器标签页内容
- 🔍 **智能内容分析**：AI 驱动的文本提取和相似度匹配
- 🌐 **35+ 工具**：支持截图、网络监控、交互操作、书签管理、浏览历史、等待断言、调试证据、上传下载、标签组和录制回放等工具
- 🚀 **SIMD 加速 AI**：自定义 WebAssembly SIMD 优化，向量运算速度提升 4-8 倍

## ✅ 当前已具备的关键能力

- 页面读取：`chrome_scan_compact`、`chrome_read_page`、`chrome_query_elements`、`chrome_get_element_html`、`chrome_get_web_content`，支持紧凑扫描、ref、frameId、frameUrl、局部 DOM、可见元素、隐藏元素和 open Shadow DOM 查询。
- 页面操作：`chrome_click_element`、`chrome_fill_or_select`、`chrome_keyboard`、`chrome_computer`，支持坐标、selector、ref、拖拽、滚动、输入、等待、截图辅助操作。
- 等待和确认：`chrome_wait_for`、`chrome_assert`、`chrome_wait_for_tab`，覆盖元素、文本、URL、标题、JS 条件、网络请求、网络空闲和下载。
- 调试排查：`chrome_console`、`chrome_collect_debug_evidence`、`chrome_javascript`、`chrome_screenshot`、`chrome_cdp_command`、`chrome_cdp_batch`，能拿到页面日志、运行时异常、截图、最近网络证据，也能直接跑 CDP。
- 网络和文件：`chrome_network_capture`、`chrome_network_request`、`chrome_upload_file`、`chrome_get_upload_status`、`chrome_handle_download`，支持抓包、请求重放、上传状态、拖拽上传和下载状态查询。
- 浏览器数据：`chrome_history`、`chrome_bookmark_*`、`chrome_tab_group`、`chrome_clipboard`，覆盖历史记录、书签、标签组和剪贴板。
- 版本和真实浏览器测试：`chrome_health` 能确认扩展版本、bridge 版本、schema hash、工具数量和当前浏览器状态；真实浏览器测试会覆盖表单、异步更新、console、新标签、剪贴板、拖拽、标签组等场景。

## 🆚 与同类项目对比

| 对比维度           | 基于Playwright的MCP Server                                          | 基于Chrome插件的MCP Server                                    |
| ------------------ | ------------------------------------------------------------------- | ------------------------------------------------------------- |
| **资源占用**       | ❌ 需启动独立浏览器进程，需要安装Playwright依赖，下载浏览器二进制等 | ✅ 无需启动独立的浏览器进程，直接利用用户已打开的Chrome浏览器 |
| **用户会话复用**   | ❌ 需重新登录                                                       | ✅ 自动使用已登录状态                                         |
| **浏览器环境保持** | ❌ 干净环境缺少用户设置                                             | ✅ 完整保留用户环境                                           |
| **API访问权限**    | ⚠️ 受限于Playwright API                                             | ✅ Chrome原生API全访问                                        |
| **启动速度**       | ❌ 需启动浏览器进程                                                 | ✅ 只需激活插件                                               |
| **响应速度**       | 50-200ms进程间通信                                                  | ✅ 更快                                                       |

## 🚀 快速开始

### 环境要求

- Node.js 20+（最低要求）
- 推荐 Node.js 22 或 24 LTS
- CI 和 Release 目前用 Node.js 24
- Node.js 25 可能能跑，但现在还没进测试矩阵
- Chrome/Chromium 浏览器

### 安装步骤

1. **从 GitHub Releases 下载最新发布文件**

下载地址：https://github.com/y-chell/mcp-chrome-community/releases

需要下载这两个文件：

- `mcp-chrome-community-extension-<version>.zip`
- `mcp-chrome-community-bridge-v<version>.tgz`

2. **用下载下来的 `.tgz` 全局安装原生宿主**

npm

```bash
npm install -g /path/to/mcp-chrome-community-bridge-v<version>.tgz
```

pnpm

```bash
# pnpm 装这种 release 包，装完后手动执行一次注册最稳
pnpm add -g /path/to/mcp-chrome-community-bridge-v<version>.tgz
mcp-chrome-community register
```

> 这个社区版建议直接安装 GitHub Release 里的 `.tgz`。`npm install -g mcp-chrome-community-bridge` 很可能装到别的包，不一定是这个仓库构建出来的版本。

3. **加载 Chrome 扩展**
   - 先把 `mcp-chrome-community-extension-<version>.zip` 解压出来
   - 打开 Chrome 并访问 `chrome://extensions/`
   - 启用"开发者模式"
   - 点击"加载已解压的扩展程序"，选择刚刚解压出来的扩展目录
   - 点击插件图标打开插件，点击连接即可看到mcp的配置

   Release 包现在会固定未打包扩展的 ID，正常按 release 安装不用手动改 `allowed_origins`。如果你自己从源码构建但没设置 `CHROME_EXTENSION_KEY`，Chrome 会生成一个新的扩展 ID，默认的 Native Messaging 清单就对不上。

<img width="420" alt="mcp-chrome-community 扩展弹窗连接成功后显示 MCP 配置" src="docs/images/readme-extension-connect.png" />

如果你要从源码构建，不走 release 安装，直接看 [贡献指南](docs/CONTRIBUTING_zh.md)。

### 在支持MCP协议的客户端中使用

#### 使用streamable http的方式连接（👍🏻推荐）

将以下配置添加到客户端的 MCP 配置中以cherryStudio为例：

> 推荐用streamable http的连接方式

```json
{
  "mcpServers": {
    "mcp-chrome-community": {
      "type": "streamableHttp",
      "url": "http://127.0.0.1:12306/mcp"
    }
  }
}
```

默认地址是 `http://127.0.0.1:12306/mcp`。如果你改了 host 或 port，就把这里同步改掉。可用环境变量：`CHROME_MCP_HOST` / `MCP_HTTP_HOST`、`CHROME_MCP_PORT` / `MCP_HTTP_PORT`。

#### 使用stdio的方式连接（备选）

假设你的客户端仅支持stdio的连接方式，那么请使用下面的方法：

1. 先找到全局 `node_modules` 目录

```sh
# npm
npm root -g
# pnpm
pnpm root -g
```

然后在后面拼上：

```text
mcp-chrome-community-bridge/dist/mcp/mcp-server-stdio.js
```

最终路径示例：

```text
/path/to/global/node_modules/mcp-chrome-community-bridge/dist/mcp/mcp-server-stdio.js
```

2. 把下面的配置替换成你刚刚得到的最终路径

```json
{
  "mcpServers": {
    "mcp-chrome-community-stdio": {
      "command": "node",
      "args": [
        "/path/to/global/node_modules/mcp-chrome-community-bridge/dist/mcp/mcp-server-stdio.js"
      ]
    }
  }
}
```

比如：在augment中的配置如下：

<img width="494" alt="截屏2025-06-22 22 11 25" src="https://github.com/user-attachments/assets/07c0b090-622b-433d-be70-44e8cb8980a5" />

## 🛠️ 可用工具

完整工具列表：[完整工具列表](docs/TOOLS_zh.md)

<details>
<summary><strong>📊 浏览器和标签页</strong></summary>

- `get_windows_and_tabs` - 列出所有浏览器窗口和标签页
- `chrome_health` - 查看扩展、bridge、工具数量和当前浏览器状态
- `chrome_list_frames` - 列出当前 tab 里的 iframe
- `chrome_wait_for_tab` - 等待新 tab 打开或已有 tab 匹配
- `chrome_navigate` - 打开 URL、刷新、前进后退，也可创建新窗口
- `chrome_switch_tab` - 切换当前显示的标签页
- `chrome_close_tabs` - 关闭 tab
- `chrome_tab_group` - 创建、命名、折叠、移动或取消 Chrome 标签组
</details>

<details>
<summary><strong>🔍 页面读取和定位</strong></summary>

- `chrome_read_page` - 读取当前页面可见内容和交互元素
- `chrome_scan_compact` - 低输出扫描页面，返回标题、表单、按钮、输入框、弹窗、iframe 和重要文本块
- `chrome_query_elements` - 用 CSS/XPath 查元素，支持隐藏元素和 frame
- `chrome_get_element_html` - 获取指定元素 HTML
- `chrome_get_web_content` - 提取页面文本或 HTML
- `chrome_get_interactive_elements` - 获取页面可交互元素
- `search_tabs_content` - 在已打开 tab 内容里做语义搜索
</details>

<details>
<summary><strong>🎯 页面操作</strong></summary>

- `chrome_click_element` - 点击元素，支持 selector、XPath、ref 和坐标
- `chrome_fill_or_select` - 填输入框、textarea、select、checkbox、radio
- `chrome_keyboard` - 发送键盘输入和快捷键
- `chrome_computer` - 鼠标、键盘、滚动、拖拽、截图等综合操作
- `chrome_clipboard` - 读写剪贴板、粘贴文本、复制选中内容
- `chrome_request_element_selection` - 找不到元素时，让用户在页面上手动点选
</details>

<details>
<summary><strong>⏱️ 等待和断言</strong></summary>

- `chrome_wait_for` - 等元素、文本、URL、标题、JS 条件、网络请求、网络空闲或下载
- `chrome_assert` - 用同样的条件做明确检查，失败时直接返回原因
</details>

<details>
<summary><strong>📸 截图、录制和性能</strong></summary>

- `chrome_screenshot` - 截图，支持全页面、元素截图、base64 输出和保存文件
- `chrome_gif_recorder` - 录制 tab 操作并导出 GIF
- `performance_start_trace` - 开始性能 trace
- `performance_stop_trace` - 停止性能 trace
- `performance_analyze_insight` - 返回 trace 的轻量分析结果
</details>

<details>
<summary><strong>🌐 网络、文件和弹窗</strong></summary>

- `chrome_network_capture` - 抓取请求，可选响应体
- `chrome_network_request` - 用浏览器上下文发送 HTTP 请求
- `chrome_upload_file` - 给页面 file input 上传本地文件、URL 文件或 base64 文件
- `chrome_get_upload_status` - 查询上传选择状态
- `chrome_handle_download` - 等待、查询或列出下载
- `chrome_handle_dialog` - 处理 alert、confirm、prompt
</details>

<details>
<summary><strong>🧰 调试和脚本</strong></summary>

- `chrome_javascript` - 在页面里执行 JS，支持返回 JSON 结果
- `chrome_cdp_command` - 发送单条原始 Chrome DevTools Protocol 命令
- `chrome_cdp_batch` - 一次发送多条 CDP 命令，减少来回调用
- `chrome_console` - 读取 console 日志和运行时异常
- `chrome_collect_debug_evidence` - 一次拿到页面内容、截图、console、异常和最近网络证据
</details>

<details>
<summary><strong>📚 浏览器数据</strong></summary>

- `chrome_history` - 搜索浏览器历史记录，支持时间过滤
- `chrome_bookmark_search` - 按关键词查找书签
- `chrome_bookmark_add` - 添加新书签，支持文件夹
- `chrome_bookmark_delete` - 删除书签
</details>

## 🧪 使用示例

### ai帮你总结网页内容然后自动控制excalidraw画图

prompt: [excalidraw-prompt](prompt/excalidraw-prompt.md)
指令：帮我总结当前页面内容，然后画个图帮我理解
https://www.youtube.com/watch?v=3fBPdUBWVz0

https://github.com/user-attachments/assets/f14f79a6-9390-4821-8296-06d020bcfc07

### ai先分析图片的内容元素，然后再自动控制excalidraw把图片模仿出来

prompt: [excalidraw-prompt](prompt/excalidraw-prompt.md)|[content-analize](prompt/content-analize.md)
指令：先看下图片是否能用excalidraw画出来，如果则列出所需的步骤和元素，然后画出来
https://www.youtube.com/watch?v=tEPdHZBzbZk

https://github.com/user-attachments/assets/4f0600c1-bb1e-4b57-85ab-36c8bdf71c68

### ai自动帮你注入脚本并修改网页的样式

prompt: [modify-web-prompt](prompt/modify-web.md)
指令：帮我修改当前页面的样式，去掉广告
https://youtu.be/twI6apRKHsk

https://github.com/user-attachments/assets/aedbe98d-e90c-4a58-a4a5-d888f7293d8e

### ai自动帮你捕获网络请求

指令：我想知道小红书的搜索接口是哪个，响应体结构是什么样的
https://youtu.be/1hHKr7XKqnQ

https://github.com/user-attachments/assets/dc7e5cab-b9af-4b9a-97ce-18e4837318d9

### ai帮你分析你的浏览记录

指令：分析一下我近一个月的浏览记录
https://youtu.be/jf2UZfrR2Vk

https://github.com/user-attachments/assets/31b2e064-88c6-4adb-96d7-50748b826eae

### 网页对话

指令：翻译并总结当前网页
https://youtu.be/FlJKS9UQyC8

https://github.com/user-attachments/assets/aa8ef2a1-2310-47e6-897a-769d85489396

### ai帮你自动截图（网页截图）

指令：把huggingface的首页截个图
https://youtu.be/7ycK6iksWi4

https://github.com/user-attachments/assets/65c6eee2-6366-493d-a3bd-2b27529ff5b3

### ai帮你自动截图（元素截图）

指令：把huggingface首页的图标截取下来
https://youtu.be/ev8VivANIrk

https://github.com/user-attachments/assets/d0cf9785-c2fe-4729-a3c5-7f2b8b96fe0c

### ai帮你管理书签

指令：将当前页面添加到书签中，放到合适的文件夹
https://youtu.be/R_83arKmFTo

https://github.com/user-attachments/assets/15a7d04c-0196-4b40-84c2-bafb5c26dfe0

### 自动关闭网页

指令：关闭所有shadcn相关的网页
https://youtu.be/2wzUT6eNVg4

https://github.com/user-attachments/assets/83de4008-bb7e-494d-9b0f-98325cfea592

## 🤝 贡献指南

我们欢迎贡献！请查看 [CONTRIBUTING_zh.md](docs/CONTRIBUTING_zh.md) 了解详细指南。

## 🚧 后续优化计划

GenericAgent 里适合浏览器自动化的部分已经先合进来了：紧凑页面扫描、原始 CDP 命令、批量 CDP、frame-aware DOM 查询、后台 CDP 截图、复杂上传兼容，以及更明确的工具说明。

后面还剩这些：

- `chrome_javascript` 继续补 CDP execution context，减少跨域 iframe 场景里的手工 CDP 调用。
- canvas/img 场景支持直接导出 base64，减少截图裁剪误差。
- 录制与回放从“能跑”补到“稳定可复用”。
- 自动任务从“单次执行”补到“可发布、可调试、可定时”。
- 增强浏览器支持：先把 Chrome / Edge 稳住，再评估 Firefox。
- 身份认证和工具权限分级。

### 最后再考虑 Windows 桌面级控制

这部分参考 GA 的 `ljqCtrl`，但建议独立成桌面工具组，不混进浏览器内工具。

- 可选工具：`desktop_screenshot`、`desktop_click`、`desktop_move`、`desktop_key`、`desktop_type`、`desktop_window_list`、`desktop_activate_window`、`desktop_find_image`。
- Windows 优先考虑 `win32api`、`win32gui`、`win32con`、`mss`、`Pillow`，必要时再用 `pyautogui`。
- 坐标必须明确物理像素和 DPI 缩放，避免点偏。
- 只用于文件选择器、系统弹窗、浏览器外 App、Chrome 权限弹窗、无法用扩展 API 操作的界面。

---

**想要为这些功能中的任何一个做贡献？** 查看我们的[贡献指南](docs/CONTRIBUTING_zh.md)并加入我们的开发社区！

## 📄 许可证

本项目采用 MIT 许可证 - 详见 [LICENSE](LICENSE) 文件。

## 📚 更多文档

- [架构设计](docs/ARCHITECTURE_zh.md) - 详细的技术架构说明
- [工具列表](docs/TOOLS_zh.md) - 完整的工具 API 文档
- [故障排除](docs/TROUBLESHOOTING_zh.md) - 常见问题解决方案
