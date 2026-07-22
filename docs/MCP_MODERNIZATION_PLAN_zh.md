# MCP 现代化优化计划

日期：2026-07-17

## 背景

本项目的 MCP 层沿用了较早期的协议和 SDK 使用方式。当前实现可以工作，但没有充分利用现代 MCP 客户端已经支持的结构化结果、工具注解、动态工具目录通知、取消和进度上下文等能力，也存在动态工具发现阻塞、中文检索弱、工具契约分散等问题。

本计划先处理 MCP 协议层和工具契约，再按阶段收敛 HTTP 传输安全与 Agent 执行权限。浏览器扩展私钥、Agent API 鉴权、构建链和权限收敛以外的安全议题仍保持独立边界，避免一次修改跨越过多边界。

截至 2026-07-17，项目继续采用稳定的 TypeScript SDK v1 系列，并把最低依赖基线提升到 `@modelcontextprotocol/sdk ^1.29.0` 与其要求的 `zod ^3.25.0`。SDK v2 此时仍处于 pre-alpha，不在生产迁移范围内；待稳定版发布后再单独评估高层 API 和导入路径迁移。

## 优化目标

- 保持现有 41 个静态工具的名称、参数和文本结果兼容。
- 让新客户端能直接消费 `structuredContent`，旧客户端仍可读取 `content`。
- 补全工具的 `annotations` 和严格输入 Schema，减少模型误调用和无效参数。
- 让动态工作流工具列表快速返回，并在目录变化后发送 `notifications/tools/list_changed`。
- 改善中英文工具检索，尤其是中文自然语言查询。
- 为后续接入取消、进度、任务化执行和更安全的 HTTP 传输建立清晰边界。

## 兼容原则

1. 不重命名已有工具，不删除已有输入字段。
2. 结构化输出采用增量增强：保留现有 `content`，同时提供可解析的 `structuredContent`。
3. 只有在结果结构稳定且经过测试后才声明 `outputSchema`，避免 Schema 与运行时结果不一致导致 SDK 拒绝响应。
4. 动态目录刷新失败时保留上一次成功缓存，不让临时扩展故障清空工具列表。
5. 所有协议行为变化都补充单元测试，并保留旧客户端兼容测试。

## 目标架构

### 1. 单一工具契约

静态工具定义以 `packages/shared` 为事实来源，逐步集中维护：

- `name`、`description`、`inputSchema`
- `annotations`
- 检索关键词和中英文别名
- 稳定工具的 `outputSchema`

Native Server、扩展和文档从同一契约派生，避免三套定义漂移。

### 2. 双轨结果

工具调用结果同时支持：

- `content`：继续提供文本或图片内容，兼容已有客户端。
- `structuredContent`：当文本结果是可解析的 JSON 对象时附带对象结果，供现代客户端直接消费。

数组、标量以及无法稳定结构化的结果暂不强行包装，防止改变既有语义。后续可按工具族定义明确的对象 Schema。

### 3. 非阻塞动态工具目录

动态工作流工具采用每个 MCP Server 实例独立缓存：

- `tools/list` 立即返回静态工具和当前缓存。
- 后台单飞刷新扩展目录，避免并发重复请求。
- 目录内容变化后调用 `sendToolListChanged()`。
- 扩展暂时不可用时继续使用最后一次成功缓存。

### 4. 调用上下文

后续把 SDK 提供的调用上下文贯穿到浏览器执行层：

- `extra.signal` 用于取消长时间操作。
- `extra._meta.progressToken` 和通知 API 用于进度上报。
- 确实需要异步取回结果的长任务优先评估 MCP Tasks，但只有在持久化、恢复和会话归属策略完备后才对外暴露。

### 5. 传输安全边界

HTTP/SSE 传输的鉴权、Origin/Host 校验、会话生命周期和限流单独实施。协议现代化不应继续扩大当前未鉴权接口的暴露面。

## 分阶段实施

### 第一阶段：工具契约与发现流程（本轮）

