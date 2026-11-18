import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import type { SchematicDocument } from "@icm/model";
import { InMemorySymbolResolver, builtInSymbols } from "@icm/symbols";
import { planAutoLayout } from "../src/index.js";
import { planLayoutOnce } from "../src/auto-layout.js";
import { emptyChoices, emptyOverrides } from "../src/layout-choices.js";
import { classifyNets } from "../src/net-roles.js";
import * as place from "../src/place.js";
import * as portfolio from "../src/reroute-portfolio.js";
import { placeDocument } from "../src/place.js";
import { isMarker } from "../src/placement-connectivity.js";
import { recognizeStructures } from "../src/recognize.js";
import { refinementMetrics } from "../src/refine.js";
import * as snap from "../src/stack-snap.js";
import { equivalentTerminals, preview } from "../src/transaction.js";
import type { Placement } from "../src/types.js";
import { circuit } from "./document-fixture.js";

const resolver = new InMemorySymbolResolver(builtInSymbols);
/** Quick mode: every draft and candidate is routed and refined, no search. */
const quick = { search: { seed: 1, evaluations: 0 } };

const pose = (x: number, y: number): Placement => ({
  position: { x, y },
  rotation: 0,
  mirror: "none",
});

/** The stacks of `d` and an alignment over hand-placed devices. */
function align(
  d: SchematicDocument,
  placed: Record<string, Placement>,
  frozen: string[] = [],
) {
  const roles = classifyNets(d, resolver);
  const devices = d.instances.filter((i) => !isMarker(i));
  const targets = new Map(
    Object.entries(placed).map(([id, p]) => [id, structuredClone(p)]),
  );
  const aligned = snap.alignStacks(
    d,
    devices,
    resolver,
    roles,
    targets,
    new Set(frozen),
    emptyOverrides(),
  );
  const stacks = snap.stackPairs(devices, resolver, roles);
  const holds = (net: string) =>
    snap.stackHolds(
      stacks.find((s) => s.net === net)!,
      targets,
    );
  return { aligned, targets, holds, stacks };
}

/** Common-source stage: m1 drain on `out`, load r1 from the supply. */
const commonSource = () =>
  circuit(
    { m1: "nmos", r1: "resistor", c1: "capacitor", v: "vdd-port", g: "ground" },
    {
      vdd: ["v.P", "r1.1"],
      out: ["r1.2", "m1.D", "c1.1"],
      gnd: ["m1.S", "g.0", "c1.2"],
      in: ["m1.G"],
    },
  );
// m1's drain pin is at (110, 180), exiting north; r1's pin 2 sits 20 below it.
const stage = { m1: pose(100, 200), r1: pose(140, 100), c1: pose(200, 300) };

/** A transistor whose drain resistor feeds its gate divider. */
const selfBiased = () =>
  circuit(
    { m1: "nmos", r1: "resistor", r2: "resistor", v: "vdd-port", g: "ground" },
    {
      vdd: ["v.P"],
      gnd: ["g.0", "m1.S", "r1.1"],
      d: ["m1.G", "r1.2", "r2.1"],
      a: ["m1.D", "r2.2"],
    },
  );

function completes(d: SchematicDocument) {
  const plan = planAutoLayout(d, resolver, quick);
  expect(plan.diagnostics.filter((x) => x.severity === "error")).toEqual([]);
  const after = preview(d, resolver, plan.edits);
  expect(after.ok).toBe(true);
  expect(equivalentTerminals(d, after.document!, resolver)).toBe(true);
  return { plan, after: after.document! };
}

describe("R166 stack relation", () => {
  it("pairs the only two conduction terminals on a non-rail Net", () => {
    const d = commonSource();
    const { stacks } = align(d, stage);
    // The shunt capacitor is no conduction terminal; rails form no stack.
    expect(stacks.map((s) => [s.net, s.a.id, s.b.id])).toEqual([
      ["out", "m1", "r1"],
    ]);
  });

  it("never pairs two passive parts or three terminals", () => {
    const d = circuit(
      { r1: "resistor", r2: "resistor", r3: "resistor", m1: "nmos" },
      {
        x: ["r1.2", "r2.1"],
        y: ["r2.2", "r3.1", "m1.D"],
        z: ["m1.S", "r1.1", "r3.2"],
        w: ["m1.G"],
      },
    );
    expect(align(d, {}).stacks).toEqual([]);
  });
});

