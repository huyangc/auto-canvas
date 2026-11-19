import { describe, expect, it } from "vitest";
import type { SchematicDocument } from "@icm/model";
import { InMemorySymbolResolver, builtInSymbols } from "@icm/symbols";
import { chainColumnCount, chainColumns, heldChainColumns } from "../src/chain-columns.js";
import { ROUTED_SCORE_WEIGHTS, finishedSelectionScore } from "../src/refine.js";
import type { LayoutRun } from "../src/refine.js";
import { emptyChoices } from "../src/layout-choices.js";
import { classifyNets } from "../src/net-roles.js";
import { placement } from "../src/geometry.js";
import { circuit } from "./document-fixture.js";

const resolver = new InMemorySymbolResolver(builtInSymbols);

/**
 * T143's relation: a non-rail Net carrying exactly two conduction terminals on
 * two different devices, at least one a transistor, plus a further tap terminal
 * that is not a MOS bulk.
 */
const chain = () =>
  circuit(
    { m1: "nmos", r1: "resistor", c1: "capacitor", v: "vdd-port", g: "ground" },
    {
      vdd: ["v.P", "r1.1"],
      a: ["r1.2", "m1.D", "c1.1"],
      gnd: ["m1.S", "g.0", "c1.2"],
      in: ["m1.G"],
    },
  );
// Built-in geometry: nmos D is local (10, -20) exiting north, resistor pin 2
// is local (0, 20) exiting south. At these poses m1.D sits at (110, 180) and
// r1.2 at (110, 120): one column, the two pins facing each other.
const column = {
  m1: placement(100, 200),
  r1: placement(110, 100),
  c1: placement(300, 200),
};
/** The same Net with the load moved off the column. */
const folded = {
  m1: placement(100, 200),
  r1: placement(400, 100),
  c1: placement(300, 200),
};

function placed(d: SchematicDocument, poses: Record<string, ReturnType<typeof placement>>) {
  const copy = structuredClone(d);
  for (const instance of copy.instances)
    if (poses[instance.id]) instance.placement = structuredClone(poses[instance.id]!);
  return copy;
}

const names = (columns: { net: string }[]) => columns.map((column) => column.net);

describe("T143 CHAIN columns", () => {
  it("finds a non-rail Net with two conduction terminals and a tap", () => {
    const d = chain();
    const columns = chainColumns(d, resolver);
    expect(names(columns)).toEqual(["a"]);
    expect(columns[0]!.taps).toBe(1);
    expect(new Set([columns[0]!.a.id, columns[0]!.b.id])).toEqual(
      new Set(["m1", "r1"]),
    );
    // The rail is not a column, and the capacitor is no conduction terminal.
    expect(names(chainColumns(d, resolver)).includes("vdd")).toBe(false);
  });

  it("rejects a two-device Net with no tap", () => {
    // The R166 stack relation: the same two conduction terminals, no third one.
    const d = circuit(
      { m1: "nmos", r1: "resistor", v: "vdd-port", g: "ground" },
      {
        vdd: ["v.P", "r1.1"],
        a: ["r1.2", "m1.D"],
        gnd: ["m1.S", "g.0"],
        in: ["m1.G"],
      },
    );
    expect(chainColumns(d, resolver)).toEqual([]);
  });

  it("rejects a rail Net even when it carries a tap", () => {
    const d = circuit(
      { m1: "nmos", m2: "nmos", g: "ground" },
      { gnd: ["m1.S", "m2.S", "g.0"], in: ["m1.G", "m2.G"] },
    );
    expect(chainColumns(d, resolver)).toEqual([]);
  });

  it("rejects two passive parts, and a bulk-only tap", () => {
    const passive = circuit(
      { r1: "resistor", r2: "resistor", r3: "resistor" },
      { a: ["r1.2", "r2.1", "r3.1"] },
    );
    expect(chainColumns(passive, resolver)).toEqual([]);
    // m1's own body is not a tap: the Net stays an R166 stack.
    const bulk = circuit(
      { m1: "nmos", r1: "resistor", v: "vdd-port", g: "ground" },
      {
        vdd: ["v.P", "r1.1"],
        a: ["r1.2", "m1.D", "m1.B"],
        gnd: ["m1.S", "g.0"],
        in: ["m1.G"],
      },
    );
    expect(chainColumns(bulk, resolver)).toEqual([]);
  });

  it("accepts a third terminal wherever it sits: it is the tap, not a pin of the pair", () => {
    // The pre-tests' `others` test is a count, not a geometry: a tap that lies
    // outside the two pins' segment is still the Net's tap, and whether the
    // drawing *holds* the column is decided only by the two conduction pins.
    const placedChain = placed(chain(), column);
    expect(heldChainColumns(placedChain, resolver)).toEqual(["a"]);
    // A second tap on the far side of the drawing is no different.
    const wide = chain();
    wide.nets.find((net) => net.id === "a")!.terminals.push({
      instanceId: "c1",
      pinName: "1",
    });
    expect(heldChainColumns(placed(wide, column), resolver)).toEqual(["a"]);
  });
});

