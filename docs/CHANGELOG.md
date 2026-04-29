# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [v1.0.6] - 2026-04-29

### Changed

- **Multi-session isolation**: MCP Streamable HTTP / SSE sessions now carry session context into the extension, so tab-scoped tools reuse each session's own last known tab/window when callers omit `tabId` / `windowId`
- **Concurrency control**: same-session and same-tab browser tool calls are now queued to reduce cross-session interference, focus stealing, and interleaved actions
- **Version consistency**: package versions and MCP client/server metadata now consistently use `1.0.6` instead of mixed legacy `1.0.3` / `1.0.5` strings

### Fixed

- **CDP session ownership**: debugger owner tracking now counts repeated owners correctly and clears stale state when Chrome detaches the debugger

## [v1.0.5] - 2026-04-28

### Added

- **Agent-first browser waits and orchestration**: added `chrome_wait_for`, `chrome_assert`, and `chrome_wait_for_tab` so agents can wait on element/text/URL/network/download conditions and newly opened tabs without ad-hoc JavaScript
- **DOM / debug / transfer status tools**: added `chrome_query_elements`, `chrome_get_element_html`, `chrome_collect_debug_evidence`, `chrome_handle_download`, and `chrome_get_upload_status` for raw DOM reads, compact debugging bundles, and stable upload/download status checks

### Fixed

- **webRequest capture filtering**: `chrome_network_capture` now keeps same-page XHR/fetch responses even when they return `text/html`; `includeStatic=false` still filters top-level document/static responses instead of dropping agent-triggered fetches
- **Network capture lifecycle**: exact URL capture now binds before first navigation, timeout/inactivity stops can be consumed later, and stop results now expose stable `matchedRequests`, `ignoredRequests`, and `stopReason` fields
- **Screenshot output defaults**: inline screenshot responses now default to no-download mode and include `captureKind`, `mimeType`, and original/output dimensions for more reliable agent use

### Documentation

- **Tool behavior notes**: README and TOOLS docs now document exact URL vs wildcard capture rules, the refined `includeStatic` behavior, and the new wait / debug / transfer-status helper tools

## [v1.0.4] - 2026-04-27

### Fixed

- **iframe / Shadow DOM / ref targeting stability**: `chrome_read_page`, `chrome_computer`, and interaction tools now preserve ref-to-frame routing across iframes, reducing false `not found` failures when elements are visible but live in nested frames
- **Dynamic page wait reliability**: wait actions now reliably handle text appear/disappear, selector visible/hidden, clickable targets, network completion, and download completion across iframes and open Shadow DOM trees
- **Native/server test baseline**: community bridge tests no longer fail on unrelated coverage and module-resolution issues, making CI and local verification stable again
- **Native HTTP MCP response handling**: `/sse`, `/messages`, and `/mcp` now avoid double-writing headers/body when the MCP SDK owns the raw response, fixing `ERR_HTTP_HEADERS_SENT` and broken Connect flows after initialization

### Changed

- **Record-replay wait coverage**: record-replay wait handlers and legacy wait nodes now use the same richer wait capabilities as browser tools, including clickable, download, and network waits
- **Stable extension ID guard for production builds**: production `wxt build` now requires `CHROME_EXTENSION_KEY` by default so local rebuilds do not silently generate a new unpacked extension ID; only one-off builds that explicitly set `ALLOW_UNSTABLE_EXTENSION_ID=1` skip the guard

## [v1.0.3] - 2026-04-25

### Fixed

- **Release extension ID stability**: Release builds now require a valid `CHROME_EXTENSION_KEY` and verify that it resolves to the stable unpacked extension ID used by the Native Messaging host, preventing broken release zips that fail to connect after "Load unpacked"

### Documentation

- **Extension ID troubleshooting**: README, Windows install docs, troubleshooting docs, and contributing docs now explain why custom builds without `CHROME_EXTENSION_KEY` get a different extension ID and break Native Messaging by default

## [v1.0.2] - 2026-04-25

### Changed

