import { expect, it, vi } from "vitest";
import { reflectOrientation } from "@icm/model";
import { builtInSymbols, InMemorySymbolResolver } from "@icm/symbols";
import { planAutoLayout, planLayoutOnce } from "../src/auto-layout.js";
import { classifyNets } from "../src/net-roles.js";
import { placeDocument } from "../src/place.js";
import { recognizeStructures } from "../src/recognize.js";
import { stageFlanks, placeStageFlanks } from "../src/stage-flank.js";
import * as flank from "../src/stage-flank.js";
import * as selection from "../src/finished-selection.js";
import { pinPoints, withPlacements } from "../src/geometry.js";
import { preview, terminalPartition } from "../src/transaction.js";
import {
  readabilityMetrics,
  readabilityScore,
} from "../src/readability-metrics.js";
import { emptyOverrides } from "../src/layout-choices.js";
import { auditRouting, missingConnections } from "../src/routing-audit.js";
import { circuit } from "./document-fixture.js";

const resolver = new InMemorySymbolResolver(builtInSymbols);
// Synthetic topology-only differential amplifier with independent output sinks.
const fixture = () => {
  const d = circuit(
    {
      a: "nmos",
      b: "nmos",
      c: "pmos",
      d: "pmos",
      e: "pmos",
      f: "pmos",
      h: "nmos",
      i: "nmos",
      tail: "current-source",
      v: "vdd-port",
      g: "ground",
      g1: "ground",
      g2: "ground",
    },
    {
      inA: ["a.G"],
      inB: ["b.G"],
      common: ["a.S", "b.S", "tail.+"],
      left: ["a.D", "c.D", "e.G"],
      right: ["b.D", "d.D", "f.G"],
      biasP: ["c.G", "d.G"],
      biasN: ["h.G", "i.G"],
      outA: ["e.D", "h.D"],
      outB: ["f.D", "i.D"],
      supply: ["c.S", "d.S", "e.S", "f.S", "v.P"],
      ground: ["tail.-", "g.0"],
      groundA: ["h.S", "g1.0"],
      groundB: ["i.S", "g2.0"],
    },
    {
      a: "input",
      b: "input",
      c: "load",
      d: "load",
      e: "output",
      f: "output",
      h: "sink",
      i: "sink",
    },
  );
  for (const i of d.instances) if (i.netlist) i.reference = `M_${i.id}`;
  return d;
};

const place = (
  d: ReturnType<typeof fixture>,
  variant: boolean,
  options = {},
) => {
  const roles = classifyNets(d, resolver);
  return placeDocument(
    d,
    resolver,
    roles,
    recognizeStructures(d, roles),
    options,
    undefined,
    undefined,
    "stages",
    undefined,
    undefined,
    undefined,
    false,
    false,
    variant,
  );
};
const centres = (
  d: ReturnType<typeof fixture>,
  targets: ReturnType<typeof place>["placements"],
) => {
  const points = pinPoints(withPlacements(d, targets), resolver);
  return (id: string) => {
    const own = points.filter((p) => p.instanceId === id);
    return own.reduce((sum, p) => sum + p.point.x, 0) / own.length;
  };
};

