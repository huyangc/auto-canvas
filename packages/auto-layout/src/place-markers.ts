import { visibleSymbolInkBounds } from "@icm/derived";
import { deviceDescriptor } from "@icm/devices";
import type { Instance, SchematicDocument } from "@icm/model";
import type { SymbolResolver } from "@icm/symbols";
import { classifyNets, isMos, type NetRoles } from "./net-roles.js";
import { compareIds } from "./recognize.js";
import {
  CELL_PIN_OFFSET,
  CELL_PIN_SPACING,
  enclosingBox,
  geometryProblem,
  MARKER_OFFSET,
  pinPoints,
  pinExit,
  placement,
  transformPoint,
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
  edgeOnly: ReadonlySet<string> = new Set(),
  frozen: ReadonlySet<string> = new Set(),
) {
  const grid = document.presentation.grid;
  const placed = new Set(frozen);
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
        singleHost:
          !roles.rails.has(net ?? "") && connected.length === 1
            ? connected[0]
            : undefined,
        coordinate: snap(vertical ? host.y : host.x),
      };
    });
  // R71: reserve safe single-host seats first; blocked seats use R19/R20.
  for (const entry of [...entries].sort((a, b) => compareIds(a.i.id, b.i.id))) {
    const host = entry.singleHost;
    if (!host || edgeOnly.has(entry.i.id) || frozen.has(entry.i.id)) continue;
    const instance = deviceDocument.instances.find(
      (i) => i.id === host.instanceId,
    )!;
    const pin = devicePins(instance, resolver).find(
      (p) => p.name === host.pinName,
    )!;
    const exit = pinExit(pin, targets.get(instance.id)!);
    const p = placement(
      snap(host.point.x + exit.x * CELL_PIN_OFFSET),
      snap(host.point.y + exit.y * CELL_PIN_OFFSET),
      exit.x > 0 ? "horizontal" : "none",
      exit.y < 0 ? 90 : exit.y > 0 ? 270 : 0,
    );
    targets.set(entry.i.id, p);
    const occupied = document.instances.filter(
      (i) =>
        i.id === entry.i.id ||
        !isMarker(i) ||
        i.symbolId === "ground" ||
        i.symbolId === "vdd-port" ||
        placed.has(i.id),
    );
    if (
      !geometryProblem(
        withPlacements({ ...document, instances: occupied }, targets),
        resolver,
      )
    ) {
      placed.add(entry.i.id);
      choices.sides.delete(entry.i.id);
    } else targets.delete(entry.i.id);
  }
  for (const side of ["left", "right", "top", "bottom"]) {
    const members = entries.filter(
      (e) => e.side === side && !placed.has(e.i.id),
    );
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
  fixed: ReadonlySet<string> = new Set(),
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
  // Fixed markers keep their seats, so R71 and R20 must treat them as occupied:
  // restore fixed power markers and ports before any port seat is checked.
  for (const i of document.instances)
    if (fixed.has(i.id) && i.placement && isMarker(i))
      targets.set(i.id, structuredClone(i.placement));
  const fixedPorts = new Set(
    document.instances
      .filter(
        (i) =>
          fixed.has(i.id) &&
          i.placement &&
          ["port", "port-filled"].includes(i.symbolId),
      )
      .map((i) => i.id),
  );
  placeCellPins(
    document,
    deviceDocument,
    pins,
    resolver,
    roles,
    targets,
    overrides,
    choices,
    new Set(),
    fixedPorts,
  );
}

