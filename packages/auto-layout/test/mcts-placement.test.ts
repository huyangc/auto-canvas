import { expect, it, vi } from "vitest";
import { executeTransaction } from "@icm/edit-engine";
import type { SchematicDocument } from "@icm/model";
import { builtInSymbols, InMemorySymbolResolver } from "@icm/symbols";
import { extractDcBranches } from "../src/functional-roles.js";
import {
  enclosingBox,
  geometryProblem,
  withPlacements,
  pinExit,
  pinPoints,
} from "../src/geometry.js";
import { planAutoLayout } from "../src/index.js";
import * as solver from "../src/mcts-placement.js";
import { classifyNets } from "../src/net-roles.js";
import { isMarker } from "../src/placement-connectivity.js";
import {
  auditRouting,
  floatingPins,
  missingConnections,
} from "../src/routing-audit.js";
import * as search from "../src/search.js";
import * as reroute from "../src/reroute-portfolio.js";
import { readabilityMetrics } from "../src/readability-metrics.js";
import { refinementMetrics } from "../src/refine.js";
import { equivalentTerminals } from "../src/transaction.js";
import { circuit } from "./document-fixture.js";

const resolver = new InMemorySymbolResolver(builtInSymbols);
const roles = (d: SchematicDocument) =>
  extractDcBranches(d, resolver, classifyNets(d, resolver));

function differential(mos: boolean) {
  const across = mos
    ? ({ m3: "nmos", m4: "nmos" } as const)
    : ({ rs: "resistor", cs: "capacitor" } as const);
  return circuit(
    {
      m1: "nmos",
      m2: "nmos",
      i1: "current-source",
      i2: "current-source",
      v: "vdd-port",
      g: "ground",
      ...across,
    },
    {
      vdd: ["v.P", "m1.D", "m2.D"],
      gnd: ["g.0", "i1.-", "i2.-"],
      inp: ["m1.G"],
      inn: ["m2.G"],
      left: ["m1.S", "i2.+", ...(mos ? ["m3.D", "m4.S"] : ["rs.1", "cs.1"])],
      right: ["m2.S", "i1.+", ...(mos ? ["m4.D", "m3.S"] : ["rs.2", "cs.2"])],
      ...(mos ? { bias: ["m3.G", "m4.G"] } : {}),
    },
  );
}

function portedDifferential() {
  const d = circuit(
    {
      m1: "nmos",
      m2: "nmos",
      m3: "nmos",
      m4: "nmos",
      i1: "current-source",
      i2: "current-source",
      g: "ground",
      vinp: "port",
      vinn: "port",
      voutp: "port",
      voutn: "port",
    },
    {
      Voutp: ["voutp.P", "m1.D"],
      Voutn: ["voutn.P", "m2.D"],
      inp: ["m1.G", "vinp.P", "m4.G"],
      inn: ["m2.G", "vinn.P", "m3.G"],
      left: ["m1.S", "i2.+", "m3.D", "m4.D"],
      right: ["m2.S", "i1.+", "m3.S", "m4.S"],
      gnd: ["g.0", "i1.-", "i2.-"],
    },
  );
  d.netlist = {
    name: "diff",
    formalParameters: [],
    terminals: [
      ["vinp", "inp"],
      ["vinn", "inn"],
      ["voutp", "Voutp"],
      ["voutn", "Voutn"],
    ].map(([id, netId]) => ({
      id: id! + "-terminal",
      name: id!,
      netId: netId!,
      direction: "passive",
      interfaceInstanceIds: [id!],
    })),
  };
  return d;
}

const pump = () =>
  circuit(
    {
      mp: "nmos",
      load: "capacitor",
      boot: "capacitor",
      clock: "voltage-source",
      pre: "pmos",
      v: "vdd-port",
      g: "ground",
    },
    {
      vdd: ["v.P", "pre.S"],
      gnd: ["g.0", "load.2", "clock.-"],
      drive: ["clock.+", "boot.2", "pre.G"],
      control: ["boot.1", "mp.G"],
      charged: ["pre.D", "mp.D"],
      out: ["mp.S", "load.1"],
    },
  );
