# T011 report — round 3

## Summary

Implemented all six must-fix findings from the latest review and updated the
proposed spec to the round 3 rules. Cell Pins face inward with upright right-side
labels and ordered 40-unit spacing. Power markers receive individual hosts.
Fallback sources, series devices, shunts, generic blocks and bridges follow the
horizontal signal layout; ranked two-pin loads align with drains below them.

All nine corpus transactions commit, preserve electrical equivalence and pass
placement, preservation, determinism and stability checks. All 30 package tests
pass. The full local suite passes with approved localhost access: 740 files and
7,311 tests passed. The review command succeeds and produces nine SVGs and the
comparison page.

## Steps

| Step | Status | Notes                                                                                                                                                                                           |
| ---- | ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1    | done   | Updated spec R6/R6a, R8, R9 and R10; explicitly retained floating net/power labels as a T012 limit.                                                                                             |
| 2    | done   | Retained package skeleton and workspace wiring. Frozen offline install passes; only the previously added 22-line importer differs in the lockfile.                                              |
| 3    | done   | Retained R4 classification and its passing focused tests. Signal traversal treats a grounded source's positive net as the R9 seed without changing its R4 role.                                 |
| 4    | done   | Retained recognition and passing tests. All corpus groups match the expected kinds/member sets; existing groups remain unchanged.                                                               |
| 5    | done   | Split marker placement, fallback roles and connectivity/distance helpers from row/template placement. Added R6a host pairing, R8 Cell Pin layout and drain alignment, and revised R9 placement. |
| 6    | done   | Retained the approved edit sequence. R10 direct-contact Routes created by the Edit Engine are accepted only when their endpoints belonged to one original Base Net and their ids are new.       |
| 7    | done   | All 30 package tests pass, including the nine full-layout and nine independent R2-prefix transactions. Added all revised corpus geometry assertions.                                            |
| 8    | done   | Review script reports valid direct-contact Route ids without failing and rejects surviving input ids or cross-Base-Net Routes. Nine SVGs and index.html generated successfully.                 |
| 9    | done   | Measured each planner call and inspected rasterized originals/results from the review HTML; observations and browser limitation recorded below.                                                 |

## Review findings addressed

1. **Must-fix 1 — Route assertions:** Replaced the full-layout empty-Route
   assertion with checks that every result Route has a new id, two endpoints
   present in the original topology, and one common original Base Net. The
   script applies the same validation, lists valid contact Route ids separately
   from diagnostics, and keeps nonzero failure behavior for invalid results.
   The independent R2-prefix checks still require zero Routes because they do
   not transform instances.
2. **Must-fix 2 — Right-side orientation:** Right-side Cell Pins now use
   `rotation: 0, mirror: "horizontal"`. The corpus checks this in every case
   containing output Cell Pins; the rendered labels are upright.
3. **Must-fix 3 — Cell Pin spacing:** Each side is sorted by its connected
   terminal coordinate with code-unit id tie-breaking. Later pins move by grid
   steps to maintain at least 40 units of spacing. Corpus checks all sides in
   every case, including internal-role pins placed on the left.
4. **Must-fix 4 — Individual power hosts:** Ground/VDD markers are paired in id
   order with one candidate per device, sorted by device id and x. Hosts use
   channel/two-pin terminals, exclude MOS bulk pins, and select the lowest or
   highest connected pin as appropriate. Extra markers share the last host and
   receive grid nudges. Corpus proves each ground in RLC/common-source sits
   exactly 40 units below a distinct host at the same x.
5. **Must-fix 5 — Horizontal fallback:** `place-fallback.ts` separates source,
   series, shunt and bridge placement into functions; generic blocks occupy the
   signal row in distance order. `placement-connectivity.ts` follows directed
   block input/output roles so feedback does not collapse the amplifier chain.
   Series pins face left/right according to net distance. Corpus checks RLC and
   both RC orders/orientations, both amplifiers on the same row with increasing
   x, input/output sides, and the horizontal compensation capacitor one row
   above. Existing bounds assertions cover both capacitors against both blocks.
6. **Must-fix 6 — Load/drain alignment:** After ranked placement, a two-pin
   device's lower terminal takes the actual drain x one row below when the
   column is free. Corpus asserts RD.2 and XM1.D have identical x and retains
   the RD-above-XM1 assertion.
7. **Note 7 — Spec:** Updated the revised rules and documented expected
   contact-preserving Routes plus floating `in`, `out` and VDD labels until
   T012. Routing, locks and UI remain deferred to T012/T013.

The round 2 fixed-instance protections remain covered. The collision test's
fixed coordinate was moved into the other capacitor's new horizontal column;
it still requires no edits and an R10 diagnostic. No test was removed or skipped.
No product code branches on corpus ids, instance ids or Reference text.

## Acceptance results

Commands ran from the repository root. Check logs are in `tmp/t011-round3/`;
the review command's build and timing output are in the tool timeline. Local
tests used lane 1 (`ICM_E2E_PORT=4173`, `AUTO_CANVAS_E2E_API_PORT=4311`,
`AUTO_CANVAS_TEST_DATABASE_URL=postgresql:///auto_canvas_test`).

