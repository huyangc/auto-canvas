import type { Instance, SchematicDocument } from "@icm/model";
import type { SymbolResolver } from "@icm/symbols";
import { isMos, type NetRoles } from "./net-roles.js";
import { compareIds } from "./recognize.js";
import {
  CELL_PIN_OFFSET,
  CELL_PIN_SPACING,
  enclosingBox,
  geometryProblem,
  MARKER_OFFSET,
  pinPoints,
  placement,
  withPlacements,
} from "./geometry.js";
import { devicePins, isMarker } from "./placement-connectivity.js";
import {
  type CellSide,
  type LayoutChoices,
  type LayoutOverrides,
} from "./layout-choices.js";
import { assignPowerHosts, touchingPins } from "./pin-contacts.js";
import type { Placement } from "./types.js";

type PinPoint = ReturnType<typeof pinPoints>[number];

export function powerHosts(
  pins: PinPoint[],
  devices: Instance[],
  resolver: SymbolResolver,
  ground: boolean,
): PinPoint[] {
  return devices
    .flatMap((i) => {
      const candidates = pins.filter(
        (p) =>
          p.instanceId === i.id &&
          (isMos(i.symbolId)
            ? ["D", "S"].includes(p.pinName)
            : devicePins(i, resolver).length === 2),
      );
      candidates.sort(
        (a, b) =>
          (ground ? b.point.y - a.point.y : a.point.y - b.point.y) ||
          a.point.x - b.point.x ||
          compareIds(a.pinName, b.pinName),
      );
      return candidates.slice(0, 1);
    })
    .sort(
      (a, b) => compareIds(a.instanceId, b.instanceId) || a.point.x - b.point.x,
    );
}

function placePowerMarkers(
  document: SchematicDocument,
  markers: Instance[],
  devices: Instance[],
  pins: PinPoint[],
  resolver: SymbolResolver,
  roles: NetRoles,
  targets: Map<string, Placement>,
) {
  const grid = document.presentation.grid;
  const contacts = touchingPins(document, resolver);
  const assignments = new Map<string, PinPoint | undefined>();
  for (const symbol of ["ground", "vdd-port"]) {
    const nets = new Set(
      markers
        .filter((i) => i.symbolId === symbol)
        .map((i) => roles.pinNet(i.id, symbol === "ground" ? "0" : "P")),
    );
    for (const net of nets) {
      const members = markers.filter(
        (i) =>
          i.symbolId === symbol &&
          roles.pinNet(i.id, symbol === "ground" ? "0" : "P") === net,
      );
      const connected = pins.filter(
        (p) =>
          net !== undefined && roles.pinNet(p.instanceId, p.pinName) === net,
      );
      const hosts = assignPowerHosts(
        members.map((i) => ({
          instanceId: i.id,
          pinName: symbol === "ground" ? "0" : "P",
        })),
        powerHosts(connected, devices, resolver, symbol === "ground"),
        connected,
        contacts,
      );
      members.forEach((i, index) => assignments.set(i.id, hosts[index]));
    }
  }
  const used = new Map<string, number>();
  const placed: Instance[] = [];
  for (const i of markers) {
    const ground = i.symbolId === "ground";
    const assigned = assignments.get(i.id);
    const key = assigned
      ? `${assigned.instanceId}:${assigned.pinName}`
      : i.symbolId;
    const index = used.get(key) ?? 0;
    used.set(key, index + 1);
    const host = assigned?.point ?? { x: 0, y: 0 };
    const local = devicePins(i, resolver)[0]?.at ?? { x: 0, y: 0 };
    targets.set(
      i.id,
      placement(
        host.x - local.x + index * grid,
        host.y + (ground ? MARKER_OFFSET : -MARKER_OFFSET) - local.y,
      ),
    );
    if (index > 0 || !assigned)
      for (let attempt = 0; attempt < 200; attempt++) {
        const candidate = withPlacements(
          { ...document, instances: [...devices, ...placed, i] },
          targets,
        );
        if (!geometryProblem(candidate, resolver)) break;
        targets.get(i.id)!.position.x += grid;
      }
    placed.push(i);
  }
}