- [x] 将各工作区的 MCP SDK 与 Zod 依赖基线统一到当前稳定 v1。
- [x] 为静态工具补充只读、破坏性、幂等和开放世界等 `annotations`。
- [x] 为对象型输入 Schema 增加 `additionalProperties: false`。
- [x] 改进 Unicode 分词和中文检索别名。
- [x] 成功结果在保持 `content` 的同时提供兼容的 `structuredContent`。
- [x] 动态工作流目录改为缓存和后台刷新。
- [x] 目录变化时发送 `notifications/tools/list_changed`。
- [x] 补充工具定义、检索、结构化结果和动态目录通知测试。

### 第二阶段：取消、进度与长任务

- [x] 将 `AbortSignal` 贯穿 MCP、Native Messaging、扩展隔离队列及等待类工具。
- [x] 为下载、网络抓包等待和通用等待提供节流、单调的进度通知。
- [x] 评估 Tasks API 并明确暂缓暴露的兼容策略。
- [ ] 将取消和进度继续深入录制、工作流运行器及长时间 CDP 操作内部。

### 第三阶段：HTTP 传输与会话安全

- [x] 为 Streamable HTTP/SSE 增加明确鉴权。
- [x] 使用外部中间件实施 Origin、Host、CORS 和速率限制。
- [x] 校验会话初始化、关闭、断线清理和重连行为。
- [x] 移除不安全的默认执行参数，改为显式配置。

### 第四阶段：扩展端类型基线清理

- [x] 统一 Agent 在 Shared、Native Server 和 Extension 中的公共类型。
- [x] 对齐 Element Marker 参数 Schema 与实际实现。
- [x] 修复浏览器工具、Chrome API 和 Worker 的严格空值及 overload 类型问题。
- [x] 收敛 Record/Replay V2/V3 的生产契约、适配器和测试 fixture。
- [x] 清理 Web Editor、表单组件和 Selector 的剩余类型错误。
- [x] 将扩展 `vue-tsc --noEmit` 从 168 个历史错误降为 0，并加入 CI 门禁。

### 第五阶段：扩展端原生结构化结果

- [x] 按工具族定义稳定的 `outputSchema`。
- [x] 扩展端直接返回结构化对象，减少 Native Server 猜测 JSON 文本。
- [x] 增加真实 Chrome 端到端协议测试和客户端兼容矩阵。

## 测试策略

- 契约测试：41 个静态工具名称不变，输入 Schema 严格且注解完整。
- 兼容测试：旧的 `content` 内容和错误标志保持不变。
- 结构化测试：对象 JSON 被镜像到 `structuredContent`；数组、标量和非 JSON 不误转换。
- 动态目录测试：首次列表不阻塞、并发刷新单飞、失败保留缓存、变化触发通知。
- 检索测试：现有英文查询得分不退化，中文查询能找到抓包、网络、标签页、截图等对应工具。
- 构建验证：共享包构建、Native Server 类型检查和测试、扩展测试。

## 本轮子 Agent 分工

1. 共享契约：只修改 `packages/shared/src`，补充严格 Schema 和工具注解。
2. Native MCP：只修改 `app/native-server/src/mcp/register-tools.ts` 及对应测试，处理双轨结果、动态缓存和列表变化通知。
3. 工具检索：只修改 `app/native-server/src/mcp/tool-profile.ts` 及对应测试，处理 Unicode 分词和中文别名。

主 Agent 负责审查交叉影响、修正实现、运行完整验证，并把本轮实际结果追加到本文件。

## 暂不纳入本轮

- 扩展 Manifest 中的固定私钥。
- Agent API 鉴权。
- 全仓锁文件、构建脚本和 CI 假成功问题。
- 扩展 Worker 打包和权限收敛。

这些问题仍然重要，但应作为独立变更批次处理并分别验证。

## 2026-07-17 第一阶段实施结果

本轮已完成第一阶段。SDK 依赖统一到 `@modelcontextprotocol/sdk ^1.29.0`，直接使用 SDK 类型的三个工作区统一到 `zod ^3.25.0`。锁文件由 pnpm 8 按现有 v6 格式离线重算，并补齐根配置中的 `onlyBuiltDependencies`，现在可以通过同版本的 `--frozen-lockfile` 校验。

