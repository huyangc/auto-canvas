import { expect, it } from "vitest";
import { createRoutePath, type SchematicDocument } from "@icm/model";
import { builtInSymbols, InMemorySymbolResolver } from "@icm/symbols";
import { devicePins } from "../src/placement-connectivity.js";
import { placement } from "../src/geometry.js";
import { emptyChoices } from "../src/layout-choices.js";
import { reusePlanning } from "../src/planning-reuse.js";
import { readabilityMetrics } from "../src/readability-metrics.js";
import { readabilityTerm } from "../src/readability-selection.js";
import {
  compareRuns,
  routedScore,
  selectRoutingAlternative,
} from "../src/refine.js";
import {
  calibratedScore,
  compactionRegresses,
  routedGuards,
} from "../src/routed-search-score.js";
import { circuit } from "./document-fixture.js";

const resolver = new InMemorySymbolResolver(builtInSymbols);
function candidate(ordered: boolean) {
  const document = circuit(
    { input1: "port", input2: "port", output: "port" },
    {
      input1: ["input1.P"],
      input2: ["input2.P"],
      output: ["output.P"],
      horizontal: [],
      vertical: [],
    },
  );
  document.instances.forEach((instance, index) => {
    const input = index < 2;
    instance.placement = placement(
      (input === ordered ? -1 : 1) * 400,
      -400 + index * 100,
    );
  });
  document.netlist = {
    name: "ports",
    formalParameters: [],
    terminals: document.instances.map((instance, index) => ({
      id: instance.id,
      name: instance.id,
      netId: instance.id,
      direction: index < 2 ? "input" : "output",
      interfaceInstanceIds: [instance.id],
    })),
  };
  for (let index = 1; index <= 2; index++) {
    const port = document.instances[index - 1]!;
    const host = {
      id: `host-${index}`,
      symbolId: "nmos",
      placement: placement(0, 0),
    };
    const gate = devicePins(host, resolver).find((pin) => pin.name === "G")!;
    host.placement = placement(
      port.placement!.position.x + 100 - gate.at.x,
      port.placement!.position.y - gate.at.y,
    );
    document.instances.push(host);
    document.nets[index - 1]!.terminals.push({
      instanceId: host.id,
      pinName: "G",
    });
    document.routes.push(
      createRoutePath({
        id: `gate-${index}`,
        netId: port.id,
        start: { kind: "terminal", instanceId: port.id, pinName: "P" },
        end: { kind: "terminal", instanceId: host.id, pinName: "G" },
        bends: [],
        modes: ["manual"],
      }),
    );
  }
  // Fixed outer devices keep area identical while the interface seats change.
  document.instances.push(
    { id: "left", symbolId: "resistor", placement: placement(-700, -500) },
    { id: "right", symbolId: "resistor", placement: placement(700, -500) },
  );
  for (const [netId, points] of [
    [
      "horizontal",
      [
        { x: -100, y: 0 },
        { x: 100, y: 0 },
      ],
    ],
    [
      "vertical",
      [
        { x: ordered ? 0 : 200, y: -100 },
        { x: ordered ? 0 : 200, y: 100 },
      ],
    ],
  ] as const) {
    document.junctions.push(
      ...points.map((position, index) => ({
        id: `${netId}-${index}`,
        netId,
        position,
      })),
    );
    document.routes.push(
      createRoutePath({
        id: netId,
        netId,
        start: { kind: "junction", junctionId: `${netId}-0` },
        end: { kind: "junction", junctionId: `${netId}-1` },
        bends: [],
        modes: ["manual"],
      }),
    );
  }
  return {
    final: document,
    choices: emptyChoices(),
    result: { edits: [], diagnostics: [], groups: [] },
  };
}

