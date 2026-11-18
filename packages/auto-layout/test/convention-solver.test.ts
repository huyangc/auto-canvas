import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import type { SchematicDocument } from "@icm/model";
import { InMemorySymbolResolver, builtInSymbols } from "@icm/symbols";
import { conventionDraftEligible } from "../src/convention-relations.js";
import * as solver from "../src/convention-solver.js";
import { pinPoints, withPlacements } from "../src/geometry.js";
import { planAutoLayout } from "../src/index.js";
import { channelPins, classifyNets, polarity } from "../src/net-roles.js";
import { isMarker } from "../src/placement-connectivity.js";
import { refinementMetrics } from "../src/refine.js";
import * as reroute from "../src/reroute-portfolio.js";
import * as search from "../src/search.js";
import { stackHolds, stackPairs } from "../src/stack-snap.js";
import { equivalentTerminals, preview } from "../src/transaction.js";
import type { AutoLayoutOptions, Placement } from "../src/types.js";
import { circuit } from "./document-fixture.js";

const resolver = new InMemorySymbolResolver(builtInSymbols);
/** Quick mode: every draft is built, routed and refined, without search. */
const quick = { search: { seed: 1, evaluations: 0 } };
const hash = (value: unknown) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");
const at = (x: number, y: number): Placement => ({
  position: { x, y },
  rotation: 0,
  mirror: "none",
});

/** Input and output ports on the Nets `in` and `out`. */
function withPorts(d: SchematicDocument): SchematicDocument {
  for (const [id, net] of [
    ["pin", "in"],
    ["pout", "out"],
  ] as const) {
    d.instances.push({ id, symbolId: "port", placement: null });
    d.nets
      .find((n) => n.id === net)!
      .terminals.push({ instanceId: id, pinName: "P" });
  }
  d.netlist = {
    name: "test",
    formalParameters: [],
    terminals: [
      {
        id: "t-in",
        name: "in",
        netId: "in",
        direction: "input",
        interfaceInstanceIds: ["pin"],
      },
      {
        id: "t-out",
        name: "out",
        netId: "out",
        direction: "output",
        interfaceInstanceIds: ["pout"],
      },
    ],
  };
  return d;
}

/** Two common-source stages with resistor loads. */
const twoStage = () =>
  withPorts(
    circuit(
      {
        m1: "nmos",
        m2: "nmos",
        r1: "resistor",
        r2: "resistor",
        v: "vdd-port",
        g: "ground",
      },
      {
        vdd: ["v.P", "r1.1", "r2.1"],
        gnd: ["g.0", "m1.S", "m2.S"],
        in: ["m1.G"],
        mid: ["m1.D", "r1.2", "m2.G"],
        out: ["m2.D", "r2.2"],
      },
    ),
  );

/** `stages` common-source stages in a row, optionally loaded by c1. */
function chain(stages: number, load: boolean) {
  const symbols: Record<string, string> = { v: "vdd-port", g: "ground" };
  const nets: Record<string, string[]> = { vdd: ["v.P"], gnd: ["g.0"], in: [] };
  let previous = "in";
  for (let k = 1; k <= stages; k++) {
    symbols[`m${k}`] = "nmos";
    symbols[`r${k}`] = "resistor";
    const node = k === stages ? "out" : `n${k}`;
    nets[previous]!.push(`m${k}.G`);
    nets.gnd!.push(`m${k}.S`);
    nets.vdd!.push(`r${k}.1`);
    nets[node] = [`m${k}.D`, `r${k}.2`];
    previous = node;
  }
  if (load) {
    symbols.c1 = "capacitor";
    nets.out!.push("c1.1");
    nets.gnd!.push("c1.2");
  }
  return withPorts(circuit(symbols, nets));
}