协议契约方面完成以下改造：

- 41 个静态工具均具备四项明确的 `annotations`，并根据实际副作用区分只读、破坏性、幂等和开放世界行为。
- 所有声明固定 `properties` 的对象 Schema 自动补充 `additionalProperties: false`；HTTP headers、CDP 参数等明确的自由映射仍保持开放。
- 三个工具档位元工具和动态工作流工具同步使用严格 Schema 与明确注解。
- 成功结果中的 JSON 对象在不改变原 `content` 的前提下镜像到 `structuredContent`；数组、标量、非 JSON 和错误结果保持旧行为。
- `chrome_health` 的文本与结构化结果使用同一份增强对象，避免桥接元数据不一致。

动态目录方面改为每个 MCP Server 实例独立缓存和单飞后台刷新。`tools/list` 不再等待扩展返回；目录发生真实变化时发送列表变化通知；刷新失败时保留最后一次成功缓存；动态调用缓存未命中时只执行一次受控刷新。主审阶段还补充了空 slug、缺少 id、非法变量和重复工具名的过滤，避免扩展异常数据污染 MCP 工具目录。

检索方面改用 Unicode NFKC 归一化和 Unicode 字母数字分词，并为常用浏览器工具补充本地中文别名。现阶段别名仍位于 Native Server；后续若扩展端或文档生成也需要检索，应迁移到 `packages/shared` 的单一工具契约。

验证结果：

- `chrome-mcp-shared` 构建通过。
- Native Server `tsc --noEmit` 通过。
- Native Server 6 个测试文件、44 个测试全部通过。
- Chrome 扩展 56 个测试文件、714 个测试全部通过。
- pnpm 8.15.9 离线 `--frozen-lockfile --lockfile-only --ignore-scripts` 校验通过。
- MCP 契约测试覆盖静态工具数量和唯一性、注解完整性、严格对象 Schema、自由映射例外、元工具契约、结构化结果和动态目录通知。

扩展端 `vue-tsc --noEmit` 仍有 168 个既有类型错误，与本轮开始前的数量相同，主要集中在 element marker、录制回放等历史模块。本轮没有扩大范围处理这些错误；在进入第四阶段前，应先建立可用的类型检查基线，避免后续协议类型变更被旧错误淹没。

下一阶段优先级保持不变：先贯通取消信号与进度通知，再单独处理 HTTP 传输鉴权和会话安全；`outputSchema` 与扩展端原生结构化对象继续留到结果模型稳定后实施。

## 2026-07-17 第二阶段实施方案

第二阶段采用标准 MCP 请求上下文贯穿现有三段式调用链，而不是为 MCP 客户端增加私有控制接口：

1. MCP Server 从请求处理器的 `extra.signal` 接收 `notifications/cancelled`，并读取 `_meta.progressToken`。
2. Native Server 通过 Native Messaging 的独立取消和进度消息，把控制信号与普通工具结果分离。
3. Chrome 扩展为每个原生工具请求维护 `AbortController`，把只在进程内使用的 `signal` 和 `reportProgress` 传给隔离队列及工具执行器。
4. 等待和下载工具先实现真正的协作取消、计时器/监听器清理与节流进度；其他工具先获得调用边界上的取消检查，后续按工具族继续深入 CDP、抓包和录制内部循环。
5. stdio 代理同时转发取消和进度，避免 HTTP MCP 与 stdio MCP 的行为分叉。

Native Messaging 新消息只做增量扩展。旧扩展不认识取消消息时会忽略它，Native Server 仍会立即结束本地等待并忽略迟到结果；新扩展连接旧 Native Server 时不会主动发送进度，因此原有请求/响应流程保持可用。进度统一使用 `0..100`、`total=100` 的粗粒度契约，未知字节总量或不可预测阶段不得伪装为精确百分比。

