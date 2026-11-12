import { resolveRouteGeometry, visibleInstanceBounds } from "@icm/derived";
import type { SchematicDocument } from "@icm/model";
import type { SymbolResolver } from "@icm/symbols";
import { CELL_PIN_OFFSET, pinPoints } from "./geometry.js";
import {
  deviceNets,
  devicePins,
  isMarker,
  isSignalBlock,
} from "./placement-connectivity.js";
import { parallelAttachments, driverAttachments } from "./stages.js";
import type { NetRoles } from "./net-roles.js";
import type { Placement, RecognizedGroup } from "./types.js";

const MARGIN = 20;
const WIRE_MARGIN = 10;
const CELL_PINS = new Set(["port", "port-filled"]);
const POWER = new Set(["ground", "vdd-port"]);

/** R97: remove grid-sized empty columns while keeping routed seats and rigid units. */
export function compactPlacements(
  document: SchematicDocument,
  resolver: SymbolResolver,
  rigid: readonly (readonly string[])[],
): Map<string, Placement> | undefined {
  const boxes = visibleInstanceBounds(document, resolver);
  if (!boxes.length) return undefined;
  const byId = new Map(boxes.map((b) => [b.id, b.bounds]));
  const symbols = new Map(document.instances.map((i) => [i.id, i.symbolId]));
  const occupied: [number, number][] = boxes.map(({ bounds: b }) => [
    b.x - MARGIN,
    b.x + b.width + MARGIN,
  ]);
  const devices = boxes.filter(
    (b) => !CELL_PINS.has(symbols.get(b.id)!) && !POWER.has(symbols.get(b.id)!),
  );
  if (devices.length) {
    const left = Math.min(...devices.map((b) => b.bounds.x));
    const right = Math.max(...devices.map((b) => b.bounds.x + b.bounds.width));
    for (const { id, bounds: b } of boxes) {
      if (!CELL_PINS.has(symbols.get(id)!)) continue;
      if (b.x + b.width <= left) occupied.push([b.x - MARGIN, left]);
      else if (b.x >= right) occupied.push([right, b.x + b.width + MARGIN]);
    }
  }
  for (const ids of rigid) {
    const members = ids.flatMap((id) => byId.get(id) ?? []);
    if (members.length > 1)
      occupied.push([
        Math.min(...members.map((b) => b.x)) - MARGIN,
        Math.max(...members.map((b) => b.x + b.width)) + MARGIN,
      ]);
  }
  const cellPins = pinPoints(document, resolver).filter((p) =>
    CELL_PINS.has(symbols.get(p.instanceId)!),
  );
  for (const route of document.routes) {
    for (const { from, to } of resolveRouteGeometry(document, resolver, route)
      ?.segments ?? []) {
      const seated = cellPins.some(
        ({ point }) =>
          (point.x === from.x && point.y === from.y) ||
          (point.x === to.x && point.y === to.y),
      );
      if (from.y === to.y && !seated)
        occupied.push(
          [from.x - WIRE_MARGIN, from.x + WIRE_MARGIN],
          [to.x - WIRE_MARGIN, to.x + WIRE_MARGIN],
        );
      else
        occupied.push([
          Math.min(from.x, to.x) - WIRE_MARGIN,
          Math.max(from.x, to.x) + WIRE_MARGIN,
        ]);
    }
  }
  for (const junction of document.junctions)
    occupied.push([
      junction.position.x - WIRE_MARGIN,
      junction.position.x + WIRE_MARGIN,
    ]);
  const left = Math.min(...boxes.map((b) => b.bounds.x));
  const right = Math.max(...boxes.map((b) => b.bounds.x + b.bounds.width));
  return closeGaps(
    document,
    "x",
    left,
    right,
    occupied,
    new Map(boxes.map((b) => [b.id, b.bounds.x])),
  );
}

