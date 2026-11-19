# T141 — A finished plan never ships an unrouted or floating pin

- Branch: `task/T141-connection-acceptance`
- Base: `main` at `fcd8fc4`
- Status: approved under the owner's 2026-11-16 goal (electrical equivalence and
  visible connection integrity are zero-defect)

## Goal

Today a finished plan may be returned with pins the router failed to connect:
the finish stage turns `floatingPins` into an `AUTO_LAYOUT_NET_UNROUTED`
**warning** and delivers the drawing anyway. On the netlist-only input this
happens to 16 of 515 cases (32 missing connections, 38 floating pins); on the
drawing input the same hole exists and is simply not hit by the corpus. One of
them is the single electrical regression the symmetry pre-test measured (WIDE
on `p8mbn2ej8c`: a mirrored voltage source whose `-` pin is left unconnected).

After this task a plan whose final document still has a missing connection or a
floating pin is not delivered. The planner either finds a finished plan without
one — it already keeps several finished candidates — or refuses with a stated
reason, exactly as it already does for an unsafe route.

## Context

Verified in the code at `fcd8fc4`.

- **Where the defect is let through.** `finish()` in
  `packages/auto-layout/src/auto-layout.ts`: from line 2468 (`const floating =
  floatingPins(final.document, resolver)`) the stage builds
  `floatingWarnings` and pushes them into `planned.diagnostics` as
  `severity: "warning"`. Nothing refuses. `missingConnections` is not checked
  at all at this point.
- **What is already guarded, and where the gap is.** `selectFinished`
  (`auto-layout.ts:1404-1471`) compares the two *finished* candidates and
  returns the quick one when the searched one is worse on
  `missingConnections`/`floatingPins` (lines 1443-1450). Two gaps:
  1. It is a relative test between two candidates. If **both** carry a defect —
     or the quick candidate already has one and the searched one ties — a
     defective plan is returned.
  2. `reroutePortfolio` (line 1482) and `rerouteCrossings` run **after**
     `selectFinished` and can introduce a defect of their own; nothing checks
     their result.
  Also `refine`'s `accept` (line 360-372) and the local-loop/blocker-repair
  paths check `missingConnections`, but only as a relative or zero test on
  their own trial — none of them is a final gate.
- **Where the escaped case comes from.** `p8mbn2ej8c` (14 instances, 5
  externally-controlled switches, 2 voltage sources on one ground net): the
  WIDE symmetry variant moves `V2` from `{rotation 0, mirror "none"}` to
  `{rotation 0, mirror "horizontal"}`. Its `-` pin then leaves toward the
  outside of the drawing and the router cannot seat it; the finished document
  keeps `V2.-` floating and the plan is returned. Measured with the pre-test's
  own runner at main: base variant floating 0 / missing 0, WIDE variant
  floating 1 (`V2.-`, Net `net-power-gnd3`) / missing 1.
- **Why this is not just the netlist path.** The same finish stage serves both
  inputs; the netlist path merely exposes it because a netlist input carries no
  rail symbols and many more ports, so the router meets harder placements. The
  drawing path reads 0 missing / 0 floating on the corpus, which means the gate
  must be a **no-regression** gate on that corpus, not a plan-changing one.
- **What is available to fall back on.** The planner keeps the other finished
  candidates (`runner`, `alternateFinalist`, the `runs` map, the stack and
  convention drafts). `selectFinished` already keeps `quickResult` alive. A
  gate therefore does not have to refuse: it can prefer a finished candidate
  that is clean.
- **`equivalent` is not enough.** `equivalentTerminals` and
  `compareElectricalGraphs` compare the netlist-level connection; a pin that
  was never drawn is still electrically connected in the document. That is why
  the defective plan reported `equivalent: true`.

## Scope

Owned paths (may be created, edited or deleted):

- `packages/auto-layout/src/auto-layout.ts`
- `packages/auto-layout/test/connection-acceptance.test.ts` (new)
- `packages/auto-layout/test/*.test.ts` (only where a recorded plan hash or a
  diagnostic expectation changes for the stated reason)

Out of scope (do not change):

- The router (`route.ts`) and why a particular pin fails to route. This task
  makes the failure visible and non-deliverable; making the router succeed is a
  separate task.
