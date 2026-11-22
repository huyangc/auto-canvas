import { selectCurrentSourceTail } from "./current-source-tail.js";
import {
  diagnoseLabelClearance,
  resolveRouteGeometry,
  visibleInstanceBounds,
} from "@icm/derived";
import { reflectOrientation, type SchematicDocument } from "@icm/model";
import type { SymbolResolver } from "@icm/symbols";
import { connectivityPlacementSeed } from "./connectivity-placement-seed.js";
import {
  differentialBranches,
  type DifferentialBranches,
} from "./differential-branches.js";
import {
  enclosingBox,
  markerOffset,
  pinExit,
  pinPoints,
  placement,
  placementPitch,
  transformPoint,
  withPlacements,
} from "./geometry.js";
import { emptyChoices, emptyOverrides } from "./layout-choices.js";
import { channelPins, classifyNets } from "./net-roles.js";
import { placeMarkers } from "./place-markers.js";
import { devicePins, isMarker } from "./placement-connectivity.js";
import { routedGuards } from "./routed-search-score.js";
import { auditRouting } from "./routing-audit.js";
import type { AutoLayoutResult, Placement } from "./types.js";

type Trial = StageTrial;
type Structure = StageStructure;
type Pair = [string, string];
type Seats = Map<string, Placement>;
export type StageTrial = {
  final: SchematicDocument;
  candidate: AutoLayoutResult;
};

/** Orient a component's mirrored pairs using the nets already traced from each input.
 * Shared controls and supplies give no evidence for either half. */
function stageStructure(
  source: SchematicDocument,
  doc: SchematicDocument,
  resolver: SymbolResolver,
  branches: DifferentialBranches,
) {
  const devices = source.instances.filter((i) => !isMarker(i));
  const { component } = branches;
  if (
    2 * component.pairs.length + component.axisDevices.length !==
    devices.length
  )
    return;
  const roles = classifyNets(source, resolver),
    byId = new Map(devices.map((i) => [i.id, i]));
  const pins = (id: string) => devicePins(byId.get(id)!, resolver);
  const channel = (id: string) => channelPins(byId.get(id)!.symbolId);
  const nets = (id: string) =>
    pins(id).flatMap((p) => {
      const n = roles.pinNet(id, p.name);
      return n && !roles.rails.has(n) ? [n] : [];
    });
  const privateNets = (id: string, mate: string) =>
    nets(id).filter((n) => !nets(mate).includes(n));
  const pairs: Pair[] = [...branches.members];
  const sides = [new Set<string>(), new Set<string>()] as const;
  const mark = ([a, b]: Pair) => {
    for (const n of privateNets(a, b)) sides[0].add(n);
    for (const n of privateNets(b, a)) sides[1].add(n);
  };
  pairs.forEach(mark);
  let pending = component.pairs.filter(
    ([a]) => !pairs.some((p) => p.includes(a)),
  );
  while (pending.length) {
    const remaining: Pair[] = [];
    for (const [a, b] of pending) {
      const left = privateNets(a, b),
        right = privateNets(b, a);
      const forward =
        left.some((n) => sides[0].has(n)) || right.some((n) => sides[1].has(n));
      const backward =
        left.some((n) => sides[1].has(n)) || right.some((n) => sides[0].has(n));
      if (forward === backward) {
        remaining.push([a, b]);
        continue;
      }
      const ordered: Pair = forward ? [a, b] : [b, a];
      pairs.push(ordered);
      mark(ordered);
    }
    if (remaining.length === pending.length) return;
    pending = remaining;
  }
  // A cross-coupled private signal cannot stay wholly on both sides of an axis.
  if ([...sides[0]].some((n) => sides[1].has(n))) return;
  // Only one opposed contact pair on a branched signal net can define a
  // straight vertical stack. Same-facing pins in a folded stage need separate
  // columns. Use the closest eligible hosts on the incumbent drawing.
  const position = new Map(doc.instances.map((i) => [i.id, i.placement!]));
  const banks = new Map<
    string,
    { index: number; x: number; y: number; dy: number }[]
  >();
  for (const [index, [id, mate]] of pairs.entries()) {
    const ch = channel(id),
      seat = position.get(id)!;
    for (const p of pins(id)) {
      const net = roles.pinNet(id, p.name);
      if (
        !net ||
        !privateNets(id, mate).includes(net) ||
        (ch && p.name !== ch.drain && p.name !== ch.source)
      )
        continue;
      const point = transformPoint(p.at, seat.position, seat),
        dy = pinExit(p, seat).y;
      const bank = banks.get(net) ?? [];
      bank.push({ index, ...point, dy });
      banks.set(net, bank);
    }
  }
  const column = pairs.map((_, i) => i);
  for (const bank of banks.values()) {
    const choices = bank.flatMap((upper) =>
      bank
        .filter(
          (lower) =>
            upper.dy > 0 &&
            lower.dy < 0 &&
            upper.y <= lower.y &&
            upper.index !== lower.index,
        )
        .map((lower) => ({
          a: upper.index,
          b: lower.index,
          distance: Math.abs(upper.x - lower.x),
        })),
    );
    const link = choices.sort((a, b) => a.distance - b.distance)[0];
    if (link) {
      const left = column[link.a]!,
        right = column[link.b]!;
      for (let i = 0; i < column.length; i++)
        if (column[i] === right) column[i] = left;
    }
  }
  const columns = [...new Set(column)];
  return {
    branches,
    pairs,
    sides,
    devices,
    roles,
    pins,
    channel,
    axisDevices: component.axisDevices,
    lanes: column.map((c) => columns.indexOf(c)),
    laneCount: columns.length,
  };
}
export type StageStructure = NonNullable<ReturnType<typeof stageStructure>>;

