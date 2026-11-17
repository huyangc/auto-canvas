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