function closeGaps(
  document: SchematicDocument,
  axis: "x" | "y",
  left: number,
  right: number,
  occupied: [number, number][],
  offset: ReadonlyMap<string, number>,
): Map<string, Placement> | undefined {
  const gaps: { end: number; width: number }[] = [];
  occupied.sort((a, b) => a[0] - b[0]);
  let cursor = left;
  for (const [start, end] of occupied) {
    const gapEnd = Math.min(start, right);
    const width =
      Math.floor((gapEnd - cursor) / document.presentation.grid) *
      document.presentation.grid;
    if (width > 0) gaps.push({ end: gapEnd, width });
    cursor = Math.max(cursor, end);
    if (cursor >= right) break;
  }
  if (!gaps.length) return undefined;
  return new Map(
    document.instances.flatMap((instance) => {
      const old = instance.placement;
      if (!old) return [];
      const coordinate = offset.get(instance.id) ?? left;
      const shift = gaps.reduce(
        (sum, gap) => sum + (gap.end <= coordinate ? gap.width : 0),
        0,
      );
      return [
        [
          instance.id,
          {
            ...old,
            position: { ...old.position, [axis]: old.position[axis] - shift },
          },
        ] as const,
      ];
    }),
  );
}

/** Sweep horizontal bands. Every protected span translates as one, including
 * overlapping spans from different groups. Wires can be rebuilt between them. */
export function compactRows(
  document: SchematicDocument,
  resolver: SymbolResolver,
  rigid: readonly (readonly string[])[],
  roles: NetRoles,
  groups: RecognizedGroup[],
): Map<string, Placement> | undefined {
  const boxes = visibleInstanceBounds(document, resolver);
  if (!boxes.length) return undefined;
  const devices = document.instances.filter((i) => !isMarker(i));
  const byId = new Map(document.instances.map((i) => [i.id, i]));
  const occupied: [number, number][] = boxes.map(({ id, bounds: b }) => {
    const center = byId.get(id)!.placement!.position.y;
    return [
      Math.min(center, b.y) - MARGIN,
      Math.max(center, b.y + b.height) + MARGIN,
    ];
  });
  function bind(ids: readonly string[]) {
    const ys = ids.flatMap((id) => byId.get(id)?.placement?.position.y ?? []);
    if (ys.length > 1) occupied.push([Math.min(...ys), Math.max(...ys)]);
  }
  for (const ids of rigid) bind(ids);
  for (const c of document.constraints) bind(c.objectIds);
  for (const c of document.inductorCouplings ?? [])
    bind(c.members.map((m) => m.instanceId));
  for (const { device, host } of parallelAttachments(devices, resolver, roles))
    bind([device.id, host.id]);
  for (const { stage, host } of driverAttachments(
    devices,
    resolver,
    roles,
    groups,
  ))
    bind([host.device.id, ...stage.devices.map((d) => d.id)]);
  // A passive spanning two signal nets of an amplifier is a feedback seat.
  const blocks = devices
    .filter((i) => isSignalBlock(i, resolver))
    .map((i) => ({ id: i.id, nets: new Set(deviceNets(i, resolver, roles)) }));
  for (const i of devices.filter((i) => devicePins(i, resolver).length === 2)) {
    const nets = new Set(deviceNets(i, resolver, roles));
    if (nets.size !== 2 || [...nets].some((n) => roles.rails.has(n))) continue;
    for (const b of blocks)
      if ([...nets].every((n) => b.nets.has(n))) bind([b.id, i.id]);
  }
  const pins = pinPoints(document, resolver);
  for (const p of pins) {
    // Even a terminal outside the body must translate with the body.
    const center = byId.get(p.instanceId)!.placement!.position.y;
    occupied.push([Math.min(center, p.point.y), Math.max(center, p.point.y)]);
    if (!isMarker(byId.get(p.instanceId)!)) continue;
    const net = roles.pinNet(p.instanceId, p.pinName);
    if (!net) continue;
    for (const q of pins)
      if (
        !isMarker(byId.get(q.instanceId)!) &&
        roles.pinNet(q.instanceId, q.pinName) === net &&
        p.point.x === q.point.x &&
        Math.abs(p.point.y - q.point.y) <= CELL_PIN_OFFSET
      )
        bind([p.instanceId, q.instanceId]);
  }
  const offset = new Map(
    document.instances.flatMap((i) =>
      i.placement ? [[i.id, i.placement.position.y] as const] : [],
    ),
  );
  return closeGaps(
    document,
    "y",
    Math.min(...offset.values()),
    Math.max(...offset.values()),
    occupied,
    offset,
  );
}
