import { expect, it, vi } from "vitest";
import { builtInSymbols, InMemorySymbolResolver } from "@icm/symbols";
import {
  nodeAttachments,
  seatNodeAttachments,
} from "../src/attachment-seat.js";
import * as attachments from "../src/attachment-seat.js";
import * as selection from "../src/finished-selection.js";
import { planAutoLayout } from "../src/auto-layout.js";
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
import { preview } from "../src/transaction.js";
import {
  readabilityMetrics,
  readabilityScore,
} from "../src/readability-metrics.js";
import { circuit } from "./document-fixture.js";

const resolver = new InMemorySymbolResolver(builtInSymbols);
function fixture(kind = "capacitor") {
  const d = circuit(
    { host: "nmos", part: kind, load: "resistor" },
    {
      gate: ["host.G", "part.1"],
      drain: ["host.D", "load.2"],
      ground: ["host.S", "part.2"],
      supply: ["load.1"],
    },
  );
  for (const net of ["ground", "supply"])
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
        name: net === "supply" ? "VDD" : "GND",
        scope: "global",
        powerDomain: net === "supply" ? "vdd" : "ground",
        owner: { kind: "global-declaration", sourceNetId: net },
      },
    );
  const targets = new Map([
    ["host", placement(200, 200)],
    ["part", placement(440, 200)],
    ["load", placement(210, 100)],
  ]);
  return { d, targets, roles: classifyNets(d, resolver) };
}

it.each(["capacitor", "resistor"])(
  "seats a distant %s at its node with fewer routed crossings",
  (kind) => {
    const { d, targets, roles } = fixture(kind);
    const route = (p: typeof targets) => {
      const r = routeDocument(
        withPlacements(d, p),
        resolver,
        freezePinGroups(d, resolver),
        roles,
        [],
      );
      expect(r.problem).toBeUndefined();
      expect(missingConnections(r.document, resolver)).toBe(0);
      expect(auditRouting(r.document, resolver).unsafeProblems).toEqual([]);
      return auditRouting(r.document, resolver).crossings;
    };
    const old = structuredClone(targets);
    const before = route(targets);
    seatNodeAttachments(d, resolver, roles, targets, new Set(["load"]));
    expect(route(targets)).toBeLessThan(before);
    expect(targets.get("host")).toEqual(old.get("host"));
    expect(targets.get("load")).toEqual(old.get("load"));
    expect(targets.get("part")!.position.x).toBeLessThan(200);
    const pins = pinPoints(withPlacements(d, targets), resolver);
    const p = (id: string, name: string) =>
      pins.find((p) => p.instanceId === id && p.pinName === name)!.point;
    expect(p("part", "1").y).toBe(p("host", "G").y);
    expect(p("part", "2").y).toBeGreaterThan(p("part", "1").y);
    expect(
      geometryProblem(withPlacements(d, targets), resolver),
    ).toBeUndefined();
    seatNodeAttachments(d, resolver, roles, old, new Set(["load"]));
    expect(targets).toEqual(old);
  },
);

it("places a bridge between the two nodes of one host", () => {
  const d = circuit(
    { host: "nmos", part: "capacitor" },
    {
      drain: ["host.D", "part.1"],
      source: ["host.S", "part.2"],
      gate: ["host.G"],
    },
  );
  const targets = new Map([
    ["host", placement(200, 200)],
    ["part", placement(600, 500)],
  ]);
  seatNodeAttachments(
    d,
    resolver,
    classifyNets(d, resolver),
    targets,
    new Set(),
  );
  const points = pinPoints(withPlacements(d, targets), resolver);
  const at = (id: string, pin: string) =>
    points.find((p) => p.instanceId === id && p.pinName === pin)!.point;
  expect(at("part", "1").y).toBe(at("host", "D").y);
  expect(at("part", "2").y).toBe(at("host", "S").y);
  expect(at("part", "1").x).toBeGreaterThan(at("host", "D").x);
  expect(geometryProblem(withPlacements(d, targets), resolver)).toBeUndefined();
});

it("does not recognize a part joining two unrelated hosts", () => {
  const d = circuit(
    { a: "nmos", b: "nmos", part: "capacitor" },
    {
      first: ["a.G", "part.1"],
      second: ["b.G", "part.2"],
      drainA: ["a.D"],
      drainB: ["b.D"],
      sourceA: ["a.S"],
      sourceB: ["b.S"],
    },
  );
  expect(
    nodeAttachments(d, resolver, classifyNets(d, resolver)).filter(
      (a) => a.device.id === "part",
    ),
  ).toEqual([]);
});

it("keeps protected parts and gives up when every local seat is blocked", () => {
  const { d, targets, roles } = fixture();
  const old = structuredClone(targets);
  seatNodeAttachments(d, resolver, roles, targets, new Set(["part", "load"]));
  expect(targets).toEqual(old);
  const obstacles = structuredClone(d);
  for (let x = 0; x <= 160; x += 20) {
    const id = `block-${x}`;
    obstacles.instances.push({
      id,
      symbolId: "resistor",
      placement: placement(x, 220),
    });
  }
  seatNodeAttachments(
    d,
    resolver,
    roles,
    targets,
    new Set(["load"]),
    obstacles,
  );
  expect(targets).toEqual(old);
});

