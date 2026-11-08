import { expect, it } from "vitest";
import { executeTransaction } from "@icm/edit-engine";
import { builtInSymbols, InMemorySymbolResolver } from "@icm/symbols";
import { planAutoLayout } from "../src/auto-layout.js";
import {
  geometryProblem,
  pinPoints,
  placement,
  withPlacements,
} from "../src/geometry.js";
import { classifyNets } from "../src/net-roles.js";
import { placeDocument } from "../src/place.js";
import { emptyChoices, emptyOverrides } from "../src/layout-choices.js";
import { placeMarkers } from "../src/place-markers.js";
import { createMoveGenerator, randomStream } from "../src/search-moves.js";
import {
  parallelAttachments,
  placeParallelAttachments,
  driverAttachments,
  placeDriverAttachments,
} from "../src/stages.js";
import { terminalPartition, lostNameClaim } from "../src/transaction.js";
import type { Placement } from "../src/types.js";
import { circuit } from "./document-fixture.js";

const resolver = new InMemorySymbolResolver(builtInSymbols);
const parallel = () =>
  circuit(
    { mos: "nmos", diode: "diode", other: "resistor" },
    {
      drain: ["mos.D", "diode.K"],
      source: ["mos.S", "diode.A"],
      gate: ["mos.G"],
      independent: ["other.1"],
      end: ["other.2"],
    },
  );
const driver = () => {
  const d = circuit(
    { driver: "nmos", host: "nmos", groundMarker: "ground", inputPort: "port" },
    {
      gnd: ["driver.S", "host.S", "groundMarker.0"],
      drive: ["driver.D", "host.G"],
      input: ["inputPort.P", "driver.G"],
      out: ["host.D"],
    },
  );
  d.netlist = {
    name: "test",
    formalParameters: [],
    terminals: [
      {
        id: "input-terminal",
        name: "input",
        netId: "input",
        direction: "input",
        interfaceInstanceIds: ["inputPort"],
      },
    ],
  };
  return d;
};

function pins(
  d: ReturnType<typeof circuit>,
  placements: Map<string, Placement>,
) {
  return (id: string, name: string) =>
    pinPoints(withPlacements(d, placements), resolver).find(
      (p) => p.instanceId === id && p.pinName === name,
    )!.point;
}

it.each(["template", "layered", "stages"] as const)(
  "R69 keeps parallel pins level beside their MOS in %s",
  (strategy) => {
    const d = parallel(),
      roles = classifyNets(d, resolver);
    const result = placeDocument(
      d,
      resolver,
      roles,
      [],
      {},
      emptyOverrides(),
      emptyChoices(),
      strategy,
    );
    expect(result.problem).toBeUndefined();
    const pin = pins(d, result.placements);
    expect(pin("diode", "K").y).toBe(pin("mos", "D").y);
    expect(pin("diode", "A").y).toBe(pin("mos", "S").y);
    expect(pin("diode", "A").x).toBeGreaterThan(pin("mos", "D").x);
    expect(pin("diode", "A").x - pin("mos", "D").x).toBeLessThanOrEqual(100);
  },
);

it("R69 breaks multiple-host ties by id and uses device descriptors", () => {
  const d = circuit(
    { z: "nmos", a: "ndmos", c: "capacitor" },
    {
      d: ["z.D", "a.D", "c.1"],
      s: ["z.S", "a.S", "c.2"],
      g: ["z.G"],
      h: ["a.G"],
    },
  );
  expect(
    parallelAttachments(d.instances, resolver, classifyNets(d, resolver)).map(
      (a) => [a.device.id, a.host.id],
    ),
  ).toEqual([["c", "a"]]);
});

