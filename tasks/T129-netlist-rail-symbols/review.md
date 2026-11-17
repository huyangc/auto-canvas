# T129 review

## Round 1 — accepted

Implemented by a Claude subagent (Opus). Reviewed: `git diff` on
`task/T129-netlist-rail-symbols`; every acceptance command rerun by the
reviewer (all three evaluations; every plan hash equal to the implementer's
run); a blind review of changed cases by two calibrated reviewer subagents.

Step-1 findings that changed the plan, accepted:

- The ground Net is not split into Base Nets. Splitting changes the Base Net
  partition that equivalence requires; several markers of one Base Net are
  each seated at their own host by R6a/R12 already, as after R155. The marker
  edits are `add_instance`, `connect_endpoints` into the existing ground Net
  and a `power-marker` name claim.
- Node 0 only. The one ground claim the exporter accepts is name `0`, global.
  On a Net that is only a Cell Pin named `VSS` that claim renames the Logical
  Net and the pin exports as `0`: the netlist changes. So the owner's decision
  of 2026-11-17 (a Net named like ground is drawn with ground symbols when
  there is no node 0) cannot be met with ground markers in the current data
  model. In the `vss` form only Nets that already have a ground claim get
  symbols (69 markers). Follow-up: local name labels at the grounded pins
  (T131), or an explicit import choice; the owner is informed.
- The supply symbol is set only when exactly one Cell Pin is a candidate and
  it is named `VDD` with no name claim on its Net: with several supply pins
  the `vdd-port` symbol reorders the exported interface. Otherwise the ports
  stay, with a warning.
- A ground Net that holds a Cell Pin and only one hostable device gets no
  marker.

