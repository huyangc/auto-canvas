import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import {
  builtInSymbols,
  createProjectSymbolResolver,
  InMemorySymbolResolver,
} from "@icm/symbols";
import { executeTransaction, type SchematicEdit } from "@icm/edit-engine";
import { parseProject } from "@icm/project-protocol";
import { planAutoLayout } from "../src/index.js";
import { enclosingBox, pinPoints } from "../src/geometry.js";
import { circuit } from "./document-fixture.js";

const resolver = new InMemorySymbolResolver(builtInSymbols);
it("rejects more than 120 instances with only the size diagnostic", () => {
  const document = circuit(
    Object.fromEntries(
      Array.from({ length: 121 }, (_, i) => [`i${i}`, "nmos"]),
    ),
    {},
  );
  const before = JSON.stringify(document);
  expect(planAutoLayout(document, resolver)).toEqual({
    edits: [],
    groups: [],
    diagnostics: [
      {
        severity: "error",
        code: "AUTO_LAYOUT_TOO_LARGE",
        rule: "R3",
        message: "Auto layout supports at most 120 instances",
      },
    ],
  });
  expect(JSON.stringify(document)).toBe(before);
});
it("snaps the envelope translation while preserving grid and input purity", () => {
  const document = circuit({ m: "nmos" }, {});
  const before = JSON.stringify(document);
  const plan = planAutoLayout(document, resolver);
  expect(plan.diagnostics).toEqual([]);
  const result = executeTransaction(
    document,
    {
      transactionId: "snap",
      documentId: document.id,
      expectedRevision: document.revision,
      actor: { kind: "agent", id: "test" },
      edits: plan.edits,
    },
    { symbolResolver: resolver },
  );
  expect(result.applied).toBe(true);
  if (!result.ok) return;
  const oldBox = enclosingBox(document, resolver);
  const newBox = enclosingBox(result.document, resolver);
  expect(Math.abs(newBox.x - oldBox.x)).toBeLessThanOrEqual(
    document.presentation.grid / 2,
  );
  expect(Math.abs(newBox.y - oldBox.y)).toBeLessThanOrEqual(
    document.presentation.grid / 2,
  );
  expect(planAutoLayout(document, resolver)).toEqual(plan);
  expect(JSON.stringify(document)).toBe(before);
});
it("rejects a template collision with a fixed instance without partial edits", () => {
  const document = circuit({ a: "capacitor", b: "capacitor" }, {});
  document.instances[0]!.placement = {
    // R9 now places the other capacitor in the second horizontal column.
    position: { x: 160, y: 0 },
    rotation: 0,
    mirror: "none",
  };
  expect(
    planAutoLayout(document, resolver, { fixedInstanceIds: new Set(["a"]) }),
  ).toMatchObject({
    edits: [],
    diagnostics: [{ code: "AUTO_LAYOUT_RULE_UNSATISFIED", rule: "R10" }],
  });
});
it("keeps a noncolliding fixed instance's exact placement", () => {
  const document = circuit({ a: "capacitor", b: "capacitor" }, {});
  const fixed = {
    position: { x: -500, y: 90 },
    rotation: 90 as const,
    mirror: "both" as const,
  };
  document.instances[0]!.placement = fixed;
  const plan = planAutoLayout(document, resolver, {
    fixedInstanceIds: new Set(["a"]),
  });
  expect(plan.diagnostics).toEqual([]);
  const result = executeTransaction(
    document,
    {
      transactionId: "fixed",
      documentId: document.id,
      expectedRevision: document.revision,
      actor: { kind: "agent", id: "test" },
      edits: plan.edits,
    },
    { symbolResolver: resolver },
  );
  expect(result.applied).toBe(true);
  if (!result.ok) return;
  expect(
    result.document.instances.find((i) => i.id === "a")!.placement,
  ).toEqual(fixed);
});
it("diagnoses an unresolved symbol without emitting partial edits", () => {
  const document = circuit({ unknown: "not-a-symbol" }, {});
  expect(planAutoLayout(document, resolver)).toMatchObject({
    edits: [],
    diagnostics: [{ rule: "R3" }],
  });
});
const commit = (document: ReturnType<typeof circuit>, edits: SchematicEdit[]) =>
  executeTransaction(
    document,
    {
      transactionId: "probe",
      documentId: document.id,
      expectedRevision: document.revision,
      actor: { kind: "agent", id: "test" },
      edits,
    },
    { symbolResolver: resolver },
  );