SDK 1.29 已提供 Tasks API，但相关入口仍位于 `experimental/tasks`，内置内存存储也明确不适合生产。当前项目还没有持久化 `TaskStore`、消息队列、重启恢复、会话归属和结果保留策略；本阶段不把实验性 Tasks 暴露给客户端。完成取消和进度桥后，再为录制、长时间抓包等确实需要“先返回任务、稍后取结果”的工具设计持久化试点，避免把普通同步工具全部任务化。

## 2026-07-17 第二阶段实施结果

第二阶段已完成可安全落地的取消和进度主链路。MCP HTTP 处理器现在直接使用 SDK 请求上下文中的 `extra.signal`，并在客户端提供 progress token 时发送标准 `notifications/progress`；stdio 代理同步转发下游请求的取消信号和进度回调，两个入口不再出现行为分叉。

Native Server 与 Chrome 扩展之间新增了独立的 `call_tool_cancel` 和 `call_tool_progress` 消息。每次工具调用都使用独立 `requestId` 关联结果、取消和进度；超时或客户端取消后，Native Server 会立即清理等待状态、通知扩展停止工作并忽略迟到结果。扩展为活动请求维护 `AbortController`，原生连接断开、显式取消或相同请求被替换时都会中止对应调用，取消后的调用不会再发送最终响应。

扩展执行层把不可序列化的执行上下文与浏览器会话参数分离，并把 `AbortSignal` 传入会话隔离队列。排队中的调用可以在不破坏同标签页/同会话串行顺序的前提下取消；进入准备、执行和收尾阶段前都会重新检查取消状态。

等待类工具完成了第一批协作式实现：

- `chrome_wait_for` 的轮询、睡眠和委托等待支持取消，计时器与监听器会及时清理；轮询中的单次异步求值也会响应取消。
- 下载等待在取消、超时和完成时统一移除 `downloads.onCreated`、`downloads.onChanged` 与 abort 监听器；总字节数已知时报告真实百分比，未知时只报告粗粒度阶段。
- 网络请求等待支持取消临时抓包、停止临时 capture，并按等待时间报告粗粒度进度。
- 进度统一归一化为 `0..100`、`total=100` 且保持单调；进度通道属于最佳努力，通知失败不会改变工具最终结果。

Tasks API 已完成 SDK 1.29 级别的可用性评估，但没有进行对外试点。原因不是协议能力不足，而是项目尚无生产可用的持久化 `TaskStore`、结果队列、扩展或 Native Server 重启恢复、任务与 MCP 会话归属、过期清理和结果保留策略。现阶段继续使用可取消、可上报进度的同步调用，比暴露无法可靠恢复的实验性任务接口更稳妥。

本阶段仍保留两个明确边界：录制和动态工作流运行器尚未在内部循环中消费 `AbortSignal`，取消后桥接层会停止等待并抑制迟到响应，但底层运行可能继续到自身结束；部分长时间 CDP 操作也只具备调用边界检查，尚未逐项实现资源级清理。这些内容应与具体工具族的状态机一起改造，不能只在外层套 Promise 竞争来假装已经停止。

验证结果：

- `chrome-mcp-shared` 构建通过。
- Native Server `tsc --noEmit` 通过。
- Native Server 7 个测试文件、51 个测试全部通过。
- Chrome 扩展 57 个测试文件、725 个测试全部通过。
- Chrome MV3 扩展 `1.0.11` 生产构建通过，并修复了 Windows 干净构建时静态注入脚本复制与 WXT 清单校验之间的竞争。
- pnpm 8.15.9 离线 `--frozen-lockfile --lockfile-only --ignore-scripts` 校验通过。
- `git diff --check` 通过。
- 扩展端 `vue-tsc --noEmit` 仍有 168 个既有类型错误；本阶段修改文件中没有新增类型错误。

下一阶段进入 HTTP 传输与会话安全，重点处理 Streamable HTTP/SSE 鉴权、Origin/Host 校验、会话生命周期和限流。录制、工作流与 CDP 内部取消可以作为并行的工具执行层专项继续推进，但不应阻塞传输安全收敛。

