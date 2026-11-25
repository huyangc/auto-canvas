import { slideNetlistPort } from "./slide-netlist-port.js";
import { reflectNetlistPlan } from "./reflect-netlist-plan.js";
import { reflectionWorsensDirection } from "./netlist-reflection-veto.js";
import { diagnoseLabelClearance, resolveRouteGeometry } from "@icm/derived";
import { reflectOrientation, type SchematicDocument } from "@icm/model";
import type { SymbolResolver } from "@icm/symbols";
import {
  pairedPortSeats,
  reflectedPortTargets,
  mirrorPortGroups,
  portMirrorGeometry,
} from "./netlist-port-symmetry.js";
import {
  branchInterleaving,
  differentialBranches,
} from "./differential-branches.js";
import {
  enclosingBox,
  geometryProblem,
  pinPoints,
  placement,
  withPlacements,
} from "./geometry.js";
import { channelPins, classifyNets } from "./net-roles.js";
import { isMarker } from "./placement-connectivity.js";
import { portDirection } from "./port-convention.js";
import { routedGuards } from "./routed-search-score.js";
import { auditRouting } from "./routing-audit.js";
import type { AutoLayoutResult, Placement } from "./types.js";

type Seats = Map<string, Placement>;
type Trial = { candidate: AutoLayoutResult; final: SchematicDocument };
type AcceptDraft = (drawing: SchematicDocument) => boolean;
type RouteSeats = (
  seats: Seats,
  acceptDraft?: AcceptDraft,
) => Trial | undefined;
type RoutePort = (
  base: Trial,
  moves: Seats,
  acceptDraft: AcceptDraft,
  onAttempt: () => void,
) => Trial | undefined;

function samePlacement(a: Placement, b: Placement) {
  return (
    a.position.x === b.position.x &&
    a.position.y === b.position.y &&
    a.rotation === b.rotation &&
    a.mirror === b.mirror
  );
}

function seatKey(source: SchematicDocument, seats: Seats) {
  return JSON.stringify(source.instances.map((i) => seats.get(i.id)));
}

function portRoles(source: SchematicDocument, resolver: SymbolResolver) {
  const roles = classifyNets(source, resolver);
  const ports = source.instances.flatMap((i) => {
    if (i.symbolId !== "port" && i.symbolId !== "port-filled") return [];
    const net = roles.pinNet(i.id, "P");
    if (!net) return [];
    const dir = portDirection(source, roles, net);
    return dir ? [{ id: i.id, net, left: dir === "input" }] : [];
  });
  return { roles, ports };
}

function portGeometry(
  placed: SchematicDocument,
  resolver: SymbolResolver,
  context: ReturnType<typeof portRoles>,
) {
  const devices = {
    ...placed,
    instances: placed.instances.filter((i) => !isMarker(i)),
  };
  const box = enclosingBox(devices, resolver);
  const seats: Seats = new Map();
  for (const i of placed.instances)
    if (i.placement) seats.set(i.id, i.placement);
  if (!devices.instances.length || seats.size !== placed.instances.length)
    return;
  const pins = pinPoints(devices, resolver);
  const ports = context.ports.flatMap((p) => {
    const seat = seats.get(p.id);
    if (!seat) return [];
    const hosts = pins
      .filter((h) => context.roles.pinNet(h.instanceId, h.pinName) === p.net)
      .sort(
        (a, b) =>
          (p.left ? 1 : -1) * (a.point.x - b.point.x) ||
          Math.abs(a.point.y - seat.position.y) -
            Math.abs(b.point.y - seat.position.y),
      );
    return [{ ...p, seat, host: hosts[0]?.point }];
  });
  return { seats, ports, box };
}
type Geometry = NonNullable<ReturnType<typeof portGeometry>>;
type Port = Geometry["ports"][number];

