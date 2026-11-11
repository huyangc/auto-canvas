import type { SchematicDocument } from "@icm/model";
import type { SymbolResolver } from "@icm/symbols";
import { planAutoLayout } from "./auto-layout.js";
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

export async function planAutoLayoutWithLlm(
  document: SchematicDocument,
  resolver: SymbolResolver,
  options: AutoLayoutOptions & { llm?: LlmOptions } = {},
): Promise<AutoLayoutResult> {
  if (!options.llm || options.partition)
    return planAutoLayout(document, resolver, options);
  const reconciled = await llmPartition(document, resolver, options.llm);
  if (reconciled.partition) {
    const result = planAutoLayout(document, resolver, {
      ...options,
      partition: reconciled.partition,
    });
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
