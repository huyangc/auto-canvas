import { visibleInstanceBounds } from "@icm/derived";
import { reflectOrientation, type SchematicDocument } from "@icm/model";
import type { SymbolResolver } from "@icm/symbols";
import type { Tail } from "./current-source-tail.js";
import type { StageStructure } from "./differential-stage-columns.js";
import { placement, transformPoint, withPlacements } from "./geometry.js";
import { emptyChoices, emptyOverrides } from "./layout-choices.js";
import { placeMarkers } from "./place-markers.js";
import type { Placement } from "./types.js";

type Seats = Map<string, Placement>;
type Pair = [string, string];

export function exteriorInputs(
  doc: SchematicDocument,
  r: SymbolResolver,
  s: StageStructure,
) {
  const bounds = new Map(
    visibleInstanceBounds(doc, r).map((v) => [v.id, v.bounds]),
  );
  const positions = new Map(
    doc.instances.map((i) => [i.id, i.placement!.position.x]),
  );
  return s.branches.inputs.every((id, k) => {
    const x = positions.get(id)!,
      other = positions.get(s.branches.inputs[1 - k]!)!;
    return s.pairs.every((p) => {
      const b = bounds.get(p[k]!)!;
      return x < other ? x < b.x : x > b.x + b.width;
    });
  });
}

function feedbackBank(s: StageStructure, t: Tail) {
  if (t.pair !== t.drivers) return;
  const net = s.roles.pinNet,
    outs = s.branches.outputs.map((id) => net(id, "P"));
  const loads = s.pairs.filter(
    (p) =>
      p !== t.drivers &&
      p.every((id, k) => {
        const ch = s.channel(id);
        return (
          ch &&
          net(id, ch.drain) === outs[k] &&
          s.roles.rails.has(net(id, ch.source) ?? "")
        );
      }),
  );
  if (loads.length !== 1) return;
  const load = loads[0]!,
    controls = load.map((id) => net(id, s.channel(id)!.gate));
  const links: Pair[] = [],
    bypasses: Pair[] = [],
    followers: Pair[] = [],
    biasLegs: Pair[] = [];
  for (const pair of s.pairs) {
    if (pair === t.drivers || pair === load) continue;
    const connects = (
      id: string,
      a: string | undefined,
      b: string | undefined,
    ) => {
      const pins = s.pins(id);
      return (
        pins.length === 2 &&
        a &&
        b &&
        pins.some((p) => net(id, p.name) === a) &&
        pins.some((p) => net(id, p.name) === b)
      );
    };
    if (pair.every((id, k) => connects(id, outs[k], controls[k])))
      links.push(pair);
    else if (
      pair.every((id, k) =>
        connects(id, net(load[k]!, s.channel(load[k]!)!.source), controls[k]),
      )
    )
      bypasses.push(pair);
    else if (
      pair.every((id, k) => {
        const ch = s.channel(id);
        return (
          ch &&
          net(id, ch.gate) === outs[k] &&
          net(id, ch.source) === controls[k] &&
          s.roles.rails.has(net(id, ch.drain) ?? "")
        );
      })
    )
      followers.push(pair);
    else if (
      pair.every((id, k) =>
        s.pins(id).some((p) => {
          const rail = net(id, p.name);
          return (
            s.roles.rails.has(rail ?? "") && connects(id, rail, controls[k])
          );
        }),
      )
    )
      biasLegs.push(pair);
    else return;
  }
  if (
    links.length === 1 &&
    !followers.length &&
    !biasLegs.length &&
    bypasses.length <= 1
  )
    return { load, controls, link: links[0]!, bypass: bypasses[0], outs };
  if (
    followers.length === 1 &&
    biasLegs.length === 1 &&
    !links.length &&
    !bypasses.length
  )
    return {
      load,
      controls,
      follower: followers[0]!,
      biasLeg: biasLegs[0]!,
      outs,
    };
}

