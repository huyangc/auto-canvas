# T176 report

Written by Opus from the implementer's reports (rounds 1 and 2); acceptance
results are Opus's own reruns, recorded in `review.md`.

## What was built

- `apps/editor/src/document/cloud-auto-save.ts` (new): the preference
  (`icm.cloud-auto-save.v1`, default on, in-memory value that survives a
  storage failure), the online epoch, revision-scoped failure holds
  (`holdAfterFailure`, `applicableHold`), the interaction blocker and the
  statusbar indicator.
- `use-project-file-lifecycle.ts`: `autoSaveArmed` and `autoSaveHold` on the
  file session, `cloudBindingRef`, the 3 s scheduling effect with 500 ms
  re-polls, the automatic save through the existing coordinator (no
  `beforeSnapshot`, no routine status lines), manual Save waiting for an
  in-flight automatic save, `isUserSaveInFlight`, `saveBusy` that ignores
  auto-saves, replacement refused during an auto-save, `noteExternalCommit`.
- `use-project-tab-sessions.ts` / `use-project-tabs.ts`: `isTransitioning()`,
  `resumedFileSession` (restore never arms, offline holds end with the page),
  one Agent background Cloud save per tab that holds tab switches,
  `routeAgentCommit` (Agent commits reach the committing controller's tab),
  `signingOutCheck` (sign-out blocks auto-save and is undone when the page
  stays).
- `agent-workspace-requests.ts` / `use-agent-hosts.ts`: background saves are
  admitted by the live active tab, refused during a switch or a same-binding
  foreground save, and apply a receipt only to the binding they wrote against;
  holds are merged on the stored session; Agent commits route through
  `noteAgentCommitRef`.
- `App.tsx`: wiring, the auto-save blocker (switch blocker, tab transition,
  sign-out, Agent replacement, gestures, held pointer, modal dialog, tab close
  question) and the statusbar chip.
- `header-account-menu.tsx`: "Auto-save to Cloud On/Off" after My Cloud
  Projects, before Sign out.
- `account-context.tsx` / `account-gate.tsx` (round 2): the logout check may
  return an undo, called when sign-out does not reload.
- `playwright.config.ts`: shared storageState seeds auto-save off.
- Docs: `persistence-and-recovery.md`, `editor-interaction.md`,
  `getting-started.md`.

## Tests

Unit: `cloud-auto-save.test.ts`, 14 lifecycle cases, tab-session, project-tabs,
Agent requests (new file), Agent hosts, account menu, statusbar. Browser:
`cloud-auto-save.spec.ts` (11 cases, default run), one Agent case in
`web-agent-session.spec.ts`, one toggle test in `standalone-accounts.spec.ts`.

## Deviations

1. Design 10 changed in review (Opus decision): no cross-window `storage`
   listener, because the notebook build guard (T163) reserves storage events
   for the notebook gate. Another window reads a change on its next load.
2. `signingOut` clearing on a failed logout request needed
   `account-gate.tsx` / `account-context.tsx` (added to scope in review).
3. `noteAgentCommit` tests target the extracted pure `routeAgentCommit`.
4. Small additions: `useOnlineEpoch`; a manual Save answered by an automatic
   receipt reports "Saved … to Cloud"; a thrown automatic save reports "Cloud
   auto-save failed; …"; `isUserSaveInFlight` counts waiting manual saves.

## Not verified

Desktop at runtime (build only); the notebook and prefix e2e runs; a held
canvas drag/pan and the tab close question in a browser (unit-level only).

## Pre-existing failures (not T176)

`web-agent-session.spec.ts:662` (fails on main 7a21def), flaky
`hierarchy.spec.ts:1179`, and `agent-relay.test.ts` under a lane's
`AUTO_CANVAS_API_URL`.
