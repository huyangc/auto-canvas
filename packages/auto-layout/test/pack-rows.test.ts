import { expect, it, vi } from "vitest";
import { builtInSymbols, InMemorySymbolResolver } from "@icm/symbols";
import { planWireBatch } from "@icm/edit-engine";
import { circuit } from "./document-fixture.js";
import {
  generateFoldedCandidates,
  layoutAspectMetrics,
  decomposePlacedBlocks,
  foldParallelBranches,
} from "../src/pack-rows.js";
import { placement, geometryProblem, withPlacements } from "../src/geometry.js";
import * as packing from "../src/pack-rows.js";
import * as drafting from "../src/follow-drafting-groups.js";
import * as routing from "../src/route.js";
import { findStages } from "../src/stages.js";
import { classifyNets } from "../src/net-roles.js";
import { auditRouting, missingConnections } from "../src/routing-audit.js";
import {
  connectionsIntact,
  foldElongatedFinalist,
  planLayoutOnce,
  planAutoLayout,
} from "../src/auto-layout.js";
import { emptyOverrides } from "../src/layout-choices.js";
import { preview, terminalPartition } from "../src/transaction.js";
import { createPlacementEstimator } from "../src/estimate.js";
import { drawnBodyLeads } from "../src/global-route-order.js";
import type { AutoLayoutOptions, AutoLayoutResult } from "../src/types.js";

const resolver = new InMemorySymbolResolver(builtInSymbols);
const running = () => false;
const unchanged = (result: AutoLayoutResult) => result;
function chains(count: number, size: number) {
  const symbols: Record<string, string> = {},
    nets: Record<string, string[]> = {};
  for (let i = 0; i < count * size; i++) {
    symbols[String(i)] = "resistor";
    if (i % size) nets["link" + i] = [String(i - 1) + ".2", String(i) + ".1"];
  }
  const document = circuit(symbols, nets);
  const poses = new Map(
    document.instances.map((i, index) => [
      i.id,
      placement(index * 100 + Math.floor(index / size) * 1000, 0, "none", 90),
    ]),
  );
  return { document: withPlacements(document, poses), poses };
}
it.each([2, 3])(
  "packs %i disconnected chains without introducing crossings",
  (count) => {
    const { document, poses } = chains(count, 3);
    const roles = classifyNets(document, resolver);
    const candidates = () =>
      generateFoldedCandidates(
        document,
        resolver,
        roles,
        [],
        poses,
        [],
        running,
      );
    const first = candidates();
    expect(candidates()).toEqual(first);
    expect(first.length).toBeGreaterThan(0);
    const best = first[0]!;
    expect(new Set([...best.values()].map((p) => p.position.y)).size).toBe(2);
    const grid = document.presentation.grid;
    const rowPitch =
      Math.max(...[...best.values()].map((p) => p.position.y)) -
      Math.min(...[...best.values()].map((p) => p.position.y));
    const rowHeight = layoutAspectMetrics(document, resolver, poses).devices
      .height;
    expect(rowPitch).toBe(
      Math.ceil((rowHeight + Math.ceil(40 / grid) * grid) / grid) * grid,
    );
    expect(
      layoutAspectMetrics(document, resolver, best).devices.aspectRatio,
    ).toBeLessThan(
      layoutAspectMetrics(document, resolver).devices.aspectRatio * 0.65,
    );
    const trial = planLayoutOnce(
      document,
      resolver,
      {},
      emptyOverrides(),
      "stages",
      true,
      best,
    );
    expect(trial.final, JSON.stringify(trial.result.diagnostics)).toBeDefined();
    expect(connectionsIntact(trial.final!, resolver)).toBe(true);
    expect(auditRouting(trial.final!, resolver).crossings).toBe(0);
  },
);

