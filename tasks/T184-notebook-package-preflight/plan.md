# T184 — Verify the offline wheel command and preserve interpreter paths

- Branch: `codex/notebook-package-preflight-followups`
- Base: `main` at `fff1e51`
- Status: approved as the packaging follow-ups to PR 146
- Plan review: self-checked against the packaging entry point and its tests

## Goal

Fail before touching the package output when the selected interpreter cannot load the wheel build command. Run the same interpreter the caller named when a path traverses a symbolic link followed by a parent component.

## Scope and steps

1. Extend `scripts/package-notebook-canvas.test.mjs` to exercise relative and absolute interpreter paths through a symlink, and an importable wheel with an unloadable build command.
2. Update `parseArgs` and `checkPython` in `scripts/package-notebook-canvas.mjs`. Preserve bare command names and the existing setuptools 70.1 threshold.
3. State the complete interpreter requirements in the packaging script and `integrations/silicon-notebook/README.md`. Record acceptance in this task directory.

## Acceptance

Run the packaging tests, typecheck, lint, formatting and docs checks. Build a notebook package with the configured build interpreter using the normal pnpm entry point. Run the package checker against the archive on PostgreSQL lane 3.
