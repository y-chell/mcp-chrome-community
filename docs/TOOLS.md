# mcp-chrome-community API Reference 📚

Complete reference for all available tools and their parameters.

## 📋 Table of Contents

- [Browser Management](#browser-management)
- [Screenshots & Visual](#screenshots--visual)
- [Network Monitoring](#network-monitoring)
- [Content Analysis](#content-analysis)
- [Interaction](#interaction)
- [Data Management](#data-management)
- [Response Format](#response-format)

## 📊 Browser Management

### `chrome_health`

Return current extension, bridge, tool schema, and browser tab metadata. Use it after extension reloads or upgrades to confirm the MCP client sees the fresh tool list.

Upgrade check order: reload the extension in `chrome://extensions/`, restart the MCP client / agent, then call `chrome_health` and compare `extension.version`, `bridge.version`, and `schema.schemaHash`.

**Parameters**: None

**Response highlights**:

- `extension`: extension ID, name, version, and manifest version
- `bridge`: native bridge name, version, and current MCP transport / session fields (when called through MCP)
- `schema`: tool count, tool names, and `schemaHash`
- `browser`: current window count, tab count, and active tab
- `nativeHost`: latest recorded native server status and auto-connect setting

### `get_windows_and_tabs`

List all currently open browser windows and tabs.

**Parameters**: None

**Response**:

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
          "title": "Example Page",
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

**Response highlights**:

- `windows[]`: each window includes `focused`, `state`, `type`, `top`, `left`, `width`, `height`, and `activeTabId`
- `tabs[]`: each tab includes `windowId`, `status`, `openerTabId`, and `index`

### `chrome_list_frames`

List the frames inside a tab so you can target the right `frameId` for iframe workflows.

**Parameters**:

- `tabId` (number, optional): Target an existing tab by ID (default: active tab)
- `windowId` (number, optional): Use the active tab from this window when `tabId` is omitted
- `includeDetails` (boolean, optional): Include per-frame `title`, `readyState`, and interactive-element signals (default: true)

**Example**:

```json
{
  "tabId": 456,
  "includeDetails": true
}
```

**Response highlights**:

- `frameCount`: number of discovered frames
- `frames[]`: each frame includes `frameId`, `parentFrameId`, `depth`, `isTopFrame`, and `url`
- When `includeDetails` is enabled, each frame may also include `title`, `readyState`, `interactiveElementCount`, and `hasInteractiveElements`

### `chrome_navigate`

Navigate to a URL with optional viewport control.

**Parameters**:

- `url` (string, optional): URL to navigate to (omit when `refresh=true`)
- `newWindow` (boolean, optional): Create new window (default: false)
- `tabId` (number, optional): Target an existing tab by ID (navigate/refresh that tab)
- `background` (boolean, optional): Do not activate the tab or focus the window (default: false)
- `width` (number, optional): Viewport width in pixels (default: 1280)
- `height` (number, optional): Viewport height in pixels (default: 720)

**Example**:

```json
{
  "url": "https://example.com",
  "newWindow": true,
  "width": 1920,
  "height": 1080
}
```

### `chrome_close_tabs`

Close specific tabs, close tabs by URL match, or close the active tab when no target is provided.

**Parameters**:

- `tabIds` (array, optional): Array of tab IDs to close
- `url` (string, optional): Close tabs matching this URL or URL pattern; can be used instead of `tabIds`

**Example**:

```json
{
  "tabIds": [123, 456]
}
```

**Response highlights**:

- `closedCount` and `closedTabIds`: which tabs were closed
- `activeContextAfterClose`: the next active tab context chosen after closing
- `remainingActiveContexts`: active-tab summaries for affected windows
- `affectedWindowIds`: windows touched by this close operation

### `chrome_switch_tab`

Switch to a specific browser tab.

**Parameters**:

- `tabId` (number, required): The ID of the tab to switch to.
- `windowId` (number, optional): The ID of the window where the tab is located.

**Example**:

```json
{
  "tabId": 456,
  "windowId": 123
}
```

### `chrome_wait_for_tab`

Wait for a newly opened tab, or for a tab that matches a specific opener / URL / title condition.

Useful after clicks that open OAuth, payment, sign-in, or redirect result tabs.

To avoid accidental matches, an already-open tab is only returned immediately when you pass `openerTabId`, or when `includeExisting=true` with a real matcher such as `urlPattern` or `titlePattern`.

**Parameters**:

- `openerTabId` (number, optional): Match tabs opened by this source tab
- `windowId` (number, optional): Only match tabs in this window
- `urlPattern` (string, optional): URL matcher string
- `titlePattern` (string, optional): Title matcher string
- `match` (string, optional): `contains`, `equals`, or `regex` (default: `contains`)
- `status` (string, optional): `any`, `loading`, or `complete` (default: `complete`)
- `active` (boolean, optional): Optional active-tab filter
- `includeExisting` (boolean, optional): Allow an already-open matching tab to be returned immediately
- `timeoutMs` (number, optional): Overall timeout in milliseconds (default: `10000`, max: `120000`)

**Example**:

```json
{
  "openerTabId": 456,
  "urlPattern": "auth.example.com",
  "timeoutMs": 15000
}
```

**Response highlights**:

- `waitedMs`: how long the tool waited before a match was found
- `tab`: includes `tabId`, `windowId`, `openerTabId`, `url`, `title`, `status`, `active`, and `index`
- `tab.matchedBy`: `existing`, `created`, or `updated`
- `tab.openedAfterStart`: whether the matched tab appeared after this tool started waiting

### `chrome_go_back_or_forward`

Navigate browser history.

**Parameters**:

- `direction` (string, required): "back" or "forward"
- `tabId` (number, optional): Specific tab ID (default: active tab)

**Example**:

```json
{
  "direction": "back",
  "tabId": 123
}
```

## 📸 Screenshots & Visual

### `chrome_screenshot`

Take advanced screenshots with various options.

Agent-friendly defaults:

- `fullPage` defaults to `false`
- `storeBase64` returns a compressed inline image sized for model input
- if `storeBase64=true` and `savePng` is omitted, the tool does **not** save a file by default
- set `savePng=true` explicitly if you want both inline data and a downloaded PNG file

**Parameters**:

- `name` (string, optional): Screenshot filename
- `selector` (string, optional): CSS selector for element screenshot
- `tabId` (number, optional): Target tab to capture (default: active tab)
- `background` (boolean, optional): Attempt capture without bringing tab/window to foreground (viewport-only uses CDP)
- `width` (number, optional): Width in pixels (default: 800)
- `height` (number, optional): Height in pixels (default: 600)
- `storeBase64` (boolean, optional): Return compressed base64 data inline (default: false)
- `fullPage` (boolean, optional): Capture full page (default: false)
- `savePng` (boolean, optional): Save a PNG file to Downloads. Default: `true`, except when `storeBase64=true` and `savePng` is omitted, in which case it defaults to `false`
- `imageFormat` (string, optional): Inline base64 image format: `image/jpeg` or `image/webp` (default: `image/jpeg`)
- `quality` (number, optional): Inline base64 compression quality, from `0.3` to `0.95`
- `maxOutputWidth` / `maxOutputHeight` (number, optional): Downscale inline base64 output to keep it small for model input
- `maxHeight` (number, optional): Maximum captured height for full-page screenshots before truncation

**Example**:

```json
{
  "selector": ".main-content",
  "storeBase64": true,
  "savePng": false,
  "maxOutputWidth": 1200
}
```

**Response highlights**:

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

## 🌐 Network Monitoring

### `chrome_network_capture_start`

Start capturing network requests using webRequest API.

**Parameters**:

- `url` (string, optional): A concrete `http(s)` URL opens a fresh tab and captures from the first navigation. A match pattern such as `https://example.com/*` attaches to an already-open tab.
- `maxCaptureTime` (number, optional): Maximum capture time in ms (default: 180000)
- `inactivityTimeout` (number, optional): Stop after inactivity in ms (default: 60000, set `0` to disable)
- `includeStatic` (boolean, optional): Include document/static responses like HTML, images, scripts, and stylesheets (default: false). When false, top-level page documents and static assets are filtered, but XHR/fetch responses are still kept even if they return `text/html`; navigation-only pages may still produce 0 captured requests.

**Example**:

```json
{
  "url": "https://api.example.com",
  "maxCaptureTime": 60000,
  "includeStatic": false
}
```

### `chrome_network_capture_stop`

Stop network capture and return collected data.

**Parameters**: None

**Response**:

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

Start capturing with Chrome Debugger API (includes response bodies).

**Parameters**:

- `url` (string, optional): URL to navigate to and capture

### `chrome_network_debugger_stop`

Stop debugger capture and return data with response bodies.

### `chrome_network_request`

Send custom HTTP requests.

**Parameters**:

- `url` (string, required): Request URL
- `method` (string, optional): HTTP method (default: "GET")
- `headers` (object, optional): Request headers
- `body` (string, optional): Request body

**Example**:

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

## 🔍 Content Analysis

### `chrome_read_page`

Build an accessibility-like tree of the current page (visible viewport by default) with stable `ref_*` identifiers and viewport info. Useful for semantic element discovery or agent planning.

Parameters:

- `filter` (string, optional): `interactive` to only include interactive elements; default includes structural and labeled nodes.
- `tabId` (number, optional): Target an existing tab by ID (default: active tab).

Example:

```json
{
  "filter": "interactive"
}
```

Response contains `pageContent` (text tree), `viewport`, and a `refMapCount` summary. Use `chrome_get_interactive_elements` or your own logic to act on returned refs.

### `chrome_query_elements`

Query DOM elements directly and return a structured element list. Use this when `chrome_read_page` is too summary-oriented and you need exact matches, hidden nodes, attributes, or per-element refs.

**Parameters**:

- `selector` (string, required): CSS or XPath selector to query
- `selectorType` (string, optional): `css` or `xpath` (default: `css`)
- `refId` (string, optional): root ref from `chrome_read_page`; limits the query to that subtree
- `tabId` / `windowId` / `frameId` (optional): choose the target tab or frame
- `includeHidden` (boolean, optional): include hidden elements (default: `false`)
- `limit` (number, optional): maximum returned elements (default: `25`, max: `200`)

**Example**:

```json
{
  "selector": ".line-item input",
  "includeHidden": true,
  "limit": 20
}
```

**Response highlights**:

- `elements[]`: each item includes `ref`, `selectorHint`, `text`, `role`, `attributes`, `visible`, `enabled`, `tagName`, `frameId`
- `matchedFrameIds`: frames that returned matches
- `truncated`: whether the result hit the limit or scan cap

### `chrome_get_element_html`

Get the real DOM HTML for a single element. Accepts a `ref` from `chrome_read_page` / `chrome_query_elements` or a selector. Returns `outerHTML` by default, including hidden elements.

**Parameters**:

- `ref` / `refId` (string, optional): element ref to inspect
- `selector` (string, optional): CSS or XPath selector for the target element
- `selectorType` (string, optional): `css` or `xpath` (default: `css`)
- `tabId` / `windowId` / `frameId` (optional): choose the target tab or frame
- `includeOuterHtml` (boolean, optional): return `outerHTML` when true, `innerHTML` when false (default: `true`)
- `maxLength` (number, optional): maximum returned HTML length (default: `20000`, max: `200000`)

**Example**:

```json
{
  "ref": "ref_12",
  "maxLength": 40000
}
```

**Response highlights**:

- `html`: HTML snippet for the matched node
- `htmlLength`: original HTML length before truncation
- `truncated`: whether the HTML was shortened
- `ref`, `selectorHint`, `attributes`, `visible`, `enabled`, `tagName`, `frameId`

### `chrome_console`

Capture console logs and uncaught runtime exceptions from a tab.

Use `mode: "buffer"` when you want recent logs, `onlyErrors: true` for error-only reads, and `clear` / `clearAfterRead` to avoid duplicate evidence on the next read.

**Parameters**:

- `tabId` / `windowId` / `url` (optional): choose the target tab
- `background` (boolean, optional): do not focus the tab when navigating for capture
- `mode` (string, optional): `snapshot` or `buffer` (default: `snapshot`)
- `buffer` (boolean, optional): alias for `mode: "buffer"`
- `includeExceptions` (boolean, optional): include uncaught runtime exceptions (default: `true`)
- `maxMessages` / `limit` (number, optional): maximum returned console messages
- `onlyErrors` (boolean, optional): only return error/assert logs
- `pattern` (string, optional): regex filter for message / exception text
- `clear` (boolean, optional): buffer mode only; clear before reading
- `clearAfterRead` (boolean, optional): buffer mode only; clear after reading

**Example**:

```json
{
  "tabId": 456,
  "mode": "buffer",
  "onlyErrors": true,
  "clearAfterRead": true,
  "limit": 20
}
```

**Response highlights**:

- `messages[]`: recent console entries
- `exceptions[]`: uncaught runtime exceptions
- `messageCount`, `exceptionCount`
- `captureStartTime`, `captureEndTime`, `totalDurationMs`
- `messageLimitReached`, `droppedMessageCount`, `droppedExceptionCount`

### `chrome_collect_debug_evidence`

Collect a compact debugging bundle for the current page: tab context, optional screenshot, recent console/runtime evidence, and a recent network-capture summary when available.

If `consoleMode` is `auto`, the tool prefers the per-tab console buffer and falls back to snapshot capture when needed.

**Parameters**:

- `tabId` / `windowId` (optional): choose the target tab
- `includeScreenshot` (boolean, optional): include a compressed screenshot (default: `true`)
- `background` (boolean, optional): prefer background-friendly screenshot capture (default: `true`)
- `fullPage` (boolean, optional): capture full page instead of the viewport
- `includeConsole` (boolean, optional): include console and runtime exception evidence (default: `true`)
- `consoleMode` (string, optional): `auto`, `buffer`, or `snapshot` (default: `auto`)
- `includeExceptions` (boolean, optional): include uncaught runtime exceptions (default: `true`)
- `onlyErrors` (boolean, optional): only include error-level console logs
- `consoleLimit` (number, optional): max console messages to return (default: `20`)
- `includeExtensionConsole` (boolean, optional): include `chrome-extension://` / `moz-extension://` entries (default: `false`)
- `clearConsole` / `clearConsoleAfterRead` (boolean, optional): buffer mode only
- `includeNetworkSummary` (boolean, optional): include recent network-capture summary when available (default: `true`)
- `networkLimit` (number, optional): max recent requests in the network summary

**Example**:

```json
{
  "tabId": 456,
  "consoleMode": "auto",
  "onlyErrors": true,
  "includeNetworkSummary": true
}
```

**Response highlights**:

- `tab`: `tabId`, `windowId`, `url`, `title`, `status`, `active`, `index`
- `screenshot`: `captured`, `mimeType`, `base64Data`, `base64Length`
- `console`: `source`, `historyAvailable`, `messageCount`, `exceptionCount`, `sourceGroups`, `runtimeExceptionSummary`
- extension-origin console noise is filtered by default; pass `includeExtensionConsole=true` when you need content-script or extension logs
- `network`: `available`, `backend`, `source`, `failedRequestCount`, `recentRequests[]`

### `search_tabs_content`

AI-powered semantic search across browser tabs.

**Parameters**:

- `query` (string, required): Search query

**Example**:

```json
{
  "query": "machine learning tutorials"
}
```

**Response**:

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
      "title": "Machine Learning Tutorial",
      "semanticScore": 0.85,
      "matchedSnippets": ["Introduction to machine learning..."],
      "chunkSource": "content"
    }
  ]
}
```

### `chrome_get_web_content`

Extract HTML or text content from web pages.

**Parameters**:

- `format` (string, optional): "html" or "text" (default: "text")
- `selector` (string, optional): CSS selector for specific elements
- `tabId` (number, optional): Specific tab ID (default: active tab)
- `background` (boolean, optional): Do not activate tab/focus window while fetching (default: false)

**Example**:

```json
{
  "format": "text",
  "selector": ".article-content"
}
```

### `chrome_get_interactive_elements` (deprecated)

Replaced by `chrome_read_page` as the primary discovery tool. The `read_page` implementation will automatically fallback to the interactive-elements logic when the accessibility tree is unavailable or too sparse. This tool is no longer listed via ListTools and is kept only for backward compatibility.

## 🎯 Interaction

### `chrome_computer`

Unified advanced interaction tool that prioritizes high-level DOM actions with CDP fallback. Supports hover, click, drag, scroll, typing, key chords, fill, wait and screenshot. If a recent screenshot was taken via `chrome_screenshot`, coordinates are auto-scaled from screenshot space to viewport space.

Parameters:

- `action` (string, required): `left_click` | `right_click` | `double_click` | `triple_click` | `left_click_drag` | `scroll` | `type` | `key` | `fill` | `hover` | `wait` | `screenshot`
- `tabId` (number, optional): Target an existing tab by ID (default: active tab)
- `background` (boolean, optional): Avoid focusing/activating tab/window for certain operations (best-effort)
- `ref` (string, optional): element ref from `chrome_read_page` (preferred). Used for click/scroll/type/key and as drag end when provided
- `coordinates` (object, optional): `{ "x": 100, "y": 200 }` for click/scroll or drag end
- `startRef` (string, optional): element ref for drag start
- `startCoordinates` (object, optional): for `left_click_drag` when no `startRef`
- `scrollDirection` (string, optional): `up` | `down` | `left` | `right`
- `scrollAmount` (number, optional): ticks 1–10 (default 3)
- `text` (string, optional): for `type` (raw text) or `key` (space-separated chords/keys like `"cmd+a Enter"`)
- `duration` (number, optional): seconds for `wait` (max 30)
- `selector` (string, optional): for `fill` when no `ref`
- `value` (string, optional): for `fill` value

Examples:

```json
{ "action": "left_click", "coordinates": { "x": 420, "y": 260 } }
```

```json
{ "action": "key", "text": "cmd+a Backspace" }
```

````json
{ "action": "fill", "ref": "ref_7", "value": "user@example.com" }

```json
{ "action": "hover", "ref": "ref_12", "duration": 0.6 }
````

````

```json
{ "action": "left_click_drag", "startRef": "ref_10", "ref": "ref_15" }
````

### `chrome_wait_for`

Wait for a browser condition to become true without writing custom polling logic.

**Top-level parameters**:

- `tabId` / `windowId` / `frameId` (optional): choose the target tab or frame
- `timeoutMs` (number, optional): overall timeout (default: 10000)
- `pollIntervalMs` (number, optional): polling interval for URL/title/JS/exists waits (default: 200)
- `includeStatic` (boolean, optional): only used for `condition.kind = "network"`
- `condition` (object, required): unified condition descriptor

**Supported `condition.kind` values**:

- `element`: `{ kind, selector?, ref?, selectorType?, state }`, where `state` is `exists | visible | hidden | clickable`
- `text`: `{ kind, text, present? }`
- `url` / `title`: `{ kind, value?, match? }`, where `match` is `contains | equals | regex | changed`
- `javascript`: `{ kind, predicate }`
- `network`: `{ kind, urlPattern?, method?, status? }`
- `networkIdle`: `{ kind, idleMs? }`
- `download`: `{ kind, filenameContains?, waitForComplete? }`
- `sleep`: `{ kind, durationMs }`

**Examples**:

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

Assert that a browser condition becomes true within the timeout. Uses the same `condition` schema as `chrome_wait_for`, but fails clearly when the condition is not met.

**Example**:

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

Click elements using a ref, selector, or coordinates.

**Parameters**:

- `ref` (string, optional): Element ref from `chrome_read_page` (preferred when available)
- `selector` (string, optional): CSS selector for target element
- `coordinates` (object, optional): `{ "x": 120, "y": 240 }` viewport coordinates

At least one of `ref`, `selector`, or `coordinates` must be provided.

**Example**:

```json
{
  "ref": "ref_42"
}
```

### `chrome_fill_or_select`

Fill form fields or select options.

**Parameters**:

- `ref` (string, optional): Element ref from `chrome_read_page`
- `selector` (string, optional): CSS selector for target element
- `value` (string, required): Value to fill or select

Provide `ref` or `selector` to identify the element.

**Example**:

```json
{
  "ref": "ref_7",
  "value": "user@example.com"
}
```

### `chrome_keyboard`

Simulate keyboard input and shortcuts.

**Parameters**:

- `keys` (string, required): Key combination (e.g., "Ctrl+C", "Enter")
- `selector` (string, optional): Target element selector
- `delay` (number, optional): Delay between keystrokes in ms (default: 0)

**Example**:

```json
{
  "keys": "Ctrl+A",
  "selector": "#text-input",
  "delay": 100
}
```

### `chrome_clipboard`

Read, write, copy selected text, or paste text into a page target.

The tool now prefers the focused page Clipboard API when possible. If the page context or browser focus rules block that path, it falls back to offscreen / `execCommand` transports.

**Parameters**:

- `action` (string, required): `read_text`, `write_text`, `paste_text`, or `copy_selection`
- `text` (string, optional): text for `write_text` / `paste_text`; when omitted, `paste_text` first reads the clipboard
- `ref` (string, optional): element ref from `chrome_read_page` for `paste_text` / `copy_selection`
- `selector` (string, optional): CSS or XPath target for `paste_text` / `copy_selection`
- `selectorType` (string, optional): `css` or `xpath` (default: `css`)
- `tabId` / `windowId` / `frameId` (optional): target tab, window, or frame

**Response highlights**:

- `clipboardTransport`: actual transport, such as `page-navigator`, `offscreen`, or `page-exec-command`
- `copy_selection` returns extracted `text` first; if writing to the system clipboard fails, it returns `partialSuccess: true` and `clipboardWritten: false`
- `paste_text` can directly update page inputs and is usually the better choice for normal inputs, `textarea`, and `contenteditable`

**Examples**:

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

Wait for a browser download, fetch the latest matching download status, or list recent downloads. The response now includes normalized `status`, raw Chrome `state`, the final file path, and size/progress fields.

**Parameters**:

- `action` (string, optional): `wait` (default), `status`, or `list`
- `id` (number, optional): filter by Chrome download ID
- `filenameContains` (string, optional): substring filter for filename, full path, URL, or final URL
- `startedAfter` (number, optional): only include downloads started on/after this Unix timestamp in ms
- `state` (string, optional): raw Chrome state: `in_progress | complete | interrupted`
- `status` (string, optional): normalized state: `pending | in_progress | completed | failed`
- `limit` (number, optional): for `action="list"`, maximum returned items (default: `20`)
- `timeoutMs` / `waitForComplete` / `allowInterrupted` (optional): only used by `action="wait"`

**Examples**:

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

**Response highlights**:

- `status`: normalized lifecycle (`pending`, `in_progress`, `completed`, `failed`)
- `state` / `chromeState`: raw Chrome download state
- `filename` / `fullPath`
- `totalBytes`, `receivedBytes`, `progressPct`, `mimeType`, `exists`, `error`

### `chrome_upload_file`

Upload files into `input[type="file"]` and return a stable `uploadId` plus browser-side selection details.

**Parameters**:

- `selector` (string, required): target file input selector
- `filePath` / `fileUrl` / `base64Data`: file source (provide one)
- `fileName` (string, optional): name used when the source is `fileUrl` or `base64Data`
- `tabId` / `windowId` (optional): choose the target tab

**Response highlights**:

- `uploadId`: session id for follow-up status checks
- `status`: browser-side execution result (`completed` on success)
- `selectedFiles`, `fileCount`, `inputState`
- `startedAt`, `completedAt`

### `chrome_get_upload_status`

Get the latest browser-side status for a file upload attempt. You can look it up by `uploadId`, or inspect the current file input by selector.

**Parameters**:

- `uploadId` (string, optional): session id returned by `chrome_upload_file`
- `selector` (string, optional): file input selector for a live re-check
- `tabId` / `windowId` (optional): choose the target tab for live inspection

**Example**:

```json
{
  "uploadId": "upload_1714300000000_abcd1234"
}
```

**Boundary**:

- This confirms browser-side file selection state only.
- It does **not** infer whether the website has already processed or uploaded the file to its backend unless the page itself exposes that state.

## 📚 Data Management

### `chrome_history`

Search browser history with filters.

**Parameters**:

- `text` (string, optional): Search text in URL/title
- `startTime` (string, optional): Start date (ISO format)
- `endTime` (string, optional): End date (ISO format)
- `maxResults` (number, optional): Maximum results (default: 100)
- `excludeCurrentTabs` (boolean, optional): Exclude current tabs (default: true)

**Example**:

```json
{
  "text": "github",
  "startTime": "2024-01-01",
  "maxResults": 50
}
```

### `chrome_bookmark_search`

Search bookmarks by keywords.

**Parameters**:

- `query` (string, optional): Search keywords
- `maxResults` (number, optional): Maximum results (default: 100)
- `folderPath` (string, optional): Search within specific folder

**Example**:

```json
{
  "query": "documentation",
  "maxResults": 20,
  "folderPath": "Work/Resources"
}
```

### `chrome_bookmark_add`

Add new bookmarks with folder support.

**Parameters**:

- `url` (string, optional): URL to bookmark (default: current tab)
- `title` (string, optional): Bookmark title (default: page title)
- `parentId` (string, optional): Parent folder ID or path
- `createFolder` (boolean, optional): Create folder if not exists (default: false)

**Example**:

```json
{
  "url": "https://example.com",
  "title": "Example Site",
  "parentId": "Work/Resources",
  "createFolder": true
}
```

### `chrome_bookmark_delete`

Delete bookmarks by ID or URL.

**Parameters**:

- `bookmarkId` (string, optional): Bookmark ID to delete
- `url` (string, optional): URL to find and delete

**Example**:

```json
{
  "url": "https://example.com"
}
```

## 📋 Response Format

All tools return responses in the following format:

```json
{
  "content": [
    {
      "type": "text",
      "text": "JSON string containing the actual response data"
    }
  ],
  "isError": false
}
```

For errors:

```json
{
  "content": [
    {
      "type": "text",
      "text": "Error message describing what went wrong"
    }
  ],
  "isError": true
}
```

## 🔧 Usage Examples

### Complete Workflow Example

```javascript
// 1. Navigate to a page
await callTool('chrome_navigate', {
  url: 'https://example.com',
});

// 2. Take a screenshot
const screenshot = await callTool('chrome_screenshot', {
  fullPage: true,
  storeBase64: true,
});

// 3. Start network monitoring
await callTool('chrome_network_capture_start', {
  maxCaptureTime: 30000,
});

// 4. Interact with the page
await callTool('chrome_click_element', {
  selector: '#load-data-button',
});

// 5. Search content semantically
const searchResults = await callTool('search_tabs_content', {
  query: 'user data analysis',
});

// 6. Stop network capture
const networkData = await callTool('chrome_network_capture_stop');

// 7. Save bookmark
await callTool('chrome_bookmark_add', {
  title: 'Data Analysis Page',
  parentId: 'Work/Analytics',
});
```

This API provides comprehensive browser automation capabilities with AI-enhanced content analysis and semantic search features.
