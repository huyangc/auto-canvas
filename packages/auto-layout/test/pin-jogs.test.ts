import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { SchematicDocument } from "@icm/model";
import { builtInSymbols, InMemorySymbolResolver } from "@icm/symbols";
import {
  defaultLayoutSearch,
  planAutoLayout,
  planLayoutOnce,
} from "../src/auto-layout.js";
import { enclosingBox, placement } from "../src/geometry.js";
import { emptyOverrides } from "../src/layout-choices.js";
import { pinJogs, straightenPinJogs, visibleCorners } from "../src/pin-jogs.js";
import { terminalPartition } from "../src/transaction.js";
import type { LayoutRun } from "../src/refine.js";
import { auditRouting } from "../src/routing-audit.js";
import type { Placement } from "../src/types.js";
import { circuit } from "./document-fixture.js";

const resolver = new InMemorySymbolResolver(builtInSymbols);

function place(
  document: SchematicDocument,
  poses: Record<string, readonly [number, number]>,
) {
  for (const instance of document.instances)
    instance.placement = placement(...poses[instance.id]!);
  return document;
}

/** Finishes exact placements, as the finishing chain's replan does. */
function replanner(document: SchematicDocument, fixed: ReadonlySet<string>) {
  return (placements: ReadonlyMap<string, Placement>) =>
    planLayoutOnce(
      document,
      resolver,
      { fixedInstanceIds: fixed },
      emptyOverrides(),
      "template",
      true,
      undefined,
      undefined,
      placements,
    );
}

function start(document: SchematicDocument, fixed: ReadonlySet<string>) {
  const replan = replanner(document, fixed);
  const initial = replan(
    new Map(document.instances.map((i) => [i.id, i.placement!])),
  );
  expect(
    initial.final,
    JSON.stringify(initial.result.diagnostics),
  ).toBeDefined();
  return { initial, replan };
}

const position = (document: SchematicDocument, id: string) =>
  document.instances.find((i) => i.id === id)!.placement!.position;

/** Resistor b sits 20 right of a's lower pin line: one Z jog at b.1. */
const twoPin = () =>
  place(circuit({ a: "resistor", b: "resistor" }, { s: ["a.2", "b.1"] }), {
    a: [0, 0],
    b: [20, 120],
  });

/** The gate of M sits one grid step above the wire from R. */
const gate = () =>
  place(circuit({ M: "nmos", R: "resistor" }, { g: ["M.G", "R.2"] }), {
    M: [200, 100],
    R: [0, 90],
  });

/** `twoPin` plus two unrelated straight wires on the right. */
const withBystander = () => {
  const document = circuit(
    {
      a: "resistor",
      b: "resistor",
      c: "resistor",
      d: "resistor",
      e: "resistor",
      f: "resistor",
    },
    { s: ["a.2", "b.1"], t: ["c.2", "d.1"], u: ["e.2", "f.1"] },
  );
  return place(document, {
    a: [0, 0],
    b: [20, 120],
    c: [300, 0],
    d: [300, 120],
    e: [400, 0],
    f: [400, 120],
  });
};

