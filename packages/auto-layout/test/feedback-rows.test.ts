import { describe, expect, it, vi } from "vitest";
import { visibleInstanceBounds } from "@icm/derived";
import type { SchematicDocument } from "@icm/model";
import { InMemorySymbolResolver, builtInSymbols } from "@icm/symbols";
import * as rows from "../src/feedback-rows.js";
import { geometryProblem, pinPoints, withPlacements } from "../src/geometry.js";
import { classifyNets } from "../src/net-roles.js";
import { planAutoLayout } from "../src/index.js";
import { refinementMetrics } from "../src/refine.js";
import { equivalentTerminals, preview } from "../src/transaction.js";
import { circuit } from "./document-fixture.js";

const resolver = new InMemorySymbolResolver(builtInSymbols);

/** Plan with R163 recognition switched off, as on main. */
function withoutDraft<T>(run: () => T): T {
  const off = vi.spyOn(rows, "feedbackRowCircuit").mockReturnValue(undefined);
  try {
    return run();
  } finally {
    off.mockRestore();
  }
}

/** Quick mode: every strategy's draft is built and routed, without search. */
const quick = { search: { seed: 1, evaluations: 0 } };

/** Plan in quick mode; the result must apply and keep terminals. */
function completes(d: SchematicDocument) {
  const plan = planAutoLayout(d, resolver, quick);
  expect(plan.diagnostics.filter((x) => x.severity === "error")).toEqual([]);
  const after = preview(d, resolver, plan.edits);
  expect(after.ok).toBe(true);
  expect(equivalentTerminals(d, after.document!, resolver)).toBe(true);
  return plan;
}

function draft(d: SchematicDocument) {
  const roles = classifyNets(d, resolver);
  const found = rows.feedbackRowCircuit(d, resolver, roles);
  expect(found).toBeDefined();
  const placed = rows.placeFeedbackRows(d, resolver, roles, found!);
  const devices = d.instances.filter((i) => placed.has(i.id));
  const document = withPlacements({ ...d, instances: devices }, placed);
  expect(geometryProblem(document, resolver)).toBeUndefined();
  const box = new Map(
    visibleInstanceBounds(document, resolver).map((b) => [b.id, b.bounds]),
  );
  const points = pinPoints(document, resolver);
  const pin = (id: string, name: string) =>
    points.find((p) => p.instanceId === id && p.pinName === name)!.point;
  const centreY = (id: string) => box.get(id)!.y + box.get(id)!.height / 2;
  const above = (a: string, b: string) =>
    box.get(a)!.y + box.get(a)!.height <= box.get(b)!.y;
  return { found: found!, box, pin, centreY, above };
}

/** Interface terminals for the fixture's ports: [port, Net, direction]. */
function withPorts(
  d: SchematicDocument,
  ports: [string, string, "input" | "output"][],
): SchematicDocument {
  d.netlist = {
    name: "test",
    formalParameters: [],
    terminals: ports.map(([port, netId, direction]) => ({
      id: `${port}-terminal`,
      name: port,
      netId,
      direction,
      interfaceInstanceIds: [port],
    })),
  };
  return d;
}

/** Ports and a ground marker around a single-supply amplifier stage. */
function stage(
  symbols: Record<string, string>,
  nets: Record<string, string[]>,
): SchematicDocument {
  return withPorts(
    circuit(
      { ...symbols, pin: "port", pout: "port", g: "ground" },
      {
        ...nets,
        vin: [...(nets.vin ?? []), "pin.P"],
        out: [...(nets.out ?? []), "pout.P"],
        gnd: [...(nets.gnd ?? []), "g.0"],
      },
    ),
    [
      ["pin", "vin", "input"],
      ["pout", "out", "output"],
    ],
  );
}

