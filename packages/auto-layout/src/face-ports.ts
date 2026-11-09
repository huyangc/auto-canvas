import { resolveRouteGeometry } from "@icm/derived";
import type { SchematicEdit } from "@icm/edit-engine";
import { routeEnd, type Point, type SchematicDocument } from "@icm/model";
import type { SymbolResolver } from "@icm/symbols";
import {
  enclosingBox,
  geometryProblem,
  pinExit,
  transformPoint,
  withPlacements,
} from "./geometry.js";
import { classifyNets } from "./net-roles.js";
import { compareIds } from "./recognize.js";
import { auditRouting } from "./routing-audit.js";
import type { Placement } from "./types.js";

/** Face a one-pin port along its sole routed departure, keeping its pin fixed.
 * Routing may detour sideways even when R71 correctly faces the original host.
 * Only a collision-free change to the port's artwork is allowed; wires stay put.
 */
export function facePorts(
  document: SchematicDocument,
  resolver: SymbolResolver,
  fixed: ReadonlySet<string>,
): SchematicEdit[] {
  const lockedOwners = new Set(
    document.annotations.flatMap((a) =>
      a.locked && a.anchor.kind === "object" ? [a.anchor.objectId] : [],
    ),
  );
  const roles = classifyNets(document, resolver);
  const departures = new Map<string, { at: Point; direction: Point }[]>();
  for (const route of document.routes) {
    const line = resolveRouteGeometry(document, resolver, route)?.centerline;
    if (!line || line.length < 2) continue;
    for (const [end, at, next] of [
      [route.start, line[0]!, line[1]!],
      [routeEnd(route), line.at(-1)!, line.at(-2)!],
    ] as const) {
      if (end.kind !== "terminal") continue;
      const list = departures.get(end.instanceId) ?? [];
      list.push({
        at,
        direction: { x: Math.sign(next.x - at.x), y: Math.sign(next.y - at.y) },
      });
      departures.set(end.instanceId, list);
    }
  }
  const envelope = enclosingBox(document, resolver);
  const targets = new Map<string, Placement>();
  const edits: SchematicEdit[] = [];
  for (const instance of [...document.instances].sort((a, b) =>
    compareIds(a.id, b.id),
  )) {
    if (
      fixed.has(instance.id) ||
      lockedOwners.has(instance.id) ||
      roles.rails.has(roles.pinNet(instance.id, "P") ?? "") ||
      !instance.placement ||
      !["port", "port-filled"].includes(instance.symbolId)
    )
      continue;
    const pins = resolver.resolve(instance.symbolId, instance.symbolVariantId)
      ?.definition.pins;
    const list = departures.get(instance.id);
    // Trunk taps have no single facing. Keep their placement convention.
    if (pins?.length !== 1 || list?.length !== 1) continue;
    const pin = pins[0]!,
      { at, direction } = list[0]!;
    const old = instance.placement;
    const outward = pinExit(pin, old);
    if (outward.x === direction.x && outward.y === direction.y) continue;
    for (const rotation of [old.rotation, 0, 90, 180, 270] as const) {
      const target = { ...old, rotation };
      const exit = pinExit(pin, target);
      if (exit.x !== direction.x || exit.y !== direction.y) continue;
      const offset = transformPoint(pin.at, { x: 0, y: 0 }, target);
      target.position = { x: at.x - offset.x, y: at.y - offset.y };
      targets.set(instance.id, target);
      const candidate = withPlacements(document, targets);
      const box = enclosingBox(candidate, resolver);
      if (
        Math.abs(box.x - envelope.x) > 1e-6 ||
        Math.abs(box.y - envelope.y) > 1e-6 ||
        geometryProblem(candidate, resolver) ||
        auditRouting(candidate, resolver).unsafeProblems.length
      ) {
        targets.delete(instance.id);
        continue;
      }
      if (old.rotation !== rotation)
        edits.push({
          kind: "rotate_instance",
          instanceId: instance.id,
          rotation,
        });
      if (
        old.position.x !== target.position.x ||
        old.position.y !== target.position.y
      )
        edits.push({
          kind: "move_instance",
          instanceId: instance.id,
          position: target.position,
        });
      break;
    }
  }
  return edits;
}
