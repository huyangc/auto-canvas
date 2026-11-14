import { visibleInstanceBounds } from "@icm/derived";
import type { Point, SchematicDocument } from "@icm/model";
import type { SymbolResolver } from "@icm/symbols";
import { conductingPins } from "./dc-connectivity.js";
import {
  geometryProblem,
  pinExit,
  pinPoints,
  placementPitch,
  transformPoint,
  withPlacements,
} from "./geometry.js";
import { isMosBulk, type NetRoles } from "./net-roles.js";
import { devicePins, isMarker } from "./placement-connectivity.js";
import { compareIds } from "./recognize.js";
import { findStages } from "./stages.js";
import type { Placement } from "./types.js";

/** Recognize leaves at one node, or two-terminal bridges across one host.
 * External-only pins do not introduce a second internal host node. */
export function nodeAttachments(
  document: SchematicDocument,
  resolver: SymbolResolver,
  roles: NetRoles,
) {
  const devices = document.instances
    .filter((i) => !isMarker(i))
    .sort((a, b) => compareIds(a.id, b.id));
  const pins = (i: (typeof devices)[number]) =>
    devicePins(i, resolver).filter((p) => !isMosBulk(i.symbolId, p.name));
  const signals = (i: (typeof devices)[number]) =>
    pins(i).filter((p) => {
      const net = roles.pinNet(i.id, p.name);
      return net && !roles.rails.has(net);
    });
  const single = new Set(
    findStages(devices, resolver, roles, [])
      .stages.filter((s) => s.devices.length === 1)
      .map((s) => s.devices[0]!.id),
  );
  return devices.flatMap((device) => {
    const own = pins(device);
    if (own.length !== 2 && !single.has(device.id)) return [];
    const connected = signals(device).filter((pin) =>
      devices.some(
        (host) =>
          host !== device &&
          pins(host).some(
            (p) =>
              roles.pinNet(host.id, p.name) ===
              roles.pinNet(device.id, pin.name),
          ),
      ),
    );
    const nets = new Set(
      connected.map((p) => roles.pinNet(device.id, p.name)!),
    );
    if (!nets.size || nets.size > 2 || (nets.size === 2 && own.length !== 2))
      return [];
    const hosts = devices.flatMap((host) => {
      if (host === device) return [];
      // Rail shunts cannot host one another. A bridge requires a host with
      // more than two terminals, rather than another parallel passive.
      if (
        nets.size === 2
          ? pins(host).length <= 2
          : new Set(signals(host).map((p) => roles.pinNet(host.id, p.name)))
              .size <= 1
      )
        return [];
      const connections = [...nets].flatMap((net) => {
        const hostPins = pins(host).filter(
          (p) => roles.pinNet(host.id, p.name) === net,
        );
        hostPins.sort(
          (a, b) =>
            Number(conductingPins(host, resolver).includes(b)) -
              Number(conductingPins(host, resolver).includes(a)) ||
            compareIds(a.name, b.name),
        );
        const hostPin = hostPins[0];
        const pin = connected.find(
          (p) => roles.pinNet(device.id, p.name) === net,
        )!;
        return hostPin ? [{ pin, hostPin }] : [];
      });
      return connections.length === nets.size ? [{ host, connections }] : [];
    });
    hosts.sort(
      (a, b) =>
        Number(
          conductingPins(b.host, resolver).includes(b.connections[0]!.hostPin),
        ) -
          Number(
            conductingPins(a.host, resolver).includes(
              a.connections[0]!.hostPin,
            ),
          ) || compareIds(a.host.id, b.host.id),
    );
    return hosts[0] ? [{ device, ...hosts[0] }] : [];
  });
}

/** Try the nearest clear grid seat on the pin's outward ray. No valid local
 * seat means no move; protected units and the host keep their placements. */