| #   | Severity | Where                   | Finding                                                                                                                                                                                                                                                                                                                  | Expected fix                       |
| --- | -------- | ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------- |
| 1   | note     | acceptance, total bends | Node-0 form: total bends 2272 → 2297 (dev 1713 → 1706, val 559 → 591), against the plan's "not higher". Rail bends fall by 30; port and signal bends rise as placement changes with the markers. Accepted on the blind review below (16 cases gained, none lost).                                                        | none; watch in the following tasks |
| 2   | note     | equivalence             | `equivalentTerminals(input, presented)` is false by construction (added markers, a changed symbol). The presentation edits are guarded by `presentationChange` (Base and Logical Net partitions, each Net's name, scope and domain, Cell terminals, evidence, MOS body resolution) and, in the evaluation, by re-export. | independent review to weigh        |
| 3   | note     | renders                 | A marker beside an upward-facing pin with a turned-back wire (`wyabv9t3jz`, `jkw9pk932h`); switch and logic circuits drawn as long strips.                                                                                                                                                                               | follow-up                          |
| 4   | note     | rule number             | The rule is numbered R163 here; a parallel drawing-path task also uses R163.                                                                                                                                                                                                                                             | the later delivery renumbers       |

Acceptance rerun by the reviewer:

```text
pnpm build / typecheck / lint (0 errors) / format:check / docs:check → 0
pnpm test:local → 0 (812 files, 8355 passed, 117 skipped)
pnpm test:slow  → 0 (2 files, 8 passed)
drawing-mode evaluation with --baseline → 0
netlist evaluations with --presentation netlist, both forms → 0, 0
```

- Drawing mode: 612 completed, every one equal to the base report; the same
  16 refused.
- Netlist mode, both forms: 515 completed, 515 equivalent, none threw; no
  introduced dangling wire, unconnected pin or touching pin; re-export of the
  presented document identical to the input's wherever the input exports; the
  gate dropped the edits in no document.

Paired totals (507 cases):

| Metric                     | Human | Drawing input | Base, node 0 | This task, node 0 | Base, VSS | This task, VSS |
| -------------------------- | ----- | ------------- | ------------ | ----------------- | --------- | -------------- |
| Crossings                  | 208   | 282           | 380          | 338               | 429       | 407            |
| Bends                      | 1850  | 1986          | 2272         | 2297              | 2476      | 2468           |
| Wire                       | 371k  | 462k          | 549k         | 497k              | 553k      | 546k           |
| Rail wire                  | 81k   | 82k           | 156k         | 88k               | 159k      | 148k           |
| Crossings involving a rail | 17    | 15            | 63           | 47                | 94        | 85             |
| Cases with floating pins   | –     | 0             | 32           | 18                | 96        | 96             |

Blind review (node-0 form, 60 changed non-sealed cases, base netlist result
against this task, shuffled and unlabelled, judged against the drawing by two
reviewer subagents calibrated on the owner's verdicts; 59 judgeable):
acceptable 2 → 18; 16 gained, none lost. The base rejections were almost all
"ground missing".

## Round 2 — changes requested (independent PR review of f4c9d0b)

The Opus PR review approved with one P2 and four P3 findings
(https://github.com/huyangc/auto-canvas/pull/87). Fix on this branch:

| #   | Severity   | Where                                          | Finding                                                                                                                                                                                                                                                                                                                            | Expected fix                                                                                                                                                                                                                                                                                                            |
| --- | ---------- | ---------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | must-fix   | `netlist-presentation.ts` `presentationChange` | The gate accepts `port` → `vdd-port` on any Cell Pin and lets its Net's domain become vdd; only the candidate filter restricts it to a Pin named `VDD`. The export ranks Cell ports by "domain vdd or name VDD", so an `AVDD` Pin would pass the gate and reorder the exported interface. The gate is presented as the only guard. | The gate itself requires the Cell Pin's folded name to be `vdd` for a `port` → `vdd-port` change, and compares each Logical Net's conflicts and the Document's MOS bulk defaults. Tests.                                                                                                                                |
| 2   | should-fix | `auto-layout.ts` `planNetlistPresentation`     | When the presented Document plans to a refusal or to no edits, it is returned as is: no retry without the rail symbols (the rule says a failed presentation is planned without them), and no diagnostic.                                                                                                                           | Fall back to the plain plan with the `AUTO_LAYOUT_NETLIST_PRESENTATION_DROPPED` warning in both branches. Tests.                                                                                                                                                                                                        |
| 3   | should-fix | `netlist-presentation.ts` `groundHost`         | A second copy of the R6a/T127 host predicate, read at the pre-plan pose while R6a reads it at the planned pose: a device the planner rotates so that its only grounded pin leaves away from the rail keeps a marker with no host (possibly the turned-back stubs of `wyabv9t3jz`, `jkw9pk932h`).                                   | One shared predicate exported from `place-markers.ts` for the pose-independent part. For the pose-dependent part: measure how many markers of the corpus results end unhosted or on a turned-back stub; say what the count is and whether a general fix exists at this stage. If not, state the limit in the rule text. |
| 4   | should-fix | `netlist-presentation.test.ts`                 | Gate refusal branches not pinned: changed symbol, changed pins, Net renamed (scope or domain), Cell terminals changed, evidence changed, MOS body resolves differently, added instance not a node-0 ground marker, unexpected evidence, the edit-limit fallback, the planner-refusal fallback.                                     | One short test per branch, by `presentationChange` on a hand-edited document where that is enough.                                                                                                                                                                                                                      |
| 5   | should-fix | `docs/specs/auto-layout.md` R163               | The rule says ground Nets are those with a node-`0` ground claim; the code takes every ground-domain claim and lets the gate refuse a non-`0` one.                                                                                                                                                                                 | Filter on name `0`, global, in the code, as the rule says.                                                                                                                                                                                                                                                              |

Acceptance for round 2: the plan's checks; drawing mode equal to the base in
every case; both netlist evaluations with every plan hash equal to round 1
(`tmp/t129-global-report.json`, `tmp/t129-vss-report.json`) unless finding 3
changes hosts, in which case list the changed plans and the totals.

## Round 2 result — accepted

1. The gate accepts `port` → `vdd-port` only on the interface instance of a
   Cell Pin whose folded name is `vdd`, and compares each Logical Net's
   conflicts and the Document's MOS bulk defaults.
2. A refused presented Document, one that plans no edits, or one past the
   edit limit is planned again without the rail symbols, with the
   `AUTO_LAYOUT_NETLIST_PRESENTATION_DROPPED` warning naming the reason. (The
   repository's automatic codex review of the PR raised the same point.)
3. `channelHostPin` and `offersExtraHost` are exported from `place-markers.ts`
   and used by `powerHosts`, `extraRailHosts` and `groundHost`. Measured on
   the round-1 results: no ground marker ends unhosted; 25 of 1012 (18
   documents, node-0 form) and 1 of 69 (VSS form) are turned back, all on
   channel hosts whose device the planner oriented with the grounded pin
   pointing up (current source 9, capacitor 5, NMOS 5, resistor 4, PMOS 2).
   None is on an extra host. That is orientation choice in placement, shared
   with drawing input and outside this task; the limit is stated in the rule.
4. Thirty tests, one per gate refusal and per fallback. The "transaction
   rejected" drop has no fixture any more: a claim that is not node 0 is
   filtered before replay.
5. Ground Nets are filtered on a claim named `0`, global, as the rule says.

Reviewer rerun: build, typecheck, lint (0 errors), format:check, docs:check 0;
`pnpm test:local` 0 (813 files, 8374 passed, 117 skipped); `pnpm test:slow` 0
(2 files, 8 passed); drawing mode equal to the base in all 612 completed
cases; both netlist evaluations 0 with every plan hash equal to round 1, 515
equivalent, no integrity defect, no gate drop.

## Round 2 follow-up — second PR review

The Opus review of `22f3ee9` approved with two P3 findings, fixed by the
reviewer: the gate and the candidate filter require the Cell Pin's name to be
`VDD` both by the export's own test (exact, any case) and folded, so a padded
name no longer passes (test added; it fails with the folded test alone); the
refusal fallback's test asserts its message. No corpus Cell Pin folds to `vdd`
without being exactly `VDD`, so no plan can change. Rerun after the fix:
typecheck, lint (0 errors), format:check, docs:check 0; `pnpm vitest run
packages/auto-layout` 0.
