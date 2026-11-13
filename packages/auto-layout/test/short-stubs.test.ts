import { expect, it, vi } from "vitest";
import { diagnoseLabelClearance } from "@icm/derived";
import { type SchematicDocument } from "@icm/model";
import { builtInSymbols, InMemorySymbolResolver } from "@icm/symbols";
import { planAutoLayout, planLayoutOnce } from "../src/auto-layout.js";
import {
  contactGeometryProblem,
  contactPolicy,
} from "../src/contact-placement.js";
import {
  geometryProblem,
  pinPoints,
  placement,
  withPlacements,
} from "../src/geometry.js";
import { emptyChoices, emptyOverrides } from "../src/layout-choices.js";
import { classifyNets } from "../src/net-roles.js";
import { freezePinGroups } from "../src/route.js";
import { placeMarkers } from "../src/place-markers.js";
import { auditRouting, missingConnections } from "../src/routing-audit.js";
import { preview, terminalPartition } from "../src/transaction.js";
import { repairStubLabels } from "../src/stub-seat.js";
import { calibratedScore } from "../src/routed-search-score.js";
import { circuit } from "./document-fixture.js";

const resolver = new InMemorySymbolResolver(builtInSymbols);
function fixture(symbol: string) {
  const port = symbol.startsWith("port");
  const d = circuit(
    { host: "nmos", marker: symbol },
    {
      net: [
        `host.${port ? "G" : symbol === "ground" ? "S" : "D"}`,
        `marker.${symbol === "ground" ? "0" : "P"}`,
      ],
    },
  );
  d.instances[0]!.placement = placement(0, 0);
  d.instances[1]!.placement = placement(-200, 200);
  if (port)
    d.netlist = {
      name: "test",
      formalParameters: [],
      terminals: [
        {
          id: "input",
          name: "input",
          netId: "net",
          direction: "input",
          interfaceInstanceIds: ["marker"],
        },
      ],
    };
  return d;
}
function seats(d: SchematicDocument, fixed = new Set<string>()) {
  const targets = new Map(
    d.instances.map((i) => [i.id, structuredClone(i.placement!)]),
  );
  placeMarkers(
    d,
    resolver,
    classifyNets(d, resolver),
    targets,
    emptyOverrides(),
    emptyChoices(),
    fixed,
  );
  return withPlacements(d, targets);
}
function distance(d: SchematicDocument) {
  const terminals = d.nets[0]!.terminals;
  const points = terminals.map(
    (t) =>
      pinPoints(d, resolver).find(
        (p) => p.instanceId === t.instanceId && p.pinName === t.pinName,
      )!.point,
  );
  return (
    Math.abs(points[0]!.x - points[1]!.x) +
    Math.abs(points[0]!.y - points[1]!.y)
  );
}

it("shortens a multiple-host port at its existing edge without moving devices", () => {
  const d = fixture("port");
  d.instances.push({
    id: "peer",
    symbolId: "nmos",
    placement: placement(120, 0),
  });
  d.nets[0]!.terminals.push({ instanceId: "peer", pinName: "G" });
  const result = seats(d);
  expect(result.instances.find((i) => i.id === "marker")!.placement).toEqual(
    placement(-60, 0),
  );
  expect(result.instances.filter((i) => i.id !== "marker")).toEqual(
    d.instances.filter((i) => i.id !== "marker"),
  );
});

it.each(["ground", "vdd-port", "port", "port-filled"])(
  "chooses a short clear %s seat deterministically without changing the input",
  (symbol) => {
    const d = fixture(symbol),
      before = structuredClone(d);
    const result = seats(d);
    expect(distance(result)).toBe(symbol.startsWith("port") ? 40 : 20);
    expect(geometryProblem(result, resolver)).toBeUndefined();
    expect(seats(d)).toEqual(result);
    expect(d).toEqual(before);
  },
);

it.each(["ground", "port"])(
  "repairs a finished %s label conflict with a longer stub",
  (symbol) => {
    const d = fixture(symbol);
    const port = symbol === "port";
    d.annotations = [0].map((index) => ({
      id: `label-${index}`,
      kind: port ? "net-label" : "instance-label",
      ...(port ? { netId: "net" } : {}),
      content: { runs: [{ kind: "text", value: "H" }] },
      anchor: {
        kind: "object",
        objectId: port ? "marker" : "host",
        localOffset: port ? { x: 30, y: -20 + index } : { x: -6, y: 44 },
        fallbackPosition: { x: 0, y: 0 },
      },
      alignment: "start",
      rotation: 0,
      locked: true,
    }));
    const short = seats(d);
    const fixed = new Set(["host"]);
    const run = (
      placements: ReadonlyMap<string, ReturnType<typeof placement>>,
    ) =>
      planLayoutOnce(
        d,
        resolver,
        { fixedInstanceIds: fixed },
        emptyOverrides(),
        "template",
        true,
        undefined,
        undefined,
        placements,
      );
    const initial = run(
      new Map(short.instances.map((i) => [i.id, i.placement!])),
    );
    expect(initial.final).toBeDefined();
    expect(
      diagnoseLabelClearance(initial.final!, resolver).length,
    ).toBeGreaterThan(0);
    const repaired = repairStubLabels(
      initial,
      resolver,
      fixed,
      run,
      () => false,
    );
    expect(distance(repaired.final!)).toBe(port ? 80 : 40);
    expect(diagnoseLabelClearance(repaired.final!, resolver)).toEqual([]);
    expect(terminalPartition(repaired.final!, resolver)).toBe(
      terminalPartition(d, resolver),
    );
    expect(missingConnections(repaired.final!, resolver)).toBe(0);
    expect(auditRouting(repaired.final!, resolver).unsafeProblems).toEqual([]);
    if (port)
      expect(calibratedScore(repaired, resolver)).toBeGreaterThan(
        calibratedScore(initial, resolver),
      );
    expect(
      repairStubLabels(initial, resolver, fixed, run, () => false),
    ).toEqual(repaired);
    expect(
      repairStubLabels(
        initial,
        resolver,
        new Set(["host", "marker"]),
        run,
        () => false,
      ),
    ).toBe(initial);
    expect(
      repairStubLabels(
        initial,
        resolver,
        fixed,
        () => initial,
        () => false,
      ),
    ).toBe(initial);
    expect(repairStubLabels(initial, resolver, fixed, run, () => true)).toBe(
      initial,
    );
    // Finishing can expose a replay even when R10 refused its plan.
    expect(
      repairStubLabels(
        initial,
        resolver,
        fixed,
        () => ({
          ...repaired,
          result: {
            ...repaired.result,
            diagnostics: [
              {
                severity: "error",
                code: "AUTO_LAYOUT_RULE_UNSATISFIED",
                rule: "R10",
                message: "Refused replay",
              },
            ],
          },
        }),
        () => false,
      ),
    ).toBe(initial);
  },
);

