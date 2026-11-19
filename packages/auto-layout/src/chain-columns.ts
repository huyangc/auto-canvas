import { visibleInstanceBounds } from "@icm/derived";
import type { SchematicDocument } from "@icm/model";
import type { SymbolResolver } from "@icm/symbols";
import { pinExit, pinPoints } from "./geometry.js";
import { channelPins, classifyNets, isMosBulk, type NetRoles } from "./net-roles.js";
import { isMarker } from "./placement-connectivity.js";
import { planningMemo } from "./planning-reuse.js";

const CAPACITORS = new Set(["capacitor", "variable-capacitor"]);
/** Page units the two pins may be apart and still read as one straight line. */
const TOL = 2;

export interface ChainEnd {
  id: string;
  pin: string;
  transistor: boolean;
}

/** Owner comment #38's relation: two conduction terminals in one column plus a tap. */
export interface ChainColumn {
  net: string;
  a: ChainEnd;
  b: ChainEnd;
  /** Terminals on the Net besides the two conduction ends (the column's tap). */
  taps: number;
}

const isRailNet = (roles: NetRoles, net: string) =>
  roles.rails.has(net) ||
  roles.byNet.get(net) === "supply" ||
  roles.byNet.get(net) === "ground";

/**
 * T143: the CHAIN columns of one drawing, as the pre-tests measured them
 * (`pt-align/align-lib.js` `alignRelations` → `chains`): a non-rail Net whose
 * only two conduction terminals sit on two different devices, one of them a
 * transistor, and which carries at least one further tap terminal. The bulk of
 * a MOS is not a tap; it is the device's own body, so a Net whose only further
 * terminal is a bulk stays an R166 STACK, not a column.
 *
 * The relation is netlist-only: it does not depend on a placement.
 */
export function chainColumns(
  document: SchematicDocument,
  resolver: SymbolResolver,
  roles: NetRoles = classifyNets(document, resolver),
): ChainColumn[] {
  const ends = new Map<string, ChainEnd[]>();
  for (const device of document.instances) {
    if (isMarker(device)) continue;
    const pins =
      resolver.resolve(device.symbolId, device.symbolVariantId)?.definition
        .pins ?? [];
    const channel = channelPins(device.symbolId);
    const names = channel
      ? [channel.drain, channel.source]
      : pins.length === 2 && !CAPACITORS.has(device.symbolId)
        ? pins.map((pin) => pin.name)
        : [];
    for (const name of names) {
      const net = roles.pinNet(device.id, name);
      if (!net || isRailNet(roles, net)) continue;
      const end = { id: device.id, pin: name, transistor: !!channel };
      const found = ends.get(net);
      if (found) found.push(end);
      else ends.set(net, [end]);
    }
  }
  const columns: ChainColumn[] = [];
  for (const [net, all] of ends) {
    // A Net may list a terminal twice; one device carrying both ends is no column.
    const distinct = [
      ...new Map(all.map((end) => [`${end.id}\u0000${end.pin}`, end])).values(),
    ];
    if (distinct.length !== 2 || distinct[0]!.id === distinct[1]!.id) continue;
    const terminals =
      document.nets.find((candidate) => candidate.id === net)?.terminals ?? [];
    const taps = terminals.filter(
      (terminal) =>
        !distinct.some(
          (end) => end.id === terminal.instanceId && end.pin === terminal.pinName,
        ) &&
        !isMosBulk(
          document.instances.find(
            (instance) => instance.id === terminal.instanceId,
          )?.symbolId ?? "",
          terminal.pinName,
        ),
    ).length;
    if (!taps) continue;
    // As R166 requires of a stack: one transistor end at least, or the pair is
    // two passive parts between two Nets rather than one branch current.
    if (!distinct.some((end) => end.transistor)) continue;
    columns.push({ net, a: distinct[0]!, b: distinct[1]!, taps });
  }
  return columns;
}

interface Pose {
  x: number;
  y: number;
  exit: { x: number; y: number };
}