- **Community-maintained fork**: Project maintenance is now continued at `y-chell/mcp-chrome-community`
- **Release direction**: Upcoming community releases prioritize connection stability, compatibility fixes, and reviewed pull requests before adding new tools
- **CI runtime**: Release workflow now runs on Node.js 24 and avoids deprecated Node 20-based GitHub Action runtimes for pnpm setup
- **Project naming**: Package names, CLI names, extension display names, workflow asset names, and setup examples are now aligned around `mcp-chrome-community`
- **CLI compatibility**: The primary command is now `mcp-chrome-community`, while legacy aliases such as `mcp-chrome-bridge`, `chrome-mcp-bridge`, and `mcp-chrome-stdio` remain available for existing setups
- **Version consistency**: Native server metadata, stdio proxy metadata, release packaging, and installation docs now consistently use `1.0.2` instead of mixed legacy version strings

### Fixed

- **Release bootstrap order**: GitHub Actions no longer asks `actions/setup-node` to initialize pnpm caching before `pnpm` is installed, preventing `Unable to locate executable file: pnpm` on tag-triggered releases

### Added

- **GitHub Release automation**: `v*` tags and manual dispatch now build release assets, publish them to GitHub Releases, and attach SHA-256 checksums

### Documentation

- **Install path clarity**: README and Windows install docs now tell users to install the community fork from GitHub Release assets instead of the npm registry package name
- **Node support policy**: README and contributing docs now distinguish minimum support (Node.js 20), recommended versions (Node.js 22/24 LTS), and the current untested status of Node.js 25
- **Naming cleanup**: README, CLI config docs, troubleshooting docs, architecture docs, and native install docs now use the community project name consistently

## [v1.0.1] - 2026-04-25

### Fixed

- **MCP multi-session stability**: HTTP `/mcp` and `/sse` sessions no longer reuse a single MCP `Server` instance, avoiding repeated `connect()` calls and transport conflicts such as `Already connected to a transport`
- **Quick panel lifecycle cleanup**: Quick panel content cleanup now listens to `pagehide` in addition to `unload`, reducing stale UI state when pages are discarded or navigated away
- **Element picker lifecycle cleanup**: Element picker cleanup also listens to `pagehide`, making page teardown behavior more reliable on modern browsers

### Changed

- **Configurable MCP host**: Native server now supports `CHROME_MCP_HOST` and `MCP_HTTP_HOST` in addition to existing port overrides
- **Proxy client URL resolution**: Agent bridge and stdio proxy now follow the resolved host and port instead of assuming `127.0.0.1`
- **Extension local server URL helpers**: Chrome extension code now uses shared helpers for local MCP URLs instead of repeating hardcoded addresses across multiple files
- **Community fork metadata**: Repository metadata, package metadata, and setup documents now point to `y-chell/mcp-chrome-community`

### Added

- **Regression test for MCP server creation**: Added coverage to verify a fresh MCP server instance is created for each session
- **Regression test for host resolution**: Added tests for host and port environment variable handling in native server constants

### Documentation

- **Community maintenance notice**: README and setup docs now clearly state that this is a community-maintained fork
- **Host and port override docs**: Added setup notes for `CHROME_MCP_HOST` / `MCP_HTTP_HOST` and `CHROME_MCP_PORT` / `MCP_HTTP_PORT`

## [v0.0.5]

### Improved

- **Image Compression**: Compress base64 images when using screenshot tool
- **Interactive Elements Detection Optimization**: Enhanced interactive elements detection tool with expanded search scope, now supports finding interactive div elements

## [v0.0.4]

### Added

- **STDIO Connection Support**: Added support for connecting to the MCP server via standard input/output (stdio) method
- **Console Output Capture Tool**: New `chrome_console` tool for capturing browser console output

## [v0.0.3]

### Added

- **Inject script tool**: For injecting content scripts into web page
- **Send command to inject script tool**: For sending commands to the injected script

## [v0.0.2]

### Added

