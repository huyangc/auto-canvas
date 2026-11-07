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

/** R25: reserve touched hosts first; pair remaining markers in id order. */
export function assignPowerHosts(
  markers: TerminalRef[],
  hosts: PinPoint[],
  devicePoints: PinPoint[],
  contacts: PinContact[],
): Array<PinPoint | undefined> {
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
  const unused = hosts.filter((h) => !assigned.some((p) => p && samePin(p, h)));
  return assigned.map((host) => host ?? unused.shift() ?? hosts.at(-1));
}