function placeCellPins(
  document: SchematicDocument,
  deviceDocument: SchematicDocument,
  pins: PinPoint[],
  resolver: SymbolResolver,
  roles: NetRoles,
  targets: Map<string, Placement>,
  overrides: LayoutOverrides,
  choices: LayoutChoices,
) {
  const grid = document.presentation.grid;
  const placed = new Set<string>();
  const snap = (n: number) => Math.round(n / grid) * grid;
  const box = enclosingBox(deviceDocument, resolver);
  const entries = document.instances
    .filter((i) => ["port", "port-filled"].includes(i.symbolId))
    .map((i) => {
      const net = roles.pinNet(i.id, "P");
      const role = roles.byNet.get(net ?? "") ?? "internal";
      let side =
        role === "supply"
          ? "top"
          : role === "ground"
            ? "bottom"
            : role === "output"
              ? "right"
              : "left";
      const connected = pins.filter(
        (p) =>
          net !== undefined && roles.pinNet(p.instanceId, p.pinName) === net,
      );
      const priority = (p: PinPoint) => {
        if (p.pinName === (role === "output" ? "D" : "G")) return 0;
        const instance = deviceDocument.instances.find(
          (j) => j.id === p.instanceId,
        )!;
        const pin = devicePins(instance, resolver).find(
          (pin) => pin.name === p.pinName,
        )!;
        return pin.role.includes(role === "output" ? "output" : "input")
          ? 1
          : 2;
      };
      connected.sort(
        (a, b) =>
          priority(a) - priority(b) ||
          compareIds(a.instanceId, b.instanceId) ||
          compareIds(a.pinName, b.pinName),
      );
      const host = connected[0]?.point ?? {
        x: box.x + box.width / 2,
        y: box.y + box.height / 2,
      };
      if (side === "left" || side === "right") {
        const centre = box.x + box.width / 2;
        side =
          host.x < centre
            ? "left"
            : host.x > centre
              ? "right"
              : role === "output"
                ? "right"
                : "left";
        side = overrides.sides.get(i.id) ?? side;
        choices.sides.set(i.id, side as CellSide);
      }
      const vertical = side === "left" || side === "right";
      return {
        i,
        side,
        vertical,
        net,
        count: connected.length,
        coordinate: snap(vertical ? host.y : host.x),
      };
    });
  for (const side of ["left", "right", "top", "bottom"]) {
    const members = entries.filter((e) => e.side === side);
    // Move the more flexible Net, keeping less connected hosts level.
    const settled: typeof entries = [];
    for (const entry of members.sort(
      (a, b) => a.count - b.count || compareIds(a.i.id, b.i.id),
    )) {
      const conflict = settled.find(
        (other) =>
          Math.abs(other.coordinate - entry.coordinate) < CELL_PIN_SPACING,
      );
      const direction =
        conflict && entry.coordinate < conflict.coordinate ? -1 : 1;
      for (
        let attempt = 0;
        attempt < 200 &&
        settled.some(
          (other) =>
            Math.abs(other.coordinate - entry.coordinate) < CELL_PIN_SPACING,
        );
        attempt++
      )
        entry.coordinate += direction * grid;
      settled.push(entry);
    }
    for (const entry of members.sort(
      (a, b) => a.coordinate - b.coordinate || compareIds(a.i.id, b.i.id),
    )) {
      const railPins = members
        .filter((other) => other.net === entry.net)
        .sort((a, b) => compareIds(a.i.id, b.i.id));
      const rank = railPins.indexOf(entry);
      const along = entry.vertical
        ? entry.coordinate
        : snap(
            box.x -
              CELL_PIN_OFFSET -
              (railPins.length - 1 - rank) * CELL_PIN_SPACING,
          );
      // R62: duplicate rail Cell Pins must not sit on the same trunk level.
      // The first pin in routing order stays nearest the devices; later pins
      // step outward so their artwork cannot block that pin's horizontal trunk.
      const outward = entry.vertical ? 0 : rank * CELL_PIN_SPACING;
      const x = entry.vertical
        ? snap(
            side === "right"
              ? box.x + box.width + CELL_PIN_OFFSET
              : box.x - CELL_PIN_OFFSET,
          )
        : along;
      const y = entry.vertical
        ? along
        : snap(
            side === "top"
              ? box.y - CELL_PIN_OFFSET - outward
              : box.y + box.height + CELL_PIN_OFFSET + outward,
          );
      targets.set(
        entry.i.id,
        placement(
          x,
          y,
          side === "right" ? "horizontal" : "none",
          side === "top" ? 90 : side === "bottom" ? 270 : 0,
        ),
      );
      // Grid nudges preserve the side ordering and the minimum label spacing.
      for (let attempt = 0; attempt < 200; attempt++) {
        const prior = document.instances.filter(
          (i) =>
            i.id === entry.i.id ||
            !isMarker(i) ||
            i.symbolId === "ground" ||
            i.symbolId === "vdd-port" ||
            placed.has(i.id),
        );
        if (
          !prior.some(
            (other) =>
              other.id !== entry.i.id &&
              geometryProblem(
                withPlacements(
                  { ...document, instances: [other, entry.i] },
                  targets,
                ),
                resolver,
              ),
          )
        )
          break;
        const p = targets.get(entry.i.id)!;
        if (entry.vertical) p.position.y += grid;
        else p.position.x += grid;
      }
      placed.add(entry.i.id);
    }
  }
}

export function placeMarkers(
  document: SchematicDocument,
  resolver: SymbolResolver,
  roles: NetRoles,
  targets: Map<string, Placement>,
  overrides: LayoutOverrides,
  choices: LayoutChoices,
): void {
  const devices = document.instances
    .filter((i) => !isMarker(i))
    .sort((a, b) => compareIds(a.id, b.id));
  const deviceDocument = withPlacements(
    { ...document, instances: devices },
    targets,
  );
  const pins = pinPoints(deviceDocument, resolver);
  const power = document.instances
    .filter((i) => ["ground", "vdd-port"].includes(i.symbolId))
    .sort((a, b) => compareIds(a.id, b.id));
  placePowerMarkers(document, power, devices, pins, resolver, roles, targets);
  placeCellPins(
    document,
    deviceDocument,
    pins,
    resolver,
    roles,
    targets,
    overrides,
    choices,
  );
}
