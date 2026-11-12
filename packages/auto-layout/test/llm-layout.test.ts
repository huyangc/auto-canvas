import { expect, it, vi } from "vitest";
import { builtInSymbols, InMemorySymbolResolver } from "@icm/symbols";
import {
  llmPartition,
  planAutoLayout,
  planAutoLayoutWithLlm,
  type LlmPartitioner,
} from "../src/index.js";
import {
  describeCircuit,
  PARTITION_SYSTEM_PROMPT,
  type LlmPartitionResult,
} from "../src/partition-prompt.js";
import { reconcilePartition } from "../src/partition-reconcile.js";
import { blockFingerprint } from "../src/fingerprint.js";
import { circuit } from "./document-fixture.js";

const resolver = new InMemorySymbolResolver(builtInSymbols);
const document = circuit(
  { a: "resistor", b: "resistor", c: "resistor", d: "resistor" },
  { ab: ["a.2", "b.1"], bc: ["b.2", "c.1"], cd: ["c.2", "d.1"] },
);
const answers: LlmPartitionResult[] = [0, 1, 2].map((sample) => ({
  blocks: [
    {
      id: `proposal-${sample}`,
      title: `Signal ${sample}`,
      role: "gain",
      units: ["U1", "U2"],
      reason: "series network",
    },
  ],
  uncertain: [],
}));

it("requests three samples concurrently and reconciles in sample order", async () => {
  const complete: ((answer: LlmPartitionResult) => void)[] = [];
  const partitioner = vi.fn<LlmPartitioner>(
    ({ sample }) =>
      new Promise((resolve) => {
        complete[sample] = resolve;
      }),
  );
  const pending = llmPartition(document, resolver, { partitioner });
  expect(partitioner).toHaveBeenCalledTimes(3);
  for (const sample of [2, 0, 1]) complete[sample]!(answers[sample]!);
  expect(await pending).toEqual({
    ...reconcilePartition(document, resolver, answers),
    samples: [0, 1, 2].map((sample) => ({ sample, status: "answered" })),
  });
  const requests = partitioner.mock.calls.map(([request]) => request);
  expect(requests).toEqual(
    [0, 1, 2].map((sample) => ({
      system: PARTITION_SYSTEM_PROMPT,
      payload: describeCircuit(document, resolver),
      sample,
      anonymize: false,
    })),
  );
  expect(requests[0]!.payload).toBe(requests[1]!.payload);
  expect(requests[1]!.payload).toBe(requests[2]!.payload);
});

it("passes anonymization and template entries to description and reconciliation", async () => {
  const entries = [
    {
      ...blockFingerprint(document, resolver, ["a", "b"]),
      title: "Synthetic series",
      role: "gain" as const,
      approvedBy: "Test",
      sources: { documents: 2, occurrences: 2, roles: { gain: 2 } },
    },
  ];
  const partitioner = vi.fn<LlmPartitioner>().mockResolvedValue(answers[0]);
  const result = await llmPartition(document, resolver, {
    partitioner,
    samples: 1,
    anonymize: true,
    entries,
  });
  expect(partitioner.mock.calls[0]![0]).toEqual({
    system: PARTITION_SYSTEM_PROMPT,
    payload: describeCircuit(document, resolver, true, entries),
    sample: 0,
    anonymize: true,
  });
  expect(result.partition).toEqual(
    reconcilePartition(document, resolver, [answers[0]!], entries).partition,
  );
});

it("skips rejected and missing samples", async () => {
  const partitioner = vi
    .fn<LlmPartitioner>()
    .mockRejectedValueOnce(new Error("private provider detail"))
    .mockResolvedValueOnce(answers[1])
    .mockResolvedValueOnce(undefined);
  expect(await llmPartition(document, resolver, { partitioner })).toEqual({
    ...reconcilePartition(document, resolver, [answers[1]!]),
    samples: [
      { sample: 0, status: "missing" },
      { sample: 1, status: "answered" },
      { sample: 2, status: "missing" },
    ],
  });
});