it("widens each half rigidly, preserving pairs and the driver", () => {
  const d = fixture(),
    roles = classifyNets(d, resolver);
  const links = stageFlanks(d, resolver, roles);
  expect(links).toHaveLength(1);
  const base = place(d, false);
  expect(base.problem).toBeUndefined();
  const next = structuredClone(base.placements);
  placeStageFlanks(
    d,
    resolver,
    roles,
    next,
    recognizeStructures(d, roles),
    new Set(),
  );
  const link = links[0]!;
  for (const id of [...link.driver.pairs.flat(), ...link.driver.axis])
    expect(next.get(id)).toEqual(base.placements.get(id));
  const centre = centres(d, next),
    axis = (centre("a") + centre("b")) / 2;
  for (const [a, b] of link.downstream.pairs) {
    expect((centre(a) + centre(b)) / 2).toBeCloseTo(axis);
    expect(centre(a)).toBeLessThan(Math.min(centre("a"), centre("c")));
    expect(centre(b)).toBeGreaterThan(Math.max(centre("b"), centre("d")));
    const reflected = reflectOrientation(next.get(a)!, "left-right");
    expect(next.get(b)).toMatchObject({
      rotation: reflected.rotation,
      mirror: reflected.mirror,
    });
  }
  for (const side of [0, 1]) {
    const ids = link.downstream.pairs.map((p) => p[side]!);
    const delta = ids.map((id) => ({
      x: next.get(id)!.position.x - base.placements.get(id)!.position.x,
      y: next.get(id)!.position.y - base.placements.get(id)!.position.y,
    }));
    expect(delta.every((d) => d.x === delta[0]!.x && d.y === delta[0]!.y)).toBe(
      true,
    );
    for (const id of ids) {
      expect(next.get(id)!.rotation).toBe(base.placements.get(id)!.rotation);
      expect(next.get(id)!.mirror).toBe(base.placements.get(id)!.mirror);
    }
  }
  const repeat = structuredClone(base.placements);
  placeStageFlanks(
    d,
    resolver,
    roles,
    repeat,
    recognizeStructures(d, roles),
    new Set(),
  );
  expect(repeat).toEqual(next);
  // Given-state finishing must preserve the constructed whole block.
  const finished = placeDocument(
    d,
    resolver,
    roles,
    recognizeStructures(d, roles),
    {},
    undefined,
    undefined,
    "stages",
    place(d, true).placements,
  );
  expect(finished.problem).toBeUndefined();
});

it("routes the flanking second stage with fewer crossings and unchanged connectivity", () => {
  const d = fixture();
  const nets = ["inA", "inB", "outA", "outB"];
  for (const net of nets) {
    const id = "port-" + net;
    d.instances.push({ id, symbolId: "port", placement: null });
    d.nets
      .find((n) => n.id === net)!
      .terminals.push({ instanceId: id, pinName: "P" });
  }
  d.netlist = {
    name: "Synthetic",
    formalParameters: [],
    terminals: nets.map((net) => ({
      id: "terminal-" + net,
      name: net,
      netId: net,
      direction: net.startsWith("out")
        ? ("output" as const)
        : ("input" as const),
      interfaceInstanceIds: ["port-" + net],
    })),
  };
  const base = planLayoutOnce(d, resolver, {}, emptyOverrides(), "stages");
  const next = planLayoutOnce(
    d,
    resolver,
    { flankDraft: true },
    emptyOverrides(),
    "stages",
  );
  for (const run of [base, next]) {
    expect(run.result.diagnostics).toEqual([]);
    expect(run.final).toBeDefined();
    expect(missingConnections(run.final!, resolver)).toBe(0);
    expect(auditRouting(run.final!, resolver).unsafeProblems).toEqual([]);
    expect(terminalPartition(run.final!, resolver)).toBe(
      terminalPartition(d, resolver),
    );
  }
  expect(auditRouting(next.final!, resolver).crossings).toBeLessThan(
    auditRouting(base.final!, resolver).crossings,
  );
  expect(
    planLayoutOnce(
      d,
      resolver,
      { flankDraft: true },
      emptyOverrides(),
      "stages",
    ).result,
  ).toEqual(next.result);
});

it("keeps a downstream shared-bias source on the shared axis", () => {
  const d = fixture();
  for (const [id, net] of [
    ["ra", "outA"],
    ["rb", "outB"],
  ] as const) {
    d.instances.push({ id, symbolId: "resistor", placement: null });
    d.nets
      .find((n) => n.id === net)!
      .terminals.push({ instanceId: id, pinName: "1" });
    d.nets
      .find((n) => n.id === "supply")!
      .terminals.push({ instanceId: id, pinName: "2" });
  }
  d.nets.find((n) => n.id === "common")!.terminals = d.nets
    .find((n) => n.id === "common")!
    .terminals.filter((t) => t.instanceId !== "tail");
  d.nets
    .find((n) => n.id === "biasN")!
    .terminals.push({ instanceId: "tail", pinName: "+" });
  const roles = classifyNets(d, resolver),
    links = stageFlanks(d, resolver, roles);
  expect(links[0]!.downstream.axis).toEqual(["tail"]);
  const base = place(d, false),
    next = structuredClone(base.placements);
  placeStageFlanks(
    d,
    resolver,
    roles,
    next,
    recognizeStructures(d, roles),
    new Set(),
  );
  expect(next.get("tail")).not.toEqual(base.placements.get("tail"));
  const centre = centres(d, next);
  expect(centre("tail")).toBeCloseTo((centre("a") + centre("b")) / 2);
  expect(centre("tail")).toBeCloseTo((centre("e") + centre("f")) / 2);
  expect(next.get("a")).toEqual(base.placements.get("a"));
});

