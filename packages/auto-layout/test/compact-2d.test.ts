import { expect, it, vi } from "vitest";
import { createRoutePath, type SchematicDocument } from "@icm/model";
import { builtInSymbols, InMemorySymbolResolver } from "@icm/symbols";
import {
  compactFinalist2D,
  connectionsIntact,
  planLayoutOnce,
} from "../src/auto-layout.js";
import { compactPlacements, compactRows } from "../src/compact.js";
import { generateCompacted2DCandidates } from "../src/compact-2d.js";
import * as drafting from "../src/follow-drafting-groups.js";
import {
  geometryProblem,
  pinPoints,
  placement,
  withPlacements,
} from "../src/geometry.js";
import { emptyOverrides } from "../src/layout-choices.js";
import { classifyNets } from "../src/net-roles.js";
import { layoutAspectMetrics } from "../src/pack-rows.js";
import { netlistSymmetry } from "../src/readability-netlist-symmetry.js";
import { readabilityTerm } from "../src/readability-selection.js";
import { recognizeStructures } from "../src/recognize.js";
import * as routing from "../src/route.js";
import { auditRouting } from "../src/routing-audit.js";
import { preview, terminalPartition } from "../src/transaction.js";
import type { AutoLayoutOptions, AutoLayoutResult } from "../src/types.js";
import { circuit } from "./document-fixture.js";

const resolver = new InMemorySymbolResolver(builtInSymbols);
const identity = (r: AutoLayoutResult) => r;
const base = (): AutoLayoutResult => ({
  edits: [],
  diagnostics: [],
  groups: [],
});
function candidates(d: SchematicDocument) {
  const roles = classifyNets(d, resolver);
  return generateCompacted2DCandidates(
    d,
    resolver,
    roles,
    recognizeStructures(d, roles),
    () => false,
  );
}

function rows(columns: number, xPitch: number, yPitch: number, stagger = 0) {
  const symbols: Record<string, string> = {},
    nets: Record<string, string[]> = {};
  for (let row = 0; row < 2; row++)
    for (let col = 0; col < columns; col++) {
      const id = row + "-" + col;
      symbols[id] = "resistor";
      if (col % 2)
        nets[id + "-link"] = [row + "-" + (col - 1) + ".2", id + ".1"];
    }
  const d = circuit(symbols, nets);
  for (const [j, i] of d.instances.entries()) {
    const row = Math.floor(j / columns);
    i.placement = placement(
      (j % columns) * xPitch + row * stagger,
      row * yPitch,
      "none",
      270,
    );
  }
  return d;
}

it("compresses staggered rows blocked in both global sweeps and routes them without crossings", () => {
  const d = rows(4, 140, 50, 70);
  d.presentation.grid = 5;
  expect(compactPlacements(d, resolver, [])).toBeUndefined();
  expect(
    compactRows(d, resolver, [], classifyNets(d, resolver), []),
  ).toBeUndefined();
  const [poses] = candidates(d);
  expect(poses).toBeDefined();
  expect(candidates(d)[0]).toEqual(poses);
  const before = layoutAspectMetrics(d, resolver).devices;
  const after = layoutAspectMetrics(d, resolver, poses).devices;
  expect(after.width).toBeLessThan(before.width);
  expect(after.height).toBeLessThan(before.height);
  expect(after.area).toBeLessThanOrEqual(before.area * 0.75);
  for (const { position } of poses!.values())
    for (const coordinate of [position.x, position.y])
      expect(Math.abs(coordinate % d.presentation.grid)).toBe(0);
  expect(geometryProblem(withPlacements(d, poses!), resolver)).toBeUndefined();
  const trial = planLayoutOnce(
    d,
    resolver,
    {},
    emptyOverrides(),
    "template",
    true,
    poses,
  );
  expect(trial.final).toBeDefined();
  expect(connectionsIntact(trial.final!, resolver)).toBe(true);
  expect(auditRouting(trial.final!, resolver).crossings).toBe(0);
}, 30000);

