import { expect, it, vi } from "vitest";
import { InMemorySymbolResolver, builtInSymbols } from "@icm/symbols";
import { visibleInstanceBounds } from "@icm/derived";
import {
  assignColumns,
  deviceRows,
  netLevels,
  orderRows,
} from "../src/layered.js";
import { isMarker } from "../src/placement-connectivity.js";
import type { Placement } from "../src/types.js";
import { planAutoLayout } from "../src/index.js";
import { classifyNets } from "../src/net-roles.js";
import { geometryProblem, withPlacements } from "../src/geometry.js";
import { recognizeStructures } from "../src/recognize.js";
import { resolvedSymmetry, symmetryCounts } from "../src/symmetry.js";
import { outputFacesLeft } from "../src/directed-blocks.js";
import {
  auditRouting,
  floatingPins,
  missingConnections,
} from "../src/routing-audit.js";
import { replayEdits, terminalPartition } from "../src/transaction.js";
import * as solver from "../src/skeleton-sa.js";
import { circuit } from "./document-fixture.js";

const resolver = new InMemorySymbolResolver(builtInSymbols);

// Alternate device IDs across the signal path to give column ordering work.
function cascade(count: number) {
  const ids = Array.from(
    { length: count },
    (_, i) => `m${i % 2 ? count - (i + 1) / 2 : i / 2}`,
  );
  const nets: Record<string, string[]> = { input: [ids[0] + ".G"] };
  for (const [i, id] of ids.entries())
    nets["out" + i] = [id + ".D", i + 1 < count ? ids[i + 1] + ".G" : "load.1"];
  return circuit(
    { ...Object.fromEntries(ids.map((id) => [id, "nmos"])), load: "resistor" },
    nets,
  );
}
function draft(d: ReturnType<typeof circuit>) {
  const roles = classifyNets(d, resolver);
  const topology = resolvedSymmetry(d, resolver, roles);
  return {
    topology,
    ...solver.solveSkeletonSaDraft(
      d,
      resolver,
      roles,
      recognizeStructures(d, roles),
      topology,
    ),
  };
}

it("limits the draft to unpinned transistor searches with 12 devices through 120 instances", () => {
  const eligible = solver.skeletonSaDraftEligible;
  const d = cascade(11);
  expect(eligible(cascade(10), resolver, {})).toBe(false);
  expect(eligible(d, resolver, {})).toBe(true);
  expect(eligible(cascade(45), resolver, {})).toBe(true);
  expect(eligible(cascade(120), resolver, {})).toBe(false);
  expect(eligible(d, resolver, { search: { seed: 1, evaluations: 0 } })).toBe(
    false,
  );
  expect(eligible(d, resolver, { fixedInstanceIds: new Set(["load"]) })).toBe(
    false,
  );
  expect(eligible(d, resolver, { partition: { blocks: [] } })).toBe(false);
  expect(
    eligible(
      {
        ...d,
        layoutGroups: [
          { id: "g", kind: "custom", objectIds: ["load"], locked: true },
        ],
      },
      resolver,
      {},
    ),
  ).toBe(false);
  expect(
    eligible(
      {
        ...d,
        constraints: [
          { id: "g", kind: "align-y", objectIds: ["load", "m0"], locked: true },
        ],
      },
      resolver,
      {},
    ),
  ).toBe(false);
  const resistor = resolver.resolve("resistor")!.definition;
  const hierarchy = new InMemorySymbolResolver(
    [
      {
        ...resistor,
        pins: resistor.pins.map((p) => ({ ...p, role: "hierarchical-port" })),
      },
    ],
    resolver,
  );
  expect(eligible(d, hierarchy, {})).toBe(false);
});

it("lowers the seed energy and repeats its placement on a scrambled cascade", () => {
  const d = cascade(16);
  const result = draft(d);
  expect(result.problem).toBeUndefined();
  expect(result.steps).toBe(1500);
  expect(result.afterEnergy).toBeLessThan(result.beforeEnergy);
  expect(
    geometryProblem(withPlacements(d, result.placements!), resolver),
  ).toBeUndefined();
  expect(draft(d)).toEqual(result);
});