- `netlist-presentation.ts` (R165) and the rail-symbol rule.
- The search budget, the score, `routedScore`, and the draft portfolio.
- The `AUTO_LAYOUT_NET_UNROUTED` diagnostic itself: it stays a warning on the
  **refused** result, and its message format does not change.

## Steps

1. **Investigate: measure the hole on both inputs.** Write a scratch script
   (do not commit it) that, for the 628-case corpus and for
   `tmp/netlist-input/global` (the converted 515), counts per case whether the
   plan has `missingConnections > 0` or any floating pin, and records for each
   such case whether a clean finished candidate existed. Record the counts in
   the report. This is the baseline the acceptance gate must beat.
2. **Make the gate explicit.** In `finish()` add one predicate
   `connectionsIntact(document)` that is true iff
   `missingConnections(document, resolver) === 0 &&
   floatingPins(document, resolver).length === 0`. Use it at every point where
   a finished result is chosen:
   - `selectFinished`: when the searched candidate is defective, fall back to
     `quickResult`; if `quickResult` is defective too, continue to step 3.
   - after `reroutePortfolio` / `rerouteCrossings`: if the rerouted result is
     defective and the pre-reroute result was not, keep the pre-reroute result.
     This is a regression gate, never a preference.
3. **Make a clean candidate win over a defective one.** In the same place where
   `selected`/`runner`/`alternateFinalist` are resolved, prefer a finished
   candidate with intact connections over one without, in the existing ranking
   order, when the scores are otherwise compared. Do not re-rank by score
   across a dirty candidate: a clean candidate that scores worse still wins,
   because a broken drawing is not a drawing.
4. **Refuse only as the last resort.** If every finished candidate is
   defective, return a refusal with `severity: "error"`,
   `code: "AUTO_LAYOUT_CONNECTION_REFUSED"`, `rule: "R10"`, and a message that
   names the pins. Keep the `AUTO_LAYOUT_NET_UNROUTED` warnings on that result
   so the reason stays legible. Do **not** change the `refuse()` helper's other
   callers.
5. **Tests.** New file `connection-acceptance.test.ts`:
   - a synthetic document whose only finished candidate is defective is
     refused with the new code;
   - a document with a clean and a dirty finished candidate returns the clean
     one, even when the dirty one has fewer bends;
   - a document with no connection problem is planned exactly as before (plan
     hash equality on a small fixture that the corpus exercises).
   Plus: record the corpus plan hashes before and after. **Every changed case
   must be one that was defective before.**
6. **Re-measure.** Run the same scratch measurement as step 1 and report:
   defective cases before/after on both inputs, and on the drawing corpus the
   number of changed plans (expected 0) and the crossings/bends/wire totals
   (expected unchanged).

## Acceptance

Run from the repository root; all must pass.

```bash
pnpm --filter @icm/auto-layout test
pnpm typecheck
pnpm lint
pnpm format:check
```

Behavioral checks:

- The 628-case drawing corpus: 0 missing, 0 floating, and the same aggregate
  crossings/bends/wire as `main` (0 changed plans).
- The 515-case netlist corpus: the 16 defective cases are either clean or
  refused with `AUTO_LAYOUT_CONNECTION_REFUSED`; no new missing or floating
  appears anywhere.
- `p8mbn2ej8c` under the symmetry pre-test's WIDE variant: no floating pin
  (the pre-test's runner is at
  `tmp/handoff/pt-sym2/lib/run.mjs` in the coordinator's worktree, variant
  `WIDE`).
- Every existing diagnostic count in the test suite is unchanged except where
  the report lists the case and the reason.

## Notes for the implementer

- The gate is **correctness**, not a heuristic. Do not tune it, do not add a
  score term for it, and do not let it change which draft is chosen.
- A refusal is a worse outcome than a clean plan but a better outcome than a
  broken one. If refusing more than a handful of the 515 cases, stop and report
  the list — that means step 3 is not finding the clean candidates and I need
  to see it.
- `missingConnections` counts Nets, `floatingPins` counts pins; a Net with one
  floating pin shows in both. Do not double-count in the report.
- Timeouts: every test in this package that runs the planner needs
  `60_000` as its timeout (see the T140 commit); the default 5 s is not enough
  on the CI runner.