```text
pnpm install --frozen-lockfile --offline
  → 0; Scope: all 23 workspace projects; Already up to date.
pnpm format:check
  → 0; All matched files use Prettier code style!
pnpm docs:check
  → 0; Validated local Markdown links in 74 files.
pnpm typecheck
  → 0; tsc -p tsconfig.check.json --noEmit.
pnpm lint
  → 0; oxlint: 1916 files, 0 errors, 2462 warnings.
pnpm vitest run packages/auto-layout
  → 0; Test Files 4 passed (4); Tests 30 passed (30); 2.58s.
pnpm test:local
  → 1 in sandbox; 17 failed | 723 passed | 2 skipped files;
        listen/connect EPERM on localhost/PostgreSQL.
  → 0 with approved localhost access and lane-1 environment;
        Test Files 740 passed | 2 skipped (742).
        Tests 7311 passed | 116 skipped (7427); 41.86s.
pnpm deadcode 2>&1 | grep -E 'auto-layout'
  → 1 from grep, empty output: expected no-match result.
        No auto-layout findings; repository baseline findings remain.
pnpm build
  → 0; all workspace packages/apps built, including auto-layout.
pnpm auto-layout:review && ls tmp/auto-layout-review
  → 0; all nine cases Committed, no diagnostics; nine SVGs and index.html.
git diff --stat origin/main -- pnpm-lock.yaml
  → 0; pnpm-lock.yaml | 22 ++++++++++++++++++++++;
        full diff contains only packages/auto-layout importer.
git status --short packages/spice packages/edit-engine packages/model packages/project-protocol apps fixtures
  → 0; empty.
git diff --check
  → 0; empty.
node tmp/t011-round3/inspect-review.mjs
  → 0; verified nine matching original/result panel viewBoxes;
        rasterized the exact SVG pairs embedded in index.html.
```

## Investigation results

### Electrical preservation and permitted Routes

All nine independent planner-prefix transactions preserve electrical identity
and remove all original Routes. All nine full transactions also preserve
identity, using whole-Project graph comparison when checkable and terminal
endpoint-to-Base-Net comparison otherwise. They retain drafting, annotation
content/bindings/ids, approved route-label re-anchoring, and pre-existing groups.
Every placement is on-grid, pins are distinct and instance bounds do not overlap.

The full transactions create five expected direct-contact Routes across four
cases: one each in five-t-ota, fig-17-19b and two-stage-symbolic, and two in
common-source. None has an input Route id; each joins endpoints that were on the
same original Base Net. They are the Edit Engine's existing transform
reconciliation, not planner-issued routing edits. T012 replaces them.

### Review visuals and labels

Browser inventory returned `The browser access host is unavailable`, so no
browser HTML inspection is claimed. Instead, parsed the generated index.html,
verified that each original/result pair shares the same viewBox, rasterized its
exact embedded SVGs with the existing `rasterizeSvgBytes`, and inspected all nine
PNG pairs in `tmp/t011-round3/<case>-pair.png` (original left, result right).

- Five-t-ota has the PMOS mirror above the NMOS pair on a common axis, PMOS
  gates facing inward, NMOS gates outward, tail below on the axis, spaced inputs
  left and an upright output right.
- RLC and both RC cases now run source → horizontal series element(s) → vertical
  shunt from left to right. Their grounds sit under separate devices.
- The two symbolic amplifiers share one signal row in left-to-right order;
  compensation lies above them and the load capacitor to the right. Both
  capacitors remain clear of the blocks.
- Common-source has RD aligned over XM1.D and one ground under each source,
  XM1 and CL. All three drafting objects survive. Its expected contact Route
  still bends toward an old lifecycle junction, producing awkward residual
  geometry; no extra routing/cleanup edit was added.
- Free labels remain at their old page positions as required. In particular,
  RLC's `out` floats near the inductor, RC-lowpass's `out` crowds the resistor
  label, and VDD labels remain detached from the vanished rails. Some existing
  label positions in fig-17-19b also remain visually detached from Cell Pins.
  Repositioning/re-anchoring these labels needs T012; R2 does not authorize it.

No corpus Document requires a new edit kind or prohibited R2 edit to pass the
revised placement/electrical contract. The floating labels and residual Routes
are the specified visual limits, recorded rather than silently changed.

### Planning wall time

One `planAutoLayout` call per case measured with `performance.now()` inside the
review command; excludes parsing, transaction execution and rendering. First
case includes cold-start cost. Every case has no diagnostics and commits.

| Case               | Wall time (ms) |
| ------------------ | -------------: |
| five-t-ota         |          9.135 |
| fig-17-19b         |          1.151 |
| two-inverters      |          1.126 |
| differential-stage |          0.402 |
| common-source      |          0.607 |
| rc-lowpass         |          0.342 |
| rc-highpass        |          0.204 |
| rlc                |          0.251 |
| two-stage-symbolic |          0.586 |

## Deviations and open questions

- No blocking findings remain. Browser access was unavailable; exact embedded
  SVGs were inspected through raster artifacts instead.
- To apply R9's source-seeded fallback consistently with R4, the selected source
  positive net remains traversable for signal distance even when R4 classifies
  it as supply. For generic blocks, external undriven input-role terminals seed
  distance when there are no MOS-input nets or grounded sources. Net roles and
  electrical membership are unchanged.
- The full suite required approved localhost access because the sandbox forbids
  listening sockets and PostgreSQL connections. Both the failing sandbox output
  and passing rerun are retained in the logs; no test was weakened for it.
- No commits, pushes, branch switches, dependency changes, plan/review edits or
  excluded-path edits were made. The pre-existing plan/review changes were left
  alone. No routing algorithm, lock field or UI was added.
- Electrical evidence is graph/topology equivalence as specified. No circuit
  simulation is claimed.
