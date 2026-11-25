import { describe, expect, it, vi } from "vitest";
import type { SchematicDocument } from "@icm/model";
import { builtInSymbols, InMemorySymbolResolver } from "@icm/symbols";
import { planLayoutOnce } from "../src/auto-layout.js";
import { polishCrossings, repairBrokenStacks } from "../src/crossing-polish.js";
import { placement } from "../src/geometry.js";
import { emptyOverrides } from "../src/layout-choices.js";
import { classifyNets } from "../src/net-roles.js";
import { auditRouting } from "../src/routing-audit.js";
import { stackHolds, stackPairs } from "../src/stack-snap.js";
import { terminalPartition } from "../src/transaction.js";
import type { Placement } from "../src/types.js";
import { circuit } from "./document-fixture.js";

const resolver = new InMemorySymbolResolver(builtInSymbols);
const posesOf = (document: SchematicDocument) =>
  new Map(document.instances.map((i) => [i.id, i.placement!]));

function finish(
  document: SchematicDocument,
  placements: Record<string, Placement>,
  fixed: ReadonlySet<string>,
) {
  for (const instance of document.instances)
    instance.placement = placements[instance.id]!;
  const replan = (poses: ReadonlyMap<string, Placement>) =>
    planLayoutOnce(
      document,
      resolver,
      { fixedInstanceIds: fixed },
      emptyOverrides(),
      "template",
      true,
      undefined,
      undefined,
      poses,
    );
  const initial = replan(posesOf(document));
  expect(
    initial.final,
    JSON.stringify(initial.result.diagnostics),
  ).toBeDefined();
  return { initial, replan };
}

function stackFixture() {
  return circuit({ M: "nmos", R: "resistor" }, { drain: ["M.D", "R.2"] });
}

describe("finished crossing polish", () => {
  it("untangles crossing nets by reversing a two-pin part", () => {
    const document = circuit(
      { a: "resistor", b: "resistor", c: "resistor" },
      { first: ["a.2", "b.1"], second: ["a.1", "c.2"] },
    );
    const fixed = new Set(["b", "c"]);
    const { initial, replan } = finish(
      document,
      {
        a: placement(0, 0, "none", 180),
        b: placement(-160, 120),
        c: placement(-160, -120, "none", 90),
      },
      fixed,
    );
    expect(auditRouting(initial.final!, resolver).crossings).toBeGreaterThan(0);
    const result = polishCrossings(initial, resolver, fixed, replan);
    expect(auditRouting(result.final!, resolver).crossings).toBe(0);
    expect(posesOf(result.final!).get("a")).toEqual(placement(0, 0));
    expect(terminalPartition(result.final!, resolver)).toBe(
      terminalPartition(initial.final!, resolver),
    );
    expect(polishCrossings(initial, resolver, fixed, replan).result).toEqual(
      result.result,
    );
    const skipped = vi.fn(replan);
    expect(polishCrossings(initial, resolver, fixed, skipped, () => true)).toBe(
      initial,
    );
    expect(
      polishCrossings(initial, resolver, new Set(["a", "b", "c"]), skipped),
    ).toBe(initial);
    expect(skipped).not.toHaveBeenCalled();
  });

  it("exchanges the slots of two crossing units and keeps a held stack", () => {
    const document = circuit(
      {
        a: "resistor",
        b: "resistor",
        c: "resistor",
        d: "resistor",
        M: "nmos",
        R: "resistor",
      },
      { first: ["a.2", "d.1"], second: ["b.2", "c.1"], drain: ["M.D", "R.2"] },
    );
    const fixed = new Set(["a", "b", "M", "R"]);
    const { initial, replan } = finish(
      document,
      {
        a: placement(0, 0, "none", 270),
        b: placement(0, 120, "none", 270),
        c: placement(180, 0, "none", 270),
        d: placement(180, 120, "none", 270),
        M: placement(400, 120),
        R: placement(410, 0),
      },
      fixed,
    );
    expect(auditRouting(initial.final!, resolver).crossings).toBeGreaterThan(0);
    const result = polishCrossings(initial, resolver, fixed, replan);
    expect(auditRouting(result.final!, resolver).crossings).toBe(0);
    expect(posesOf(result.final!).get("c")).toEqual(
      placement(180, 120, "none", 270),
    );
    expect(posesOf(result.final!).get("d")).toEqual(
      placement(180, 0, "none", 270),
    );
    const stacks = stackPairs(
      document.instances,
      resolver,
      classifyNets(document, resolver),
    );
    expect(stacks).toHaveLength(1);
    expect(stackHolds(stacks[0]!, posesOf(initial.final!))).toBe(true);
    expect(stackHolds(stacks[0]!, posesOf(result.final!))).toBe(true);
    expect(terminalPartition(result.final!, resolver)).toBe(
      terminalPartition(initial.final!, resolver),
    );
  });

  it("does not propose reversing an op-amp's output or input order", () => {
    const document = circuit(
      { amp: "opamp", a: "resistor", b: "resistor" },
      { plus: ["a.2", "amp.IN+"], minus: ["b.2", "amp.IN-"] },
    );
    const fixed = new Set(["a", "b"]);
    const { initial, replan } = finish(
      document,
      {
        amp: placement(180, 60),
        a: placement(0, 0, "none", 270),
        b: placement(0, 120, "none", 270),
      },
      fixed,
    );
    expect(auditRouting(initial.final!, resolver).crossings).toBeGreaterThan(0);
    const tried = vi.fn(replan);
    expect(polishCrossings(initial, resolver, fixed, tried)).toBe(initial);
    expect(tried).not.toHaveBeenCalled();
  });
});

