# mcp-chrome-community API 参考 📚

所有可用工具及其参数的完整参考。

## 📋 目录

- [浏览器管理](#浏览器管理)
- [截图和视觉](#截图和视觉)
- [网络监控](#网络监控)
- [内容分析](#内容分析)
- [交互操作](#交互操作)
- [数据管理](#数据管理)
- [响应格式](#响应格式)

## 📊 浏览器管理

### `chrome_health`

返回当前扩展、bridge、工具 schema 和浏览器标签页概况。升级或重载扩展后，可用它确认 MCP 客户端拿到的是新工具列表。

升级后的确认顺序：先在 `chrome://extensions/` 重载扩展，再重启 MCP client / agent，最后调用 `chrome_health` 对比 `extension.version`、`bridge.version` 和 `schema.schemaHash`。

**参数**：无

**返回重点**：

- `extension`：扩展 ID、名称、版本、manifest 版本
- `bridge`：native bridge 名称、版本、当前 MCP transport / session 信息（经 MCP 调用时返回）
- `schema`：工具数量、工具名列表、`schemaHash`
- `browser`：当前窗口数、标签页数、活动标签页
- `nativeHost`：最近记录的 native server 状态和自动连接设置

### `get_windows_and_tabs`

列出当前打开的所有浏览器窗口和标签页。

**参数**：无

**响应**：

```json
{
  "windowCount": 2,
  "tabCount": 5,
  "windows": [
    {
      "windowId": 123,
      "focused": true,
      "state": "normal",
      "type": "normal",
      "top": 80,
      "left": 120,
      "width": 1440,
      "height": 900,
      "activeTabId": 456,
      "tabs": [
        {
          "tabId": 456,
          "windowId": 123,
          "url": "https://example.com",
          "title": "示例页面",
          "active": true,
          "status": "complete",
          "openerTabId": null,
          "index": 0
        }
      ]
    }
  ]
}
```

**返回重点**：

- `windows[]`：每个窗口现在会带 `focused`、`state`、`type`、`top`、`left`、`width`、`height`、`activeTabId`
- `tabs[]`：每个标签页现在会带 `windowId`、`status`、`openerTabId`、`index`

### `chrome_list_frames`

列出一个标签页里的所有 frame，方便先确认该用哪个 `frameId` 再去操作 iframe。

**参数**：

- `tabId`（数字，可选）：指定目标标签页 ID（默认：当前活动标签页）
- `windowId`（数字，可选）：当没传 `tabId` 时，从这个窗口里取活动标签页
- `includeDetails`（布尔值，可选）：是否补充每个 frame 的 `title`、`readyState`、可交互元素信号（默认：true）

**示例**：

```json
{
  "tabId": 456,
  "includeDetails": true
}
```

**返回重点**：

- `frameCount`：找到的 frame 数量
- `frames[]`：每个 frame 至少包含 `frameId`、`parentFrameId`、`depth`、`isTopFrame`、`url`
- 开启 `includeDetails` 时，每个 frame 还可能带 `title`、`readyState`、`interactiveElementCount`、`hasInteractiveElements`

### `chrome_navigate`

导航到指定 URL，可选择控制视口。

**参数**：

- `url` (字符串，必需)：要导航到的 URL
- `newWindow` (布尔值，可选)：创建新窗口（默认：false）
- `width` (数字，可选)：视口宽度（像素，默认：1280）
- `height` (数字，可选)：视口高度（像素，默认：720）

**示例**：

```json
{
  "url": "https://example.com",
  "newWindow": true,
  "width": 1920,
  "height": 1080
}
```

### `chrome_close_tabs`

关闭指定标签页、按 URL 关闭匹配标签页，或在不传目标时关闭当前活动标签页。

**参数**：

- `tabIds` (数组，可选)：要关闭的标签页 ID 数组
- `url` (字符串，可选)：关闭匹配这个 URL 或 URL pattern 的标签页；可替代 `tabIds`

**示例**：

```json
{
  "tabIds": [123, 456]
}
```

**返回重点**：

- `closedCount`、`closedTabIds`：实际关闭了哪些标签页
- `activeContextAfterClose`：关闭后自动选中的下一个活动标签页上下文
- `remainingActiveContexts`：受影响窗口里剩余活动标签页的摘要
- `affectedWindowIds`：这次关闭影响到的窗口 ID

### `chrome_switch_tab`

切换到指定的浏览器标签页。

**参数**：

- `tabId` (数字，必需)：要切换到的标签页的 ID。
- `windowId` (数字，可选)：该标签页所在窗口的 ID。

**示例**：

```json
{
  "tabId": 456,
  "windowId": 123
}
```

### `chrome_wait_for_tab`

等待一个新打开的标签页，或者等待一个满足指定 opener / URL / title 条件的标签页。

适合点按钮后跳 OAuth、支付、登录、新窗口回调这类场景。

为了避免误命中旧标签页，工具只会在两种情况下立刻返回已存在标签页：传了 `openerTabId`，或者 `includeExisting=true` 且同时给了像 `urlPattern`、`titlePattern` 这样的明确匹配条件。

**参数**：

- `openerTabId`（数字，可选）：匹配由这个来源标签页打开的目标标签页
- `windowId`（数字，可选）：只匹配这个窗口里的标签页
- `urlPattern`（字符串，可选）：URL 匹配字符串
- `titlePattern`（字符串，可选）：标题匹配字符串
- `match`（字符串，可选）：`contains`、`equals`、`regex`（默认：`contains`）
- `status`（字符串，可选）：`any`、`loading`、`complete`（默认：`complete`）
- `active`（布尔值，可选）：是否要求目标标签页处于激活状态
- `includeExisting`（布尔值，可选）：允许立刻返回已经存在的匹配标签页
- `timeoutMs`（数字，可选）：总超时毫秒数（默认：`10000`，最大：`120000`）

**示例**：

```json
{
  "openerTabId": 456,
  "urlPattern": "auth.example.com",
  "timeoutMs": 15000
}
```

**返回重点**：

- `waitedMs`：实际等待了多久
- `tab`：包含 `tabId`、`windowId`、`openerTabId`、`url`、`title`、`status`、`active`、`index`
- `tab.matchedBy`：`existing`、`created`、`updated`
- `tab.openedAfterStart`：这个标签页是不是在开始等待后才出现

### `chrome_go_back_or_forward`

浏览器历史导航。

**参数**：

- `direction` (字符串，必需)："back" 或 "forward"
- `tabId` (数字，可选)：特定标签页 ID（默认：活动标签页）

**示例**：

```json
{
  "direction": "back",
  "tabId": 123
}
```

## 📸 截图和视觉

### `chrome_screenshot`

使用各种选项进行高级截图。

现在默认更适合 agent 用：

- `fullPage` 默认是 `false`
- `storeBase64` 返回的是压缩后的内联图片，避免太大
- 如果传了 `storeBase64=true`，但没显式传 `savePng`，工具默认**不再额外落一个文件**
- 如果你想同时拿内联图片和下载到本地的 PNG，显式传 `savePng=true`

**参数**：

- `name` (字符串，可选)：截图文件名
- `selector` (字符串，可选)：元素截图的 CSS 选择器
- `tabId` (数字，可选)：目标标签页 ID（默认：活动标签页）
- `background` (布尔值，可选)：尽量不把标签页切到前台
- `width` (数字，可选)：宽度（像素，默认：800）
- `height` (数字，可选)：高度（像素，默认：600）
- `storeBase64` (布尔值，可选)：直接返回压缩后的 base64 数据（默认：false）
- `fullPage` (布尔值，可选)：是否截整页（默认：false）
- `savePng` (布尔值，可选)：是否把 PNG 存到 Downloads。默认是 `true`；但如果传了 `storeBase64=true` 且没显式传 `savePng`，默认会变成 `false`
- `imageFormat` (字符串，可选)：内联 base64 图片格式，支持 `image/jpeg`、`image/webp`（默认：`image/jpeg`）
- `quality` (数字，可选)：内联 base64 压缩质量，范围 `0.3` 到 `0.95`
- `maxOutputWidth` / `maxOutputHeight` (数字，可选)：限制内联图片尺寸，避免给模型太大的图
- `maxHeight` (数字，可选)：整页截图时允许捕获的最大高度，超出会截断

**示例**：

```json
{
  "selector": ".main-content",
  "storeBase64": true,
  "savePng": false,
  "maxOutputWidth": 1200
}
```

**返回重点**：

```json
{
  "success": true,
  "base64Data": "/9j/4AAQSkZJRgABAQ...",
  "mimeType": "image/jpeg",
  "base64Length": 182344,
  "captureKind": "element",
  "originalDimensions": {
    "width": 1920,
    "height": 1080
  },
  "outputDimensions": {
    "width": 1200,
    "height": 675
  }
}
```

## 🌐 网络监控

### `chrome_network_capture_start`

使用 webRequest API 开始捕获网络请求。

**参数**：

- `url` (字符串，可选)：具体的 `http(s)` URL 会新开标签页，并从第一次导航开始抓；像 `https://example.com/*` 这样的匹配模式只会附着到已打开的标签页
- `maxCaptureTime` (数字，可选)：最大捕获时间（毫秒，默认：180000）
- `inactivityTimeout` (数字，可选)：无活动后停止时间（毫秒，默认：60000，传 `0` 可关闭）
- `includeStatic` (布尔值，可选)：是否包含 HTML、图片、脚本、样式等文档/静态响应（默认：false）。为 false 时，会过滤顶层页面文档和静态资源，但仍保留 XHR/fetch 触发的响应，即使响应类型是 `text/html`；如果只是页面导航，没有额外请求，仍可能返回 0 条

**示例**：

```json
{
  "url": "https://api.example.com",
  "maxCaptureTime": 60000,
  "includeStatic": false
}
```

### `chrome_network_capture_stop`

停止网络捕获并返回收集的数据。

**参数**：无

**响应**：

```json
{
  "success": true,
  "requestCount": 2,
  "matchedRequests": 2,
  "ignoredRequests": {
    "filteredByUrl": 1,
    "filteredByMimeType": 0,
    "overLimit": 0
  },
  "ignoredRequestCount": 1,
  "stopReason": "user_request",
  "captureAlreadyStopped": false,
  "requests": [
    {
      "url": "https://api.example.com/data",
      "method": "GET",
      "status": 200,
      "specificRequestHeaders": {},
      "specificResponseHeaders": {},
      "responseTime": 150
    }
  ],
  "summary": {
    "matchedRequests": 2,
    "ignoredRequestCount": 1,
    "totalObservedRequests": 3,
    "stopReason": "user_request"
  }
}
```

### `chrome_network_debugger_start`

使用 Chrome Debugger API 开始捕获（包含响应体）。

**参数**：

- `url` (字符串，可选)：要导航并捕获的 URL

### `chrome_network_debugger_stop`

停止调试器捕获并返回包含响应体的数据。

### `chrome_network_request`

发送自定义 HTTP 请求。

**参数**：

- `url` (字符串，必需)：请求 URL
- `method` (字符串，可选)：HTTP 方法（默认："GET"）
- `headers` (对象，可选)：请求头
- `body` (字符串，可选)：请求体

**示例**：

```json
{
  "url": "https://api.example.com/data",
  "method": "POST",
  "headers": {
    "Content-Type": "application/json"
  },
  "body": "{\"key\": \"value\"}"
}
```

## 🔍 内容分析

### `search_tabs_content`

跨浏览器标签页的 AI 驱动语义搜索。

**参数**：

- `query` (字符串，必需)：搜索查询

**示例**：

```json
{
  "query": "机器学习教程"
}
```

**响应**：

```json
{
  "success": true,
  "totalTabsSearched": 10,
  "matchedTabsCount": 3,
  "vectorSearchEnabled": true,
  "indexStats": {
    "totalDocuments": 150,
    "totalTabs": 10,
    "semanticEngineReady": true
  },
  "matchedTabs": [
    {
      "tabId": 123,
      "url": "https://example.com/ml-tutorial",
      "title": "机器学习教程",
      "semanticScore": 0.85,
      "matchedSnippets": ["机器学习简介..."],
      "chunkSource": "content"
    }
  ]
}
```

### `chrome_get_web_content`

从网页提取 HTML 或文本内容。

**参数**：

- `format` (字符串，可选)："html" 或 "text"（默认："text"）
- `selector` (字符串，可选)：特定元素的 CSS 选择器
- `tabId` (数字，可选)：特定标签页 ID（默认：活动标签页）

**示例**：

```json
{
  "format": "text",
  "selector": ".article-content"
}
```

### `chrome_query_elements`

直接查 DOM 元素并返回结构化列表。适合 `chrome_read_page` 不够细的时候，比如要批量拿元素、hidden 节点、属性、可见性和可复用的 ref。

**参数**：

- `selector`（字符串，必需）：CSS 或 XPath 选择器
- `selectorType`（字符串，可选）：`css` 或 `xpath`（默认：`css`）
- `refId`（字符串，可选）：来自 `chrome_read_page` 的根节点 ref，只在这个 subtree 里查
- `tabId` / `windowId` / `frameId`（可选）：指定目标标签页或 frame
- `includeHidden`（布尔值，可选）：是否包含 hidden 元素（默认：`false`）
- `limit`（数字，可选）：最多返回多少个元素（默认：`25`，最大：`200`）

**示例**：

```json
{
  "selector": ".line-item input",
  "includeHidden": true,
  "limit": 20
}
```

**返回重点**：

- `elements[]`：每个元素至少包含 `ref`、`selectorHint`、`text`、`role`、`attributes`、`visible`、`enabled`、`tagName`、`frameId`
- `matchedFrameIds`：哪些 frame 里命中了
- `truncated`：结果是否因为上限或扫描保护被截断

### `chrome_get_element_html`

读取单个元素的真实 DOM HTML。可以传 `chrome_read_page` / `chrome_query_elements` 返回的 `ref`，也可以直接传 selector。默认返回 `outerHTML`，hidden 元素也能读。

**参数**：

- `ref` / `refId`（字符串，可选）：要读取的元素 ref
- `selector`（字符串，可选）：目标元素的 CSS 或 XPath 选择器
- `selectorType`（字符串，可选）：`css` 或 `xpath`（默认：`css`）
- `tabId` / `windowId` / `frameId`（可选）：指定目标标签页或 frame
- `includeOuterHtml`（布尔值，可选）：`true` 返回 `outerHTML`，`false` 返回 `innerHTML`（默认：`true`）
- `maxLength`（数字，可选）：最多返回多少字符（默认：`20000`，最大：`200000`）

**示例**：

```json
{
  "ref": "ref_12",
  "maxLength": 40000
}
```

**返回重点**：

- `html`：目标节点的 HTML 片段
- `htmlLength`：截断前的原始长度
- `truncated`：是否被截断
- `ref`、`selectorHint`、`attributes`、`visible`、`enabled`、`tagName`、`frameId`

### `chrome_console`

抓标签页里的 console 日志和未捕获 runtime exception。

想拿“最近日志”时用 `mode: "buffer"`；只看报错时配 `onlyErrors: true`；怕下次重复读到同一批日志时，用 `clear` 或 `clearAfterRead`。

**参数**：

- `tabId` / `windowId` / `url`（可选）：指定目标标签页
- `background`（布尔值，可选）：如果需要先导航，再尽量不抢前台
- `mode`（字符串，可选）：`snapshot` 或 `buffer`（默认：`snapshot`）
- `buffer`（布尔值，可选）：`mode: "buffer"` 的别名
- `includeExceptions`（布尔值，可选）：是否包含未捕获 runtime exception（默认：`true`）
- `maxMessages` / `limit`（数字，可选）：最多返回多少条 console 消息
- `onlyErrors`（布尔值，可选）：只返回 error/assert 日志
- `pattern`（字符串，可选）：按正则过滤消息 / 异常文本
- `clear`（布尔值，可选）：仅 buffer 模式；读取前清空
- `clearAfterRead`（布尔值，可选）：仅 buffer 模式；读取后清空

**示例**：

```json
{
  "tabId": 456,
  "mode": "buffer",
  "onlyErrors": true,
  "clearAfterRead": true,
  "limit": 20
}
```

**返回重点**：

- `messages[]`：最近的 console 日志
- `exceptions[]`：未捕获 runtime exception
- `messageCount`、`exceptionCount`
- `captureStartTime`、`captureEndTime`、`totalDurationMs`
- `messageLimitReached`、`droppedMessageCount`、`droppedExceptionCount`

### `chrome_collect_debug_evidence`

收一份紧凑的调试证据包：当前标签页上下文、可选截图、最近 console / runtime error，以及最近一次网络抓包摘要（如果有）。

`consoleMode` 设成 `auto` 时，工具会优先读该标签页的 console buffer；拿不到合适结果再退回 snapshot 模式。

**参数**：

- `tabId` / `windowId`（可选）：指定目标标签页
- `includeScreenshot`（布尔值，可选）：是否带压缩后的截图（默认：`true`）
- `background`（布尔值，可选）：截图时尽量走不抢前台的方式（默认：`true`）
- `fullPage`（布尔值，可选）：截整页，不只截当前视口
- `includeConsole`（布尔值，可选）：是否带 console 和 runtime exception 证据（默认：`true`）
- `consoleMode`（字符串，可选）：`auto`、`buffer`、`snapshot`（默认：`auto`）
- `includeExceptions`（布尔值，可选）：是否带未捕获 runtime exception（默认：`true`）
- `onlyErrors`（布尔值，可选）：只带 error 级别 console 日志
- `consoleLimit`（数字，可选）：最多返回多少条 console 消息（默认：`20`）
- `includeExtensionConsole`（布尔值，可选）：是否带 `chrome-extension://` / `moz-extension://` 来源日志（默认：`false`）
- `clearConsole` / `clearConsoleAfterRead`（布尔值，可选）：仅 buffer 模式有效
- `includeNetworkSummary`（布尔值，可选）：如果有，顺手带最近网络抓包摘要（默认：`true`）
- `networkLimit`（数字，可选）：网络摘要里最多带多少条最近请求

**示例**：

```json
{
  "tabId": 456,
  "consoleMode": "auto",
  "onlyErrors": true,
  "includeNetworkSummary": true
}
```

**返回重点**：

- `tab`：`tabId`、`windowId`、`url`、`title`、`status`、`active`、`index`
- `screenshot`：`captured`、`mimeType`、`base64Data`、`base64Length`
- `console`：`source`、`historyAvailable`、`messageCount`、`exceptionCount`、`sourceGroups`、`runtimeExceptionSummary`
- 默认会过滤其他扩展的 console 噪音；如果确实要查 content-script 或扩展日志，传 `includeExtensionConsole=true`
- `network`：`available`、`backend`、`source`、`failedRequestCount`、`recentRequests[]`

### `chrome_get_interactive_elements`

查找页面上可点击和交互的元素。

**参数**：

- `tabId` (数字，可选)：特定标签页 ID（默认：活动标签页）

**响应**：

```json
{
  "elements": [
    {
      "selector": "#submit-button",
      "type": "button",
      "text": "提交",
      "visible": true,
      "clickable": true
    }
  ]
}
```

## 🎯 交互操作

### `chrome_wait_for`

等待某个浏览器条件成立，不用自己手写轮询脚本。

**顶层参数**：

- `tabId` / `windowId` / `frameId`（可选）：指定目标标签页或 frame
- `timeoutMs`（数字，可选）：总超时（默认：10000）
- `pollIntervalMs`（数字，可选）：URL / title / JS / exists 类等待的轮询间隔（默认：200）
- `includeStatic`（布尔值，可选）：只在 `condition.kind = "network"` 时生效
- `condition`（对象，必需）：统一条件描述

**支持的 `condition.kind`**：

- `element`：`{ kind, selector?, ref?, selectorType?, state }`，`state` 支持 `exists | visible | hidden | clickable`
- `text`：`{ kind, text, present? }`
- `url` / `title`：`{ kind, value?, match? }`，`match` 支持 `contains | equals | regex | changed`
- `javascript`：`{ kind, predicate }`
- `network`：`{ kind, urlPattern?, method?, status? }`
- `networkIdle`：`{ kind, idleMs? }`
- `download`：`{ kind, filenameContains?, waitForComplete? }`
- `sleep`：`{ kind, durationMs }`

**示例**：

```json
{
  "condition": {
    "kind": "element",
    "selector": "#submit",
    "state": "visible"
  },
  "timeoutMs": 8000
}
```

```json
{
  "condition": {
    "kind": "url",
    "value": "/dashboard",
    "match": "contains"
  }
}
```

```json
{
  "condition": {
    "kind": "javascript",
    "predicate": "(() => window.appReady === true)"
  }
}
```

### `chrome_assert`

断言某个浏览器条件会在超时内成立。参数里的 `condition` 跟 `chrome_wait_for` 一样，但条件不满足时会直接报错。

**示例**：

```json
{
  "condition": {
    "kind": "title",
    "value": "Checkout",
    "match": "contains"
  },
  "timeoutMs": 5000
}
```

### `chrome_click_element`

使用 CSS 选择器点击元素。

**参数**：

- `selector` (字符串，必需)：目标元素的 CSS 选择器
- `tabId` (数字，可选)：特定标签页 ID（默认：活动标签页）

**示例**：

```json
{
  "selector": "#submit-button"
}
```

### `chrome_fill_or_select`

填充表单字段或选择选项。

**参数**：

- `selector` (字符串，必需)：目标元素的 CSS 选择器
- `value` (字符串，必需)：要填充或选择的值
- `tabId` (数字，可选)：特定标签页 ID（默认：活动标签页）

**示例**：

```json
{
  "selector": "#email-input",
  "value": "user@example.com"
}
```

### `chrome_keyboard`

模拟键盘输入和快捷键。

**参数**：

- `keys` (字符串，必需)：按键组合（如："Ctrl+C"、"Enter"）
- `selector` (字符串，可选)：目标元素选择器
- `delay` (数字，可选)：按键间延迟（毫秒，默认：0）

**示例**：

```json
{
  "keys": "Ctrl+A",
  "selector": "#text-input",
  "delay": 100
}
```

### `chrome_clipboard`

读取、写入、复制选中内容，或把文本粘到页面目标里。

现在会优先在已聚焦页面里调用 Clipboard API；页面不支持或焦点被浏览器拦住时，再尝试 offscreen / `execCommand` 备用通道。

**参数**：

- `action`（字符串，必需）：`read_text`、`write_text`、`paste_text`、`copy_selection`
- `text`（字符串，可选）：`write_text` / `paste_text` 要写入或粘贴的文本；`paste_text` 不传时会先读剪贴板
- `ref`（字符串，可选）：来自 `chrome_read_page` 的元素 ref，用于 `paste_text` / `copy_selection`
- `selector`（字符串，可选）：CSS 或 XPath 目标，用于 `paste_text` / `copy_selection`
- `selectorType`（字符串，可选）：`css` 或 `xpath`，默认 `css`
- `tabId` / `windowId` / `frameId`（可选）：指定目标标签页、窗口或 frame

**返回重点**：

- `clipboardTransport`：实际使用的通道，可能是 `page-navigator`、`offscreen`、`page-exec-command`
- `copy_selection` 会先返回提取到的 `text`；如果系统剪贴板写入失败，会返回 `partialSuccess: true` 和 `clipboardWritten: false`
- `paste_text` 直接改页面输入框时不完全依赖系统剪贴板，更适合普通输入框、`textarea`、`contenteditable`

**示例**：

```json
{
  "action": "paste_text",
  "selector": "#message",
  "text": "hello"
}
```

```json
{
  "action": "copy_selection",
  "selector": "textarea"
}
```

### `chrome_handle_download`

等待下载、查最近一次匹配下载的状态，或者列出最近的下载记录。现在返回里会带标准化 `status`、原始 Chrome `state`、最终保存路径，以及大小/进度信息。

**参数**：

- `action`（字符串，可选）：`wait`（默认）、`status`、`list`
- `id`（数字，可选）：按 Chrome download ID 过滤
- `filenameContains`（字符串，可选）：按文件名、完整路径、URL 或最终 URL 子串过滤
- `startedAfter`（数字，可选）：只看这个 Unix 毫秒时间戳之后开始的下载
- `state`（字符串，可选）：原始 Chrome 状态：`in_progress | complete | interrupted`
- `status`（字符串，可选）：标准化状态：`pending | in_progress | completed | failed`
- `limit`（数字，可选）：`action="list"` 时最多返回多少条（默认：`20`）
- `timeoutMs` / `waitForComplete` / `allowInterrupted`（可选）：只在 `action="wait"` 时生效

**示例**：

```json
{
  "action": "status",
  "filenameContains": "invoice"
}
```

```json
{
  "action": "list",
  "status": "failed",
  "limit": 10
}
```

**返回重点**：

- `status`：标准化生命周期（`pending`、`in_progress`、`completed`、`failed`）
- `state` / `chromeState`：原始 Chrome 下载状态
- `filename` / `fullPath`
- `totalBytes`、`receivedBytes`、`progressPct`、`mimeType`、`exists`、`error`

### `chrome_upload_file`

把文件塞进 `input[type="file"]`，并返回稳定的 `uploadId` 和浏览器侧的文件选择结果。

**参数**：

- `selector`（字符串，必需）：目标文件输入框选择器
- `filePath` / `fileUrl` / `base64Data`：文件来源，三选一
- `fileName`（字符串，可选）：`fileUrl` 或 `base64Data` 场景下使用的文件名
- `tabId` / `windowId`（可选）：指定目标标签页

**返回重点**：

- `uploadId`：后续查状态用的会话 ID
- `status`：浏览器侧执行结果，成功时为 `completed`
- `selectedFiles`、`fileCount`、`inputState`
- `startedAt`、`completedAt`

### `chrome_get_upload_status`

查询最近一次上传尝试的浏览器侧状态。可以直接传 `uploadId`，也可以传 selector 重新检查当前 file input。

**参数**：

- `uploadId`（字符串，可选）：`chrome_upload_file` 返回的会话 ID
- `selector`（字符串，可选）：要重新检查的 file input 选择器
- `tabId` / `windowId`（可选）：做 live 检查时指定目标标签页

**示例**：

```json
{
  "uploadId": "upload_1714300000000_abcd1234"
}
```

**边界**：

- 这里只确认浏览器侧“文件有没有被选进 input”。
- 不会自动判断网站后端是否已经接收或处理完文件，除非页面自己暴露了这类状态。

## 📚 数据管理

### `chrome_history`

使用过滤器搜索浏览器历史记录。

**参数**：

- `text` (字符串，可选)：在 URL/标题中搜索文本
- `startTime` (字符串，可选)：开始日期（ISO 格式）
- `endTime` (字符串，可选)：结束日期（ISO 格式）
- `maxResults` (数字，可选)：最大结果数（默认：100）
- `excludeCurrentTabs` (布尔值，可选)：排除当前标签页（默认：true）

**示例**：

```json
{
  "text": "github",
  "startTime": "2024-01-01",
  "maxResults": 50
}
```

### `chrome_bookmark_search`

按关键词搜索书签。

**参数**：

- `query` (字符串，可选)：搜索关键词
- `maxResults` (数字，可选)：最大结果数（默认：100）
- `folderPath` (字符串，可选)：在特定文件夹内搜索

**示例**：

```json
{
  "query": "文档",
  "maxResults": 20,
  "folderPath": "工作/资源"
}
```

### `chrome_bookmark_add`

添加支持文件夹的新书签。

**参数**：

- `url` (字符串，可选)：要收藏的 URL（默认：当前标签页）
- `title` (字符串，可选)：书签标题（默认：页面标题）
- `parentId` (字符串，可选)：父文件夹 ID 或路径
- `createFolder` (布尔值，可选)：如果不存在则创建文件夹（默认：false）

**示例**：

```json
{
  "url": "https://example.com",
  "title": "示例网站",
  "parentId": "工作/资源",
  "createFolder": true
}
```

### `chrome_bookmark_delete`

按 ID 或 URL 删除书签。

**参数**：

- `bookmarkId` (字符串，可选)：要删除的书签 ID
- `url` (字符串，可选)：要查找并删除的 URL

**示例**：

```json
{
  "url": "https://example.com"
}
```

## 📋 响应格式

所有工具都返回以下格式的响应：

```json
{
  "content": [
    {
      "type": "text",
      "text": "包含实际响应数据的 JSON 字符串"
    }
  ],
  "isError": false
}
```

对于错误：

```json
{
  "content": [
    {
      "type": "text",
      "text": "描述出错原因的错误消息"
    }
  ],
  "isError": true
}
```

## 🔧 使用示例

### 完整工作流示例

```javascript
// 1. 导航到页面
await callTool('chrome_navigate', {
  url: 'https://example.com',
});

// 2. 截图
const screenshot = await callTool('chrome_screenshot', {
  fullPage: true,
  storeBase64: true,
});

// 3. 开始网络监控
await callTool('chrome_network_capture_start', {
  maxCaptureTime: 30000,
});

// 4. 与页面交互
await callTool('chrome_click_element', {
  selector: '#load-data-button',
});

// 5. 语义搜索内容
const searchResults = await callTool('search_tabs_content', {
  query: '用户数据分析',
});

// 6. 停止网络捕获
const networkData = await callTool('chrome_network_capture_stop');

// 7. 保存书签
await callTool('chrome_bookmark_add', {
  title: '数据分析页面',
  parentId: '工作/分析',
});
```

此 API 提供全面的浏览器自动化功能，具有 AI 增强的内容分析和语义搜索特性。