function* edgeColumns(
  geo: Geometry,
  group: Port[],
  grid: number,
  offsets: readonly number[],
  jogs: readonly number[] = [0],
) {
  if (!group.length) return;
  for (const offset of offsets)
    for (const jog of jogs)
      for (const anchor of ["port", "pin"]) {
        const trial = new Map(geo.seats);
        for (const left of [true, false]) {
          const x =
            grid *
            (left
              ? Math.floor(geo.box.x / grid) - offset
              : Math.ceil((geo.box.x + geo.box.width) / grid) + offset);
          const entries = group
            .filter((p) => p.left === left)
            .map((p) => ({
              p,
              y: anchor === "pin" && p.host ? p.host.y : p.seat.position.y,
            }))
            .sort(
              (a, b) =>
                a.y - b.y ||
                a.p.seat.position.y - b.p.seat.position.y ||
                a.p.id.localeCompare(b.p.id),
            );
          let previous = -Infinity;
          for (const { p, y } of entries) {
            const row = Math.max(
              grid * (Math.round(y / grid) + jog),
              previous + 3 * grid,
            );
            trial.set(p.id, placement(x, row, left ? "none" : "horizontal"));
            previous = row;
          }
        }
        yield trial;
      }
}

// A port first reaches the correct half of the circuit, then its outer edge.
function portLevels(geo: Geometry, seats: Seats) {
  const mid = geo.box.x + geo.box.width / 2;
  return geo.ports.map((p) => {
    const x = seats.get(p.id)!.position.x;
    const distance = p.left ? mid - x : x - mid;
    return distance > geo.box.width / 2 ? 2 : distance > 0 ? 1 : 0;
  });
}
function improves(next: number[], previous: number[]) {
  return (
    next.length === previous.length &&
    next.every((v, i) => v >= previous[i]!) &&
    next.some((v, i) => v > previous[i]!)
  );
}

type Frame = "existing" | "mirror" | "tight" | "gate" | "jog" | "interior";
function* frames(
  mode: Frame,
  placed: SchematicDocument,
  geo: Geometry,
  context: ReturnType<typeof portRoles>,
) {
  if (mode === "existing" || mode === "jog" || mode === "interior") {
    yield placed;
    return;
  }
  const grid = placed.presentation.grid,
    snap = (x: number) => grid * Math.round(x / grid);
  const cx = snap(geo.box.x + geo.box.width / 2),
    cy = snap(geo.box.y + geo.box.height / 2);
  for (const scale of mode === "tight" ? [0.75, 0.9] : [1]) {
    const seats = new Map(geo.seats);
    let changed = false;
    for (const i of placed.instances) {
      const p = seats.get(i.id)!;
      const pins = mode === "gate" && channelPins(i.symbolId);
      const flipGate =
        pins &&
        p.rotation === 0 &&
        p.mirror === "horizontal" &&
        context.ports.some(
          (port) =>
            port.left && port.net === context.roles.pinNet(i.id, pins.gate),
        );
      const pose =
        mode === "mirror" || flipGate ? reflectOrientation(p, "left-right") : p;
      const x = cx + (p.position.x - cx) * (mode === "mirror" ? -1 : scale),
        y = cy + (p.position.y - cy) * scale;
      const position = { x: snap(x), y: snap(y) };
      changed ||=
        pose !== p ||
        position.x !== p.position.x ||
        position.y !== p.position.y;
      seats.set(i.id, { ...pose, position });
    }
    if (mode !== "gate" || changed) yield withPlacements(placed, seats);
  }
}

/** A long horizontal output wire can already reach the correct half. Try port
 * positions along its span at the nearby levels of that same Net. */
function corridorPositions(
  doc: SchematicDocument,
  resolver: SymbolResolver,
  p: Port,
  geo: Geometry,
) {
  const segments = doc.routes
    .filter((r) => r.netId === p.net)
    .flatMap((r) => resolveRouteGeometry(doc, resolver, r)?.segments ?? []);
  const grid = doc.presentation.grid,
    mid = geo.box.x + geo.box.width / 2;
  const rows = [...new Set(segments.flatMap((s) => [s.from.y, s.to.y]))]
    .sort(
      (a, b) =>
        Math.abs(a - p.seat.position.y) - Math.abs(b - p.seat.position.y),
    )
    .slice(0, 4);
  const columns = new Set<number>();
  for (const { from, to } of segments) {
    if (from.y !== to.y) continue;
    for (const fraction of [1 / 3, 1 / 2, 2 / 3]) {
      const x = grid * Math.round((from.x + (to.x - from.x) * fraction) / grid);
      if (p.left ? x < mid : x > mid) columns.add(x);
    }
  }
  return [...columns]
    .sort(
      (a, b) =>
        Math.abs(a - p.seat.position.x) - Math.abs(b - p.seat.position.x),
    )
    .slice(0, 6)
    .flatMap((x) =>
      rows.filter((y) => Number.isInteger(y / grid)).map((y) => ({ x, y })),
    );
}
/** Use the prior finished drawing as the per-document routing budget. A port
 * is on its side only when its terminal lies beyond every device body. */
