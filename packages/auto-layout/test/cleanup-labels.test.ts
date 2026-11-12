import { boundAnnotationName } from "@icm/model";
import { builtInSymbols, InMemorySymbolResolver } from "@icm/symbols";
import { expect, it } from "vitest";
import { planAutoLayout } from "../src/index.js";
import { preview, terminalPartition } from "../src/transaction.js";
import { reanchorLabels } from "../src/labels.js";
import { freezePinGroups } from "../src/route.js";
import { auditRouting } from "../src/routing-audit.js";
import { circuit } from "./document-fixture.js";

const resolver = new InMemorySymbolResolver(builtInSymbols);

it("preserves a junction-owned power label's rich-text name through cleanup", () => {
  const document = circuit({ r: "resistor" }, { supply: ["r.1"] });
  document.instances[0]!.placement = {
    position: { x: 100, y: 100 },
    rotation: 0,
    mirror: "none",
  };
  document.junctions.push({
    id: "rail-end",
    netId: "supply",
    position: { x: 200, y: 20 },
  });
  document.routes.push({
    id: "rail",
    netId: "supply",
    start: { kind: "terminal", instanceId: "r", pinName: "1" },
    legs: [
      {
        id: "leg",
        mode: "manual",
        to: {
          kind: "endpoint",
          endpoint: { kind: "junction", junctionId: "rail-end" },
        },
      },
    ],
  });
  document.connectivityEvidence.push({
    id: "claim",
    kind: "name-claim",
    name: "VDD",
    netId: "supply",
    scope: "global",
    powerDomain: "vdd",
    owner: { kind: "power-marker", objectId: "rail-end" },
  });
  const label = {
    id: "label",
    kind: "power-label" as const,
    netId: "supply",
    binding: { kind: "net-name" as const, netId: "supply" },
    formatOverride: {
      runs: [
        { kind: "text" as const, value: "V" },
        {
          kind: "span" as const,
          style: "subscript" as const,
          children: [{ kind: "text" as const, value: "DD" }],
        },
      ],
    },
    anchor: {
      kind: "object" as const,
      objectId: "rail-end",
      localOffset: { x: 10, y: 10 },
      fallbackPosition: { x: 210, y: 30 },
    },
    alignment: "start" as const,
    rotation: 0 as const,
    locked: false,
  };
  document.annotations.push(label);
  const plan = planAutoLayout(document, resolver);
  expect(plan.diagnostics).toEqual([]);
  const result = preview(document, resolver, plan.edits);
  expect(result.ok).toBe(true);
  if (!result.ok) return;
  const after = result.document.annotations.find((a) => a.id === label.id)!;
  expect(after.formatOverride).toEqual(label.formatOverride);
  expect(boundAnnotationName(result.document, after)).toBe("VDD");
  expect(terminalPartition(result.document, resolver)).toBe(
    terminalPartition(document, resolver),
  );
});

