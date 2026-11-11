# T038 review

## Round 1 — changes-requested

Reviewed: `git diff 3526e33` on `task/T038-auto-layout-mirrored-passives` after round 1.

The pin-correspondence plumbing (`pinMap`, its use in `applyDevices`, `netPairs` and the
axis twin check) is right, and the user's resistors are now mirrored inside the block.
The failure is a plan defect, not an implementation error: step 2 asked candidates to
match the image of the other Net "when that image is known", and `fits` treats a
**self-mapped default** as a known image. Four capacitor pairs whose other pins sit on
two distinct self-mapped Nets were therefore dropped (validation crossings 310 → 318,
bends 397 → 408). R88 always treated self mappings as defaults that non-self evidence
overrides; the candidate rule must too.

| #   | Severity   | Where                                                                         | Finding                                                                                                                                                   | Expected fix                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| --- | ---------- | ----------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | must-fix   | `packages/auto-layout/src/symmetry.ts` `fits`, `correspondence`, `candidates` | A self-mapped Net (`netMap.get(n) === n`) is used as a constraint, so a pair whose other pins touch distinct self-mapped Nets is rejected, unlike before. | Plan amendment, replacing step 2: for non-polar two-terminal devices, a free `a` with a pin `p` on mapped Net `n ↔ m` (`m ≠ n`) has candidate `b` (same `compatible`) when **some pin `q` of `b` lies on `m`**; the correspondence is `p ↔ q` and the other pin to the other pin. Nothing is required of the other Nets, exactly as the equal-pin-name rule never checked them. For a pair found any other way (seeds excepted), choose the order that agrees with the non-self entries of the Net map (`netMap.get(n) !== n`), ignoring self-mapped entries; with no non-self evidence, keep equal pin names. Uniqueness (`choices.length === 1` both ways) is unchanged. |
| 2   | must-fix   | measurement                                                                   | With finding 1, every pair that paired before must pair with the same correspondence.                                                                     | Show it: on the 33 human drawings and the held-out fixtures, the set of R88 pairs equals `3526e33`'s plus the swapped passive pairs only; the plans of drawings without such a pair are byte-identical; restate the targets table with the new numbers.                                                                                                                                                                                                                                                                                                                                                                                                                    |
| 3   | should-fix | `symmetry.test.ts`                                                            | No test covers the regression.                                                                                                                            | Add one: a capacitor pair whose second pins sit on two distinct self-mapped bias Nets still pairs (it did on `3526e33`).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |

Plan change: step 2 is replaced by finding 1; plan.md records the amendment.

## Round 2 — accepted

Reviewed: `git diff 3526e33` after round 2; acceptance rerun by Opus.

The candidate rule follows the amendment: a non-polar device matches on the mirrored
non-self Net, the matched pin fixes the order, and self-mapped Nets never block a pair.
The new regression (capacitors whose second pins sit on distinct self-mapped bias Nets)
also passes on `3526e33`.

| #   | Severity | Where              | Finding                                                                                                                                                                                                                                         | Expected fix                                                                                   |
| --- | -------- | ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| 1   | note     | the user's drawing | `R1`/`R2` are now mirrored inside the block next to their Nets (crossings 13 → 13, bends 16 → 15), but R89 reorders the bottom row and puts the cross-coupled pair at its two ends, far apart; the human drawing has it adjacent at the centre. | Follow-up in T039: seat a cross-coupled pair innermost, next to the axis, where its X belongs. |

Acceptance rerun:

```text
pnpm format:check / docs:check / typecheck / lint / build → 0
pnpm vitest run packages/auto-layout → 0 (29 files, 513 tests)
pnpm test:local → 0 (770 files passed, 3 skipped; 7864 tests passed, 117 skipped)
pnpm deadcode 2>&1 | grep -E 'symmetry' → no output
pnpm auto-layout:review → 0
pnpm auto-layout:eval tmp/human-cases --jobs 7 → 0, 33 completed; against 3526e33:
  dev crossings 271 → 271, bends 367 → 366, mirrored pairs 58/58 → 59/59
  val crossings 310 → 310, bends 397 → 397, 29/29
  floating and missing unchanged; only the user's drawing changes plan
protected paths → empty; no tracked tmp files
```
