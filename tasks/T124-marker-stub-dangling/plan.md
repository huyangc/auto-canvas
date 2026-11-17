# T124 — No open stub left on a rail marker lead

- Branch: `task/T124-marker-stub-dangling` (stacked on T123, PR 79)
- Base: `task/T123-visible-integrity-eval` at `97bb793`
- Status: approved under the user's 2026-11-16 decision to land integrity
  fixes; the defect was confirmed by T123's evaluation check

Numbers T088–T119 were used by an uncommitted experimental run and are skipped.

## Goal

Automatic layout never leaves a wire with an open end that the source drawing
did not have. Today six of 628 corpus results carry a 20-unit horizontal stub
with a junction dot on a ground or VDD marker lead, both ends open
(`2jhdk32et5`, `6n39a2gvtc`, `7d93gjqbw8`, `c3qbntbj56`, `gbvzf4h3fj`,
`j462r7dnbk`). After this task the corpus evaluation reports zero introduced
dangling wires and exits 0 again.

## Context

- The check: `scripts/visible-integrity.mjs` (`visibleIntegrity`,
  `compareVisibleIntegrity`), wired into `scripts/auto-layout-eval.mjs`; per
  case `integrity.introduced.danglingWires` lists `{ routeId, junctionId,
  netId }`. The staged base report `tmp/inputs/t123-report.json` has them for
  the six cases.
- The stub routes are named `route-net-<hash>-route-a-route-net-<hash2>-to` and
  `…-route-b-…`, with junctions `route-net-<hash>-from-junction` /
  `-to-junction`: a route split at a junction (`packages/edit-engine/src/
  split-route-ids.ts`) whose two halves both end open. Nets: five ground, one
  VDD. The product ERC reports them as `ERC_DANGLING_WIRE`
  (`packages/derived/src/diagnostics/erc.ts`, `reportDanglingWires`).
- Root cause is NOT known. Candidates to check: local rail markers (R155,
  `packages/auto-layout/src/local-rail-markers.ts`, `local-rail-candidate.ts`),
  marker stubs (`stub-seat.ts`, routes named `auto-layout-stub-…`), rail-seat
  search (`rail-seat-search.ts`), rip-up/reroute (R95/R96, `local-reroute.ts`,
  `reroute-portfolio.ts`), route cleanup after a marker or its wire is moved
  (R12). `docs/specs/auto-layout.md` describes each rule.

## Scope

Owned paths:

- `packages/auto-layout/src/**` — only the file(s) where the root cause is,
  named in the report with the reason
- `packages/auto-layout/test/**` — one new regression test file (synthetic
  fixture reproducing the mechanism) and, if useful, an assertion added to an
  existing invariant test
- `docs/specs/auto-layout.md` — only if a rule's text must change

Out of scope: `scripts/` (the check stays as it is), the other integrity
families (source defects, label ownership), any aesthetic change.

## Steps

1. Investigate: reproduce on `6n39a2gvtc` and one dev case with a script under
   `tmp/` that runs the planner and prints, stage by stage if possible, when
   the open stub first appears (which edit creates the split halves and which
   later step removes what they were attached to). Report the mechanism with
   file:line.
2. Fix the cause where the stub is created or where its owner is removed — not
   by a blanket "delete every dangling route at the end" pass, unless the
   investigation shows that the final cleanup is the designed place for it (say
   why). The fix must not change results that have no such stub.
3. Regression test with a synthetic document that reproduces the mechanism and
   asserts the result has no `ERC_DANGLING_WIRE` that the source lacks (use
   `diagnoseProject` from `@icm/derived`, or assert on route end points).
4. Corpus evaluation.

## Acceptance

```bash
export pnpm_config_verify_deps_before_run=false npm_config_verify_deps_before_run=false
pnpm build && pnpm typecheck && pnpm lint && pnpm format:check   # all 0
pnpm vitest run packages/auto-layout                              # 0 failures
node scripts/auto-layout-eval.mjs tmp/inputs/le10-input --jobs 4  # exits 0
```

- No case has status `threw`; all completed cases equivalent.
- `integrity.introduced.danglingWires` is empty in all 628 cases.
- Against `tmp/inputs/t123-report.json`: list every case whose `planHash`
  changed. Expected: the six cases, each differing only by the removed stub
  (wire length −20 or so, same crossings and bends); explain anything else.
- Render the six results before/after and look at them.
- The reviewer reruns `pnpm test:local` and `pnpm test:slow`; do not run them.

## Notes for the implementer

Do not commit implementation. 30 sealed ids are listed under `sealed` in
`tmp/inputs/sample.json`: aggregates only, never render or name them.
