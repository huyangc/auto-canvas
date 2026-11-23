# T153 report — round 1

Written by the reviewer from the implementer's final message (Sonnet subagent).

## Summary

All eleven steps are applied. Both knip passes report exactly the frozen
findings that T154 owns; `pnpm test:local` gives the trial's totals; the Agent
API hashes are identical and `fixtures/agent-api` has no diff. No step was
blocked and no edit is outside the owned paths.

## Steps

| Step                      | Status | Notes                                                                                                                                                                                                                                                  |
| ------------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1 Knip configuration      | done   | Entries for `editor-supervisor.mjs`, `eda/{build,export,snapshot}.mjs`, `netlists/*/verify.mjs`, `tasks/*/*.mjs` and their project globs; the stale harness entry is gone.                                                                             |
| 2 Server relay            | done   | Deleted `bearer.ts`, `same-origin.ts`, `agent-session.ts`; the test imports from `agent-session-do.js` and `agent-session-runtime.js`; owner list in `web-agent-session.md` updated.                                                                   |
| 3 Scripts                 | done   | `changedLines` is private in `lint-report.mjs`; deleted `verify-pr-selection.mjs`, `simulator-busy-wait.mjs` and its test; row 19 of `contract-matrix.md` deleted.                                                                                     |
| 4 Editor account          | done   | Deleted `cacheSessionUser`, `renameAccount`, `DeleteAccountResult`, `deleteAccount`; `signOut` lost `export`; deleted `sign-in-request.ts` and its listener in `account-menu-view.tsx`; removed the Delete-account sentence from `getting-started.md`. |
| 5 Other editor leftovers  | done   | Deleted `SITE_PRIVACY_PATH`, `SITE_OPERATOR`, `SITE_USAGE_NOTE`, `isRequestFailure`; `GRID_INCOMPATIBLE` and `downloaded` lost `export`.                                                                                                               |
| 6 Retire conversion route | done   | Two cases added to `conversion.test.ts`; the four request and dev files deleted; re-export and Vite plugin removed; `isNetlistDialect` lost `export`; spec, spec index, source comment and e2e pointer updated.                                        |
| 7 Agent adapter           | done   | The three `AgentGallery*Schema` constants lost `export`; the three unused types deleted.                                                                                                                                                               |
| 8 Auto-layout             | done   | Deleted `drivingPoint`; `pairMembers` lost `export`; `reverses` tagged `@internal` with its reason; `@internal` removed from exactly 25 symbols. `pin-portfolio.ts`, `partitionTailGroups`, `inferRole`, `sampleClusters` untouched.                   |
| 9 Model                   | done   | Deleted `projectDraftingCover`, `labelLookChanges` with its interfaces and `drawsScripts`, `isScript`, `hasItalicScripts`, `uprightScripts`, and the three test cases with the `run` helper.                                                           |
| 10 Derived                | done   | Deleted `submission-gates.ts`, its test, the re-export and the live-domains case; `library-examples.test.ts` keeps the `runErcChecks` assertion under the title "has no electrical rule issue".                                                        |
| 11 Format and verify      | done   | Prettier on the changed files; one leftover fragment in `account.test.tsx` fixed by hand.                                                                                                                                                              |

## Acceptance results

Implementer's runs (lane 1 variables exported):

```text
pnpm format:check → 0
pnpm docs:check → 0; Validated local Markdown links in 75 files
pnpm typecheck → 0
pnpm lint → 0; oxlint: 2140 files, 0 errors, 3701 warnings
pnpm build → 0
pnpm test:local → 0; Test Files 833 passed | 3 skipped (836); Tests 8624 passed | 117 skipped (8741)
node tasks/T153-deadcode-cleanup/knip-expect.mjs → 0
  default: exit 1 with exactly the 23 expected findings, no hints
  production: exit 1 with exactly the 35 expected findings, no hints
pnpm agent-kit:catalog:check → 0
pnpm agent-docs:generated:check → 0; 6 outputs, 0 stale
pnpm components:check → 0
pnpm --filter "@icm/agent-adapter..." build → 0
agent-api-hashes.mjs | diff - agent-api-hashes.expected → 0, no output
git diff --exit-code -- fixtures/agent-api → 0
pnpm agent-api:artifacts:check → 1 with main's message (agent-circuit-response.schema.json is stale)
13 deleted paths absent → 0; git diff --diff-filter=D lists exactly those 13
```

The implementer ran the compound acceptance lines as separate commands (its
sandbox refused some compound forms); the checks are the plan's.

## Deleted test cases and moved assertions

Deleted, 17 cases, each with no remaining surface:

- `account.test.tsx` "reads each answer the server gives to an account
  deletion" (`deleteAccount` is gone; the server has no delete route), and the
  `cacheSessionUser` half of the shared-session case (retitled "shares the
  session with other readers").
- `conversion-request.test.ts` (3 cases) and `dev/netlist-conversion.test.ts`
  (1 case): the route is retired.
- `submission-gates.test.ts` (whole file) and the live-domains case "keeps
  Gallery quality advice independent of editor results": the Gallery
  Check-and-Save gates have no caller.
- `label-typography.test.ts`: three cases of `labelLookChanges`,
  `hasItalicScripts`, `uprightScripts`.
- `simulator-busy-wait.test.mjs` (whole file): the hosted-deploy retry helper.

Moved, 2 new cases in `packages/spice/src/conversion.test.ts`:

- "accepts ngspice as an alias of the SPICE target" (from the dev-route test).
- "names the unsupported-parameter code and its line without partial output"
  (from `conversion-request.test.ts`).

HTTP status, header, method, media-type, body-size and routing assertions
retired with the route.

## Investigation results

`docs/testing/contract-matrix.md` row 19 named
`scripts/lib/{validation-gates,ci-validation-plan,verify-pr-selection,test-impact}.test.mjs`.
None of the four files exists, so the whole row was deleted.

## Deviations and open questions

- No deviation from the plan.
- The behavioral checks that need a running editor (`pnpm dev`, the e2e spec)
  were not run by the implementer; the unit suites covering them passed.
- `pnpm test:slow` is the reviewer's.