function completeDrawing(
  doc: SchematicDocument,
  resolver: SymbolResolver,
  s: Structure,
) {
  const bounds = visibleInstanceBounds(doc, resolver);
  const boxes = new Map(bounds.map((b) => [b.id, b.bounds]));
  if (s.devices.some((i) => !boxes.has(i.id))) return false;
  const centres = new Map(
    bounds.map(({ id, bounds: b }) => [
      id,
      { x: b.x + b.width / 2, y: b.y + b.height / 2 },
    ]),
  );
  const [a, b] = s.pairs[0]!,
    axis = (centres.get(a)!.x + centres.get(b)!.x) / 2;
  const sign = Math.sign(centres.get(a)!.x - axis);
  for (const pair of s.pairs)
    for (const side of [0, 1] as const) {
      const box = boxes.get(pair[side])!;
      if ((side ? -sign : sign) < 0 ? box.x + box.width >= axis : box.x <= axis)
        return false;
    }
  const pins = pinPoints(doc, resolver);
  const ports = new Map(
    pins.filter((p) => p.pinName === "P").map((p) => [p.instanceId, p.point]),
  );
  const pairs = [
    ...s.pairs.map((pair) => pair.map((id) => centres.get(id)!)),
    ...[s.branches.inputs, s.branches.outputs].map((pair) =>
      pair.map((id) => ports.get(id)!),
    ),
  ];
  if (
    !sign ||
    pairs.some(
      ([l, r]) =>
        !l ||
        !r ||
        (l.x - axis) * sign <= 0 ||
        Math.abs(l.x + r.x - 2 * axis) > 1e-6 ||
        Math.abs(l.y - r.y) > 1e-6,
    )
  )
    return false;
  const top = Math.min(...s.devices.map((i) => boxes.get(i.id)!.y));
  for (const side of [0, 1] as const) {
    const id = s.branches.outputs[side],
      net = s.roles.pinNet(id, "P"),
      at = ports.get(id)!;
    const inst = doc.instances.find((i) => i.id === id)!;
    const portPin = devicePins(inst, resolver).find((p) => p.name === "P");
    if (at.y >= top || !portPin || pinExit(portPin, inst.placement!).y !== 1)
      return false;
    let down = false;
    for (const route of doc.routes) {
      if (!s.sides[side].has(route.netId)) continue;
      const line = resolveRouteGeometry(doc, resolver, route);
      if (
        !line ||
        line.centerline.some((p) => (p.x - axis) * (side ? -sign : sign) <= 0)
      )
        return false;
      if (route.netId !== net) continue;
      for (const { from, to } of line.segments) {
        if (
          at.x < Math.min(from.x, to.x) ||
          at.x > Math.max(from.x, to.x) ||
          at.y < Math.min(from.y, to.y) ||
          at.y > Math.max(from.y, to.y)
        )
          continue;
        if (from.x !== at.x || to.x !== at.x || Math.min(from.y, to.y) < at.y)
          return false;
        if (Math.max(from.y, to.y) > at.y) down = true;
      }
    }
    if (!down) return false;
  }
  return true;
}

