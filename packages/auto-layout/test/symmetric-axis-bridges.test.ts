import { createLabelClearanceContext } from "@icm/derived";
import { builtInSymbols, InMemorySymbolResolver } from "@icm/symbols";
import { expect, it } from "vitest";
import { planAutoLayout } from "../src/auto-layout.js";
import { geometryProblem, pinPoints } from "../src/geometry.js";
import { classifyNets } from "../src/net-roles.js";
import {
  auditRouting,
  floatingPins,
  missingConnections,
} from "../src/routing-audit.js";
import { symmetryCounts, symmetryTopology } from "../src/symmetry.js";
import { equivalentTerminals, preview } from "../src/transaction.js";
import { circuit } from "./document-fixture.js";

const resolver = new InMemorySymbolResolver(builtInSymbols);

function layout(document: ReturnType<typeof circuit>) {
  const result = planAutoLayout(document, resolver);
  expect(result.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
  const after = preview(document, resolver, result.edits);
  if (!after.ok) throw new Error(JSON.stringify(after.diagnostics));
  const drawn = after.document;
  expect(equivalentTerminals(document, drawn, resolver)).toBe(true);
  expect(missingConnections(drawn, resolver)).toBe(0);
  expect(floatingPins(drawn, resolver)).toEqual([]);
  expect(auditRouting(drawn, resolver).crossings).toBe(0);
  expect(geometryProblem(drawn, resolver)).toBeUndefined();
  return drawn;
}

it.each([1, 2])(
  "centres and stacks the CTLE bridges with resistor pin %i on M1.S",
  (leftPin) => {
    const d = circuit(
      {
        M1: "nmos",
        M2: "nmos",
        I1: "current-source",
        I2: "current-source",
        R_S: "resistor",
        C_S: "capacitor",
        RL1: "resistor",
        RL2: "resistor",
        CL1: "capacitor",
        CL2: "capacitor",
        V: "vdd-port",
        G: "ground",
      },
      {
        s1: ["M1.S", "I1.+", `R_S.${leftPin}`, "C_S.2"],
        s2: ["M2.S", "I2.+", `R_S.${3 - leftPin}`, "C_S.1"],
        in1: ["M1.G"],
        in2: ["M2.G"],
        out1: ["M1.D", "RL1.2", "CL1.1"],
        out2: ["M2.D", "RL2.2", "CL2.1"],
        vdd: ["V.P", "RL1.1", "RL2.1"],
        gnd: ["G.0", "I1.-", "I2.-", "CL1.2", "CL2.2"],
      },
    );
    for (const id of ["R_S", "C_S"])
      d.annotations.push({
        id: id + "-label",
        kind: "instance-label",
        content: { runs: [{ kind: "text", value: id }] },
        anchor: {
          kind: "object",
          objectId: id,
          localOffset: { x: 10, y: -20 },
          fallbackPosition: { x: 10, y: -20 },
        },
        alignment: "start",
        rotation: 0,
        locked: false,
      });
    const { components } = symmetryTopology(
      d,
      resolver,
      classifyNets(d, resolver),
    );
    expect(components.map((c) => c.axis)).toEqual([["C_S", "R_S"]]);
    const drawn = layout(d);
    const counts = symmetryCounts(drawn, resolver, components);
    expect(counts.onAxis).toBe(counts.axisDevices);
    const pose = (id: string) =>
      drawn.instances.find((i) => i.id === id)!.placement!;
    expect(pose("M1").position.x).toBeLessThan(pose("M2").position.x);
    expect(pose("I1").position.y).toBe(pose("I2").position.y);
    const pins = pinPoints(drawn, resolver);
    const labels = createLabelClearanceContext(drawn, resolver);
    for (const [id, pin] of [
      ["R_S", leftPin],
      ["C_S", 2],
    ] as const) {
      expect(pose(id).rotation).toBe(pin === 1 ? 270 : 90);
      const own = pins
        .filter((p) => p.instanceId === id)
        .sort((a, b) => a.point.x - b.point.x);
      expect(own[0]!.pinName).toBe(String(pin));
      expect(own[0]!.point.y).toBe(own[1]!.point.y);
      expect(pose(id).position.x).toBe(
        (pose("M1").position.x + pose("M2").position.x) / 2,
      );
      const label = drawn.annotations.find((a) => a.id === id + "-label")!;
      expect(
        labels.overlapsAt(labels.measure(label).inkBounds, label.id),
      ).toEqual([]);
    }
    expect(pose("R_S").position.y).toBeGreaterThan(pose("M1").position.y);
    expect(
      pose("C_S").position.y - pose("R_S").position.y,
    ).toBeGreaterThanOrEqual(40);
    expect(pose("I1").position.y).toBeGreaterThan(pose("C_S").position.y);
  },
  60_000,
);

it("centres a single drain bridge on its neighboring row", () => {
  const d = circuit(
    { M1: "nmos", M2: "nmos", R: "resistor", T: "current-source", G: "ground" },
    {
      a: ["M1.D", "R.1"],
      b: ["M2.D", "R.2"],
      tail: ["M1.S", "M2.S", "T.+"],
      gnd: ["T.-", "G.0"],
      ga: ["M1.G"],
      gb: ["M2.G"],
    },
  );
  const drawn = layout(d);
  const at = (id: string) =>
    drawn.instances.find((i) => i.id === id)!.placement!.position;
  expect(at("R")).toEqual({ x: (at("M1").x + at("M2").x) / 2, y: at("M1").y });
}, 60_000);