export function seatNodeAttachments(
  document: SchematicDocument,
  resolver: SymbolResolver,
  roles: NetRoles,
  targets: Map<string, Placement>,
  protectedIds: ReadonlySet<string>,
  collisionDocument: SchematicDocument = document,
): void {
  const grid = document.presentation.grid;
  const snap = (n: number) => Math.round(n / grid) * grid;
  const clearance = Math.max(grid, 20);
  for (const { device, host, connections } of nodeAttachments(
    document,
    resolver,
    roles,
  )) {
    if (protectedIds.has(device.id) || !targets.has(device.id)) continue;
    const hp = targets.get(host.id);
    if (!hp) continue;
    // Only the trial part changes. Reuse every other body's bounds and pin
    // coordinates across seats, retaining the same whole-document guards.
    const others = withPlacements(
      {
        ...collisionDocument,
        instances: collisionDocument.instances.filter(
          (i) => i.id !== device.id,
        ),
      },
      targets,
    );
    if (geometryProblem(others, resolver)) continue;
    const obstacleBounds = visibleInstanceBounds(others, resolver);
    const occupied = new Set(
      pinPoints(others, resolver).map(({ point }) => `${point.x},${point.y}`),
    );
    const hostBounds = visibleInstanceBounds(
      { ...document, instances: [{ ...host, placement: hp }] },
      resolver,
    )[0]!.bounds;
    const points = connections.map(({ hostPin }) =>
      transformPoint(hostPin.at, hp.position, hp),
    );
    const centre = {
      x: points.reduce((sum, p) => sum + p.x, 0) / points.length,
      y: points.reduce((sum, p) => sum + p.y, 0) / points.length,
    };
    let exit = pinExit(connections[0]!.hostPin, hp);
    if (points.length === 2) {
      const control = devicePins(host, resolver).find((p) =>
        ["gate", "base", "control", "input"].some((r) => p.role.includes(r)),
      );
      const outward = control && pinExit(control, hp);
      const vertical =
        Math.abs(points[0]!.y - points[1]!.y) >=
        Math.abs(points[0]!.x - points[1]!.x);
      exit = vertical
        ? { x: outward?.x ? -outward.x : 1, y: 0 }
        : { x: 0, y: outward?.y ? -outward.y : 1 };
    }
    const rails = devicePins(device, resolver).flatMap((pin) => {
      const rail = roles.rails.get(roles.pinNet(device.id, pin.name) ?? "");
      return rail ? [{ pin, y: rail === "supply" ? -1 : 1 }] : [];
    });
    const variants: { at: Placement; distance: number; alignment: number }[] =
      [];
    for (const rotation of [0, 90, 180, 270] as const)
      for (const mirror of [
        "none",
        "horizontal",
        "vertical",
        "both",
      ] as const) {
        const at: Placement = { position: { x: 0, y: 0 }, rotation, mirror };
        if (rails.some(({ pin, y }) => pinExit(pin, at).y !== y)) continue;
        const local = connections.map(({ pin }) =>
          transformPoint(pin.at, at.position, at),
        );
        let alignment = 0;
        if (points.length === 2) {
          const a = local[0]!,
            b = local[1]!;
          const p = points[0]!,
            q = points[1]!;
          // Match the ordered host span; never reverse electrical endpoints.
          if ((b.x - a.x) * (q.x - p.x) + (b.y - a.y) * (q.y - p.y) <= 0)
            continue;
          alignment =
            Math.abs(b.x - a.x - q.x + p.x) + Math.abs(b.y - a.y - q.y + p.y);
        } else {
          const facing = pinExit(connections[0]!.pin, at);
          if (!rails.length && (facing.x !== -exit.x || facing.y !== -exit.y))
            continue;
        }
        const mean: Point = {
          x: local.reduce((sum, p) => sum + p.x, 0) / local.length,
          y: local.reduce((sum, p) => sum + p.y, 0) / local.length,
        };
        const bounds = visibleInstanceBounds(
          { ...document, instances: [{ ...device, placement: at }] },
          resolver,
        )[0]!.bounds;
        const edge =
          points.length === 1
            ? centre
            : {
                x: exit.x > 0 ? hostBounds.x + hostBounds.width : hostBounds.x,
                y: exit.y > 0 ? hostBounds.y + hostBounds.height : hostBounds.y,
              };
        for (
          let gap = clearance;
          gap <= placementPitch(roles).column;
          gap += grid
        ) {
          const p: Placement = {
            ...at,
            position: {
              x: snap(
                exit.x
                  ? edge.x +
                      exit.x * gap -
                      (exit.x > 0 ? bounds.x : bounds.x + bounds.width)
                  : centre.x - mean.x,
              ),
              y: snap(
                exit.y
                  ? edge.y +
                      exit.y * gap -
                      (exit.y > 0 ? bounds.y : bounds.y + bounds.height)
                  : centre.y - mean.y,
              ),
            },
          };
          variants.push({ at: p, distance: gap, alignment });
        }
      }
    variants.sort(
      (a, b) => a.alignment - b.alignment || a.distance - b.distance,
    );
    for (const { at } of variants) {
      const placed = {
        ...collisionDocument,
        instances: [{ ...device, placement: at }],
      };
      const own = visibleInstanceBounds(placed, resolver)[0]!.bounds;
      if (
        obstacleBounds.some(
          (b) =>
            own.x < b.bounds.x + b.bounds.width + grid &&
            b.bounds.x < own.x + own.width + grid &&
            own.y < b.bounds.y + b.bounds.height + grid &&
            b.bounds.y < own.y + own.height + grid,
        )
      )
        continue;
      const trialPins = pinPoints(placed, resolver).map(
        ({ point }) => `${point.x},${point.y}`,
      );
      if (
        new Set(trialPins).size !== trialPins.length ||
        trialPins.some((p) => occupied.has(p))
      )
        continue;
      targets.set(device.id, at);
      break;
    }
  }
}