function* topPorts(
  source: SchematicDocument,
  resolver: SymbolResolver,
  s: Structure,
  seats: Seats,
  sign: number,
  inputs: boolean,
  lift = 1,
  extraPad?: number,
) {
  const deviceDoc = withPlacements({ ...source, instances: s.devices }, seats);
  const points = pinPoints(deviceDoc, resolver);
  const grid = source.presentation.grid,
    gap = markerOffset(source);
  const top =
    grid * (Math.floor(enclosingBox(deviceDoc, resolver).y / grid) - lift);
  const { branches: t, roles } = s;
  for (const pad of [
    0,
    gap,
    2 * gap,
    ...(extraPad === undefined ? [] : [extraPad]),
  ]) {
    const moved = new Map(seats);
    for (const side of [0, 1] as const) {
      const dir = side ? -sign : sign,
        driver = t.path.at(-1)![side],
        input = t.path[0]![side];
      const host = (id: string, port: string) =>
        points.find(
          (p) =>
            p.instanceId === id &&
            roles.pinNet(id, p.pinName) === roles.pinNet(port, "P"),
        );
      const op = host(driver, t.outputs[side]),
        ip = host(input, t.inputs[side]);
      if (!op || !ip) return;
      moved.set(
        t.outputs[side],
        placement(op.point.x + dir * pad, top, "none", 90),
      );
      if (inputs) {
        const facing =
          Math.sign(ip.point.x - seats.get(input)!.position.x) || dir;
        moved.set(
          t.inputs[side],
          placement(
            ip.point.x + facing * gap,
            ip.point.y,
            facing < 0 ? "none" : "horizontal",
          ),
        );
      }
    }
    yield moved;
  }
}

