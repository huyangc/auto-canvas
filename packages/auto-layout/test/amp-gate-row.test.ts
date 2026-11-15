import * as selection from "../src/finished-selection.js";
import * as gateRows from "../src/amp-gate-row.js";
import { planAutoLayout } from "../src/auto-layout.js";
import { preview } from "../src/transaction.js";
import {
  readabilityMetrics,
  readabilityScore,
} from "../src/readability-metrics.js";
import { expect, it, vi } from "vitest";
import { InMemorySymbolResolver, builtInSymbols } from "@icm/symbols";
import {
  amplifierGateRows,
  placeAmplifierBetweenBranches,
} from "../src/amp-gate-row.js";
import { placement, withPlacements } from "../src/geometry.js";
import { classifyNets } from "../src/net-roles.js";
import { freezePinGroups, routeDocument } from "../src/route.js";
import { auditRouting, missingConnections } from "../src/routing-audit.js";
import { placeDocument } from "../src/place.js";
import { circuit } from "./document-fixture.js";

const resolver = new InMemorySymbolResolver(builtInSymbols);
function gateRow() {
  const d = circuit(
    {
      left: "pmos",
      right: "pmos",
      amp: "opamp",
      r1: "resistor",
      r2: "resistor",
    },
    {
      supply: ["left.S", "right.S"],
      gate: ["left.G", "right.G", "amp.OUT"],
      sense1: ["left.D", "amp.IN+", "r1.1"],
      sense2: ["right.D", "amp.IN-", "r2.1"],
      ground: ["r1.2", "r2.2"],
    },
  );
  const targets = new Map([
    ["left", placement(200, 100)],
    ["right", placement(400, 100)],
    ["amp", placement(600, 100)],
    ["r1", placement(210, 320)],
    ["r2", placement(410, 320)],
  ]);
  return { d, targets };
}

it("reduces routed crossings while preserving the receiver row and all other devices", () => {
  const { d, targets } = gateRow();
  const roles = classifyNets(d, resolver);
  const route = (positions: typeof targets) => {
    const result = routeDocument(
      withPlacements(d, positions),
      resolver,
      freezePinGroups(d, resolver),
      roles,
      [],
    );
    expect(result.problem).toBeUndefined();
    expect(missingConnections(result.document, resolver)).toBe(0);
    const audit = auditRouting(result.document, resolver);
    expect(audit.unsafeProblems).toEqual([]);
    return audit.crossings;
  };
  const before = structuredClone(targets);
  const crossings = route(before);
  placeAmplifierBetweenBranches(d, resolver, roles, targets, new Set(), d);
  expect(targets.get("amp")).not.toEqual(before.get("amp"));
  expect(route(targets)).toBeLessThan(crossings);
  for (const [id, at] of before)
    if (id !== "amp") expect(targets.get(id)).toEqual(at);
  placeAmplifierBetweenBranches(d, resolver, roles, before, new Set(), d);
  expect(targets).toEqual(before);
});

it.each([
  "no-amplifier",
  "no-feedback",
  "single-receiver",
  "same-branch",
  "protected",
  "unaligned",
  "collision",
])("leaves %s unchanged", (mode) => {
  const { d, targets } = gateRow();
  if (mode === "no-amplifier") {
    d.instances = d.instances.filter((i) => i.id !== "amp");
    for (const n of d.nets)
      n.terminals = n.terminals.filter((t) => t.instanceId !== "amp");
    targets.delete("amp");
  }
  if (mode === "no-feedback")
    for (const n of d.nets.filter((n) => n.id.startsWith("sense")))
      n.terminals = n.terminals.filter((t) => t.instanceId !== "amp");
  if (mode === "single-receiver")
    d.nets.find((n) => n.id === "gate")!.terminals = d.nets
      .find((n) => n.id === "gate")!
      .terminals.filter((t) => t.instanceId !== "right");
  if (mode === "same-branch") {
    d.nets.find((n) => n.id === "sense2")!.terminals = [
      { instanceId: "left", pinName: "S" },
      { instanceId: "amp", pinName: "IN-" },
    ];
    d.nets.find((n) => n.id === "supply")!.terminals = [
      { instanceId: "right", pinName: "S" },
    ];
  }
  if (mode === "unaligned") targets.set("right", placement(400, 120));
  const obstacles = structuredClone(d);
  if (mode === "collision") {
    obstacles.instances.push({
      id: "blocker",
      symbolId: "resistor",
      placement: placement(270, 210),
    });
    targets.set("blocker", placement(270, 210));
  }
  const before = structuredClone(targets);
  placeAmplifierBetweenBranches(
    d,
    resolver,
    classifyNets(d, resolver),
    targets,
    new Set(mode === "protected" ? ["amp"] : []),
    obstacles,
  );
  expect(targets).toEqual(before);
});

