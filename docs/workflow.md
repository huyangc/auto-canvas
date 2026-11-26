# 从需求到 PR 的仓库工作流

根据[仓库入口](../AGENTS.md)判断本次职责。直接接到用户需求的入口是**任务负责人**，负责调查、规划、验收和交付。收到指定计划的**受派实现者**在简报范围内工作。GPT、Claude 或其他模型都可以承担这两种职责。

1. **接到需求。** 先检查工作区和相关代码。问题可以直接回答，故障可以马上调查。需要改仓库时，负责人使用任务专属 worktree，根据[模板](../tasks/_template/plan.md)创建或核对计划，写明任务分支、可改路径和验收命令。
2. **确定范围。** 负责人对照代码自查方案，与用户确认范围和产品决定，沿用已经给出的决定。用户要求独立方案评审时，先按[方案评审](#方案评审)执行。
3. **实现与验收。** 负责人可委派实现。用户要求亲自实现或环境只有一个代理时，负责人按同一计划实现，再单独审查 diff、重跑验收。受派实现者按简报交回报告，负责人亲自验收。
4. **交付。** 自验证通过后，负责人自动提交、推送并创建或更新 PR，核对远端最新提交的独立评审。收到本次合入授权后跟进到检查通过、阻塞意见解决并确认合入，详见 [PR 评审与合入](#pr-评审与合入)。

## 任务目录

```text
tasks/T001-<slug>/
  plan.md     负责人写，受派实现者只读
  report.md   负责人记录本轮结果（脚本派发的 Codex 实现轮次自行写入）
  review.md   负责人每轮追加一节，受派实现者只读
  logs/       方案评审的原始输出；Codex 轮次的事件流和最后一条消息（不入库）
```

模板在 [tasks/_template/](../tasks/_template/)。编号递增，slug 用小写短横线。

## 规则

- **一个任务一个分支**：从最新 `main` 创建任务 worktree，分支名写入计划（例如 `task/T001-<slug>`）。受派实现者只在简报
  要求时提交，且只提交在任务分支上；不推送、不合并、不 rebase、不切分支。Codex
  实现轮次从不提交。任务负责人验收通过后提交并创建 PR，取得本次交付授权并满足合入条件后执行合并。不直接推送 `main`。
- **方案评审按需**：默认由负责人对照代码自查，然后直接交人确认范围；用户要求时，
  确认范围之前方案要过一轮或多轮[方案评审](#方案评审)。
- **方案要能直接执行**：写清目标、真实路径、要改的耦合点、步骤顺序、范围
  内外、可直接运行的验收命令及预期结果。方案不确定的地方先查代码，查不清就
  在方案里列为调查步骤，并写明调查结论放进 report。
- **任务要小到能审查**：一轮 diff 应能读完。大范围删除按“先切断入口，再删除
  不可达代码”分成几个任务。
- **验收以负责人重跑为准**：report 里的测试结果只作参考。
- **实现轮次**：负责人将需修复的问题写入 `review.md`；受派实现者修复所有 `must-fix` 并重跑验收。三轮后仍有未解决的实现问题，交用户决定。
- **超出范围就停下**：实现者遇到方案没覆盖的必要改动，要记录在报告里，
  而不是自行设计。
- **API Key 额度**按[仓库入口的额度规则](../AGENTS.md#修改与验证)处理。规划、实现、评审和委派均按实际计费方式判断。

## 并行任务

范围互不重叠的任务可以同时交给实现子代理，再一起审查。

- **先判断能否并行**：两个任务的 owned paths 不能有交集，也不能一个依赖另一个
  的结果；有交集或依赖的按顺序做。删除类任务要连同所有引用方一起算范围。
- **每个任务一个 worktree**，主目录留在 `main`。在 worktree 里装好依赖后，在该
  worktree 里启动实现子代理：

  ```bash
  git worktree add ../auto-canvas-T001-example -b task/T001-example origin/main
  pnpm install --frozen-lockfile --offline
  ```

- **并行集成测试各用一条车道**，避免端口和测试库冲突。涉及相应服务时，在验收命令里写明所用端口和数据库：

  | 车道 | `ICM_E2E_PORT` | `AUTO_CANVAS_E2E_API_PORT` | `AUTO_CANVAS_TEST_DATABASE_URL`    |
  | ---- | -------------- | -------------------------- | ---------------------------------- |
  | 1    | 4173           | 4311                       | `postgresql:///auto_canvas_test`   |
  | 2    | 4273           | 4321                       | `postgresql:///auto_canvas_test_2` |
  | 3    | 4373           | 4331                       | `postgresql:///auto_canvas_test_3` |

  车道 2、3 的数据库要先用 `createdb` 建好。

- **准备任务输入**：若受派环境无法读取其他 worktree，将需要的输入（例如评测语料）复制进它自己
  的 worktree。

- **一起审查，逐个交付**：每轮结束后由负责人审查，各自开 PR。PR 按顺序
  合入；后合入的先 rebase 到最新 `main` 并重跑验收，再合入。
- **最多三个并行**：受审查精力和本机资源限制。

## 方案评审

默认不走这一节：负责人对照代码检查方案，然后交人确认范围。用户要求方案评审时，
在方案写完、人确认范围之前，用 codex（model `gpt-6.2-astra`，只读沙箱）评审方案：

```bash
codex exec -m gpt-6.2-astra --sandbox read-only --ephemeral -c 'notify=[]' \
  -c 'approval_policy="never"' -o <out.txt> "<评审提示词：方案文件路径及其依据>" < /dev/null
```

`< /dev/null` 不能省，否则 `codex exec` 会等待标准输入。`approval_policy="never"`
是因为本机配置可能允许审批请求，借此离开只读沙箱。

一轮有效须同时满足：命令退出码为零、输出文件非空、输出里有结论。超时、非零退出或
输出为空是失败的一轮，不等于“没有意见”，要重跑。

一轮通过须输出明确的通过结论（无 P0/P1），且每条意见都带优先级。“需要修改”之类没有
优先级的结论，或没有优先级的意见，都不算通过，要求给出优先级后重跑。

负责人对照代码核实每条意见，修改方案，再评审一轮，直到某一轮不再报告 P0/P1。
方案里记录结论（轮数和判定），原始输出放在 `tasks/<id>/logs/`（不入库）。

人确认范围时或之后的改动若改变了方案的范围或设计，且用户要求过方案评审，改后的方案
在派发前要重新过方案评审，并更新方案里的 `Plan review` 一行。重审后范围或产品决定又变了，
要回到人那里；只有人确认了最终的范围和产品决定，才把状态标为 approved。

## 派发实现子代理

委派时提供目标、任务目录、工作树和分支、可改路径、验收命令、提交权限及报告方式。实现者通读计划和已有评审，执行验收，把结果按[报告模板](../tasks/_template/report.md)交给负责人。负责人核对 diff 和实际验收结果。Claude Code 的工具和模型选择见 [CLAUDE.md](../CLAUDE.md)；其他入口使用本环境的委派工具。

### 按要求运行 Codex 轮次

用户要求独立的 Codex 实现轮次时，使用 `scripts/codex-task.sh`。脚本要求计划含有 `- Status: approved` 和与当前分支一致的 `Branch` 行。任务的第一轮 Codex 开始时，任务目录之外
不能有未提交的改动：由负责人整理本任务的已有改动，保留无关工作。之后的 Codex 轮
次接着上一轮未提交的改动继续，轮间不提交。

任务的轮次和三轮上限以 `review.md` 为准。Codex 日志的 `round-<n>` 只数 Codex 轮次，
前面有过子代理轮次时它仍从 1 开始，派发时在 `review.md` 里写明这是任务的第几轮。两者不同时，负责人审查时把
`report.md` 标题改成任务的轮次。

```bash
scripts/codex-task.sh tasks/T001-<slug>
```

脚本检查分支、拼出提示词（AGENTS.md + plan.md + review.md），用
`codex exec --approve-for-me`（workspace-write 沙箱）在仓库根目录运行。环境变量
`CODEX_MODEL` 可覆盖模型。日志在 `tasks/<id>/logs/round-<n>.jsonl`。沙箱里没有
网络，依赖要事先装好（`pnpm install --frozen-lockfile`）；脚本设置
`pnpm_config_verify_deps_before_run=false`（及旧版 pnpm 的 `npm_config_` 写法），
防止 pnpm 在离线沙箱里重装依赖、清空 `node_modules`。

原始事件流可能有几 MB，用 `scripts/codex-log.mjs` 过滤：

```bash
node scripts/codex-log.mjs tasks/T001-<slug>                          # 最新一轮时间线，供审查对账
node scripts/codex-log.mjs tasks/T001-<slug> --show 12                # 第 12 条命令的完整输出
node scripts/codex-log.mjs tasks/T001-<slug> --round 2 --follow       # 供 Monitor 使用
```

`--follow` 只输出消息、错误和结果；`codex-task.sh` 结束时写入 `round-<n>.exit`，
它读到后输出 `END exit=<状态>` 并退出，连续 15 分钟没有新事件时输出 `STALLED`。
日志只记录动作和消息，不包含 Codex 的思考过程。

## PR 评审与合入

远端为本仓库的 `origin`。推送或创建、更新 PR 可能触发自动评审；负责人先按[发布与额度规则](../AGENTS.md#提交提-pr-与合入)核对实际计费方式。

用户的长期偏好已授权：自验证通过后自动提交、推送任务分支并创建 PR。已有 PR 时更新同一分支。开发者对本次交付另有指示时按其指示执行。开发者说“CI 绿了就合入”即已授权负责人持续跟踪并在满足下列条件时合入。仅授权提 PR 时，交付链接与评审状态。

- **提交**：改动实现的提交要带 Test-Impact trailer，规则见
  [docs/testing/README.md](testing/README.md#test-impact)；由负责人审查时核对，CI 不检查。
- **评审证据**：创建或更新 PR 后，由负责人安排 codex（model `gpt-6.2-sol`）独立评审。仅交付 PR 时也要报告当前 head 的评审结果或待办。
  每一轮的原始输出都要逐字贴回 PR，包括零意见和手动轮次，并附触发方式、完整命令、
  head SHA、退出码和输出字节数。一轮成功必须同时满足退出码为零且输出非空；
  `base..HEAD` 为空是硬失败。
  auto-layout 任务还须由负责人本地重跑 `pnpm test:slow`，并将结果贴回 PR 作为评审证据；
  该命令运行默认 CI 排除的 `*.slow.test.ts` 完整搜索质量基准。
- **阻塞判定**：P0/P1 阻塞。核实后修复站得住的意见并重审，只有意见不成立或修复超出
  授权范围时才交人决定。P2/P3 可说明理由后不改。优先级解析失败时保守阻塞。
- **驳回意见**：在 PR 上给出理由与证据，并用代码注释记录取舍、用回归测试钉住保留的
  行为。文档或配置类改动没有可测行为时，在 PR 上说明即可。
- **合入条件**：`gh pr checks` 里的检查全部是 `pass`（没有失败、取消、进行中或
  `skipping`）；且 PR 上已贴出针对其远端 `headRefOid` 的评审；任何新提交之后都要评审新的
  远端 head。该评审须用 `gpt-6.2-sol` 跑，且对同一轮可证：hook 该轮日志显示
  `model: gpt-6.2-sol`，或该轮使用下文的手动评审命令（它同时设 `-m` 和 `review_model`，贴出的命令行可见）。
  无法确认模型时（例如交接的 PR 没有 hook 日志），合入前运行手动命令并贴回。
  `verify` 只核对 head SHA，不核对模型。`mergeStateStatus: CLEAN`、
  本地 `git rev-parse HEAD`、agent 汇报和 hook 本地状态都不算证据。满足后用
  `gh pr merge <PR号> --rebase --match-head-commit <已评审的远端SHA>` 合入；用户要自己合入时只交回 PR 链接和状态。
- **合入结果**：只认 `gh pr view <PR号> --json state` 返回 `MERGED`。stacked PR 使用
  自己的基分支。

### CI

[CI 工作流](../.github/workflows/ci.yml) 在 PR 和推送到 `main` 时启动一个 `Check` 作业，使用 PostgreSQL 16。安装依赖后依次运行格式、文档链接、生成文档、器件库、类型、lint、deadcode、构建和 `pnpm test:local`。同一引用有新运行时会取消旧运行。浏览器测试、实机检查和 `*.slow.test.ts` 的执行范围见[测试指南](testing/README.md)；负责人将任务要求的本地验收证据写进 PR。

### 手动运行独立 PR 评审

钩子未运行，或运行结束后仍缺少当前远端 head 的有效评审时，负责人手动补评。在 `git status --porcelain` 输出为空的 worktree 中评审，确认其 HEAD 等于 PR 的 `headRefOid`。若任务 worktree 有未提交工作，另建该 SHA 的干净 worktree 并保留原有改动。更新 PR 基分支的远端引用并检查差异非空。在该 worktree 中为本轮创建独立输出文件，先将 `PR_NUMBER` 设为待评审的 PR 号；示例在脚本中运行，也适用于 detached HEAD。

```bash
set -eu
pr_base=$(gh pr view "${PR_NUMBER:?请设置待评审的 PR 号}" --json baseRefName --jq .baseRefName)
review_output=$(mktemp)
codex exec review --base "origin/$pr_base" --ephemeral -m gpt-6.2-sol \
  -c 'review_model="gpt-6.2-sol"' -c 'model_reasoning_effort=medium' -c 'notify=[]' -o "$review_output"
```

核对退出码和非空输出，将原文和本轮命令、SHA、退出码、字节数贴回 PR。用 `gh pr view <PR号> --json headRefOid,comments` 核对远端证据。

### Claude Code PR 操作

自动评审（model `gpt-6.2-sol`）由开发者本机的 `~/.claude/hooks/codex-pr-review.sh`
提供，不是仓库产物：开 PR 后它自动跑一轮并贴回评论，判过 P0/P1 后有新提交时自动重审。
它运行 `codex exec review` 时不带 `-m`，模型取自 `~/.codex/config.toml` 的 `model`，
设了 `review_model` 时以它为准（评审用它），依赖 hook 一轮前两个键都要查；该轮日志
`~/.claude/codex-pr-review/logs/pr<PR号>-r<n>.log` 里有一行 `model:`，要确认是
`gpt-6.2-sol`，否则改好配置重跑，或手动补评并贴回输出。
日志文件名只含 PR 号和轮次。同一钩子用于多个仓库时，须能把日志对应到具体仓库、PR、远端 head SHA 和已贴出的那一轮评论。关联不明或缺少有效证据时，按[手动运行独立 PR 评审](#手动运行独立-pr-评审)补评。

装有 hook 时可用的手动操作：

```bash
~/.claude/hooks/codex-pr-review.sh run <PR号> manual
~/.claude/hooks/codex-pr-review.sh show-state <PR号>
~/.claude/hooks/codex-pr-review.sh verify <PR号>
```

使用钩子评论作为证据时，合入前运行 `verify`，确认评论与远端 `headRefOid` 匹配。手动评审使用上一节的人工核对方式。

## Claude Code 技能

- `plan-task`：调查代码，写 plan.md，自查（用户要求时加 codex 方案评审），开任务分支。
- `run-task`：派发实现子代理（或按要求派发 Codex 轮次），审查，提交并开 PR，或写
  review.md 进入下一轮。
