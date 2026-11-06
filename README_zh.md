# auto-canvas

[English](README.md)

auto-canvas 是一个面向模拟电路的 Web 原理图画布。目标是：输入电路网表，自动完成
器件摆放和绕线，让工程师在浏览器里交互式地微调图纸，再把结果交给 EDA 工具。

auto-canvas 基于 cascode-ai 的 [Analog Canvas](https://github.com/cascode-ai/analog-canvas)：
编辑器、数据模型和网表互转都来自 Analog Canvas 的一个快照。详见
[基于 Analog Canvas](#基于-analog-canvas)。

## 目标流程

```text
论文电路图 ─► 网表 ─► 自动摆放和绕线 ─► 人工微调 ─► EDA 工具
(silicon-notebook)    (auto-canvas，规划中) (auto-canvas 编辑器) (Aether / EDA harness)
```

1. [silicon-notebook](https://github.com/huyangc/silicon-notebook) 从论文中提取
   电路图，并转换成 SPICE 网表。
2. auto-canvas 导入网表，自动摆放器件并绕线。
3. 工程师在画布上调整图纸。
4. 摆放好的器件通过 EDA 工具的 Agent 或 EDA harness 连接到 EDA 工具。

## 现状

已经可用：

- **浏览器里的原理图编辑器**：器件摆放；区分连接点和交叉的连线；网络标签；
  层次化 Cell；撤销；结构化 SPICE/Spectre 导入导出；SVG/PDF/PNG 导出。
- **单用户服务端**（`apps/server`，PostgreSQL）：
  - 云端工程：版本号冲突检测、保留 3 个历史版本、恢复、SVG 预览图；
  - 自定义器件库：目录、发布、删除和恢复。
- **Agent 编辑接口**（MCP 和 HTTP）：和界面操作使用同一套带类型的编辑模型；另有
  无界面工作区，可用脚本画图。
- **服务端上的 Agent 中转**：实时 Agent 会话使用 Node 和 PostgreSQL；Vite 将
  HTTP 和 WebSocket 请求转发至 `apps/server`。
- **离线 EDA 导出**：[eda/](eda/) 里有导入 Aether 和 Virtuoso 的脚本。
- **桌面预览版**（`apps/desktop`，Electron）：不需要服务端。

尚未完成：

- **自动摆放和绕线**：目前导入网表时器件按网格排开，不画导线。
- **与 silicon-notebook 集成。**
- **仿真**：auto-canvas 不提供仿真。可导出 SPICE、Spectre 或 RNL 交给外部工具，
  已有工程里的仿真文件夹保存时保持不变。

## 环境要求

- Node.js 24 或更新版本，pnpm 11.16
- PostgreSQL 16，并创建两个属于当前系统用户的数据库：

```bash
createdb auto_canvas
createdb auto_canvas_test
```

## 快速开始

```bash
pnpm install --frozen-lockfile
pnpm start
```

打开命令打印的地址（默认为 <http://127.0.0.1:4310>）。命令会编译应用，在后台
启动服务端，并在同一个地址提供编辑器、API 和 Agent 中转。使用 `pnpm stop` 停止。
日志追加到 `.local/logs/server.log`。安装了 PostgreSQL 命令行工具时，启动脚本会
创建缺失的 `auto_canvas` 数据库；运行测试前请单独创建 `auto_canvas_test`。

开发时运行 `pnpm dev`：API 在后台启动，Vite 在 <http://localhost:5173> 提供编辑器
热更新，Ctrl+C 会停止两者。API 日志追加到 `.local/logs/server-dev.log`。
`pnpm dev:editor` 仅启动 Vite，可连接已经运行的服务端。

`npm run start`、`npm run stop` 和 `npm run dev` 效果相同，但安装依赖必须使用 pnpm。
服务端启动时自动执行数据库迁移。数据库地址、主机、端口、工程数量上限和启动脚本
超时设置见 [apps/server/README.md](apps/server/README.md)。

可将 [.env.example](.env.example) 复制为仓库根目录下的 `.env`，取消所需设置的注释。
`start`、`stop` 和 `dev` 会在应用默认值前加载这份 Bash 配置；Shell 中已导出的
环境变量优先。没有 `.env` 时使用默认值。Git 会忽略 `.env`。

设置 `AUTO_CANVAS_BASE_PATH=/canvas` 可将编辑器与 API 部署在 `/canvas/`，与其他应用共用域名；默认仍使用根路径。参见[前缀部署](apps/server/README.md#deploying-beside-silicon-notebook)。

## 常用命令

| 命令                      | 作用                                                                    |
| ------------------------- | ----------------------------------------------------------------------- |
| `pnpm start`              | 编译整个应用并在后台启动                                                |
| `pnpm stop`               | 停止指定端口上的服务端                                                  |
| `pnpm dev`                | 服务端和 Vite 热更新，Ctrl+C 停止两者                                   |
| `pnpm dev:editor`         | 仅启动编辑器开发服务器（Vite）                                          |
| `pnpm server:dev`         | 编译并启动服务端，连接 `auto_canvas` 库                                 |
| `pnpm server:migrate`     | 执行数据库迁移后退出                                                    |
| `pnpm build`              | 编译所有包和应用                                                        |
| `pnpm check`              | 格式、文档链接、生成文件、类型检查、lint、单元测试、编译                |
| `pnpm test:local`         | 单元和集成测试（Vitest），服务端测试使用 `auto_canvas_test` 库          |
| `pnpm test:e2e:local`     | 浏览器测试（Playwright），首次运行前执行 `pnpm setup:e2e` 安装 Chromium |
| `pnpm mcp:package`        | 打包给 Agent 使用的 MCP 服务端                                          |
| `pnpm test:desktop-build` | 编译桌面版界面                                                          |

## 仓库结构

```text
apps/
  editor/       React 原理图编辑器（网页版，也是桌面版的界面）
  server/       单用户 Node 服务端：登录状态、云端工程、自定义器件库
  desktop/      Electron 桌面预览版
  mcp-server/   供 Agent 使用的 MCP 适配层
  local-host/   托管编译好的编辑器的最小静态服务
packages/
  model, edit-engine, derived, devices, symbols, components   电路模型与编辑
  component-library                                            自定义器件库的接口约定
  spice, netlist, rnl, project-protocol                        导入导出与工程文件格式
  render-svg, exporters, math-typesetting                      渲染与图片导出
  agent-adapter, agent-client, agent-routing                   Agent 接口
eda/            离线导入 Aether / Virtuoso 的工具
docs/           接口约定、使用说明和开发流程
tasks/          每个开发任务一个目录：方案、报告、审查记录
```

## 开发方式

每个任务由 Opus（Claude Code）写方案，Codex 实现，Opus 亲自重跑验收命令并阅读
代码改动来审查。审查通过的改动经 PR 合入 `main`，合入前要求 CI 通过，并且 PR 上
已贴出 codex 评审。详见 [docs/workflow.md](docs/workflow.md)、
[AGENTS.md](AGENTS.md) 和 [CLAUDE.md](CLAUDE.md)。

## 文档

- [文档索引](docs/README.md)
- [服务端 HTTP 接口约定](docs/specs/server.md)
- [规格文档](docs/specs/README.md)
- [EDA 工具](docs/eda-import.md)
- [Agent 指南](docs/agent/README.md)

以上文档目前为英文。

## 基于 Analog Canvas

auto-canvas 是 **Analog Canvas** 的修改版本。Analog Canvas 是 cascode-ai 开发的
开源原理图编辑器，能够识别电气连接关系。

- 代码仓库：<https://github.com/cascode-ai/analog-canvas>
- 在线编辑器和社区 Gallery：<https://analog-canvas.tokenzhang.com/>
- 使用的快照：提交 `3d32c76`（版本 0.9.2，2026-11-05），记录在
  [UPSTREAM.md](UPSTREAM.md)

来自 Analog Canvas 的部分：原理图编辑器、电路模型和编辑引擎、符号和器件库、
SPICE/Spectre 导入导出、渲染和图片导出、Agent 接口和 MCP 服务端、桌面预览版，
以及 EDA 导出脚本。

auto-canvas 的改动：删除了托管的 Gallery、账户、Cloudflare 部署和上游 CI；用
`apps/server` 替代 Cloudflare Worker，提供云端工程和自定义器件库；采用新的开发
流程；接下来的工作是自动摆放和绕线。

如果 auto-canvas 对你的工作有帮助，请同时注明 Analog Canvas。