## 2026-07-18 第三阶段实施结果

第三阶段已完成 HTTP 传输安全、MCP 会话生命周期和 Agent 执行权限收敛。实现重点不是把旧 SSE 路径直接删除，而是让新旧入口共享同一套边界，并保留现有客户端的可迁移路径。

### HTTP 传输安全

- Streamable HTTP 的 `/mcp` 和兼容 SSE 的 `/sse`、`/messages` 都经过 Host、Origin、鉴权和限流检查。
- 回环地址默认保持兼容；监听非回环地址时必须配置 `CHROME_MCP_AUTH_TOKEN`（兼容旧变量 `MCP_HTTP_AUTH_TOKEN`），并要求至少 16 个字符。
- 监听 `0.0.0.0` 或 `::` 时必须显式配置 `CHROME_MCP_ALLOWED_HOSTS`，不接受通配符 Host/Origin。
- Host 校验会规范化主机名、IPv4、IPv6 和可选端口；Origin 使用精确匹配；CORS 允许列表与请求前置校验使用同一配置来源。
- 固定窗口限流默认每客户端每分钟 120 次，鉴权开启时按 token 指纹限流，未鉴权回环模式按请求 IP 限流；未通过鉴权的请求不会消耗限流配额。
- Native Server 仍共用一个 Fastify 监听器，但非回环客户端只能访问 `/mcp`、`/sse` 和 `/messages`；Agent、扩展通信及健康检查路由继续限制为本机来源，避免启用远程 MCP 时顺带暴露未鉴权 Agent API。
- 明文 HTTP 仍是内置监听器的传输形态。跨机器或不可信网络使用时，必须放在 TLS 反向代理或其他受控私网之后，不能把监听地址和 token 当作 TLS 替代品。反向代理只能发布 `/mcp`、`/sse` 和 `/messages`；代理从本机回环地址转发时，Native Server 无法再用来源地址隔离其他 HTTP 路由。

### 会话生命周期

- Streamable HTTP 和旧 SSE 入口统一使用 `McpSessionRegistry`，默认最多 64 个会话，空闲 30 分钟清理。
- 初始化、带有效 `Mcp-Session-Id` 的请求、GET/DELETE、旧 SSE 消息投递分别校验会话类型；未知会话不再隐式创建。
- DELETE、传输关闭、服务器停止和 TTL 清理都会关闭对应 transport；清理失败会记录日志但不会阻塞其他会话回收。
- 初始化失败、会话达到容量上限和非法/未知会话 ID 都有独立错误分支，避免留下半初始化 transport。

### 客户端与 Agent 配置

- Native Server 内部的 Claude、Codex 和 stdio 代理会把 HTTP MCP 鉴权 token 以环境变量或 `Authorization` header 继续传递，避免“服务端已保护、内部客户端却连不上”的分叉行为。
- `CHROME_MCP_BIND_HOST` 只控制监听地址，`CHROME_MCP_HOST` 只控制客户端生成的连接地址；两者不再混用。
- Codex 默认改为 `workspace-write`，不再无条件加入 `--dangerously-bypass-approvals-and-sandbox`；只有会话配置显式开启危险开关时才加入。
- Claude 新会话默认使用 `default` 权限模式；`bypassPermissions` 必须同时提交 `allowDangerouslySkipPermissions=true`。扩展设置页现在显示 Codex 沙箱/危险开关和 Claude 危险确认，后端也会拒绝不完整的危险配置。
- 已有明确保存的 bypass 会话不被迁移脚本批量改写；数据库默认值和新建/更新路径已改为安全默认。

### 验证结果

