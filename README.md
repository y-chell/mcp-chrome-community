# mcp-chrome-community 🚀

[![Stars](https://img.shields.io/github/stars/y-chell/mcp-chrome-community)](https://github.com/y-chell/mcp-chrome-community)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.8+-blue.svg)](https://www.typescriptlang.org/)
[![Chrome Extension](https://img.shields.io/badge/Chrome-Extension-green.svg)](https://developer.chrome.com/docs/extensions/)
[![Release](https://img.shields.io/github/v/release/y-chell/mcp-chrome-community.svg)](https://github.com/y-chell/mcp-chrome-community/releases)

> 🌟 **Turn your Chrome browser into your intelligent assistant** - Let AI take control of your browser, transforming it into a powerful AI-controlled automation tool.

> Community-maintained fork: https://github.com/y-chell/mcp-chrome-community
>
> Original upstream: https://github.com/hangwin/mcp-chrome
>
> This fork exists because upstream appeared inactive and had gone more than four months without updates when the community fork started moving again. Waiting indefinitely would block fixes and overdue improvements, so this repo continues independently and prioritizes practical improvements.

**📖 Documentation**: [English](README.md) | [中文](README_zh.md)

> This community fork is under active maintenance. Current work focuses on stability fixes, browser compatibility updates, and stronger real-world browser automation capabilities.

---

## 🎯 What is mcp-chrome-community?

mcp-chrome-community is a Chrome extension-based **Model Context Protocol (MCP) server** that exposes your Chrome browser functionality to AI assistants like Claude, enabling complex browser automation, content analysis, and semantic search. Unlike traditional browser automation tools (like Playwright), **mcp-chrome-community** directly uses your daily Chrome browser, leveraging existing user habits, configurations, and login states, allowing various large models or chatbots to take control of your browser and truly become your everyday assistant.

## ✨ Featured Addition

- **A New Visual Editor for Claude Code & Codex**, for more detail here: [VisualEditor](docs/VisualEditor.md)

## ✨ Core Features

- 😁 **Chatbot/Model Agnostic**: Let any LLM or chatbot client or agent you prefer automate your browser
- ⭐️ **Use Your Original Browser**: Seamlessly integrate with your existing browser environment (your configurations, login states, etc.)
- 💻 **Fully Local**: Pure local MCP server ensuring user privacy
- 🚄 **Streamable HTTP**: Streamable HTTP connection method
- 🏎 **Cross-Tab**: Cross-tab context
- 🧠 **Semantic Search**: Built-in vector database for intelligent browser tab content discovery
- 🔍 **Smart Content Analysis**: AI-powered text extraction and similarity matching
- 🌐 **25+ Tools**: Support for screenshots, network monitoring, interactive operations, bookmark management, browsing history, and 25+ other tools
- 🚀 **SIMD-Accelerated AI**: Custom WebAssembly SIMD optimization for 4-8x faster vector operations

## 🆚 Comparison with Similar Projects

| Comparison Dimension    | Playwright-based MCP Server                                                                                               | Chrome Extension-based MCP Server                                                                      |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| **Resource Usage**      | ❌ Requires launching independent browser process, installing Playwright dependencies, downloading browser binaries, etc. | ✅ No need to launch independent browser process, directly utilizes user's already open Chrome browser |
| **User Session Reuse**  | ❌ Requires re-login                                                                                                      | ✅ Automatically uses existing login state                                                             |
| **Browser Environment** | ❌ Clean environment lacks user settings                                                                                  | ✅ Fully preserves user environment                                                                    |
| **API Access**          | ⚠️ Limited to Playwright API                                                                                              | ✅ Full access to Chrome native APIs                                                                   |
| **Startup Speed**       | ❌ Requires launching browser process                                                                                     | ✅ Only needs to activate extension                                                                    |
| **Response Speed**      | 50-200ms inter-process communication                                                                                      | ✅ Faster                                                                                              |

## 🚀 Quick Start

### Prerequisites

- Node.js 20+ (minimum)
- Node.js 22 or 24 LTS recommended
- CI and release builds currently run on Node.js 24
- Node.js 25 may work, but it is not part of the tested support matrix yet
- Chrome/Chromium browser

### Installation Steps

1. **Download the latest release assets from GitHub**

Download link: https://github.com/y-chell/mcp-chrome-community/releases

You need these two files from the latest release:

- `mcp-chrome-community-extension-<version>.zip`
- `mcp-chrome-community-bridge-v<version>.tgz`

2. **Install the native host from the downloaded `.tgz`**

npm

```bash
npm install -g /path/to/mcp-chrome-community-bridge-v<version>.tgz
```

pnpm

```bash
# pnpm users should run register once after installing from the release package
pnpm add -g /path/to/mcp-chrome-community-bridge-v<version>.tgz
mcp-chrome-community register
```

> This community fork is installed from the GitHub Release `.tgz` asset. `npm install -g mcp-chrome-community-bridge` may install a different package than the one in this repository.

3. **Load Chrome Extension**
   - Extract `mcp-chrome-community-extension-<version>.zip` first
   - Open Chrome and go to `chrome://extensions/`
   - Enable "Developer mode"
   - Click "Load unpacked" and select the extracted extension folder
   - Click the extension icon to open the plugin, then click connect to see the MCP configuration

   Release builds keep a fixed unpacked extension ID for Native Messaging. If you build the extension yourself without `CHROME_EXTENSION_KEY`, Chrome will assign a different ID and the default native host manifest will not match.

<img width="420" alt="mcp-chrome-community extension popup showing the MCP config after connecting" src="docs/images/readme-extension-connect.png" />

If you want to build from source instead of using release assets, see [Contributing Guide](docs/CONTRIBUTING.md).

### Usage with MCP Protocol Clients

#### Using Streamable HTTP Connection (👍🏻 Recommended)

Add the following configuration to your MCP client configuration (using CherryStudio as an example):

> Streamable HTTP connection method is recommended

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

Default URL is `http://127.0.0.1:12306/mcp`. If you override host or port with `CHROME_MCP_HOST` / `MCP_HTTP_HOST` or `CHROME_MCP_PORT` / `MCP_HTTP_PORT`, update the client URL to match your actual address.

#### Using STDIO Connection (Alternative)

If your client only supports stdio connection method, please use the following approach:

1. First, find your global `node_modules` directory

```sh
# npm
npm root -g
# pnpm
pnpm root -g
```

Then append:

```text
mcp-chrome-community-bridge/dist/mcp/mcp-server-stdio.js
```

Example final path:

```text
/path/to/global/node_modules/mcp-chrome-community-bridge/dist/mcp/mcp-server-stdio.js
```

2. Replace the configuration below with the final path you just obtained

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

Example config in Augment:

<img width="494" alt="截屏2025-06-22 22 11 25" src="https://github.com/user-attachments/assets/48eefc0c-a257-4d3b-8bbe-d7ff716de2bf" />

## 🛠️ Available Tools

Complete tool list: [Complete Tool List](docs/TOOLS.md)

<details>
<summary><strong>📊 Browser Management (6 tools)</strong></summary>

- `get_windows_and_tabs` - List all browser windows and tabs
- `chrome_navigate` - Navigate to URLs and control viewport
- `chrome_switch_tab` - Switch the current active tab
- `chrome_close_tabs` - Close specific tabs or windows
- `chrome_go_back_or_forward` - Browser navigation control
- `chrome_inject_script` - Inject content scripts into web pages
- `chrome_send_command_to_inject_script` - Send commands to injected content scripts
</details>

<details>
<summary><strong>📸 Screenshots & Visual (1 tool)</strong></summary>

- `chrome_screenshot` - Advanced screenshot capture with element targeting, full-page support, and custom dimensions
</details>

<details>
<summary><strong>🌐 Network Monitoring (4 tools)</strong></summary>

- `chrome_network_capture_start/stop` - webRequest API network capture
- `chrome_network_debugger_start/stop` - Debugger API with response bodies
- `chrome_network_request` - Send custom HTTP requests
</details>

<details>
<summary><strong>🔍 Content Analysis (4 tools)</strong></summary>

- `search_tabs_content` - AI-powered semantic search across browser tabs
- `chrome_get_web_content` - Extract HTML/text content from pages
- `chrome_get_interactive_elements` - Find clickable elements
- `chrome_console` - Capture and retrieve console output from browser tabs
</details>

<details>
<summary><strong>🎯 Interaction (3 tools)</strong></summary>

- `chrome_click_element` - Click elements using CSS selectors
- `chrome_fill_or_select` - Fill forms and select options
- `chrome_keyboard` - Simulate keyboard input and shortcuts
</details>

<details>
<summary><strong>📚 Data Management (5 tools)</strong></summary>

- `chrome_history` - Search browser history with time filters
- `chrome_bookmark_search` - Find bookmarks by keywords
- `chrome_bookmark_add` - Add new bookmarks with folder support
- `chrome_bookmark_delete` - Delete bookmarks
</details>

## 🧪 Usage Examples

### AI helps you summarize webpage content and automatically control Excalidraw for drawing

prompt: [excalidraw-prompt](prompt/excalidraw-prompt.md)
Instruction: Help me summarize the current page content, then draw a diagram to aid my understanding.
https://www.youtube.com/watch?v=3fBPdUBWVz0

https://github.com/user-attachments/assets/fd17209b-303d-48db-9e5e-3717141df183

### After analyzing the content of the image, the LLM automatically controls Excalidraw to replicate the image

prompt: [excalidraw-prompt](prompt/excalidraw-prompt.md)|[content-analize](prompt/content-analize.md)
Instruction: First, analyze the content of the image, and then replicate the image by combining the analysis with the content of the image.
https://www.youtube.com/watch?v=tEPdHZBzbZk

https://github.com/user-attachments/assets/60d12b1a-9b74-40f4-994c-95e8fa1fc8d3

### AI automatically injects scripts and modifies webpage styles

prompt: [modify-web-prompt](prompt/modify-web.md)
Instruction: Help me modify the current page's style and remove advertisements.
https://youtu.be/twI6apRKHsk

https://github.com/user-attachments/assets/69cb561c-2e1e-4665-9411-4a3185f9643e

### AI automatically captures network requests for you

query: I want to know what the search API for Xiaohongshu is and what the response structure looks like

https://youtu.be/1hHKr7XKqnQ

https://github.com/user-attachments/assets/dc7e5cab-b9af-4b9a-97ce-18e4837318d9

### AI helps analyze your browsing history

query: Analyze my browsing history from the past month

https://youtu.be/jf2UZfrR2Vk

https://github.com/user-attachments/assets/31b2e064-88c6-4adb-96d7-50748b826eae

### Web page conversation

query: Translate and summarize the current web page
https://youtu.be/FlJKS9UQyC8

https://github.com/user-attachments/assets/aa8ef2a1-2310-47e6-897a-769d85489396

### AI automatically takes screenshots for you (web page screenshots)

query: Take a screenshot of Hugging Face's homepage
https://youtu.be/7ycK6iksWi4

https://github.com/user-attachments/assets/65c6eee2-6366-493d-a3bd-2b27529ff5b3

### AI automatically takes screenshots for you (element screenshots)

query: Capture the icon from Hugging Face's homepage
https://youtu.be/ev8VivANIrk

https://github.com/user-attachments/assets/d0cf9785-c2fe-4729-a3c5-7f2b8b96fe0c

### AI helps manage bookmarks

query: Add the current page to bookmarks and put it in an appropriate folder

https://youtu.be/R_83arKmFTo

https://github.com/user-attachments/assets/15a7d04c-0196-4b40-84c2-bafb5c26dfe0

### Automatically close web pages

query: Close all shadcn-related web pages

https://youtu.be/2wzUT6eNVg4

https://github.com/user-attachments/assets/83de4008-bb7e-494d-9b0f-98325cfea592

## 🤝 Contributing

We welcome contributions! Please see [CONTRIBUTING.md](docs/CONTRIBUTING.md) for detailed guidelines.

## 🚧 Future Roadmap

The next community-fork milestone is not "add as many tools as possible". The priority is to make the existing browser capabilities more reliable, faster, and easier for agents to use correctly.

### 2026-04-25 v1.1 Priorities

- [x] `P0` Stabilize iframe / Shadow DOM / ref-based targeting
  - Fix the class of failures where the element is visibly on the page but the tool still returns `not found`
  - Related issues: `#172`, `#126`
  - Primary modules: `app/chrome-extension/entrypoints/background/tools/browser/read-page.ts`, `interaction.ts`, `computer.ts`, `inject-scripts/accessibility-tree-helper.js`, `click-helper.js`, `fill-helper.js`

- [x] `P0` Add robust waiting and assertions for dynamic pages
  - Cover common agent actions such as "wait until text appears/disappears", "wait until clickable", "wait until request finishes", and "wait until download completes"
  - Related issues: `#93`, `#200`, `#43`
  - Primary modules: `computer.ts`, `common.ts`, `download.ts`, `network-capture.ts`, `app/chrome-extension/entrypoints/background/record-replay/engine/policies/wait.ts`

- [ ] `P1` Make screenshots smaller and default to agent-friendly output
  - Reduce token blow-ups, prefer targeted captures, and improve the save/download flow
  - Related issues: `#163`, `#207`
  - Primary modules: `screenshot.ts`, `packages/shared/src/tools.ts`, `app/chrome-extension/utils/image-utils.ts`

- [ ] `P1` Improve console / dialog / network result quality
  - Make `chrome_console` more useful for deep objects, handle DevTools conflicts better, and improve dialog/network inspection quality
  - Related issues: `#215`, `#191`, `#201`
  - Primary modules: `console.ts`, `console-buffer.ts`, `dialog.ts`, `javascript.ts`, `network-capture.ts`

- [ ] `P1` Tighten multi-session / multi-window / background-run isolation
  - Reduce cross-session interference, focus stealing, and rogue tool behavior under concurrency
  - Related issues: `#152`, `#178`, `#162`, `#141`
  - Primary modules: `app/native-server/src/mcp/mcp-server.ts`, `mcp-server-stdio.ts`, `app/chrome-extension/entrypoints/background/native-host.ts`, `computer.ts`, `common.ts`, `app/chrome-extension/utils/cdp-session-manager.ts`

- [ ] `P2` Expand high-value page operations
  - Build on top of `chrome_computer`, `chrome_upload_file`, `chrome_handle_download`, and `record_replay_flow_run` to improve `hover`, drag/drop, clipboard actions, tab groups, complex forms, and reusable flows
  - Related issues: `#141`, `#171`, `#205`
  - Primary modules: `computer.ts`, `file-upload.ts`, `download.ts`, `bookmark.ts`, `history.ts`, `app/chrome-extension/entrypoints/background/tools/record-replay.ts`

### Mid-Term Directions

- [ ] Move recording/playback from "works in basic cases" to "stable and reusable"
- [ ] Move workflow automation from "single run" to "publishable, debuggable, schedulable"
- [ ] Extend browser support after Chrome / Edge stability is solid enough
- [ ] Add authentication and tool permission tiers

---

**Want to contribute to any of these features?** Check out our [Contributing Guide](docs/CONTRIBUTING.md) and join our development community!

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## 📚 More Documentation

- [Architecture Design](docs/ARCHITECTURE.md) - Detailed technical architecture documentation
- [TOOLS API](docs/TOOLS.md) - Complete tool API documentation
- [Troubleshooting](docs/TROUBLESHOOTING.md) - Common issue solutions
