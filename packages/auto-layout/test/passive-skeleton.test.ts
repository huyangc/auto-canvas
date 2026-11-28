import { expect, it, vi } from "vitest";
import { builtInSymbols, InMemorySymbolResolver } from "@icm/symbols";
import type { SchematicDocument } from "@icm/model";
import { planAutoLayout } from "../src/auto-layout.js";
import { visibleInstanceBounds } from "@icm/derived";
import { devicePins, isMarker } from "../src/placement-connectivity.js";
import { geometryProblem, pinExit, withPlacements } from "../src/geometry.js";
import { classifyNets } from "../src/net-roles.js";
import * as skeleton from "../src/passive-skeleton.js";
import { recognizeStructures } from "../src/recognize.js";
import { resolvedSymmetry, symmetryCounts } from "../src/symmetry.js";
import {
  auditRouting,
  floatingPins,
  missingConnections,
} from "../src/routing-audit.js";
import { preview, terminalPartition } from "../src/transaction.js";
import { circuit } from "./document-fixture.js";

const resolver = new InMemorySymbolResolver(builtInSymbols);
const search = { seed: 1, evaluations: 1 };
function amp() {
  const d = circuit(
    {
      a: "nmos",
      b: "nmos",
      tail: "current-source",
      p: "pmos",
      q: "pmos",
      out: "pmos",
      sink: "current-source",
      rc: "resistor",
      cc: "capacitor",
      rl: "resistor",
      cl: "capacitor",
      g: "ground",
      v: "vdd-port",
      inp: "port",
      inn: "port",
    },
    {
      supply: ["v.P", "p.S", "q.S", "out.S"],
      gnd: ["g.0", "tail.-", "sink.-", "cl.2", "rl.2"],
      vp: ["inp.P", "a.G"],
      vn: ["inn.P", "b.G"],
      common: ["a.S", "b.S", "tail.+"],
      ref: ["a.D", "p.G", "q.G", "p.D"],
      gain: ["b.D", "q.D", "out.G", "rc.1"],
      joint: ["rc.2", "cc.1"],
      output: ["out.D", "sink.+", "cc.2", "rl.1", "cl.1"],
    },
  );
  d.netlist = {
    name: "compensated",
    formalParameters: [],
    terminals: (
      [
        ["inp", "vp"],
        ["inn", "vn"],
      ] as const
    ).map(([id, netId]) => ({
      id: id + "-terminal",
      name: id,
      netId,
      direction: "input",
      interfaceInstanceIds: [id],
    })),
  };
  return d;
}
function inputs(d: SchematicDocument) {
  const roles = classifyNets(d, resolver);
  return [
    d,
    resolver,
    roles,
    recognizeStructures(d, roles),
    resolvedSymmetry(d, resolver, roles),
  ] as const;
}
it("reduces the Miller chain and parallel output load, leaving the differential core intact", () => {
  const args = inputs(amp());
  const { modules, guestIds } = skeleton.findPassiveModules(...args);
  expect([...guestIds].sort()).toEqual(["cc", "cl", "rc", "rl"]);
  expect(modules).toMatchObject([
    {
      role: "two-port-bridge",
      tree: {
        kind: "series",
        ends: ["gain", "output"],
        children: [
          { deviceId: "rc", pins: ["1", "2"] },
          { deviceId: "cc", pins: ["1", "2"] },
        ],
      },
    },
    {
      role: "rail-attachment",
      tree: { kind: "parallel" },
      members: ["cl", "rl"],
    },
  ]);
  expect(args[4].components.flatMap((c) => c.pairs)).toContainEqual(["a", "b"]);
  const draft = skeleton.solvePassiveSkeletonDraft(...args);
  expect(draft.problem).toBeUndefined();
  expect(draft).toEqual(skeleton.solvePassiveSkeletonDraft(...args));
  const placed = withPlacements(
    {
      ...args[0],
      instances: args[0].instances.filter((i) => !isMarker(i)),
    },
    draft.placements!,
  );
  expect(draft.placements!.size).toBe(placed.instances.length);
  expect(geometryProblem(placed, resolver)).toBeUndefined();
  for (const i of placed.instances.filter((i) => ["rl", "cl"].includes(i.id))) {
    const groundPin = devicePins(i, resolver).find((p) => p.name === "2")!;
    expect(pinExit(groundPin, i.placement!).y).toBe(1);
  }
  const boxes = visibleInstanceBounds(placed, resolver);
  for (const { id, bounds: a } of boxes.filter((b) => guestIds.has(b.id))) {
    for (const other of boxes.filter((b) => b.id !== id)) {
      const b = other.bounds;
      expect(
        Math.max(
          a.x - b.x - b.width,
          b.x - a.x - a.width,
          a.y - b.y - b.height,
          b.y - a.y - a.height,
        ),
      ).toBeGreaterThanOrEqual(2 * placed.presentation.grid);
    }
  }
  const counts = symmetryCounts(placed, resolver, args[4].components);
  expect([
    counts.mirrored,
    counts.level,
    counts.orientationMirrored,
    counts.onAxis,
  ]).toEqual([counts.pairs, counts.pairs, counts.pairs, counts.axisDevices]);
});