- `chrome-mcp-shared` 构建通过。
- Native Server `tsc --noEmit` 通过。
- Native Server 11 个测试文件、91 个测试全部通过。
- HTTP 安全、远程非 MCP 路由隔离、MCP 会话、Claude 权限和 Codex 执行策略的定向测试 6 个测试文件、45 个测试全部通过。
- Chrome 扩展 57 个测试文件、725 个测试全部通过。
- Chrome MV3 扩展 `1.0.11` 生产构建通过；`.output/chrome-mv3/manifest.json` 存在，版本为 `1.0.11`，清单中的具体脚本/页面/图标引用均存在，资源通配目录也已生成。
- pnpm 8.15.9 离线 `--frozen-lockfile --lockfile-only --ignore-scripts` 校验通过。
- `git diff --check` 通过。
- 扩展端 `vue-tsc --noEmit` 仍有 168 个历史类型错误；本轮修改的 `AgentChat.vue` 和 `AgentSessionSettingsPanel.vue` 没有新增诊断。

### 本阶段边界

本阶段没有实现 Agent API 全局鉴权，也没有把内置 HTTP 监听器升级成 TLS 服务；这两项分别留给后续 API 安全和部署边界专项。MCP Tasks 仍保持暂缓，不因本阶段的会话注册表而对外暴露任务接口。

## 2026-07-18 扩展端类型基线清理计划

第三阶段结束时，扩展生产构建和 725 个 Vitest 测试均通过，但独立执行 `vue-tsc --noEmit --pretty false` 仍会产生 168 个历史类型错误。这些错误分布在 38 个文件中，其中测试代码 110 个错误、14 个文件，扩展正式代码及共享代码 58 个错误、24 个文件。当前错误不是本轮 MCP 安全改造引入，但会掩盖后续协议和结构化结果改造产生的新类型回归，因此必须在原第四阶段之前先建立零错误基线。

### 当前错误分布

| 模块                    | 错误数 | 主要问题                                                                           |
| ----------------------- | -----: | ---------------------------------------------------------------------------------- |
| Record/Replay 类型契约  |     95 | V2/V3 生产接口已经演进，适配器、测试 fixture 和断言仍引用旧字段或无效泛型参数      |
| 浏览器工具与 Chrome API |     34 | `undefined`、`null`、Chrome API overload 和异步返回值没有满足严格类型约束          |
| Web Editor 与表单组件   |     14 | Vue props、事件类型和递归返回类型不同步                                            |
| Agent 共享类型          |     12 | Native Server 已使用 `previewMeta` 等字段，但 Shared 和 Extension 的公共声明未同步 |
| Element Marker          |      9 | 实现读取 `waitForNavigation`、`timeoutMs`，参数 Schema 却未声明                    |
| Offscreen Worker        |      2 | Worker/Web API 类型不匹配                                                          |
| Selector                |      2 | 严格空值检查未处理                                                                 |

错误码以属性和契约不一致为主：`TS2339` 64 个、`TS2322` 32 个、`TS2345` 32 个，其他错误 40 个。

### 实施顺序

1. **公共类型先行**：统一 `AgentSession`、请求元数据和预览元数据等 Shared 类型，删除 Native Server 与 Extension 中不必要的重复声明，先解决 12 个 Agent 类型错误。
2. **小范围 Schema 对齐**：核实 Element Marker 的真实工具契约。仍受支持的参数补入 Schema、共享类型和测试；已废弃的参数从实现中移除，解决 9 个错误。
3. **浏览器 API 严格类型**：按工具逐个处理可空值、tab/frame 标识符、Chrome API overload 和网络抓包返回类型，解决 34 个错误，并保留现有错误分支。
4. **Record/Replay 专项**：先确定 V3 当前生产契约，再同步 V2 适配器和测试 fixture；不通过 `any` 或扩大联合类型来迁就失效测试，集中解决 95 个错误。
5. **界面与剩余模块**：处理 Web Editor、Vue 表单递归类型、Offscreen Worker 和 Selector 的剩余 18 个错误。
6. **建立持续门禁**：类型错误清零后，将扩展 `compile` 命令加入根级验证和 CI。若拆分应用与测试 `tsconfig`，两套检查必须都通过，不能通过排除 `tests/` 隐藏错误。

### 修改原则

