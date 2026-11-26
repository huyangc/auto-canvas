import { describe, expect, it } from "vitest";
import { builtInSymbols, InMemorySymbolResolver } from "@icm/symbols";
import { aprDetailPlace } from "../src/apr-detail-place.js";
import { geometryProblem, placement, withPlacements } from "../src/geometry.js";
import { circuit } from "./document-fixture.js";

const resolver = new InMemorySymbolResolver(builtInSymbols);

describe("T189 aprDetailPlace", () => {
  it("unwinds a reversed row order via windowed detail placement without overlaps", () => {
    // Four upper NMOS drivers M1..M4 connected straight down to four lower
    // resistors R1..R4 placed in reverse order (R4, R3, R2, R1).
    const doc = circuit(
      {
        M1: "nmos",
        M2: "nmos",
        M3: "nmos",
        M4: "nmos",
        R1: "resistor",
        R2: "resistor",
        R3: "resistor",
        R4: "resistor",
      },
      {
        n1: ["M1.S", "R1.1"],
        n2: ["M2.S", "R2.1"],
        n3: ["M3.S", "R3.1"],
        n4: ["M4.S", "R4.1"],
      },
    );
    const initial = new Map([
      ["M1", placement(100, 100)],
      ["M2", placement(240, 100)],
      ["M3", placement(380, 100)],
      ["M4", placement(520, 100)],
      ["R4", placement(100, 300)],
      ["R3", placement(240, 300)],
      ["R2", placement(380, 300)],
      ["R1", placement(520, 300)],
    ]);
    const placed = withPlacements(doc, initial);
    const fixed = new Set(["M1", "M2", "M3", "M4"]);
    const result = aprDetailPlace(doc, placed, resolver, fixed);

    expect(result.improved).toBe(true);
    expect(result.afterScore).toBeLessThan(result.beforeScore);
    expect(
      geometryProblem(withPlacements(doc, result.placements), resolver),
    ).toBeUndefined();
    // R1..R4 should now be ordered left-to-right matching M1..M4.
    const xs = ["R1", "R2", "R3", "R4"].map(
      (id) => result.placements.get(id)!.position.x,
    );
    expect(xs[0]!).toBeLessThan(xs[1]!);
    expect(xs[1]!).toBeLessThan(xs[2]!);
    expect(xs[2]!).toBeLessThan(xs[3]!);
  });

  it("mirrors a free device horizontally so its gate faces its driver", () => {
    const doc = circuit(
      { R1: "resistor", R2: "resistor", M1: "nmos", M2: "nmos" },
      {
        n1: ["R1.2", "M1.G"],
        n2: ["M1.D", "M2.G"],
        n3: ["M2.D", "R2.1"],
      },
    );
    // M1 is on the left of R1 with its gate facing left (away from R1).
    const initial = new Map([
      ["M1", placement(100, 200, "none")],
      ["R1", placement(260, 200)],
      ["M2", placement(420, 200, "horizontal")],
      ["R2", placement(580, 200)],
    ]);
    const placed = withPlacements(doc, initial);
    const fixed = new Set(["R1", "R2"]);
    const result = aprDetailPlace(doc, placed, resolver, fixed);

    expect(result.improved).toBe(true);
    expect(result.placements.get("M1")!.mirror).toBe("horizontal");
    expect(
      geometryProblem(withPlacements(doc, result.placements), resolver),
    ).toBeUndefined();
  });

  it("never moves fixed instances or breaks aligned vertical conducting stacks", () => {
    const doc = circuit(
      {
        M1: "pmos",
        M2: "nmos",
        M3: "pmos",
        M4: "nmos",
        R1: "resistor",
        R2: "resistor",
      },
      {
        out1: ["M1.D", "M2.D", "R2.1"],
        out2: ["M3.D", "M4.D", "R1.1"],
      },
    );
    // Stack 1: M1 above M2 at x=120; Stack 2: M3 above M4 at x=300;
    // R1 and R2 fixed on right in swapped order so columns should swap as intact stacks.
    const initial = new Map([
      ["M1", placement(120, 100)],
      ["M2", placement(120, 260)],
      ["M3", placement(300, 100)],
      ["M4", placement(300, 260)],
      ["R1", placement(520, 100)],
      ["R2", placement(520, 260)],
    ]);
    const placed = withPlacements(doc, initial);
    const fixed = new Set(["R1", "R2"]);
    const result = aprDetailPlace(doc, placed, resolver, fixed);

    expect(result.placements.get("R1")).toEqual(initial.get("R1"));
    expect(result.placements.get("R2")).toEqual(initial.get("R2"));
    // Each vertical conducting stack keeps identical x between its PMOS and NMOS.
    expect(result.placements.get("M1")!.position.x).toBe(
      result.placements.get("M2")!.position.x,
    );
    expect(result.placements.get("M3")!.position.x).toBe(
      result.placements.get("M4")!.position.x,
    );
    expect(
      geometryProblem(withPlacements(doc, result.placements), resolver),
    ).toBeUndefined();
  });

  it("flips an inverted multi-pin macro block to align pins with neighboring devices", () => {
    const macroSymbol = {
      schemaVersion: 1 as const,
      id: "test-macro-6p",
      name: "Test Macro",
      viewBox: { x: -40, y: -30, width: 80, height: 60 },
      pins: [
        {
          name: "in1",
          role: "bidirectional",
          at: { x: -40, y: -20 },
          direction: "west" as const,
          presentation: { visibility: "visible" as const },
        },
        {
          name: "in2",
          role: "bidirectional",
          at: { x: -40, y: 0 },
          direction: "west" as const,
          presentation: { visibility: "visible" as const },
        },
        {
          name: "in3",
          role: "bidirectional",
          at: { x: -40, y: 20 },
          direction: "west" as const,
          presentation: { visibility: "visible" as const },
        },
        {
          name: "out1",
          role: "bidirectional",
          at: { x: 40, y: -20 },
          direction: "east" as const,
          presentation: { visibility: "visible" as const },
        },
        {
          name: "out2",
          role: "bidirectional",
          at: { x: 40, y: 0 },
          direction: "east" as const,
          presentation: { visibility: "visible" as const },
        },
        {
          name: "out3",
          role: "bidirectional",
          at: { x: 40, y: 20 },
          direction: "east" as const,
          presentation: { visibility: "visible" as const },
        },
      ],
      primitives: [
        {
          kind: "polygon" as const,
          fill: "none" as const,
          points: [
            { x: -40, y: -30 },
            { x: 40, y: -30 },
            { x: 40, y: 30 },
            { x: -40, y: 30 },
          ],
        },
      ],
      variants: [],
    };
    const macroResolver = new InMemorySymbolResolver([
      ...builtInSymbols,
      macroSymbol,
    ]);
    const doc = circuit(
      {
        R1: "resistor",
        R2: "resistor",
        R3: "resistor",
        XM: "test-macro-6p",
        R4: "resistor",
        R5: "resistor",
        R6: "resistor",
      },
      {
        n1: ["R1.2", "XM.in1"],
        n2: ["R2.2", "XM.in2"],
        n3: ["R3.2", "XM.in3"],
        o1: ["XM.out1", "R4.1"],
        o2: ["XM.out2", "R5.1"],
        o3: ["XM.out3", "R6.1"],
      },
    );
    // Place XM horizontally mirrored (facing backward) between left inputs R1..R3 and right outputs R4..R6.
    const initial = new Map([
      ["R1", placement(100, 120)],
      ["R2", placement(100, 200)],
      ["R3", placement(100, 280)],
      ["XM", placement(300, 200, "horizontal")],
      ["R4", placement(500, 120)],
      ["R5", placement(500, 200)],
      ["R6", placement(500, 280)],
    ]);
    const placed = withPlacements(doc, initial);
    const fixed = new Set(["R1", "R2", "R3", "R4", "R5", "R6"]);
    const result = aprDetailPlace(doc, placed, macroResolver, fixed);

    expect(result.improved).toBe(true);
    expect(result.placements.get("XM")!.mirror).toBe("none");
    expect(
      geometryProblem(withPlacements(doc, result.placements), macroResolver),
    ).toBeUndefined();
  });

  it("reserves macro-port boundary clearance when reordering adjacent multi-pin macro columns", () => {
    const macroSymbol = {
      schemaVersion: 1 as const,
      id: "test-macro-5p",
      name: "Test Macro 5P",
      viewBox: { x: -40, y: -30, width: 80, height: 60 },
      pins: [
        {
          name: "a",
          role: "bidirectional",
          at: { x: -40, y: -20 },
          direction: "west" as const,
          presentation: { visibility: "visible" as const },
        },
        {
          name: "b",
          role: "bidirectional",
          at: { x: -40, y: 0 },
          direction: "west" as const,
          presentation: { visibility: "visible" as const },
        },
        {
          name: "c",
          role: "bidirectional",
          at: { x: -40, y: 20 },
          direction: "west" as const,
          presentation: { visibility: "visible" as const },
        },
        {
          name: "y",
          role: "bidirectional",
          at: { x: 40, y: -10 },
          direction: "east" as const,
          presentation: { visibility: "visible" as const },
        },
        {
          name: "z",
          role: "bidirectional",
          at: { x: 40, y: 10 },
          direction: "east" as const,
          presentation: { visibility: "visible" as const },
        },
      ],
      primitives: [
        {
          kind: "polygon" as const,
          fill: "none" as const,
          points: [
            { x: -40, y: -30 },
            { x: 40, y: -30 },
            { x: 40, y: 30 },
            { x: -40, y: 30 },
          ],
        },
      ],
      variants: [],
    };
    const macroResolver = new InMemorySymbolResolver([
      ...builtInSymbols,
      macroSymbol,
    ]);
    const doc = circuit(
      {
        R_L: "resistor",
        X1: "test-macro-5p",
        X2: "test-macro-5p",
        R_R: "resistor",
      },
      {
        n_in: ["R_L.2", "X1.a", "X1.b"],
        n_mid1: ["X1.y", "X2.a"],
        n_mid2: ["X1.z", "X2.b"],
        n_out: ["X2.y", "R_R.1"],
      },
    );
    // Start with X2 left of X1 (reversed macro order between fixed R_L and R_R).
    const initial = new Map([
      ["R_L", placement(80, 200)],
      ["X2", placement(260, 200)],
      ["X1", placement(480, 200)],
      ["R_R", placement(760, 200)],
    ]);
    const placed = withPlacements(doc, initial);
    const fixed = new Set(["R_L", "R_R"]);
    const result = aprDetailPlace(doc, placed, macroResolver, fixed);

    expect(result.improved).toBe(true);
    const x1 = result.placements.get("X1")!.position.x;
    const x2 = result.placements.get("X2")!.position.x;
    expect(x1).toBeLessThan(x2);
    // Between two multi-pin macros (width 80 each), center spacing >= 80 + 140 = 220 (or preserved gap).
    expect(x2 - x1).toBeGreaterThanOrEqual(200);
    expect(
      geometryProblem(withPlacements(doc, result.placements), macroResolver),
    ).toBeUndefined();
  });

  it("respects stopped() deadline callback and preserves R70 gate-driver attachments", () => {
    const doc = circuit(
      {
        V1: "vsource",
        M1: "nmos",
        R1: "resistor",
        R2: "resistor",
        G1: "ground",
      },
      {
        gate: ["V1.+", "M1.G"],
        drain: ["M1.D", "R1.2"],
        other: ["R1.1", "R2.1"],
        gnd: ["V1.-", "M1.S", "R2.2", "G1.0"],
      },
    );
    const initial = new Map([
      ["V1", placement(100, 200)],
      ["M1", placement(180, 200)],
      ["R1", placement(260, 120)],
      ["R2", placement(340, 200)],
      ["G1", placement(180, 280)],
    ]);
    const placed = withPlacements(doc, initial);
    const stoppedRes = aprDetailPlace(doc, placed, resolver, new Set(["M1"]), {
      stopped: () => true,
    });
    expect(stoppedRes.improved).toBe(false);
    expect(stoppedRes.evaluations).toBe(0);

    // M1 is fixed; V1 drives only M1.G (R70 driver attachment), so V1 must stay attached.
    const attachedRes = aprDetailPlace(doc, placed, resolver, new Set(["M1"]));
    expect(attachedRes.placements.get("V1")).toEqual(initial.get("V1"));
  });
});