it.each(["template", "layered", "stages"] as const)(
  "R70 places a one-MOS driver beside its receiver in %s",
  (strategy) => {
    const d = driver(),
      roles = classifyNets(d, resolver);
    const result = placeDocument(
      d,
      resolver,
      roles,
      [],
      {},
      emptyOverrides(),
      emptyChoices(),
      strategy,
    );
    expect(result.problem).toBeUndefined();
    const pin = pins(d, result.placements);
    expect(pin("driver", "D").y).toBe(pin("host", "G").y);
    expect(pin("driver", "D").x).toBeLessThan(pin("host", "G").x);
    expect(pin("host", "G").x - pin("driver", "D").x).toBeLessThanOrEqual(100);
  },
);

it("R70 leaves a blocked driver untouched and rejects multiple receivers", () => {
  const d = driver();
  const roles = classifyNets(d, resolver);
  d.instances = d.instances.filter((i) => ["driver", "host"].includes(i.id));
  const targets = new Map([
    ["driver", placement(-400, 200)],
    ["host", placement(0, 0)],
  ]);
  const blocker = {
    id: "block",
    symbolId: "resistor",
    placement: placement(-100, -20),
  };
  d.instances.push(blocker);
  targets.set("block", blocker.placement);
  const before = structuredClone(targets);
  placeDriverAttachments(d, resolver, roles, [], targets, new Set());
  expect(targets).toEqual(before);
  const multiple = driver();
  multiple.instances.push({ id: "extra", symbolId: "nmos", placement: null });
  multiple.nets
    .find((n) => n.id === "drive")!
    .terminals.push({ instanceId: "extra", pinName: "G" });
  expect(
    driverAttachments(
      multiple.instances.filter((i) =>
        ["driver", "host", "extra"].includes(i.id),
      ),
      resolver,
      classifyNets(multiple, resolver),
      [],
    ),
  ).toEqual([]);
});

it.each([false, true])(
  "R71 places a single-gate port locally, or at the edge when blocked=%s",
  (blocked) => {
    const d = circuit(
      { host: "nmos", other: "resistor", input: "port" },
      { g: ["host.G", "input.P"] },
    );
    const targets = new Map([
      ["host", placement(400, 0)],
      ["other", placement(blocked ? 300 : 0, 0)],
    ]);
    placeMarkers(
      d,
      resolver,
      classifyNets(d, resolver),
      targets,
      emptyOverrides(),
      emptyChoices(),
    );
    const pin = pins(d, targets),
      host = pin("host", "G"),
      port = pin("input", "P");
    if (blocked) expect(port.x).toBeGreaterThan(host.x + 80);
    else expect(port).toEqual({ x: host.x - 80, y: host.y });
    expect(targets.get("input")!.rotation).toBe(0);
    expect(
      geometryProblem(withPlacements(d, targets), resolver),
    ).toBeUndefined();
  },
);

it.each(["template", "layered", "stages"] as const)(
  "R66 never splits a parallel unit in %s",
  (strategy) => {
    const d = parallel(),
      roles = classifyNets(d, resolver);
    const placed = placeDocument(
      d,
      resolver,
      roles,
      [],
      {},
      emptyOverrides(),
      emptyChoices(),
      strategy,
    );
    expect(placed.problem).toBeUndefined();
    let state = { placements: placed.placements, sides: new Map(), strategy };
    const move = createMoveGenerator(d, resolver, new Set(), randomStream(1));
    const offset = () => {
      const a = state.placements.get("diode")!,
        b = state.placements.get("mos")!;
      return {
        x: a.position.x - b.position.x,
        y: a.position.y - b.position.y,
        rotation: a.rotation,
        mirror: a.mirror,
      };
    };
    const initial = offset();
    let accepted = 0;
    for (let i = 0; i < 200; i++) {
      const next = move(state);
      if (next) {
        state = next;
        accepted++;
        expect(offset()).toEqual(initial);
      }
    }
    expect(accepted).toBeGreaterThan(5);
  },
);