- 以实际运行契约、当前 Schema 和调用链为依据，先修正类型源头，再修改调用方和测试。
- 不使用大范围 `any`、双重类型断言、`@ts-ignore` 或关闭 `strict` 来制造表面通过。
- 测试中的错误同样需要修复；可以拆分检查任务，但不能把测试目录移出类型检查范围。
- 每个模块单独提交和验证，避免把 Record/Replay 的大批契约改动与 Agent、浏览器工具等独立修复混在一个提交中。
- 必须改变运行行为时，先补充能证明旧行为和新行为差异的测试，并在本计划的实施结果中记录。

### 验收标准

- 扩展 `vue-tsc --noEmit --pretty false` 返回 0，类型诊断为 0。
- Extension Vitest 全量测试通过，且不能减少现有有效测试覆盖来换取通过。
- Chrome MV3 生产构建通过，清单版本、入口脚本、页面和图标引用完整。
- Shared package 构建和 Native Server `tsc --noEmit` 继续通过，避免公共类型修复造成跨工作区回归。
- CI 或根级验证脚本明确执行扩展类型检查，后续新增类型错误直接阻止合并。

## 2026-07-19 第四阶段实施结果

### 完成内容

- Shared 补齐 `AgentActRequestClientMeta`、附件消息元数据、会话预览元数据和管理信息字段；Native Server 的会话服务改为复用 Shared 公共类型，删除重复声明。
- Element Marker 直接复用 `MarkerValidationRequest`，不再通过局部接口和 `any` 重复补齐导航、超时和滚动参数。
- 修复浏览器工具、Chrome API、Offscreen Worker、GIF 编码和 Selector 的空值、异步返回值、DOM `BlobPart` 与 overload 类型问题。
- 以当前 V3 领域模型为准同步 Record/Replay V2 导入适配器、触发器契约、旧版执行器和测试 fixture；测试目录继续包含在扩展类型检查中。
- 修复 Web Editor 属性面板、Vue 表单递归组件、Agent 附件缓存面板和相关测试的 props、联合类型及事件参数错误。
- 根级 `typecheck` 改为显式检查 Shared、Native Server 和 Extension，避免递归进入没有 `tsconfig.json` 的 WASM 包；新增 `.github/workflows/extension-typecheck.yml`，在 Pull Request 以及 `main`、`master` 推送时执行扩展类型门禁。

### 契约与行为说明

- Agent 会话的 `engineName` 保持可扩展字符串，创建请求仍使用受限的 `AgentCliPreference`；这保留了数据库已有会话和后续引擎扩展的兼容性。
- V2 到 V3 的命令触发器改为写入当前契约字段 `commandKey`，URL 触发器改为保留 `kind` 与 `value` 的完整匹配项，不再生成 V3 不识别的旧字段。
- Context Menu 触发器的 `contexts` 收敛为 Chrome 实际支持的上下文联合类型，默认值仍为 `page`，安装和点击行为不变。
- Chrome API 返回缺失对象时现在产生明确错误；正常路径、工具名称、入参和既有文本结果未改变。

### 验收结果

- 根级 `pnpm typecheck` 通过；扩展 `vue-tsc --noEmit --pretty false` 从 168 个历史诊断降为 0。
- Chrome 扩展 57 个测试文件、725 个测试全部通过。
- Native Server 11 个测试文件、91 个测试全部通过。
- `chrome-mcp-shared` 构建和 Native Server `tsc --noEmit` 通过。
- Chrome MV3 扩展 `1.0.11` 生产构建通过；清单版本为 3，清单版本号为 `1.0.11`，后台脚本、页面、内容脚本和图标共 12 个具体引用全部存在。
- 根级类型检查脚本和 GitHub Actions 均显式执行扩展 `vue-tsc`，后续新增类型错误会直接导致验证失败。

## 2026-07-22 第五阶段实施结果

第五阶段已完成扩展端原生结构化结果、稳定输出 Schema 和真实客户端兼容验证。实现只为结果形态稳定的 JSON 工具声明 `outputSchema`，没有给全部工具统一挂开放对象 Schema，避免多模态或动态结果被错误约束。

### 结构化结果与 Schema 范围

