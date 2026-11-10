import type { SchematicDocument } from "@icm/model";
import type { SymbolResolver } from "@icm/symbols";
import { isMarker } from "./placement-connectivity.js";
import { compareIds } from "./recognize.js";
import { recognitionUnits } from "./units.js";
import type {
  AutoLayoutDiagnostic,
  LayoutPartition,
  RecognizedGroup,
  SymmetryComponent,
} from "./types.js";

/** Keep placement templates local without promoting isolated members to groups. */
export function partitionGroups(
  groups: RecognizedGroup[],
  partition?: LayoutPartition,
): RecognizedGroup[] {
  if (!partition) return groups;
  return groups.flatMap((group) =>
    partition.blocks.flatMap((block) => {
      const members = [
        ...group.members,
        ...(group.extraMemberIds ?? []),
      ].filter((id) => block.members.includes(id));
      if (members.length < 2) return [];
      const {
        extraMemberIds: _extra,
        tailInstanceId,
        diodeInstanceId,
        ...rest
      } = group;
      return [
        {
          ...rest,
          id:
            members[0] === group.members[0] && members[1] === group.members[1]
              ? group.id
              : `${group.id}:block:${block.id}`,
          members: [members[0]!, members[1]!] as [string, string],
          ...(members.length > 2 ? { extraMemberIds: members.slice(2) } : {}),
          ...(tailInstanceId && block.members.includes(tailInstanceId)
            ? { tailInstanceId }
            : {}),
          ...(diodeInstanceId && block.members.includes(diodeInstanceId)
            ? { diodeInstanceId }
            : {}),
        },
      ];
    }),
  );
}

/** A surviving symmetry pair and its local axis remain useful inside a block. */
export function partitionSymmetry(
  components: SymmetryComponent[],
  partition?: LayoutPartition,
): SymmetryComponent[] {
  if (!partition) return components;
  return components.flatMap((component) =>
    partition.blocks.flatMap((block) => {
      const pairs = component.pairs.filter((pair) =>
        pair.every((id) => block.members.includes(id)),
      );
      return pairs.length
        ? [
            {
              pairs,
              axis: component.axis.filter((id) => block.members.includes(id)),
              conflicted: component.conflicted.filter((id) =>
                block.members.includes(id),
              ),
            },
          ]
        : [];
    }),
  );
}

/** Validate once at the planner boundary; never mutate the caller's contract. */
export function validatePartition(
  document: SchematicDocument,
  resolver: SymbolResolver,
  input: LayoutPartition,
): { partition: LayoutPartition; diagnostics: AutoLayoutDiagnostic[] } {
  const partition = structuredClone(input);
  const diagnostics: AutoLayoutDiagnostic[] = [];
  const report = (message: string, severity: "warning" | "error" = "error") =>
    diagnostics.push({
      severity,
      code: "AUTO_LAYOUT_PARTITION",
      rule: "partition",
      message,
    });
  const devices = new Set(
    document.instances.filter((i) => !isMarker(i)).map((i) => i.id),
  );
  const blockIds = new Set<string>();
  const owner = new Map<string, string>();
  for (const block of partition.blocks) {
    if (!block.id || blockIds.has(block.id))
      report(`Duplicate or empty block id: ${block.id}`);
    blockIds.add(block.id);
    if (!block.members.length) report(`Empty block: ${block.id}`);
    for (const id of block.members) {
      if (!devices.has(id)) report(`Unknown device member: ${id}`);
      if (owner.has(id)) report(`Duplicate device member: ${id}`);
      owner.set(id, block.id);
    }
  }
  if (
    partition.flow &&
    (new Set(partition.flow).size !== partition.flow.length ||
      partition.flow.some((id) => !blockIds.has(id)))
  )
    report("Flow must contain distinct known block ids");
  if (partition.arrangement) {
    for (const id of Object.keys(partition.arrangement))
      if (!blockIds.has(id)) report(`Unknown arrangement block: ${id}`);
    for (const id of blockIds) {
      const p = partition.arrangement[id];
      if (!p || !Number.isFinite(p.x) || !Number.isFinite(p.y))
        report(`Missing or nonfinite arrangement centre: ${id}`);
    }
  }
  if (diagnostics.length) return { partition, diagnostics };
  const missing = [...devices].filter((id) => !owner.has(id)).sort(compareIds);
  if (missing.length) {
    let id = "other";
    while (blockIds.has(id)) id += "-other";
    partition.blocks.push({ id, role: "other", members: missing });
    for (const member of missing) owner.set(member, id);
    if (partition.arrangement) {
      // No oracle location was supplied for these devices. Use the known centres'
      // mean in the caller's units; the floorplanner resolves the overlap.
      const points = Object.values(partition.arrangement);
      partition.arrangement[id] = {
        x: points.reduce((s, p) => s + p.x, 0) / (points.length || 1),
        y: points.reduce((s, p) => s + p.y, 0) / (points.length || 1),
      };
    }
  }
  const units = recognitionUnits(document, resolver).map((unit) =>
    unit.members.map((member) => member.id),
  );
  for (const unit of units) {
    const ids = new Set(
      unit.map((id) => owner.get(id)).filter((id) => id !== undefined),
    );
    if (ids.size < 2) continue;
    const merged = partition.blocks.filter((b) => ids.has(b.id));
    const first = merged[0]!;
    report(
      `L0 structure split across ${merged.map((b) => b.id).join(", ")}; merged into ${first.id}`,
      "warning",
    );
    if (partition.arrangement) {
      const count = merged.reduce((s, b) => s + b.members.length, 0);
      const centre = { x: 0, y: 0 };
      for (const b of merged) {
        const p = partition.arrangement[b.id]!;
        centre.x += (p.x * b.members.length) / count;
        centre.y += (p.y * b.members.length) / count;
        delete partition.arrangement[b.id];
      }
      partition.arrangement[first.id] = centre;
    }
    first.members = merged.flatMap((b) => b.members).sort(compareIds);
    if (merged.some((b) => b.role !== first.role)) first.role = "other";
    for (const id of first.members) owner.set(id, first.id);
    partition.blocks = partition.blocks.filter(
      (b) => b === first || !ids.has(b.id),
    );
    if (partition.flow)
      partition.flow = [
        ...new Set(partition.flow.map((id) => (ids.has(id) ? first.id : id))),
      ];
  }
  return { partition, diagnostics };
}