function differentialStage() {
  return circuit(
    {
      a: "nmos",
      b: "nmos",
      l: "resistor",
      r: "resistor",
      tail: "current-source",
      side: "resistor",
    },
    {
      left: ["a.D", "l.2"],
      right: ["b.D", "r.2"],
      common: ["a.S", "b.S", "tail.+"],
      vdd: ["l.1", "r.1"],
      inp: ["a.G"],
      inn: ["b.G"],
    },
  );
}

it("compresses a differential stage vertically while preserving its mirror axis and row pairs", () => {
  const d = differentialStage();
  const coords = [
    [0, 200],
    [120, 200],
    [10, 0],
    [110, 0],
    [60, 430],
    [610, 200],
  ] as const;
  for (const [j, i] of d.instances.entries())
    i.placement = placement(
      coords[j]![0],
      coords[j]![1],
      j === 1 ? "horizontal" : "none",
    );
  const [poses] = candidates(d);
  expect(poses).toBeDefined();
  const pos = (id: string) => poses!.get(id)!.position;
  for (const [a, b] of [
    ["a", "b"],
    ["l", "r"],
  ] as const) {
    expect(pos(a).y).toBe(pos(b).y);
    expect(pos("tail").x - pos(a).x).toBe(pos(b).x - pos("tail").x);
  }
  expect(pos("b").x - pos("a").x).toBe(120);
  expect(pos("a").y - pos("l").y).toBeLessThan(200);
  expect(pos("tail").y - pos("a").y).toBeLessThan(230);
  expect(
    netlistSymmetry(withPlacements(d, poses!), resolver).violations,
  ).toBeLessThanOrEqual(netlistSymmetry(d, resolver).violations);
});

it("keeps aligned conducting pins level on horizontal and vertical nets", () => {
  const d = circuit(
    { a: "resistor", b: "resistor", c: "resistor", e: "resistor" },
    { vertical: ["a.2", "b.1"], horizontal: ["c.2", "e.1"] },
  );
  const places = [
    placement(200, 0),
    placement(200, 350),
    placement(0, 190, "none", 270),
    placement(430, 190, "none", 270),
  ];
  for (const [j, i] of d.instances.entries()) i.placement = places[j]!;
  const proposals = candidates(d);
  expect(proposals.length).toBeGreaterThan(0);
  for (const poses of proposals) {
    const points = pinPoints(withPlacements(d, poses), resolver);
    const pin = (id: string, name: string) =>
      points.find((p) => p.instanceId === id && p.pinName === name)!.point;
    expect(pin("a", "2").x).toBe(pin("b", "1").x);
    expect(pin("c", "2").y).toBe(pin("e", "1").y);
  }
});

it("reserves grid lanes for distinct routed signal nets in a corridor", () => {
  const d = rows(2, 300, 80);
  const pitch = () => {
    const [p] = candidates(d);
    return p!.get("0-1")!.position.x - p!.get("0-0")!.position.x;
  };
  const empty = pitch();
  for (const [j, netId] of ["track-a", "track-b", "track-a"].entries()) {
    if (!d.nets.some((n) => n.id === netId))
      d.nets.push({ id: netId, terminals: [] });
    const id = "track" + j;
    d.junctions.push(
      { id: id + "a", netId, position: { x: 90 + j * 20, y: -80 } },
      { id: id + "b", netId, position: { x: 90 + j * 20, y: 80 } },
    );
    d.routes.push(
      createRoutePath({
        id,
        netId,
        start: { kind: "junction", junctionId: id + "a" },
        end: { kind: "junction", junctionId: id + "b" },
        bends: [],
        modes: ["manual"],
      }),
    );
  }
  expect(pitch() - empty).toBe(2 * d.presentation.grid);
});