/** Page pose of every pin, for the collinearity test only. */
function pinPoses(
  document: SchematicDocument,
  resolver: SymbolResolver,
): Map<string, Pose> {
  const instances = new Map(
    document.instances.map((instance) => [instance.id, instance]),
  );
  const poses = new Map<string, Pose>();
  for (const point of pinPoints(document, resolver)) {
    const instance = instances.get(point.instanceId);
    const placement = instance?.placement;
    if (!instance || !placement) continue;
    const pin = (
      resolver.resolve(instance.symbolId, instance.symbolVariantId)?.definition
        .pins ?? []
    ).find((candidate) => candidate.name === point.pinName);
    if (!pin) continue;
    poses.set(`${point.instanceId}\u0000${point.pinName}`, {
      x: point.point.x,
      y: point.point.y,
      exit: pinExit(pin, placement),
    });
  }
  return poses;
}

/**
 * The CHAIN columns of one drawing that are drawn as a column: the two pins
 * leave along the same axis, are collinear across it, and no other device body
 * stands between them. Mirrors the pre-tests' `alignScore` `chain` bucket
 * (which reported 445/646 held on main and named the 123 broken objects).
 */
export function heldChainColumns(
  document: SchematicDocument,
  resolver: SymbolResolver,
): string[] {
  return planningMemo(document, resolver, "chain-columns-held", () => {
    const columns = chainColumns(document, resolver);
    if (!columns.length) return [];
    const poses = pinPoses(document, resolver);
    const boxes = new Map(
      visibleInstanceBounds(document, resolver).map((b) => [b.id, b.bounds]),
    );
    const devices = document.instances
      .filter((instance) => !isMarker(instance))
      .map((instance) => {
        const box = boxes.get(instance.id);
        return box
          ? {
              id: instance.id,
              x: box.x + box.width / 2,
              y: box.y + box.height / 2,
              w: box.width,
              h: box.height,
            }
          : undefined;
      })
      .filter((box): box is NonNullable<typeof box> => box !== undefined);
    const bodyBetween = (first: string, second: string) => {
      const a = boxes.get(first);
      const b = boxes.get(second);
      if (!a || !b) return false;
      const horizontal =
        Math.abs(a.y + a.height / 2 - (b.y + b.height / 2)) <=
        Math.min(a.height, b.height) / 2;
      return devices.some((device) => {
        if (device.id === first || device.id === second) return false;
        return horizontal
          ? Math.abs(device.y - (a.y + a.height / 2)) <=
              Math.min(a.height, device.h) / 2 &&
              (device.x - (a.x + a.width / 2)) *
                (device.x - (b.x + b.width / 2)) <
                0
          : Math.abs(device.x - (a.x + a.width / 2)) <=
              Math.min(a.width, device.w) / 2 &&
              (device.y - (a.y + a.height / 2)) *
                (device.y - (b.y + b.height / 2)) <
                0;
      });
    };
    return columns
      .filter((column) => {
        const a = poses.get(`${column.a.id}\u0000${column.a.pin}`);
        const b = poses.get(`${column.b.id}\u0000${column.b.pin}`);
        if (!a || !b) return false;
        const vertical = !a.exit.x && !b.exit.x && Math.abs(a.x - b.x) <= TOL;
        const horizontal = !a.exit.y && !b.exit.y && Math.abs(a.y - b.y) <= TOL;
        return (vertical || horizontal) && !bodyBetween(column.a.id, column.b.id);
      })
      .map((column) => column.net);
  });
}

/**
 * T143: how many of the drawing's CHAIN columns are drawn as a column. The
 * selection charges a plan for the columns it does *not* hold, so this is the
 * quantity that must grow: a count of held columns, never of broken ones
 * relative to another plan, or the cheaper plan with fewer Nets would win.
 */
export function chainColumnCount(
  document: SchematicDocument,
  resolver: SymbolResolver,
): number {
  return planningMemo(
    document,
    resolver,
    "chain-column-count",
    () => heldChainColumns(document, resolver).length,
  );
}