it.each(["fixed", "template", "group", "symmetry"])(
  "preserves %s members in the placement pipeline",
  (protection) => {
    const { d, targets, roles } = fixture();
    for (const i of d.instances) i.placement = targets.get(i.id)!;
    if (protection === "group")
      d.layoutGroups.push({
        id: "keep",
        kind: "matched-pair",
        objectIds: ["part", "load"],
        locked: false,
      });
    const groups =
      protection === "template"
        ? [
            {
              id: "template",
              kind: "matched-pair" as const,
              members: ["part", "load"] as [string, string],
            },
          ]
        : [];
    const options =
      protection === "fixed"
        ? { fixedInstanceIds: new Set(["part", "load"]) }
        : {};
    if (protection === "symmetry") {
      // An explicit symmetry constraint also protects its members.
      d.constraints.push({
        id: "symmetry",
        kind: "symmetric",
        objectIds: ["part", "load"],
        locked: false,
      });
    }
    const place = (variant: boolean) =>
      placeDocument(
        d,
        resolver,
        roles,
        groups,
        options,
        undefined,
        undefined,
        "template",
        undefined,
        undefined,
        undefined,
        false,
        variant,
      );
    const base = place(false),
      next = place(true);
    expect(next.problem).toBeUndefined();
    expect(next.placements.get("part")).toEqual(base.placements.get("part"));
    expect(next.placements.get("load")).toEqual(base.placements.get("load"));
  },
);

it("rejects a worse finished attachment finalist and repeats deterministically", () => {
  const { d } = fixture();
  const recognition = vi
    .spyOn(attachments, "nodeAttachments")
    .mockReturnValue([]);
  const base = planAutoLayout(d, resolver);
  recognition.mockRestore();
  const select = vi.spyOn(selection, "selectFinishedLayout");
  try {
    const result = planAutoLayout(d, resolver);
    expect(select).toHaveBeenCalled();
    const score = (p: typeof result) => {
      const applied = preview(d, resolver, p.edits);
      expect(applied.ok).toBe(true);
      if (!applied.ok) throw Error("invalid plan");
      return readabilityScore(
        readabilityMetrics(applied.document, resolver, "weighted"),
      );
    };
    expect(select).toHaveBeenCalledTimes(1);
    const [, , incumbent, candidate] = select.mock.calls[0]!;
    expect(candidate.edits).not.toEqual(incumbent.edits);
    expect(score(candidate)).toBeGreaterThan(score(incumbent));
    expect(select.mock.results[0]!.value).toBe(incumbent);
    expect(result).toEqual(base);
    expect(score(result)).toBeLessThanOrEqual(score(base));
    expect(planAutoLayout(d, resolver)).toEqual(result);
  } finally {
    select.mockRestore();
  }
});

it("recognizes a diode-connected single-BJT stage from connectivity", () => {
  const { d, targets } = fixture();
  d.instances.find((i) => i.id === "part")!.symbolId = "npn";
  d.nets.find((n) => n.id === "gate")!.terminals = [
    { instanceId: "host", pinName: "G" },
    { instanceId: "part", pinName: "C" },
    { instanceId: "part", pinName: "B" },
  ];
  d.nets.find((n) => n.id === "ground")!.terminals = [
    { instanceId: "host", pinName: "S" },
    { instanceId: "part", pinName: "E" },
  ];
  const roles = classifyNets(d, resolver);
  const recognized = nodeAttachments(d, resolver, roles);
  expect(recognized.find((a) => a.device.id === "part")?.host.id).toBe("host");
  seatNodeAttachments(d, resolver, roles, targets, new Set(["load"]));
  expect(targets.get("part")!.position.x).toBeLessThan(200);
  expect(geometryProblem(withPlacements(d, targets), resolver)).toBeUndefined();
});

it("preserves automatically recognized symmetric attachments", () => {
  const d = circuit(
    {
      a: "nmos",
      b: "nmos",
      ca: "capacitor",
      cb: "capacitor",
      tail: "current-source",
      g: "ground",
    },
    {
      left: ["a.D", "ca.1"],
      right: ["b.D", "cb.1"],
      inA: ["a.G"],
      inB: ["b.G"],
      source: ["a.S", "b.S", "tail.+"],
      ground: ["ca.2", "cb.2", "tail.-", "g.0"],
    },
  );
  const roles = classifyNets(d, resolver);
  const place = (variant: boolean) =>
    placeDocument(
      d,
      resolver,
      roles,
      [],
      {},
      undefined,
      undefined,
      "template",
      undefined,
      undefined,
      undefined,
      false,
      variant,
    );
  const base = place(false),
    next = place(true);
  expect(next.problem).toBeUndefined();
  expect(next.placements).toEqual(base.placements);
});
