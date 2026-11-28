import { createHash } from "node:crypto";
import { planAutoLayout } from "../src/auto-layout.js";
import { expect, it } from "vitest";
import { createRoutePath } from "@icm/model";
import { builtInSymbols, InMemorySymbolResolver } from "@icm/symbols";
import { circuit } from "./document-fixture.js";
import { classifyNets } from "../src/net-roles.js";
import { freezePinGroups, routeDocument } from "../src/route.js";
import { auditRouting, missingConnections } from "../src/routing-audit.js";
import { terminalPartition, preview } from "../src/transaction.js";
import { simplifyRoutes } from "../src/route-simplify.js";
import { readabilityRegressed } from "../src/readability.js";
import { pinPoints } from "../src/geometry.js";
import { rerouteCrossings } from "../src/local-reroute.js";
import type { AutoLayoutResult } from "../src/types.js";

const resolver = new InMemorySymbolResolver(builtInSymbols);
function pair() {
  const doc = circuit(
    { a: "resistor", b: "resistor" },
    { signal: ["a.1", "b.1"] },
  );
  doc.presentation.grid = 10;
  doc.instances.forEach(
    (i, n) =>
      (i.placement = {
        position: { x: n ? 160 : -160, y: 0 },
        rotation: 0,
        mirror: "none",
      }),
  );
  return doc;
}
function route(doc: ReturnType<typeof pair>, hananRescue = false) {
  return routeDocument(
    doc,
    resolver,
    freezePinGroups(doc, resolver),
    classifyNets(doc, resolver),
    [],
    true,
    { hananRescue },
  );
}

function nameSignal(doc: ReturnType<typeof pair>) {
  doc.connectivityEvidence.push(
    {
      id: "source",
      kind: "spice-source",
      netId: "signal",
      sourceNetId: "signal",
    },
    {
      id: "claim",
      kind: "name-claim",
      netId: "signal",
      name: "SIGNAL",
      scope: "global",
      owner: { kind: "global-declaration", sourceNetId: "signal" },
    },
  );
}

it("rescues a blocked net before label fallback and preserves quick routing", () => {
  const doc = pair();
  for (let y = -180; y <= 180; y += 20)
    doc.instances.push({
      id: "wall" + y,
      symbolId: "resistor",
      placement: { position: { x: 0, y }, rotation: 0, mirror: "none" },
    });
  nameSignal(doc);
  const quick = route(doc),
    rescued = route(doc, true);
  expect(quick.document.annotations.length).toBeGreaterThan(0);
  expect(rescued.problem).toBeUndefined();
  expect(rescued.document.annotations).toHaveLength(0);
  expect(missingConnections(rescued.document, resolver)).toBe(0);
  expect(auditRouting(rescued.document, resolver).unsafeProblems).toEqual([]);
});

it("rescues the selected search placement after quick routing exhausts its tracks", () => {
  const doc = pair();
  nameSignal(doc);
  doc.presentation.grid = 1;
  doc.instances.push({
    id: "wall",
    symbolId: "resistor",
    placement: { position: { x: 0, y: -30 }, rotation: 0, mirror: "none" },
  });
  const fixedInstanceIds = new Set(doc.instances.map((i) => i.id));
  const quick = planAutoLayout(doc, resolver, { fixedInstanceIds });
  expect(quick.diagnostics).toContainEqual(
    expect.objectContaining({ code: "AUTO_LAYOUT_CONNECTION_REFUSED" }),
  );
  const searched = planAutoLayout(doc, resolver, {
    fixedInstanceIds,
    search: { evaluations: 1, seed: 1 },
  });
  expect(searched.diagnostics.filter((d) => d.severity === "error")).toEqual(
    [],
  );
  const replay = preview(doc, resolver, searched.edits);
  if (!replay.ok) throw Error(JSON.stringify(replay.diagnostics));
  expect(replay.document.annotations).toHaveLength(0);
  expect(replay.document.routes.some((r) => r.id.includes("-stub-route"))).toBe(
    false,
  );
  expect(missingConnections(replay.document, resolver)).toBe(0);
  expect(auditRouting(replay.document, resolver).unsafeProblems).toEqual([]);
  expect(terminalPartition(replay.document, resolver)).toBe(
    terminalPartition(doc, resolver),
  );
});

