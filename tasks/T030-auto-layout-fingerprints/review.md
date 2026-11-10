# T030 review

## Round 1 — changes requested

Reviewed: the uncommitted working tree after Codex round 1. The report matches the code and
the logs. R120–R124 are implemented as planned, and the tracked library is empty.

**Acceptance, rerun by Opus on lane 2.** Every command exits 0:

- `pnpm vitest run packages/auto-layout`: 458 of 458 tests pass.
- `pnpm test:local`: 7804 passed, 117 skipped.
- `pnpm deadcode` reports nothing for auto-layout.
- The rule-only report completes 33 of 33, and rule-only mining gives no candidates.
- The frozen paths are clean.

**Real caches, run by Opus** (prompt v4, 3 samples; nothing was promoted):

| Corpus                                | Documents | Distinct block fingerprints | In 2 or more documents | Candidates |
| ------------------------------------- | --------- | --------------------------- | ---------------------- | ---------- |
| 33 human cases                        | 33        | 95                          | 4                      | 2          |
| Human cases and 30 LOADBench circuits | 63        | 135                         | 18                     | 15         |

The candidates have 2–4 devices or one amplifier with its capacitors; the widest support is
5 documents. Thirteen of the fifteen come from LOADBench alone. Two-device mirrors recur in
5 and 6 documents across both corpora, but their LLM role depends on context, so the
role-share gate rejects them. That is acceptable: R5 already recognizes them.

The mechanism works. These findings come from the real data and from reading the code:

| #   | Severity | Where                                                                       | Finding                                                                                                                                                                                                                                                                                     | Expected fix                                                                                                                           |
| --- | -------- | --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | must-fix | `src/partition-reconcile.ts` (soft role check, T029 R113)                   | The soft role check rejects 24 of 152 LLM blocks on the human cases and 52 of 176 on LOADBench. Most are sound: a block of current sources called `bias` has no diode-connected device. Rejection sets the role to `other` and halves confidence, which drops the block below mining's 0.6. | Round 2 amendment: the check only reports. The block keeps the LLM's role and its consensus confidence.                                |
| 2   | must-fix | `src/units.ts` (`rulePartition`)                                            | `rulePartition` unions every unit's members. A template unit that spans two stages therefore merges those stages into one rule block.                                                                                                                                                       | Round 2 amendment: the rule partition is computed from the units without templates. Test with a synthetic entry that spans two stages. |
| 3   | must-fix | `scripts/auto-layout-fingerprint-mine.mjs`                                  | A candidate shows only where the LLM drew that exact block. It does not show what the matcher would recognize once the entry is in the library.                                                                                                                                             | Round 2 amendment: matcher support per candidate.                                                                                      |
| 4   | must-fix | `scripts/auto-layout-llm-partition.mjs`, `auto-layout-partition-report.mjs` | The call script cannot request samples for a payload with template units, so a library entry leaves its documents without LLM samples. The report duplicates the sample schema and cache reading (`templateSchema`, `samplesFor`).                                                          | Round 2 amendment: the call script takes the library; `cachedSamples` takes the entries; the report's duplicate is removed.            |
| 5   | must-fix | the three scripts                                                           | The library path is fixed, so an experiment with candidate entries would have to edit the tracked file.                                                                                                                                                                                     | Round 2 amendment: `--library <path>`.                                                                                                 |
| 6   | note     | plan acceptance                                                             | The tracked-file grep also matches task document names.                                                                                                                                                                                                                                     | Replaced in the amendment by a path-anchored check.                                                                                    |

## Round 2 — changes requested

Reviewed: the uncommitted working tree after Codex round 2. The report matches the code.
Findings 1–5 of round 1 are fixed, and nothing in round 2's work needs to change.

**Acceptance, rerun by Opus (lane 3, because lane 2 was in use).** Every command exits 0:
463 of 463 auto-layout tests, `pnpm test:local` 7809 passed and 117 skipped, the dry run
still gives 18 jobs and 91293 payload bytes, the tracked library is empty, and the
path-anchored tracked-file check prints nothing.

**Real caches, run by Opus** (63 documents: 33 human cases and 30 LOADBench circuits; prompt
v4, 3 samples; nothing promoted). With the soft role check reporting only, mining finds 161
distinct block fingerprints, 23 of them in two or more documents, and 18 candidates.

Matcher support alone misleads. Opus compared every matcher occurrence of each candidate
with the reconciled partition of its document:

| Candidates                                                     | Matcher occurrences | Occurrence is exactly an LLM block |
| -------------------------------------------------------------- | ------------------- | ---------------------------------- |
| 5 candidates of 4 devices, or an amplifier with its capacitors | 2–6 each            | 83–100%                            |
| 13 candidates of 2–3 devices                                   | 3–22 each           | 9–67%                              |

The small patterns, such as one NMOS and one PMOS on external nets, match in up to 20
documents, but the LLM draws that block in only 9–24% of those places. Promoting one would
force a unit where the LLM groups differently.

| #   | Severity | Where                                      | Finding                                                                                                                                                                                                                                            | Expected fix                                                                                 |
| --- | -------- | ------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| 1   | must-fix | `scripts/auto-layout-fingerprint-mine.mjs` | A candidate qualifies on document count and role share only. Nothing measures whether the matcher's occurrences are blocks the LLM draws.                                                                                                          | Round 3 amendment, item 1: precision per candidate, a precision gate, and the rejected list. |
| 2   | must-fix | `src/units.ts` (`rulePartition`)           | From the codex review of PR #32 (T029): a `findStages` stage need not be connected through the devices it owns. With a transformer, `rulePartition` returns a block of two resistors that share no net. `reconcilePartition` already repairs this. | Round 3 amendment, item 2: rule blocks are always split into connected components.           |
