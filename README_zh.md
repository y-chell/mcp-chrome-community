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

## ✨ 核心特性

- 😁 **chatbot/模型无关**：让任意你喜欢的llm或chatbot客户端或agent来自动化操作你的浏览器
- ⭐️ **使用你原本的浏览器**：无缝集成用户本身的浏览器环境（你的配置、登录态等）
- 💻 **完全本地运行**：纯本地运行的mcp server，保证用户隐私
- 🚄 **Streamable http**：Streamable http的连接方式
- 🏎 **跨标签页** 跨标签页的上下文
- 🧠 **语义搜索**：内置向量数据库和本地小模型，智能发现浏览器标签页内容
- 🔍 **智能内容分析**：AI 驱动的文本提取和相似度匹配
- 🌐 **25+ 工具**：支持截图、网络监控、交互操作、书签管理、浏览历史等25种以上工具
- 🚀 **SIMD 加速 AI**：自定义 WebAssembly SIMD 优化，向量运算速度提升 4-8 倍

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
<summary><strong>📊 浏览器管理 (6个工具)</strong></summary>

- `get_windows_and_tabs` - 列出所有浏览器窗口和标签页
- `chrome_navigate` - 导航到 URL 并控制视口
- `chrome_switch_tab` - 切换当前显示的标签页
- `chrome_close_tabs` - 关闭特定标签页或窗口
- `chrome_go_back_or_forward` - 浏览器导航控制
- `chrome_inject_script` - 向网页注入内容脚本
- `chrome_send_command_to_inject_script` - 向已注入的内容脚本发送指令
</details>

<details>
<summary><strong>📸 截图和视觉 (1个工具)</strong></summary>

- `chrome_screenshot` - 高级截图捕获，支持元素定位、全页面和自定义尺寸
</details>

<details>
<summary><strong>🌐 网络监控 (4个工具)</strong></summary>

- `chrome_network_capture_start/stop` - webRequest API 网络捕获
- `chrome_network_debugger_start/stop` - Debugger API 包含响应体
- `chrome_network_request` - 发送自定义 HTTP 请求
</details>

<details>
<summary><strong>🔍 内容分析 (5个工具)</strong></summary>

- `search_tabs_content` - AI 驱动的浏览器标签页语义搜索
- `chrome_get_web_content` - 从页面提取 HTML/文本内容
- `chrome_get_interactive_elements` - 查找可点击元素
- `chrome_console` - 捕获和获取浏览器标签页的控制台输出
- `chrome_collect_debug_evidence` - 打包截图、console/runtime 报错和最近网络证据
</details>

<details>
<summary><strong>🎯 交互操作 (3个工具)</strong></summary>

- `chrome_click_element` - 使用 CSS 选择器点击元素
- `chrome_fill_or_select` - 填充表单和选择选项
- `chrome_keyboard` - 模拟键盘输入和快捷键
</details>

<details>
<summary><strong>📚 数据管理 (5个工具)</strong></summary>

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

## 🚧 未来发展路线图

社区版接下来的重点不是盲目继续加工具，而是先把现有能力做稳、做快、做强。

### 2026-04-25 v1.1 优先级

- [x] `P0` iframe / Shadow DOM / ref 定位稳定化
  - 先解决“元素明明在页面里，但工具总说 not found”这类问题
  - 关联问题：`#172`、`#126`
  - 主要模块：`app/chrome-extension/entrypoints/background/tools/browser/read-page.ts`、`interaction.ts`、`computer.ts`、`inject-scripts/accessibility-tree-helper.js`、`click-helper.js`、`fill-helper.js`

- [x] `P0` 动态页面等待与断言
  - 补齐“等文本出现/消失”“等元素可点击”“等请求完成”“等下载完成”这类高频动作，减少 AI 乱点和抢跑
  - 关联问题：`#93`、`#200`、`#43`
  - 主要模块：`computer.ts`、`common.ts`、`download.ts`、`network-capture.ts`、`app/chrome-extension/entrypoints/background/record-replay/engine/policies/wait.ts`

- [x] `P1` 截图输出瘦身和局部截图优先
  - 优先解决截图太大、token 爆掉、还得手动保存这些问题
  - 关联问题：`#163`、`#207`
  - 主要模块：`screenshot.ts`、`packages/shared/src/tools.ts`、`app/chrome-extension/utils/image-utils.ts`

- [x] `P1` console / dialog / network 结果质量
  - 把 `chrome_console` 的深层对象、DevTools 冲突、弹窗信息读取、网络抓包结果做得更稳
  - 关联问题：`#215`、`#191`、`#201`
  - 主要模块：`console.ts`、`console-buffer.ts`、`dialog.ts`、`javascript.ts`、`network-capture.ts`