function* columnSeats(
  source: SchematicDocument,
  doc: SchematicDocument,
  resolver: SymbolResolver,
  s: Structure,
) {
  const seats: Seats = new Map(doc.instances.map((i) => [i.id, i.placement!]));
  const pos = (id: string) => seats.get(id)!.position;
  const grid = source.presentation.grid,
    snap = (v: number) => grid * Math.round(v / grid);
  const [a, b] = s.branches.path[0]!,
    axis = snap((pos(a).x + pos(b).x) / 2),
    sign = pos(a).x <= pos(b).x ? -1 : 1;
  yield* topPorts(source, resolver, s, seats, sign, false);
  const rows = s.pairs.map(([l, r]) => (pos(l).y + pos(r).y) / 2);
  const origin = Math.min(...rows, ...s.axisDevices.map((id) => pos(id).y));
  const pitch = placementPitch(s.roles),
    gap = markerOffset(source);
  const primary = new Set([...s.branches.inputs, ...s.branches.outputs]);
  const centreDevices = s.axisDevices.filter((id) => s.channel(id));
  const trunkShift = centreDevices.flatMap((id) => {
    const terminal = s.pins(id).find((p) => p.name === s.channel(id)!.drain);
    return terminal
      ? [-transformPoint(terminal.at, { x: 0, y: 0 }, seats.get(id)!).x]
      : [];
  });
  // Explore clearances in grid units relative to symbol pin spans and the
  // existing placement pitch, independent of model, device name or stage count.
  const span = Math.max(
    ...s.pairs.map(([id]) => {
      const ys = s.pins(id).map((p) => p.at.y);
      return Math.max(...ys) - Math.min(...ys);
    }),
  );
  for (const height of new Set([span + 3 * grid, span + grid, pitch.row]))
    for (const radius of new Set([snap(pitch.member / 2) + grid, pitch.member]))
      for (const reverse of s.laneCount > 1 ? [false, true] : [false])
        for (const stagger of s.laneCount > 1
          ? [-(gap + grid), 0, gap + grid]
          : [0])
          for (const shift of new Set([0, ...trunkShift])) {
            const moved = new Map(seats);
            const row = (y: number) =>
              snap(origin) + snap(((y - origin) * height) / pitch.row);
            for (const [k, pair] of s.pairs.entries()) {
              const lane = s.lanes[k]!,
                distance =
                  radius +
                  (reverse ? s.laneCount - 1 - lane : lane) * pitch.member;
              const ch = s.channel(pair[0]),
                gate = ch && s.roles.pinNet(pair[0], ch.gate);
              const shared = ch && gate === s.roles.pinNet(pair[1], ch.gate);
              const input =
                gate && gate === s.roles.pinNet(s.branches.inputs[0], "P");
              const diode = ch && gate === s.roles.pinNet(pair[0], ch.drain);
              const outward =
                input || (!shared && (diode ? !reverse : reverse));
              for (const side of [0, 1] as const) {
                const id = pair[side],
                  dir = side ? -sign : sign;
                const pose = ch
                  ? placement(
                      0,
                      0,
                      dir < 0 === !!outward ? "none" : "horizontal",
                    )
                  : side
                    ? reflectOrientation(seats.get(pair[0])!, "left-right")
                    : seats.get(id)!;
                const pin =
                  s.pins(id).find((p) => p.name === ch?.drain) ??
                  s.pins(id)[0]!;
                const dx = transformPoint(pin.at, { x: 0, y: 0 }, pose).x;
                moved.set(
                  id,
                  placement(
                    axis + dir * distance - dx,
                    row(rows[k]!) + (shared && lane > 0 ? stagger : 0),
                    pose.mirror,
                    pose.rotation,
                  ),
                );
              }
            }
            for (const id of s.axisDevices)
              moved.set(id, {
                ...seats.get(id)!,
                position: { x: axis + shift, y: row(pos(id).y) },
              });
            placeMarkers(
              source,
              resolver,
              s.roles,
              moved,
              emptyOverrides(),
              emptyChoices(),
            );
            const pins = pinPoints(
              withPlacements({ ...source, instances: s.devices }, moved),
              resolver,
            );
            for (const p of source.instances) {
              if (
                !["port", "port-filled"].includes(p.symbolId) ||
                primary.has(p.id)
              )
                continue;
              const net = s.roles.pinNet(p.id, "P");
              const hosts = pins.filter(
                (h) => s.roles.pinNet(h.instanceId, h.pinName) === net,
              );
              const pair = s.pairs.find((group) =>
                group.every((id) => hosts.some((h) => h.instanceId === id)),
              );
              if (pair)
                moved.set(
                  p.id,
                  placement(
                    axis,
                    hosts.find((h) => h.instanceId === pair[0])!.point.y,
                    "none",
                    270,
                  ),
                );
            }
            yield* topPorts(source, resolver, s, moved, sign, true);
          }

  // In a single stage the output is shared by the input transistor and its
  // loads. A load pin can give a clear vertical approach on the same branch.
  if (s.branches.path.length === 1) {
    const devices = {
      ...doc,
      instances: doc.instances.filter((i) => !isMarker(i)),
    };
    const top =
      grid * (Math.floor(enclosingBox(devices, resolver).y / grid) - 1);
    const [left, right] = s.branches.outputs;
    const output = s.roles.pinNet(left, "P");
    const pins = pinPoints(devices, resolver).filter(
      (p) => s.roles.pinNet(p.instanceId, p.pinName) === output,
    );
    const radii = new Set(pins.map((p) => snap((p.point.x - axis) * sign)));
    for (const radius of radii) {
      for (const offset of [0, -grid, grid]) {
        const reach = radius + offset;
        if (reach <= 0) continue;
        const moved = new Map(seats);
        moved.set(left, placement(axis + sign * reach, top, "none", 90));
        moved.set(right, placement(axis - sign * reach, top, "none", 90));
        yield moved;
      }
    }
  }
}

/** Contract the existing rows about the device axis and use the highest
 * output-net contact as the top lead. Retain the drawing's handedness. */
