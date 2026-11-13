import { expect, it, vi } from "vitest";
import { diagnoseLabelClearance, diagnoseVisualQuality } from "@icm/derived";
import { builtInSymbols, InMemorySymbolResolver } from "@icm/symbols";
import { planLayoutOnce } from "../src/auto-layout.js";
import { placement } from "../src/geometry.js";
import { emptyChoices, emptyOverrides } from "../src/layout-choices.js";
import { classifyNets } from "../src/net-roles.js";
import { placeDocument } from "../src/place.js";
import { repairStubLabels } from "../src/stub-seat.js";
import {
  compactionRegresses,
  routedGuards,
} from "../src/routed-search-score.js";
import { circuit } from "./document-fixture.js";

const resolver = new InMemorySymbolResolver(builtInSymbols);

it.each([40, 41])(
  "uses the original %i-instance size class for column placement",
  (count) => {
    const document = circuit(
      Object.fromEntries(
        Array.from({ length: count }, (_, i) => [
          `r${String(i).padStart(2, "0")}`,
          "resistor",
        ]),
      ),
      {},
    );
    const roles = classifyNets(document, resolver);
    // The actual stage has only two devices, but inherits the original size.
    const stage = { ...document, instances: document.instances.slice(0, 2) };
    const place = () =>
      placeDocument(
        stage,
        resolver,
        roles,
        [],
        {},
        emptyOverrides(),
        undefined,
        "layered",
      );
    const result = place();
    expect(result.problem).toBeUndefined();
    expect(
      result.placements.get("r01")!.position.x -
        result.placements.get("r00")!.position.x,
    ).toBe(count <= 40 ? 120 : 160);
    expect(place()).toEqual(result);
  },
);

it.each([
  "VISUAL_LABEL_CLEARANCE",
  "VISUAL_LABEL_RUN_ON",
  "VISUAL_LABEL_OVERLAP",
])("opens local pitch for %s with guarded deterministic routing", (code) => {
  const document = circuit({ a: "resistor", b: "resistor" }, {});
  document.instances[0]!.placement = placement(0, 0);
  document.instances[1]!.placement = placement(80, 0);
  document.annotations = [
    {
      id: "name",
      kind: "instance-label",
      content: { runs: [{ kind: "text", value: "crowded" }] },
      anchor: {
        kind: "object",
        objectId: "a",
        localOffset: { x: 50, y: 0 },
        fallbackPosition: { x: 50, y: 0 },
      },
      alignment: "start",
      rotation: 0,
      locked: true,
    },
  ];
  if (code !== "VISUAL_LABEL_CLEARANCE") {
    document.annotations = ["a", "b"].map((id, index) => ({
      id: `name-${id}`,
      kind: "instance-label",
      content: { runs: [{ kind: "text", value: "H" }] },
      anchor: {
        kind: "object",
        objectId: id,
        localOffset: {
          x: index ? (code === "VISUAL_LABEL_OVERLAP" ? -28 : -20) : 50,
          y: 50,
        },
        fallbackPosition: { x: 0, y: 0 },
      },
      alignment: "start",
      rotation: 0,
      locked: true,
    }));
  }
  const run = (placements: ReadonlyMap<string, ReturnType<typeof placement>>) =>
    planLayoutOnce(
      document,
      resolver,
      {},
      emptyOverrides(),
      "template",
      true,
      undefined,
      undefined,
      placements,
    );
  const initial = run(
    new Map(document.instances.map((i) => [i.id, i.placement!])),
  );
  expect(initial.final).toBeDefined();
  const problems = (d: typeof document) =>
    [
      ...diagnoseLabelClearance(d, resolver),
      ...diagnoseVisualQuality(d, resolver),
    ].filter((d) =>
      [
        "VISUAL_LABEL_CLEARANCE",
        "VISUAL_LABEL_RUN_ON",
        "VISUAL_LABEL_OVERLAP",
      ].includes(d.code),
    );
  expect(problems(initial.final!).map((d) => d.code)).toContain(code);
  const replan = vi.fn(run);
  const repaired = repairStubLabels(
    initial,
    resolver,
    new Set(),
    replan,
    () => false,
  );
  expect(problems(repaired.final!)).toEqual([]);
  expect(replan.mock.calls.length).toBeLessThanOrEqual(12);
  const limits = routedGuards(initial.final!, resolver);
  for (const [key, count] of Object.entries(
    routedGuards(repaired.final!, resolver),
  ))
    expect(count).toBeLessThanOrEqual(limits[key] ?? 0);
  expect(compactionRegresses(initial, repaired, resolver, true)).toBe(false);
  expect(
    repairStubLabels(initial, resolver, new Set(), run, () => false),
  ).toEqual(repaired);
  expect(
    repairStubLabels(initial, resolver, new Set(["a", "b"]), run, () => false),
  ).toBe(initial);
});