- [x] `P1` 多会话 / 多窗口 / 后台运行隔离
  - 降低并发串线、窗口抢焦点、工具失控这类问题
  - 这轮补强后的实际行为：每个 Streamable HTTP / SSE MCP 会话都会把会话上下文传到扩展侧；调用方不传 `tabId` / `windowId` 时，页签类工具会复用该会话上一次确认过的 tab/window；同一会话或同一 tab 的调用会排队，避免互相插队执行
  - CDP debugger owner 现在会正确统计同一 owner 的重复 attach，并在 Chrome 主动 detach 时清理过期状态
  - 关联问题：`#152`、`#178`、`#162`、`#141`
  - 主要模块：`app/native-server/src/mcp/mcp-server.ts`、`mcp-server-stdio.ts`、`app/chrome-extension/entrypoints/background/native-host.ts`、`computer.ts`、`common.ts`、`app/chrome-extension/utils/cdp-session-manager.ts`

- [x] `P2` 更强的页面操作能力
  - 在现有 `chrome_computer`、`chrome_upload_file`、`chrome_handle_download`、`record_replay_flow_run` 基础上，继续补 `hover`、拖放、剪贴板、标签组、复杂表单和流程复用
  - 这轮补完后的实际行为：`chrome_clipboard` 支持读取、写入、粘贴、复制选中文本；`chrome_tab_group` 可以管理 Chrome 标签组；`chrome_computer` 支持按 selector 拖拽并插入中间移动点；`fill_form` 支持 ref / selector 混合填写并返回每个字段的结果
  - 关联问题：`#141`、`#171`、`#205`
  - 主要模块：`computer.ts`、`file-upload.ts`、`download.ts`、`bookmark.ts`、`history.ts`、`app/chrome-extension/entrypoints/background/tools/record-replay.ts`

### 2026-04-28 Agent 使用体验补强清单

> 下面这些点里，有些底层能力已经存在，但从 Claude Code / Codex 这类 agent 的实际使用体验来看，还需要继续产品化、稳定化，而不是只停留在“能调用”。

- [x] `P1` `chrome_network_capture` 生命周期与匹配规则稳定化
  - 已观察到 `start` 成功但 `stop` 报无活动会话，或返回 `0 requests captured` 的情况；需要把 URL pattern、会话绑定、导航时序和结果回传做稳
  - 优先补齐“等某个请求出现 / 完成”的 agent 友好语义，而不只是底层抓包入口
  - 这轮补强后的实际行为：精确 `https://...` URL 会先绑定 capture 再导航，通配符 pattern 会附着到已有 tab，`includeStatic=false` 仍会保留 XHR/fetch 触发的 `text/html` 响应，只过滤顶层文档和静态资源
  - 建议子任务：
    1. 统一 URL pattern 规则，明确精确 URL、通配符、当前 tab 默认值的行为
    2. 把 capture 生命周期绑定到 tab / frame / navigation，避免 `start` 后状态丢失
    3. 返回更稳定的统计字段，如 matched requests、ignored requests、stop reason
    4. 为 start → navigate → stop、连续 start/stop、超时 stop、无请求 stop 补回归测试
  - 验收方向：在标准 `https` 页面上，`start` → 导航 → `stop` 能稳定拿到请求列表；不再出现随机“无活动会话”
  - 主要模块：`network-capture.ts`、`common.ts`、`app/chrome-extension/utils/cdp-session-manager.ts`

- [x] `P1` 等待 / 断言能力从底层策略升级为一等工具
  - 现有等待能力更多分散在内部策略或复合工具里，仍建议补明确的 `wait_for` / `assert` 风格入口，覆盖元素出现、文本变化、URL 变化、网络空闲等高频条件
  - 目标不是“理论上能通过 JS 拼出来”，而是让 agent 能稳定、低成本地使用
  - 建议子任务：
    1. 定义统一 condition schema：element、text、url、title、js predicate、network idle
    2. 统一超时、轮询间隔、失败消息和调试上下文返回格式
    3. 让 `chrome_computer`、录制回放、下载等待共用同一套等待内核
    4. 为动态列表、懒加载、按钮启用状态、重定向页面补集成用例
  - 验收方向：常见“等元素出现 / 等文本变化 / 等跳转完成”不再需要临时写 JS 或手动重试
  - 主要模块：`computer.ts`、`common.ts`、`app/chrome-extension/entrypoints/background/record-replay/engine/policies/wait.ts`