describe("R166 stack alignment", () => {
  it("moves a load sideways into its transistor's column", () => {
    const { aligned, targets, holds } = align(commonSource(), stage);
    expect(aligned).toEqual(["out"]);
    expect(holds("out")).toBe(true);
    // Sideways only: r1 keeps its height, m1 stays.
    expect(targets.get("r1")).toEqual(pose(110, 100));
    expect(targets.get("m1")).toEqual(stage.m1);
  });

  it("never moves a frozen device and moves the transistor only when free", () => {
    // Fixed, attached and template devices arrive frozen from placeDocument.
    const frozen = align(commonSource(), stage, ["r1", "m1"]);
    expect(frozen.aligned).toEqual([]);
    expect(frozen.targets.get("r1")).toEqual(stage.r1);
    expect(frozen.targets.get("m1")).toEqual(stage.m1);
    const load = align(commonSource(), stage, ["r1"]);
    expect(load.aligned).toEqual(["out"]);
    expect(load.targets.get("r1")).toEqual(stage.r1);
    expect(load.holds("out")).toBe(true);
  });

  it("never moves or mirrors a member of a two-device pair", () => {
    const d = circuit(
      {
        m1: "nmos",
        m2: "nmos",
        m3: "nmos",
        r1: "resistor",
        r2: "resistor",
        v: "vdd-port",
        g: "ground",
      },
      {
        vdd: ["v.P", "r1.1", "r2.1"],
        o1: ["m1.D", "r1.2"],
        o2: ["m2.D", "r2.2"],
        tail: ["m1.S", "m2.S", "m3.D"],
        gnd: ["m3.S", "g.0"],
        inp: ["m1.G"],
        inn: ["m2.G"],
        bias: ["m3.G"],
      },
    );
    const placed = {
      m1: pose(100, 200),
      m2: pose(300, 200),
      m3: pose(200, 300),
      r1: pose(140, 100),
      r2: pose(340, 100),
    };
    // With both loads held in place, only the pair members could move.
    const held = align(d, placed, ["r1", "r2"]);
    expect(held.aligned).toEqual([]);
    expect(held.targets).toEqual(new Map(Object.entries(placed)));
    const free = align(d, placed);
    expect(free.aligned).toEqual(["o1", "o2"]);
    expect(free.targets.get("m1")).toEqual(placed.m1);
    expect(free.targets.get("m2")).toEqual(placed.m2);
  });

  it("never turns a directed block that R164 keeps facing right", () => {
    // b1's input pin can face m1's drain only by turning the buffer.
    const d = circuit(
      { m1: "nmos", b1: "buffer", g: "ground" },
      { a: ["m1.D", "b1.A"], gnd: ["m1.S", "g.0"], in: ["m1.G"], y: ["b1.Y"] },
    );
    expect(classifyNets(d, resolver).rightFacing).toEqual(new Set(["b1"]));
    const { aligned, targets } = align(d, { m1: stage.m1, b1: pose(300, 0) });
    expect(aligned).toEqual([]);
    expect(targets.get("b1")).toEqual(pose(300, 0));
    expect(targets.get("m1")).toEqual(stage.m1);
  });

  it("gives a device to the first stack and moves the other stack's partner", () => {
    // r1 joins m1's drain (Net a) and m2's source (Net b): two stacks.
    const d = circuit(
      { m1: "nmos", m2: "nmos", r1: "resistor", v: "vdd-port", g: "ground" },
      {
        vdd: ["v.P", "m2.D"],
        a: ["m1.D", "r1.2"],
        b: ["m2.S", "r1.1"],
        gnd: ["m1.S", "g.0"],
        in: ["m1.G"],
        bias: ["m2.G"],
      },
    );
    const placed = {
      m1: pose(100, 300),
      r1: pose(140, 200),
      m2: pose(200, 100),
    };
    const { aligned, targets, holds } = align(d, placed);
    expect(aligned).toEqual(["a", "b"]);
    expect(holds("a") && holds("b")).toBe(true);
    // Net a claims r1 first; Net b then moves m2 over r1.
    expect(targets.get("r1")).toEqual(pose(110, 200));
    expect(targets.get("m2")).toEqual(pose(100, 100));
    expect(targets.get("m1")).toEqual(placed.m1);
  });

  it("aligns a transistor-transistor stack before a load's stack", () => {
    // Net a (m1 drain to r1) sorts first but waits for Net b (m1 source to
    // m2 drain): m1 is claimed by the transistor stack.
    const d = circuit(
      { m1: "nmos", m2: "nmos", r1: "resistor", v: "vdd-port", g: "ground" },
      {
        vdd: ["v.P", "r1.1"],
        a: ["m1.D", "r1.2"],
        b: ["m1.S", "m2.D"],
        gnd: ["m2.S", "g.0"],
        in: ["m2.G"],
        bias: ["m1.G"],
      },
    );
    const placed = {
      r1: pose(100, 100),
      m1: pose(150, 200),
      m2: pose(200, 300),
    };
    const { aligned, targets, holds } = align(d, placed, ["r1"]);
    expect(aligned).toEqual(["b"]);
    expect(holds("b")).toBe(true);
    // m1 moved under m2's column is locked; r1 is frozen: Net a stays broken.
    expect(targets.get("m1")).toEqual(pose(200, 200));
    expect(holds("a")).toBe(false);
  });

  it("steps a free shunt capacitor out of the slot", () => {
    // c1 lies on the segment between r1's new pin and m1's drain.
    const { aligned, targets, holds } = align(commonSource(), {
      ...stage,
      c1: pose(110, 150),
    });
    expect(aligned).toEqual(["out"]);
    expect(holds("out")).toBe(true);
    expect(targets.get("c1")!.position.y).toBe(150);
    expect(Math.abs(targets.get("c1")!.position.x - 110)).toBeLessThanOrEqual(
      40,
    );
    expect(targets.get("c1")!.position.x).not.toBe(110);
  });

  it("keeps a frozen capacitor and takes the other mover or none", () => {
    const placed = { ...stage, c1: pose(110, 150) };
    // The load's slot is blocked: m1 moves under r1 instead.
    const moved = align(commonSource(), placed, ["c1"]);
    expect(moved.aligned).toEqual(["out"]);
    expect(moved.targets.get("c1")).toEqual(placed.c1);
    expect(moved.targets.get("m1")).toEqual(pose(130, 200));
    const none = align(commonSource(), placed, ["c1", "m1"]);
    expect(none.aligned).toEqual([]);
    expect(none.targets).toEqual(new Map(Object.entries(placed)));
  });
});