it("keeps a device-anchored output name on its Net while deleting route anchors", () => {
  const document = circuit(
    { z: "nmos", a: "resistor", input: "resistor" },
    { outputNet: ["a.1", "z.D"], biasNet: ["z.G", "input.1"] },
  );
  for (const [index, instance] of document.instances.entries())
    instance.placement = {
      position: { x: index * 100, y: 0 },
      rotation: 0,
      mirror: "none",
    };
  document.junctions.push({
    id: "output-end",
    netId: "outputNet",
    position: { x: 100, y: -20 },
    role: "route-anchor",
  });
  for (const [instanceId, pinName] of [
    ["z", "D"],
    ["a", "1"],
  ])
    document.routes.push({
      id: `wire-${instanceId}`,
      netId: "outputNet",
      start: { kind: "terminal", instanceId: instanceId!, pinName: pinName! },
      legs: [
        {
          id: `leg-${instanceId}`,
          mode: "manual",
          to: {
            kind: "endpoint",
            endpoint: { kind: "junction", junctionId: "output-end" },
          },
        },
      ],
    });
  for (const [netId, owner, name] of [
    ["outputNet", "z", "OUT"],
    ["biasNet", "input", "BIAS"],
  ]) {
    document.annotations.push({
      id: `label-${netId}`,
      kind: "net-label",
      netId: netId!,
      binding: { kind: "net-name", netId: netId! },
      anchor: {
        kind: "object",
        objectId: owner!,
        localOffset: { x: 20, y: 10 },
        fallbackPosition: { x: 20, y: 10 },
      },
      alignment: "start",
      rotation: 0,
      locked: false,
    });
    document.connectivityEvidence.push({
      id: `claim-${netId}`,
      kind: "name-claim",
      netId: netId!,
      name: name!,
      scope: "local",
      owner: { kind: "net-label", annotationId: `label-${netId}` },
    });
  }
  const plan = planAutoLayout(document, resolver);
  expect(plan.diagnostics).toEqual([]);
  const result = preview(document, resolver, plan.edits);
  expect(result.ok).toBe(true);
  if (!result.ok) return;
  expect(terminalPartition(result.document, resolver)).toBe(
    terminalPartition(document, resolver),
  );
  for (const original of document.annotations) {
    const after = result.document.annotations.find(
      (a) => a.id === original.id,
    )!;
    expect(after.anchor).toMatchObject({
      kind: "object",
      objectId:
        original.anchor.kind === "object" ? original.anchor.objectId : "",
    });
    expect(boundAnnotationName(result.document, after)).toBe(
      boundAnnotationName(document, original),
    );
    expect(after.netId).toBe(original.netId);
  }
});

it("rounds an odd horizontal leg midpoint before persisting a label fallback", () => {
  const document = circuit({ r: "resistor" }, { signal: ["r.1"] });
  document.presentation.grid = 1;
  document.instances[0]!.placement = {
    position: { x: 0, y: 0 },
    rotation: 0,
    mirror: "none",
  };
  document.junctions.push({
    id: "end",
    netId: "signal",
    position: { x: 21, y: -20 },
  });
  document.routes.push({
    id: "wire",
    netId: "signal",
    start: { kind: "terminal", instanceId: "r", pinName: "1" },
    legs: [
      {
        id: "leg",
        mode: "manual",
        to: {
          kind: "endpoint",
          endpoint: { kind: "junction", junctionId: "end" },
        },
      },
    ],
  });
  const label = {
    id: "label",
    kind: "net-label" as const,
    netId: "signal",
    content: { runs: [{ kind: "text" as const, value: "signal" }] },
    anchor: { kind: "free" as const, position: { x: 0, y: 0 } },
    alignment: "start" as const,
    rotation: 0 as const,
    locked: false,
  };
  document.annotations.push(label);
  const edits = reanchorLabels(
    document,
    resolver,
    [label],
    freezePinGroups(document, resolver),
  );
  const replay = preview(document, resolver, edits);
  expect(replay.ok, JSON.stringify(replay.diagnostics)).toBe(true);
  if (!replay.ok) return;
  expect(replay.document.annotations[0]!.anchor).toMatchObject({
    kind: "route",
    t: 0.5,
    fallbackPosition: { x: 11, y: -20 },
  });
});

it("routes a separated visible MOS bulk contact before transaction replay can add an unchecked wire", () => {
  const document = circuit(
    { m: "nmos", body: "port" },
    { bodyNet: ["body.P", "m.B"] },
  );
  document.instances[0]!.placement = {
    position: { x: 0, y: 0 },
    rotation: 0,
    mirror: "none",
  };
  document.instances[1]!.placement = {
    position: { x: -4, y: 0 },
    rotation: 0,
    mirror: "none",
  };
  document.netlist = {
    name: "bulk-contact",
    formalParameters: [],
    terminals: [
      {
        id: "body-terminal",
        name: "body",
        netId: "bodyNet",
        direction: "passive",
        interfaceInstanceIds: ["body"],
      },
    ],
  };
  const plan = planAutoLayout(document, resolver);
  expect(plan.diagnostics).toEqual([]);
  const replay = preview(document, resolver, plan.edits);
  expect(replay.ok, JSON.stringify(replay.diagnostics)).toBe(true);
  if (!replay.ok) return;
  expect(auditRouting(replay.document, resolver).unsafeProblems).toEqual([]);
  expect(terminalPartition(replay.document, resolver)).toBe(
    terminalPartition(document, resolver),
  );
});
