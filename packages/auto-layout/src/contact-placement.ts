import {
  endpointKey,
  resolveEndpointPoint,
  visibleInstanceBounds,
} from "@icm/derived";
import type { SchematicDocument } from "@icm/model";
import type { SymbolResolver } from "@icm/symbols";
import { pinExit, pinPoints, withPlacements } from "./geometry.js";
import { type PinContact, type TerminalRef } from "./pin-contacts.js";
import { isMarker } from "./placement-connectivity.js";
import type { PinGroup } from "./route.js";
import type { Placement } from "./types.js";

const key = (p: TerminalRef) =>
  endpointKey({
    kind: "terminal",
    instanceId: p.instanceId,
    pinName: p.pinName,
  });
const pairKey = (a: string, b: string) => JSON.stringify([a, b].sort());
export function contactPolicy(
  source: SchematicDocument,
  groups: PinGroup[],
  allDeclaredPairs = false,
) {
  const devices = new Map(source.instances.map((i) => [i.id, i]));
  const pairs: PinContact[] = [];
  const declared = new Map<string, Set<string>>();
  for (const net of source.nets)
    for (const t of net.terminals) {
      if (t.memberId) continue;
      const k = key(t),
        ids = declared.get(k) ?? new Set();
      ids.add(net.id);
      declared.set(k, ids);
    }
  for (const g of groups) {
    const proposed = [...g.contacts];
    // With no authored contact, infer an unambiguous two-device signal pair.
    // Do not infer arbitrary contacts to ports or rails on a shared supply.
    if (allDeclaredPairs) {
      for (const [i, a] of g.pins.entries())
        for (const b of g.pins.slice(i + 1)) proposed.push([a, b]);
    } else if (
      g.pins.length === 2 &&
      g.pins.every((p) => !isMarker(devices.get(p.instanceId)!))
    )
      proposed.push([g.pins[0]!, g.pins[1]!]);
    for (const [a, b] of proposed) {
      // The frozen projection can itself reflect an accidental input overlap.
      // Require independent, unambiguous scalar declarations on BOTH ends.
      if (
        a.instanceId !== b.instanceId &&
        [a, b].every((p) => {
          const owners = declared.get(key(p));
          return owners?.size === 1 && owners.has(g.netId);
        })
      )
        pairs.push([a, b]);
    }
  }
  const allowed = new Set(pairs.map(([a, b]) => pairKey(key(a), key(b))));
  return { pairs, allowed };
}
type Policy = ReturnType<typeof contactPolicy>;
function direction(d: SchematicDocument, r: SymbolResolver, p: TerminalRef) {
  const i = d.instances.find((i) => i.id === p.instanceId);
  if (!i?.placement) return;
  const symbol = r.resolve(i.symbolId, i.symbolVariantId);
  const pin = symbol?.definition.pins.find((z) => z.name === p.pinName);
  if (
    !pin ||
    pin.signalMembers?.length ||
    (p.pinName === "P" &&
      d.netlist?.terminals.some(
        (t) =>
          t.interfaceInstanceIds.includes(p.instanceId) &&
          (t.signal?.members.length ?? 0) > 1,
      )) ||
    pin.presentation.visibility === "implicit" ||
    symbol?.variant?.hiddenPinNames?.includes(pin.name)
  )
    return;
  return pinExit(pin, i.placement);
}

/** Only the padded hit boxes of a licensed pair may overlap. The two actual
 * ink bounds must end on opposite sides of the common landing plane. */
