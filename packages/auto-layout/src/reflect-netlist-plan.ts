import {
  proposeGroupReflectionEdits,
  MAX_SCHEMATIC_EDITS_PER_TRANSACTION,
  type SchematicEdit,
} from "@icm/edit-engine";
import type { Point, SchematicDocument } from "@icm/model";
import type { SymbolResolver } from "@icm/symbols";
import { preview, terminalPartition, lostNameClaim } from "./transaction.js";
import type { AutoLayoutResult } from "./types.js";

interface RoutedPlan {
  candidate: AutoLayoutResult;
  final: SchematicDocument;
}

/** Reflect the finished routes and typography together. Junctions synthesized
 * at transaction commit cannot be referenced by a second edit in the same
 * transaction, so reflect the original sequence of wire construction edits. */
export function reflectNetlistPlan(
  source: SchematicDocument,
  resolver: SymbolResolver,
  plan: RoutedPlan,
  axis: number,
  direction: "left-right" | "top-bottom" = "left-right",
): RoutedPlan | undefined {
  const doc = plan.final;
  const ids = doc.instances.map((i) => i.id);
  let mirror;
  try {
    mirror = proposeGroupReflectionEdits(
      doc,
      resolver,
      ids,
      direction,
      direction === "left-right" ? { x: axis, y: 0 } : { x: 0, y: axis },
      doc.junctions.map((j) => j.id),
    );
  } catch {
    return;
  } // A protected rail can reject a group transform.
  const reflected = preview(doc, resolver, mirror.edits);
  if (!reflected.ok) return;
  const target = reflected.document;
  const seats = new Map(target.instances.map((i) => [i.id, i.placement]));
  const edits: SchematicEdit[] = [];
  for (const i of source.instances) {
    const p = seats.get(i.id);
    if (!p) return;
    if (!i.placement) {
      edits.push({ kind: "place_instance", instanceId: i.id, placement: p });
      continue;
    }
    if (i.placement.rotation !== p.rotation)
      edits.push({
        kind: "rotate_instance",
        instanceId: i.id,
        rotation: p.rotation,
      });
    if (i.placement.mirror !== p.mirror)
      edits.push({
        kind: "mirror_instance",
        instanceId: i.id,
        mirror: p.mirror,
      });
    if (
      i.placement.position.x !== p.position.x ||
      i.placement.position.y !== p.position.y
    )
      edits.push({
        kind: "move_instance",
        instanceId: i.id,
        position: p.position,
      });
  }
  const flip = (p: Point) =>
    direction === "left-right"
      ? { x: 2 * axis - p.x, y: p.y }
      : { x: p.x, y: 2 * axis - p.y };
  for (const e of plan.candidate.edits) {
    if (
      [
        "move_instance",
        "place_instance",
        "rotate_instance",
        "mirror_instance",
        "upsert_schematic_annotation",
      ].includes(e.kind)
    )
      continue;
    if (e.kind === "set_route_path") {
      edits.push({
        ...e,
        route: {
          ...e.route,
          legs: e.route.legs.map((l) =>
            l.to.kind === "bend"
              ? { ...l, to: { ...l.to, position: flip(l.to.position) } }
              : l,
          ),
        },
      });
    } else if (e.kind === "add_junction" || e.kind === "move_junction") {
      edits.push({ ...e, position: flip(e.position) });
    } else if (
      [
        "set_layout_group",
        "set_instance_symbol",
        "remove_route_geometry",
        "remove_junction",
      ].includes(e.kind)
    ) {
      edits.push(e);
    } else return;
  }
  for (const annotation of target.annotations)
    edits.push({ kind: "upsert_schematic_annotation", annotation });
  if (edits.length > MAX_SCHEMATIC_EDITS_PER_TRANSACTION) return;
  const replay = preview(source, resolver, edits);
  if (
    !replay.ok ||
    terminalPartition(replay.document, resolver) !==
      terminalPartition(doc, resolver) ||
    lostNameClaim(doc, replay.document)
  )
    return;
  return { candidate: { ...plan.candidate, edits }, final: replay.document };
}