it("removes an obsolete Junction before a pin can land on it", () => {
  const document = circuit(
    { a: "resistor", b: "resistor" },
    { n1: ["a.1"], n2: ["a.2"], n3: ["b.1"], n4: ["b.2"] },
  );
  const free = planAutoLayout(document, resolver);
  const placed = commit(document, free.edits);
  if (!placed.ok) throw new Error("layout did not commit");
  const pin = pinPoints(placed.document, resolver).find(
    (p) => p.instanceId === "b" && p.pinName === "1",
  )!;
  document.junctions = [
    { id: "j", netId: "n1", position: pin.point, role: "branch" },
  ] as typeof document.junctions;
  const plan = planAutoLayout(document, resolver);
  expect(plan.diagnostics).toEqual([]);
  const result = commit(document, plan.edits);
  expect(result.applied).toBe(true);
  if (!result.ok) return;
  expect(result.document.junctions).toEqual([]);
  expect(result.document.nets).toEqual(placed.document.nets);
});
it("refuses to overwrite an existing layout group by generated id", () => {
  const document = circuit(
    { a: "nmos", b: "nmos", c: "resistor" },
    { d: ["a.D", "a.G", "b.G"], s: ["a.S", "b.S"], o: ["b.D"] },
  );
  document.layoutGroups = [
    {
      id: "auto-current-mirror-a",
      kind: "custom",
      objectIds: ["c"],
      locked: false,
    },
  ];
  expect(planAutoLayout(document, resolver)).toMatchObject({
    edits: [],
    diagnostics: [{ code: "AUTO_LAYOUT_RULE_UNSATISFIED", rule: "R5" }],
  });
});
it("keeps members of a locked layout group or constraint in place", () => {
  const document = circuit({ a: "resistor", b: "resistor" }, {});
  const placement = {
    position: { x: 500, y: 500 },
    rotation: 0 as const,
    mirror: "none" as const,
  };
  document.instances[0]!.placement = placement;
  document.instances[1]!.placement = {
    ...placement,
    position: { x: 800, y: 500 },
  };
  document.layoutGroups = [
    { id: "g", kind: "custom", objectIds: ["a"], locked: true },
  ];
  const plan = planAutoLayout(document, resolver);
  expect(plan.diagnostics).toEqual([]);
  const result = commit(document, plan.edits);
  expect(result.applied, JSON.stringify(result.diagnostics)).toBe(true);
  if (!result.ok) return;
  expect(result.document.instances[0]!.placement).toEqual(placement);
});
it("diagnoses a locked Route-anchored annotation instead of a rejected plan", () => {
  const project = parseProject(
    readFileSync("apps/editor/src/examples/simulation-rlc.icproj.json", "utf8"),
  );
  const document = structuredClone(project.documents[0]!);
  document.annotations.find((a) => a.anchor.kind === "route")!.locked = true;
  expect(
    planAutoLayout(
      document,
      createProjectSymbolResolver(project, builtInSymbols),
    ),
  ).toMatchObject({ edits: [], diagnostics: [{ rule: "R2" }] });
});
it("diagnoses a Route with a locked leg instead of a rejected plan", () => {
  const project = parseProject(
    readFileSync("apps/editor/src/examples/simulation-rlc.icproj.json", "utf8"),
  );
  const document = structuredClone(project.documents[0]!);
  document.routes[0]!.legs[0]!.mode = "locked";
  expect(
    planAutoLayout(
      document,
      createProjectSymbolResolver(project, builtInSymbols),
    ),
  ).toMatchObject({ edits: [], diagnostics: [{ rule: "R2" }] });
});
it("stands a grounded shunt with horizontal pins vertically", () => {
  const document = circuit(
    {
      v: "voltage-source",
      r: "resistor",
      d: "diode",
      g1: "ground",
      g2: "ground",
    },
    { a: ["v.+", "r.1"], k: ["r.2", "d.A"], z: ["v.-", "d.K", "g1.0", "g2.0"] },
  );
  const plan = planAutoLayout(document, resolver);
  expect(plan.diagnostics).toEqual([]);
  const result = commit(document, plan.edits);
  if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
  const pins = pinPoints(result.document, resolver).filter(
    (p) => p.instanceId === "d",
  );
  const anode = pins.find((p) => p.pinName === "A")!.point;
  const cathode = pins.find((p) => p.pinName === "K")!.point;
  expect(anode.x).toBe(cathode.x);
  expect(anode.y).toBeLessThan(cathode.y);
});
