# T044 report — Drafting labels follow their schematic hosts

Brokaw's A and B now follow the two sense branches. The ratio labels 1 and n follow the transistors displayed as Q₁ and Q₂. All four started as free drafting text. The saved text, formatting and object IDs are preserved.

| Step | Result |
| --- | --- |
| Inspect the inputs | Six of the 30 top sheets contained free drafting text. In Brokaw, each node label sat within approximately 11 units of a unique visible branch dot. The ratio labels lay beside the two transistor envelopes. |
| Preserve the association | After layout selection, the planner matches branch nets by their sorted terminal identities, finds the corresponding unique visible dot and anchors the text to an incident route leg. Device captions attach to the persistent instance. Seat search uses rendered ink, source offsets, final symbol bounds, wires, dots, other labels and drawing objects. Existing attached captions can follow a subsequent layout without causing the planner to shift the entire sheet away from them. |
| Verify | Reopened the native projects, compared the 30 Gallery references and both generations of output, ran both modes and exercised a second APR pass on the saved Brokaw project. |

No earlier review findings applied.

## Brokaw evidence

| Text | Confirmed host after round-trip | Visual result |
| --- | --- | --- |
| A | Q2.C, R3.2 and X1.IN+ | Ink center 13.3 units from the new branch dot |
| B | Q1.C, R4.2 and X1.IN− | Ink center 13.1 units from the new branch dot |
| 1 | Instance ID Q2, displayed as Q₁ | Beside the left transistor |
| n | Instance ID Q1, displayed as Q₂ | Beside the right transistor |

The two standalone junction IDs in the source disappeared during routing. Their new branch dots fall on transistor and resistor terminals. The saved route anchors resolve to the corresponding nets. Both associations also resolved after reopening, rerunning the ordinary planner, and serializing again. The drawing bounds went from 484 × 595 to 455 × 489. Both automatic drawings have 1 crossing, 6 bends and length 1,519. The reference drawing has 1 crossing, 4 bends and length 879.

## Acceptance results

- Auto-layout build and repository typecheck passed. Formatting of touched sources and the diff whitespace check passed.
- Auto-layout package tests passed, 577 tests in 34 files. The focused regression also exercised a second layout after the package run. It checks a synthetic three-way branch, a device caption, a locked caption and a distant free note.
- Both `node scripts/auto-layout-eval.mjs <bucket> --block-boxes off --jobs 2` and its `--quick` variant completed 13/13 and 17/17. There were zero missing connections, floating pins and unsafe routes. All terminal partitions passed. Full graph comparison was available for 27 original projects and passed on all 27.
- In each mode the other 29 plans and rendered SVGs are byte-identical to T043. For all 30 native default exports, deep comparison of the top sheet outside drafting matched T043 exactly. The only changed drafting records are Brokaw's four anchors. Per-case crossing, bend, length, label-overlap and label-clearance metrics matched the previous run.
- Outputs under the main workspace's `output/apr-small-t044` include the same-scale three-way drawings, per-mode JSON, downloadable default projects, and the measured anchors in `brokaw-labels.json`.

## Limits

The geometric association is inferred from the original drawing. The rule handles compact, horizontal local labels with a clear nearby host and an available clear seat. It leaves distant, ambiguous or locked free notes in place. Current-arrow captions and text inside a drawn block can require their own authored association. Some such text remains detached in the reference comparisons, as in T043.