it("skips routing compact, fixed, locked and stopped finalists", () => {
  const compact = rows(2, 60, 40),
    loose = rows(4, 300, 80);
  expect(candidates(loose).length).toBeGreaterThan(0);
  const incumbent = base(),
    finish = vi.fn(identity);
  const route = vi.spyOn(routing, "routeDocument");
  try {
    expect(candidates(compact)).toEqual([]);
    expect(compactFinalist2D(compact, resolver, {}, incumbent, finish)).toBe(
      incumbent,
    );
    const options: AutoLayoutOptions[] = [
      { fixedInstanceIds: new Set(["0-0"]) },
      { search: { seed: 1, evaluations: 1, signal: AbortSignal.abort() } },
      { search: { seed: 1, evaluations: 1, deadline: 0 } },
      { search: { seed: 1, evaluations: 0 } },
    ];
    for (const opts of options)
      expect(compactFinalist2D(loose, resolver, opts, incumbent, finish)).toBe(
        incumbent,
      );
    loose.layoutGroups.push({
      id: "lock",
      kind: "custom",
      objectIds: ["0-0"],
      locked: true,
    });
    expect(compactFinalist2D(loose, resolver, {}, incumbent, finish)).toBe(
      incumbent,
    );
    expect(route).not.toHaveBeenCalled();
    expect(finish).not.toHaveBeenCalled();
  } finally {
    route.mockRestore();
  }
});

it("discards drafting fallback before finishing or changing the incumbent", () => {
  const d = rows(4, 300, 80);
  const center = { x: 450, y: 100 };
  d.drafting = {
    objects: [
      {
        id: "frame",
        kind: "rectangle",
        locked: false,
        zIndex: 0,
        anchor: { kind: "free", position: center },
        center,
        width: 4000,
        height: 800,
        rotation: 0,
        lineStyle: "solid",
      },
    ],
  };
  const incumbent = base(),
    original = structuredClone(incumbent),
    finish = vi.fn(identity);
  const seat = vi.spyOn(drafting, "followDraftingGroups");
  try {
    expect(compactFinalist2D(d, resolver, {}, incumbent, finish)).toBe(
      incumbent,
    );
    expect(seat).toHaveBeenCalled();
    expect(seat.mock.results[0]!.value).toBe(seat.mock.calls[0]![2]);
    expect(finish).not.toHaveBeenCalled();
    expect(incumbent).toEqual(original);
  } finally {
    seat.mockRestore();
  }
}, 30000);

it.each([4, 21])(
  "promotes a smaller routed finalist with %i columns and its terminal partition intact",
  (columns) => {
    const d = rows(columns, 200, 80);
    const poses = new Map(d.instances.map((i) => [i.id, i.placement!]));
    const incumbent = planLayoutOnce(
      d,
      resolver,
      {},
      emptyOverrides(),
      "template",
      true,
      undefined,
      undefined,
      poses,
    );
    expect(incumbent.final).toBeDefined();
    const best = compactFinalist2D(d, resolver, {}, incumbent.result, identity);
    expect(best).not.toBe(incumbent.result);
    const after = preview(d, resolver, best.edits);
    if (!after.ok) throw Error("Invalid compacted transaction");
    if (d.instances.length <= 40)
      expect(readabilityTerm(after.document, resolver)).toBeLessThan(
        readabilityTerm(incumbent.final!, resolver),
      );
    expect(connectionsIntact(after.document, resolver)).toBe(true);
    expect(terminalPartition(after.document, resolver)).toBe(
      terminalPartition(incumbent.final!, resolver),
    );
    expect(
      layoutAspectMetrics(after.document, resolver).layout.area,
    ).toBeLessThan(
      layoutAspectMetrics(incumbent.final!, resolver).layout.area * 0.98,
    );
  },
  30000,
);