- [x] `P1` 元素查询与 DOM 可观测性补强
  - `read_page` 已能解决大部分可见元素读取，但对批量元素查询、真实 DOM/属性、hidden 元素、局部 HTML 片段等场景还不够直接
  - 可考虑补 `query_elements`、`get_element_html`、`get_dom_snapshot` 这类更结构化的工具
  - 建议子任务：
    1. 设计批量元素查询输出，至少包含 ref、selector hint、text、role、attributes、visible、enabled
    2. 增加局部 DOM / outerHTML 读取，覆盖 hidden 元素和局部 subtree
    3. 统一 `read_page` 与 DOM 查询工具的 ref 语义，减少跨工具 ref 失配
    4. 为表格、列表、复杂表单、Shadow DOM 场景补回归样例
  - 验收方向：agent 能稳定拿到“一个元素列表”或“某个节点的真实 DOM 片段”，而不是只能读整页摘要
  - 主要模块：`read-page.ts`、`inject-scripts/accessibility-tree-helper.js`、`javascript.ts`

- [x] `P1` 下载 / 上传闭环状态查询
  - 现在已有下载、上传相关工具，但 agent 侧仍缺“是否完成、文件在哪、失败原因是什么”的稳定状态确认
  - 重点补齐下载列表、最终保存路径、上传进度 / 失败原因等结果语义
  - 建议子任务：
    1. 补下载状态查询：pending / in_progress / completed / failed、文件名、路径、大小、mime type
    2. 补上传状态查询：目标元素、开始时间、完成状态、失败原因
    3. 明确浏览器原生弹窗、系统文件选择器、后台下载的兼容边界
    4. 为单文件、多文件、重名文件、取消上传下载补测试覆盖
  - 验收方向：agent 完成上传或下载后，能直接知道结果状态和文件去向，不需要靠猜测或额外脚本探测
  - 主要模块：`download.ts`、`file-upload.ts`、`common.ts`

- [x] `P2` iframe / 多标签页 / 多窗口的工作流级编排
  - 当前基础能力已可用，但复杂工作流仍需要更明确的 frame 枚举 / 切换、标签页等待、新标签识别、跨窗口状态隔离能力
  - 目标是降低 agent 在支付页、登录页、嵌入式编辑器、多步跳转场景中的不确定性
  - 建议子任务：
    1. 补 frame 枚举 / 切换工具，返回 frame 层级、URL、title、可交互状态
    2. 补新标签等待、目标标签识别、标签关闭后的上下文恢复
    3. 明确多窗口并发时的 active tab 选择和后台运行边界
    4. 为 OAuth、支付页、内嵌编辑器、多步重定向场景补集成验证
  - 验收方向：跨 iframe / 新标签 / 新窗口的多步流程能稳定跑通，不容易串到错误上下文
  - 主要模块：`interaction.ts`、`computer.ts`、`app/native-server/src/mcp/mcp-server.ts`

- [x] `P2` console / runtime error / 调试证据增强
  - 除了能执行 JS，还需要更直接的 console logs、runtime errors、失败快照、关键上下文打包，方便 agent 自诊断页面异常
  - 建议子任务：
    1. 增加 recent logs、errors only、clear logs、runtime exception 摘要
    2. 统一失败时的调试证据包：截图、URL、title、最近 console、关键请求摘要
    3. 处理深对象序列化、循环引用、DevTools 冲突和输出截断问题
    4. 为前端报错、资源加载失败、跨域异常补调试样例
  - 验收方向：agent 遇到“页面没反应”时，可以直接拿到足够诊断证据，而不是只能再手写 JS 探查
  - 主要模块：`console.ts`、`console-buffer.ts`、`javascript.ts`、`screenshot.ts`

### 2026-04-29 真实浏览器验收后续计划

> v1.0.7 已经用真实 Chrome 配置和临时本地页面跑过一轮验收。大部分页面操作确实更快、更适合 agent 使用，但还发现了几处真实环境里的问题，下一步优先修这些。

- [ ] `P0` 把剪贴板能力修到真实浏览器里稳定可用
  - 发现的问题：`chrome_clipboard paste_text` 可以把文本插入页面输入框，但直接 `read_text`、`write_text`、`copy_selection` 会因为 offscreen document 没有焦点或 `document.execCommand("copy")` 返回 false 而失败
  - 建议子任务：
    1. 重做剪贴板通道选择：有页面上下文时优先走已聚焦页面执行，只有浏览器焦点规则允许时再走 offscreen
    2. `copy_selection` 即使写系统剪贴板失败，也要返回已提取到的文本，并明确标记为部分成功
    3. 补聚焦 tab、未聚焦窗口、普通输入框、textarea、contenteditable、selector 目标复制/粘贴的回归用例
    4. 文档里写清楚浏览器权限和焦点限制，方便 agent 判断该用 `paste_text` 还是系统剪贴板读写
  - 验收方向：MCP 客户端直接调用 `read_text`、`write_text`、`paste_text`、`copy_selection` 时，不需要用户手动点页面也能有稳定结果
  - 主要模块：`clipboard.ts`、`offscreen-manager.ts`、`entrypoints/offscreen/main.ts`、`wxt.config.ts`

