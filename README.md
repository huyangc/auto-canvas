# auto-canvas

auto-canvas 是面向模拟电路自动布局布线（APR）的 Web 原理图画布，支持人工微调。
项目起源于 analog-canvas 快照，来源与版本记录见 [UPSTREAM.md](UPSTREAM.md)。
采用 [AGPL-3.0 许可证](LICENSE.md)。

## 安装与运行

需要 Node.js 24+ 和 pnpm 11.16。

```bash
pnpm install --frozen-lockfile
pnpm build
pnpm dev
```

运行本地检查：

```bash
pnpm check
```

当前已知有 3 个仿真产物文件测试失败，留待后续仿真清理任务处理。

## 仓库布局

- `apps/`：Web 编辑器、桌面应用和本地服务等应用入口。
- `packages/`：共享模型、编辑引擎、渲染、协议等模块。
- `eda/`：EDA 工具与相关资源。
- [docs/specs/](docs/specs/README.md)：产品与模块契约。

任务方案、实现和审查流程见 [工作流](docs/workflow.md)，文档入口见
[docs/README.md](docs/README.md)。
