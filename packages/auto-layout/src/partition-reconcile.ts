import type { SchematicDocument } from "@icm/model";
import type { SymbolResolver } from "@icm/symbols";
import { classifyNets, isMosBulk } from "./net-roles.js";
import { devicePins, isMarker } from "./placement-connectivity.js";
import { adjustedRandIndex } from "./partition-metrics.js";
import type { LlmPartitionResult } from "./partition-prompt.js";
import { compareIds, recognizeSubstructures } from "./recognize.js";
import {
  recognitionUnits,
  roleEvidence,
  ruleBlock,
  rulePartition,
} from "./units.js";
import type { FingerprintEntry } from "./fingerprint.js";
import type { LayoutPartition, PartitionBlock } from "./types.js";

const CONSENSUS_THRESHOLD = 0.5;
const MAX_DEVICE_SHARE = 0.5;
const MAX_DEVICE_COUNT = 12;

/** @internal Check T029's output before the planner's legacy L0 merges. */
export function partitionInvariantErrors(
  document: SchematicDocument,
  resolver: SymbolResolver,
  partition: LayoutPartition,
): string[] {
  const errors: string[] = [];
  const devices = document.instances.filter((i) => !isMarker(i));
  const roles = classifyNets(document, resolver);
  const couplings = recognizeSubstructures(document, roles)
    .structures.filter((s) => s.kind === "coupled-inductors")
    .map((s) => s.members.flatMap((m) => m.instanceIds));
  const nets = new Map(
    devices.map((i) => [
      i.id,
      new Set(
        devicePins(i, resolver).flatMap((p) => {
          const net = roles.pinNet(i.id, p.name);
          return net && !roles.rails.has(net) && !isMosBulk(i.symbolId, p.name)
            ? [net]
            : [];
        }),
      ),
    ]),
  );
  const owners = new Map<string, number>();
  for (const [index, block] of partition.blocks.entries()) {
    if (!block.members.length) errors.push(`Empty block: ${block.id}`);
    for (const id of block.members) {
      if (!nets.has(id)) errors.push(`Unknown device: ${id}`);
      if (owners.has(id)) errors.push(`Duplicate device: ${id}`);
      owners.set(id, index);
    }
    const remaining = new Set(block.members);
    const reached = block.members.slice(0, 1);
    if (reached.length) remaining.delete(reached[0]!);
    for (const id of reached)
      for (const other of remaining)
        if (
          [...(nets.get(id) ?? [])].some((net) => nets.get(other)?.has(net)) ||
          couplings.some(
            (members) => members.includes(id) && members.includes(other),
          )
        ) {
          reached.push(other);
          remaining.delete(other);
        }
    if (remaining.size) errors.push(`Disconnected block: ${block.id}`);
  }
  for (const i of devices)
    if (!owners.has(i.id)) errors.push(`Missing device: ${i.id}`);
  for (const unit of recognitionUnits(document, resolver))
    if (new Set(unit.members.map((m) => owners.get(m.id))).size > 1)
      errors.push(`Split unit: ${unit.id}`);
  return errors;
}

/** @internal Missing/uncertain units are separate singleton clusters, never one block. */
function sampleClusters(sample: LlmPartitionResult, ids: string[]): string[][] {
  const seen = new Set<string>();
  const clusters = sample.blocks
    .map((b) =>
      b.units.filter((id) => {
        if (!ids.includes(id) || seen.has(id)) return false;
        seen.add(id);
        return true;
      }),
    )
    .filter((b) => b.length);
  return [...clusters, ...ids.filter((id) => !seen.has(id)).map((id) => [id])];
}

