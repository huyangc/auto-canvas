# T027 review

## Round 1 — accepted with Opus fixes

Reviewed: the uncommitted working tree after Codex round 1. Codex's report is accurate.
No API call was made. The payload is a whitelist, so coordinates, routes and drafting text
cannot reach it, and tests confirm this. The SDK is confined to `scripts/`.

Opus fixed three problems before any money is spent:

1. **`max_tokens` was 8192** (`scripts/auto-layout-llm-partition.mjs`). Thinking counts
   toward the limit, so high-effort answers on large circuits would truncate, and the
   failures would fall only on large documents. It is now 32000 and the provider streams.
2. **Provider failures were cached.** A missing credential or a rate limit would have been
   stored as that circuit's result and never retried. A call with no answer now returns
   `unavailable`, writes no cache entry, and fails the run's exit code.
3. **Anonymous numbering leaked source order.** `D1…` followed sorted source ids, so `M1`,
   `M2` ordering survived. Numbers now follow a hash of the id.

Known limit for the name-dependence run: `classifyNets` uses Net names for part of its
roles, so an anonymized payload still carries roles that names helped decide. That run
understates name dependence.

The experiment itself is not yet run; results are appended after the real calls.

## Provider change (user request, 2026-11-09)

The user asked to use silicon-notebook's `deepseek-flash` configuration instead of the
Anthropic API. The script now defaults to that service: OpenAI protocol,
`https://api.deepseek.com`, model `deepseek-flash`, key in `SYSTEM_GENERAL_API_KEY`.
`LLM_PARTITION_PROVIDER=claude-opus-5-5` keeps the original path. The key is read from
the environment only and is absent from the cache files. JSON mode does not enforce the
shape, so the prompt now states it (`PROMPT_VERSION` 2) and the same Zod schema checks it.

## Experiment (Opus)

Opus ran the procedure on `deepseek-flash`.

1. **Pilot:** 3 dev documents.
2. **Dev:** 18 documents, 3 samples each, plus one anonymized run.
3. **One prompt revision**, version 3, made on dev only. It removed disconnected blocks
   (20 of 89 → 0 of 120).
4. **Val:** run once with the frozen prompt.
5. **LOADBench:** 30 topologies.

T026 and T028 merged meanwhile. T027 was rebased onto `65bd206`, and every layout was
rerun from the cache, so the numbers in the report use today's `main` as V0.

The decision gate fails; the report has the full results. The next step should give block
placement to an optimizer: the LLM supplies the blocks, titles, roles and flow, and an
optimizer chooses where blocks go. The block-placement refusals (12 of them) need fixing in
any case.

## PR review — codex round 1

One P2, reproduced: `--partition llm` failed before reading a valid cached partition when
the document had an unplaced device, because the human-drawing reference could not be
extracted. The reference now only feeds comparison metrics:

- if it is unavailable, the layout still runs and `partitionMetrics` is null;
- when a LOADBench `partitioning.xml` sits beside the document, it is the reference.

The extended integration test fails before the fix and passes after. LOADBench layouts are
unchanged, and their metrics now use the LOADBench reference (median ARI 0.69, the same as
the ad hoc figure in the report).

## PR review — codex round 2 on `50be579`

One P2, reproduced by the extended integration test: with a LOADBench reference, an LLM run
still treated the importer's positions as a human drawing. Human status now follows the
detected reference type:

- no human metrics, SVG or totals for such a case;
- position-based partition metrics are null;
- ARI against the XML remains.

Aggregate human totals now cover only cases that have a human drawing. LOADBench layouts
are unchanged across all 30 topologies.