/** The feedback element can run from the output column towards the load gate.
 * A bypass to the supply takes the adjacent column. Choose the pose from the
 * actual terminal on each net, including reversals of an unpolarized resistor. */
export function* exteriorTailSeats(
  src: SchematicDocument,
  r: SymbolResolver,
  doc: SchematicDocument,
  s: StageStructure,
  t: Tail,
) {
  const base: Seats = new Map(doc.instances.map((i) => [i.id, i.placement!]));
  const left = base.get(t.drivers[0])!.position,
    right = base.get(t.drivers[1])!.position,
    g = src.presentation.grid;
  const axis = g * Math.round((left.x + right.x) / (2 * g)),
    y = g * Math.round((left.y + right.y) / (2 * g));
  if (base.get(t.id)!.position.y < y) {
    const reflected: Seats = new Map();
    for (const [id, p] of base)
      reflected.set(id, {
        ...reflectOrientation(p, "top-bottom"),
        position: { x: p.position.x, y: 2 * y - p.position.y },
      });
    yield reflected;
  }
  const bank = feedbackBank(s, t);
  if (!bank) return;
  const net = s.roles.pinNet;
  const pin = (id: string, name: string) =>
    s.pins(id).find((p) => p.name === name)!;
  function align(
    m: Seats,
    id: string,
    name: string,
    x: number,
    cy: number,
    mirror: Placement["mirror"],
    rotation: Placement["rotation"] = 0,
  ) {
    const pose = placement(0, 0, mirror, rotation),
      offset = transformPoint(pin(id, name).at, pose.position, pose);
    m.set(id, { ...pose, position: { x: x - offset.x, y: cy } });
  }
  function portEnvelope(m: Seats) {
    placeMarkers(src, r, s.roles, m, emptyOverrides(), emptyChoices());
    const bounds = visibleInstanceBounds(
      withPlacements({ ...src, instances: s.devices }, m),
      r,
    );
    return {
      top: g * (Math.floor(Math.min(...bounds.map((v) => v.bounds.y)) / g) - 1),
      reach:
        g *
        Math.ceil(
          Math.max(
            ...bounds.map((v) =>
              Math.max(axis - v.bounds.x, v.bounds.x + v.bounds.width - axis),
            ),
          ) / g,
        ),
    };
  }
  if (bank.follower && bank.biasLeg) {
    // Route the output to the follower gate along the load drain row. The
    // bias leg shares the follower source and leaves a separate input lane.
    const half = Math.abs(
        pin(t.drivers[0], s.channel(t.drivers[0])!.drain).at.y,
      ),
      pitch = 2 * half + g;
    // Move the load row and the upper landing one routing track at a time
    // when the follower output would otherwise need a detour.
    for (const rise of [half, Math.max(0, half - g), half + g])
      for (const radius of [pitch, pitch + half])
        for (const spacing of [pitch, pitch + g])
          for (const turn of [90, 0] as const) {
            const m = new Map(base);
            for (const k of [0, 1] as const) {
              const dir = k ? 1 : -1,
                mirror = k ? "horizontal" : "none",
                x = axis + dir * radius,
                adjacent = x + dir * spacing;
              const driver = t.drivers[k],
                load = bank.load[k],
                follower = bank.follower[k],
                leg = bank.biasLeg[k];
              align(m, driver, s.channel(driver)!.drain, x, y, mirror);
              align(
                m,
                load,
                s.channel(load)!.drain,
                x,
                y - pitch - rise,
                mirror,
              );
              align(
                m,
                follower,
                s.channel(follower)!.source,
                adjacent,
                y - pitch,
                mirror,
              );
              const control = s
                .pins(leg)
                .find((p) => net(leg, p.name) === bank.controls[k])!;
              const rotation =
                control.at.y > 0 ? (turn === 90 ? 270 : 180) : turn;
              m.set(leg, placement(adjacent + dir * half, y, mirror, rotation));
            }
            align(
              m,
              t.id,
              t.entry.name,
              axis,
              y + pitch + half + g,
              "none",
              t.entry.at.y < 0 ? 0 : 180,
            );
            const { top, reach } = portEnvelope(m);
            for (const drop of [3 * half, half, 0])
              for (const pad of [2 * half, half + g, half])
                for (const margin of [g, half]) {
                  const seats = new Map(m);
                  for (const k of [0, 1] as const) {
                    const dir = k ? 1 : -1;
                    seats.set(
                      s.branches.inputs[k],
                      placement(
                        axis + dir * (reach + margin),
                        y + drop,
                        k ? "horizontal" : "none",
                      ),
                    );
                    seats.set(
                      s.branches.outputs[k],
                      placement(
                        axis + dir * (radius + spacing + pad),
                        top,
                        "none",
                        90,
                      ),
                    );
                  }
                  yield seats;
                }
          }
    return;
  }
  if (!bank.link) return;
  for (const radius of [5, 7, 9, 3])
    for (const row of [6, 8, 4])
      for (const lane of [4, 6, -4])
        for (const horizontal of [true, false])
          for (const gatesInward of [true, false]) {
            const m = new Map(base);
            for (const k of [0, 1] as const) {
              const dir = k ? 1 : -1,
                x = axis + dir * radius * g,
                inner = x - dir * lane * g,
                id = t.drivers[k],
                ch = s.channel(id)!;
              const down = pin(id, ch.source).at.y < 0;
              align(
                m,
                id,
                ch.drain,
                x,
                y,
                k ? (down ? "both" : "horizontal") : down ? "vertical" : "none",
              );
              const load = bank.load[k];
              align(
                m,
                load,
                s.channel(load)!.drain,
                x,
                y - row * g,
                k === Number(gatesInward) ? "none" : "horizontal",
              );
              const link = bank.link[k],
                op = s
                  .pins(link)
                  .find((p) => net(link, p.name) === bank.outs[k])!;
              const mirror = horizontal
                ? Math.sign(-op.at.y) === dir * Math.sign(lane)
                  ? "none"
                  : "horizontal"
                : k
                  ? op.at.y < 0
                    ? "both"
                    : "horizontal"
                  : op.at.y < 0
                    ? "vertical"
                    : "none";
              align(
                m,
                link,
                op.name,
                horizontal ? x : inner,
                y - (row * g) / 2,
                mirror,
                horizontal ? 90 : 0,
              );
              if (bank.bypass) {
                const id = bank.bypass[k],
                  p = s
                    .pins(id)
                    .find((p) => net(id, p.name) === bank.controls[k])!;
                align(
                  m,
                  id,
                  p.name,
                  inner,
                  y - row * g,
                  k
                    ? p.at.y > 0
                      ? "horizontal"
                      : "both"
                    : p.at.y > 0
                      ? "none"
                      : "vertical",
                );
              }
            }
            align(
              m,
              t.id,
              t.entry.name,
              axis,
              y + (row + 1) * g,
              "none",
              t.entry.at.y < 0 ? 0 : 180,
            );
            const { top, reach } = portEnvelope(m);
            for (const pad of [0, 1, 2, 4]) {
              const a = new Map(m);
              for (const k of [0, 1] as const) {
                const dir = k ? 1 : -1,
                  id = t.drivers[k],
                  pose = m.get(id)!;
                const gate = transformPoint(
                  pin(id, s.channel(id)!.gate).at,
                  pose.position,
                  pose,
                );
                a.set(
                  s.branches.inputs[k],
                  placement(
                    axis +
                      dir * Math.max(reach + g, Math.abs(gate.x - axis) + g),
                    gate.y,
                    k ? "horizontal" : "none",
                  ),
                );
                a.set(
                  s.branches.outputs[k],
                  placement(axis + dir * (radius + pad) * g, top, "none", 90),
                );
              }
              yield a;
            }
          }
}
