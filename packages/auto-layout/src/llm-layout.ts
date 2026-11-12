import type { SchematicDocument } from "@icm/model";
import type { SymbolResolver } from "@icm/symbols";
import { planAutoLayout } from "./auto-layout.js";
import { readabilityCounts } from "./readability.js";
import { emptyChoices } from "./layout-choices.js";
import { improvesWireLayout } from "./refine.js";
import { preview } from "./transaction.js";
import {
  auditRouting,
  floatingPins,
  missingConnections,
} from "./routing-audit.js";
import type { FingerprintEntry } from "./fingerprint.js";
import {
  describeCircuit,
  PARTITION_SYSTEM_PROMPT,
  type LlmPartitionResult,
} from "./partition-prompt.js";
import { reconcilePartition } from "./partition-reconcile.js";
import type { AutoLayoutOptions, AutoLayoutResult } from "./types.js";

export type LlmPartitioner = (request: {
  system: string;
  payload: ReturnType<typeof describeCircuit>;
  sample: number;
  anonymize: boolean;
}) => Promise<LlmPartitionResult | undefined>;

interface LlmOptions {
  partitioner: LlmPartitioner;
  samples?: number;
  anonymize?: boolean;
  entries?: readonly FingerprintEntry[];
}

export async function llmPartition(
  document: SchematicDocument,
  resolver: SymbolResolver,
  { partitioner, samples = 3, anonymize = false, entries = [] }: LlmOptions,
) {
  const payload = describeCircuit(document, resolver, anonymize, entries);
  const results = await Promise.all(
    Array.from({ length: samples }, async (_, sample) => {
      try {
        return await partitioner({
          system: PARTITION_SYSTEM_PROMPT,
          payload,
          sample,
          anonymize,
        });
      } catch {
        return undefined;
      }
    }),
  );
  const answers = results.filter((result) => result !== undefined);
  const reconciled = reconcilePartition(document, resolver, answers, entries);
  return {
    ...reconciled,
    partition: answers.length ? reconciled.partition : undefined,
    samples: results.map((result, sample) => ({
      sample,
      status:
        result === undefined ? ("missing" as const) : ("answered" as const),
    })),
  };
}

/** Compare an inferred floorplan with one ordinary optimized run. Explicit
 * partitions bypass this selection. Ties preserve the inferred blocks. */
function selectInferredLayout(
  document: SchematicDocument,
  resolver: SymbolResolver,
  options: AutoLayoutOptions,
  grouped: AutoLayoutResult,
): AutoLayoutResult {
  if (
    options.quality !== "optimized" ||
    // An explicit search budget belongs to the partitioned plan.
    options.search !== undefined ||
    !grouped.edits.length ||
    grouped.diagnostics.some(
      (d) =>
        d.severity === "error" || d.code === "AUTO_LAYOUT_PARTITION_FALLBACK",
    )
  )
    return grouped;
  const before = preview(document, resolver, grouped.edits);
  if (!before.ok) return grouped;

  const other = planAutoLayout(document, resolver, options);
  if (
    !other.edits.length ||
    other.diagnostics.some((d) => d.severity === "error" || d.rule === "R14")
  )
    return grouped;
  const after = preview(document, resolver, other.edits);
  if (
    !after.ok ||
    missingConnections(after.document, resolver) ||
    floatingPins(after.document, resolver).length
  )
    return grouped;
  if (auditRouting(after.document, resolver).unsafeProblems.length)
    return grouped;

  const incomplete =
    missingConnections(before.document, resolver) > 0 ||
    floatingPins(before.document, resolver).length > 0;
  if (!incomplete) {
    const choices = emptyChoices();
    if (
      readabilityCounts(after.document, resolver).labelOverlaps >
        readabilityCounts(before.document, resolver).labelOverlaps ||
      !improvesWireLayout(
        { result: grouped, final: before.document, choices },
        { result: other, final: after.document, choices },
        resolver,
      )
    )
      return grouped;
  }
  other.diagnostics.push({
    severity: "warning",
    code: "AUTO_LAYOUT_PARTITION_FALLBACK",
    rule: "partition",
    message: incomplete
      ? "The proposed blocks left disconnected pins; the unpartitioned layout connects every net."
      : "An unpartitioned layout improves routed geometry and overall score without increasing label overlap.",
  });
  return other;
}

export async function planAutoLayoutWithLlm(
  document: SchematicDocument,
  resolver: SymbolResolver,
  options: AutoLayoutOptions & { llm?: LlmOptions } = {},
): Promise<AutoLayoutResult> {
  if (!options.llm || options.partition)
    return planAutoLayout(document, resolver, options);
  const reconciled = await llmPartition(document, resolver, options.llm);
  if (reconciled.partition) {
    const grouped = planAutoLayout(document, resolver, {
      ...options,
      partition: reconciled.partition,
    });
    const result = selectInferredLayout(document, resolver, options, grouped);
    result.diagnostics.push(
      ...reconciled.diagnostics.map(({ check, block, message }) => ({
        severity: "warning" as const,
        code: "AUTO_LAYOUT_LLM_RECONCILED",
        rule: "R141",
        message: `${check} (${block}): ${message}`,
      })),
    );
    return result;
  }
  const result = planAutoLayout(document, resolver, options);
  result.diagnostics.push({
    severity: "warning",
    code: "AUTO_LAYOUT_LLM_UNAVAILABLE",
    rule: "R141",
    message: "No usable LLM partition answer; using the default layout plan",
  });
  return result;
}