it("improves the spacing inside one unsplit mirror component", () => {
  const symbols: Record<string, string> = {
    tail: "current-source",
    ground: "ground",
  };
  const nets: Record<string, string[]> = {
    common: ["a0.S", "b0.S", "tail.+"],
    gnd: ["ground.0", "tail.-"],
  };
  const models: Record<string, string> = {};
  for (const side of ["a", "b"]) {
    for (let i = 0; i < 6; i++) {
      const id = side + i;
      symbols[id] = "nmos";
      models[id] = "stage" + i;
      if (i) nets.gnd!.push(id + ".S");
      else nets[side + "in"] = [id + ".G"];
      nets[id] = [id + ".D", ...(i < 5 ? [side + (i + 1) + ".G"] : [])];
    }
  }
  const d = circuit(symbols, nets, models);
  const roles = { ...classifyNets(d, resolver), unsplitSymmetry: true };
  const topology = resolvedSymmetry(d, resolver, roles);
  expect(topology.components).toHaveLength(1);
  expect(topology.components[0]!.pairs).toHaveLength(6);
  const devices = d.instances
    .filter((i) => !isMarker(i))
    .sort((a, b) => a.id.localeCompare(b.id));
  const templates = recognizeStructures(d, roles);
  const rows = deviceRows(
    d,
    devices,
    resolver,
    roles,
    templates,
    netLevels(devices, resolver, roles),
    topology,
  );
  const seeds = [
    assignColumns(
      d,
      devices,
      resolver,
      roles,
      templates,
      orderRows(rows, devices, resolver, roles, templates),
      rows,
    ),
    solver.skeletonStageSeed(d, devices, resolver, roles, templates, topology)
      .placements,
  ];
  const result = solver.solveSkeletonSaDraft(
    d,
    resolver,
    roles,
    templates,
    topology,
  );
  expect(result.problem).toBeUndefined();
  expect(result.afterEnergy).toBeLessThan(result.beforeEnergy);
  const widths = (poses: Map<string, Placement>) =>
    topology.components[0]!.pairs.map(([a, b]) =>
      Math.abs(poses.get(a)!.position.x - poses.get(b)!.position.x),
    );
  for (const seed of seeds)
    expect(widths(result.placements!)).not.toEqual(widths(seed));
  function narrowChannels(poses: Map<string, Placement>) {
    const boxes = visibleInstanceBounds(
      withPlacements({ ...d, instances: devices }, poses),
      resolver,
    );
    const close = new Set<string>();
    for (const [i, a] of boxes.entries())
      for (const b of boxes.slice(i + 1)) {
        const xGap = Math.max(
          a.bounds.x - b.bounds.x - b.bounds.width,
          b.bounds.x - a.bounds.x - a.bounds.width,
        );
        const yGap = Math.max(
          a.bounds.y - b.bounds.y - b.bounds.height,
          b.bounds.y - a.bounds.y - a.bounds.height,
        );
        if (Math.max(xGap, yGap) < 2 * d.presentation.grid)
          close.add(a.id + "/" + b.id);
      }
    return close;
  }
  const finalClose = narrowChannels(result.placements!);
  expect(
    seeds.some((seed) => {
      const close = narrowChannels(seed);
      return [...finalClose].every((pair) => close.has(pair));
    }),
  ).toBe(true);
  const counts = symmetryCounts(
    withPlacements(d, result.placements!),
    resolver,
    topology.components,
  );
  expect(counts).toEqual({
    pairs: 6,
    mirrored: 6,
    level: 6,
    orientationMirrored: 6,
    axisDevices: 1,
    onAxis: 1,
  });
});

it("preserves recognized differential symmetry and right-facing directed blocks", () => {
  const d = cascade(12);
  const pair = circuit(
    { left: "nmos", right: "nmos", amp: "opamp" },
    {
      tail: ["left.S", "right.S"],
      inp: ["left.G"],
      inn: ["right.G"],
      a: ["left.D", "amp.IN+"],
      b: ["right.D", "amp.IN-"],
    },
  );
  d.instances.push(...pair.instances);
  d.nets.push(...pair.nets);
  const result = draft(d);
  expect(result.problem).toBeUndefined();
  const counts = symmetryCounts(
    withPlacements(d, result.placements!),
    resolver,
    result.topology.components,
  );
  expect(counts.pairs).toBeGreaterThan(0);
  expect([counts.level, counts.mirrored, counts.orientationMirrored]).toEqual(
    Array(3).fill(counts.pairs),
  );
  expect(
    outputFacesLeft(
      pair.instances[2]!,
      result.placements!.get("amp")!,
      resolver,
    ),
  ).toBe(false);
});

it.each([16, 45])(
  "preserves terminal partitions and routes the %i-transistor cascade safely",
  (count) => {
    const d = cascade(count);
    const options = { search: { seed: 41, evaluations: 1 } };
    const solve = vi.spyOn(solver, "solveSkeletonSaDraft");
    const plan = (() => {
      try {
        const result = planAutoLayout(d, resolver, options);
        expect(
          solve.mock.results.some((call) => call.value?.steps === 1500),
        ).toBe(true);
        return result;
      } finally {
        solve.mockRestore();
      }
    })();
    expect(plan.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
    const replay = replayEdits(d, resolver, plan.edits);
    expect(replay.ok).toBe(true);
    if (!replay.ok) throw new Error("replay refused");
    expect(terminalPartition(replay.document, resolver)).toEqual(
      terminalPartition(d, resolver),
    );
    expect(floatingPins(replay.document, resolver)).toEqual([]);
    expect(missingConnections(replay.document, resolver)).toBe(0);
    expect(auditRouting(replay.document, resolver).unsafeProblems).toEqual([]);
    if (count === 16)
      expect(JSON.stringify(planAutoLayout(d, resolver, options).edits)).toBe(
        JSON.stringify(plan.edits),
      );
  },
  120000,
);

it("keeps quick edits identical to planning with the draft excluded", () => {
  const d = cascade(11),
    options = { search: { seed: 1, evaluations: 0 } };
  const solve = vi.spyOn(solver, "solveSkeletonSaDraft");
  const baseline = vi
    .spyOn(solver, "skeletonSaDraftEligible")
    .mockReturnValue(false);
  try {
    const edits = planAutoLayout(d, resolver, options).edits;
    baseline.mockRestore();
    expect(planAutoLayout(d, resolver, options).edits).toEqual(edits);
    expect(solve).not.toHaveBeenCalled();
  } finally {
    vi.restoreAllMocks();
  }
});
