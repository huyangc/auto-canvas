# T072 review

## Round 1 — accepted (with Opus spec edit)

Reviewed: round 1 report and `git diff` on 2026-11-13. Two general causes
fixed in the owned drafting files: a single-terminal conductor that disappears
in routing now maps its drafting to the surviving terminal, and a failed joint
seating no longer cancels every other group (independent, guarded per-group
fallback). Pin-touching ink keeps its pin identity through mirroring.

Codex's evidence against main `19c0220`: unowned drafting dev 214 → 67
(−68.7%), val 53 → 19 (−64.2%); readability composite dev 130.32 → 104.46,
val 57.17 → 51.18; crossings, bends, wire, every other weighted readability
metric and every `VISUAL_*` total unchanged; median area slightly lower;
all held-out fixtures within ±1%; six large documents byte-identical.

The `corpus.test.ts` change moves `common-source` from "drafting unchanged" to
the R150 follow checks (content, styles, locks, owner proximity) and pins that
two notes move and the blocked third stays: stricter, not weaker. Accepted.

Opus applied the proposed R150 spec text. Known limits (follow-up): New
Circuit's Vref3 has no clear seat at its pin; Vin / Vout and a few remote
annotations (`qj62dz4qvm`, `ec8bty96h4`, `kyxytts7gz`) still look detached
although proximity counts them as owned; drafting-heavy drawings plan slower
(`qj62dz4qvm` +42% single pair).
