# 工作流：Opus 出方案，Codex 实现

每项工作是 `tasks/` 下的一个任务目录。Opus（Claude Code）负责方案和审查，
Codex 负责实现，人负责确认范围和最终验收。

```text
需求 → ① Opus 方案 plan.md → 人确认范围
     → ② Codex 实现（scripts/codex-task.sh）→ report.md
     → ③ Opus 审查：亲自重跑验收命令 + 读 diff
          ├ 通过 → Opus 在任务分支提交 → ④
          └ 不通过 → review.md 写明问题 → 回到 ②（最多 3 轮，之后找人决定）
     → ④ 推送并开 PR → codex 评审贴回 PR + CI → 按授权 rebase 合入 main
```

## 任务目录

```text
tasks/T001-<slug>/
  plan.md     Opus 写，Codex 只读
  report.md   Codex 每轮覆盖重写
  review.md   Opus 每轮追加一节，Codex 只读
  logs/       每轮 Codex 的事件流和最后一条消息（不入库）
```

模板在 [tasks/_template/](../tasks/_template/)。编号递增，slug 用小写短横线。

## 规则

- **一个任务一个分支**：`task/T001-<slug>`，从 `main` 开出。Codex 不提交、
  不切分支，提交、PR 和合并由 Opus 在审查通过后进行。不直接推送 `main`。
- **方案要能直接执行**：写清目标、真实路径、要改的耦合点、步骤顺序、范围
  内外、可直接运行的验收命令及预期结果。方案不确定的地方先查代码，查不清就
  在方案里列为调查步骤，并写明调查结论放进 report。
- **任务要小到能审查**：一轮 diff 应能读完。大范围删除按“先切断入口，再删除
  不可达代码”分成几个任务。
- **验收以 Opus 重跑为准**：report 里的测试结果只作参考。
- **超出范围就停下**：Codex 遇到方案没覆盖的必要改动，要记录在 report，
  而不是自行设计。
- **用 LLM API 前先确认**：凡是会调用 LLM 服务商 API、消耗 token 的命令、
  脚本、评测或实验，开始前由 Opus 向用户说明要跑什么、大约多少次调用和费用，
  得到用户确认后才运行。一次确认只对所说明的那一次运行有效，自主批量执行时
  也不例外。方案里遇到这类步骤要写明“先问用户”，Codex 不自行运行。只读取
  已缓存结果、不发起 API 调用的运行不受限。Codex 轮次
  （`scripts/codex-task.sh`）、codex PR 评审和 Claude Code 子代理是流程自带
  的工具，不属于这条规则。

## 并行任务

范围互不重叠的任务可以同时交给 Codex，再一起审查。

- **先判断能否并行**：两个任务的 owned paths 不能有交集，也不能一个依赖另一个
  的结果；有交集或依赖的按顺序做。删除类任务要连同所有引用方一起算范围。
- **每个任务一个 worktree**，主目录留在 `main`。在 worktree 里装好依赖后，从该目录
  运行 `scripts/codex-task.sh`：

  ```bash
  git worktree add .claude/worktrees/<id> -b task/<id>-<slug> origin/main
  pnpm install --frozen-lockfile --offline
  ```

- **每个任务一条车道**，避免端口和测试库冲突。方案的验收命令里写明这三个环境变量：

  | 车道 | `ICM_E2E_PORT` | `AUTO_CANVAS_E2E_API_PORT` | `AUTO_CANVAS_TEST_DATABASE_URL`    |
  | ---- | -------------- | -------------------------- | ---------------------------------- |
  | 1    | 4173           | 4311                       | `postgresql:///auto_canvas_test`   |
  | 2    | 4273           | 4321                       | `postgresql:///auto_canvas_test_2` |
  | 3    | 4373           | 4331                       | `postgresql:///auto_canvas_test_3` |

  车道 2、3 的数据库要先用 `createdb` 建好。

- **一起审查，逐个交付**：每轮结束后照常按 `codex-task` 审查，各自开 PR。PR 按顺序
  合入；后合入的先 rebase 到最新 `main` 并重跑验收，再合入。
- **最多三个并行**：受审查精力和本机资源限制。

## 运行 Codex

```bash
scripts/codex-task.sh tasks/T001-<slug>
```

脚本会检查分支、拼出提示词（AGENTS.md + plan.md + review.md），然后用
`codex exec --approve-for-me`（workspace-write 沙箱，审批请求交给自动审查）在仓库根目录运行。环境变量
`CODEX_MODEL` 可覆盖模型。日志在 `tasks/<id>/logs/round-<n>.jsonl`。

沙箱里没有网络，依赖要事先装好（`pnpm install --frozen-lockfile`）。脚本设置
`pnpm_config_verify_deps_before_run=false`（以及旧版 pnpm 读取的 `npm_config_` 写法），防止 pnpm 在运行脚本前尝试重装依赖、
在离线沙箱里清空 `node_modules`。