describe("finished stack repair", () => {
  it("repairs an offset load without increasing crossings or guards", () => {
    const document = stackFixture();
    const fixed = new Set(["M"]);
    const { initial, replan } = finish(
      document,
      {
        M: placement(0, 120),
        R: placement(50, 0),
      },
      fixed,
    );
    const [stack] = stackPairs(
      document.instances,
      resolver,
      classifyNets(document, resolver),
    );
    expect(stackHolds(stack!, posesOf(initial.final!))).toBe(false);
    const result = repairBrokenStacks(initial, resolver, fixed, replan);
    expect(stackHolds(stack!, posesOf(result.final!))).toBe(true);
    expect(posesOf(result.final!).get("R")).toEqual(placement(10, 0));
    const before = auditRouting(initial.final!, resolver);
    const after = auditRouting(result.final!, resolver);
    expect(after.bends).toBeLessThan(before.bends);
    expect(after.crossings).toBe(before.crossings);
    expect(terminalPartition(result.final!, resolver)).toBe(
      terminalPartition(initial.final!, resolver),
    );
    const skipped = vi.fn(replan);
    expect(
      repairBrokenStacks(initial, resolver, fixed, skipped, () => true),
    ).toBe(initial);
    expect(
      repairBrokenStacks(initial, resolver, new Set(["M", "R"]), skipped),
    ).toBe(initial);
    expect(skipped).not.toHaveBeenCalled();
  });

  it("returns a zero-defect run directly without replanning", () => {
    const fixed = new Set<string>();
    const { initial, replan } = finish(
      stackFixture(),
      {
        M: placement(0, 120),
        R: placement(10, 0),
      },
      fixed,
    );
    const [stack] = stackPairs(
      initial.final!.instances,
      resolver,
      classifyNets(initial.final!, resolver),
    );
    expect(stackHolds(stack!, posesOf(initial.final!))).toBe(true);
    expect(auditRouting(initial.final!, resolver).crossings).toBe(0);
    const skipped = vi.fn(replan);
    expect(polishCrossings(initial, resolver, fixed, skipped)).toBe(initial);
    expect(repairBrokenStacks(initial, resolver, fixed, skipped)).toBe(initial);
    expect(skipped).not.toHaveBeenCalled();
  });
});
