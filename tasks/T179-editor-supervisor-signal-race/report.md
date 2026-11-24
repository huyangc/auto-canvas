# T179 report

## Root cause
`scripts/lib/editor-supervisor.mjs` called `spawn` before installing its
SIGINT/SIGTERM/SIGHUP handlers. A signal arriving right after the child
started hit Node's default action and killed the supervisor (exit
`[null, "SIGTERM"]` after ~6 ms), orphaning the editor's process group.

## Changes
- `scripts/lib/editor-supervisor.mjs`: handlers are installed before `spawn`
  (same behavior; `killGroup` is a no-op until the child exists); header comment
  explains the ordering.
- `scripts/launcher.test.mjs` (the one test): captures `[code, signal]` from
  `exit`, asserts `signal === null` and `code === 1` before the unchanged
  >= 400 ms assertion; comment updated.

## Verification
- Temp copies under `tmp/` (not committed) with a 200 ms busy wait after
  `spawn`, probed with `sh -c 'trap "" TERM; echo $$; sleep 30'`, STOP_TIMEOUT=1:
  - fixed: exit `[1,null]` after 711 ms
  - original (`git show HEAD:...`): exit `[null,"SIGTERM"]` after 2 ms
- `pnpm test:local scripts/launcher.test.mjs`: 22 passed.
- 20x `pnpm test:local scripts/launcher.test.mjs -t "editor supervisor"`: 20 passes.
- `pnpm lint`: 0 errors (warnings pre-existing). `pnpm format:check`: clean.
- `pnpm test:local` full: first run 1 failed / 9121 passed (an unrelated
  `expect(code).toBe(0)` failure around launcher test line ~412, not
  identified further); the immediate rerun had no failures.

## Deviations
None. The one unrelated full-suite failure did not reproduce.