const clamp = (diodeConnected = false) => {
  const d = circuit(
    {
      r1: "resistor",
      m1: "pmos",
      m2: "pmos",
      m3: "nmos",
      m4: "nmos",
      amp: "opamp",
      v: "vdd-port",
      g: "ground",
    },
    {
      vdd: ["v.P", "r1.1", "m1.S", ...(diodeConnected ? [] : ["amp.VDD"])],
      gnd: ["g.0", "m3.S", "m4.S", ...(diodeConnected ? [] : ["amp.VSS"])],
      ...(diodeConnected ? {} : { bias: ["m1.G", "m2.G"] }),
      series: ["r1.2", "m2.S"],
      left: [
        "m1.D",
        "m3.D",
        ...(diodeConnected ? ["m1.G", "m2.G", "amp.IN-"] : ["amp.IN+"]),
      ],
      right: ["m2.D", "m4.D", diodeConnected ? "amp.IN+" : "amp.IN-"],
      ctrl: ["amp.OUT", "m3.G", "m4.G"],
    },
  );
  if (!diodeConnected)
    d.instances.find((i) => i.id === "amp")!.symbolVariantId = "supply-pins";
  return d;
};
const matrix = () =>
  circuit(
    {
      p1: "pmos",
      p2: "pmos",
      p3: "pmos",
      n1: "nmos",
      n2: "nmos",
      n3: "nmos",
      v: "vdd-port",
      g: "ground",
    },
    {
      vdd: ["v.P", "p1.S", "p2.S", "p3.S"],
      gnd: ["g.0", "n1.S", "n2.S", "n3.S"],
      a: ["p1.D", "n1.D", "p1.G", "p2.G", "p3.G"],
      b: ["p2.D", "n2.D", "n1.G", "n2.G", "n3.G"],
      c: ["p3.D", "n3.D"],
    },
  );

function solve(d: SchematicDocument) {
  expect(solver.mctsDraftEligible(d, resolver, {})).toBe(true);
  const draft = solver.solveMctsDraft(d, resolver);
  expect(draft.problem).toBeUndefined();
  const devices = d.instances.filter((i) => !isMarker(i));
  expect(draft.placements!.size).toBe(devices.length);
  const placed = withPlacements(
    { ...d, instances: devices },
    draft.placements!,
  );
  expect(geometryProblem(placed, resolver)).toBeUndefined();
  const points = pinPoints(placed, resolver);
  const pinX = (id: string, pin: string) =>
    points.find((p) => p.instanceId === id && p.pinName === pin)!.point.x;
  return {
    draft,
    placed,
    pinX,
    pose: (id: string) => draft.placements!.get(id)!,
  };
}

it.each([true, false])(
  "centers parallel degeneration elements across both differential sources (MOS %s)",
  (mos) => {
    const d = differential(mos);
    const f = roles(d);
    const ids = mos ? ["m3", "m4"] : ["cs", "rs"];
    expect(
      [...(mos ? f.bridgeTransistors : f.bridgePassives.keys())].sort(),
    ).toEqual(ids);
    const { pose, pinX } = solve(d);
    const [a, b] = [pose("m1").position.x, pose("m2").position.x].sort(
      (a, b) => a - b,
    );
    expect(pinX("m1", "S")).toBe(pinX("i2", "+"));
    expect(pinX("m2", "S")).toBe(pinX("i1", "+"));
    for (const id of ids) {
      expect([90, 270]).toContain(pose(id).rotation);
      expect(pose(id).position.x).toBeGreaterThan(a!);
      expect(pose(id).position.x).toBeLessThan(b!);
    }
  },
);

it("faces the external inputs outward and centers both bridge channels between branch rows", () => {
  const { pose, pinX, placed } = solve(portedDifferential());
  const gate = resolver
    .resolve("nmos")!
    .definition.pins.find((p) => p.name === "G")!;
  const [left, right] = ["m1", "m2"].sort(
    (a, b) => pinX(a, "D") - pinX(b, "D"),
  );
  expect(pinExit(gate, pose(left!)).x).toBe(-1);
  expect(pinExit(gate, pose(right!)).x).toBe(1);
  const points = pinPoints(placed, resolver);
  const channelRows = ["m3", "m4"].map((id) => {
    expect([90, 270]).toContain(pose(id).rotation);
    expect(pose(id).position.x).toBe(
      (pinX(left!, "S") + pinX(right!, "S")) / 2,
    );
    return points.find((p) => p.instanceId === id && p.pinName === "D")!.point
      .y;
  });
  expect(channelRows[1]! - channelRows[0]!).toBe(60);
  expect((channelRows[0]! + channelRows[1]!) / 2).toBe(
    (pose("m1").position.y + pose("i2").position.y) / 2,
  );
  expect(pose("i2").position.y - pose("m1").position.y).toBeGreaterThanOrEqual(
    120,
  );
});

it("places the bootstrapped series pass device horizontally in a compact pump", () => {
  const d = pump();
  expect([...roles(d).bridgeTransistors]).toEqual(["mp"]);
  const { pose, placed } = solve(d);
  expect([90, 270]).toContain(pose("mp").rotation);
  const { width, height } = enclosingBox(placed, resolver);
  expect(Math.max(width / height, height / width)).toBeLessThan(2.2);
});