/** A complementary two-stage: npn stage into a pnp stage. */
const bipolar = () =>
  withPorts(
    circuit(
      {
        q1: "npn",
        q2: "pnp",
        r1: "resistor",
        r2: "resistor",
        v: "vdd-port",
        g: "ground",
      },
      {
        vdd: ["v.P", "r1.1", "q2.E"],
        gnd: ["g.0", "q1.E", "r2.2"],
        in: ["q1.B"],
        mid: ["q1.C", "r1.2", "q2.B"],
        out: ["q2.C", "r2.1"],
      },
    ),
  );

/** A pmos stage with a resistor and a capacitor to ground. */
const pmosStage = () =>
  withPorts(
    circuit(
      {
        m1: "pmos",
        r1: "resistor",
        c1: "capacitor",
        v: "vdd-port",
        g: "ground",
      },
      {
        vdd: ["v.P", "m1.S"],
        gnd: ["g.0", "r1.2", "c1.2"],
        in: ["m1.G"],
        out: ["m1.D", "r1.1", "c1.1"],
      },
    ),
  );

/** An nmos stage loaded by a pmos current mirror and a resistor. */
const mirrorLoad = () =>
  withPorts(
    circuit(
      {
        m1: "nmos",
        m2: "pmos",
        m3: "pmos",
        r1: "resistor",
        v: "vdd-port",
        g: "ground",
      },
      {
        vdd: ["v.P", "m2.S", "m3.S"],
        gnd: ["g.0", "m1.S", "r1.2"],
        in: ["m1.G"],
        x: ["m1.D", "m2.D", "m2.G", "m3.G"],
        out: ["m3.D", "r1.1"],
      },
    ),
  );

/** The solver's draft as a placed device Document. */
function solved(d: SchematicDocument, nodeLimit?: number) {
  const draft = solver.solveConventionDraft(d, resolver, nodeLimit);
  expect(draft.problem).toBeUndefined();
  const devices = d.instances.filter((i) => !isMarker(i));
  expect(devices.every((i) => draft.placements!.has(i.id))).toBe(true);
  return {
    draft,
    placed: withPlacements({ ...d, instances: devices }, draft.placements!),
  };
}

/** Each transistor's conduction terminal of its polarity is above the other. */
function upright(d: SchematicDocument) {
  const point = new Map(
    pinPoints(d, resolver).map((p) => [
      `${p.instanceId}.${p.pinName}`,
      p.point,
    ]),
  );
  return d.instances
    .filter((i) => channelPins(i.symbolId))
    .map((i) => {
      const { drain, source, gate } = channelPins(i.symbolId)!;
      const [top, bottom] =
        polarity(i.symbolId) === "p" ? [source, drain] : [drain, source];
      const a = point.get(`${i.id}.${top}`)!;
      const b = point.get(`${i.id}.${bottom}`)!;
      const g = point.get(`${i.id}.${gate}`)!;
      return a.x === b.x && a.y < b.y && g.x !== a.x;
    });
}

