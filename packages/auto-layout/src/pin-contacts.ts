import type { SchematicDocument } from "@icm/model";
import type { SymbolResolver } from "@icm/symbols";
import { pinPoints } from "./geometry.js";
import { isMos } from "./net-roles.js";
import { compareIds } from "./recognize.js";

export interface TerminalRef {
  instanceId: string;
  pinName: string;
}
export type PinContact = [TerminalRef, TerminalRef];
type PinPoint = ReturnType<typeof pinPoints>[number];
export const samePin = (a: TerminalRef, b: TerminalRef) =>
  a.instanceId === b.instanceId && a.pinName === b.pinName;

/** Capture input contacts before transforms separate them. Bulk is implicit. */
export function touchingPins(
  document: SchematicDocument,
  resolver: SymbolResolver,
): PinContact[] {
  const instances = new Map(document.instances.map((i) => [i.id, i]));
  const points = pinPoints(document, resolver)
    .filter(
      (p) =>
        !(isMos(instances.get(p.instanceId)!.symbolId) && p.pinName === "B"),
    )
    .sort(
      (a, b) =>
        compareIds(a.instanceId, b.instanceId) ||
        compareIds(a.pinName, b.pinName),
    );
  return points.flatMap((a, index) =>
    points
      .slice(index + 1)
      .filter(
        (b) =>
          a.instanceId !== b.instanceId &&
          a.point.x === b.point.x &&
          a.point.y === b.point.y,
      )
      .map((b): PinContact => [
        { instanceId: a.instanceId, pinName: a.pinName },
        { instanceId: b.instanceId, pinName: b.pinName },
      ]),
  );
}

/** R25: reserve touched hosts first; pair remaining markers in id order.
 * R6a/T127: a marker that would otherwise share a channel host or have none
 * takes an unused extra host, each at most once. `extra` marks such a host:
 * it holds only if the marker reaches its seat. */
export function assignRailHosts(
  markers: TerminalRef[],
  hosts: PinPoint[],
  extras: PinPoint[],
  devicePoints: PinPoint[],
  contacts: PinContact[],
): Array<{ host: PinPoint; extra: boolean } | undefined> {
  const assigned = markers.map((marker) => {
    const contact = contacts.find(
      (pair) =>
        pair.some((p) => samePin(p, marker)) &&
        pair.some((p) => devicePoints.some((h) => samePin(h, p))),
    );
    return (
      contact && devicePoints.find((h) => contact.some((p) => samePin(h, p)))
    );
  });
  const free = (h: PinPoint) => !assigned.some((p) => p && samePin(p, h));
  const unused = hosts.filter(free);
  const spare = extras.filter(free);
  return assigned.map((host) => {
    const channel = host ?? unused.shift();
    if (channel) return { host: channel, extra: false };
    const extra = spare.shift();
    if (extra) return { host: extra, extra: true };
    const last = hosts.at(-1);
    return last && { host: last, extra: false };
  });
}