it.each([4, 6])("folds a %i-stage signal sequence on grid", (count) => {
  const symbols: Record<string, string> = {},
    nets: Record<string, string[]> = {};
  for (let i = 0; i < count; i++) {
    symbols["amp" + i] = "nmos";
    symbols["load" + i] = "resistor";
    nets["output" + i] = [
      "amp" + i + ".D",
      "load" + i + ".1",
      ...(i + 1 < count ? ["amp" + (i + 1) + ".G"] : []),
    ];
  }
  const document = circuit(symbols, nets);
  const poses = new Map(
    document.instances.map((i, j) => [
      i.id,
      placement(Math.floor(j / 2) * 240, (j % 2) * 100),
    ]),
  );
  const roles = classifyNets(document, resolver);
  expect(
    findStages(document.instances, resolver, roles, []).stages,
  ).toHaveLength(count);
  const [best] = generateFoldedCandidates(
    document,
    resolver,
    roles,
    [],
    poses,
    [],
    running,
  );
  expect(best).toBeDefined();
  expect(
    geometryProblem(withPlacements(document, best!), resolver),
  ).toBeUndefined();
  const rows = new Set(
    document.instances
      .filter((i) => i.symbolId === "nmos")
      .map((i) => best!.get(i.id)!.position.y),
  );
  expect(rows.size).toBeGreaterThanOrEqual(2);
  for (const p of best!.values()) {
    expect(p.position.x % document.presentation.grid).toBe(0);
    expect(p.position.y % document.presentation.grid).toBe(0);
  }
  expect(
    layoutAspectMetrics(document, resolver, best).devices.aspectRatio,
  ).toBeLessThan(
    layoutAspectMetrics(document, resolver, poses).devices.aspectRatio,
  );
});

it("centers a shared output stage between independent branches", () => {
  const { document, poses } = chains(3, 2);
  document.nets.push(
    {
      id: "first output",
      terminals: [
        { instanceId: "1", pinName: "2" },
        { instanceId: "4", pinName: "1" },
      ],
    },
    {
      id: "second output",
      terminals: [
        { instanceId: "3", pinName: "2" },
        { instanceId: "5", pinName: "2" },
      ],
    },
  );
  const roles = classifyNets(document, resolver);
  const known = {
    stages: [0, 2, 4].map((i) => ({
      id: String(i),
      devices: document.instances.slice(i, i + 2),
    })),
    bridges: [],
  };
  const { stages, pins } = decomposePlacedBlocks(
    document,
    resolver,
    roles,
    [],
    poses,
    [],
    known,
  );
  const [packed] = foldParallelBranches(
    stages,
    pins,
    60,
    document.presentation.grid,
    running,
  );
  expect(packed).toBeDefined();
  const a = packed!.get("0")!.position,
    b = packed!.get("2")!.position,
    hub = packed!.get("4")!.position;
  expect(a.x).toBe(b.x);
  expect(hub.x).toBeGreaterThan(a.x);
  expect(Math.abs(hub.y - (a.y + b.y) / 2)).toBeLessThanOrEqual(
    document.presentation.grid,
  );
  const estimate = createPlacementEstimator(
    document.instances,
    resolver,
    roles,
  );
  expect(estimate(packed!).length).toBeLessThan(estimate(poses).length);
});

it("skips square geometry and honors fixed, locked and stopped searches before finishing a trial", () => {
  const { document, poses } = chains(2, 3);
  const square = new Map(
    document.instances.map((i, index) => [
      i.id,
      placement((index % 3) * 100, Math.floor(index / 3) * 200),
    ]),
  );
  expect(
    generateFoldedCandidates(
      document,
      resolver,
      classifyNets(document, resolver),
      [],
      square,
      [],
      running,
    ),
  ).toEqual([]);
  const finish = vi.fn(unchanged);
  const base = { edits: [], groups: [], diagnostics: [] };
  const options: AutoLayoutOptions[] = [
    { fixedInstanceIds: new Set(["0"]) },
    { search: { seed: 1, evaluations: 1, deadline: 0 } },
    { search: { seed: 1, evaluations: 1, signal: AbortSignal.abort() } },
  ];
  for (const option of options)
    expect(
      foldElongatedFinalist(document, resolver, option, base, finish),
    ).toBe(base);
  expect(
    foldElongatedFinalist(
      withPlacements(document, square),
      resolver,
      {},
      base,
      finish,
    ),
  ).toBe(base);
  document.layoutGroups.push({
    id: "locked",
    kind: "custom",
    objectIds: ["0", "1"],
    locked: true,
  });
  expect(foldElongatedFinalist(document, resolver, {}, base, finish)).toBe(
    base,
  );
  expect(finish).not.toHaveBeenCalled();
  expect(
    generateFoldedCandidates(
      document,
      resolver,
      classifyNets(document, resolver),
      [],
      poses,
      [],
      () => true,
    ),
  ).toEqual([]);
});