it("moves both sides of a loose multi-pair stage inward around its tail", () => {
  const d = differentialStage();
  const coords = [
    [-250, 200],
    [250, 200],
    [-240, 0],
    [240, 0],
    [0, 430],
    [610, 200],
  ];
  for (const [j, i] of d.instances.entries())
    i.placement = placement(
      coords[j]![0]!,
      coords[j]![1]!,
      j === 1 ? "horizontal" : "none",
    );
  const result = candidates(d).find(
    (p) => p.get("b")!.position.x - p.get("a")!.position.x < 500,
  );
  expect(result).toBeDefined();
  const x = (id: string) => result!.get(id)!.position.x;
  for (const [left, right] of [
    ["a", "b"],
    ["l", "r"],
  ] as const) {
    expect(x("tail") - x(left)).toBe(x(right) - x("tail"));
    expect(x(right) - x(left)).toBeLessThan(left === "a" ? 500 : 480);
  }
  expect(geometryProblem(withPlacements(d, result!), resolver)).toBeUndefined();
  expect(
    netlistSymmetry(withPlacements(d, result!), resolver).violations,
  ).toBeLessThanOrEqual(netlistSymmetry(d, resolver).violations);
});

it("reserves a seated ground marker's clearance below its host", () => {
  const d = circuit(
    { upper: "resistor", lower: "resistor", ground: "ground" },
    { rail: ["upper.2", "ground.0"] },
  );
  d.instances[0]!.placement = placement(0, 0);
  d.instances[1]!.placement = placement(0, 300);
  d.instances[2]!.placement = placement(0, 60);
  const bare = { ...d, instances: d.instances.slice(0, 2) };
  const pitch = (p: NonNullable<ReturnType<typeof candidates>[number]>) =>
    p.get("lower")!.position.y - p.get("upper")!.position.y;
  const [protectedPoses] = candidates(d);
  expect(pitch(protectedPoses!)).toBeGreaterThan(pitch(candidates(bare)[0]!));
  expect(protectedPoses!.has("ground")).toBe(false);
  const host = protectedPoses!.get("upper")!.position;
  const reseated = new Map(protectedPoses);
  reseated.set("ground", placement(host.x, host.y + 60));
  expect(
    geometryProblem(withPlacements(d, reseated), resolver),
  ).toBeUndefined();
});

it("condenses interlocking L-shaped units and compacts the neighboring column", () => {
  const coords = [
    [0, 0],
    [0, 160],
    [200, 160],
    [100, 0],
    [300, 0],
    [100, 160],
    [750, 0],
  ];
  const d = circuit(
    Object.fromEntries(coords.map((_, j) => [String(j), "resistor"])),
    {},
  );
  d.instances.forEach((i, j) => {
    i.placement = placement(coords[j]![0]!, coords[j]![1]!);
  });
  for (const ids of [
    ["0", "1", "2"],
    ["3", "4", "5"],
  ])
    d.layoutGroups.push({
      id: "rigid" + ids[0],
      kind: "custom",
      objectIds: ids,
      locked: false,
    });
  const result = candidates(d).find(
    (p) => p.get("6")!.position.x - p.get("0")!.position.x < 750,
  );
  expect(result).toBeDefined();
  const x = (j: number) => result!.get(String(j))!.position.x;
  for (let j = 1; j < 6; j++) expect(x(j) - x(0)).toBe(coords[j]![0]);
  expect(geometryProblem(withPlacements(d, result!), resolver)).toBeUndefined();
});

it.each([
  [30, 2],
  [31, 1],
])("caps routed proposals for %i two-device columns", (columns, cap) => {
  const proposals = candidates(rows(columns, 200, 80));
  expect(proposals.length).toBeGreaterThan(0);
  expect(proposals.length).toBeLessThanOrEqual(cap);
});

it("shortlists an X-only placement alongside a valid two-axis compaction", () => {
  const d = rows(4, 200, 120);
  const proposals = candidates(d);
  const pitch = (
    poses: (typeof proposals)[number],
    id: string,
    axis: "x" | "y",
  ) => poses.get(id)!.position[axis] - poses.get("0-0")!.position[axis];
  expect(
    proposals.some(
      (p) => pitch(p, "0-1", "x") < 200 && pitch(p, "1-0", "y") === 120,
    ),
  ).toBe(true);
  expect(
    proposals.some(
      (p) => pitch(p, "0-1", "x") < 200 && pitch(p, "1-0", "y") < 120,
    ),
  ).toBe(true);
});