export function selectNetlistPortSides(
  source: SchematicDocument,
  resolver: SymbolResolver,
  initial: Trial,
  route: RouteSeats,
  stopped: () => boolean,
  routePort?: RoutePort,
  placementProblem = (placed: SchematicDocument) =>
    geometryProblem(placed, resolver),
) {
  const context = portRoles(source, resolver);
  if (!context.ports.length) return initial.candidate;
  if (stopped()) return initial.candidate;
  const groups = mirrorPortGroups(source, resolver, context.ports);
  const trace = differentialBranches(source, resolver);
  // Share trials across passes and symmetry seeds. Check each returned
  // drawing against the current incumbent even on a cache hit.
  const trials = new Map<string, Trial | undefined>();
  const limit = source.instances.length > 24 ? 12 : Infinity;
  const baseline = auditRouting(initial.final, resolver);
  const withinWireBudget = (drawing: SchematicDocument) => {
    const a = auditRouting(drawing, resolver);
    return (
      a.crossings <= baseline.crossings &&
      a.bends <= baseline.bends + 2 &&
      a.wireLength <= baseline.wireLength * 1.1
    );
  };
  const routeOnce = (seats: Seats) => {
    const key = seatKey(source, seats);
    if (trials.has(key)) return trials.get(key);
    if (trials.size >= limit || placementProblem(withPlacements(source, seats)))
      return;
    const trial = route(seats, withinWireBudget);
    trials.set(key, trial);
    return trial;
  };
  // A local trial can touch several signal nets. Its separate allowance
  // keeps exhausted full-route budgets from turning into unbounded local work.
  const localResults = new WeakMap<
    SchematicDocument,
    Map<string, Trial | undefined>
  >();
  let localTrials = 0;
  const localRoute =
    routePort &&
    ((base: Trial, moves: Seats) => {
      const key = seatKey(source, moves);
      let cached = localResults.get(base.final);
      if (cached?.has(key)) return cached.get(key);
      if (localTrials >= limit) return;
      if (!cached) {
        cached = new Map();
        localResults.set(base.final, cached);
      }
      const trial = routePort(base, moves, withinWireBudget, () => {
        localTrials++;
      });
      cached.set(key, trial);
      return trial;
    });
  const run = (seed: Trial, pairs: typeof groups) =>
    searchPortLayouts(
      source,
      resolver,
      seed,
      initial,
      context,
      pairs,
      trace,
      routeOnce,
      stopped,
      placementProblem,
      localRoute,
    );
  const best = run(initial, groups);
  if (!groups.length || stopped()) return best.candidate;
  const errors = (trial: Trial) =>
    portMirrorGeometry(trial.final, resolver, groups).map((p) => [
      p.centring,
      p.alignment,
      p.arms,
      p.facing,
    ]);
  const after = errors(best);
  if (after.every((pair) => pair.every((n) => n === 0))) return best.candidate;
  // A directional arrangement can incidentally solve a different terminal
  // pair. Preserve that result as a second seed when the first search loses
  // a component of symmetry already attainable within the same routing budget.
  const directional = run(initial, []);
  if (directional === initial) return best.candidate;
  const prior = errors(directional);
  if (!after.some((pair, i) => pair.some((v, j) => v > prior[i]![j]!)))
    return best.candidate;
  const alternate = run(directional, groups);
  // Protect exact pairs in the device-first seed as well as the directional
  // seed when their partial (imperfect) arrangements are incomparable.
  const original = errors(initial),
    next = errors(alternate);
  if (
    original.some(
      (pair, i) => pair.every((v) => v === 0) && next[i]!.some((v) => v !== 0),
    )
  )
    return best.candidate;
  return alternate.candidate;
}