it("R68–R71 stay deterministic and replay as a connectivity-preserving transaction", () => {
  const d = driver(),
    snapshot = JSON.stringify(d),
    plan = planAutoLayout(d, resolver);
  expect(planAutoLayout(d, resolver)).toEqual(plan);
  expect(JSON.stringify(d)).toBe(snapshot);
  expect(plan.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
  const result = executeTransaction(
    d,
    {
      transactionId: "attachments",
      documentId: d.id,
      expectedRevision: d.revision,
      actor: { kind: "agent", id: "test" },
      edits: plan.edits,
    },
    { symbolResolver: resolver },
  );
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error("Transaction rejected");
  expect(terminalPartition(result.document, resolver)).toBe(
    terminalPartition(d, resolver),
  );
  expect(lostNameClaim(d, result.document)).toBeUndefined();
});

it.each([0, 90, 180, 270] as const)(
  "R71 follows a rotated pin's exit direction (%s degrees)",
  (rotation) => {
    const d = circuit(
      { host: "nmos", input: "port" },
      { g: ["host.G", "input.P"] },
    );
    const targets = new Map([["host", placement(0, 0, "none", rotation)]]);
    placeMarkers(
      d,
      resolver,
      classifyNets(d, resolver),
      targets,
      emptyOverrides(),
      emptyChoices(),
    );
    const point = pins(d, targets),
      gate = point("host", "G"),
      port = point("input", "P");
    const delta = [
      { x: -80, y: 0 },
      { x: 0, y: -80 },
      { x: 80, y: 0 },
      { x: 0, y: 80 },
    ][rotation / 90]!;
    expect(port).toEqual({ x: gate.x + delta.x, y: gate.y + delta.y });
    expect(
      geometryProblem(withPlacements(d, targets), resolver),
    ).toBeUndefined();
  },
);

it("R69 seats a free attachment beside a fixed host without moving it", () => {
  const d = parallel();
  d.instances = d.instances.filter((i) => i.id !== "other");
  const host = placement(200, 100),
    targets = new Map([
      ["mos", structuredClone(host)],
      ["diode", placement(-200, 0)],
    ]);
  placeParallelAttachments(
    d,
    resolver,
    classifyNets(d, resolver),
    targets,
    new Set(["mos"]),
  );
  const pin = pins(d, targets);
  expect(targets.get("mos")).toEqual(host);
  expect(pin("diode", "K").y).toBe(pin("mos", "D").y);
  expect(pin("diode", "A").y).toBe(pin("mos", "S").y);
});

it("R70 accepts a two-terminal source stage without a conducting-pair descriptor", () => {
  const d = circuit(
    { source: "current-source", host: "nmos", groundMarker: "ground" },
    {
      drive: ["source.+", "host.G"],
      groundNet: ["source.-", "host.S", "groundMarker.0"],
      drain: ["host.D"],
    },
  );
  const roles = classifyNets(d, resolver);
  const result = placeDocument(
    d,
    resolver,
    roles,
    [],
    {},
    emptyOverrides(),
    emptyChoices(),
    "stages",
  );
  expect(result.problem).toBeUndefined();
  const point = pins(d, result.placements);
  expect(point("source", "+").y).toBe(point("host", "G").y);
  expect(point("source", "+").x).toBeLessThan(point("host", "G").x);
});

it("R69 never attaches a device to a MOS whose drain and source share a Net", () => {
  const d = circuit(
    { short: "nmos", real: "nmos", r: "resistor" },
    {
      shared: ["short.D", "short.S", "real.D", "r.1"],
      other: ["real.S", "r.2"],
      gs: ["short.G"],
      gr: ["real.G"],
    },
  );
  const attached = parallelAttachments(
    d.instances,
    resolver,
    classifyNets(d, resolver),
  ).map((a) => [a.device.id, a.host.id]);
  expect(attached).toEqual([["r", "real"]]);
  // Without the genuine host, the shorted MOS must not claim the resistor.
  const alone = circuit(
    { short: "nmos", r: "resistor" },
    { shared: ["short.D", "short.S", "r.1"], other: ["r.2"], gs: ["short.G"] },
  );
  expect(
    parallelAttachments(
      alone.instances,
      resolver,
      classifyNets(alone, resolver),
    ),
  ).toEqual([]);
});
