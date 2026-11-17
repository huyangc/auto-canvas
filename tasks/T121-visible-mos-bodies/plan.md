# T121 — Draw MOS body connections that the source draws

- Branch: `task/T121-visible-mos-bodies` (stacked on T120, PR 78)
- Base: `task/T120-visible-endpoint-audit` at `8904e07`
- Status: approved (user, 2026-11-16: land the integrity fixes separately)

Numbers T088–T119 were used by an uncommitted experimental run and are skipped.

## Goal

When the source drawing shows a MOS body connection (a drawn B lead: a B–S tie
or a separate body bias), automatic layout draws that connection again and the
audit counts it. Today the planner deletes all routes and never re-routes B
pins, and the audit skips every B pin, so the body is left visibly floating
while `missingConnections` stays 0.

## Context

- `mosBulkShouldBeVisible(document, instance)` is exported by `@icm/derived`
  and already decides whether a body must be drawn. Over the 628 sources it is
  true for 53 bodies in 23 cases (list: `tmp/inputs/bulk-census.out`).
- `freezePinGroups(document, resolver, { includeBulk })` exists in
  `packages/auto-layout/src/route.ts:130`; `buildPlan` is at
  `packages/auto-layout/src/auto-layout.ts:1638`.
- `packages/auto-layout/src/routing-audit.ts` `computeConnectionPins` (after
  T120) keeps visible non-bulk pins only.
- Reference implementation from an experimental run that is not being landed —
  copies are in `tmp/inputs/reference/` (read-only): `route.ts`
  (`routeVisibleBulkConnections`, about line 1226; it re-routes required bodies
  after ordinary routing and picks the best of up to 4 targets by crossings,
  bends, length), `auto-layout.ts` (call near line 2455 inside `buildPlan`),
  `routing-audit.ts` (the `mosBulkShouldBeVisible` half of the pin filter),
  `visible-bulk.test.ts` (5 synthetic tests), `corpus.test.ts.diff` (body hunks
  only: common-source bend budget 2 → 3 and a B-endpoint assertion; the
  `AUTO_LAYOUT_FLOW_UNRESOLVED` filters in that diff belong to another change —
  do not port them). The reference `route.ts` also contains unrelated
  `passiveBank` hunks: do not port them.
- Known cost in the reference run (21 cases changed; 15 dev, 6 val): +11
  crossings, +2.6k wire, +58 bends. In the 10 cases where device poses did not
  change the cost was 0 crossings, +638 wire, +21 bends (inherent: the hand
  drawing has those leads). All 11 extra crossings fall in the 11 cases whose
  placement also changed. Unknown: whether placement changed because body
  routing runs inside `buildPlan` for every candidate and shifts candidate
  ranking, or because of an unrelated change in that run.

## Scope

Owned paths:

- `packages/auto-layout/src/route.ts` (new exported function only)
- `packages/auto-layout/src/auto-layout.ts` (`buildPlan` or the final-result
  path, see step 2; `planAutoLayout`'s outer wrapper belongs to T122)
- `packages/auto-layout/src/routing-audit.ts` (bulk half of the pin filter)
- `packages/auto-layout/test/visible-bulk.test.ts` (new, synthetic),
  `packages/auto-layout/test/corpus.test.ts` (body hunks only)
- `docs/specs/auto-layout.md` (next free rule number; R161 is taken by T122, use
  R162)

Out of scope: everything else; fixtures copied from corpus drawings.

## Steps

1. Port `routeVisibleBulkConnections` and the audit filter half; add the tests.
2. Investigate first, then choose the integration point. Variant A: route
   bodies inside `buildPlan` for every candidate (as the reference). Variant B:
   route bodies only on the selected final layout, so candidate ranking and
   device placement are identical to the base. Run the 23 body cases under both
   (a filtered copy of the corpus is enough) and report per case: poses equal to
   base or not, crossings/bends/wire for base, A, B and the hand drawing. Choose
   B unless A is clearly better on crossings+bends summed over those cases; with
   B, a body that cannot be routed on the final layout must be reported under
   the existing unrouted diagnostics (R14), never silently dropped.
3. Full corpus evaluation with the chosen variant.

## Acceptance

```bash
export pnpm_config_verify_deps_before_run=false npm_config_verify_deps_before_run=false
pnpm build && pnpm typecheck && pnpm lint && pnpm format:check   # all 0
pnpm vitest run packages/auto-layout                              # 0 failures
node scripts/auto-layout-eval.mjs tmp/inputs/le10-input --jobs 4
```

- Compare with `tmp/inputs/t120-report.json` (the base of this branch): every
  case without a required visible body has the same `planHash`; no case has
  status `threw`; all completed cases equivalent.
- For the body cases: `missingConnections` and `floatingPins` are 0 in the
  result (or each remaining one is listed with the reason); table of
  crossings/bends/wire for base, this task, hand drawing, dev and val totals.
- Render original / base / result for the 5 cases with the largest wire
  increase and look at them: every drawn body lead of the original is drawn in
  the result.
- The reviewer reruns `pnpm test:local` and `pnpm test:slow`; do not run them.

## Notes for the implementer

Do not commit implementation. 30 sealed ids are listed under `sealed` in
`tmp/inputs/sample.json`: aggregates only, never render or name them.
