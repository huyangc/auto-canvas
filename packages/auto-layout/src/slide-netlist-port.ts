import { resolveRouteGeometry, visibleInstanceBounds } from "@icm/derived";
import {
  MAX_SCHEMATIC_EDITS_PER_TRANSACTION,
  proposeGroupMoveEdits,
} from "@icm/edit-engine";
import { type Point, type SchematicDocument } from "@icm/model";
import type { SymbolResolver } from "@icm/symbols";
import { lostNameClaim, preview, terminalPartition } from "./transaction.js";
import type { AutoLayoutResult } from "./types.js";

/** Stretch only the attached wires, using the same orthogonal move that the
 * editor previews. Replay from the import to verify one complete transaction. */
export function slideNetlistPort(
  source: SchematicDocument,
  resolver: SymbolResolver,
  current: { final: SchematicDocument; candidate: AutoLayoutResult },
  id: string,
  net: string,
  position: Point,
) {
  let proposal;
  try {
    proposal = proposeGroupMoveEdits(current.final, resolver, [
      { instanceId: id, position },
    ]);
  } catch {
    return;
  }
  const edits = [...current.candidate.edits, ...proposal.edits];
  if (edits.length > MAX_SCHEMATIC_EDITS_PER_TRANSACTION) return;
  const replay = preview(source, resolver, edits);
  if (!replay.ok) return;
  const final = replay.document;
  const boxes = visibleInstanceBounds(final, resolver),
    port = boxes.find((b) => b.id === id)?.bounds;
  if (
    !port ||
    boxes.some(
      (b) =>
        b.id !== id &&
        b.bounds.x < port.x + port.width &&
        port.x < b.bounds.x + b.bounds.width &&
        b.bounds.y < port.y + port.height &&
        port.y < b.bounds.y + b.bounds.height,
    )
  )
    return;
  if (
    final.routes.some(
      (route) =>
        route.netId === net &&
        resolveRouteGeometry(final, resolver, route)?.segments.some(
          (s) => s.from.x !== s.to.x && s.from.y !== s.to.y,
        ),
    )
  )
    return;
  if (
    terminalPartition(final, resolver) !==
      terminalPartition(current.final, resolver) ||
    lostNameClaim(current.final, final)
  )
    return;
  return { candidate: { ...current.candidate, edits }, final };
}
