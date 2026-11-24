# T164b review

## Round 1 — accepted

Reviewed: the working tree on `task/T164b-notebook-managed-start` over
`ec6222d` (2026-11-24): Part 1 read in full; `stage-m.mjs` read for its
cleanup (extension stop, process groups, signals by pid only after the
recorded `ps` identity, database drops), its redaction of every URL, password
and token it prints, and its TOML derivation; the refactor judged by stage A's
normalised output, which is identical before and after. Acceptance rerun by
Opus on lane 2.

| #   | Severity | Where                  | Finding                                                                                                                                                                                                                                                                                                                       | Outcome                             |
| --- | -------- | ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------- |
| 1   | fixed    | `docs/specs/server.md` | The catalog-guard paragraph did not mention the new transaction-local `search_path` pin.                                                                                                                                                                                                                                      | One sentence added by the reviewer. |
| 2   | note     | `stage-m.mjs`          | 1,441 lines, over the review threshold. It is one stage's phases sharing one context; splitting it would spread that context over modules for no reuse.                                                                                                                                                                       | Kept.                               |
| 3   | note     | the owner's checkout   | The implementer once listed the owner's `.local/diagnostics/` directory (names and times; nothing opened or written).                                                                                                                                                                                                         | Reported to the owner.              |
| 4   | note     | `pnpm test:local`      | The reviewer's full run had 8 failing files (5 s timeouts in component-library and publication tests, and "Cannot use a pool after calling end" after them) while another implementer ran packaging and builds on the machine (load average 35–43 on 18 cores). The 8 files passed together on a rerun; none is touched here. | None here; CI is the arbiter.       |

Acceptance rerun:

```text
pnpm build / build:notebook-editor                                  → 0
vitest run (guarded-database, migration-guard, notebook-launcher)   → 0   181 passed, 0 skipped
pnpm test:local                                                     → 1   9118 passed, 8 failed (finding 4)
vitest run (the 8 failing files together)                           → 0   38 passed
pnpm typecheck / lint / format:check / docs:check / deadcode        → 0
stage S                                                             → 0   70 passed
stage T                                                             → 0   141 passed
stage A (--ref b5850d6…, --base d3388036b)                          → 0   105 passed
stage M (--ref b5850d6…)                                            → 0   112 passed
owner ports 3000/8000/4310, notebook checkout status                → unchanged
databases named auto_canvas_it_* afterwards                         → 0
```
