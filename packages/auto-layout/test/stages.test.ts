import { expect, it } from "vitest";
import { InMemorySymbolResolver, builtInSymbols } from "@icm/symbols";
import { visibleInstanceBounds } from "@icm/derived";
import { planAutoLayout } from "../src/index.js";
import { createPlacementEstimator } from "../src/estimate.js";
import {
  geometryProblem,
  pinPoints,
  placement,
  withPlacements,
} from "../src/geometry.js";
import { classifyNets } from "../src/net-roles.js";
import { findStages, placeStages } from "../src/stages.js";
import { recognizeStructures } from "../src/recognize.js";
import { refinementMetrics } from "../src/refine.js";
import { circuit } from "./document-fixture.js";

const resolver = new InMemorySymbolResolver(builtInSymbols);
const withRails = (d: ReturnType<typeof circuit>) => {
  d.netlist = {
    name: "test",
    formalParameters: [],
    terminals: ["vdd", "gnd", "input"]
      .filter((net) => d.nets.some((n) => n.id === net))
      .map((net) => ({
        id: net,
        name: net,
        netId: net,
        direction: "passive",
        interfaceInstanceIds: [],
      })),
  };
  return d;
};
const twoStages = (capacitor = false) =>
  withRails(
    circuit(
      {
        a: "nmos",
        b: "nmos",
        ra: "resistor",
        rb: "resistor",
        ...(capacitor ? { c: "capacitor" } : {}),
      },
      {
        vdd: ["ra.1", "rb.1"],
        gnd: ["a.S", "b.S"],
        input: ["a.G"],
        first: ["ra.2", "a.D", capacitor ? "c.1" : "b.G"],
        second: ["rb.2", "b.D"],
        ...(capacitor ? { coupled: ["c.2", "b.G"] } : {}),
      },
    ),
  );
const stagesOf = (d: ReturnType<typeof circuit>) => {
  const roles = classifyNets(d, resolver);
  const groups = recognizeStructures(d, roles);
  return { ...findStages(d.instances, resolver, roles, groups), roles, groups };
};

it("cuts gates and shared rails into two independent common-source stacks", () => {
  const d = twoStages();
  const { stages, roles, groups } = stagesOf(d);
  expect(stages.map((s) => s.devices.map((i) => i.id))).toEqual([
    ["a", "ra"],
    ["b", "rb"],
  ]);
  const targets = placeStages(d, d.instances, resolver, roles, groups);
  const bounds = visibleInstanceBounds(withPlacements(d, targets), resolver);
  const rightA = Math.max(
    ...bounds
      .filter((b) => ["a", "ra"].includes(b.id))
      .map((b) => b.bounds.x + b.bounds.width),
  );
  const leftB = Math.min(
    ...bounds.filter((b) => ["b", "rb"].includes(b.id)).map((b) => b.bounds.x),
  );
  expect(leftB - rightA).toBeGreaterThanOrEqual(80);
  expect(targets.get("ra")!.position.y).toBe(targets.get("rb")!.position.y);
  expect(targets.get("a")!.position.y).toBeGreaterThan(
    targets.get("ra")!.position.y,
  );
  expect(targets.get("b")!.position.y).toBeGreaterThan(
    targets.get("rb")!.position.y,
  );
});

it("merges two separate channel stacks through their recognized current mirror", () => {
  const d = withRails(
    circuit(
      { a: "nmos", b: "nmos", ra: "resistor", rb: "resistor" },
      {
        vdd: ["ra.1", "rb.1"],
        gnd: ["a.S", "b.S"],
        bias: ["a.G", "b.G", "a.D", "ra.2"],
        output: ["b.D", "rb.2"],
      },
    ),
  );
  const { stages, groups, roles } = stagesOf(d);
  expect(findStages(d.instances, resolver, roles, []).stages).toHaveLength(2);
  expect(groups[0]?.kind).toBe("current-mirror");
  expect(stages).toHaveLength(1);
  expect(stages[0]!.devices).toHaveLength(4);
});

