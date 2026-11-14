import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import {
  createRoutePath,
  type Point,
  type SchematicDocument,
} from "@icm/model";
import { parseProject } from "@icm/project-protocol";
import {
  builtInSymbols,
  createProjectSymbolResolver,
  InMemorySymbolResolver,
  type SymbolResolver,
} from "@icm/symbols";
import { classifyNets } from "../src/net-roles.js";
import { reusePlanning } from "../src/planning-reuse.js";
import {
  readabilityMetrics,
  readabilityScore,
} from "../src/readability-metrics.js";
import { railCrossingMetrics } from "../src/readability-rail-crossings.js";
import { readabilityTerm } from "../src/readability-selection.js";
import { readabilityWeights } from "../src/readability-weights.js";
import { auditRouting } from "../src/routing-audit.js";
import { circuit } from "./document-fixture.js";
import corpus from "./corpus-cases.json";
import heldOut from "./held-out-cases.json";

// Preserve the original metric as an independent oracle, including exposure
// from unresolved routes and deduplication by point within each pair of Nets.
function pairwiseRails(
  document: SchematicDocument,
  resolver: SymbolResolver,
  rails: ReadonlyMap<string, unknown>,
) {
  const nets = [...new Set(document.routes.map((r) => r.netId))].sort();
  let violations = 0,
    opportunities = 0;
  for (let i = 0; i < nets.length; i++)
    for (const other of nets.slice(i + 1)) {
      const net = nets[i]!;
      if (!rails.has(net) && !rails.has(other)) continue;
      opportunities++;
      violations += auditRouting(
        {
          ...document,
          routes: document.routes.filter(
            (r) => r.netId === net || r.netId === other,
          ),
        },
        resolver,
      ).crossings;
    }
  return { violations, opportunities };
}

it.each([...corpus, ...heldOut])(
  "$id: weighted metrics, scores and rail counts are exact and deterministic",
  (fixture) => {
    const project = parseProject(readFileSync(fixture.file, "utf8"));
    const document = project.documents.find(
      (d) => d.id === (fixture.documentId ?? project.topDocumentId),
    )!;
    const resolver = createProjectSymbolResolver(project, builtInSymbols);
    const snapshot = structuredClone(document);
    const full = readabilityMetrics(structuredClone(document), resolver);
    const weighted = reusePlanning(() =>
      readabilityMetrics(document, resolver, "weighted"),
    );
    for (const key of Object.keys(readabilityWeights) as (keyof typeof full)[])
      if (readabilityWeights[key].weight !== 0)
        expect(weighted[key], key).toEqual(full[key]);
    expect(readabilityScore(weighted)).toBe(readabilityScore(full));
    if (document.instances.length <= 40)
      expect(reusePlanning(() => readabilityTerm(document, resolver))).toBe(
        30000 * readabilityScore(full),
      );
    expect(
      readabilityMetrics(structuredClone(document), resolver, "weighted"),
    ).toEqual(weighted);
    expect(readabilityMetrics(document, resolver, "weighted")).toEqual(
      weighted,
    );
    expect(document).toEqual(snapshot);
    expect(full.railCrossings).toEqual(
      pairwiseRails(document, resolver, classifyNets(document, resolver).rails),
    );
  },
);

const resolver = new InMemorySymbolResolver(builtInSymbols);
function wire(document: SchematicDocument, netId: string, points: Point[]) {
  const id = `route-${document.routes.length}`;
  document.junctions.push(
    { id: `${id}-start`, netId, position: points[0]! },
    { id: `${id}-end`, netId, position: points.at(-1)! },
  );
  document.routes.push(
    createRoutePath({
      id,
      netId,
      start: { kind: "junction", junctionId: `${id}-start` },
      end: { kind: "junction", junctionId: `${id}-end` },
      bends: points.slice(1, -1),
      modes: Array.from({ length: points.length - 1 }, () => "manual" as const),
    }),
  );
}

it("deduplicates rail crossings per Net pair, including duplicate routes and coincident multi-Net crossings", () => {
  const document = circuit({}, { rail: [], signal: [], diagonal: [] });
  wire(document, "rail", [
    { x: -10, y: 0 },
    { x: 10, y: 0 },
  ]);
  wire(document, "signal", [
    { x: 0, y: -10 },
    { x: 0, y: 10 },
  ]);
  wire(document, "diagonal", [
    { x: -10, y: -10 },
    { x: 10, y: 10 },
  ]);
  wire(document, "rail", [
    { x: -10, y: 0 },
    { x: 10, y: 0 },
  ]);
  const rails = new Map([["rail", "supply"]]);
  expect(auditRouting(document, resolver).crossings).toBe(1);
  expect(railCrossingMetrics(document, resolver, rails)).toEqual({
    violations: 2,
    opportunities: 2,
  });
  rails.set("signal", "ground");
  expect(railCrossingMetrics(document, resolver, rails)).toEqual({
    violations: 3,
    opportunities: 3,
  });
  expect(railCrossingMetrics(document, resolver, rails)).toEqual(
    pairwiseRails(document, resolver, rails),
  );
});

it("matches pairwise audits for endpoint touches, overlaps, degeneracies, rounded points and unresolved routes", () => {
  const document = circuit(
    {},
    { rail: [], signal: [], other: [], unresolved: [] },
  );
  wire(document, "rail", [
    { x: -10, y: 0 },
    { x: 10, y: 0 },
  ]);
  wire(document, "signal", [
    { x: 0, y: 0 },
    { x: 0, y: 10 },
  ]);
  wire(document, "signal", [
    { x: -5, y: 0 },
    { x: 5, y: 0 },
  ]);
  wire(document, "signal", [
    { x: 3, y: 0 },
    { x: 3, y: 0 },
  ]);
  expect(
    railCrossingMetrics(document, resolver, new Map([["rail", true]]))
      .violations,
  ).toBe(0);
  for (const x of [0.0001, 0.0002, 0.0006])
    wire(document, "signal", [
      { x, y: -10 },
      { x, y: 10 },
    ]);
  wire(document, "other", [
    { x: -10, y: -10 },
    { x: 10, y: 10 },
  ]);
  document.routes.push(
    createRoutePath({
      id: "unresolved",
      netId: "unresolved",
      start: { kind: "terminal", instanceId: "missing", pinName: "P" },
      end: { kind: "terminal", instanceId: "missing", pinName: "Q" },
      bends: [],
      modes: ["manual"],
    }),
  );
  for (const ids of [
    [],
    ["rail"],
    ["rail", "signal"],
    ["rail", "signal", "other", "unresolved"],
  ]) {
    const rails = new Map(ids.map((id) => [id, true]));
    expect(railCrossingMetrics(document, resolver, rails)).toEqual(
      pairwiseRails(document, resolver, rails),
    );
  }
  expect(
    railCrossingMetrics(document, resolver, new Map([["rail", true]])),
  ).toEqual({ violations: 3, opportunities: 3 });
  const reversed = { ...document, routes: [...document.routes].reverse() };
  expect(
    railCrossingMetrics(reversed, resolver, new Map([["rail", true]])),
  ).toEqual(pairwiseRails(reversed, resolver, new Map([["rail", true]])));
});