it("points the centered clamp output at the lower gates", () => {
  const d = clamp();
  expect(roles(d).clampAmplifiers.get("amp")).toEqual({
    plusNet: "left",
    minusNet: "right",
    outputNet: "ctrl",
    targetHalf: "lower",
  });
  const { pose, pinX } = solve(d);
  expect(pinX("r1", "2")).toBe(pinX("m2", "S"));
  expect(pinX("m2", "D")).toBe(pinX("m4", "D"));
  expect(pose("m1").position.y).toBe(pose("m2").position.y);
  const amp = pose("amp");
  expect(amp.rotation).toBe(90);
  expect(
    pinExit(
      resolver.resolve("opamp")!.definition.pins.find((p) => p.name === "OUT")!,
      amp,
    ).y,
  ).toBe(1);
  expect(amp.position.x).toBe((pinX("m3", "D") + pinX("m4", "D")) / 2);
});

it("orders each column of a three-branch matrix from PMOS to NMOS", () => {
  const d = matrix();
  expect(roles(d).branches.map((b) => b.devices.map((i) => i.id))).toEqual([
    ["p1", "n1"],
    ["p2", "n2"],
    ["p3", "n3"],
  ]);
  const { pose, pinX } = solve(d);
  for (const k of [1, 2, 3]) {
    expect(pinX("p" + k, "D")).toBe(pinX("n" + k, "D"));
    expect(pose("p" + k).position.y).toBeLessThan(pose("n" + k).position.y);
  }
});

it("replays the same 320 rollouts and polish", () => {
  const run = () => {
    const { draft } = solve(differential(true));
    return JSON.stringify([
      draft.iterations,
      draft.cost,
      [...draft.placements!],
    ]);
  };
  const first = run();
  expect(JSON.parse(first)[0]).toBe(320);
  expect(run()).toBe(first);
});