- **Conditional Semantic Engine Initialization**: Smart cache-based initialization that only loads models when cached versions are available
- **Enhanced Model Cache Management**: Comprehensive cache management system with automatic cleanup and size limits
- **Windows Platform Compatibility**: Full support for Windows Chrome Native Messaging with registry-based manifest detection
- **Cache Statistics and Manual Management**: User interface for viewing cache stats and manual cache cleanup
- **Concurrent Initialization Protection**: Prevents duplicate initialization attempts across components

### Improved

- **Startup Performance**: Dramatically reduced startup time when no model cache exists (from ~3s to ~0.5s)
- **Memory Usage**: Optimized memory consumption through on-demand model loading
- **Cache Expiration Logic**: Intelligent cache expiration (14 days) with automatic cleanup
- **Error Handling**: Enhanced error handling for model initialization failures
- **Component Coordination**: Simplified initialization flow between semantic engine and content indexer

### Fixed

- **Windows Native Host Issues**: Resolved Node.js environment conflicts with multiple NVM installations
- **Race Condition Prevention**: Eliminated concurrent initialization attempts that could cause conflicts
- **Cache Size Management**: Automatic cleanup when cache exceeds 500MB limit
- **Model Download Optimization**: Prevents unnecessary model downloads during plugin startup

### Technical Improvements

- **ModelCacheManager**: Added `isModelCached()` and `hasAnyValidCache()` methods for cache detection
- **SemanticSimilarityEngine**: Added cache checking functions and conditional initialization logic
- **Background Script**: Implemented smart initialization based on cache availability
- **VectorSearchTool**: Simplified to passive initialization model
- **ContentIndexer**: Enhanced with semantic engine readiness checks

### Documentation

- Added comprehensive conditional initialization documentation
- Updated cache management system documentation
- Created troubleshooting guides for Windows platform issues

## [v0.0.1]

### Added

- **Core Browser Tools**: Complete set of browser automation tools for web interaction
  - **Click Tool**: Intelligent element clicking with coordinate and selector support
  - **Fill Tool**: Form filling with text input and selection capabilities
  - **Screenshot Tool**: Full page and element-specific screenshot capture
  - **Navigation Tools**: URL navigation and page interaction utilities
  - **Keyboard Tool**: Keyboard input simulation and hotkey support

- **Vector Search Engine**: Advanced semantic search capabilities
  - **Content Indexing**: Automatic indexing of browser tab content
  - **Semantic Similarity**: AI-powered text similarity matching
  - **Vector Database**: Efficient storage and retrieval of embeddings
  - **Multi-language Support**: Comprehensive multilingual text processing

- **Native Host Integration**: Seamless communication with external applications
  - **Chrome Native Messaging**: Bidirectional communication channel
  - **Cross-platform Support**: Windows, macOS, and Linux compatibility
  - **Message Protocol**: Structured messaging system for tool execution

- **AI Model Integration**: State-of-the-art language models for semantic processing
  - **Transformer Models**: Support for multiple pre-trained models
  - **ONNX Runtime**: Optimized model inference with WebAssembly
  - **Model Management**: Dynamic model loading and switching
  - **Performance Optimization**: SIMD acceleration and memory pooling

- **User Interface**: Intuitive popup interface for extension management
  - **Model Selection**: Easy switching between different AI models
  - **Status Monitoring**: Real-time initialization and download progress
  - **Settings Management**: User preferences and configuration options
  - **Cache Management**: Visual cache statistics and cleanup controls

### Technical Foundation

- **Extension Architecture**: Robust Chrome extension with background scripts and content injection
- **Worker-based Processing**: Offscreen document for heavy computational tasks
- **Memory Management**: LRU caching and efficient resource utilization
- **Error Handling**: Comprehensive error reporting and recovery mechanisms
- **TypeScript Implementation**: Full type safety and modern JavaScript features

### Initial Features

- Multi-tab content analysis and search
- Real-time semantic similarity computation
- Automated web page interaction
- Cross-platform native messaging
- Extensible tool framework for future enhancements
