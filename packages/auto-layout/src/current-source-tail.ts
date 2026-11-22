import { exteriorInputs, exteriorTailSeats } from "./tail-branch-seats.js";
import {
  contactRequiresJunctionDot,
  deriveDocumentContactEvidence,
  diagnoseLabelClearance,
  resolveDocumentRoutingGeometry,
} from "@icm/derived";
import type { SchematicDocument } from "@icm/model";
import type { SymbolResolver } from "@icm/symbols";
import type {
  StageStructure,
  StageTrial,
} from "./differential-stage-columns.js";
import { pinPoints, placement, transformPoint } from "./geometry.js";
import { emptyChoices, emptyOverrides } from "./layout-choices.js";
import { polarity } from "./net-roles.js";
import { placeMarkers } from "./place-markers.js";
import { auditRouting } from "./routing-audit.js";
import { routedGuards } from "./routed-search-score.js";
import type { Placement } from "./types.js";

type Seats = Map<string, Placement>;

/** A shared net joins corresponding devices to an independent current
 * source. The return pin of the source must be on a rail. */
function currentSourceTail(s: StageStructure) {
  if (s.branches.path.length !== 1 || s.axisDevices.length !== 1) return;
  const id = s.axisDevices[0]!;
  if (s.devices.find((i) => i.id === id)?.symbolId !== "current-source") return;
  const net = s.roles.pinNet,
    pins = s.pins(id);
  const entry = pins.find((p) => !s.roles.rails.has(net(id, p.name) ?? ""));
  if (!entry || !pins.some((p) => s.roles.rails.has(net(id, p.name) ?? "")))
    return;
  const common = net(id, entry.name);
  if (!common) return;
  const connected = s.pairs.filter((pair) =>
    pair.every((i) => s.pins(i).some((p) => net(i, p.name) === common)),
  );
  if (connected.length !== 1) return;
  const pair = connected[0]!;
  const inputs = s.branches.inputs.map((i) => net(i, "P"));
  const drivers = s.pairs.filter((p) =>
    p.every((i, side) => {
      const ch = s.channel(i);
      return (
        ch &&
        net(i, ch.gate) === inputs[side] &&
        (pair === p
          ? net(i, ch.source) === common
          : s.pins(pair[side]!).length === 2 &&
            s
              .pins(pair[side]!)
              .some((pin) => net(pair[side]!, pin.name) === net(i, ch.source)))
      );
    }),
  );
  if (drivers.length !== 1) return;
  return { id, entry, common, pair, drivers: drivers[0]! };
}
export type Tail = NonNullable<ReturnType<typeof currentSourceTail>>;

/** A visible tee on the symmetry axis, with both arms drawn and a continuous
 * vertical stem down to the tail pin. Routes may be split at junctions. */
function centeredTail(
  doc: SchematicDocument,
  r: SymbolResolver,
  s: StageStructure,
  t: Tail,
) {
  const pins = pinPoints(doc, r),
    p = (id: string, pin: string) =>
      pins.find((v) => v.instanceId === id && v.pinName === pin)?.point;
  const ends = t.pair.map((i) =>
    p(
      i,
      s.pins(i).find((pin) => s.roles.pinNet(i, pin.name) === t.common)!.name,
    ),
  );
  const a = ends[0],
    b = ends[1],
    foot = p(t.id, t.entry.name);
  const [l, h] = s.branches.inputs.map((i) => p(i, "P"));
  if (
    !l ||
    !h ||
    !a ||
    !b ||
    !foot ||
    a.y !== b.y ||
    foot.x !== (l.x + h.x) / 2 ||
    foot.x !== (a.x + b.x) / 2 ||
    foot.y <= a.y
  )
    return false;
  const body = doc.instances.find((i) => i.id === t.id)?.placement?.position;
  if (!body || body.x !== foot.x || body.y <= foot.y || a.x === b.x)
    return false;
  const routing = resolveDocumentRoutingGeometry(doc, r);
  const segments = doc.routes
    .filter((route) => route.netId === t.common)
    .flatMap((route) => routing.routes.get(route.id)?.segments ?? []);
  const contacts = deriveDocumentContactEvidence(doc, r, routing).contacts;
  return contacts.some((contact) => {
    const { x, y } = contact.point;
    if (
      contact.netId !== t.common ||
      x !== foot.x ||
      y < a.y ||
      y >= foot.y ||
      !contactRequiresJunctionDot(contact)
    )
      return false;
    const arms: [number, number][] = [],
      stem: [number, number][] = [];
    for (const { from, to } of segments) {
      if (from.y === y && to.y === y)
        arms.push([Math.min(from.x, to.x), Math.max(from.x, to.x)]);
      if (from.x === x && to.x === x)
        stem.push([Math.min(from.y, to.y), Math.max(from.y, to.y)]);
    }
    return (
      covered(arms, Math.min(a.x, b.x), Math.max(a.x, b.x)) &&
      covered(stem, y, foot.y)
    );
  });
}
function covered(ranges: [number, number][], low: number, high: number) {
  let end = low;
  for (const [a, b] of ranges.sort(([a], [b]) => a - b)) {
    if (a > end) break;
    end = Math.max(end, b);
  }
  return end >= high;
}