it.each([0, 3])(
  "falls back to the default plan when %i samples give no answer",
  async (samples) => {
    const partitioner = vi
      .fn<LlmPartitioner>()
      .mockRejectedValue(new Error("secret"));
    const llm = { partitioner, samples };
    expect(
      (await llmPartition(document, resolver, llm)).partition,
    ).toBeUndefined();
    const baseline = planAutoLayout(document, resolver);
    const result = await planAutoLayoutWithLlm(document, resolver, { llm });
    expect(result).toEqual({
      ...baseline,
      diagnostics: [
        ...baseline.diagnostics,
        {
          severity: "warning",
          code: "AUTO_LAYOUT_LLM_UNAVAILABLE",
          rule: "R141",
          message: expect.any(String),
        },
      ],
    });
    expect(JSON.stringify(result)).not.toContain("secret");
  },
);

it("bypasses LLM work for an explicit partition or absent LLM options", async () => {
  const partitioner = vi.fn<LlmPartitioner>();
  const partition = reconcilePartition(document, resolver, answers).partition;
  expect(
    await planAutoLayoutWithLlm(document, resolver, {
      partition,
      llm: { partitioner },
    }),
  ).toEqual(planAutoLayout(document, resolver, { partition }));
  expect(partitioner).not.toHaveBeenCalled();
  expect(await planAutoLayoutWithLlm(document, resolver)).toEqual(
    planAutoLayout(document, resolver),
  );
});

it("plans with the reconciled partition, appends its diagnostics and repeats byte-identically", async () => {
  const answer = {
    ...answers[0]!,
    blocks: [{ ...answers[0]!.blocks[0]!, units: ["unknown", "U1", "U2"] }],
  };
  const partitioner: LlmPartitioner = async () => answer;
  const llm = { partitioner };
  const reconciled = reconcilePartition(document, resolver, [
    answer,
    answer,
    answer,
  ]);
  expect(reconciled.diagnostics.length).toBeGreaterThan(0);
  const baseline = planAutoLayout(document, resolver, {
    partition: reconciled.partition,
  });
  const result = await planAutoLayoutWithLlm(document, resolver, { llm });
  expect(result).toEqual({
    ...baseline,
    diagnostics: [
      ...baseline.diagnostics,
      ...reconciled.diagnostics.map(({ check, block, message }) => ({
        severity: "warning",
        code: "AUTO_LAYOUT_LLM_RECONCILED",
        rule: "R141",
        message: `${check} (${block}): ${message}`,
      })),
    ],
  });
  expect(
    JSON.stringify(await planAutoLayoutWithLlm(document, resolver, { llm })),
  ).toBe(JSON.stringify(result));
  expect(JSON.stringify(await llmPartition(document, resolver, llm))).toBe(
    JSON.stringify(await llmPartition(document, resolver, llm)),
  );
});

it("uses a shorter connected route for advisory blocks and preserves explicit blocks", async () => {
  const chain = circuit(
    { R0: "resistor", R1: "resistor", R2: "resistor", R3: "resistor" },
    { n0: ["R0.2", "R1.1"], n1: ["R1.2", "R2.1"], n2: ["R2.2", "R3.1"] },
  );
  const partitioner: LlmPartitioner = async ({ payload }) => ({
    blocks: payload.units.map((u) => ({
      id: u.id,
      title: "Section",
      role: "other",
      units: [u.id],
      reason: "Series section",
    })),
    uncertain: [],
  });
  const llm = { samples: 1, partitioner };
  const options = { quality: "optimized" as const };
  const { partition } = await llmPartition(chain, resolver, llm);
  const explicit = planAutoLayout(chain, resolver, {
    ...options,
    partition: partition!,
  });
  const result = await planAutoLayoutWithLlm(chain, resolver, {
    ...options,
    llm,
  });
  expect(result.diagnostics).toContainEqual(
    expect.objectContaining({
      code: "AUTO_LAYOUT_PARTITION_FALLBACK",
      message: expect.stringContaining("improves routed geometry"),
    }),
  );
  expect(result.edits).toEqual(planAutoLayout(chain, resolver, options).edits);
  expect(result.edits).not.toEqual(explicit.edits);
  expect(
    await planAutoLayoutWithLlm(chain, resolver, {
      ...options,
      llm,
      partition: partition!,
    }),
  ).toEqual(explicit);
  const bounded = { ...options, search: { seed: 1, evaluations: 1 } };
  expect(
    await planAutoLayoutWithLlm(chain, resolver, { ...bounded, llm }),
  ).toEqual(
    planAutoLayout(chain, resolver, { ...bounded, partition: partition! }),
  );
});