it.each([
  ["MOS bridges", () => differential(true)],
  ["ported MOS bridges", portedDifferential],
  ["passive bridges", () => differential(false)],
  ["pump", pump],
  ["clamp", clamp],
  ["diode-connected clamp", () => clamp(true)],
  ["matrix", matrix],
] as const)(
  "commits a complete, safe %s drawing",
  (name, make) => {
    const document = make();
    const plan = planAutoLayout(document, resolver);
    if (name === "pump") {
      expect(
        refinementMetrics(
          planAutoLayout(document, resolver, {
            search: { seed: 1, evaluations: 0 },
          }),
        )?.strategy,
      ).toBe("mcts");
    }
    expect(plan.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
    const result = executeTransaction(
      document,
      {
        transactionId: "mcts",
        documentId: document.id,
        expectedRevision: document.revision,
        actor: { kind: "agent", id: "test" },
        edits: plan.edits,
      },
      { symbolResolver: resolver },
    );
    expect(result.ok && result.applied).toBe(true);
    if (!result.ok) throw new Error("transaction failed");
    expect(equivalentTerminals(document, result.document, resolver)).toBe(true);
    expect(auditRouting(result.document, resolver).problems).toEqual([]);
    expect(floatingPins(result.document, resolver)).toEqual([]);
    expect(missingConnections(result.document, resolver)).toBe(0);
    if (name === "diode-connected clamp") {
      expect(auditRouting(result.document, resolver).crossings).toBe(0);
      expect(
        readabilityMetrics(result.document, resolver).avoidableJogs.violations,
      ).toBe(0);
      expect(refinementMetrics(plan)?.strategy).toBe("mcts");
    }
    if (name === "ported MOS bridges")
      expect(auditRouting(result.document, resolver).crossings).toBe(0);
  },
  60000,
);

it("respects partition, lock, size and symbol boundaries", () => {
  const d = matrix();
  expect(
    solver.mctsDraftEligible(d, resolver, { partition: { blocks: [] } }),
  ).toBe(false);
  expect(
    solver.mctsDraftEligible(d, resolver, {
      fixedInstanceIds: new Set(["n1"]),
    }),
  ).toBe(false);
  expect(
    solver.mctsDraftEligible(
      {
        ...d,
        layoutGroups: [
          { kind: "custom", id: "g1", locked: true, objectIds: ["n1"] },
        ],
      },
      resolver,
      {},
    ),
  ).toBe(false);
  expect(
    solver.mctsDraftEligible(
      {
        ...d,
        constraints: [
          {
            id: "hold",
            kind: "align-y",
            objectIds: ["p1", "p2"],
            locked: true,
          },
        ],
      },
      resolver,
      {},
    ),
  ).toBe(false);
  for (const [symbolId, limit] of [
    ["ground", 41],
    ["resistor", 23],
  ] as const) {
    const instances = [...d.instances];
    while (instances.length < limit)
      instances.push({
        id: "extra" + instances.length,
        symbolId,
        placement: null,
      });
    expect(solver.mctsDraftEligible({ ...d, instances }, resolver, {})).toBe(
      false,
    );
  }
  expect(
    solver.mctsDraftEligible(
      circuit({ a: "resistor", b: "capacitor" }, {}),
      resolver,
      {},
    ),
  ).toBe(false);
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
  d.instances.push({ id: "x", symbolId: "sub", placement: null });
  expect(solver.mctsDraftEligible(d, hierarchy, {})).toBe(false);
});

it("keeps a refused MCTS draft out of the planned edits and diagnostics", () => {
  const d = matrix();
  const options = { search: { seed: 1, evaluations: 0 } };
  const eligibility = vi
    .spyOn(solver, "mctsDraftEligible")
    .mockReturnValue(false);
  let incumbent;
  try {
    incumbent = planAutoLayout(d, resolver, options);
  } finally {
    eligibility.mockRestore();
  }
  const solve = vi.spyOn(solver, "solveMctsDraft").mockImplementation(() => {
    throw new Error("failed draft");
  });
  try {
    expect(planAutoLayout(d, resolver, options)).toEqual(incumbent);
    expect(solve).toHaveBeenCalled();
  } finally {
    solve.mockRestore();
  }
});

it("retains a series impedance in its supply-to-ground column", () => {
  const d = circuit(
    { p: "pmos", r: "resistor", n: "nmos", v: "vdd-port", g: "ground" },
    {
      supply: ["v.P", "p.S"],
      upper: ["p.D", "r.1"],
      lower: ["r.2", "n.D"],
      ground: ["n.S", "g.0"],
    },
  );
  const f = roles(d);
  expect([...f.bridgePassives]).toEqual([]);
  expect(f.branches.map((b) => b.devices.map((i) => i.id))).toEqual([
    ["p", "r", "n"],
  ]);
  expect(solver.mctsDraftEligible(d, resolver, {})).toBe(false);
});

it("keeps a rail-connected stack transistor upright even with a capacitor on its output", () => {
  const d = pump();
  d.instances.find((i) => i.id === "pre")!.symbolId = "nmos";
  expect(roles(d).bridgeTransistors.has("mp")).toBe(false);
});

it("isolates a valid losing matrix draft from annealing and rerouting", () => {
  const d = matrix();
  const eligibility = vi
    .spyOn(solver, "mctsDraftEligible")
    .mockReturnValue(false);
  let incumbent;
  try {
    incumbent = planAutoLayout(d, resolver);
  } finally {
    eligibility.mockRestore();
  }
  const draft = vi.spyOn(solver, "solveMctsDraft");
  const anneal = vi.spyOn(search, "annealLayout");
  const polish = vi.spyOn(reroute, "reroutePortfolio");
  try {
    expect(planAutoLayout(d, resolver)).toEqual(incumbent);
    expect(
      draft.mock.results.some((result) => result.value?.placements?.size),
    ).toBe(true);
    expect(anneal).toHaveBeenCalled();
    for (const [, , , , , alternatives] of anneal.mock.calls)
      expect(alternatives.map((a) => a.strategy)).not.toContain("mcts");
    expect(polish).toHaveBeenCalled();
    for (const [, , , candidates] of polish.mock.calls)
      expect([...candidates].map((c) => c.strategy)).not.toContain("mcts");
  } finally {
    draft.mockRestore();
    anneal.mockRestore();
    polish.mockRestore();
  }
}, 60_000);

it("does not infer a pass gate driver from another gate alone", () => {
  const d = pump();
  const drive = d.nets.find((net) => net.id === "control")!;
  drive.terminals = drive.terminals.filter((t) => t.instanceId !== "boot");
  d.nets.find((net) => net.id === "drive")!.terminals = d.nets
    .find((net) => net.id === "drive")!
    .terminals.filter((t) => t.instanceId !== "pre");
  drive.terminals.push({ instanceId: "pre", pinName: "G" });
  expect(roles(d).bridgeTransistors.has("mp")).toBe(false);
});

it("points an upper clamp at the PMOS gates", () => {
  const d = clamp();
  const upper = d.nets.find((net) => net.id === "bias")!;
  const lower = d.nets.find((net) => net.id === "ctrl")!;
  lower.terminals = lower.terminals.filter((t) => t.instanceId !== "amp");
  upper.terminals.push({ instanceId: "amp", pinName: "OUT" });
  expect(roles(d).clampAmplifiers.get("amp")?.targetHalf).toBe("upper");
  const { pose } = solve(d);
  expect(pose("amp").rotation).toBe(270);
});
