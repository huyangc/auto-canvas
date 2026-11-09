import {
  createLabelClearanceContext,
  INSTANCE_LABEL_SIDES,
  instanceLabelSlotAt,
  objectStyleProfile,
  placeUprightInstanceLabel,
  portLabelCandidates,
  resolveDocumentStyleProfile,
  type InstanceLabelPlacement,
} from "@icm/derived";
import type { SchematicEdit } from "@icm/edit-engine";
import type { Annotation, SchematicDocument } from "@icm/model";
import { resolveInstanceSymbol, type SymbolResolver } from "@icm/symbols";
import { compareIds } from "./recognize.js";
import { timePhase } from "./timing.js";

/** R73: a bounded greedy arrangement, sharing the editor's ink and slots. */
export function seatLabels(
  document: SchematicDocument,
  resolver: SymbolResolver,
  placed: ReadonlySet<string>,
): SchematicEdit[] {
  return timePhase("seating", () => arrange(document, resolver, placed));
}

function arrange(
  document: SchematicDocument,
  resolver: SymbolResolver,
  placed: ReadonlySet<string>,
): SchematicEdit[] {
  const context = createLabelClearanceContext(document, resolver);
  const profile = resolveDocumentStyleProfile(document.presentation);
  const groups = new Map<string, Annotation[]>();
  for (const a of context.visible) {
    if (a.anchor.kind !== "object" || !placed.has(a.anchor.objectId)) continue;
    const group = groups.get(a.anchor.objectId) ?? [];
    group.push(a);
    groups.set(a.anchor.objectId, group);
  }
  const current = new Map<string, Annotation>();
  const candidates = new Map<string, Annotation[][]>();
  const at = (a: Annotation, p: InstanceLabelPlacement): Annotation => {
    if (a.anchor.kind !== "object") return a;
    const ownerId = a.anchor.objectId;
    const origin = document.instances.find((i) => i.id === ownerId)!.placement!
      .position;
    return {
      ...a,
      alignment: p.alignment,
      anchor: {
        ...a.anchor,
        localOffset: { x: p.position.x - origin.x, y: p.position.y - origin.y },
        fallbackPosition: p.position,
      },
    };
  };
  for (const [id, group] of groups) {
    group.sort((a, b) => compareIds(a.id, b.id));
    const instance = document.instances.find((i) => i.id === id);
    if (!instance?.placement) continue;
    const resolved = resolveInstanceSymbol(resolver, instance);
    if (!resolved) continue;
    const port = ["port", "port-filled"].includes(instance.symbolId);
    const options: Annotation[][] = [];
    if (port) {
      for (const p of portLabelCandidates(
        instance,
        resolved,
        objectStyleProfile(profile, instance),
        document.presentation.grid,
      ))
        options.push(group.map((a) => (a.locked ? a : at(a, p))));
    } else {
      const hasName = group.some((a) => a.kind === "instance-label");
      const hasValue = group.some((a) => a.kind === "instance-value");
      for (const side of INSTANCE_LABEL_SIDES) {
        // A locked member pins its whole name/value group to its current side.
        if (
          group.some(
            (a) =>
              a.locked &&
              instanceLabelSlotAt(
                instance,
                resolved,
                objectStyleProfile(profile, a),
                document.presentation.grid,
                {
                  position: context.measure(a).position,
                  alignment: a.alignment,
                },
                a.sizeScale,
              )?.side !== side,
          )
        )
          continue;
        const candidate = group.map((a) => {
          if (a.locked) return a;
          const p = placeUprightInstanceLabel(
            instance,
            resolved,
            objectStyleProfile(profile, a),
            { x: 0, y: 0 },
            side,
            document.presentation.grid,
            a.sizeScale,
            a.kind === "instance-value" && hasName
              ? "value"
              : a.kind === "instance-label" && hasValue
                ? "reference-over-value"
                : "reference",
          );
          return p ? at(a, p) : a;
        });
        options.push(candidate);
      }
    }
    candidates.set(id, options);
    for (const a of group) current.set(a.id, a);
  }
  const wires = new Set(document.routes.map((r) => r.id));
  const score = (group: Annotation[]): number[] => {
    const own = new Set(group.map((a) => a.id));
    const result = [0, 0, 0, 0];
    for (const a of group) {
      const box = context.measure(a).inkBounds;
      const findings = context.findingsAt(a, box, own);
      result[0]! += findings.overlapped.length;
      result[1]! += findings.struck.filter((id) => wires.has(id)).length;
      result[2]! += findings.struck.filter((id) => !wires.has(id)).length;
      if (a.anchor.kind === "object") {
        const ownerId = a.anchor.objectId;
        const origin = document.instances.find((i) => i.id === ownerId)!
          .placement!.position;
        const p = context.measure(a).position;
        result[3]! += Math.hypot(p.x - origin.x, p.y - origin.y);
      }
    }
    // Count candidate members against each other, never their stale index entries.
    for (let i = 0; i < group.length; i++)
      for (let j = i + 1; j < group.length; j++) {
        const a = context.measure(group[i]!).inkBounds,
          b = context.measure(group[j]!).inkBounds;
        if (
          a.x < b.x + b.width &&
          a.x + a.width > b.x &&
          a.y < b.y + b.height &&
          a.y + a.height > b.y
        )
          result[0]!++;
      }
    return result;
  };
  const compare = (a: number[], b: number[]) => {
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i]! - b[i]!;
    return 0;
  };
  for (let pass = 0; pass < 2; pass++) {
    const conflicts = new Map(
      [...candidates.keys()].map((id) => [
        id,
        score(groups.get(id)!.map((a) => current.get(a.id)!)),
      ]),
    );
    const order = [...candidates.keys()].sort(
      (a, b) =>
        compare(conflicts.get(b)!.slice(0, 3), conflicts.get(a)!.slice(0, 3)) ||
        compareIds(groups.get(a)![0]!.id, groups.get(b)![0]!.id),
    );
    let changed = false;
    for (const id of order) {
      const group = groups.get(id)!;
      let best = candidates.get(id)![0] ?? group.map((a) => current.get(a.id)!);
      let bestScore = score(best);
      for (const candidate of candidates.get(id)!) {
        const value = score(candidate);
        if (compare(value, bestScore) < 0) {
          best = candidate;
          bestScore = value;
        }
      }
      for (const a of best) {
        if (a !== current.get(a.id)) changed = true;
        current.set(a.id, a);
        context.accept(a);
      }
    }
    if (!changed) break;
  }
  return [...current.values()]
    .filter(
      (a) =>
        !a.locked &&
        a !== document.annotations.find((original) => original.id === a.id),
    )
    .map((annotation) => ({ kind: "upsert_schematic_annotation", annotation }));
}