describe("R166 candidates", () => {
  it("offers the aligned draft and selects it when it routes better", () => {
    const d = selfBiased();
    const { plan, after } = completes(d);
    expect(refinementMetrics(plan)?.strategy).toBe("template+stack");
    const roles = classifyNets(d, resolver);
    const devices = d.instances.filter((i) => !isMarker(i));
    const [stack] = snap.stackPairs(devices, resolver, roles);
    const placements = (document: SchematicDocument) =>
      new Map(document.instances.map((i) => [i.id, i.placement!]));
    expect(snap.stackHolds(stack!, placements(after))).toBe(true);
    const original = planLayoutOnce(d, resolver, {}, emptyOverrides());
    expect(snap.stackHolds(stack!, placements(original.final!))).toBe(false);
  });

  it("plans exactly as without R166 when no draft's stack can be aligned", () => {
    const d = selfBiased();
    const without = (() => {
      const off = vi.spyOn(snap, "stackPairs").mockReturnValue([]);
      try {
        return JSON.stringify(planAutoLayout(d, resolver, quick));
      } finally {
        off.mockRestore();
      }
    })();
    const none = vi.spyOn(snap, "alignStacks").mockReturnValue([]);
    try {
      expect(JSON.stringify(planAutoLayout(d, resolver, quick))).toBe(without);
      expect(none).toHaveBeenCalled();
    } finally {
      none.mockRestore();
    }
  });

  it("plans exactly as without R166 when an offered candidate is not selected", () => {
    // A topology fixture (not a simulated circuit): Net d joins m2's drain
    // and r1, a stack whose aligned draft ranks among the refined drafts but
    // loses refinement to an original.
    const d = circuit(
      {
        m1: "nmos",
        m2: "nmos",
        m3: "nmos",
        r1: "resistor",
        v: "vdd-port",
        g: "ground",
      },
      {
        vdd: ["v.P", "m1.S", "m2.S"],
        gnd: ["g.0", "m1.D", "m2.G"],
        c: ["m1.G"],
        d: ["m2.D", "r1.2"],
        b: ["m3.D", "m3.G", "m3.S", "r1.1"],
      },
    );
    const options = { search: { seed: 1, evaluations: 8 } };
    const off = vi.spyOn(snap, "stackPairs").mockReturnValue([]);
    let without: string;
    try {
      without = JSON.stringify(planAutoLayout(d, resolver, options));
    } finally {
      off.mockRestore();
    }
    const placed = vi.spyOn(place, "placeDocument");
    const reroute = vi.spyOn(portfolio, "reroutePortfolio");
    try {
      const plan = planAutoLayout(d, resolver, options);
      // The candidate was built, yet the output is main's.
      expect(
        placed.mock.calls.some((call) => call[7] === "layered+stack"),
      ).toBe(true);
      expect(refinementMetrics(plan)?.strategy).not.toMatch(/\+stack$/);
      expect(JSON.stringify(plan)).toBe(without);
      // Neither the search nor the crossing reroutes saw a candidate's run.
      expect(reroute).toHaveBeenCalled();
      for (const call of reroute.mock.calls)
        expect(
          [...call[3]].filter((run) => snap.isStackStrategy(run.strategy)),
        ).toEqual([]);
    } finally {
      reroute.mockRestore();
      placed.mockRestore();
    }
  }, 30_000);

  it("plans no-stack Documents exactly as main at 65075a0", () => {
    // sha256 of JSON.stringify(planAutoLayout(..., quick)) from a clean build
    // of main 65075a0 (git archive of packages/auto-layout, tsc); rcDivider's
    // from a clean build of 36b51ef, whose src equals main's before R168.
    const hash = (d: SchematicDocument) =>
      createHash("sha256")
        .update(JSON.stringify(planAutoLayout(d, resolver, quick)))
        .digest("hex");
    // A divider with a filter capacitor: no transistor, so R168 never offers
    // its draft and this plan stays R166's alone. It replaced `twoLoads`,
    // which has a transistor: R168 offers and selects its draft there.
    const rcDivider = circuit(
      {
        r1: "resistor",
        r2: "resistor",
        c1: "capacitor",
        v: "vdd-port",
        g: "ground",
      },
      {
        vdd: ["v.P", "r1.1"],
        out: ["r1.2", "r2.1", "c1.1"],
        gnd: ["r2.2", "c1.2", "g.0"],
      },
    );
    // An inverter output with a load: three conduction terminals on the Net,
    // so no stack. It also covers R168's offered-but-not-selected path (the
    // draft is refined and loses); if a later R168 change makes the draft win
    // here, replace this shape with a transistor-free one.
    const inverter = circuit(
      { m1: "nmos", m2: "pmos", r1: "resistor", v: "vdd-port", g: "ground" },
      {
        vdd: ["v.P", "m2.S"],
        out: ["m1.D", "m2.D", "r1.1"],
        gnd: ["m1.S", "g.0", "r1.2"],
        in: ["m1.G", "m2.G"],
      },
    );
    expect(hash(rcDivider)).toBe(
      "fa1810b4b368df12cd0b3044c7351f1c4de2fa1b5db20df54408e0b030c4ae27",
    );
    expect(hash(inverter)).toBe(
      "c4332af3b35e50574d5027f2e97384221f7700b40a62884f24ae219d3cb58117",
    );
  });

  it("routes no candidate for a Document without a stack", () => {
    const d = circuit(
      { r1: "resistor", r2: "resistor", v: "vdd-port", g: "ground" },
      { vdd: ["v.P", "r1.1"], mid: ["r1.2", "r2.1"], gnd: ["r2.2", "g.0"] },
    );
    const spy = vi.spyOn(snap, "alignStacks");
    try {
      completes(d);
      expect(spy).not.toHaveBeenCalled();
    } finally {
      spy.mockRestore();
    }
  });

  it("does not offer a candidate that cannot be built", () => {
    const failing = vi.spyOn(snap, "alignStacks").mockImplementation(() => {
      throw new Error("alignment failed");
    });
    try {
      const { plan } = completes(selfBiased());
      expect(failing).toHaveBeenCalled();
      expect(refinementMetrics(plan)?.strategy).not.toMatch(/\+stack$/);
    } finally {
      failing.mockRestore();
    }
  });

  it("never moves a template member in the aligned draft", () => {
    const d = circuit(
      {
        m1: "nmos",
        m2: "nmos",
        m3: "pmos",
        m4: "pmos",
        m5: "nmos",
        r1: "resistor",
        v: "vdd-port",
        g: "ground",
      },
      {
        vdd: ["v.P", "m3.S", "m4.S"],
        x: ["m1.D", "m3.D", "m3.G", "m4.G"],
        out: ["m2.D", "m4.D", "r1.1"],
        tail: ["m1.S", "m2.S", "m5.D"],
        gnd: ["m5.S", "g.0", "r1.2"],
        inp: ["m1.G"],
        inn: ["m2.G"],
        bias: ["m5.G"],
      },
    );
    const roles = classifyNets(d, resolver);
    const groups = recognizeStructures(d, roles);
    const members = groups.flatMap((g) => [
      ...g.members,
      ...(g.extraMemberIds ?? []),
      ...(g.tailInstanceId ? [g.tailInstanceId] : []),
    ]);
    expect(members.length).toBeGreaterThan(0);
    const place = (strategy: "stages" | "stages+stack") =>
      placeDocument(
        d,
        resolver,
        roles,
        groups,
        {},
        emptyOverrides(),
        emptyChoices(),
        strategy,
      ).placements;
    const original = place("stages");
    const aligned = place("stages+stack");
    for (const id of members) expect(aligned.get(id)).toEqual(original.get(id));
  });

  it("never moves a fixed instance; with both members fixed, offers nothing", () => {
    const d = selfBiased();
    const draft = planLayoutOnce(d, resolver, {}, emptyOverrides());
    const input = preview(d, resolver, draft.result.edits).document!;
    const pose = (document: SchematicDocument, id: string) =>
      document.instances.find((i) => i.id === id)!.placement;
    const one = planAutoLayout(input, resolver, {
      ...quick,
      fixedInstanceIds: new Set(["m1"]),
    });
    const after = preview(input, resolver, one.edits);
    expect(after.ok).toBe(true);
    expect(pose(after.document!, "m1")).toEqual(pose(input, "m1"));
    const both = { ...quick, fixedInstanceIds: new Set(["m1", "r2"]) };
    const off = vi.spyOn(snap, "stackPairs").mockReturnValue([]);
    let without: string;
    try {
      without = JSON.stringify(planAutoLayout(input, resolver, both));
    } finally {
      off.mockRestore();
    }
    expect(JSON.stringify(planAutoLayout(input, resolver, both))).toBe(without);
  });

  it("offers no candidate under an explicit floorplan", () => {
    const d = selfBiased();
    const partition = {
      blocks: [
        {
          id: "all",
          members: d.instances.filter((i) => !isMarker(i)).map((i) => i.id),
        },
      ],
      arrangement: { all: { x: 0, y: 0 } },
    };
    const spy = vi.spyOn(snap, "alignStacks");
    try {
      const plan = planAutoLayout(d, resolver, { ...quick, partition });
      expect(plan.diagnostics.filter((x) => x.severity === "error")).toEqual(
        [],
      );
      expect(spy).not.toHaveBeenCalled();
    } finally {
      spy.mockRestore();
    }
  });

  it("plans the same Document identically twice", () => {
    const d = selfBiased();
    expect(JSON.stringify(planAutoLayout(d, resolver, quick))).toBe(
      JSON.stringify(planAutoLayout(d, resolver, quick)),
    );
  });
});

