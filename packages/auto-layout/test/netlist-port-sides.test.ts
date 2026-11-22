import { resolveRouteGeometry } from "@icm/derived";
import { slideNetlistPort } from "../src/slide-netlist-port.js";
import { builtInSymbols, InMemorySymbolResolver } from "@icm/symbols";
import { expect, it } from "vitest";
import { connectionsIntact, planLayoutOnce } from "../src/auto-layout.js";
import { placement } from "../src/geometry.js";
import { emptyOverrides } from "../src/layout-choices.js";
import { selectNetlistPortSides } from "../src/netlist-port-sides.js";
import { auditRouting } from "../src/routing-audit.js";
import { preview, terminalPartition } from "../src/transaction.js";
import { circuit } from "./document-fixture.js";

const resolver = new InMemorySymbolResolver(builtInSymbols);
function reversed(block?: "inverter") {
  const d = circuit(
    {
      R1: "resistor",
      ...(block ? { X1: block } : {}),
      a: "port",
      b: "port",
    },
    { first: ["a.P", "R1.1"], second: ["b.P", "R1.2"] },
  );
  d.netlist = {
    name: "dut",
    formalParameters: [],
    terminals: [
      {
        id: "input",
        name: "first",
        netId: "first",
        direction: "input",
        interfaceInstanceIds: ["a"],
      },
      {
        id: "output",
        name: "second",
        netId: "second",
        direction: "output",
        interfaceInstanceIds: ["b"],
      },
    ],
  };
  const seats = new Map([
    ["R1", placement(0, 0, "none", 90)],
    ["a", placement(80, 0, "horizontal")],
    ["b", placement(-80, 0)],
  ]);
  if (block) seats.set("X1", placement(0, 100));
  const run = planLayoutOnce(
    d,
    resolver,
    {},
    emptyOverrides(),
    "template",
    true,
    undefined,
    undefined,
    seats,
  );
  if (!run.final) throw Error("expected connected resistor fixture");
  return { d, plan: { final: run.final, candidate: run.result } };
}

it("carries a routed netlist to the input-left orientation in one replay", () => {
  const { d, plan } = reversed(),
    before = auditRouting(plan.final, resolver);
  const answer = selectNetlistPortSides(
    d,
    resolver,
    plan,
    () => undefined,
    () => false,
  );
  const replay = preview(d, resolver, answer.edits);
  if (!replay.ok) throw Error("expected a valid port placement");
  const parts = new Map(
    replay.document.instances.map((i) => [i.id, i.placement!.position.x]),
  );
  expect(parts.get("a")!).toBeLessThan(parts.get("R1")!);
  expect(parts.get("b")!).toBeGreaterThan(parts.get("R1")!);
  expect(connectionsIntact(replay.document, resolver)).toBe(true);
  expect(terminalPartition(replay.document, resolver)).toEqual(
    terminalPartition(plan.final, resolver),
  );
  expect(auditRouting(replay.document, resolver)).toMatchObject({
    crossings: before.crossings,
    bends: before.bends,
    wireLength: before.wireLength,
  });
});
it("keeps the incumbent when the mirror would turn a free block left (R170)", () => {
  const { d, plan } = reversed("inverter");
  expect(
    selectNetlistPortSides(
      d,
      resolver,
      plan,
      () => undefined,
      () => false,
    ),
  ).toBe(plan.candidate);
});

it("returns the incumbent when the search is stopped", () => {
  const { d, plan } = reversed();
  expect(
    selectNetlistPortSides(
      d,
      resolver,
      plan,
      () => {
        throw Error("unexpected route trial");
      },
      () => true,
    ),
  ).toBe(plan.candidate);
});

it("stretches a moved port with right-angle wire segments", () => {
  const { d, plan } = reversed();
  const slide = slideNetlistPort(d, resolver, plan, "a", "first", {
    x: 100,
    y: 20,
  });
  expect(slide).toBeDefined();
  const final = slide!.final;
  const lines = final.routes
    .filter((r) => r.netId === "first")
    .flatMap((r) => resolveRouteGeometry(final, resolver, r)!.segments);
  expect(lines.length).toBeGreaterThan(1);
  expect(lines.every((s) => s.from.x === s.to.x || s.from.y === s.to.y)).toBe(
    true,
  );
  expect(connectionsIntact(final, resolver)).toBe(true);
});