it("recognizes base rows by class and pin role, independent of names and initial coordinates", () => {
  const { d, targets } = gateRow();
  for (const i of d.instances) {
    if (["left", "right"].includes(i.id)) i.symbolId = "pnp";
    if (i.id === "amp") i.symbolId = "comparator";
  }
  for (const n of d.nets)
    for (const t of n.terminals)
      if (["left", "right"].includes(t.instanceId))
        t.pinName = ({ G: "B", D: "C", S: "E" } as Record<string, string>)[
          t.pinName
        ]!;
  expect(
    amplifierGateRows(d, resolver, classifyNets(d, resolver)),
  ).toHaveLength(1);
  const renamed = structuredClone(withPlacements(d, targets));
  const names = new Map(
    renamed.instances.map((i, index) => [i.id, `device-${index}`]),
  );
  for (const i of renamed.instances) {
    i.id = names.get(i.id)!;
    i.placement = placement(0, 0);
  }
  for (const [index, n] of renamed.nets.entries()) {
    n.id = `net-${index}`;
    for (const t of n.terminals) t.instanceId = names.get(t.instanceId)!;
  }
  expect(
    amplifierGateRows(renamed, resolver, classifyNets(renamed, resolver)),
  ).toHaveLength(1);
});

it("preserves a protected amplifier and rigid template in the shared placement pipeline", () => {
  const { d, targets } = gateRow();
  const source = withPlacements(d, targets);
  const roles = classifyNets(source, resolver);
  const groups = [
    {
      id: "pair",
      kind: "matched-pair" as const,
      members: ["amp", "r1"] as [string, string],
    },
  ];
  const place = (draft: boolean) =>
    placeDocument(
      source,
      resolver,
      roles,
      groups,
      {},
      undefined,
      undefined,
      "template",
      undefined,
      undefined,
      undefined,
      false,
      false,
      draft,
    );
  expect(place(true)).toEqual(place(false));
  const fixed = placeDocument(
    source,
    resolver,
    roles,
    [],
    { fixedInstanceIds: new Set(["amp"]) },
    undefined,
    undefined,
    "template",
    undefined,
    undefined,
    undefined,
    false,
    false,
    true,
  );
  expect(fixed.placements.get("amp")).toEqual(targets.get("amp"));
});

it("finishes the gate-row variant through the shared comparator and repeats deterministically", () => {
  const { d } = gateRow();
  const choose = vi.spyOn(selection, "selectFinishedLayout");
  const seat = vi.spyOn(gateRows, "placeAmplifierBetweenBranches");
  try {
    const result = planAutoLayout(d, resolver);
    expect(result.diagnostics.filter((d) => d.severity === "error")).toEqual(
      [],
    );
    expect(seat).toHaveBeenCalled();
    expect(choose).toHaveBeenCalled();
    const [, , base, candidate] = choose.mock.calls.at(-1)!;
    expect(score(candidate)).toBeLessThan(score(base));
    // A fully routed, worse arrangement must not replace the improved seat.
    expect(selection.selectFinishedLayout(d, resolver, candidate, base)).toBe(
      candidate,
    );
    expect(planAutoLayout(d, resolver)).toEqual(result);
  } finally {
    choose.mockRestore();
    seat.mockRestore();
  }
  function score(result: ReturnType<typeof planAutoLayout>) {
    const applied = preview(d, resolver, result.edits);
    if (!applied.ok) throw Error("invalid finished candidate");
    return readabilityScore(
      readabilityMetrics(applied.document, resolver, "weighted"),
    );
  }
});

it("does not move members of an explicit floorplan or a given placement", () => {
  const { d, targets } = gateRow();
  const roles = classifyNets(d, resolver);
  const partition = {
    blocks: [{ id: "row", members: d.instances.map((i) => i.id) }],
    arrangement: { row: { x: 0, y: 0 } },
  };
  const place = (draft: boolean, given?: typeof targets) =>
    placeDocument(
      d,
      resolver,
      roles,
      [],
      { partition },
      undefined,
      undefined,
      "template",
      given,
      undefined,
      undefined,
      false,
      false,
      draft,
    );
  expect(place(true)).toEqual(place(false));
  expect(place(true, targets)).toEqual(place(false, targets));
});

it("leaves a row without an amplifier unchanged in the complete planner", () => {
  const d = circuit(
    { left: "pmos", right: "pmos" },
    {
      gate: ["left.G", "right.G"],
      supply: ["left.S", "right.S"],
      first: ["left.D"],
      second: ["right.D"],
    },
  );
  const seat = vi.spyOn(gateRows, "placeAmplifierBetweenBranches");
  try {
    const baseline = planAutoLayout(d, resolver);
    expect(seat).not.toHaveBeenCalled();
    seat.mockImplementation(() => {
      throw Error("unexpected gate-row finalist");
    });
    expect(planAutoLayout(d, resolver)).toEqual(baseline);
  } finally {
    seat.mockRestore();
  }
});