function* compactOutputSeats(
  doc: SchematicDocument,
  resolver: SymbolResolver,
  s: Structure,
) {
  const grid = doc.presentation.grid,
    snap = (v: number) => grid * Math.round(v / grid);
  const seats: Seats = new Map(doc.instances.map((i) => [i.id, i.placement!]));
  const [a, b] = s.branches.path[0]!,
    ax = seats.get(a)!.position.x,
    bx = seats.get(b)!.position.x;
  const axis = snap((ax + bx) / 2),
    sign = ax <= bx ? -1 : 1;
  const base = Math.min(...s.devices.map((i) => seats.get(i.id)!.position.y));
  for (const scale of [1, 0.8, 0.6, 0.5])
    for (const wide of [1, 0.8, 1.2]) {
      const moved: Seats = new Map(
        [...seats].map(([id, p]) => [
          id,
          {
            ...p,
            position: {
              x: axis + snap((p.position.x - axis) * wide),
              y: base + snap((p.position.y - base) * scale),
            },
          },
        ]),
      );
      const devices = withPlacements({ ...doc, instances: s.devices }, moved),
        box = enclosingBox(devices, resolver);
      const [first, second] = s.branches.outputs;
      const net = s.roles.pinNet(first, "P");
      const pins = pinPoints(devices, resolver).filter(
        (p) => s.roles.pinNet(p.instanceId, p.pinName) === net,
      );
      const highest = pins.sort(
        (a, b) =>
          a.point.y - b.point.y ||
          Math.abs(a.point.x - axis) - Math.abs(b.point.x - axis),
      )[0];
      if (!highest) continue;
      const top = grid * (Math.floor(box.y / grid) - 1);
      const radii = [
        Math.abs(highest.point.x - axis),
        Math.max(axis - box.x, box.x + box.width - axis),
        Math.abs(seats.get(first)!.position.x - axis),
      ];
      for (const pad of [0, grid, 2 * grid, 4 * grid])
        for (const rad of new Set(radii)) {
          const reach = snap(rad + pad);
          if (!reach) continue;
          const trial = new Map(moved);
          trial.set(first, placement(axis + sign * reach, top, "none", 90));
          trial.set(second, placement(axis - sign * reach, top, "none", 90));
          yield trial;
        }
    }
}

/** A complete side gives a second seed when different tie breaks place the
 * two loads at different distances from the input pair. Try either side. */
function* mirroredHalfSeats(
  source: SchematicDocument,
  doc: SchematicDocument,
  resolver: SymbolResolver,
  s: Structure,
) {
  const grid = source.presentation.grid,
    gap = markerOffset(source);
  const seats: Seats = new Map(doc.instances.map((i) => [i.id, i.placement!]));
  const midpoints = s.pairs
    .map(([a, b]) => (seats.get(a)!.position.x + seats.get(b)!.position.x) / 2)
    .sort((a, b) => a - b);
  const mid =
    grid * Math.round(midpoints[Math.floor(midpoints.length / 2)]! / grid);
  const [a, b] = s.branches.path[0]!,
    sign = seats.get(a)!.position.x <= seats.get(b)!.position.x ? -1 : 1;
  for (const keep of [0, 1] as const)
    for (const spacing of [0, gap, 2 * gap]) {
      const moved = new Map(seats);
      for (const pair of s.pairs) {
        const ref = seats.get(pair[keep])!;
        const reach = Math.max(
          3 * grid,
          Math.abs(ref.position.x - mid) + spacing,
        );
        for (const i of [0, 1] as const) {
          const pose = i === keep ? ref : reflectOrientation(ref, "left-right");
          moved.set(
            pair[i],
            placement(
              mid + (i ? -sign : sign) * reach,
              ref.position.y,
              pose.mirror,
              pose.rotation,
            ),
          );
        }
      }
      placeMarkers(
        source,
        resolver,
        s.roles,
        moved,
        emptyOverrides(),
        emptyChoices(),
      );
      for (const lift of [1, 3])
        yield* topPorts(source, resolver, s, moved, sign, true, lift);
    }
}

function* singleStageAlternatives(
  source: SchematicDocument,
  doc: SchematicDocument,
  resolver: SymbolResolver,
  s: Structure,
) {
  const seed = connectivityPlacementSeed(source, resolver);
  const trace =
    seed &&
    (differentialBranches(seed.source, resolver, true) ??
      differentialBranches(seed.source, resolver));
  if (seed && trace?.path.length === 1) {
    const shape = stageStructure(seed.source, seed.drawing, resolver, trace);
    if (shape) {
      for (const candidates of [
        columnSeats(seed.source, seed.drawing, resolver, shape),
        compactOutputSeats(seed.drawing, resolver, shape),
      ])
        for (const seats of candidates)
          yield new Map(
            [...seats].map(([id, p]) => [seed.original.get(id)!, p]),
          );
    }
  }
  yield* compactOutputSeats(doc, resolver, s);
  yield* mirroredHalfSeats(source, doc, resolver, s);
}

/** Stack the two branches by their channel connections. A pair on the input
 * sources sits below them, an output load sits above. A second pair on the
 * outputs gets its own row between the drivers and their active loads. */