describe("R168 convention-solved draft", () => {
  it("draws a two-stage amplifier's branches as columns, input left", () => {
    const d = twoStage();
    const { placed } = solved(d);
    const devices = placed.instances;
    const placements = new Map(devices.map((i) => [i.id, i.placement!]));
    const stacks = stackPairs(devices, resolver, classifyNets(d, resolver));
    expect(stacks.map((s) => s.net).sort()).toEqual(["mid", "out"]);
    for (const stack of stacks)
      expect(stackHolds(stack, placements)).toBe(true);
    const point = new Map(
      pinPoints(placed, resolver).map((p) => [
        `${p.instanceId}.${p.pinName}`,
        p.point,
      ]),
    );
    // The second stage's gate is level with the first stage's drain.
    expect(point.get("m2.G")!.y).toBe(point.get("m1.D")!.y);
    expect(point.get("m1.G")!.x).toBeLessThan(point.get("m2.D")!.x);
    // Planned, the draft is selected and keeps both columns.
    const plan = planAutoLayout(d, resolver, quick);
    expect(refinementMetrics(plan)?.strategy).toBe("convention");
    const after = preview(d, resolver, plan.edits);
    expect(after.ok).toBe(true);
    expect(equivalentTerminals(d, after.document!, resolver)).toBe(true);
    const final = new Map(
      after.document!.instances.map((i) => [i.id, i.placement as Placement]),
    );
    for (const stack of stacks) expect(stackHolds(stack, final)).toBe(true);
  });

  it("never draws a transistor inverted", () => {
    for (const d of [twoStage(), bipolar(), pmosStage(), mirrorLoad()])
      expect(upright(solved(d).placed)).not.toContain(false);
  });

  it("solves the same Document identically whatever its instance order", () => {
    const d = mirrorLoad();
    const reversed = { ...d, instances: [...d.instances].reverse() };
    const first = solver.solveConventionDraft(d, resolver);
    const second = solver.solveConventionDraft(reversed, resolver);
    expect([...second.placements!].sort()).toEqual(
      [...first.placements!].sort(),
    );
    expect(second.nodes).toBe(first.nodes);
  });

  it("plans the same Document identically twice", () => {
    expect(JSON.stringify(planAutoLayout(twoStage(), resolver, quick))).toBe(
      JSON.stringify(planAutoLayout(twoStage(), resolver, quick)),
    );
  });

  it("honours the node limit", () => {
    const d = chain(6, false);
    const limited = solver.solveConventionDraft(d, resolver, 20_000);
    expect(limited.limitHit).toBe(true);
    // The search stops at the limit; the polish adds at most 5 000 more.
    expect(limited.nodes).toBeLessThanOrEqual(20_000 + 5_000);
    expect(limited.placements?.size).toBe(12);
    const full = solver.solveConventionDraft(d, resolver);
    expect(full.nodes).toBeGreaterThan(limited.nodes);
    expect(full.nodes).toBeLessThanOrEqual(solver.CONVENTION_NODE_LIMIT * 1.25);
    // Too small a limit to complete one placement: no draft, no error.
    expect(solver.solveConventionDraft(d, resolver, 2_000).problem).toMatch(
      /R168/,
    );
  });

  // Hashes recorded with the T136 planner (36b51ef) before R168 existed.
  it("refuses a draft the solver cannot build and plans as before", () => {
    const failing = vi
      .spyOn(solver, "solveConventionDraft")
      .mockImplementation(() => {
        throw new Error("solver failed");
      });
    try {
      const plan = planAutoLayout(twoStage(), resolver, quick);
      expect(failing).toHaveBeenCalled();
      expect(hash(plan)).toBe(
        "51282edfb5bd557da53462aac9fbfc96f36e15962094560c13832dcfad80567c",
      );
    } finally {
      failing.mockRestore();
    }
  });

  it.each<[string, () => [SchematicDocument, AutoLayoutOptions], string]>([
    [
      "with a symmetry component",
      () => [
        withPorts(
          circuit(
            {
              m1: "nmos",
              m2: "nmos",
              m3: "pmos",
              m4: "pmos",
              m5: "nmos",
              v: "vdd-port",
              g: "ground",
            },
            {
              vdd: ["v.P", "m3.S", "m4.S"],
              gnd: ["g.0", "m5.S"],
              in: ["m1.G"],
              inn: ["m2.G"],
              bias: ["m5.G"],
              tail: ["m1.S", "m2.S", "m5.D"],
              x: ["m1.D", "m3.D", "m3.G", "m4.G"],
              out: ["m2.D", "m4.D"],
            },
          ),
        ),
        quick,
      ],
      "0c275368f5cf389ab8be609b2758b3a4aa14adca4a6e46a2cbe5927517ac0fc8",
    ],
    [
      "with a directed block",
      () => {
        const d = twoStage();
        d.instances.push({ id: "b1", symbolId: "buffer", placement: null });
        d.nets
          .find((n) => n.id === "out")!
          .terminals.push({ instanceId: "b1", pinName: "A" });
        d.nets.push({
          id: "y",
          terminals: [{ instanceId: "b1", pinName: "Y" }],
        });
        return [d, quick];
      },
      "749bd3ef11561633a8644c73d5b1875b785bd0a4280275130a31c9147deeb412",
    ],
    [
      "without a transistor",
      () => [
        withPorts(
          circuit(
            { r1: "resistor", r2: "resistor", c1: "capacitor", g: "ground" },
            {
              in: ["r1.1"],
              mid: ["r1.2", "r2.1"],
              out: ["r2.2", "c1.1"],
              gnd: ["c1.2", "g.0"],
            },
          ),
        ),
        quick,
      ],
      "422ae67df3fa009919b0e86ed0f0eb9725287c98c58b2a419035b0f4b17cf2f5",
    ],
    [
      "with a fixed instance",
      () => {
        const d = twoStage();
        d.instances.find((i) => i.id === "m1")!.placement = at(300, 300);
        return [d, { ...quick, fixedInstanceIds: new Set(["m1"]) }];
      },
      "f1d35c6b53a4a68bfd708a624206b20e8c6a64d935ac8f5fc277bd20186cd526",
    ],
    [
      "with a locked instance",
      () => {
        const d = twoStage();
        d.instances.find((i) => i.id === "r1")!.placement = at(300, 100);
        d.layoutGroups = [
          { id: "lg", kind: "custom", objectIds: ["r1"], locked: true },
        ];
        return [d, quick];
      },
      "b578ed2e99c165d409f08ab09106257ad9a80f67ee3a532e2760d6ae99997970",
    ],
    [
      "with a partition",
      () => [
        twoStage(),
        {
          ...quick,
          partition: {
            blocks: [
              { id: "a", members: ["m1", "r1"] },
              { id: "b", members: ["m2", "r2"] },
            ],
          },
        },
      ],
      "c0d2cc77a73b99773dde513a37580222739226d300fa4d24f797e35014d5eac2",
    ],
    [
      "above the device limit",
      () => [chain(6, true), quick],
      "9837c13767f86f6ff674be6ac8b977f248c1194a67928880c0870fb5707ed7cb",
    ],
  ])("does not offer the draft to a Document %s", (_, make, base) => {
    const [d, options] = make();
    expect(conventionDraftEligible(d, resolver, options)).toBe(false);
    const solve = vi.spyOn(solver, "solveConventionDraft");
    try {
      expect(hash(planAutoLayout(d, resolver, options))).toBe(base);
      expect(solve).not.toHaveBeenCalled();
    } finally {
      solve.mockRestore();
    }
  });

  it("leaves the original portfolio alone when the draft is not selected", () => {
    const d = mirrorLoad();
    const solve = vi.spyOn(solver, "solveConventionDraft");
    const anneal = vi.spyOn(search, "annealLayout");
    const polish = vi.spyOn(reroute, "reroutePortfolio");
    try {
      const plan = planAutoLayout(d, resolver, {
        search: { seed: 1, evaluations: 40 },
      });
      // The draft was built and refined, and lost to the layered draft.
      expect(solve).toHaveBeenCalled();
      expect(refinementMetrics(plan)?.strategy).toBe("layered");
      expect(anneal).toHaveBeenCalled();
      for (const [, , , , , alternatives] of anneal.mock.calls)
        expect(alternatives.map((a) => a.strategy)).not.toContain("convention");
      expect(polish).toHaveBeenCalled();
      for (const [, , , candidates] of polish.mock.calls)
        expect([...candidates].map((c) => c.strategy)).not.toContain(
          "convention",
        );
      expect(hash(plan)).toBe(
        "bb7ff72cb38d328ed6ec8cb078b46a6be78bae7ccc1f52eb0a0ea2adfbc3925d",
      );
    } finally {
      solve.mockRestore();
      anneal.mockRestore();
      polish.mockRestore();
    }
  }, 60_000);

  it("keeps a Document with a hierarchical symbol out", () => {
    // A two-port subcircuit symbol: its pins are hierarchical ports only.
    const resistor = builtInSymbols.find((d) => d.id === "resistor")!;
    const library = new InMemorySymbolResolver(
      [
        {
          ...structuredClone(resistor),
          id: "sub-block",
          name: "Sub block",
          pins: resistor.pins.map((p) => ({
            ...structuredClone(p),
            role: "hierarchical-port",
          })),
        },
      ],
      resolver,
    );
    const d = twoStage();
    expect(conventionDraftEligible(d, library, {})).toBe(true);
    d.instances.push({ id: "x1", symbolId: "sub-block", placement: null });
    d.nets
      .find((n) => n.id === "out")!
      .terminals.push({ instanceId: "x1", pinName: "1" });
    d.nets
      .find((n) => n.id === "gnd")!
      .terminals.push({ instanceId: "x1", pinName: "2" });
    expect(conventionDraftEligible(d, library, {})).toBe(false);
  });

  it("keeps a Document above 40 instances out, whatever its device count", () => {
    const d = twoStage();
    const grounds = (count: number) => {
      for (let k = 0; k < count; k++) {
        d.instances.push({ id: `gx${k}`, symbolId: "ground", placement: null });
        d.nets
          .find((n) => n.id === "gnd")!
          .terminals.push({ instanceId: `gx${k}`, pinName: "0" });
      }
    };
    // Four devices; markers fill the Document up to the limit.
    grounds(40 - d.instances.length);
    expect(d.instances).toHaveLength(40);
    expect(conventionDraftEligible(d, resolver, {})).toBe(true);
    grounds(1);
    expect(conventionDraftEligible(d, resolver, {})).toBe(false);
  });

  it("refuses the draft for a transistor symbol without an upright pose", () => {
    // An nmos whose source is not under its drain in any pose.
    const nmos = builtInSymbols.find((d) => d.id === "nmos")!;
    const library = new InMemorySymbolResolver(
      [
        {
          ...structuredClone(nmos),
          pins: nmos.pins.map((p) =>
            p.name === "S"
              ? { ...structuredClone(p), at: { x: 20, y: 20 } }
              : structuredClone(p),
          ),
        },
      ],
      resolver,
    );
    const d = twoStage();
    expect(solver.solveConventionDraft(d, library).problem).toMatch(/no pose/);
    const plan = planAutoLayout(d, library, quick);
    expect(plan.diagnostics.filter((x) => x.severity === "error")).toEqual([]);
    expect(refinementMetrics(plan)?.strategy).not.toBe("convention");
  });

  it("selects the draft only when it beats the refined choice made without it", () => {
    // The draft ranks second, so it takes the refinement slot of layered,
    // whose refined run is better than the draft's.
    const d = withPorts(
      circuit(
        {
          m1: "nmos",
          r1: "resistor",
          r2: "resistor",
          r3: "resistor",
          v: "vdd-port",
          g: "ground",
        },
        {
          vdd: ["v.P"],
          gnd: ["g.0", "m1.S", "r1.2"],
          in: ["m1.G"],
          out: ["r2.1", "r3.2"],
          a: ["r3.1"],
          b: ["m1.D", "r1.1", "r2.2"],
        },
      ),
    );
    const solve = vi.spyOn(solver, "solveConventionDraft");
    try {
      const plan = planAutoLayout(d, resolver, quick);
      expect(solve).toHaveBeenCalled();
      expect(refinementMetrics(plan)?.strategy).toBe("layered");
      // Hash recorded with the T136 planner (36b51ef) before R168 existed.
      expect(hash(plan)).toBe(
        "be5323cb3d0a45c689c7c7c10953b5a5fe20c29bc3e296cc1881c3aae308d625",
      );
    } finally {
      solve.mockRestore();
    }
  });
});
