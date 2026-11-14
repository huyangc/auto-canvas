import * as selection from "../src/finished-selection.js";
import * as loops from "../src/local-loop-amplifier.js";
import { preview } from "../src/transaction.js";
import {
  readabilityMetrics,
  readabilityScore,
} from "../src/readability-metrics.js";
import { expect, it, vi } from "vitest";
import { InMemorySymbolResolver, builtInSymbols } from "@icm/symbols";
import {
  localLoopAmplifiers,
  placeLocalLoopAmplifiers,
} from "../src/local-loop-amplifier.js";
import { classifyNets } from "../src/net-roles.js";
import {
  geometryProblem,
  pinPoints,
  placement,
  withPlacements,
} from "../src/geometry.js";
import { placeDocument } from "../src/place.js";
import { freezePinGroups, routeDocument } from "../src/route.js";
import { auditRouting, missingConnections } from "../src/routing-audit.js";
import { planAutoLayout } from "../src/index.js";
import { circuit } from "./document-fixture.js";

const resolver = new InMemorySymbolResolver(builtInSymbols);
function regulator(cascode = true) {
  const d = cascode
    ? circuit(
        { m: "nmos", bottom: "nmos", a: "opamp", r: "resistor" },
        {
          vdd: ["r.1"],
          out: ["r.2", "m.D"],
          sense: ["m.S", "bottom.D", "a.IN-"],
          gnd: ["bottom.S"],
          input: ["bottom.G", "a.IN+"],
          control: ["a.OUT", "m.G"],
        },
      )
    : circuit(
        { m: "nmos", a: "opamp", r: "resistor", ref: "resistor" },
        {
          vdd: ["m.D"],
          sense: ["m.S", "r.1", "a.IN-"],
          gnd: ["r.2", "ref.2"],
          input: ["ref.1", "a.IN+"],
          control: ["a.OUT", "m.G"],
        },
      );
  for (const net of ["vdd", "gnd"])
    d.connectivityEvidence.push(
      {
        id: net + "-source",
        kind: "spice-source",
        netId: net,
        sourceNetId: net,
      },
      {
        id: net + "-claim",
        kind: "name-claim",
        netId: net,
        name: net === "vdd" ? "VDD" : "GND",
        scope: "global",
        powerDomain: net === "vdd" ? "vdd" : "ground",
        owner: { kind: "global-declaration", sourceNetId: net },
      },
    );
  const positions = {
    m: placement(200, 200),
    bottom: placement(200, 300),
    a: placement(440, 200),
    r: placement(210, cascode ? 100 : 300),
    ref: placement(-50, 200),
  };
  const targets = new Map(
    d.instances.map((i) => [i.id, positions[i.id as keyof typeof positions]]),
  );
  return { d, targets, roles: classifyNets(d, resolver) };
}

it.each([true, false])(
  "reduces routed crossings beside a transistor (cascode=%s)",
  (cascode) => {
    const { d, targets, roles } = regulator(cascode);
    const before = structuredClone(targets);
    const route = (p: typeof targets) => {
      const result = routeDocument(
        withPlacements(d, p),
        resolver,
        freezePinGroups(d, resolver),
        roles,
        [],
      );
      expect(result.problem).toBeUndefined();
      expect(missingConnections(result.document, resolver)).toBe(0);
      expect(auditRouting(result.document, resolver).unsafeProblems).toEqual(
        [],
      );
      return auditRouting(result.document, resolver).crossings;
    };
    const prior = route(targets);
    placeLocalLoopAmplifiers(d, resolver, roles, targets, new Set());
    expect(route(targets)).toBeLessThan(prior);
    expect(
      geometryProblem(withPlacements(d, targets), resolver),
    ).toBeUndefined();
    for (const [id, p] of targets)
      if (id !== "a") expect(p).toEqual(before.get(id));
    const pins = pinPoints(withPlacements(d, targets), resolver);
    const out = pins.find(
      (p) => p.instanceId === "a" && p.pinName === "OUT",
    )!.point;
    const gate = pins.find(
      (p) => p.instanceId === "m" && p.pinName === "G",
    )!.point;
    expect(out.y).toBe(gate.y);
    expect(gate.x - out.x).toBeGreaterThanOrEqual(60);
    expect(gate.x - out.x).toBeLessThanOrEqual(80);
    placeLocalLoopAmplifiers(d, resolver, roles, before, new Set());
    expect(targets).toEqual(before);
  },
);

