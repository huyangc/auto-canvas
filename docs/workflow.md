# 工作流：Opus 出方案，Codex 实现

每项工作是 `tasks/` 下的一个任务目录。Opus（Claude Code）负责方案和审查，
Codex 负责实现，人负责确认范围和最终验收。

```text
需求 → ① Opus 方案 plan.md → 人确认范围
     → ② Codex 实现（scripts/codex-task.sh）→ report.md
     → ③ Opus 审查：亲自重跑验收命令 + 读 diff
          ├ 通过 → Opus 在任务分支提交 → 合并到 main
          └ 不通过 → review.md 写明问题 → 回到 ②（最多 3 轮，之后找人决定）
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
  不切分支，提交和合并由 Opus 在审查通过后进行。
- **方案要能直接执行**：写清目标、真实路径、要改的耦合点、步骤顺序、范围
  内外、可直接运行的验收命令及预期结果。方案不确定的地方先查代码，查不清就
  在方案里列为调查步骤，并写明调查结论放进 report。
- **任务要小到能审查**：一轮 diff 应能读完。大范围删除按“先切断入口，再删除
  不可达代码”分成几个任务。
- **验收以 Opus 重跑为准**：report 里的测试结果只作参考。
- **超出范围就停下**：Codex 遇到方案没覆盖的必要改动，要记录在 report，
  而不是自行设计。

## 运行 Codex

```bash
scripts/codex-task.sh tasks/T001-<slug>
```

脚本会检查分支、拼出提示词（AGENTS.md + plan.md + review.md），然后用
`codex exec`（workspace-write 沙箱、自动审批）在仓库根目录运行。环境变量
`CODEX_MODEL` 可覆盖模型。日志在 `tasks/<id>/logs/round-<n>.jsonl`。

沙箱里没有网络，依赖要事先装好（`pnpm install --frozen-lockfile`）。

## Claude Code 技能

- `plan-task`：调查代码，写 plan.md，开任务分支。
- `codex-task`：派发 Codex，审查，提交或写 review.md 进入下一轮。