function searchPortLayouts(
  source: SchematicDocument,
  resolver: SymbolResolver,
  initial: Trial,
  budget: Trial,
  context: ReturnType<typeof portRoles>,
  groups: ReturnType<typeof mirrorPortGroups>,
  trace: ReturnType<typeof differentialBranches>,
  route: RouteSeats,
  stopped: () => boolean,
  placementProblem: (placed: SchematicDocument) => string | undefined,
  routePort?: (base: Trial, moves: Seats) => Trial | undefined,
): Trial {
  const bounded = source.instances.length > 24;
  const first = portGeometry(initial.final, resolver, context);
  if (!first) return initial;
  let levels = portLevels(first, first.seats);
  if (!groups.length && levels.every((n) => n === 2)) return initial;
  const main = new Set(trace ? [...trace.inputs, ...trace.outputs] : []);
  const cap = auditRouting(budget.final, resolver),
    guards = routedGuards(budget.final, resolver);
  const labels = diagnoseLabelClearance(budget.final, resolver).length;
  let best = initial;
  const geometry = (drawing: SchematicDocument) =>
    portMirrorGeometry(drawing, resolver, groups);
  const mirrorScore = (drawing: SchematicDocument, seats: Seats) => {
    const pairs = geometry(drawing);
    return [
      ...pairs.flatMap((p) => [
        p.axis.error,
        p.centring,
        p.alignment,
        p.arms,
        p.facing,
      ]),
      ...(trace && pairs.length
        ? [
            branchInterleaving(
              trace,
              seats,
              pairs.find((p) => trace.inputs.includes(p.a.id))?.axis.across,
            ),
          ]
        : []),
    ];
  };
  let symmetry = mirrorScore(initial.final, first.seats);
  const admissible = (trial: Trial) => {
    const a = auditRouting(trial.final, resolver);
    if (
      a.unsafeProblems.length ||
      a.crossings > cap.crossings ||
      a.bends > cap.bends + 2 ||
      a.wireLength > cap.wireLength * 1.1 ||
      diagnoseLabelClearance(trial.final, resolver).length > labels ||
      Object.entries(routedGuards(trial.final, resolver)).some(
        ([k, v]) => v > (guards[k] ?? 0),
      )
    )
      return;
    return a;
  };
  const tryRepair = (trial: Trial | undefined) => {
    if (!trial) return;
    const next = portGeometry(trial.final, resolver, context)!;
    const score = mirrorScore(trial.final, next.seats);
    if (score.some((v, i) => v > symmetry[i]!)) return;
    const nextLevels = portLevels(next, next.seats);
    if (!improves(symmetry, score) && !improves(nextLevels, levels)) return;
    if (!admissible(trial)) return;
    best = trial;
    symmetry = score;
    levels = nextLevels;
  };
  // Restore each port against its component's device axis. A complete pair,
  // a single displaced mate and a shared axis terminal use the same objective.
  for (
    let pass = 0;
    pass < groups.reduce((n, g) => n + g.terminals.length, 0) && !stopped();
    pass++
  ) {
    const start = best;
    const geo = portGeometry(start.final, resolver, context)!;
    for (const { moving, position } of reflectedPortTargets(
      geometry(start.final),
      geo.seats,
      source.presentation.grid,
    )) {
      if (stopped()) return best;
      tryRepair(
        slideNetlistPort(
          source,
          resolver,
          start,
          moving.id,
          moving.net,
          position,
        ),
      );
      const seats = new Map(geo.seats);
      seats.set(moving.id, { ...seats.get(moving.id)!, position });
      tryRepair(route(seats));
    }
    if (best === start) break;
  }
  let probeCorridors = false;
  // A pass either improves a port without displacing a settled port, or ends
  // the search. The maximum number of accepted passes is twice the port count.
  while (levels.some((n) => n < 2) && !stopped()) {
    const start = best,
      previous = levels;
    const current = portGeometry(start.final, resolver, context)!;
    let rank: number[] | undefined;
    const seen = new Set<string>();
    // R170: every trial of the mirror frame is a whole-drawing reflection.
    const finishPass = () =>
      (bounded && best !== start) || levels.every((n) => n === 2);
    const consider = (trial: Trial | undefined, mirrored = false) => {
      if (!trial) return;
      if (
        mirrored &&
        reflectionWorsensDirection(best.final, trial.final, resolver)
      )
        return;
      const final = portGeometry(trial.final, resolver, context);
      if (!final) return;
      const next = portLevels(final, final.seats);
      if (!improves(next, previous)) return;
      const mirror = mirrorScore(trial.final, final.seats);
      if (mirror.some((v, i) => v > symmetry[i]!)) return;
      const a = admissible(trial);
      if (!a) return;
      const signals = next.filter((_, i) => main.has(final.ports[i]!.id));
      const score = [
        signals.filter((n) => n === 0).length,
        next.filter((n) => n === 0).length,
        signals.filter((n) => n < 2).length,
        next.filter((n) => n < 2).length,
        a.crossings,
        a.bends,
        a.wireLength,
      ];
      if (rank && !improves(symmetry, mirror)) {
        const k = score.findIndex((v, i) => v !== rank![i]);
        if (k === -1 || score[k]! >= rank[k]!) return;
      }
      symmetry = mirror;
      rank = score;
      best = trial;
      levels = next;
    };
    const routeCandidate = (seats: Seats, geo: Geometry, mirrored: boolean) => {
      if (!improves(portLevels(geo, seats), previous)) return;
      const key = seatKey(source, seats);
      if (seen.has(key)) return;
      const placed = withPlacements(start.final, seats);
      if (mirrored && reflectionWorsensDirection(best.final, placed, resolver))
        return;
      // Final facing keeps the pin fixed, but can change its exit and wire
      // departures. Only the device axis and the terminal coordinates are
      // invariant for these port-only moves.
      if (groups.length && geo === current) {
        const geometry = portMirrorGeometry(placed, resolver, groups, true);
        if (
          geometry.some(
            (g, i) =>
              g.axis.error > (symmetry[5 * i] ?? Infinity) ||
              g.centring > (symmetry[5 * i + 1] ?? Infinity) ||
              g.alignment > (symmetry[5 * i + 2] ?? Infinity),
          )
        )
          return;
      }
      seen.add(key);
      if (placementProblem(placed)) return;
      if (routePort && geo === current && bounded) {
        const moves: Seats = new Map();
        for (const port of geo.ports) {
          const pose = seats.get(port.id);
          if (pose && !samePlacement(pose, port.seat)) moves.set(port.id, pose);
        }
        if (moves.size) {
          const before = best;
          consider(routePort(start, moves));
          if (best !== before) return;
        }
      }
      consider(route(seats), mirrored);
    };
    // Reflect the already routed drawing before trying new edge columns.
    if (!probeCorridors) {
      const grid = source.presentation.grid;
      const axis =
        grid * Math.round((current.box.x + current.box.width / 2) / grid);
      const frame = frames("mirror", start.final, current, context).next()
        .value;
      const geo = frame && portGeometry(frame, resolver, context);
      if (geo && improves(portLevels(geo, geo.seats), previous)) {
        consider(reflectNetlistPlan(source, resolver, start, axis), true);
        if (bounded && finishPass()) continue;
      }
    }
    const grid = source.presentation.grid,
      mid = current.box.x + current.box.width / 2;
    for (const [index, p] of current.ports.entries()) {
      if (previous[index] === 2) continue;
      if (probeCorridors) {
        if (previous[index] === 0 && main.has(p.id))
          for (const position of corridorPositions(
            start.final,
            resolver,
            p,
            current,
          )) {
            if (stopped()) return best;
            consider(
              slideNetlistPort(source, resolver, start, p.id, p.net, position),
            );
          }
        continue;
      }
      const sign = p.left ? -1 : 1;
      const outward = (x: number) =>
        grid * ((p.left ? Math.ceil(x / grid) : Math.floor(x / grid)) + sign);
      const edge = outward(
        p.left ? current.box.x : current.box.x + current.box.width,
      );
      const columns =
        previous[index] === 0
          ? [edge, outward(mid), outward(mid) + sign * grid]
          : [edge];
      for (const x of columns)
        for (const dy of [0, -1, 1, -2, 2]) {
          if (stopped()) return best;
          consider(
            slideNetlistPort(source, resolver, start, p.id, p.net, {
              x,
              y: p.seat.position.y + dy * grid,
            }),
          );
        }
    }
    if (bounded && finishPass()) continue;
    const modes = [
      "existing",
      "mirror",
      "interior",
      "gate",
      "tight",
      "jog",
    ] as const;
    for (const offsets of bounded ? [[1], [2], [4]] : [[1, 2, 4]]) {
      for (const mode of probeCorridors ? [] : modes) {
        if (mode === "interior" && offsets[0] !== 1) continue;
        const mirrored = mode === "mirror";
        if (stopped()) break;
        for (const drawing of frames(mode, start.final, current, context)) {
          const geo =
            drawing === start.final
              ? current
              : portGeometry(drawing, resolver, context)!;
          const status = portLevels(geo, geo.seats);
          const wrong = geo.ports.filter(
            (_, i) => status[i]! < (mode === "interior" ? 1 : 2),
          );
          if (mode === "mirror" || mode === "tight")
            routeCandidate(geo.seats, geo, mirrored);
          if (!wrong.length) continue;
          const groups =
            mode === "jog"
              ? wrong.map((p) => [p])
              : [
                  geo.ports,
                  wrong,
                  wrong.filter((p) => main.has(p.id)),
                  ...(mode === "existing" || mode === "interior"
                    ? [
                        wrong.filter((p) => p.left),
                        wrong.filter((p) => !p.left),
                        ...wrong.map((p) => [p]),
                      ]
                    : []),
                ];
          for (const inset of mode === "interior" ? [0.2, 0.4] : [0]) {
            const columns = inset
              ? {
                  ...geo,
                  box: {
                    ...geo.box,
                    x: geo.box.x + inset * geo.box.width,
                    width: geo.box.width * (1 - 2 * inset),
                  },
                }
              : geo;
            for (const group of groups)
              for (const seats of edgeColumns(
                columns,
                group,
                source.presentation.grid,
                mode === "interior" ? [1] : offsets,
                mode === "jog" ? [-2, 2] : [0],
              )) {
                if (stopped()) return best;
                const before = best;
                routeCandidate(seats, geo, mirrored);
                if (
                  levels.every((n) => n === 2) ||
                  (bounded &&
                    best !== before &&
                    group.every((p) => levels[geo.ports.indexOf(p)] === 2) &&
                    auditRouting(best.final, resolver).crossings === 0)
                )
                  break;
              }
          }
        }
        if (finishPass()) break;
      }
      if (finishPass()) break;
    }
    if (best === start) {
      if (
        probeCorridors ||
        !current.ports.some((p, i) => main.has(p.id) && levels[i] === 0)
      )
        break;
      probeCorridors = true;
    }
  }
  // First slide along the grid, then try both port- and device-anchored pairs.
  // Repeat only after a strict symmetry gain or a side gain at equal symmetry.
  if (groups.length) {
    let changed: boolean;
    do {
      changed = false;
      const beforeSlide = best;
      for (const { moving, position } of reflectedPortTargets(
        geometry(beforeSlide.final),
        portGeometry(beforeSlide.final, resolver, context)!.seats,
        source.presentation.grid,
        true,
      )) {
        if (stopped()) return best;
        tryRepair(
          slideNetlistPort(
            source,
            resolver,
            beforeSlide,
            moving.id,
            moving.net,
            position,
          ),
        );
      }
      changed = beforeSlide !== best;
      for (const mode of ["ports", "hosts"] as const) {
        const start = best;
        const geo = portGeometry(start.final, resolver, context)!;
        const hosts =
          mode === "hosts"
            ? pinPoints(
                {
                  ...start.final,
                  instances: start.final.instances.filter((i) => !isMarker(i)),
                },
                resolver,
              ).map((h) => ({
                net: context.roles.pinNet(h.instanceId, h.pinName),
                point: h.point,
              }))
            : [];
        for (const seats of pairedPortSeats(
          mode,
          geometry(start.final),
          geo.seats,
          hosts,
          source.presentation.grid,
        )) {
          if (stopped()) return best;
          tryRepair(route(seats));
        }
        if (start !== best) changed = true;
      }
    } while (changed);
  }
  return best;
}