it.each(["template", "layered", "stages"] as const)(
  "offers the local placement in %s",
  (strategy) => {
    const { d, roles } = regulator();
    const result = placeDocument(
      d,
      resolver,
      roles,
      [],
      {},
      undefined,
      undefined,
      strategy,
      undefined,
      undefined,
      undefined,
      true,
    );
    expect(result.problem).toBeUndefined();
    const baseline = placeDocument(
      d,
      resolver,
      roles,
      [],
      {},
      undefined,
      undefined,
      strategy,
    );
    expect(baseline).toEqual(
      placeDocument(
        d,
        resolver,
        roles,
        [],
        {},
        undefined,
        undefined,
        strategy,
        undefined,
        undefined,
        undefined,
        false,
      ),
    );
    expect(result.placements.get("a")).not.toEqual(
      baseline.placements.get("a"),
    );
    const pins = pinPoints(withPlacements(d, result.placements), resolver);
    const out = pins.find(
      (p) => p.instanceId === "a" && p.pinName === "OUT",
    )!.point;
    const gate = pins.find(
      (p) => p.instanceId === "m" && p.pinName === "G",
    )!.point;
    expect(out.y).toBe(gate.y);
    expect(out.x).toBeLessThan(gate.x);
    expect(gate.x - out.x).toBeLessThanOrEqual(80);
  },
);

it("recognizes feedback through the DC branch, but never through a rail or capacitor", () => {
  const { d } = regulator();
  d.nets.find((n) => n.id === "sense")!.terminals = d.nets
    .find((n) => n.id === "sense")!
    .terminals.filter((t) => t.instanceId !== "a");
  d.nets
    .find((n) => n.id === "gnd")!
    .terminals.push({ instanceId: "a", pinName: "IN-" });
  expect(localLoopAmplifiers(d, resolver, classifyNets(d, resolver))).toEqual(
    [],
  );
  d.connectivityEvidence = d.connectivityEvidence.filter(
    (e) => e.netId !== "gnd",
  );
  expect(
    localLoopAmplifiers(d, resolver, classifyNets(d, resolver)),
  ).toHaveLength(1);
  d.instances.find((i) => i.id === "bottom")!.symbolId = "capacitor";
  for (const net of d.nets)
    for (const t of net.terminals)
      if (t.instanceId === "bottom") t.pinName = t.pinName === "D" ? "1" : "2";
  expect(localLoopAmplifiers(d, resolver, classifyNets(d, resolver))).toEqual(
    [],
  );
});

it.each(["no-feedback", "fixed", "collision"])(
  "leaves %s placements unchanged",
  (mode) => {
    const { d, targets } = regulator();
    const protectedIds = new Set<string>();
    if (mode === "no-feedback")
      d.nets.find((n) => n.id === "sense")!.terminals = d.nets
        .find((n) => n.id === "sense")!
        .terminals.filter((t) => t.instanceId !== "a");
    if (mode === "fixed") protectedIds.add("a");
    if (mode === "collision") {
      d.instances.push({
        id: "blocker",
        symbolId: "resistor",
        placement: null,
      });
      targets.set("blocker", placement(90, 200));
    }
    const before = structuredClone(targets);
    placeLocalLoopAmplifiers(
      d,
      resolver,
      classifyNets(d, resolver),
      targets,
      protectedIds,
    );
    expect(targets).toEqual(before);
  },
);