type PortSeats = (seats: Seats, sign: number, lift: number) => Iterable<Seats>;
function* branchSeats(
  src: SchematicDocument,
  r: SymbolResolver,
  doc: SchematicDocument,
  s: StageStructure,
  t: Tail,
  ports: PortSeats,
) {
  const initial: Seats = new Map(
    doc.instances.map((i) => [i.id, i.placement!]),
  );
  const pair = t.drivers,
    net = s.roles.pinNet,
    outs = s.branches.outputs.map((i) => net(i, "P"));
  const loads = s.pairs.filter((p) => p !== pair && p !== t.pair);
  if (
    !loads.length ||
    loads.some((p) =>
      p.some((i, k) => !s.pins(i).some((pin) => net(i, pin.name) === outs[k])),
    )
  )
    return;
  const g = src.presentation.grid,
    old = initial.get(pair[0])!.position,
    other = initial.get(pair[1])!.position;
  const axis = g * Math.round((old.x + other.x) / (2 * g)),
    y = g * Math.round((old.y + other.y) / (2 * g));
  const pinSpan =
    Math.max(...s.pins(pair[0]).map((p) => p.at.y)) -
    Math.min(...s.pins(pair[0]).map((p) => p.at.y));
  const hasSourceElements = t.pair !== pair;
  // A diode-connected load can take the outer column, leaving the input
  // gates a continuous path between the complementary devices.
  const ordered = [...loads].sort(
    ([a], [b]) => Number(isDiode(a)) - Number(isDiode(b)),
  );
  function isDiode(id: string) {
    const ch = s.channel(id);
    return !!ch && net(id, ch.gate) === net(id, ch.drain);
  }
  const multipleLoads = ordered.length > 1;
  for (const row of [pinSpan + g, pinSpan, pinSpan + 2 * g])
    for (const radius of multipleLoads
      ? [6 * g, 5 * g, 7 * g, 4 * g]
      : [3 * g, 2 * g, 4 * g, 5 * g])
      for (const spread of multipleLoads ? [4 * g, 6 * g, -4 * g] : [0])
        for (const inward of multipleLoads ? [true, false] : [false])
          for (const reverse of [false, true]) {
            const seats = new Map(initial);
            const align = (
              id: string,
              pin: string,
              x: number,
              cy: number,
              pose: Placement,
            ) => {
              const contact = s.pins(id).find((v) => v.name === pin)!;
              const offset = transformPoint(contact.at, { x: 0, y: 0 }, pose);
              seats.set(id, { ...pose, position: { x: x - offset.x, y: cy } });
            };
            for (const k of [0, 1] as const) {
              const dir = k ? 1 : -1,
                x = axis + dir * radius;
              const gatePose = placement(
                0,
                0,
                Boolean(k) !== inward ? "horizontal" : "none",
              );
              const ch = s.channel(pair[k])!;
              align(pair[k], ch.drain, x, y, gatePose);
              if (hasSourceElements) {
                const id = t.pair[k],
                  tip = s.pins(id).find((p) => net(id, p.name) !== t.common)!;
                align(
                  id,
                  tip.name,
                  x,
                  y + row,
                  placement(
                    0,
                    0,
                    tip.at.y > 0 ? (k ? "both" : "vertical") : gatePose.mirror,
                  ),
                );
              }
              for (const [j, load] of ordered.entries()) {
                const id = load[k],
                  ch = s.channel(id);
                const pin = ch
                  ? s.pins(id).find((p) => p.name === ch.drain)!
                  : s.pins(id).find((p) => net(id, p.name) === outs[k])!;
                const pose = ch
                  ? placement(
                      0,
                      0,
                      isDiode(id) && !reverse
                        ? k
                          ? "none"
                          : "horizontal"
                        : gatePose.mirror,
                    )
                  : placement(0, 0, gatePose.mirror, pin.at.y < 0 ? 180 : 0);
                align(id, pin.name, x + dir * j * spread, y - row, pose);
              }
            }
            const top = t.entry.at.y < 0 ? 0 : 180;
            align(
              t.id,
              t.entry.name,
              axis,
              y + (hasSourceElements ? 2 : 1) * row + (reverse ? g : 2 * g),
              placement(0, 0, "none", top),
            );
            placeMarkers(
              src,
              r,
              s.roles,
              seats,
              emptyOverrides(),
              emptyChoices(),
            );
            for (const proposed of ports(seats, -1, 1)) {
              if (!multipleLoads) {
                yield proposed;
                continue;
              }
              const landing = new Map(proposed);
              for (const k of [0, 1] as const) {
                const dir = k ? 1 : -1,
                  id = pair[k],
                  pose = seats.get(id)!;
                const gate = s
                  .pins(id)
                  .find((p) => p.name === s.channel(id)!.gate)!;
                const point = transformPoint(gate.at, pose.position, pose);
                landing.set(
                  s.branches.inputs[k],
                  placement(
                    point.x + (inward ? -dir : dir) * g,
                    point.y,
                    Boolean(k) !== inward ? "horizontal" : "none",
                  ),
                );
                const port = s.branches.outputs[k],
                  p = proposed.get(port)!;
                landing.set(port, {
                  ...p,
                  position: {
                    x: p.position.x + dir * Math.max(0, spread),
                    y: p.position.y,
                  },
                });
              }
              yield landing;
            }
          }
}