it("repairs a distant owner label without rerouting or weakening guards", () => {
  const document = circuit({ a: "resistor" }, {});
  document.instances[0]!.placement = placement(0, 0);
  document.annotations = [
    {
      id: "name",
      kind: "instance-label",
      content: { runs: [{ kind: "text", value: "R" }] },
      anchor: {
        kind: "object",
        objectId: "a",
        localOffset: { x: 150, y: 0 },
        fallbackPosition: { x: 150, y: 0 },
      },
      alignment: "start",
      rotation: 0,
      locked: false,
    },
  ];
  const initial = {
    final: document,
    result: { edits: [], diagnostics: [], groups: [] },
    choices: emptyChoices(),
  };
  const replan = vi.fn(() => initial);
  const repaired = repairStubLabels(
    initial,
    resolver,
    new Set(),
    replan,
    () => false,
  );
  expect(
    diagnoseLabelClearance(document, resolver).map((d) => d.code),
  ).toContain("VISUAL_LABEL_OWNER_DISTANCE");
  expect(diagnoseLabelClearance(repaired.final!, resolver)).toEqual([]);
  expect(replan).not.toHaveBeenCalled();
  expect(repaired.result.edits).toHaveLength(1);
  expect(
    repairStubLabels(initial, resolver, new Set(["a"]), replan, () => false),
  ).toBe(initial);
  // An unconnected port elsewhere has no generated seat; it must not veto
  // a repair that does not move it (codex review P2 on PR 63).
  const withPort = structuredClone(document);
  withPort.instances.push({
    id: "far",
    symbolId: "port",
    placement: placement(0, 300),
  });
  withPort.nets.push({
    id: "farNet",
    terminals: [{ instanceId: "far", pinName: "P" }],
  });
  withPort.netlist = {
    name: "test",
    formalParameters: [],
    terminals: [
      {
        id: "farTerminal",
        name: "FAR",
        netId: "farNet",
        direction: "passive",
        interfaceInstanceIds: ["far"],
      },
    ],
  };
  expect(
    diagnoseLabelClearance(withPort, resolver).map((d) => d.code),
  ).toContain("VISUAL_LABEL_OWNER_DISTANCE");
  const portInitial = { ...initial, final: withPort };
  const portRepaired = repairStubLabels(
    portInitial,
    resolver,
    new Set(),
    vi.fn(() => portInitial),
    () => false,
  );
  expect(portRepaired.result.edits).toHaveLength(1);
});

it("repairs a sideways marker departure by seating it on the host exit", () => {
  const document = circuit(
    { c: "capacitor", g: "ground" },
    { ground: ["c.2", "g.0"] },
  );
  document.instances[0]!.placement = placement(0, 0);
  document.instances[1]!.placement = placement(100, 30);
  const run = (placements: ReadonlyMap<string, ReturnType<typeof placement>>) =>
    planLayoutOnce(
      document,
      resolver,
      {},
      emptyOverrides(),
      "template",
      true,
      undefined,
      undefined,
      placements,
    );
  const initial = run(
    new Map(document.instances.map((i) => [i.id, i.placement!])),
  );
  expect(initial.result.diagnostics).toEqual([]);
  expect(
    diagnoseVisualQuality(initial.final!, resolver).map((d) => d.code),
  ).toContain("VISUAL_TERMINAL_DEPARTURE");
  const repaired = repairStubLabels(
    initial,
    resolver,
    new Set(),
    run,
    () => false,
  );
  expect(
    diagnoseVisualQuality(repaired.final!, resolver).map((d) => d.code),
  ).not.toContain("VISUAL_TERMINAL_DEPARTURE");
  expect(compactionRegresses(initial, repaired, resolver, true)).toBe(false);
  const limits = routedGuards(initial.final!, resolver);
  for (const [key, count] of Object.entries(
    routedGuards(repaired.final!, resolver),
  ))
    expect(count).toBeLessThanOrEqual(limits[key] ?? 0);
});

it("retries pitch only when a foreign pin or symbol obstructs a failed connection", async () => {
  const { pitchBlocked } = await import("../src/pitch-fallback.js");
  const document = circuit(
    { a: "resistor", b: "resistor", c: "resistor" },
    { signal: ["a.1", "b.1"] },
  );
  document.instances[0]!.placement = placement(0, 0);
  document.instances[1]!.placement = placement(200, 0);
  document.instances[2]!.placement = placement(100, 100);
  const result = { edits: [], groups: [], diagnostics: [] };
  expect(pitchBlocked(result, document, resolver)).toBe(false);
  document.instances[2]!.placement = placement(100, 0);
  expect(pitchBlocked(result, document, resolver)).toBe(true);
  document.instances[2]!.placement = placement(100, -30);
  expect(pitchBlocked(result, document, resolver)).toBe(true);
  expect(
    pitchBlocked(
      {
        ...result,
        diagnostics: [
          {
            severity: "error",
            code: "AUTO_LAYOUT_RULE_UNSATISFIED",
            rule: "R10",
            message: "R10: collision",
          },
        ],
      },
      document,
      resolver,
    ),
  ).toBe(true);
  document.instances[2]!.placement = placement(100, 100);
  // The router can diagnose a blocked leg even when the end pins are not
  // aligned; the leg itself need not survive as a Route in the failed plan.
  document.instances[1]!.placement = placement(200, 10);
  expect(
    pitchBlocked(
      {
        ...result,
        diagnostics: [
          {
            severity: "warning",
            code: "AUTO_LAYOUT_NET_UNROUTED",
            rule: "R14",
            message:
              "Net signal: the direct one passes over pin c.1, which is on no Net",
          },
        ],
      },
      document,
      resolver,
    ),
  ).toBe(true);
  expect(
    pitchBlocked(
      {
        ...result,
        diagnostics: [
          {
            severity: "error",
            code: "AUTO_LAYOUT_RULE_UNSATISFIED",
            rule: "R2",
            message: "R2: locked route",
          },
        ],
      },
      document,
      resolver,
    ),
  ).toBe(false);
});