describe("R167 pin jogs", () => {
  it("finds a Z jog at a two-pin part and at a gate", () => {
    const fixed = new Set(["a"]);
    const part = start(twoPin(), fixed).initial.final!;
    expect(pinJogs(part, resolver)).toMatchObject([
      {
        instanceId: "b",
        pinName: "1",
        subject: "two-pin",
        pattern: "Z",
        step: { x: -20, y: 0 },
        tipDeparture: true,
      },
    ]);
    const transistor = start(gate(), new Set(["R"])).initial.final!;
    expect(pinJogs(transistor, resolver)).toMatchObject([
      {
        instanceId: "M",
        pinName: "G",
        subject: "gate",
        pattern: "Z",
        step: { x: 0, y: 10 },
      },
    ]);
  });

  it("does not call a step above two grid steps a jog", () => {
    const document = twoPin();
    document.instances[1]!.placement = placement(30, 120);
    const { initial } = start(document, new Set(["a"]));
    expect(pinJogs(initial.final!, resolver)).toEqual([]);
  });

  it("does not take a gate on a rail Net as a subject", () => {
    const document = gate();
    document.connectivityEvidence.push(
      { id: "g-source", kind: "spice-source", netId: "g", sourceNetId: "g" },
      {
        id: "g-claim",
        kind: "name-claim",
        netId: "g",
        name: "GND",
        scope: "global",
        powerDomain: "ground",
        owner: { kind: "global-declaration", sourceNetId: "g" },
      },
    );
    const { initial } = start(document, new Set(["R"]));
    expect(
      pinJogs(initial.final!, resolver).filter((j) => j.instanceId === "M"),
    ).toEqual([]);
  });

  it("straightens a two-pin part by exactly the step", () => {
    const fixed = new Set(["a"]);
    const document = twoPin();
    const snapshot = structuredClone(document);
    const { initial, replan } = start(document, fixed);
    const result = straightenPinJogs(initial, resolver, fixed, replan);
    expect(position(result.final!, "b")).toEqual({ x: 0, y: 120 });
    expect(position(result.final!, "a")).toEqual({ x: 0, y: 0 });
    expect(pinJogs(result.final!, resolver)).toEqual([]);
    expect(visibleCorners(result.final!, resolver)).toBeLessThan(
      visibleCorners(initial.final!, resolver),
    );
    expect(terminalPartition(result.final!, resolver)).toBe(
      terminalPartition(document, resolver),
    );
    expect(document).toEqual(snapshot);
  });

  it("straightens a gate one grid step off its driver", () => {
    const fixed = new Set(["R"]);
    const { initial, replan } = start(gate(), fixed);
    const result = straightenPinJogs(initial, resolver, fixed, replan);
    expect(position(result.final!, "M")).toEqual({ x: 200, y: 110 });
    expect(pinJogs(result.final!, resolver)).toEqual([]);
  });

  it("keeps the drawing's anchor when nothing is fixed", () => {
    const fixed = new Set<string>();
    const { initial, replan } = start(twoPin(), fixed);
    const result = straightenPinJogs(initial, resolver, fixed, replan);
    expect(result).not.toBe(initial);
    expect(pinJogs(result.final!, resolver)).toEqual([]);
    expect(position(result.final!, "a").y).toBe(0);
    expect(position(result.final!, "b").y).toBe(120);
  });

  it("does not move a part onto another body", () => {
    const document = circuit(
      { a: "resistor", b: "resistor", block: "resistor" },
      { s: ["a.2", "b.1"] },
    );
    place(document, { a: [0, 0], b: [20, 120], block: [0, 130] });
    const fixed = new Set(["a"]);
    const { initial, replan } = start(document, fixed);
    expect(pinJogs(initial.final!, resolver)).toHaveLength(1);
    const trials: unknown[] = [];
    const result = straightenPinJogs(initial, resolver, fixed, (p) => {
      trials.push(p);
      return replan(p);
    });
    expect(result).toBe(initial);
    expect(trials).toEqual([]);
  });

  // Each trial straightens the jog, but the replan also moves a bystander so
  // that the finished drawing is worse on one listed measure.
  it.each([
    ["adds a crossing", { c: [-60, 40], d: [60, 100] }, "crossings"],
    ["adds a bend", { d: [330, 120], f: [370, 120] }, "bends"],
    ["stretches the drawing", { d: [300, 200] }, "height"],
  ] as const)("rejects a trial that %s", (_name, moves, worse) => {
    const fixed = new Set(["a"]);
    const { initial, replan } = start(withBystander(), fixed);
    const finished: LayoutRun[] = [];
    const result = straightenPinJogs(initial, resolver, fixed, (p) => {
      const trial = new Map(p);
      for (const [id, [x, y]] of Object.entries(moves))
        trial.set(id, placement(x, y));
      const run = replan(trial);
      finished.push(run);
      return run;
    });
    expect(result).toBe(initial);
    expect(finished).toHaveLength(1);
    const measure = (run: LayoutRun) => {
      const audit = auditRouting(run.final!, resolver);
      const { height } = enclosingBox(run.final!, resolver);
      return { ...audit, height, jogs: pinJogs(run.final!, resolver) };
    };
    const before = measure(initial);
    const after = measure(finished[0]!);
    expect(after.jogs.length).toBeLessThan(before.jogs.length);
    expect(after[worse]).toBeGreaterThan(
      before[worse] + (worse === "height" ? 20 : 0),
    );
  });

  it("rejects a trial the replan declines by returning an earlier run", () => {
    const fixed = new Set(["a"]);
    const { initial, replan } = start(twoPin(), fixed);
    // The earlier run has no jog, so only the identity check can refuse it.
    const earlier = replan(
      new Map([
        ["a", placement(0, 0)],
        ["b", placement(0, 120)],
      ]),
    );
    expect(pinJogs(earlier.final!, resolver)).toEqual([]);
    expect(
      straightenPinJogs(
        initial,
        resolver,
        fixed,
        () => earlier,
        undefined,
        earlier,
      ),
    ).toBe(initial);
    expect(straightenPinJogs(initial, resolver, fixed, () => earlier)).not.toBe(
      initial,
    );
  });

  it("moves a rigid unit as a whole", () => {
    const document = circuit(
      { a: "resistor", b: "resistor", c: "capacitor" },
      { s: ["a.2", "b.1"] },
    );
    place(document, { a: [0, 0], b: [20, 120], c: [120, 120] });
    document.layoutGroups.push({
      id: "pair",
      kind: "custom",
      objectIds: ["b", "c"],
      locked: false,
    });
    const fixed = new Set(["a"]);
    const { initial, replan } = start(document, fixed);
    const result = straightenPinJogs(initial, resolver, fixed, replan);
    expect(position(result.final!, "b")).toEqual({ x: 0, y: 120 });
    expect(position(result.final!, "c")).toEqual({ x: 100, y: 120 });
  });

  it("carries a marker wired only to the moved part", () => {
    const document = circuit(
      { a: "resistor", b: "resistor", g: "ground" },
      { s: ["a.2", "b.1"], r: ["b.2", "g.0"] },
    );
    place(document, { a: [0, 0], b: [20, 120], g: [20, 180] });
    const fixed = new Set(["a"]);
    const { initial, replan } = start(document, fixed);
    const result = straightenPinJogs(initial, resolver, fixed, replan);
    expect(position(result.final!, "b")).toEqual({ x: 0, y: 120 });
    expect(position(result.final!, "g")).toEqual({ x: 0, y: 180 });
  });

  // R166 stack I.-|M.D: a current source and a transistor are not one R147
  // rigid unit, so straightening the jog at I.+ would shift I off M's drain.
  const sourceOverDrain = (drainX: number) =>
    place(
      circuit(
        { a: "resistor", I: "current-source", M: "nmos" },
        { s: ["a.2", "I.+"], d: ["I.-", "M.D"] },
      ),
      { a: [0, 0], I: [20, 120], M: [drainX - 10, 200] },
    );

  it("keeps a stack that holds", () => {
    // Without the stack condition the pass moves I to x = 0 (checked by
    // disabling it): one jog fewer, and I beside M's drain line.
    const fixed = new Set(["a", "M"]);
    const { initial, replan } = start(sourceOverDrain(20), fixed);
    expect(pinJogs(initial.final!, resolver)).toHaveLength(1);
    const result = straightenPinJogs(initial, resolver, fixed, replan);
    expect(position(result.final!, "I")).toEqual({ x: 20, y: 120 });
  });

  it("does not let a broken stack block a move", () => {
    const fixed = new Set(["a", "M"]);
    const { initial, replan } = start(sourceOverDrain(50), fixed);
    const result = straightenPinJogs(initial, resolver, fixed, replan);
    expect(position(result.final!, "I")).toEqual({ x: 0, y: 120 });
  });

  // `gate` plus a fixed transistor N to the right of M, level with it or not.
  const gateBesideRow = (y: number) => {
    const document = circuit(
      { M: "nmos", R: "resistor", N: "nmos" },
      { g: ["M.G", "R.2"] },
    );
    return place(document, { M: [200, 100], R: [0, 90], N: [320, y] });
  };

  it("keeps a transistor level with another transistor", () => {
    // Without the row condition the pass moves M down to y = 110 (checked by
    // disabling it), out of the row it shares with N.
    const fixed = new Set(["R", "N"]);
    const { initial, replan } = start(gateBesideRow(100), fixed);
    expect(pinJogs(initial.final!, resolver)).toHaveLength(1);
    const result = straightenPinJogs(initial, resolver, fixed, replan);
    expect(position(result.final!, "M")).toEqual({ x: 200, y: 100 });
  });

  it("does not let a broken row block a move", () => {
    const fixed = new Set(["R", "N"]);
    const { initial, replan } = start(gateBesideRow(140), fixed);
    const result = straightenPinJogs(initial, resolver, fixed, replan);
    expect(position(result.final!, "M")).toEqual({ x: 200, y: 110 });
  });

  it("never moves a fixed part or a locked group", () => {
    const fixed = new Set(["a", "b"]);
    const held = start(twoPin(), fixed);
    expect(straightenPinJogs(held.initial, resolver, fixed, held.replan)).toBe(
      held.initial,
    );

    const document = twoPin();
    document.layoutGroups.push({
      id: "lock",
      kind: "custom",
      objectIds: ["b"],
      locked: true,
    });
    const free = new Set(["a"]);
    const locked = start(document, free);
    expect(
      straightenPinJogs(locked.initial, resolver, free, locked.replan),
    ).toBe(locked.initial);
  });

  it("stops when asked and is deterministic", () => {
    const fixed = new Set(["a"]);
    const { initial, replan } = start(twoPin(), fixed);
    expect(
      straightenPinJogs(initial, resolver, fixed, replan, () => true),
    ).toBe(initial);
    const first = straightenPinJogs(initial, resolver, fixed, replan);
    const second = straightenPinJogs(initial, resolver, fixed, replan);
    expect(second.result).toEqual(first.result);
  });

  // Hashes recorded from the unmodified planner (main at 65075a0). Neither
  // synthetic document has a jog there, so R167 must leave its plan alone.
  it.each([
    [
      "RC ladder",
      () =>
        circuit(
          {
            R1: "resistor",
            R2: "resistor",
            C1: "capacitor",
            C2: "capacitor",
            G: "ground",
          },
          {
            a: ["R1.1"],
            b: ["R1.2", "C1.1", "R2.1"],
            c: ["R2.2", "C2.1"],
            g: ["C1.2", "C2.2", "G.0"],
          },
        ),
      "539b589d252a5ac3216db7bf498e7adcd81fb609c6a2271ed053d16d786fcdff",
    ],
    [
      "common-source stage",
      () => {
        const document = circuit(
          { M1: "nmos", RD: "resistor", RG: "resistor", G: "ground" },
          {
            vin: ["RG.2", "M1.G"],
            vout: ["M1.D", "RD.1"],
            supply: ["RD.2", "RG.1"],
            gnd: ["M1.S", "M1.B", "G.0"],
          },
        );
        document.connectivityEvidence.push(
          {
            id: "supply-source",
            kind: "spice-source",
            netId: "supply",
            sourceNetId: "supply",
          },
          {
            id: "supply-claim",
            kind: "name-claim",
            netId: "supply",
            name: "VDD",
            scope: "global",
            powerDomain: "vdd",
            owner: { kind: "global-declaration", sourceNetId: "supply" },
          },
        );
        return document;
      },
      "0e183c45e619b0b9ecacafdf6966064f699c4dde51e10fa886b9c096f221243c",
    ],
  ] as const)(
    "plans a document without jogs as before: %s",
    (_name, make, hash) => {
      const document = make();
      const plan = planAutoLayout(document, resolver, {
        search: {
          seed: 1,
          evaluations: defaultLayoutSearch(document, {}).evaluations,
        },
      });
      expect(
        createHash("sha256").update(JSON.stringify(plan)).digest("hex"),
      ).toBe(hash);
    },
    60_000,
  );
});