it("preserves rigid-group membership and fixed amplifier placements in the shared pipeline", () => {
  const { d, targets, roles } = regulator();
  for (const i of d.instances) i.placement = targets.get(i.id)!;
  const fixed = placeDocument(
    d,
    resolver,
    roles,
    [],
    {
      fixedInstanceIds: new Set(["a"]),
    },
    undefined,
    undefined,
    "template",
    undefined,
    undefined,
    undefined,
    true,
  );
  expect(fixed.placements.get("a")).toEqual(targets.get("a"));
  const groups = [
    {
      id: "group",
      kind: "matched-pair" as const,
      members: ["a", "r"] as [string, string],
    },
  ];
  const legacy = placeDocument(
    d,
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
  );
  const local = placeDocument(
    d,
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
    true,
  );
  expect(local).toEqual(legacy);
});

it("repeats the complete selected plan deterministically", () => {
  const { d } = regulator();
  const before = JSON.stringify(d);
  const options = { search: { seed: 1, evaluations: 0 } };
  const first = planAutoLayout(d, resolver, options);
  expect(first.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
  expect(planAutoLayout(d, resolver, options)).toEqual(first);
  expect(JSON.stringify(d)).toBe(before);
});

it("recognizes a comparator regulating a BJT emitter by its pin roles", () => {
  const { d, targets } = regulator(false);
  d.instances.find((i) => i.id === "a")!.symbolId = "comparator";
  d.instances.find((i) => i.id === "m")!.symbolId = "npn";
  for (const net of d.nets)
    for (const pin of net.terminals)
      if (pin.instanceId === "m")
        pin.pinName = ({ D: "C", G: "B", S: "E" } as Record<string, string>)[
          pin.pinName
        ]!;
  const roles = classifyNets(d, resolver);
  expect(localLoopAmplifiers(d, resolver, roles)).toHaveLength(1);
  const before = structuredClone(targets);
  placeLocalLoopAmplifiers(d, resolver, roles, targets, new Set());
  expect(targets.get("a")).not.toEqual(before.get("a"));
  expect(targets.get("m")).toEqual(before.get("m"));
});

it("retains a local loop when a capacitor loads its control output", () => {
  const { d, targets } = regulator();
  d.instances.push({ id: "load", symbolId: "capacitor", placement: null });
  d.nets
    .find((n) => n.id === "control")!
    .terminals.push({ instanceId: "load", pinName: "1" });
  d.nets
    .find((n) => n.id === "gnd")!
    .terminals.push({ instanceId: "load", pinName: "2" });
  targets.set("load", placement(-100, 300));
  const roles = classifyNets(d, resolver);
  expect(localLoopAmplifiers(d, resolver, roles)).toHaveLength(1);
  const before = structuredClone(targets);
  placeLocalLoopAmplifiers(d, resolver, roles, targets, new Set());
  expect(targets.get("a")).not.toEqual(before.get("a"));
  expect(targets.get("load")).toEqual(before.get("load"));
});

it("checks collisions against devices outside the local partition", () => {
  const { d, targets, roles } = regulator();
  const obstacles = {
    ...d,
    instances: [
      ...d.instances,
      {
        id: "other-partition",
        symbolId: "resistor",
        placement: placement(90, 200),
      },
    ],
  };
  targets.set("other-partition", placement(90, 200));
  const before = structuredClone(targets);
  placeLocalLoopAmplifiers(d, resolver, roles, targets, new Set(), obstacles);
  expect(targets).toEqual(before);
});

function receiverBank(series = false) {
  const { d, targets } = regulator(false);
  d.instances.push({ id: "other", symbolId: "nmos", placement: null });
  targets.set("other", placement(200, 500));
  d.nets
    .find((n) => n.id === "vdd")!
    .terminals.push({ instanceId: "other", pinName: "D" });
  d.nets.push({
    id: "other-source",
    terminals: [{ instanceId: "other", pinName: "S" }],
  });
  d.nets
    .find((n) => n.id === "control")!
    .terminals.push({ instanceId: "other", pinName: "G" });
  if (series) {
    d.instances.push({ id: "series", symbolId: "resistor", placement: null });
    targets.set("series", placement(400, 400));
    d.nets.find((n) => n.id === "control")!.terminals = [
      { instanceId: "series", pinName: "2" },
      { instanceId: "m", pinName: "G" },
      { instanceId: "other", pinName: "G" },
    ];
    d.nets.push({
      id: "drive",
      terminals: [
        { instanceId: "a", pinName: "OUT" },
        { instanceId: "series", pinName: "1" },
      ],
    });
  }
  return { d, targets };
}

it.each([false, true])(
  "seats a receiver bank at its nearest gate (series=%s)",
  (series) => {
    const { d, targets } = receiverBank(series);
    // The nearest receiver has no sensed terminal: recognition belongs to the
    // whole bank, while geometric anchoring belongs to its nearest gate.
    targets.set("a", placement(440, 500));
    const roles = classifyNets(d, resolver);
    const loops = localLoopAmplifiers(d, resolver, roles);
    expect(loops).toHaveLength(1);
    expect(loops[0]!.receivers.map((r) => r.host.id)).toEqual(["m", "other"]);
    const before = structuredClone(targets);
    placeLocalLoopAmplifiers(d, resolver, roles, targets, new Set());
    const placed = withPlacements(d, targets);
    expect(geometryProblem(placed, resolver)).toBeUndefined();
    const points = pinPoints(placed, resolver);
    const pin = (id: string, name: string) =>
      points.find((p) => p.instanceId === id && p.pinName === name)!.point;
    const gate = pin("other", "G"),
      output = pin("a", "OUT");
    expect(output.y).toBe(gate.y);
    expect(output.x).toBeLessThan(gate.x);
    if (series) {
      const input = pin("series", "1"),
        out = pin("series", "2");
      expect(input.y).toBe(gate.y);
      expect(out.y).toBe(gate.y);
      expect(input.x).toBeGreaterThan(output.x);
      expect(out.x).toBeGreaterThan(input.x);
      expect(out.x).toBeLessThan(gate.x);
      expect(targets.get("series")).not.toEqual(before.get("series"));
    }
    for (const [id, p] of targets)
      if (id !== "a" && id !== "series") expect(p).toEqual(before.get(id));
    const routed = routeDocument(
      placed,
      resolver,
      freezePinGroups(d, resolver),
      roles,
      [],
    );
    expect(routed.problem).toBeUndefined();
    expect(missingConnections(routed.document, resolver)).toBe(0);
    expect(auditRouting(routed.document, resolver).unsafeProblems).toEqual([]);
    placeLocalLoopAmplifiers(d, resolver, roles, before, new Set());
    expect(targets).toEqual(before);
  },
);

it.each(["fixed-amplifier", "fixed-passive", "collision"])(
  "preserves the entire series unit on %s",
  (mode) => {
    const { d, targets } = receiverBank(true);
    targets.set("a", placement(440, 500));
    const movable = structuredClone(targets);
    placeLocalLoopAmplifiers(
      d,
      resolver,
      classifyNets(d, resolver),
      movable,
      new Set(),
    );
    expect(movable.get("a")).not.toEqual(targets.get("a"));
    expect(movable.get("series")).not.toEqual(targets.get("series"));
    const fixed = new Set(
      mode === "collision" ? [] : [mode === "fixed-passive" ? "series" : "a"],
    );
    if (mode === "collision") {
      d.instances.push({
        id: "blocker",
        symbolId: "resistor",
        placement: null,
      });
      targets.set("blocker", placement(90, 500));
    }
    const before = structuredClone(targets);
    placeLocalLoopAmplifiers(
      d,
      resolver,
      classifyNets(d, resolver),
      targets,
      fixed,
    );
    expect(targets).toEqual(before);
  },
);

it.each(["two-passives", "rail", "no-feedback", "active"])(
  "rejects a %s output path",
  (mode) => {
    const { d } = receiverBank(true);
    if (mode === "two-passives") {
      d.instances.push({ id: "second", symbolId: "resistor", placement: null });
      d.nets.find((n) => n.id === "drive")!.terminals = [
        { instanceId: "series", pinName: "1" },
        { instanceId: "second", pinName: "2" },
      ];
      d.nets.push({
        id: "drive-2",
        terminals: [
          { instanceId: "a", pinName: "OUT" },
          { instanceId: "second", pinName: "1" },
        ],
      });
    }
    if (mode === "rail") {
      d.nets
        .find((n) => n.id === "vdd")!
        .terminals.push(...d.nets.find((n) => n.id === "control")!.terminals);
      d.nets = d.nets.filter((n) => n.id !== "control");
    }
    if (mode === "no-feedback")
      d.nets.find((n) => n.id === "sense")!.terminals = d.nets
        .find((n) => n.id === "sense")!
        .terminals.filter((t) => t.instanceId !== "a");
    if (mode === "active") {
      d.instances.find((i) => i.id === "series")!.symbolId = "voltage-source";
      for (const net of d.nets)
        for (const terminal of net.terminals)
          if (terminal.instanceId === "series")
            terminal.pinName = terminal.pinName === "1" ? "+" : "-";
    }
    expect(localLoopAmplifiers(d, resolver, classifyNets(d, resolver))).toEqual(
      [],
    );
  },
);

it("clears a horizontal receiver bank while aligning with its nearest gate", () => {
  const { d, targets } = receiverBank();
  targets.set("other", placement(280, 200));
  targets.set("a", placement(440, 200));
  const before = structuredClone(targets);
  placeLocalLoopAmplifiers(
    d,
    resolver,
    classifyNets(d, resolver),
    targets,
    new Set(),
  );
  const placed = withPlacements(d, targets);
  expect(geometryProblem(placed, resolver)).toBeUndefined();
  expect(targets.get("a")).not.toEqual(before.get("a"));
  expect(targets.get("m")).toEqual(before.get("m"));
  expect(targets.get("other")).toEqual(before.get("other"));
  const points = pinPoints(placed, resolver);
  const output = points.find(
    (p) => p.instanceId === "a" && p.pinName === "OUT",
  )!.point;
  const gates = points
    .filter((p) => ["m", "other"].includes(p.instanceId) && p.pinName === "G")
    .map((p) => p.point);
  expect(output.x).toBeLessThan(Math.min(...gates.map((p) => p.x)));
  expect(gates.every((p) => p.y === output.y)).toBe(true);
});

it.each([true, false])(
  "rejects a separately finished local-loop variant that loses the shared comparison (cascode=%s)",
  (cascode) => {
    const { d } = regulator(cascode);
    const recognize = vi
      .spyOn(loops, "localLoopAmplifiers")
      .mockReturnValue([]);
    const baseline = planAutoLayout(d, resolver);
    recognize.mockRestore();
    const choose = vi.spyOn(selection, "selectFinishedLayout");
    try {
      const result = planAutoLayout(d, resolver);
      const score = (plan: typeof result) => {
        const applied = preview(d, resolver, plan.edits);
        if (!applied.ok) throw Error("invalid finished plan");
        return readabilityScore(
          readabilityMetrics(applied.document, resolver, "weighted"),
        );
      };
      expect(choose).toHaveBeenCalled();
      const [, , incumbent, candidate] = choose.mock.calls.at(-1)!;
      expect(candidate.edits).not.toEqual(incumbent.edits);
      expect(result).toEqual(baseline);
      if (!cascode) expect(score(candidate)).toBeGreaterThan(score(incumbent));
      expect(planAutoLayout(d, resolver)).toEqual(result);
      expect(score(result)).toBeLessThanOrEqual(score(baseline));
    } finally {
      choose.mockRestore();
    }
  },
);
