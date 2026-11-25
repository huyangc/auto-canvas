import { readFileSync } from "node:fs";
import { importNetlistProject } from "../../../apps/editor/src/features/auto-layout/netlist-import.test-support.js";
import { netlistPresentation } from "../src/netlist-presentation.js";
import { resolveRouteGeometry } from "@icm/derived";
import { slideNetlistPort } from "../src/slide-netlist-port.js";
import {
  builtInSymbols,
  createProjectSymbolResolver,
  InMemorySymbolResolver,
} from "@icm/symbols";
import { expect, it, vi } from "vitest";
import { connectionsIntact, planLayoutOnce } from "../src/auto-layout.js";
import { rerouteMovedPorts } from "../src/local-reroute.js";
import { placement } from "../src/geometry.js";
import { emptyOverrides } from "../src/layout-choices.js";
import { selectNetlistPortSides } from "../src/netlist-port-sides.js";
import { auditRouting } from "../src/routing-audit.js";
import { preview, terminalPartition } from "../src/transaction.js";
import { circuit } from "./document-fixture.js";

const resolver = new InMemorySymbolResolver(builtInSymbols);
function reversed(block?: "inverter", extraParts = 0) {
  const extra = Array.from({ length: extraParts }, (_, i) => [
    "pad" + i,
    "resistor",
  ]);
  const d = circuit(
    {
      ...Object.fromEntries(extra),
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
  for (let i = 0; i < extraParts; i++)
    seats.set("pad" + i, placement(0, 220 + 100 * i));
  if (block) seats.set("X1", placement(0, 100));
  /** The planner's own routing of exact seats, as the refinement supplies it. */
  const route = (placed: typeof seats) => {
    const run = planLayoutOnce(
      d,
      resolver,
      {},
      emptyOverrides(),
      "template",
      true,
      undefined,
      undefined,
      placed,
    );
    return run.final ? { final: run.final, candidate: run.result } : undefined;
  };
  const plan = route(seats);
  if (!plan) throw Error("expected connected resistor fixture");
  return { d, plan, route };
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
it.each(["reflected plan only", "rerouted mirrors too"] as const)(
  "keeps the incumbent when the mirror would turn a free block left (R170): %s",
  (trials) => {
    // Without a router only the directly reflected plan reaches the veto;
    // with it the mirrored seats and edge columns are routed and judged too.
    const { d, plan, route } = reversed("inverter");
    expect(
      selectNetlistPortSides(
        d,
        resolver,
        plan,
        trials === "reflected plan only" ? () => undefined : route,
        () => false,
      ),
    ).toBe(plan.candidate);
  },
);

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

it("keeps the unchanged net when routing a port at its new seat", () => {
  const { d, plan } = reversed();
  const trial = rerouteMovedPorts(
    d,
    resolver,
    plan,
    new Map([["a", placement(110, 20, "horizontal")]]),
  );
  expect(trial).toBeDefined();
  const final = trial!.final;
  expect(
    final.instances.find((i) => i.id === "a")!.placement?.position,
  ).toEqual({ x: 110, y: 20 });
  expect(final.routes.filter((r) => r.netId === "second")).toEqual(
    plan.final.routes.filter((r) => r.netId === "second"),
  );
  expect(connectionsIntact(final, resolver)).toBe(true);
  expect(terminalPartition(d, resolver)).toBe(
    terminalPartition(final, resolver),
  );
});

it("rejects a west-facing block before routing the reflected seats", () => {
  const { d, plan } = reversed("inverter");
  const pose = plan.final.instances.find((i) => i.id === "X1")!.placement!;
  const route = vi.fn((seats: Map<string, typeof pose>) => {
    expect(seats.get("X1")!.mirror).toBe(pose.mirror);
    return undefined;
  });
  selectNetlistPortSides(d, resolver, plan, route, () => false);
  expect(route).toHaveBeenCalled();
});

it("shares a deterministic full-routing budget across candidates and passes", () => {
  const { d, plan } = reversed("inverter", 22);
  const tried = new Set<string>();
  const route = vi.fn((seats: Map<string, ReturnType<typeof placement>>) => {
    const key = JSON.stringify(d.instances.map((i) => seats.get(i.id)));
    expect(tried.has(key)).toBe(false);
    tried.add(key);
    return undefined;
  });
  selectNetlistPortSides(d, resolver, plan, route, () => false);
  expect(route.mock.calls.length).toBeGreaterThan(0);
  expect(route.mock.calls.length).toBeLessThanOrEqual(12);
});

it("bounds full route trials on the imported Paper3 CLQC deck", async () => {
  const project = await importNetlistProject(
    readFileSync("netlists/paper3-clqc/clqc3.cdl", "utf8"),
    "clqc3.cdl",
  );
  const drawing = project.documents.find((d) => d.name === "clqc3");
  if (!drawing) throw Error("missing CLQC cell");
  const resolver = createProjectSymbolResolver(project, builtInSymbols);
  const source = netlistPresentation(drawing, resolver).document;
  const base = planLayoutOnce(source, resolver, {}, emptyOverrides());
  if (!base.final)
    throw Error("CLQC fixture did not produce a routed starting point");
  const route = vi.fn(() => undefined);
  const result = selectNetlistPortSides(
    source,
    resolver,
    { candidate: base.result, final: base.final },
    route,
    () => false,
  );
  expect(route.mock.calls.length).toBeGreaterThan(0);
  expect(route.mock.calls.length).toBeLessThanOrEqual(12);
  const replay = preview(source, resolver, result.edits);
  if (!replay.ok) throw Error("CLQC port search did not replay");
  expect(connectionsIntact(replay.document, resolver)).toBe(true);
});
