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