function* channelStackSeats(
  source: SchematicDocument,
  doc: SchematicDocument,
  resolver: SymbolResolver,
  s: Structure,
) {
  const t = s.branches,
    inputPair = t.path[0]!;
  const input = s.channel(inputPair[0]);
  if (t.path.length !== 1 || !input) return;
  const net = s.roles.pinNet;
  const rows = new Map<Pair, "source" | "output" | "active">();
  for (const pair of s.pairs) {
    if (pair.includes(inputPair[0])) continue;
    const active = s.channel(pair[0]);
    if (!active && s.pins(pair[0]).length !== 2) return;
    const connects = (pin: string) =>
      pair.every((id, i) => {
        const target = net(inputPair[i]!, pin);
        return target && s.pins(id).some((p) => net(id, p.name) === target);
      });
    if (connects(input.drain)) rows.set(pair, active ? "active" : "output");
    else if (!active && connects(input.source)) rows.set(pair, "source");
    else return;
  }
  const levels = new Set(rows.values());
  if (!rows.size || levels.size !== rows.size) return;
  const tails: string[] = [],
    references: string[] = [];
  for (const id of s.axisDevices) {
    const ch = s.channel(id);
    if (!ch) return;
    if (net(id, ch.drain) === net(id, ch.gate)) references.push(id);
    else tails.push(id);
  }
  if (tails.length !== 1 || references.length > 1) return;
  const grid = source.presentation.grid,
    gap = markerOffset(source);
  const existing = new Map(doc.instances.map((i) => [i.id, i.placement!]));
  const first = existing.get(inputPair[0])!.position,
    second = existing.get(inputPair[1])!.position;
  const axis = Math.round((first.x + second.x) / (2 * grid)) * grid;
  const origin = Math.round((first.y + second.y) / (2 * grid)) * grid;
  const mixed = levels.has("active") && levels.has("output");
  const ys = s.pins(inputPair[0]).map((p) => p.at.y);
  const span = Math.max(...ys) - Math.min(...ys);
  const primary = new Set([...t.inputs, ...t.outputs]);
  for (const row of new Set([span + gap, span + grid, span]))
    for (const radius of new Set([span, span - grid, gap].filter((x) => x > 0)))
      for (const inset of mixed ? [grid, 0] : [0])
        for (const turn of mixed ? ([180, 0] as const) : ([0] as const)) {
          const seats = new Map(existing);
          const atPin = (
            id: string,
            pin: string,
            x: number,
            y: number,
            pose: Placement,
          ) => {
            const contact = s.pins(id).find((p) => p.name === pin)!;
            const offset = transformPoint(contact.at, { x: 0, y: 0 }, pose);
            seats.set(id, { ...pose, position: { x: x - offset.x, y } });
          };
          for (const side of [0, 1] as const) {
            const dir = side ? 1 : -1,
              x = axis + dir * radius;
            const outward = placement(0, 0, side ? "horizontal" : "none");
            atPin(inputPair[side], input.drain, x, origin, outward);
            for (const [pair, role] of rows) {
              const id = pair[side],
                ch = s.channel(id);
              const layer =
                role === "source" ? 1 : role === "active" && mixed ? -2 : -1;
              const pose =
                role === "active"
                  ? placement(0, 0, side ? "none" : "horizontal")
                  : {
                      ...outward,
                      rotation: role === "output" ? turn : (0 as const),
                    };
              atPin(
                id,
                ch?.drain ?? s.pins(id)[0]!.name,
                x - (role === "output" ? dir * inset : 0),
                origin + layer * row,
                pose,
              );
            }
          }
          const bottom = origin + (levels.has("source") ? 2 : 1) * row;
          for (const id of [...tails, ...references]) {
            const reference = references.includes(id);
            atPin(
              id,
              s.channel(id)!.drain,
              reference ? axis - radius - span : axis,
              bottom,
              placement(0, 0, reference ? "horizontal" : "none"),
            );
          }
          placeMarkers(
            source,
            resolver,
            s.roles,
            seats,
            emptyOverrides(),
            emptyChoices(),
          );
          const pins = pinPoints(
            withPlacements({ ...source, instances: s.devices }, seats),
            resolver,
          );
          for (const port of source.instances) {
            if (port.symbolId !== "port" || primary.has(port.id)) continue;
            const n = net(port.id, "P");
            for (const [pair, role] of rows) {
              if (
                role !== "active" ||
                !pair.every((id) => net(id, s.channel(id)!.gate) === n)
              )
                continue;
              const gate = pins.find(
                (p) =>
                  p.instanceId === pair[0] &&
                  p.pinName === s.channel(pair[0])!.gate,
              );
              if (gate)
                seats.set(port.id, placement(axis, gate.point.y, "none", 270));
            }
          }
          yield* topPorts(source, resolver, s, seats, -1, true, 1, gap + grid);
        }
}