function initialRoute(
  doc: ReturnType<typeof pair>,
  detour: boolean,
): AutoLayoutResult {
  const pins = pinPoints(doc, resolver).filter((p) => p.pinName === "1");
  const [a, b] = pins.map((p) => p.point);
  const y = a!.y - 80;
  const bends = detour
    ? [
        { x: a!.x, y },
        { x: b!.x, y },
      ]
    : [];
  const route = createRoutePath({
    id: "original",
    netId: "signal",
    start: { kind: "terminal", instanceId: "a", pinName: "1" },
    end: { kind: "terminal", instanceId: "b", pinName: "1" },
    bends,
    modes: bends.length ? ["manual", "manual", "manual"] : ["manual"],
  });
  return {
    edits: [{ kind: "set_route_path", route }],
    diagnostics: [],
    groups: [],
  };
}

it("shortens a signal detour and replays the original terminal partition", () => {
  const doc = pair(),
    result = initialRoute(doc, true);
  const before = preview(doc, resolver, result.edits);
  const simple = simplifyRoutes(doc, resolver, result, () => false);
  const after = preview(doc, resolver, simple.edits);
  if (!before.ok || !after.ok) throw Error("replay failed");
  expect(auditRouting(after.document, resolver).bends).toBeLessThan(
    auditRouting(before.document, resolver).bends,
  );
  expect(auditRouting(after.document, resolver)).toMatchObject({
    unsafeProblems: [],
    crossings: 0,
  });
  expect(terminalPartition(after.document, resolver)).toBe(
    terminalPartition(before.document, resolver),
  );
  expect(readabilityRegressed(before.document, after.document, resolver)).toBe(
    false,
  );
});

it("deep-reroutes a signal around parallel crossing wires", () => {
  const doc = pair(),
    result = initialRoute(doc, false);
  for (const x of [-30, 0, 30]) {
    const netId = "bar" + x;
    doc.nets.push({ id: netId, terminals: [] });
    doc.junctions.push(
      ...[-150, 150].map((y) => ({ id: netId + y, netId, position: { x, y } })),
    );
    doc.routes.push(
      createRoutePath({
        id: netId + "-wire",
        netId,
        start: { kind: "junction", junctionId: netId + "-150" },
        end: { kind: "junction", junctionId: netId + "150" },
        bends: [],
        modes: ["locked"],
      }),
    );
  }
  const initial = preview(doc, resolver, result.edits);
  if (!initial.ok) throw Error(JSON.stringify(initial.diagnostics));
  expect(auditRouting(initial.document, resolver).crossings).toBe(3);
  const repaired = rerouteCrossings(
    doc,
    resolver,
    result,
    () => false,
    initial.document,
    { hanan: true },
  );
  const after = preview(doc, resolver, repaired.edits);
  if (!after.ok) throw Error(JSON.stringify(after.diagnostics));
  expect(auditRouting(after.document, resolver)).toMatchObject({
    crossings: 0,
    unsafeProblems: [],
  });
});

it("keeps the zero-evaluation edit sequence byte-identical to the baseline", () => {
  const doc = pair(),
    options = { search: { evaluations: 0, seed: 1 } };
  // SHA-256 of the serialized public planner edits at f45c0797.
  const edits = planAutoLayout(doc, resolver, options).edits;
  expect(createHash("sha256").update(JSON.stringify(edits)).digest("hex")).toBe(
    "249340d432db3a63a63f6c0ef7b21a3218609958da942814240889c8157dd134",
  );
});

it("leaves a locked signal detour intact", () => {
  const doc = pair(),
    result = initialRoute(doc, true),
    edit = result.edits[0]!;
  if (edit.kind !== "set_route_path") throw Error("missing fixture route");
  edit.route.legs[1]!.mode = "locked";
  expect(simplifyRoutes(doc, resolver, result, () => false)).toBe(result);
});
