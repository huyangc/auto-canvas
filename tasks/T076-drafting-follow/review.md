# T076 review

## Round 1 — accepted by Opus

Reviewed: round 1 report and diff on 2026-11-14. U1: R150's fixed-ink branch
keeps the R10-shifted base placements but still moves and seats owned groups
(`followDraftingGroups(document, resolver, base, base, ownedGroups)`). U2: a
group owned by a terminal-less Net follows the nearest visible source
instance (ties by id) in `draftingDisplacements` only; `draftingGroups` and
the frozen metric are unchanged. Six new regressions; the existing
pinless-junction case now asserts the specified displacement instead of
stationary ink (required by U2), keeping its caption-following and replay
checks.

Against main `01fd2ad`: unowned drafting dev 64 → 35 (−45%), val 19 → 14;
readability composite dev 71.72 → 66.62 (−7.1%, 1.39× human), val 36.62 →
35.72 (−2.5%, 1.32×); 19 plans change, 17 improve and 2 tie, none worse;
floating / missing and every `VISUAL_*` total unchanged; 628/628 equivalent;
six large plans byte-identical; held-out timing ≤ +1.75%.

Missed gates accepted: bends +2 per split (zero readability weight; drawings
`h8m97x36dw`, `pd8crnm97d`, both with a lower composite) and val rail
crossings 15 → 16 in a drawing whose composite falls. Known limits: drafting
in `qj62dz4qvm` (a block diagram drawn in ink) and `nqksde5dtj` (wires that
touch no pin) still reads poorly.