it("keeps a Wheatstone bridge and recognized paired passives in the core", () => {
  const wheatstone = circuit(
    {
      a: "nmos",
      b: "pmos",
      r1: "resistor",
      r2: "resistor",
      r3: "resistor",
      r4: "resistor",
      r5: "resistor",
    },
    {
      a: ["a.D", "r1.1", "r2.1"],
      b: ["b.D", "r3.2", "r4.2"],
      c: ["r1.2", "r3.1", "r5.1"],
      d: ["r2.2", "r4.1", "r5.2"],
    },
  );
  const paired = circuit(
    {
      a: "nmos",
      b: "nmos",
      t: "current-source",
      l: "resistor",
      r: "resistor",
      g: "ground",
    },
    {
      tail: ["a.S", "b.S", "t.+"],
      ga: ["a.G", "l.2"],
      gb: ["b.G", "r.1"],
      da: ["a.D", "l.1"],
      db: ["b.D", "r.2"],
      gnd: ["t.-", "g.0"],
    },
  );
  expect(inputs(paired)[4].components.flatMap((c) => c.pairs)).toContainEqual([
    "l",
    "r",
  ]);
  for (const d of [wheatstone, paired])
    expect(skeleton.findPassiveModules(...inputs(d)).guestIds.size).toBe(0);
});
it("requires an eligible transistor drawing and an active search budget", () => {
  const d = amp();
  expect(skeleton.passiveSkeletonDraftEligible(d, resolver, { search })).toBe(
    true,
  );
  expect(
    skeleton.passiveSkeletonDraftEligible(d, resolver, {
      quality: "optimized",
    }),
  ).toBe(true);
  for (const options of [
    {},
    { search: { ...search, evaluations: 0 } },
    { search, partition: { blocks: [] } },
    { search, fixedInstanceIds: new Set(["cc"]) },
  ])
    expect(skeleton.passiveSkeletonDraftEligible(d, resolver, options)).toBe(
      false,
    );
  expect(
    skeleton.passiveSkeletonDraftEligible(
      circuit({ a: "resistor" }, {}),
      resolver,
      { search },
    ),
  ).toBe(false);
  d.layoutGroups.push({
    id: "locked",
    kind: "matched-pair",
    objectIds: ["a", "b"],
    locked: true,
  });
  expect(skeleton.passiveSkeletonDraftEligible(d, resolver, { search })).toBe(
    false,
  );
  d.layoutGroups = [];
  const base = resolver.resolve("resistor")!.definition;
  const hierarchy = new InMemorySymbolResolver(
    [
      {
        ...base,
        id: "sub",
        pins: base.pins.map((p) => ({ ...p, role: "hierarchical-port" })),
      },
    ],
    resolver,
  );
  d.instances.push({ id: "sub", symbolId: "sub", placement: null });
  expect(skeleton.passiveSkeletonDraftEligible(d, hierarchy, { search })).toBe(
    false,
  );
  expect(
    skeleton.solvePassiveSkeletonDraft(...inputs(amp()), {
      search: { ...search, deadline: 0 },
    }).problem,
  ).toContain("cancelled");
});
it.each([{}, { search: { ...search, evaluations: 0 } }])(
  "preserves quick-mode edits %j",
  (options) => {
    const d = circuit(
      { n: "nmos", p: "pmos", r: "resistor" },
      { a: ["n.D", "r.1"], b: ["p.D", "r.2"] },
    );
    const disabled = vi
      .spyOn(skeleton, "passiveSkeletonDraftEligible")
      .mockReturnValue(false);
    let baseline;
    try {
      baseline = planAutoLayout(d, resolver, options).edits;
    } finally {
      disabled.mockRestore();
    }
    const solve = vi.spyOn(skeleton, "solvePassiveSkeletonDraft");
    try {
      expect(JSON.stringify(planAutoLayout(d, resolver, options).edits)).toBe(
        JSON.stringify(baseline),
      );
      expect(solve).not.toHaveBeenCalled();
    } finally {
      solve.mockRestore();
    }
  },
);
it("routes the compensated amplifier deterministically and preserves physical connectivity", () => {
  const d = amp();
  const solve = vi.spyOn(skeleton, "solvePassiveSkeletonDraft");
  let result;
  try {
    result = planAutoLayout(d, resolver, { search });
    expect(solve).toHaveBeenCalled();
  } finally {
    solve.mockRestore();
  }

  expect(result.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
  expect(result.edits.length).toBeGreaterThan(0);
  const final = preview(d, resolver, result.edits);
  expect(final.ok).toBe(true);
  if (!final.ok) throw new Error("preview failed");
  expect(terminalPartition(final.document, resolver)).toBe(
    terminalPartition(d, resolver),
  );
  expect(missingConnections(final.document, resolver)).toBe(0);
  expect(floatingPins(final.document, resolver)).toEqual([]);
  expect(auditRouting(final.document, resolver).unsafeProblems).toEqual([]);
  expect(JSON.stringify(planAutoLayout(d, resolver, { search }).edits)).toBe(
    JSON.stringify(result.edits),
  );
}, 60000);