it("selects one added crossing that fixes two port-order pairs, including gap compaction", () => {
  const before = candidate(false),
    after = candidate(true);
  const a = readabilityMetrics(before.final, resolver),
    b = readabilityMetrics(after.final, resolver);
  expect([a.crossings.violations, b.crossings.violations]).toEqual([0, 1]);
  expect([a.portOrder.violations, b.portOrder.violations]).toEqual([2, 0]);
  expect(readabilityTerm(after.final, resolver)).toBeLessThan(
    readabilityTerm(before.final, resolver),
  );
  expect(routedScore(after, resolver)).toBeLessThan(
    routedScore(before, resolver),
  );
  expect(calibratedScore(after, resolver)).toBeLessThan(
    calibratedScore(before, resolver),
  );
  expect(compactionRegresses(before, after, resolver, true)).toBe(false);
  expect(selectRoutingAlternative(before, after, resolver)).toBe(after.result);
});

it("rejects a lower old routed score when its readability cost outweighs the saving", () => {
  const before = candidate(true),
    after = candidate(false);
  const oldScore = (run: ReturnType<typeof candidate>) =>
    routedScore(run, resolver) - readabilityTerm(run.final, resolver);
  expect(oldScore(after)).toBeLessThan(oldScore(before));
  expect(selectRoutingAlternative(before, after, resolver)).toBe(before.result);
});

it("is deterministic and independent of the other documents scored in a planning call", () => {
  const run = candidate(true),
    snapshot = structuredClone(run.final);
  const score = () => routedScore(run, resolver);
  const first = reusePlanning(score);
  expect(
    reusePlanning(() => {
      routedScore(candidate(false), resolver);
      const value = score();
      routedScore(candidate(false), resolver);
      expect(score()).toBe(value);
      return value;
    }),
  ).toBe(first);
  expect(run.final).toEqual(snapshot);
  expect(
    reusePlanning(() =>
      routedScore({ ...run, final: structuredClone(snapshot) }, resolver),
    ),
  ).toBe(first);
});

it("keeps invalid candidates and routing guards independent of the soft score", () => {
  const run = candidate(true);
  expect(
    routedScore({ result: run.result, choices: run.choices }, resolver),
  ).toBe(Infinity);
  expect(
    routedScore(
      {
        ...run,
        result: {
          ...run.result,
          edits: [],
          diagnostics: [
            {
              severity: "error",
              code: "AUTO_LAYOUT_TEST",
              message: "refused",
              rule: "R10",
            },
          ],
        },
      },
      resolver,
    ),
  ).toBe(Infinity);
  expect(routedGuards(run.final, resolver)).toMatchObject({
    floating: 0,
    missing: 0,
  });
  const large: SchematicDocument = structuredClone(run.final);
  for (let index = large.instances.length; index < 41; index++)
    large.instances.push({
      id: `extra-${index}`,
      symbolId: "resistor",
      placement: placement(index * 100, 500),
    });
  expect(readabilityTerm(large, resolver)).toBe(0);
});

it("prefers physical completeness over any readability saving in either direction", () => {
  const complete = candidate(true);
  const disconnected = candidate(false);
  disconnected.final.routes = disconnected.final.routes.filter(
    (route) => route.id !== "gate-1",
  );
  // Make the complete drawing's soft cost arbitrarily worse without changing
  // its electrical connections: no finite unrouted penalty is a hard guard.
  complete.final.drafting = {
    objects: Array.from({ length: 20 }, (_, index) => ({
      id: `note-${index}`,
      kind: "text" as const,
      anchor: {
        kind: "free" as const,
        position: { x: 10000 + index * 1000, y: 10000 },
      },
      content: { runs: [{ kind: "text" as const, value: "remote" }] },
      rotation: 0,
      alignment: "middle" as const,
      locked: false,
      zIndex: 0,
    })),
  };
  expect(routedScore(disconnected, resolver)).toBeLessThan(
    routedScore(complete, resolver),
  );
  expect(
    compareRuns(disconnected, complete, resolver, calibratedScore),
  ).toBeGreaterThan(0);
  expect(
    compareRuns(complete, disconnected, resolver, calibratedScore),
  ).toBeLessThan(0);
  expect(compactionRegresses(disconnected, complete, resolver, true)).toBe(
    false,
  );
  expect(selectRoutingAlternative(complete, disconnected, resolver)).toBe(
    complete.result,
  );
  expect(selectRoutingAlternative(disconnected, complete, resolver)).toBe(
    complete.result,
  );
});