## 查看 Codex 的过程

原始事件流可能有几 MB，不要直接读，用 `scripts/codex-log.mjs` 过滤：

```bash
node scripts/codex-log.mjs tasks/T001-<slug>
node scripts/codex-log.mjs tasks/T001-<slug> --show 12
node scripts/codex-log.mjs tasks/T001-<slug> --round 2 --follow
```

- **默认**：最新一轮的时间线，含每条命令的退出码和 Codex 的消息。审查时用它和
  report 对账。
- **`--show <n>`**：时间线里第 n 条命令的完整输出。
- **`--follow`**：运行中只输出消息、错误和结果，供 Claude Code 的 `Monitor` 使用。
  `codex-task.sh` 结束时写入 `round-<n>.exit`，它读到后输出 `END exit=<状态>` 并退出。
  连续 15 分钟没有新事件时输出 `STALLED`，可能是命令耗时长，也可能是这一轮已经中断。

日志只记录动作和消息，不包含 Codex 的思考过程。

## PR 评审与合入

远端是 `git@github.com:huyangc/auto-canvas.git`（`origin`）。

用户的长期偏好已授权：审查通过后默认推送任务分支并创建 PR，无需再次询问；当前任务
有其他指示时按当前指示执行。这条偏好只授权创建 PR，合入须有该次交付的授权，并满足
下述全部条件。

- **提交**：改动实现的提交要带 Test-Impact trailer，规则见
  [docs/testing/README.md](testing/README.md#test-impact)；由 Opus 审查时核对，CI 不检查。
- **评审证据**：PR 合入前必须经过 codex 评审，这是 Opus 审查之外的第二道独立阅读。
  每一轮的原始输出都要逐字贴回 PR，包括零意见和手动轮次，并附触发方式、完整命令、
  head SHA、退出码和输出字节数。一轮成功必须同时满足退出码为零且输出非空；
  `base..HEAD` 为空是硬失败。
- **阻塞判定**：P0/P1 阻塞。核实后修复站得住的意见并重审，只有意见不成立或修复超出
  授权范围时才交人决定。P2/P3 可说明理由后不改。优先级解析失败时保守阻塞。
- **驳回意见**：在 PR 上给出理由与证据，并用代码注释记录取舍、用回归测试钉住保留的
  行为。文档或配置类改动没有可测行为时，在 PR 上说明即可。
- **合入条件**：`gh pr checks` 里的检查全部是 `pass`（没有失败、取消、进行中或
  `skipping`）；且 PR 上已贴出针对其远端 `headRefOid` 的评审；任何新提交之后都要评审新的
  远端 head。`mergeStateStatus: CLEAN`、
  本地 `git rev-parse HEAD`、agent 汇报和 hook 本地状态都不算证据。满足后用
  `gh pr merge <PR号> --rebase` 合入；用户要自己合入时只交回 PR 链接和状态。
- **合入结果**：只认 `gh pr view <PR号> --json state` 返回 `MERGED`。stacked PR 使用
  自己的基分支。

### CI

`.github/workflows/ci.yml` 在每个 PR 和 `main` 的推送上运行一个 `Check` 任务：格式、
文档链接、生成文件、器件库、类型检查、lint、编译和单元测试（带 PostgreSQL 16 服务，
供 `apps/server` 的测试使用）。编辑器仿真模块及其历史失败测试已删除，CI 不再排除测试。浏览器测试和实机检查不在
CI 里，它们的证据以 Opus 亲自重跑的结果为准，写进 PR 的 Evidence。

### Claude Code PR 操作

自动评审由开发者本机的 `~/.claude/hooks/codex-pr-review.sh` 提供，不是仓库产物：
开 PR 后它自动跑一轮并贴回评论，判过 P0/P1 后有新提交时自动重审。新 clone 可能没有
这个 hook，但评审规则不变；没有 hook 时手动运行并按上述要求贴回证据：

```bash
codex exec review --base origin/main --ephemeral \
  -c 'model_reasoning_effort=medium' -c 'notify=[]' -o <out>
```

装有 hook 时可用的手动操作：

```bash
~/.claude/hooks/codex-pr-review.sh run <PR号> manual
~/.claude/hooks/codex-pr-review.sh show-state <PR号>
~/.claude/hooks/codex-pr-review.sh verify <PR号>
```

合入前 `verify` 必须成功，它以 PR 评论和远端 `headRefOid` 对账。没有 hook 时人工做同样的
核对：`gh pr view <PR号> --json headRefOid,comments`，确认有一条评审评论的 head SHA 与
`headRefOid` 一致，且退出码为零、输出非空。

## Claude Code 技能

- `plan-task`：调查代码，写 plan.md，开任务分支。
- `codex-task`：派发 Codex，审查，提交并开 PR，或写 review.md 进入下一轮。