/** A mirrored pair of exterior leads can pass beside a load stack without
 * crossing the load or its bias wire. Keep the devices in their existing seats. */
function* exteriorOutputSeats(
  source: SchematicDocument,
  doc: SchematicDocument,
  resolver: SymbolResolver,
  s: Structure,
) {
  const seats: Seats = new Map(doc.instances.map((i) => [i.id, i.placement!]));
  const [a, b] = s.branches.path[0]!;
  const first = seats.get(a)!.position,
    second = seats.get(b)!.position;
  const axis = (first.x + second.x) / 2,
    sign = Math.sign(first.x - axis);
  if (!sign) return;
  let extent = 0;
  for (const [left, right] of s.pairs) {
    const l = seats.get(left)!,
      r = seats.get(right)!;
    for (const pin of s.pins(left)) {
      const mate = s.pins(right).find((p) => p.name === pin.name);
      if (!mate) return;
      const p = transformPoint(pin.at, l.position, l),
        q = transformPoint(mate.at, r.position, r);
      if (p.y !== q.y || Math.abs(p.x + q.x - 2 * axis) > 1e-6) return;
      extent = Math.max(extent, Math.abs(p.x - axis));
    }
  }
  const grid = source.presentation.grid;
  for (const lift of [1, 2]) {
    const ports = topPorts(source, resolver, s, seats, sign, true, lift).next()
      .value;
    if (!ports) return;
    for (const clearance of [0, grid, 2 * grid]) {
      const trial = new Map(ports);
      for (const [side, id] of s.branches.outputs.entries()) {
        const p = ports.get(id)!;
        trial.set(id, {
          ...p,
          position: {
            x: axis + (side ? -sign : sign) * (extent + clearance),
            y: p.position.y,
          },
        });
      }
      yield trial;
    }
  }
}

/** Open or close the space above and below the input row by whole grid
 * steps without disturbing the horizontal alignment of any branch. */
function* rowClearanceSeats(
  source: SchematicDocument,
  doc: SchematicDocument,
  resolver: SymbolResolver,
  s: Structure,
) {
  const existing: Seats = new Map(
    doc.instances.map((i) => [i.id, i.placement!]),
  );
  const [a, b] = s.branches.path[0]!;
  const l = existing.get(a)!.position,
    r = existing.get(b)!.position;
  const dir = Math.sign(l.x - r.x),
    y = (l.y + r.y) / 2;
  if (!dir) return;
  const grid = source.presentation.grid;
  for (const delta of [-grid, grid, 2 * grid]) {
    const moved = new Map(existing);
    for (const inst of s.devices) {
      const pose = existing.get(inst.id)!;
      moved.set(inst.id, {
        ...pose,
        position: {
          x: pose.position.x,
          y: pose.position.y + delta * Math.sign(pose.position.y - y),
        },
      });
    }
    placeMarkers(
      source,
      resolver,
      s.roles,
      moved,
      emptyOverrides(),
      emptyChoices(),
    );
    for (const lift of [1, 2])
      yield* topPorts(source, resolver, s, moved, dir, true, lift);
  }
}

/** Electrically identical parallel slices can have several reflections. If a
 * reflection exchanges both tails, its loads cannot be assigned to one side.
 * Retry the connectivity-ordered reflection only for the same signal paths. */
function recoverSingleStage(
  source: SchematicDocument,
  doc: SchematicDocument,
  resolver: SymbolResolver,
  branches: DifferentialBranches,
) {
  if (branches.path.length !== 1) return;
  const seed = connectivityPlacementSeed(source, resolver);
  if (!seed) return;
  const other =
    differentialBranches(seed.source, resolver, true) ??
    differentialBranches(seed.source, resolver);
  if (other?.path.length !== 1) return;
  const real = (id: string) => seed.original.get(id)!;
  const pair = ([a, b]: Pair): Pair => [real(a), real(b)];
  const inputs = pair(other.inputs),
    outputs = pair(other.outputs);
  if (
    !inputs.every(
      (id, i) => outputs[i] === branches.outputs[branches.inputs.indexOf(id)],
    )
  )
    return;
  return stageStructure(source, doc, resolver, {
    inputs,
    outputs,
    path: other.path.map(pair),
    outputDrivers: other.outputDrivers.map(pair),
    members: other.members.map(pair),
    component: {
      pairs: other.component.pairs.map(pair),
      axisDevices: other.component.axisDevices.map(real),
    },
  });
}

