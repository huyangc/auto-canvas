# T171 — report

- Branch: `task/T171-replacement-guard-session`
- Plan: `plan.md` (approved; codex plan review 8 rounds, not converged on
  paper; owner chose to implement and let the code review close the rest)
- Implementer: Opus subagent, 5 commits on top of the plan commit
- Reviewer: Opus (independent rerun of every acceptance command)

## What is now true

Every Project replacement — imports by picker or drop, Open Project File,
Cloud opens that replace the current tab, examples, New, Revert, manual
recovery, the refresh restore, Agent acceptance — carries a
`ReplacementCommand` captured before its first await:

- `isCurrent()` requires both slot ownership and an unchanged activation
  counter; the counter is bumped synchronously in `restoreFileSession`,
  `replaceActiveProject` and on a rendered session change, so same-id
  controllers and A→B→A retirement are both caught;
- one command holds the slot from entry through its dialog
  (`Another replacement is waiting for your answer` for a second one),
  release is idempotent and owner-bound, and every exit — malformed file,
  rejected read, refused boundary, clean install, stale exit — admits the
  next command immediately;
- the guard revalidates after `beforeSnapshot`, stages the controller's
  current Project (not the render's snapshot) with the coordinator's
  current working-copy id, revalidates after the flush, and a stale exit
  cancels no shared recovery;
- the dialog stores its command and staged working-copy id, deletes only
  that copy, answers atomically per command, and a failed deletion keeps
  the copy, the dialog and the slot with a retry status;
- native, export and Cloud save-and-continue compare against
  `editorDocumentController.project` and the command's activation;
  save requests capture activation at creation so a joined Cloud save
  cannot acknowledge into another tab;
- stale late results publish nothing: no status, Import Review, dock
  change, chunk banner or Auto Layout request; a current drop's rejected
  read keeps `Couldn't read the dropped file`;
- the refresh restore owns its identity at request establishment, consults
  the live edit blocker and content token, stands down silently when a user
  command holds the slot, and settles
  `startupRestoreOutcome: pending | restored | unsuccessful`; a restored
  workspace tab counts as `restored` only when its deserialization
  installed it, and only `restored` enables automatic Agent reconnection
  (`agentConnectionGate`), with manual connection kept after a failure.

## Independent verification (rerun by the reviewer, Lane 2 env)

- `pnpm typecheck`, `pnpm lint` (0 errors / 3900 pre-existing warnings),
  `pnpm format:check`, `pnpm docs:check` — pass.
- `pnpm test:local` — 855 files passed / 3 skipped; 8925 tests passed /
  117 skipped.
- `pnpm build` — pass.
- Playwright `file-drop`, `project-tabs`, `editor-modes`, `project-file` —
  112 passed.
- `pnpm deadcode` — exit 1, the same 20 unused exports and 3 unused types
  in `packages/{model,netlist,spice}` as on the base; zero findings in any
  changed file.

## Reviewer notes

- Read: guard/dialog ordering (`guardDirtyReplacement`,
  `confirmReplaceGuard`, `saveAndContinueReplaceGuard`), slot/invalidation,
  `isDirtyWork`'s unrendered-commit branch, the import/open/slot decisions
  for `inTab`, the drop adapter's admission, the refresh-restore effects and
  `agentConnectionGate` with its consumer test. All match the approved plan;
  the implementer's seven deviations are justified (documented in the
  hand-back: hook members instead of module functions, `Promise<boolean>`
  from the guard for handoff, optional `exportProjectFile(owner)`, the
  quiet `beginReplacement`, the tab hook owning the workspace outcome, e2e
  setup in Draw).
- Known and accepted: a native Electron drop stays unverified; a real
  desktop drag/Escape remains a manual check (T170's note, unchanged).
- Not covered by this task: the Import Review's presentation and code-draft
  rules; recovery-store internals.

## Rounds

- Implementation: one round, accepted after the reviewer's rerun.