it.each(["fixed", "template", "group", "constraint"])(
  "does not split %s geometry",
  (kind) => {
    const d = fixture(),
      roles = classifyNets(d, resolver),
      base = place(d, false).placements,
      next = structuredClone(base);
    const groups = recognizeStructures(d, roles),
      fixed = new Set<string>();
    if (kind === "fixed") fixed.add("e");
    if (kind === "template")
      groups.push({ id: "protect", kind: "matched-pair", members: ["e", "f"] });
    if (kind === "group")
      d.layoutGroups.push({
        id: "protect",
        kind: "matched-pair",
        objectIds: ["e", "f"],
        locked: false,
      });
    if (kind === "constraint")
      d.constraints.push({
        id: "protect",
        kind: "symmetric",
        objectIds: ["e", "f"],
        locked: false,
      });
    placeStageFlanks(d, resolver, roles, next, groups, fixed);
    expect(next).toEqual(base);
  },
);

it("preserves an explicit floorplan", () => {
  const d = fixture(),
    options = {
      partition: {
        blocks: [
          { id: "input", members: ["a", "b", "c", "d", "tail"] },
          { id: "output", members: ["e", "f", "h", "i"] },
        ],
        arrangement: { input: { x: 0, y: 0 }, output: { x: 1, y: 0 } },
      },
    };
  const base = place(d, false, options),
    next = place(d, true, options);
  expect(base.problem).toBeUndefined();
  expect(next).toEqual(base);
});

it("leaves a non-symmetric chain unchanged", () => {
  const d = circuit(
    { a: "nmos", b: "nmos", r: "resistor", g: "ground" },
    {
      input: ["a.G"],
      drive: ["a.D", "b.G"],
      out: ["b.D", "r.1"],
      supply: ["r.2"],
      ground: ["a.S", "b.S", "g.0"],
    },
  );
  expect(stageFlanks(d, resolver, classifyNets(d, resolver))).toEqual([]);
  expect(place(d, true)).toEqual(place(d, false));
});

it("recognizes independently of authored positions and input ordering", () => {
  const d = fixture(),
    before = stageFlanks(d, resolver, classifyNets(d, resolver));
  d.instances.reverse();
  d.nets.reverse();
  for (const n of d.nets) n.terminals.reverse();
  for (const [n, i] of d.instances.entries())
    i.placement = {
      position: { x: n * 70, y: n * 20 },
      rotation: 90,
      mirror: "horizontal",
    };
  expect(stageFlanks(d, resolver, classifyNets(d, resolver))).toEqual(before);
});

it("rejects a worse finished flank finalist and repeats deterministically", () => {
  const d = fixture();
  const recognition = vi.spyOn(flank, "stageFlanks").mockReturnValue([]);
  let base: ReturnType<typeof planAutoLayout>;
  try {
    base = planAutoLayout(d, resolver);
  } finally {
    recognition.mockRestore();
  }
  const select = vi.spyOn(selection, "selectFinishedLayout");
  try {
    const result = planAutoLayout(d, resolver);
    expect(result.diagnostics).toEqual([]);
    const call = select.mock.calls.at(-1)!;
    expect(call).toBeDefined();
    const score = (p: typeof result) => {
      const a = preview(d, resolver, p.edits);
      expect(a.ok).toBe(true);
      if (!a.ok) throw Error("invalid");
      return readabilityScore(
        readabilityMetrics(a.document, resolver, "weighted"),
      );
    };
    expect(call[3].edits).not.toEqual(call[2].edits);
    expect(score(call[3])).toBeGreaterThan(score(call[2]));
    expect(select.mock.results.at(-1)!.value).toBe(call[2]);
    expect(result).toEqual(base!);
    expect(planAutoLayout(d, resolver)).toEqual(result);
  } finally {
    select.mockRestore();
  }
}, 30000);