it.each(["ground", "port"])(
  "preserves a locked %s and electrical connectivity through public planning",
  (symbol) => {
    const d = fixture(symbol);
    d.layoutGroups.push({
      id: "locked",
      kind: "custom",
      objectIds: ["marker"],
      locked: true,
    });
    const plan = planAutoLayout(d, resolver);
    expect(plan.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
    const result = preview(d, resolver, plan.edits);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(
      result.document.instances.find((i) => i.id === "marker")!.placement,
    ).toEqual(d.instances[1]!.placement);
    expect(terminalPartition(result.document, resolver)).toBe(
      terminalPartition(d, resolver),
    );
    expect(missingConnections(result.document, resolver)).toBe(0);
    expect(auditRouting(result.document, resolver).unsafeProblems).toEqual([]);
    expect(planAutoLayout(d, resolver)).toEqual(plan);
  },
);

it.each(["ground", "port"])(
  "only accepts a touching %s through R38",
  (symbol) => {
    const d = fixture(symbol);
    d.instances[1]!.placement =
      symbol === "ground" ? placement(10, 30) : placement(-20, 0);
    const plan = planAutoLayout(d, resolver);
    expect(plan.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
    const result = preview(d, resolver, plan.edits);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(distance(result.document)).toBe(0);
    expect(
      contactGeometryProblem(
        result.document,
        resolver,
        contactPolicy(d, freezePinGroups(d, resolver)),
      ),
    ).toBeUndefined();
    expect(terminalPartition(result.document, resolver)).toBe(
      terminalPartition(d, resolver),
    );
    expect(missingConnections(result.document, resolver)).toBe(0);
    expect(auditRouting(result.document, resolver).unsafeProblems).toEqual([]);
  },
);

it.each([40, 41])(
  "selects stub defaults at the %i-instance boundary",
  (count) => {
    for (const symbol of ["ground", "port"]) {
      const d = fixture(symbol);
      while (d.instances.length < count)
        d.instances.push({
          id: `filler-${d.instances.length}`,
          symbolId: "resistor",
          placement: placement(1000 + d.instances.length * 100, 1000),
        });
      expect(distance(seats(d))).toBe(
        (symbol === "ground" ? 20 : 40) * (count > 40 ? 2 : 1),
      );
    }
  },
);

it.each([5, 13])("bounds repair trials for %i diagnosed stubs", (count) => {
  const d = circuit({}, {});
  for (let index = 0; index < count; index++) {
    const host = `host-${index}`,
      marker = `marker-${index}`;
    d.instances.push(
      { id: host, symbolId: "nmos", placement: placement(index * 200, 0) },
      {
        id: marker,
        symbolId: "ground",
        placement: placement(index * 200 + 10, 50),
      },
    );
    d.nets.push({
      id: `net-${index}`,
      terminals: [
        { instanceId: host, pinName: "S" },
        { instanceId: marker, pinName: "0" },
      ],
    });
    d.annotations.push({
      id: `label-${index}`,
      kind: "instance-label",
      content: { runs: [{ kind: "text", value: "H" }] },
      anchor: {
        kind: "object",
        objectId: host,
        localOffset: { x: -6, y: 44 },
        fallbackPosition: { x: 0, y: 0 },
      },
      alignment: "start",
      rotation: 0,
      locked: true,
    });
  }
  const initial = planLayoutOnce(
    d,
    resolver,
    {},
    emptyOverrides(),
    "template",
    true,
    undefined,
    undefined,
    new Map(d.instances.map((i) => [i.id, i.placement!])),
  );
  expect(initial.final).toBeDefined();
  expect(diagnoseLabelClearance(initial.final!, resolver)).toHaveLength(count);
  const unchanged = vi.fn(() => initial);
  expect(
    repairStubLabels(initial, resolver, new Set(), unchanged, () => false),
  ).toBe(initial);
  expect(unchanged).toHaveBeenCalledTimes(Math.min(count, 12));
});