export function selectCurrentSourceTail(
  src: SchematicDocument,
  r: SymbolResolver,
  s: StageStructure,
  prior: StageTrial,
  route: (seats: Seats, clearWires?: boolean) => StageTrial | undefined,
  complete: (doc: SchematicDocument) => boolean,
  ports: PortSeats,
  stopped: () => boolean,
) {
  const tail = currentSourceTail(s);
  if (!tail || stopped()) return prior;
  // R81 puts the tail of a p-channel pair above the pair, but this stage only
  // builds a tail below it (R170): leave the earlier steps' drawing.
  const driver = s.devices.find((i) => i.id === tail.drivers[0])?.symbolId;
  if (driver && polarity(driver) === "p") return prior;
  const centered = (d: SchematicDocument) =>
    complete(d) && centeredTail(d, r, s, tail);
  const incumbent = centered(prior.final)
    ? prior
    : search(prior, branchSeats(src, r, prior.final, s, tail, ports), centered);
  const exterior = (d: SchematicDocument) =>
    centered(d) && exteriorInputs(d, r, s);
  return stopped() || exterior(incumbent.final)
    ? incumbent
    : search(
        incumbent,
        exteriorTailSeats(src, r, incumbent.final, s, tail),
        exterior,
      );
  function search(
    prior: StageTrial,
    candidates: Iterable<Seats>,
    accept: (doc: SchematicDocument) => boolean,
  ): StageTrial {
    const cap = auditRouting(prior.final, r),
      guards = routedGuards(prior.final, r),
      labels = diagnoseLabelClearance(prior.final, r).length,
      seen = new Set<string>();
    for (const seats of candidates) {
      if (stopped()) break;
      const key = JSON.stringify([...seats.values()]);
      if (seen.has(key)) continue;
      seen.add(key);
      const alt = route(seats, true);
      if (!alt || !accept(alt.final)) continue;
      const a = auditRouting(alt.final, r);
      if (
        a.unsafeProblems.length ||
        a.crossings > cap.crossings ||
        a.bends > cap.bends + 4 ||
        a.wireLength > cap.wireLength * 1.25 ||
        diagnoseLabelClearance(alt.final, r).length > labels ||
        Object.entries(routedGuards(alt.final, r)).some(
          ([k, v]) => v > (guards[k] ?? 0),
        )
      )
        continue;
      return alt;
    }
    return prior;
  }
}