describe("R166 search guard", () => {
  const d = commonSource();
  const roles = classifyNets(d, resolver);
  const devices = d.instances.filter((i) => !isMarker(i));
  const held = new Map(Object.entries({ ...stage, r1: pose(110, 100) }));
  const broken = new Map(Object.entries(stage));

  it("rejects a proposal that breaks an aligned column that holds", () => {
    const keeps = snap.keepsAlignedStacks(devices, resolver, roles, ["out"]);
    expect(keeps(held, broken)).toBe(false);
    expect(keeps(held, held)).toBe(true);
    // Monotone: a column that is already broken does not block a move.
    expect(keeps(broken, broken)).toBe(true);
  });

  it("never evaluates a proposal that breaks the aligned column", () => {
    const d = selfBiased();
    const [stack] = snap.stackPairs(
      d.instances.filter((i) => !isMarker(i)),
      resolver,
      classifyNets(d, resolver),
    );
    const guard = vi.spyOn(snap, "keepsAlignedStacks");
    const placed = vi.spyOn(place, "placeDocument");
    try {
      const plan = planAutoLayout(d, resolver, {
        search: { seed: 1, evaluations: 8 },
      });
      expect(plan.diagnostics.filter((x) => x.severity === "error")).toEqual(
        [],
      );
      expect(refinementMetrics(plan)?.strategy).toBe("template+stack");
      expect(guard.mock.calls.map((call) => call[3])).toContainEqual(["a"]);
      // Annealer evaluations re-place a given state inside the search bounds.
      const proposals = placed.mock.calls
        .filter((call) => call[8] && call[9])
        .map((call) => call[8]!);
      expect(proposals.length).toBeGreaterThan(0);
      // Without the guard, 8 of these 16 proposals break Net a's column.
      for (const proposal of proposals)
        expect(snap.stackHolds(stack!, proposal)).toBe(true);
    } finally {
      placed.mockRestore();
      guard.mockRestore();
    }
  }, 30_000);

  it("guards only the columns the start draft aligned", () => {
    const keeps = snap.keepsAlignedStacks(devices, resolver, roles, []);
    expect(keeps(held, broken)).toBe(true);
    expect(
      snap.keepsAlignedStacks(
        devices,
        resolver,
        roles,
        undefined,
      )(held, broken),
    ).toBe(true);
  });
});