- [ ] `P0` 修复本地 URL 和特殊 URL 的跳转处理
  - 发现的问题：跳转 `http://127.0.0.1:8765/...` 时被改成了类似 `http://www.127.0.0.1:8765/*` 的非法 pattern；换成 `localhost` 正常
  - 建议子任务：
    1. 导航和权限 pattern 生成时保留 IP、`localhost`、端口号和已合法的绝对 URL，不要乱补 `www`
    2. 明确 `file://`、`data:`、`chrome://`、扩展页这些地址的支持边界
    3. 补 `localhost`、`127.0.0.1`、IPv6 loopback、自定义端口、query、hash、编码路径的回归测试
  - 验收方向：本地开发地址能直接跳转，不会被改成非法 hostname
  - 主要模块：`common.ts`、导航 URL helper、host permission / match pattern helper

- [ ] `P1` 给每次发布补真实浏览器验收套件
  - 这次手工验收覆盖了 `read_page`、`fill_form`、点击、等待、悬停、拖拽、截图、console 证据、新标签识别、标签组；这些应该变成发布前可重复跑的检查
  - 建议子任务：
    1. 加一个本地 fixture 页面，包含表单、异步更新、console 输出、新标签链接、hover 区域、拖拽区域、剪贴板输入框
    2. 加一个通过 stdio MCP 客户端调用工具的 smoke 脚本，不直接 import 扩展内部代码
    3. 脚本跑完要能清理现场：关闭创建的标签页、取消标签组、停止本地服务、尽量恢复剪贴板内容
    4. 输出一份简短的 release checklist，方便发布前确认
  - 验收方向：每个候选版本都能证明浏览器扩展、native bridge、stdio server、工具 schema 在真实浏览器里能一起工作
  - 主要模块：`app/native-server`、`app/chrome-extension/tests`、发布脚本

- [ ] `P1` 让工具列表和版本新旧更容易确认
  - 发现的问题：新启动的 MCP 客户端能看到 `chrome_clipboard` 和 `chrome_tab_group`，但已经运行中的 agent 会话可能还拿着旧工具列表，需要重连或重启才刷新
  - 建议子任务：
    1. 增加一个轻量 health/version 工具或状态字段，返回扩展版本、bridge 版本、schema 版本、扩展 ID、已连接 tab 数
    2. 文档里写清楚安装新扩展后的刷新顺序：重载扩展、重启 MCP client/agent、确认 tool schema 版本
    3. native bridge 响应里考虑带 schema hash，方便发现客户端还在用旧缓存
  - 验收方向：用户和 agent 能快速确认自己用的是新工具，不是旧 schema
  - 主要模块：`register-tools.ts`、`mcp-server-stdio.ts`、native host 连接/状态代码、文档

- [ ] `P1` 降低调试证据里的噪音
  - 发现的问题：`chrome_collect_debug_evidence` 能拿到页面日志，但也会混入其他已安装扩展的 console 输出和 runtime exception
  - 建议子任务：
    1. 默认优先返回页面来源日志，扩展/content-script 日志改成可选
    2. 按 source URL 分组 console 信息，把页面错误放在第三方扩展噪音前面
    3. 增加按页面 URL、扩展 URL、日志级别、已知无害 content-script 消息过滤的选项
  - 验收方向：网页没反应时，返回的第一批证据应该优先指向网页本身，而不是无关浏览器扩展
  - 主要模块：`console.ts`、`console-buffer.ts`、`debug-evidence.ts`

### 中期方向

- [ ] 录制与回放从“能跑”补到“稳定可复用”
- [ ] 工作流自动化从“单次执行”补到“可发布、可调试、可定时”
- [ ] 增强浏览器支持（先把 Chrome / Edge 稳住，再评估 Firefox）
- [ ] 身份认证和工具权限分级

---

**想要为这些功能中的任何一个做贡献？** 查看我们的[贡献指南](docs/CONTRIBUTING_zh.md)并加入我们的开发社区！

## 📄 许可证

本项目采用 MIT 许可证 - 详见 [LICENSE](LICENSE) 文件。

## 📚 更多文档

- [架构设计](docs/ARCHITECTURE_zh.md) - 详细的技术架构说明
- [工具列表](docs/TOOLS_zh.md) - 完整的工具 API 文档
- [故障排除](docs/TROUBLESHOOTING_zh.md) - 常见问题解决方案

## 微信交流群

拉群的目的是让踩过坑的大佬们互相帮忙解答问题，因本人平时要忙着搬砖，不一定能及时解答

![IMG_6296](https://github.com/user-attachments/assets/ecd2e084-24d2-4038-b75f-3ab020b55594)