describe("T143 CHAIN columns held", () => {
  it("holds a column whose two pins are collinear across their exit axis", () => {
    const d = placed(chain(), column);
    expect(heldChainColumns(d, resolver)).toEqual(["a"]);
    expect(chainColumnCount(d, resolver)).toBe(1);
  });

  it("breaks the column when the load leaves the axis", () => {
    const d = placed(chain(), folded);
    // The Net is still a column by connectivity; the drawing no longer holds it.
    expect(names(chainColumns(d, resolver))).toEqual(["a"]);
    expect(heldChainColumns(d, resolver)).toEqual([]);
    expect(chainColumnCount(d, resolver)).toBe(0);
  });

  it("breaks the column when a device body stands between the two pins", () => {
    // The pre-tests' rule is the R166 one: a body whose centre lies on the
    // segment between the two device centres, on that axis. c1's body sits in
    // the slot between r1's and m1's.
    const d = placed(chain(), { ...column, c1: placement(95, 150) });
    expect(names(chainColumns(d, resolver))).toEqual(["a"]);
    expect(heldChainColumns(d, resolver)).toEqual([]);
  });

  it("needs both pins to exit along the same axis", () => {
    // m1 is turned so its drain leaves sideways; r1's pin still leaves south.
    const turned = { ...column, m1: placement(100, 200, "none", 90) };
    const d = placed(chain(), turned);
    expect(chainColumns(d, resolver)).toHaveLength(1);
    expect(heldChainColumns(d, resolver)).toEqual([]);
  });

  it("is netlist-only: the relation does not depend on a pose", () => {
    const d = chain();
    expect(classifyNets(d, resolver).pinNet("r1", "2")).toBe("a");
    expect(names(chainColumns(d, resolver))).toEqual(["a"]);
  });
});

describe("T143 finished-plan score", () => {
  const run = (d: SchematicDocument): LayoutRun => ({
    result: { edits: [], diagnostics: [], groups: [] },
    final: d,
    choices: emptyChoices(),
  });

  it("charges one bend per column the plan fails to hold", () => {
    const held = finishedSelectionScore(run(placed(chain(), column)), resolver);
    const lost = finishedSelectionScore(run(placed(chain(), folded)), resolver);
    // The load leaving the column also lengthens the wire, so the score delta
    // is the weight plus that wire cost; the weight itself is one bend.
    expect(lost - held).toBeGreaterThanOrEqual(
      ROUTED_SCORE_WEIGHTS.chainColumns,
    );
    expect(ROUTED_SCORE_WEIGHTS.chainColumns).toBe(ROUTED_SCORE_WEIGHTS.bends);
  });

  it("counts held columns, never Nets: a plan with no Nets cannot win the term", () => {
    const empty = circuit({}, {});
    expect(finishedSelectionScore(run(empty), resolver)).toBe(
      // No final-route terms at all; the point is that the term is not negative
      // relative to a plan that dropped the Net entirely.
      0,
    );
  });

  it("never changes an unusable plan's score", () => {
    const broken: LayoutRun = {
      result: { edits: [], diagnostics: [{ severity: "error" } as never], groups: [] },
      final: placed(chain(), column),
      choices: emptyChoices(),
    };
    expect(finishedSelectionScore(broken, resolver)).toBe(Infinity);
  });
});
