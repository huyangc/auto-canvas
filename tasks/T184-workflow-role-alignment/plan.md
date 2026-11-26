# T184 — Align the workflow guide with the repository entry

- Branch: `codex/workflow-role-alignment`
- Base: `main` at `fff1e510`

Update `docs/workflow.md` so a task owner can follow it from any agent entry. Check it against AGENTS.md, CLAUDE.md, the implementation wrapper, the testing guide and the CI workflow. Preserve the existing review evidence, branch, billing and merge rules and inbound links. Limit implementation to the workflow guide.

Run `node scripts/check-markdown-links.mjs` and `git diff --check`. Verify the guide's local links and anchors, its published CI commands and its instructions for delegated vs. owner-led work. Record the results in report.md.
