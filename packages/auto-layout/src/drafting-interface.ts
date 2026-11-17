import {
  endpointKey,
  resolveDraftingObjectGeometry,
  resolveEndpointPoint,
} from "@icm/derived";
import { routeEndpoints, type Point, type SchematicDocument } from "@icm/model";
import type { SymbolResolver } from "@icm/symbols";
import { preview } from "./transaction.js";
import type { AutoLayoutResult } from "./types.js";

/** Open conductors terminating on a drawn frame carry visual interface intent.
 * They do not authorize electrical connections through that frame. */
function missingInterfaces(
  source: SchematicDocument,
  after: SchematicDocument,
  resolver: SymbolResolver,
) {
  const signature = (d: SchematicDocument, net: string) =>
    JSON.stringify(
      d.nets
        .find((n) => n.id === net)
        ?.terminals.map((t) => endpointKey({ kind: "terminal", ...t }))
        .sort() ?? [],
    );
  const endpoints = (d: SchematicDocument) =>
    d.routes.flatMap((r) =>
      routeEndpoints(r).flatMap((e) => {
        const point = resolveEndpointPoint(d, resolver, e);
        return point
          ? [
              {
                key: endpointKey(e),
                point,
                net: signature(d, r.netId),
                junction: e.kind === "junction",
              },
            ]
          : [];
      }),
    );
  const oldEnds = endpoints(source),
    nextEnds = endpoints(after);
  const lost: { id: string; net: string }[] = [];
  for (const object of source.drafting?.objects ?? []) {
    if (object.kind !== "rectangle") continue;
    const shape = resolveDraftingObjectGeometry(source, resolver, object);
    if (shape.kind !== "rectangle" || !shape.width || !shape.height) continue;
    const local = (p: Point) => {
      const angle = (-shape.rotation * Math.PI) / 180;
      const x = p.x - shape.center.x,
        y = p.y - shape.center.y;
      return {
        x: (x * Math.cos(angle) - y * Math.sin(angle)) / shape.width,
        y: (x * Math.sin(angle) + y * Math.cos(angle)) / shape.height,
      };
    };
    const attached = oldEnds.filter((e) => {
      if (
        !e.junction ||
        e.net === "[]" ||
        oldEnds.filter((o) => o.key === e.key).length !== 1
      )
        return false;
      const p = local(e.point);
      return (
        (Math.abs(Math.abs(p.x) - 0.5) < 1e-6 && Math.abs(p.y) <= 0.5 + 1e-6) ||
        (Math.abs(Math.abs(p.y) - 0.5) < 1e-6 && Math.abs(p.x) <= 0.5 + 1e-6)
      );
    });
    // A lone annotation box beside one wire is not a multi-net functional block.
    if (new Set(attached.map((e) => e.net)).size < 2) continue;
    const nextObject = after.drafting?.objects.find((o) => o.id === object.id);
    const nextShape =
      nextObject && resolveDraftingObjectGeometry(after, resolver, nextObject);
    if (nextShape?.kind !== "rectangle") {
      lost.push({ id: object.id, net: "" });
      continue;
    }
    const angle = (nextShape.rotation * Math.PI) / 180;
    for (const e of attached) {
      const p = local(e.point),
        x = p.x * nextShape.width,
        y = p.y * nextShape.height;
      const point = {
        x: nextShape.center.x + x * Math.cos(angle) - y * Math.sin(angle),
        y: nextShape.center.y + x * Math.sin(angle) + y * Math.cos(angle),
      };
      if (
        !nextEnds.some(
          (n) =>
            n.net === e.net &&
            Math.hypot(n.point.x - point.x, n.point.y - point.y) < 1e-6,
        )
      )
        lost.push({ id: object.id, net: e.net });
    }
  }
  return lost;
}

export function detachedDraftingInterfaces(
  source: SchematicDocument,
  after: SchematicDocument,
  resolver: SymbolResolver,
): string[] {
  return [
    ...new Set(missingInterfaces(source, after, resolver).map((m) => m.id)),
  ];
}

/** R161: until frames take part in placement, a plan that would detach a
 * functional frame's drawn interfaces is refused and the source kept. */
export function preserveDraftingInterfaces(
  source: SchematicDocument,
  resolver: SymbolResolver,
  candidate: AutoLayoutResult,
): AutoLayoutResult {
  if (!source.drafting?.objects.some((o) => o.kind === "rectangle"))
    return candidate;
  const after = preview(source, resolver, candidate.edits);
  if (!after.ok) return candidate;
  const lost = detachedDraftingInterfaces(source, after.document, resolver);
  if (!lost.length) return candidate;
  return {
    edits: [],
    groups: [],
    diagnostics: [
      {
        severity: "error",
        code: "AUTO_LAYOUT_DRAFTING_INTERFACE_UNSUPPORTED",
        rule: "drafting-interface",
        message: `Automatic layout does not yet place drawings whose functional frames have drawn interfaces; the drawing is left unchanged. Frames: ${lost.join(", ")}.`,
      },
    ],
  };
}