it("keeps a coupling capacitor between its stages at its host pins' level", () => {
  const d = twoStages(true);
  const { stages, bridges, roles, groups } = stagesOf(d);
  expect(stages).toHaveLength(2);
  expect(bridges).toHaveLength(1);
  const targets = placeStages(d, d.instances, resolver, roles, groups);
  const cap = targets.get("c")!;
  expect(cap.position.x).toBeGreaterThan(targets.get("a")!.position.x);
  expect(cap.position.x).toBeLessThan(targets.get("b")!.position.x);
  const points = pinPoints(withPlacements(d, targets), resolver);
  const hostYs = points
    .filter(
      (p) =>
        ["first", "coupled"].includes(
          roles.pinNet(p.instanceId, p.pinName) ?? "",
        ) && p.instanceId !== "c",
    )
    .map((p) => p.point.y);
  const grid = d.presentation.grid;
  // First endpoint has two host pins; each endpoint contributes its mean level.
  const firstYs = points
    .filter(
      (p) =>
        p.instanceId !== "c" &&
        roles.pinNet(p.instanceId, p.pinName) === "first",
    )
    .map((p) => p.point.y);
  const receiver = points.find(
    (p) => p.instanceId === "b" && p.pinName === "G",
  )!.point.y;
  expect(hostYs.length).toBe(3);
  expect(points.find((p) => p.instanceId === "c")!.point.y).toBe(
    Math.round(
      (firstYs.reduce((a, b) => a + b, 0) / firstYs.length + receiver) /
        2 /
        grid,
    ) * grid,
  );
});

it("attaches a rail shunt capacitor without joining independent stages", () => {
  const d = twoStages();
  d.instances.push({ id: "c", symbolId: "capacitor", placement: null });
  d.nets
    .find((n) => n.id === "first")!
    .terminals.push({ instanceId: "c", pinName: "1" });
  d.nets
    .find((n) => n.id === "gnd")!
    .terminals.push({ instanceId: "c", pinName: "2" });
  const { stages, bridges, roles, groups } = stagesOf(d);
  expect(stages).toHaveLength(2);
  expect(bridges).toHaveLength(0);
  expect(
    stages
      .find((s) => s.devices.some((i) => i.id === "a"))!
      .devices.map((i) => i.id),
  ).toContain("c");
  const targets = placeStages(d, d.instances, resolver, roles, groups);
  const pin = pinPoints(withPlacements(d, targets), resolver).find(
    (p) => p.instanceId === "a" && p.pinName === "D",
  )!.point;
  expect(targets.get("c")!.position.y).toBeGreaterThan(pin.y);
  expect(Math.abs(targets.get("c")!.position.x - pin.x)).toBeLessThan(80);
  expect(geometryProblem(withPlacements(d, targets), resolver)).toBeUndefined();
});

it("conducts through BJT C/E and inductors, cutting bases and blocks", () => {
  const d = circuit(
    { a: "npn", b: "pnp", l: "inductor", block: "comparator" },
    {
      channel: ["a.C", "l.1"],
      channel2: ["l.2", "b.E"],
      base: ["a.B", "b.B", "block.IN+"],
    },
  );
  expect(stagesOf(d).stages.map((s) => s.devices.map((i) => i.id))).toEqual([
    ["a", "b", "l"],
    ["block"],
  ]);
});