/** @internal R113: accept consensus proposals and complete with graph rules. */
export function reconcilePartition(
  document: SchematicDocument,
  resolver: SymbolResolver,
  samples: readonly LlmPartitionResult[] = [],
  entries: readonly FingerprintEntry[] = [],
) {
  const units = recognitionUnits(document, resolver, entries);
  const byId = new Map(units.map((u) => [u.id, u]));
  const ids = units.map((u) => u.id);
  const fallback = rulePartition(document, resolver, units);
  const roles = classifyNets(document, resolver);
  const nets = new Map(
    units.map((u) => [
      u.id,
      new Set(
        u.members.flatMap((m) => {
          const i = document.instances.find((i) => i.id === m.id)!;
          return devicePins(i, resolver).flatMap((p) => {
            const net = roles.pinNet(i.id, p.name);
            return net &&
              !roles.rails.has(net) &&
              !isMosBulk(i.symbolId, p.name)
              ? [net]
              : [];
          });
        }),
      ),
    ]),
  );
  // R110 guarantees each unit is internally connected through these same nets,
  // so connectivity between units is also exact at device level.
  const adjacent = (a: string, b: string) =>
    [...nets.get(a)!].some((net) => nets.get(b)!.has(net));
  const components = (input: string[]) => {
    const remaining = new Set(input);
    const result: string[][] = [];
    while (remaining.size) {
      const group = [[...remaining].sort(compareIds)[0]!];
      remaining.delete(group[0]!);
      for (let n = 0; n < group.length; n++)
        for (const id of remaining)
          if (adjacent(group[n]!, id)) {
            group.push(id);
            remaining.delete(id);
          }
      result.push(group.sort(compareIds));
    }
    return result.sort(
      (a, b) =>
        b.reduce((s, id) => s + byId.get(id)!.members.length, 0) -
          a.reduce((s, id) => s + byId.get(id)!.members.length, 0) ||
        compareIds(a[0]!, b[0]!),
    );
  };
  const checks = {
    unknown: 0,
    duplicate: 0,
    disconnected: 0,
    oversized: 0,
    empty: 0,
    softRole: 0,
    unstable: 0,
  };
  const diagnostics: {
    check: keyof typeof checks;
    block: string;
    message: string;
  }[] = [];
  const report = (
    check: keyof typeof checks,
    block: string,
    message: string,
    count = 1,
  ) => {
    checks[check] += count;
    diagnostics.push({ check, block, message });
  };
  const clusters = samples.map((s) => sampleClusters(s, ids));
  const pairwiseSampleAri: { a: number; b: number; ari: number }[] = [];
  const scores = samples.map(() => 0);
  for (let a = 0; a < samples.length; a++)
    for (let b = a + 1; b < samples.length; b++) {
      const ari = adjustedRandIndex(clusters[a]!, clusters[b]!);
      pairwiseSampleAri.push({ a, b, ari });
      scores[a]! += ari;
      scores[b]! += ari;
    }
  const medoidIndex = samples.length
    ? scores.indexOf(Math.max(...scores))
    : null;
  const owners = clusters.map(
    (cs) => new Map(cs.flatMap((c, n) => c.map((id) => [id, n] as const))),
  );
  const share = (id: string, mates: string[]) => {
    if (samples.length <= 1 || !mates.length) return 1;
    return (
      owners.reduce(
        (sum, owner) =>
          sum +
          mates.filter((mate) => owner.get(id) === owner.get(mate)).length,
        0,
      ) /
      (owners.length * mates.length)
    );
  };
  const blocks: PartitionBlock[] = [];
  const seen = new Set<string>();
  const assigned = new Set<string>();
  for (const proposal of medoidIndex === null
    ? []
    : samples[medoidIndex]!.blocks) {
    let kept = proposal.units.filter((id) => {
      if (!byId.has(id)) {
        report("unknown", proposal.id, `Unknown unit: ${id}`);
        return false;
      }
      if (seen.has(id)) {
        report("duplicate", proposal.id, `Duplicate unit: ${id}`);
        return false;
      }
      seen.add(id);
      return true;
    });
    const support = new Map(
      kept.map((id) => [
        id,
        share(
          id,
          kept.filter((mate) => mate !== id),
        ),
      ]),
    );
    kept = kept.filter((id) => {
      if (support.get(id)! >= CONSENSUS_THRESHOLD) return true;
      report("unstable", proposal.id, `Unstable unit: ${id}`);
      return false;
    });
    const connected = components(kept);
    if (connected.length > 1)
      report(
        "disconnected",
        proposal.id,
        `Kept largest of ${connected.length} components`,
      );
    kept = connected[0] ?? [];
    const count = kept.reduce((s, id) => s + byId.get(id)!.members.length, 0);
    if (!count) {
      report("empty", proposal.id, "Empty block dropped");
      continue;
    }
    let parts = [kept];
    if (
      count > MAX_DEVICE_COUNT &&
      count > units.reduce((s, u) => s + u.members.length, 0) * MAX_DEVICE_SHARE
    ) {
      report("oversized", proposal.id, "Split along rule partition");
      parts = fallback.blocks.flatMap((b) =>
        components(b.unitIds.filter((id) => kept.includes(id))),
      );
    }
    for (const [n, part] of parts.entries()) {
      const members = part.flatMap((id) =>
        byId.get(id)!.members.map((m) => m.id),
      );
      const evidence = roleEvidence(document, resolver, members);
      const validRole =
        proposal.role === "input"
          ? evidence.differential || evidence.gateInput
          : proposal.role === "bias"
            ? evidence.bias
            : proposal.role === "output"
              ? evidence.output
              : true;
      if (!validRole)
        report("softRole", proposal.id, `Unsupported ${proposal.role} role`);
      blocks.push({
        id: `block-${blocks.length + 1}`,
        title: proposal.title + (parts.length > 1 ? ` (${n + 1})` : ""),
        role: proposal.role,
        members,
        unitIds: part,
        provenance: "llm",
        confidence:
          part.reduce((s, id) => s + support.get(id)!, 0) / part.length,
      });
      for (const id of part) assigned.add(id);
    }
  }
  const llmDevices = blocks.reduce((s, b) => s + b.members.length, 0);
  // Reserve every unclaimed template before leaf attachment and rule completion.
  for (const unit of units) {
    if (unit.source !== "template" || assigned.has(unit.id)) continue;
    blocks.push({
      id: `block-${blocks.length + 1}`,
      title: unit.title!,
      role: unit.role!,
      members: unit.members.map((m) => m.id),
      unitIds: [unit.id],
      provenance: "template",
      confidence: 1,
    });
    assigned.add(unit.id);
  }
  // Each wave observes the same accepted blocks; then apply in canonical order.
  // A host with added units is marked attached, retaining its original confidence.
  for (;;) {
    const attachments = ids
      .filter((id) => !assigned.has(id))
      .flatMap((id) => {
        const hosts = blocks.filter((b) =>
          b.unitIds.some((mate) => adjacent(id, mate)),
        );
        const host = hosts.length === 1 ? hosts[0] : undefined;
        return host &&
          host.provenance !== "template" &&
          ids.every(
            (mate) =>
              mate === id || !adjacent(id, mate) || host.unitIds.includes(mate),
          )
          ? [{ id, host }]
          : [];
      });
    if (!attachments.length) break;
    for (const { id, host } of attachments) {
      host.unitIds.push(id);
      host.members.push(...byId.get(id)!.members.map((m) => m.id));
      host.provenance = "attached";
      assigned.add(id);
    }
  }
  for (const b of fallback.blocks)
    for (const part of components(b.unitIds.filter((id) => !assigned.has(id))))
      blocks.push(
        ruleBlock(
          document,
          resolver,
          part.map((id) => byId.get(id)!),
          `block-${blocks.length + 1}`,
        ),
      );
  const finalClusters = blocks.map((b) => b.unitIds);
  return {
    partition: { blocks },
    diagnostics,
    statistics: {
      samples: samples.length,
      medoidIndex,
      ruleOnly: samples.length === 0,
      llmCoverage: units.length
        ? llmDevices / units.reduce((s, u) => s + u.members.length, 0)
        : 0,
      checks,
      pairwiseSampleAri,
      consensusToSampleAri: clusters.map((c) =>
        adjustedRandIndex(finalClusters, c),
      ),
      blocksByProvenance: {
        ...(units.some((u) => u.source === "template")
          ? {
              template: blocks.filter((b) => b.provenance === "template")
                .length,
            }
          : {}),
        llm: blocks.filter((b) => b.provenance === "llm").length,
        attached: blocks.filter((b) => b.provenance === "attached").length,
        rule: blocks.filter((b) => b.provenance === "rule").length,
      },
    },
  };
}
