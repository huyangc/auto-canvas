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

## Round 3 — accepted

Reviewed: the working tree after Codex round 3. The report matches the code.

- **Finding 1 is fixed.** Mining measures `matchedAsBlock`, `matchedIntact` and
  `precision` for every candidate, a candidate needs a precision of at least 0.8, rejected
  fingerprints are listed, and `--promote` refuses them.
- **Finding 2 is fixed.** `rulePartition` always splits its blocks into connected
  components (`connectedUnitGroups`), with or without a template. The transformer fixture
  now gives connected blocks.

**Acceptance, rerun by Opus on lane 2** after rebasing onto T031:

- format, docs, typecheck, lint and build exit 0;
- `pnpm vitest run packages/auto-layout packages/edit-engine`: 1438 passed;
- `pnpm test:local`: 7830 passed and 2 failed. The two failures are server tests
  (`component-catalog`, `component-library`) that timed out at 5 s while three acceptance
  runs shared the machine. They touch no auto-layout code and pass when rerun alone.
- Default plan hashes equal the base on 33 of 33 human cases.
- The dry run still gives 18 jobs and 91293 payload bytes.
- The tracked library is empty.

**Subagent review before merge (opus, read-only).** Verdict: merge-ready, with two P2
privacy findings about promotion.

| Severity | Finding                                                                                                                                                                                                                | Decision                                                                                                                         |
| -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| P2       | A device without a built-in descriptor keeps its raw symbol id in the fingerprint, and its edges keep that symbol's pin names. Promotion would copy that text from a third-party case into the tracked library.        | Fixed by Opus: `--promote` refuses a candidate that contains a project-local symbol, and the error does not name it. Test added. |
| P2       | A promoted title is the most frequent LLM title, and the LLM saw the case's net names.                                                                                                                                 | Accepted: promotion runs only after the user approves each candidate, title included. Nothing is promoted in this task.          |
| P2       | The node budget bounds search nodes, not time: each node rebuilds candidates, and each full match recomputes a document fingerprint.                                                                                   | Known limit, unmeasured on large circuits. With an empty library the matcher returns before doing any work.                      |
| P3       | When the budget runs out, the partial result can depend on input order, and `recognitionUnits` does not report it. A hand-written disconnected pattern passes the parser. A unit bridging two matches keeps one title. | Known limits.                                                                                                                    |