it("estimates one proper crossing, zero parallel crossings, and ignores rails and MOS bulk", () => {
  const d = circuit(
    { a: "port", b: "port", c: "port", d: "port" },
    { one: ["a.P", "b.P"], two: ["c.P", "d.P"] },
  );
  const estimate = createPlacementEstimator(
    d.instances,
    resolver,
    classifyNets(d, resolver),
  );
  // All port pin offsets are equal, so these origins produce the intended lines.
  const crossed = new Map([
    ["a", placement(0, 50)],
    ["b", placement(100, 50)],
    ["c", placement(50, 0)],
    ["d", placement(50, 100)],
  ]);
  expect(estimate(crossed)).toEqual({ crossings: 1, length: 200, score: 1.2 });
  const parallel = new Map(crossed)
    .set("c", placement(0, 100))
    .set("d", placement(100, 100));
  expect(estimate(parallel).crossings).toBe(0);
  const touching = new Map(crossed)
    .set("c", placement(100, 0))
    .set("d", placement(100, 100));
  expect(estimate(touching).crossings).toBe(0);
  const before = JSON.stringify([...crossed]);
  expect(estimate(crossed)).toEqual(estimate(crossed));
  expect(JSON.stringify([...crossed])).toBe(before);
  const rails = classifyNets(d, resolver);
  rails.rails.set("two", "ground");
  expect(
    createPlacementEstimator(d.instances, resolver, rails)(crossed).crossings,
  ).toBe(0);
  const bulk = circuit({ a: "nmos", b: "nmos" }, { bulk: ["a.B", "b.B"] });
  expect(
    createPlacementEstimator(
      bulk.instances,
      resolver,
      classifyNets(bulk, resolver),
    )(
      new Map([
        ["a", placement(0, 0)],
        ["b", placement(100, 0)],
      ]),
    ).length,
  ).toBe(0);
});