/** R72: reseat only reported, movable blockers, preserving every device exactly. */
export function nextMarkerPlacements(
  document: SchematicDocument,
  resolver: SymbolResolver,
  blockers: ReadonlySet<string>,
  fixed: ReadonlySet<string>,
): Map<string, Placement> | undefined {
  const targets = new Map(
    document.instances.map((i) => [i.id, structuredClone(i.placement!)]),
  );
  const roles = classifyNets(document, resolver);
  const devices = document.instances.filter(
    (i) =>
      !isMarker(i) &&
      deviceDescriptor(i.symbolId)?.deviceClass !== "net-marker",
  );
  const deviceDocument = { ...document, instances: devices };
  const pins = pinPoints(deviceDocument, resolver);
  const ports = new Set(
    document.instances
      .filter(
        (i) =>
          blockers.has(i.id) &&
          !fixed.has(i.id) &&
          ["port", "port-filled"].includes(i.symbolId),
      )
      .map((i) => i.id),
  );
  // Reuse R19/R20 and spacing against all stationary ports. R71 is disabled
  // only for blockers; the other local and edge seats stay exactly where they are.
  placeCellPins(
    document,
    deviceDocument,
    pins,
    resolver,
    roles,
    targets,
    { sides: new Map(), orientations: new Map() },
    { sides: new Map(), orientations: new Map() },
    ports,
    new Set(
      document.instances.filter((i) => !ports.has(i.id)).map((i) => i.id),
    ),
  );
  const branchPins = pinPoints(document, resolver);
  // R43 rail rows are derived from geometry, never diagnostic coordinates.
  // A marker can clear every pin column and still touch a horizontal trunk;
  // advance past that span before asking the unchanged router to replan.
  const portsOnRail = new Set(
    document.instances
      .filter((i) => ["port", "port-filled"].includes(i.symbolId))
      .map((i) => i.id),
  );
  const rows = pins.map((p) => p.point.y);
  const centres = devices.map((i) => i.placement!.position.y);
  const rails = [...roles.rails].flatMap(([net, role]) => {
    const members = branchPins.filter(
      (p) =>
        roles.pinNet(p.instanceId, p.pinName) === net &&
        deviceDescriptor(
          document.instances.find((i) => i.id === p.instanceId)!.symbolId,
        )?.deviceClass !== "net-marker",
    );
    if (members.length < 2 || !rows.length) return [];
    const ground = role === "ground";
    const level = members[0]!.point.y;
    const outside = ground
      ? level > Math.max(...centres)
      : level < Math.min(...centres);
    const y =
      outside && members.every((p) => p.point.y === level)
        ? level
        : ground
          ? Math.max(...rows) + MARKER_OFFSET / 2
          : Math.min(...rows) - MARKER_OFFSET / 2;
    const levels = new Set([
      y,
      ...members
        .filter((p) => portsOnRail.has(p.instanceId))
        .map((p) => p.point.y),
    ]);
    const xs = members.map((p) => p.point.x);
    return [...levels].map((y) => ({
      y,
      left: Math.min(...xs),
      right: Math.max(...xs),
    }));
  });
  let moved = false;
  for (const i of [...document.instances].sort((a, b) =>
    compareIds(a.id, b.id),
  )) {
    if (!blockers.has(i.id) || fixed.has(i.id)) continue;
    const port = ports.has(i.id);
    if (!port && deviceDescriptor(i.symbolId)?.deviceClass !== "net-marker")
      continue;
    const old = i.placement!;
    const connected = pins.filter(
      (p) => roles.pinNet(p.instanceId, p.pinName) === roles.pinNet(i.id, "P"),
    );
    const host =
      connected.length === 1 && !roles.rails.has(roles.pinNet(i.id, "P") ?? "")
        ? connected[0]
        : undefined;
    const hostInstance = host && devices.find((i) => i.id === host.instanceId);
    const hostPin =
      hostInstance &&
      devicePins(hostInstance, resolver).find((p) => p.name === host!.pinName);
    const exit = hostPin && pinExit(hostPin, hostInstance!.placement!);
    const snap = (n: number) =>
      Math.round(n / document.presentation.grid) * document.presentation.grid;
    const local =
      port &&
      host &&
      exit &&
      old.position.x === snap(host.point.x + exit.x * CELL_PIN_OFFSET) &&
      old.position.y === snap(host.point.y + exit.y * CELL_PIN_OFFSET);
    if (port && !local) targets.set(i.id, structuredClone(old));
    const target = targets.get(i.id)!;
    const axis =
      port && (target.rotation === 0 || target.rotation === 180) ? "y" : "x";
    // A local port first falls back to its R20 seat. An edge port and a power
    // marker advance to the next slot along the existing edge/rail, by id.
    const origin = target.position[axis];
    const step = port ? CELL_PIN_SPACING : document.presentation.grid;
    let free = false;
    for (let attempt = local ? 0 : 1; attempt < 400; attempt++) {
      // Nearest free slot in either direction; id order and positive ties are
      // stable. Moving across an entire trunk is unnecessary at its near end.
      const distance = Math.ceil(attempt / 2) * step;
      target.position[axis] = origin + (attempt % 2 ? distance : -distance);
      const candidate = withPlacements(document, targets);
      const resolved = resolver.resolve(i.symbolId, i.symbolVariantId);
      if (!resolved) break;
      const ink = visibleSymbolInkBounds(resolved, i.signalFlowParameters);
      const corners = [
        { x: ink.x, y: ink.y },
        { x: ink.x + ink.width, y: ink.y + ink.height },
      ].map((p) => transformPoint(p, target.position, target));
      const low = Math.min(...corners.map((p) => p[axis]));
      const high = Math.max(...corners.map((p) => p[axis]));
      // Avoid pin branch columns/rows without interpreting coordinates or Net
      // names in diagnostic prose. Existing routes remain subject to full replay.
      const branch = branchPins.some(
        (p) =>
          p.instanceId !== i.id &&
          p.point[axis] >= low &&
          p.point[axis] <= high,
      );
      const left = Math.min(...corners.map((p) => p.x)),
        right = Math.max(...corners.map((p) => p.x));
      const top = Math.min(...corners.map((p) => p.y)),
        bottom = Math.max(...corners.map((p) => p.y));
      const trunk = rails.some(
        (rail) =>
          top <= rail.y &&
          rail.y <= bottom &&
          left <= rail.right &&
          rail.left <= right,
      );
      if (!branch && !trunk && !geometryProblem(candidate, resolver)) {
        free = true;
        break;
      }
    }
    if (!free) return undefined;
    moved = true;
  }
  return moved ? targets : undefined;
}