it("leaves the incumbent untouched when drafting cannot be seated on a folded trial", () => {
  const { document } = chains(2, 3);
  const center = { x: 600, y: 0 };
  document.drafting = {
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
  const base: AutoLayoutResult = { edits: [], diagnostics: [], groups: [] };
  const original = structuredClone(base);
  const seat = vi.spyOn(drafting, "followDraftingGroups");
  const finish = vi.fn((result: AutoLayoutResult) => {
    result.diagnostics.push({
      code: "test",
      rule: "test",
      severity: "warning",
      message: "finished",
    });
    return result;
  });
  try {
    expect(foldElongatedFinalist(document, resolver, {}, base, finish)).toBe(
      base,
    );
    expect(seat).toHaveBeenCalled();
    expect(seat.mock.results[0]!.value).toBe(seat.mock.calls[0]![2]);
    expect(finish).not.toHaveBeenCalled();
    expect(base).toEqual(original);
  } finally {
    seat.mockRestore();
  }
});

it("promotes a routed fold above forty devices and retains its terminal partition", () => {
  const { document, poses } = chains(14, 3);
  // Each rigid component starts on its own signal level in the strip.
  for (const [id, pose] of poses)
    pose.position.y = (Math.floor(Number(id) / 3) % 2) * 100;
  const base = planLayoutOnce(
    document,
    resolver,
    {},
    emptyOverrides(),
    "template",
    true,
    undefined,
    undefined,
    poses,
  );
  expect(base.final, JSON.stringify(base.result.diagnostics)).toBeDefined();
  const folded = foldElongatedFinalist(
    document,
    resolver,
    {},
    base.result,
    unchanged,
  );
  const after = preview(document, resolver, folded.edits);
  if (!after.ok) throw Error("invalid folded transaction");
  expect(missingConnections(after.document, resolver)).toBe(0);
  expect(terminalPartition(after.document, resolver)).toBe(
    terminalPartition(base.final!, resolver),
  );
  expect(
    layoutAspectMetrics(after.document, resolver).layout.aspectRatio,
  ).toBeLessThan(layoutAspectMetrics(base.final!, resolver).layout.aspectRatio);
}, 60000);

it("preserves a drawn body lead across an elongated finalist trial", () => {
  const { document } = chains(2, 3);
  document.instances.push({
    id: "body",
    symbolId: "pmos",
    placement: placement(0, 200),
  });
  const wire = planWireBatch(
    document,
    resolver,
    {
      id: "body wire",
      from: {
        kind: "endpoint",
        endpoint: { kind: "terminal", instanceId: "body", pinName: "B" },
      },
      to: {
        kind: "endpoint",
        endpoint: { kind: "terminal", instanceId: "0", pinName: "1" },
      },
    },
    100,
    { keepClear: true, netScope: "base" },
  );
  if (typeof wire === "string") throw Error(wire);
  const result = preview(document, resolver, wire.edits);
  if (!result.ok) throw Error(JSON.stringify(result));
  const finish = vi.fn(unchanged);
  const finished = foldElongatedFinalist(
    result.document,
    resolver,
    {},
    { edits: [], diagnostics: [], groups: [] },
    finish,
  );
  expect(finish).toHaveBeenCalled();
  const after = preview(result.document, resolver, finished.edits);
  expect(after.ok && drawnBodyLeads(after.document, resolver).get("body")).toBe(
    true,
  );
});

it("adds zero routing calls to the public planner on a compact differential stage", () => {
  const document = circuit(
    {
      a: "nmos",
      b: "nmos",
      l: "resistor",
      r: "resistor",
      ls: "resistor",
      rs: "resistor",
      t: "current-source",
      v: "vdd-port",
      g: "ground",
    },
    {
      inA: ["a.G"],
      inB: ["b.G"],
      left: ["a.D", "l.2"],
      right: ["b.D", "r.2"],
      sa: ["a.S", "ls.1"],
      sb: ["b.S", "rs.1"],
      shared: ["ls.2", "rs.2", "t.+"],
      ground: ["t.-", "a.B", "b.B", "g.0"],
      supply: ["l.1", "r.1", "v.P"],
    },
  );
  const route = vi.spyOn(routing, "routeDocument");
  const generate = vi.spyOn(packing, "generateFoldedCandidates");
  try {
    generate.mockReturnValue([]);
    const reference = planAutoLayout(document, resolver);
    const calls = route.mock.calls.length;
    expect(calls).toBeGreaterThan(0);
    generate.mockRestore();
    route.mockClear();
    const result = planAutoLayout(document, resolver);
    expect(route).toHaveBeenCalledTimes(calls);
    expect(result).toEqual(reference);
    expect(result.diagnostics.some((d) => d.severity === "error")).toBe(false);
    const after = preview(document, resolver, result.edits);
    expect(
      after.ok &&
        layoutAspectMetrics(after.document, resolver).layout.aspectRatio,
    ).toBeLessThanOrEqual(1.85);
  } finally {
    generate.mockRestore();
    route.mockRestore();
  }
});