it("is deterministic for a synthetic 120-device document through the public portfolio", () => {
  const count = 120;
  const d = circuit(
    Object.fromEntries(
      Array.from({ length: count }, (_, i) => [`m${i}`, "nmos"]),
    ),
    Object.fromEntries(
      Array.from({ length: count + 1 }, (_, i) => [
        `n${i}`,
        [...(i ? [`m${i - 1}.S`] : []), ...(i < count ? [`m${i}.D`] : [])],
      ]),
    ),
  );
  const before = JSON.stringify(d);
  const plan = planAutoLayout(d, resolver);
  expect(plan.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
  expect(planAutoLayout(d, resolver)).toEqual(plan);
  expect(refinementMetrics(plan)?.candidates).toBe(0);
  expect(JSON.stringify(d)).toBe(before);
}, 30000);
it("mirrors a whole stage to remove a crossing without disturbing its stack", () => {
  const d = circuit(
    { a: "nmos", b: "nmos", c: "nmos", d: "nmos", e: "nmos", f: "nmos" },
    {
      top0: ["a.D"],
      mid0: ["a.S", "b.D", "c.G", "d.G", "f.G"],
      low0: ["b.S", "a.G", "e.G"],
      top1: ["c.D"],
      mid1: ["c.S", "d.D"],
      low1: ["d.S"],
      top2: ["e.D", "b.G"],
      mid2: ["e.S", "f.D"],
      low2: ["f.S"],
    },
  );
  const roles = classifyNets(d, resolver);
  const targets = placeStages(d, d.instances, resolver, roles, []);
  const estimate = createPlacementEstimator(d.instances, resolver, roles);
  const unmirrored = new Map(
    [...targets].map(([id, p]) => [id, { ...p, mirror: "none" as const }]),
  );
  expect(estimate(unmirrored).crossings).toBe(1);
  expect(estimate(targets).crossings).toBe(0);
  expect(targets.get("a")!.mirror).toBe("horizontal");
  expect(targets.get("b")!.mirror).toBe("horizontal");
  const pins = pinPoints(withPlacements(d, targets), resolver);
  expect(
    pins.find((p) => p.instanceId === "a" && p.pinName === "S")!.point.x,
  ).toBe(pins.find((p) => p.instanceId === "b" && p.pinName === "D")!.point.x);
});

it("R57 reverses a two-stage placement when input hosts lie right of output hosts", () => {
  const d = circuit(
    { a: "nmos", b: "nmos", input: "port", output: "port" },
    {
      input: ["a.D", "input.P"],
      output: ["a.G", "output.P"],
      link: ["a.S", "b.G"],
      end: ["b.D"],
    },
  );
  const devices = d.instances.filter(
    (i) => !["input", "output"].includes(i.id),
  );
  const roles = classifyNets(d, resolver);
  roles.byNet.set("input", "input");
  roles.byNet.set("output", "output");
  const withoutPorts = { ...d, instances: devices };
  const original = placeStages(withoutPorts, devices, resolver, roles, []);
  const directed = placeStages(d, devices, resolver, roles, []);
  const host = (targets: typeof original, name: string) =>
    pinPoints(withPlacements(withoutPorts, targets), resolver).find(
      (p) => p.instanceId === "a" && p.pinName === name,
    )!.point.x;
  expect(host(original, "D")).toBeGreaterThan(host(original, "G"));
  expect(host(directed, "D")).toBeLessThan(host(directed, "G"));
  const estimate = createPlacementEstimator(devices, resolver, roles);
  expect(estimate(directed).crossings).toBe(estimate(original).crossings);
  expect(placeStages(d, devices, resolver, roles, [])).toEqual(directed);
  d.instances = d.instances.filter((i) => i.id !== "output");
  expect(placeStages(d, devices, resolver, roles, [])).toEqual(original);
});

it("R57 treats an input reached through a series resistor as the input side", () => {
  const d = circuit(
    { a: "nmos", b: "nmos", input: "port", output: "port" },
    {
      input: ["a.D", "input.P"],
      output: ["a.G", "output.P"],
      link: ["a.S", "b.G"],
      end: ["b.D"],
    },
  );
  const devices = d.instances.filter(
    (i) => !["input", "output"].includes(i.id),
  );
  const roles = classifyNets(d, resolver);
  // R4 calls this Net `internal`, as it does when no gate is on the Net.
  roles.byNet.set("input", "internal");
  roles.byNet.set("output", "output");
  const targets = placeStages(d, devices, resolver, roles, []);
  const x = (name: string) =>
    pinPoints(
      withPlacements({ ...d, instances: devices }, targets),
      resolver,
    ).find((p) => p.instanceId === "a" && p.pinName === name)!.point.x;
  expect(x("D")).toBeLessThan(x("G"));
});

it.each(["ground", "supply"] as const)(
  "R59 attaches independent bias resistors toward %s inside their host span",
  (rail) => {
    const d = twoStages();
    for (let n = 0; n < 1; n++) {
      const id = `bias${n}`;
      d.instances.push({ id, symbolId: "resistor", placement: null });
      d.nets
        .find((n) => n.id === "input")!
        .terminals.push({ instanceId: id, pinName: "1" });
      d.nets
        .find((n) => n.id === (rail === "ground" ? "gnd" : "vdd"))!
        .terminals.push({ instanceId: id, pinName: "2" });
    }
    const { roles, groups } = stagesOf(d);
    const targets = placeStages(d, d.instances, resolver, roles, groups);
    const points = pinPoints(withPlacements(d, targets), resolver);
    const host = points.find(
      (p) => p.instanceId === "a" && p.pinName === "G",
    )!.point;
    const boxes = visibleInstanceBounds(withPlacements(d, targets), resolver);
    const hosts = boxes.filter((b) => ["a", "ra"].includes(b.id));
    const left = Math.min(...hosts.map((b) => b.bounds.x));
    const right = Math.max(...hosts.map((b) => b.bounds.x + b.bounds.width));
    for (const box of boxes.filter((b) => b.id.startsWith("bias"))) {
      expect(box.bounds.x).toBeGreaterThanOrEqual(left - d.presentation.grid);
      expect(box.bounds.x + box.bounds.width).toBeLessThanOrEqual(
        right + d.presentation.grid,
      );
      const signal = points.find(
        (p) => p.instanceId === box.id && p.pinName === "1",
      )!.point;
      const power = points.find(
        (p) => p.instanceId === box.id && p.pinName === "2",
      )!.point;
      expect(signal.x).toBe(power.x);
      expect(
        (signal.y - host.y) * (rail === "ground" ? 1 : -1),
      ).toBeGreaterThan(0);
      expect(
        (power.y - signal.y) * (rail === "ground" ? 1 : -1),
      ).toBeGreaterThan(0);
    }
    expect(
      geometryProblem(withPlacements(d, targets), resolver),
    ).toBeUndefined();
    const base = twoStages();
    const before = placeStages(base, base.instances, resolver, roles, groups);
    const span = (p: typeof targets) => {
      const boxes = visibleInstanceBounds(
        withPlacements(d, p),
        resolver,
      ).filter((b) => p.has(b.id));
      return (
        Math.max(...boxes.map((b) => b.bounds.x + b.bounds.width)) -
        Math.min(...boxes.map((b) => b.bounds.x))
      );
    };
    // Reflections can move fractional ink extents within one snapped grid cell.
    expect(span(targets)).toBeLessThanOrEqual(
      span(before) + d.presentation.grid,
    );
  },
);

it.each(["ground", "supply"] as const)(
  "R59 keeps the rail escape of each attached shunt clear toward %s",
  (rail) => {
    const d = twoStages();
    for (const id of ["c1", "c2"]) {
      d.instances.push({ id, symbolId: "capacitor", placement: null });
      d.nets
        .find((n) => n.id === "input")!
        .terminals.push({ instanceId: id, pinName: "1" });
      d.nets
        .find((n) => n.id === (rail === "ground" ? "gnd" : "vdd"))!
        .terminals.push({ instanceId: id, pinName: "2" });
    }
    const { roles, groups } = stagesOf(d);
    const targets = placeStages(d, d.instances, resolver, roles, groups);
    const placed = withPlacements(d, targets);
    const points = pinPoints(placed, resolver);
    const boxes = visibleInstanceBounds(placed, resolver);
    const direction = rail === "ground" ? 1 : -1;
    for (const id of ["c1", "c2"]) {
      const pin = points.find(
        (p) => p.instanceId === id && p.pinName === "2",
      )!.point;
      expect(
        boxes
          .filter((b) => b.id !== id)
          .some(
            ({ bounds: b }) =>
              pin.x >= b.x &&
              pin.x <= b.x + b.width &&
              (direction > 0 ? b.y + b.height > pin.y : b.y < pin.y),
          ),
      ).toBe(false);
    }
    expect(geometryProblem(placed, resolver)).toBeUndefined();
  },
);

it("R60 keeps series switches out of channel stages", () => {
  const d = withRails(
    circuit(
      { a: "ideal-switch", b: "closed-switch", m: "nmos", r: "resistor" },
      {
        input: ["a.1"],
        middle: ["a.2", "b.1", "m.D"],
        output: ["b.2", "r.1"],
        gnd: ["m.S"],
      },
    ),
  );
  const stages = stagesOf(d).stages.map((s) => s.devices.map((i) => i.id));
  for (const id of ["a", "b"])
    expect(stages.find((s) => s.includes(id))).toEqual([id]);
});

it("R60 treats a variable capacitor as a bridge between conducting stages", () => {
  const d = twoStages(true);
  d.instances.find((i) => i.id === "c")!.symbolId = "variable-capacitor";
  for (const net of d.nets)
    for (const terminal of net.terminals)
      if (terminal.instanceId === "c")
        terminal.pinName = terminal.pinName === "1" ? "P1" : "P2";
  const { stages, bridges } = stagesOf(d);
  expect(stages.map((s) => s.devices.map((i) => i.id))).toEqual([
    ["a", "ra"],
    ["b", "rb"],
  ]);
  expect(bridges.map((b) => b.device.id)).toEqual(["c"]);
});

it("R60 conducts through a diode but not through a controlled switch", () => {
  const d = circuit(
    {
      a: "externally-controlled-switch",
      p: "resistor",
      n: "diode",
      control: "variable-resistor",
    },
    {
      positive: ["a.P", "p.1"],
      negative: ["a.N", "n.A"],
      link: ["n.K", "p.2"],
      control: ["a.CTRL", "control.P1"],
    },
  );
  const stages = stagesOf(d).stages.map((s) => s.devices.map((i) => i.id));
  expect(stages).toContainEqual(["n", "p"]);
  expect(stages.find((s) => s.includes("a"))).toEqual(["a"]);
});

it("R60 joins each transformer winding without merging the isolated stages", () => {
  const d = circuit(
    {
      transformer: "xfmr",
      a: "resistor",
      b: "resistor",
      c: "resistor",
      d: "resistor",
    },
    {
      primaryMinus: ["transformer.P-", "a.1"],
      primaryPlus: ["transformer.P+", "b.1"],
      secondaryMinus: ["transformer.S-", "c.1"],
      secondaryPlus: ["transformer.S+", "d.1"],
    },
  );
  expect(stagesOf(d).stages.map((s) => s.devices.map((i) => i.id))).toEqual([
    ["a", "b", "transformer"],
    ["c", "d"],
  ]);
});

it("R55 bounds and repeats planning of a 60-instance document", () => {
  const symbols: Record<string, string> = {};
  const nets: Record<string, string[]> = {};
  for (let n = 0; n < 20; n++) {
    symbols[`m${n}`] = "nmos";
    symbols[`r${n}`] = "resistor";
    symbols[`port${n}`] = "port";
    nets[`signal${n}`] = [`m${n}.G`, `port${n}.P`];
    nets[`channel${n}`] = [`m${n}.D`, `r${n}.1`];
  }
  const d = circuit(symbols, nets);
  d.netlist = {
    name: "large",
    formalParameters: [],
    terminals: Array.from({ length: 20 }, (_, n) => ({
      id: `terminal${n}`,
      name: `input${n}`,
      netId: `signal${n}`,
      direction: "input" as const,
      interfaceInstanceIds: [`port${n}`],
    })),
  };
  const before = JSON.stringify(d);
  const plan = planAutoLayout(d, resolver);
  expect(plan.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
  const metrics = refinementMetrics(plan)!;
  expect(metrics.candidates).toBe(0);
  const repeated = planAutoLayout(d, resolver);
  expect(repeated).toEqual(plan);
  expect(refinementMetrics(repeated)).toEqual(metrics);
  expect(JSON.stringify(d)).toBe(before);
}, 30000);

it("R60 conducts through a magnetic device's shared tap without an external tap Net", () => {
  const d = circuit(
    { a: "resistor", b: "resistor", coil: "center-tap-inductor" },
    { left: ["a.1", "coil.1"], right: ["b.1", "coil.2"] },
  );
  expect(stagesOf(d).stages.map((s) => s.devices.map((i) => i.id))).toEqual([
    ["a", "b", "coil"],
  ]);
});

it("R60 attaches a secondary-side bridge to the stage that draws the transformer", () => {
  const d = circuit(
    {
      transformer: "xfmr",
      p: "resistor",
      s: "resistor",
      c: "capacitor",
      m: "nmos",
      r: "resistor",
    },
    {
      primary: ["transformer.P+", "p.1"],
      primaryReturn: ["transformer.P-", "p.2"],
      secondaryMinus: ["transformer.S-", "s.1"],
      secondaryPlus: ["transformer.S+", "c.1"],
      coupled: ["c.2", "m.G"],
      drain: ["m.D", "r.1"],
    },
  );
  const { stages, bridges, roles, groups } = stagesOf(d);
  const owner = stages.find((s) =>
    s.devices.some((i) => i.id === "transformer"),
  )!.id;
  expect(bridges.map((b) => b.device.id)).toEqual(["c"]);
  expect(bridges[0]!.owners).toContain(owner);
  const targets = placeStages(d, d.instances, resolver, roles, groups);
  for (const p of targets.values()) {
    expect(Number.isFinite(p.position.x)).toBe(true);
    expect(Number.isFinite(p.position.y)).toBe(true);
  }
});
