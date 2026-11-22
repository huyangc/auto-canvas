import type { SchematicDocument } from "@icm/model";
import type { SymbolResolver } from "@icm/symbols";
import { directedPins } from "./directed-blocks.js";
import { enclosingBox, pinExit } from "./geometry.js";
import { classifyNets } from "./net-roles.js";
import { isMarker } from "./placement-connectivity.js";
import { portDirection } from "./port-convention.js";

/** Free directed blocks with an output leaving west, and the half (−1, 0, 1)
 * each non-rail port lies on relative to the device bodies' midpoint. */
function sides(doc: SchematicDocument, resolver: SymbolResolver) {
  const roles = classifyNets(doc, resolver);
  const west = new Set<string>();
  for (const i of doc.instances) {
    const pose = i.placement;
    if (
      pose &&
      roles.rightFacing?.has(i.id) &&
      directedPins(i, resolver).outputs.some((p) => pinExit(p, pose).x < 0)
    )
      west.add(i.id);
  }
  const ports = new Map<string, { input: boolean; half: number }>();
  const devices = doc.instances.filter((i) => !isMarker(i));
  if (!devices.length) return { west, ports };
  const box = enclosingBox({ ...doc, instances: devices }, resolver);
  const cx = box.x + box.width / 2,
    grid = doc.presentation.grid;
  for (const i of doc.instances) {
    if ((i.symbolId !== "port" && i.symbolId !== "port-filled") || !i.placement)
      continue;
    const net = roles.pinNet(i.id, "P");
    if (!net || roles.rails.has(net)) continue;
    // A port without a known direction reads as an input.
    const input = portDirection(doc, roles, net) !== "output";
    const dx = i.placement.position.x - cx;
    ports.set(i.id, { input, half: Math.abs(dx) < grid ? 0 : Math.sign(dx) });
  }
  return { west, ports };
}

/**
 * R170: whether a whole-drawing reflection puts any single item on the wrong
 * side — a free directed block (R164) newly exiting west, or a non-rail port
 * newly on the wrong half (an input right, an output left). Items that
 * improve elsewhere do not offset it.
 */
export function reflectionWorsensDirection(
  incumbent: SchematicDocument,
  candidate: SchematicDocument,
  resolver: SymbolResolver,
): boolean {
  const a = sides(incumbent, resolver),
    b = sides(candidate, resolver);
  for (const id of b.west) if (!a.west.has(id)) return true;
  for (const [id, p] of b.ports) {
    const was = a.ports.get(id)?.half ?? 0;
    if (p.input ? p.half > 0 && was <= 0 : p.half < 0 && was >= 0) return true;
  }
  return false;
}