- Shared 按 Health、浏览器清单、History 和包含 `success: boolean` 的成功对象等工具族定义稳定 Schema。
- 18 个浏览器工具声明 `outputSchema`：`chrome_health`、`get_windows_and_tabs`、`chrome_list_frames`、`chrome_scan_compact`、`chrome_query_elements`、`chrome_get_element_html`、`chrome_clipboard`、`chrome_wait_for_tab`、`chrome_wait_for`、`chrome_assert`、`chrome_tab_group`、`chrome_network_request`、`chrome_history`、`chrome_javascript`、`chrome_cdp_command`、`chrome_cdp_batch`、`chrome_console` 和 `chrome_collect_debug_evidence`。
- `chrome_screenshot` 等多模态或结果形态不稳定的工具不声明固定输出 Schema。Meta 工具中，`chrome_search_tools` 和 `chrome_describe_tool` 使用各自的具体 Schema；可代理不同结果形态的 `chrome_call_tool` 不声明统一 `outputSchema`。
- 扩展公共执行层新增 `createStructuredToolResult()`，稳定工具在结果源头同时生成 legacy `content` 和 `structuredContent`，不再依赖执行边界猜测 JSON 文本。
- 浏览器会话上下文和 Native Server 优先读取扩展提供的 `structuredContent`。旧扩展结果、动态 Flow 和其他历史结果仍保留 JSON 文本解析回退，作为向后兼容路径而非新工具的默认实现。

### 客户端兼容与真实 Chrome E2E

- STDIO 冒烟脚本新增原始 JSON-RPC 客户端与官方 `@modelcontextprotocol/sdk` Client 的兼容矩阵；原始客户端使用协议版本 `2024-11-05`。
- 兼容矩阵验证 `tools/list` 可见 `chrome_health.outputSchema`、官方 SDK 会实际校验输出 Schema、legacy `content` 与 `structuredContent` 同时存在，且二者表达的 JSON 内容一致。
- `--call-health` 和 `--real-browser` 均执行兼容矩阵。真实 Chrome 流程覆盖页面导航、等待、页面读取、hover、drag、表单、JavaScript、剪贴板、异步更新、控制台与调试证据、截图、新标签页等待、标签页分组和清理。
- 修复 fixture HTTP Server 清理挂起：停止接受新连接后调用 `server.closeAllConnections()` 关闭 Chrome 保留的 keep-alive 连接，并增加 `real-browser fixture started`、`real-browser cleanup started` 和 `real-browser cleanup completed` 阶段日志。

### 验收结果

- `pnpm run typecheck` 通过，包括 Shared 构建、Shared `tsc --noEmit`、Native Server `tsc --noEmit` 和 Extension `vue-tsc --noEmit`。
- 扩展定向测试通过：2 个测试文件、9 个测试。
- Native Server 定向测试通过：3 个测试套件、44 个测试。
- `pnpm smoke:stdio` 通过，静态工具数为 41。
- `pnpm smoke:stdio -- --call-health --timeout-ms 30000 --verbose` 通过，legacy JSON-RPC 与官方 SDK 的 Schema、legacy content 和 structured content 兼容检查全部成功。
- `node app/native-server/dist/scripts/mcp-stdio-smoke.js --real-browser --timeout-ms 30000 --verbose` 退出码为 0，约 9 秒完成；实际 Chrome 扩展已连接，完整 fixture 流程、兼容矩阵和清理阶段全部通过。
- 验证时扩展版本为 `1.0.11`，扩展 ID 为 `hbdgbgagpkpjffpklnamcljpakneikee`，Schema 工具数为 41，Schema Hash 为 `375ddc32`，Native Host 端口为 12306，STDIO profile 为 `full`。

`pnpm build:native` 的 TypeScript 编译和文件复制可以完成，但运行中的常驻 Native Host 会占用 `app/native-server/dist`，导致清理旧目录时报 `EPERM`。本阶段未停止用户正在使用的 Native Host；该占用不影响上述类型检查和真实 Chrome E2E 结果，如需验证完全干净的 Native 构建，应在明确暂停 Native Host 后单独执行。