export function selectDifferentialStageColumns(
  source: SchematicDocument,
  resolver: SymbolResolver,
  branches: DifferentialBranches,
  initial: Trial,
  route: (seats: Seats, clearWires?: boolean) => Trial | undefined,
  stopped: () => boolean,
) {
  const s =
    stageStructure(source, initial.final, resolver, branches) ??
    recoverSingleStage(source, initial.final, resolver, branches);
  if (!s) return initial.candidate;
  const prior = selectStagePlan(
    source,
    resolver,
    branches,
    initial,
    route,
    stopped,
    s,
  );
  return selectCurrentSourceTail(
    source,
    resolver,
    s,
    prior,
    route,
    (doc) => completeDrawing(doc, resolver, s),
    (seats, sign, lift) =>
      topPorts(source, resolver, s, seats, sign, true, lift),
    stopped,
  ).candidate;
}
function selectStagePlan(
  source: SchematicDocument,
  resolver: SymbolResolver,
  branches: DifferentialBranches,
  initial: Trial,
  route: (seats: Seats, clearWires?: boolean) => Trial | undefined,
  stopped: () => boolean,
  s: Structure,
): Trial {
  const cap = auditRouting(initial.final, resolver),
    guards = routedGuards(initial.final, resolver);
  const labels = diagnoseLabelClearance(initial.final, resolver).length,
    seen = new Set<string>(),
    seenWithLabelClearance = new Set<string>();
  let best = completeDrawing(initial.final, resolver, s) ? initial : undefined;
  let crossings = best ? cap.crossings : Infinity;
  if (!crossings) return initial;
  let withinNewBudget: Trial | undefined;
  let alternateCrossings = Infinity;
  function search(
    candidates: Iterable<Seats>,
    extraBends: number,
    lengthRatio: number,
    firstComplete = false,
    clearWires = false,
  ) {
    // The same seats can pass the label guard after a wire-struck label moves.
    const examined = clearWires ? seenWithLabelClearance : seen;
    for (const seats of candidates) {
      if (stopped()) break;
      const key = JSON.stringify(source.instances.map((i) => seats.get(i.id)));
      if (examined.has(key)) continue;
      examined.add(key);
      const trial = route(seats, clearWires);
      if (!trial || !completeDrawing(trial.final, resolver, s!)) continue;
      const a = auditRouting(trial.final, resolver);
      if (
        a.unsafeProblems.length ||
        a.crossings > cap.crossings ||
        a.crossings >= crossings ||
        a.bends > cap.bends + (branches.path.length === 1 ? 4 : extraBends) ||
        a.wireLength >
          cap.wireLength * (branches.path.length === 1 ? 1.25 : lengthRatio)
      )
        continue;
      if (
        diagnoseLabelClearance(trial.final, resolver).length > labels ||
        Object.entries(routedGuards(trial.final, resolver)).some(
          ([k, v]) => v > (guards[k] ?? 0),
        )
      )
        continue;
      if (
        a.bends > cap.bends + extraBends ||
        a.wireLength > cap.wireLength * lengthRatio
      ) {
        if (!best && a.crossings < alternateCrossings) {
          withinNewBudget = trial;
          alternateCrossings = a.crossings;
        }
        continue;
      }
      best = trial;
      crossings = a.crossings;
      if (!crossings || firstComplete) break;
    }
  }
  search(columnSeats(source, initial.final, resolver, s), 2, 1.1);
  best ??= withinNewBudget;
  if (!best && branches.path.length === 1 && !stopped())
    search(
      singleStageAlternatives(source, initial.final, resolver, s),
      4,
      1.25,
      true,
    );
  if (!best && branches.path.length === 1 && !stopped())
    search(
      channelStackSeats(source, initial.final, resolver, s),
      4,
      1.25,
      true,
      true,
    );
  if (!best && branches.path.length === 1 && !stopped())
    search(
      exteriorOutputSeats(source, initial.final, resolver, s),
      4,
      1.25,
      true,
      true,
    );
  if (!best && branches.path.length === 1 && !stopped())
    search(
      rowClearanceSeats(source, initial.final, resolver, s),
      4,
      1.25,
      true,
      true,
    );
  return best ?? initial;
}