export function contactGeometryProblem(
  d: SchematicDocument,
  r: SymbolResolver,
  policy: Policy,
) {
  const hits = new Map<string, ReturnType<typeof pinPoints>>();
  for (const p of pinPoints(d, r)) {
    const k = JSON.stringify(p.point),
      arr = hits.get(k) ?? [];
    arr.push(p);
    hits.set(k, arr);
  }
  const boxes = visibleInstanceBounds(d, r),
    byId = new Map(boxes.map((x) => [x.id, x.bounds]));
  const permitted = new Set<string>();
  for (const pins of hits.values()) {
    if (pins.length === 1) continue;
    const [a, b] = pins;
    const problem = "R10: unlicensed or obstructed coincident pins";
    if (
      pins.length !== 2 ||
      !a ||
      !b ||
      !policy.allowed.has(pairKey(key(a), key(b)))
    )
      return problem;
    const pa = resolveEndpointPoint(d, r, {
        kind: "terminal",
        instanceId: a.instanceId,
        pinName: a.pinName,
      }),
      pb = resolveEndpointPoint(d, r, {
        kind: "terminal",
        instanceId: b.instanceId,
        pinName: b.pinName,
      });
    const ea = direction(d, r, a),
      eb = direction(d, r, b);
    if (
      !pa ||
      !pb ||
      Math.hypot(pa.x - pb.x, pa.y - pb.y) > 1e-6 ||
      !ea ||
      !eb ||
      ea.x !== -eb.x ||
      ea.y !== -eb.y
    )
      return problem;
    const axis = ea.x ? "x" : "y";
    const size = axis === "x" ? "width" : "height";
    for (const [p, e] of [
      [a, ea],
      [b, eb],
    ] as const) {
      const box = byId.get(p.instanceId);
      // visibleInstanceBounds includes one unit of interaction padding on each side.
      if (
        !box ||
        (e[axis] > 0
          ? box[axis] + box[size] - 1 - pa[axis]
          : pa[axis] - box[axis] - 1) > 1e-6
      )
        return problem;
    }
    permitted.add(pairKey(a.instanceId, b.instanceId));
  }
  for (const [i, a] of boxes.entries())
    for (const b of boxes.slice(i + 1)) {
      if (
        !permitted.has(pairKey(a.id, b.id)) &&
        a.bounds.x < b.bounds.x + b.bounds.width &&
        b.bounds.x < a.bounds.x + a.bounds.width &&
        a.bounds.y < b.bounds.y + b.bounds.height &&
        b.bounds.y < a.bounds.y + a.bounds.height
      )
        return "R10: bounds overlap " + a.id + ", " + b.id;
    }
}

/** Close only an axial strip between facing terminals. Everything on its far
 * side translates together. A rigid unit or another symbol inside the strip
 * vetoes the move. Test each cumulative proposal with a full routed replay. */
export function contactMoves(
  d: SchematicDocument,
  r: SymbolResolver,
  policy: Policy,
  rigid: readonly (readonly string[])[],
) {
  const points = new Map(pinPoints(d, r).map((p) => [key(p), p.point]));
  const moves = new Map<
    string,
    { distance: number; placements: Map<string, Placement> }
  >();
  for (const [a, b] of policy.pairs) {
    const p = points.get(key(a)),
      q = points.get(key(b)),
      ea = direction(d, r, a),
      eb = direction(d, r, b);
    if (!p || !q || !ea || !eb || ea.x !== -eb.x || ea.y !== -eb.y) continue;
    const axis = ea.x ? "x" : "y",
      across = ea.x ? "y" : "x";
    if (p[across] !== q[across] || (q[axis] - p[axis]) * ea[axis] <= 0)
      continue;
    const low = Math.min(p[axis], q[axis]),
      high = Math.max(p[axis], q[axis]),
      distance = high - low;
    if (distance % d.presentation.grid !== 0) continue;
    const side = new Set<string>();
    if (
      d.instances.some((i) => {
        if (!i.placement) return true;
        const pos = i.placement.position[axis];
        if (pos >= high) side.add(i.id);
        return pos > low && pos < high;
      })
    )
      continue;
    if (
      side.has(a.instanceId) === side.has(b.instanceId) ||
      rigid.some(
        (g) => g.some((id) => side.has(id)) && g.some((id) => !side.has(id)),
      )
    )
      continue;
    const placements = new Map(
      d.instances.map((i) => {
        const old = i.placement!;
        return [
          i.id,
          side.has(i.id)
            ? {
                ...old,
                position: {
                  ...old.position,
                  [axis]: old.position[axis] - distance,
                },
              }
            : old,
        ];
      }),
    );
    const placed = withPlacements(d, placements);
    if (contactGeometryProblem(placed, r, policy)) continue;
    moves.set(JSON.stringify([axis, low, high]), { distance, placements });
  }
  return [...moves.values()]
    .sort((a, b) => b.distance - a.distance)
    .map((m) => m.placements);
}