describe("R163 feedback-row draft", () => {
  it("draws an inverting amplifier's feedback resistor above the block", () => {
    const d = stage(
      { a: "opamp", r1: "resistor", r2: "resistor" },
      {
        vin: ["r1.1"],
        x: ["r1.2", "r2.1", "a.IN-"],
        out: ["r2.2", "a.OUT"],
        gnd: ["a.IN+"],
      },
    );
    const { found, pin, above, box } = draft(d);
    expect(found.chains).toEqual([
      { block: "a", output: "out", input: "x", parts: ["r2"] },
    ]);
    // Feedback row: above the block, horizontal, input column to output column.
    expect(above("r2", "a")).toBe(true);
    expect(pin("r2", "1").y).toBe(pin("r2", "2").y);
    expect(pin("r2", "1").x).toBeLessThan(pin("r2", "2").x);
    const middle = (pin("r2", "1").x + pin("r2", "2").x) / 2;
    expect(middle).toBeGreaterThan(pin("a", "IN-").x);
    expect(middle).toBeLessThan(pin("a", "OUT").x);
    expect(box.get("r2")!.width).toBeLessThan(box.get("a")!.width * 2);
    // Main row: the input resistor left of the block, level with the input.
    expect(pin("r1", "2").y).toBe(pin("a", "IN-").y);
    expect(pin("r1", "1").x).toBeLessThan(pin("r1", "2").x);
    expect(box.get("r1")!.x + box.get("r1")!.width).toBeLessThan(
      box.get("a")!.x,
    );
    // The fed-back input pin faces up.
    expect(pin("a", "IN-").y).toBeLessThan(pin("a", "IN+").y);
  });

  it("stacks an integrator's capacitor and reset switch above the block", () => {
    const d = stage(
      { a: "opamp", r: "resistor", c: "capacitor", s: "closed-switch" },
      {
        vin: ["r.1"],
        x: ["r.2", "c.1", "s.1", "a.IN-"],
        out: ["c.2", "s.2", "a.OUT"],
        gnd: ["a.IN+"],
      },
    );
    const { found, above, pin } = draft(d);
    expect(found.chains.map((c) => c.parts)).toEqual([["c"], ["s"]]);
    expect(above("c", "a")).toBe(true);
    expect(above("s", "a")).toBe(true);
    // Parallel feedback parts are stacked, never side by side.
    expect(above("s", "c") || above("c", "s")).toBe(true);
    for (const id of ["c", "s"]) expect(pin(id, "1").y).toBe(pin(id, "2").y);
  });

  it("puts a parallel switched-capacitor branch in its own row", () => {
    const d = stage(
      {
        a: "opamp",
        s1: "closed-switch",
        c1: "capacitor",
        s2: "closed-switch",
        c2: "capacitor",
        s3: "ideal-switch",
        s4: "ideal-switch",
      },
      {
        vin: ["s1.1", "s2.1"],
        n1: ["s1.2", "c1.1"],
        n2: ["s2.2", "c2.1", "s3.1"],
        x: ["c1.2", "c2.2", "s4.1", "a.IN-"],
        out: ["s4.2", "a.OUT"],
        gnd: ["s3.2", "a.IN+"],
      },
    );
    const { found, pin, centreY, box } = draft(d);
    expect(found.chains.map((c) => c.parts)).toEqual([["s4"]]);
    // One branch in the main row, the other in a row below: never end to end.
    const main = pin("a", "IN-").y;
    expect(pin("s1", "2").y).toBe(main);
    expect(pin("c1", "2").y).toBe(main);
    expect(centreY("s2")).toBeGreaterThan(main);
    expect(pin("s2", "2").y).toBe(pin("c2", "1").y);
    expect(box.get("c2")!.x + box.get("c2")!.width).toBeLessThan(
      box.get("a")!.x,
    );
    // The shunt hangs below its node.
    expect(pin("s3", "2").y).toBeGreaterThan(pin("s3", "1").y);
    expect(pin("s3", "1").x).toBe(pin("s3", "2").x);
  });

  it("draws a differential block's halves above and below in separate rows", () => {
    const d = withPorts(
      circuit(
        {
          a: "opamp-differential",
          r1: "resistor",
          r2: "resistor",
          c1: "capacitor",
          c2: "capacitor",
          pn: "port",
          pp: "port",
          on: "port",
          op: "port",
        },
        {
          vinn: ["r1.1", "pn.P"],
          vinp: ["r2.1", "pp.P"],
          x: ["r1.2", "c1.1", "a.IN-"],
          y: ["r2.2", "c2.1", "a.IN+"],
          outp: ["c1.2", "a.OUT+", "op.P"],
          outn: ["c2.2", "a.OUT-", "on.P"],
        },
      ),
      [
        ["pn", "vinn", "input"],
        ["pp", "vinp", "input"],
        ["on", "outn", "output"],
        ["op", "outp", "output"],
      ],
    );
    const { found, above, pin } = draft(d);
    expect(found.chains.map((c) => c.parts).sort()).toEqual([["c1"], ["c2"]]);
    expect(above("c1", "a")).toBe(true);
    expect(above("a", "c2")).toBe(true);
    // Each input chain is levelled with its own pin, in its own row.
    expect(pin("r1", "2").y).toBe(pin("a", "IN-").y);
    expect(pin("r2", "2").y).toBeGreaterThanOrEqual(pin("a", "IN+").y);
    expect(pin("r2", "1").y).toBe(pin("r2", "2").y);
    expect(above("r1", "r2")).toBe(true);
  });

  it("stacks independent circuits in bands", () => {
    const d = circuit(
      { a: "inverter", r: "resistor", b: "inverter", l: "inductor" },
      {
        i1: ["a.A", "r.1"],
        o1: ["a.Y", "r.2"],
        i2: ["b.A"],
        o2: ["b.Y", "l.1"],
      },
    );
    const { above } = draft(d);
    expect(above("a", "b") || above("b", "a")).toBe(true);
  });

  it.each([
    [
      "a block without feedback",
      stage(
        { a: "opamp", r1: "resistor", r2: "resistor" },
        {
          vin: ["r1.1"],
          x: ["r1.2", "a.IN+"],
          out: ["a.OUT", "r2.1"],
          gnd: ["r2.2", "a.IN-"],
        },
      ),
    ],
    [
      "a passive-only circuit",
      stage(
        { r1: "resistor", r2: "resistor", c: "capacitor" },
        { vin: ["r1.1"], out: ["r1.2", "r2.1", "c.1"], gnd: ["r2.2", "c.2"] },
      ),
    ],
    [
      "a circuit with a MOS",
      stage(
        { a: "opamp", r: "resistor", m: "nmos" },
        {
          vin: ["a.IN+"],
          x: ["a.IN-", "r.1", "m.S"],
          out: ["a.OUT", "r.2"],
          d: ["m.D"],
          gnd: ["m.G"],
        },
      ),
    ],
  ])("is not offered for %s", (_, d) => {
    expect(
      rows.feedbackRowCircuit(d, resolver, classifyNets(d, resolver)),
    ).toBeUndefined();
    const placed = vi.spyOn(rows, "placeFeedbackRows");
    try {
      const plan = planAutoLayout(d, resolver, {
        search: { seed: 1, evaluations: 0 },
      });
      expect(placed).not.toHaveBeenCalled();
      expect(refinementMetrics(plan)?.strategy).not.toBe("feedback-rows");
    } finally {
      placed.mockRestore();
    }
    // The plan equals the plan with the R163 draft disabled.
    expect(JSON.stringify(planAutoLayout(d, resolver, quick))).toBe(
      JSON.stringify(withoutDraft(() => planAutoLayout(d, resolver, quick))),
    );
  });

  it("offers the draft as a fourth strategy for its subset", () => {
    const d = stage(
      { a: "opamp", r1: "resistor", r2: "resistor" },
      {
        vin: ["r1.1"],
        x: ["r1.2", "r2.1", "a.IN-"],
        out: ["r2.2", "a.OUT"],
        gnd: ["a.IN+"],
      },
    );
    const placed = vi.spyOn(rows, "placeFeedbackRows");
    try {
      const plan = planAutoLayout(d, resolver, {
        search: { seed: 1, evaluations: 0 },
      });
      expect(placed).toHaveBeenCalled();
      expect(plan.diagnostics.filter((x) => x.severity === "error")).toEqual(
        [],
      );
    } finally {
      placed.mockRestore();
    }
  });
  it("recognizes a feedback chain of up to four parts, not five", () => {
    const chain = (n: number) => {
      const symbols: Record<string, string> = { a: "opamp", r: "resistor" };
      const nets: Record<string, string[]> = {
        vin: ["r.1"],
        x: ["r.2", "a.IN-", "f1.1"],
        out: ["a.OUT", `f${n}.2`],
        gnd: ["a.IN+"],
      };
      for (let k = 1; k <= n; k++) {
        symbols[`f${k}`] = k % 2 ? "resistor" : "capacitor";
        if (k < n) nets[`m${k}`] = [`f${k}.2`, `f${k + 1}.1`];
      }
      return stage(symbols, nets);
    };
    const { found, above } = draft(chain(4));
    expect(found.chains.map((c) => c.parts)).toEqual([
      ["f1", "f2", "f3", "f4"],
    ]);
    for (const id of ["f1", "f2", "f3", "f4"])
      expect(above(id, "a")).toBe(true);
    const five = chain(5);
    expect(
      rows.feedbackRowCircuit(five, resolver, classifyNets(five, resolver)),
    ).toBeUndefined();
  });

  it("places two blocks that feed each other", () => {
    const d = stage(
      {
        a: "opamp",
        b: "opamp",
        r1: "resistor",
        r2: "resistor",
        r3: "resistor",
      },
      {
        vin: ["r1.1"],
        x: ["r1.2", "r2.1", "a.IN-"],
        y: ["a.OUT", "r2.2", "r3.1"],
        z: ["r3.2", "b.IN-"],
        out: ["b.OUT", "a.IN+"],
        gnd: ["b.IN+"],
      },
    );
    const { found, box } = draft(d);
    expect(found.chains.map((c) => c.block)).toEqual(["a"]);
    expect(box.get("a")!.x).toBeLessThan(box.get("b")!.x);
    completes(d);
  });

  it("follows one output of a block with two output Nets", () => {
    const d = withPorts(
      circuit(
        {
          a: "opamp-differential",
          r1: "resistor",
          r2: "resistor",
          c: "capacitor",
          pn: "port",
          pp: "port",
          on: "port",
          op: "port",
        },
        {
          vinn: ["r1.1", "pn.P"],
          vinp: ["r2.1", "pp.P"],
          x: ["r1.2", "c.1", "a.IN-"],
          y: ["r2.2", "a.IN+"],
          outp: ["c.2", "a.OUT+", "op.P"],
          outn: ["a.OUT-", "on.P"],
        },
      ),
      [
        ["pn", "vinn", "input"],
        ["pp", "vinp", "input"],
        ["on", "outn", "output"],
        ["op", "outp", "output"],
      ],
    );
    const { found, above } = draft(d);
    expect(found.chains).toEqual([
      { block: "a", output: "outp", input: "x", parts: ["c"] },
    ]);
    expect(above("c", "a")).toBe(true);
    completes(d);
  });

  it("plans the same document identically twice", () => {
    const d = stage(
      { a: "opamp", r: "resistor", c: "capacitor", s: "closed-switch" },
      {
        vin: ["r.1"],
        x: ["r.2", "c.1", "s.1", "a.IN-"],
        out: ["c.2", "s.2", "a.OUT"],
        gnd: ["a.IN+"],
      },
    );
    expect(JSON.stringify(planAutoLayout(d, resolver, quick))).toBe(
      JSON.stringify(planAutoLayout(structuredClone(d), resolver, quick)),
    );
  });

  it("never treats a control Net as a conducting terminal", () => {
    // A shorted switch (P and N on one Net) drives another switch's control.
    const d = stage(
      {
        a: "opamp",
        r1: "resistor",
        r2: "resistor",
        s1: "externally-controlled-switch",
        s2: "externally-controlled-switch",
      },
      {
        vin: ["r1.1", "s1.CTRL"],
        x: ["r1.2", "r2.1", "a.IN-", "s2.P"],
        out: ["r2.2", "a.OUT", "s2.N"],
        c: ["s1.P", "s1.N", "s2.CTRL"],
        gnd: ["a.IN+"],
      },
    );
    draft(d);
    completes(d);
  });

  it("plans with the other strategies when the draft cannot be built", () => {
    const d = stage(
      { a: "opamp", r1: "resistor", r2: "resistor" },
      {
        vin: ["r1.1"],
        x: ["r1.2", "r2.1", "a.IN-"],
        out: ["r2.2", "a.OUT"],
        gnd: ["a.IN+"],
      },
    );
    const failing = vi
      .spyOn(rows, "placeFeedbackRows")
      .mockImplementation(() => {
        throw new Error("draft failed");
      });
    try {
      const plan = completes(d);
      expect(failing).toHaveBeenCalled();
      expect(refinementMetrics(plan)?.strategy).not.toBe("feedback-rows");
    } finally {
      failing.mockRestore();
    }
  });

  it("places a two-pin part whose pins share one Net", () => {
    const d = stage(
      { a: "opamp", r1: "resistor", r2: "resistor", short: "resistor" },
      {
        vin: ["r1.1"],
        x: ["r1.2", "r2.1", "a.IN-", "short.1", "short.2"],
        out: ["r2.2", "a.OUT"],
        gnd: ["a.IN+"],
      },
    );
    draft(d);
    completes(d);
  });
});
